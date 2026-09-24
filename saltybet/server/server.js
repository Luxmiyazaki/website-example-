#!/usr/bin/env node
/* Salty Brawl – online mode server. Zero dependencies, Node 18+.
 *
 *   node server/server.js            (or: npm start)
 *
 * Runs ONE shared league: every browser that connects watches the same
 * fights, bets into the same pots and shares the chat. Live updates are
 * pushed with Server-Sent Events, actions are small JSON POSTs.
 *
 * Environment variables (all optional):
 *   PORT=3000  HOST=0.0.0.0  DATA_DIR=./data  BOTS=60  BET_SECONDS=30
 *   MATCHMAKING=100  EXHIBITIONS=25  TRUST_PROXY=1 (behind a reverse proxy) */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
for (const f of ['rng.js', 'roster.js', 'fight.js', 'league.js']) require(path.join(ROOT, 'js', 'core', f));
const SB = globalThis.SB;

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'league.json');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_CLIENTS = 2000;

function envInt(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

// ------------------------------------------------------------- persistence
let pendingSave = null;
let saveTimer = null;
function writeNow() {
  if (!pendingSave) return;
  const data = JSON.stringify(pendingSave);
  pendingSave = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('[save] failed:', e.message);
  }
}
const storage = {
  load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return null; }
  },
  save(state) {
    pendingSave = JSON.parse(JSON.stringify(state));
    if (!saveTimer) saveTimer = setTimeout(function () { saveTimer = null; writeNow(); }, 1000);
  }
};

const league = new SB.League({
  storage: storage,
  makeToken: function () { return crypto.randomBytes(24).toString('hex'); },
  config: {
    bots: envInt('BOTS', 60),
    betOpenMs: envInt('BET_SECONDS', 30) * 1000,
    matchmakingCount: Math.max(1, envInt('MATCHMAKING', 100)),
    exhibitionCount: Math.max(1, envInt('EXHIBITIONS', 25))
  }
});

// -------------------------------------------------------------------- SSE
const clients = new Set();
function send(c, type, data) {
  try { c.res.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* closed */ }
}
league.on(function (type, data, to) {
  for (const c of clients) {
    if (to && c.pid !== to) continue;
    send(c, type, data);
  }
});
let onlineTimer = null;
function announceOnline() {
  if (onlineTimer) return;
  onlineTimer = setTimeout(function () {
    onlineTimer = null;
    for (const c of clients) send(c, 'online', { count: clients.size });
  }, 500);
}

setInterval(function () { league.update(Date.now()); }, 200);
setInterval(function () {
  const now = Date.now();
  for (const c of clients) send(c, 'ping', { now: now });
}, 15000);

// ------------------------------------------------------------------- HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
};

function json(res, status, body) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS));
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(function (resolve) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > 8192) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { resolve(null); }
    });
    req.on('error', function () { resolve(null); });
  });
}

function playerFrom(req, url) {
  const auth = req.headers.authorization || '';
  const token = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : url.searchParams.get('token');
  return league.playerByToken(token);
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

const registrations = new Map();
function allowRegister(ip) {
  const now = Date.now();
  const list = (registrations.get(ip) || []).filter(function (t) { return now - t < 3600 * 1000; });
  if (list.length >= 5) return false;
  list.push(now);
  registrations.set(ip, list);
  return true;
}

const PUBLIC = [path.join(ROOT, 'index.html'), path.join(ROOT, 'css') + path.sep, path.join(ROOT, 'js') + path.sep];

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  // Whitelist check on the fully decoded + normalized path, so encoded
  // "../" tricks can never reach server/, tests/ or data/ (which holds tokens).
  const file = path.normalize(path.join(ROOT, rel));
  const allowed = rel.indexOf('\0') < 0 && (file === PUBLIC[0] || file.indexOf(PUBLIC[1]) === 0 || file.indexOf(PUBLIC[2]) === 0);
  if (!allowed) { res.writeHead(404, SECURITY_HEADERS); res.end('Not found'); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404, SECURITY_HEADERS); res.end('Not found'); return; }
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, SECURITY_HEADERS));
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

async function handleApi(req, res, url) {
  const route = req.method + ' ' + url.pathname;
  switch (route) {
    case 'GET /api/info':
      return json(res, 200, { saltyBrawl: true, mode: 'online', online: clients.size });

    case 'GET /api/stream': {
      if (clients.size >= MAX_CLIENTS) return json(res, 503, { ok: false, error: 'The Salt Mine is full. Try again soon.' });
      const p = playerFrom(req, url);
      res.writeHead(200, Object.assign({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      }, SECURITY_HEADERS));
      res.write('retry: 3000\n\n');
      const c = { res: res, pid: p ? p.id : null };
      clients.add(c);
      send(c, 'snapshot', league.snapshot(c.pid));
      send(c, 'online', { count: clients.size });
      announceOnline();
      req.on('close', function () { clients.delete(c); announceOnline(); });
      return;
    }

    case 'POST /api/register': {
      const body = await readBody(req);
      if (!body) return json(res, 400, { ok: false, error: 'Bad request.' });
      if (!allowRegister(clientIp(req))) return json(res, 429, { ok: false, error: 'Too many new accounts from your network. Try again later.' });
      const r = league.addPlayer(body.name);
      if (!r.ok) return json(res, 400, r);
      return json(res, 200, { ok: true, token: r.player.token, me: league.publicMe(r.player) });
    }

    case 'POST /api/bet': case 'POST /api/chat': case 'POST /api/rename': {
      const p = playerFrom(req, url);
      if (!p) return json(res, 401, { ok: false, error: 'Please sign up first.' });
      const body = await readBody(req);
      if (!body) return json(res, 400, { ok: false, error: 'Bad request.' });
      let r;
      if (route === 'POST /api/bet') r = league.placeBet(p.id, body.side, body.amount);
      else if (route === 'POST /api/chat') r = league.chat(p.id, body.text);
      else r = league.renamePlayer(p.id, body.name);
      if (r.ok) r.me = league.publicMe(p);
      return json(res, r.ok ? 200 : 400, r);
    }

    case 'GET /api/leaderboard': {
      const p = playerFrom(req, url);
      return json(res, 200, league.leaderboard(p ? p.id : null));
    }
    case 'GET /api/fighters':
      return json(res, 200, league.fighterList());
    case 'GET /api/history':
      return json(res, 200, league.historyList(40));
    case 'GET /api/me': {
      const p = playerFrom(req, url);
      return p ? json(res, 200, { ok: true, me: league.publicMe(p) }) : json(res, 401, { ok: false, error: 'Unknown token.' });
    }
  }
  return json(res, 404, { ok: false, error: 'Unknown endpoint.' });
}

const server = http.createServer(function (req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); res.end(); return; }
  if (url.pathname.indexOf('/api/') === 0) {
    handleApi(req, res, url).catch(function (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { ok: false, error: 'Server error.' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, function () {
  league.update(Date.now());
  console.log('Salty Brawl is live on http://localhost:' + PORT + '  (data: ' + DATA_FILE + ')');
});

function shutdown() {
  console.log('\nSaving and shutting down…');
  league.save();
  writeNow();
  for (const c of clients) { try { c.res.end(); } catch (e) { /* ignore */ } }
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
