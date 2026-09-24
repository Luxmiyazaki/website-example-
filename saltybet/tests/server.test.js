const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

const PORT = 3000 + Math.floor(Math.random() * 2000) + 20000;
const BASE = 'http://127.0.0.1:' + PORT;
let proc, dataDir;

function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + p, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {})
    }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => resolve({ status: res.statusCode, body: s, json: () => JSON.parse(s) }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// Reads SSE events until `until(events)` returns true.
function sse(p, until, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const events = [];
    let timer = null;
    const r = http.get(BASE + p, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /event: (.+)/.exec(chunk), data = /data: (.+)/.exec(chunk);
          if (ev && data) events.push({ type: ev[1], data: JSON.parse(data[1]) });
          if (until(events)) { clearTimeout(timer); r.destroy(); resolve(events); return; }
        }
      });
    });
    r.on('error', () => {});
    timer = setTimeout(() => { r.destroy(); reject(new Error('SSE timeout, got ' + events.map((e) => e.type).join(','))); }, timeout);
  });
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saltybrawl-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, BET_SECONDS: '20', BOTS: '10' }),
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve) => proc.stdout.on('data', (d) => { if (/live on/.test(String(d))) resolve(); }));
});

test.after(() => { proc.kill('SIGTERM'); });

test('serves the site and reports online mode', async () => {
  const index = await req('GET', '/');
  assert.equal(index.status, 200);
  assert.match(index.body, /Salty Brawl/);
  const info = (await req('GET', '/api/info')).json();
  assert.equal(info.saltyBrawl, true);
  assert.equal((await req('GET', '/js/core/fight.js')).status, 200);
});

test('never serves server code, tests or saved data', async () => {
  for (const p of ['/server/server.js', '/data/league.json', '/package.json', '/tests/server.test.js',
    '/js/..%2fdata/league.json', '/js/..%2fserver/server.js', '/css/%2e%2e/package.json', '/js/%2e%2e%2f%2e%2e%2fetc/passwd']) {
    const r = await req('GET', p);
    assert.equal(r.status, 404, p + ' -> ' + r.status);
  }
});

test('register, receive a snapshot, bet and chat', async () => {
  const name = 'tester' + Math.floor(Math.random() * 1000);
  const reg = (await req('POST', '/api/register', { name })).json();
  assert.ok(reg.ok, reg.error);
  assert.equal(reg.me.balance, 400);
  const dup = await req('POST', '/api/register', { name });
  assert.equal(dup.status, 400);

  // wait until betting is open
  const events = await sse('/api/stream?token=' + reg.token, (ev) =>
    ev.some((e) => (e.type === 'snapshot' && e.data.match && e.data.match.phase === 'open') || (e.type === 'match' && e.data.phase === 'open')), 90000);
  const snap = events.find((e) => e.type === 'snapshot').data;
  assert.equal(snap.me.name, name);

  const bet = (await req('POST', '/api/bet', { side: 'red', amount: 150 }, reg.token)).json();
  assert.ok(bet.ok, bet.error);
  assert.equal(bet.me.balance, 250);
  const again = await req('POST', '/api/bet', { side: 'blue', amount: 10 }, reg.token);
  assert.equal(again.status, 400);
  const noAuth = await req('POST', '/api/bet', { side: 'red', amount: 1 });
  assert.equal(noAuth.status, 401);

  const chat = (await req('POST', '/api/chat', { text: 'hello salt mine' }, reg.token)).json();
  assert.ok(chat.ok);
  const lb = (await req('GET', '/api/leaderboard', null, reg.token)).json();
  assert.ok(lb.me && lb.me.entry.name === name);
  assert.equal(lb.top[0].token, undefined);
});
