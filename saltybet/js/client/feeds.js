/* Salty Brawl – data feeds.
 * LocalFeed runs the whole league inside the browser (solo mode, saved in
 * localStorage). RemoteFeed talks to server/server.js (online mode with
 * shared fights, pots and chat). Both expose the same interface. */
(function (SB) {
  'use strict';

  const SAVE_KEY = 'saltybrawl.solo.v1';

  function Emitter() { this.fns = []; }
  Emitter.prototype.on = function (fn) { this.fns.push(fn); };
  Emitter.prototype.emit = function (type, data) {
    for (const fn of this.fns) { try { fn(type, data); } catch (e) { console.error(e); } }
  };

  function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* ignore */ } }
  function safeDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------- LocalFeed
  function LocalFeed(opts) {
    Emitter.call(this);
    opts = opts || {};
    this.mode = 'solo';
    this.pid = 'you';
    this.base = Date.now();
    this.virtual = 0;
    this.lastReal = performance.now();
    this.paused = false;
    const self = this;
    const storage = {
      load: function () { const s = safeGet(SAVE_KEY); return s ? JSON.parse(s) : null; },
      save: function (state) { safeSet(SAVE_KEY, JSON.stringify(state)); }
    };
    let settings = {};
    try { settings = JSON.parse(safeGet('saltybrawl.settings') || '{}'); } catch (e) { settings = {}; }
    this.settings = settings;
    this.league = new SB.League({
      now: function () { return self.now(); },
      storage: storage,
      config: Object.assign({}, opts.config || {}, this.turboConfig(!!settings.turbo), opts.overrides || {})
    });
    if (!this.league.state.players[this.pid]) {
      const r = this.league.addPlayer(settings.name || '', this.pid);
      if (!r.ok) this.league.addPlayer('You_' + Math.floor(Math.random() * 9000 + 1000), this.pid);
    }
    this.league.on(function (type, data, to) {
      if (to && to !== self.pid) return;
      self.emit(type, data);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { self.now(); self.paused = true; }
      else { self.lastReal = performance.now(); self.paused = false; }
    });
  }
  LocalFeed.prototype = Object.create(Emitter.prototype);

  LocalFeed.prototype.turboConfig = function (on) {
    return on ? { betOpenMs: 12000, preFightMs: 1500, postFightMs: 1500, tps: 120 } : { betOpenMs: 25000, preFightMs: 2500, postFightMs: 2500, tps: 60 };
  };

  // Virtual clock: stops while the tab is hidden, so you never miss your own fight.
  LocalFeed.prototype.now = function () {
    const t = performance.now();
    let d = t - this.lastReal;
    this.lastReal = t;
    if (this.paused || d < 0) d = 0;
    if (d > 1000) d = 1000;
    this.virtual += d;
    return this.base + this.virtual;
  };

  LocalFeed.prototype.start = function () {
    const self = this;
    this.league.update(this.now());
    this.emit('snapshot', this.league.snapshot(this.pid));
    setInterval(function () { self.league.update(self.now()); }, 100);
  };

  LocalFeed.prototype.me = function () { return this.league.publicMe(this.league.state.players[this.pid]); };
  LocalFeed.prototype.bet = function (side, amount) { return Promise.resolve(this.league.placeBet(this.pid, side, amount)); };
  LocalFeed.prototype.chat = function (text) { return Promise.resolve(this.league.chat(this.pid, text)); };
  LocalFeed.prototype.leaderboard = function () { return Promise.resolve(this.league.leaderboard(this.pid)); };
  LocalFeed.prototype.fighters = function () { return Promise.resolve(this.league.fighterList()); };
  LocalFeed.prototype.history = function () { return Promise.resolve(this.league.historyList(40)); };
  LocalFeed.prototype.rename = function (name) {
    const r = this.league.renamePlayer(this.pid, name);
    if (r.ok) { this.settings.name = name; safeSet('saltybrawl.settings', JSON.stringify(this.settings)); }
    return Promise.resolve(r);
  };
  LocalFeed.prototype.setTurbo = function (on) {
    this.settings.turbo = !!on;
    safeSet('saltybrawl.settings', JSON.stringify(this.settings));
    Object.assign(this.league.cfg, this.turboConfig(!!on));
  };
  LocalFeed.prototype.reset = function () {
    safeDel(SAVE_KEY);
    location.reload();
  };
  LocalFeed.prototype.needsLogin = function () { return false; };

  // ------------------------------------------------------------ RemoteFeed
  function RemoteFeed(base) {
    Emitter.call(this);
    this.mode = 'online';
    this.base = base || '';
    this.offset = 0;
    this.token = safeGet('saltybrawl.token');
    this.es = null;
    this.meData = null;
  }
  RemoteFeed.prototype = Object.create(Emitter.prototype);

  RemoteFeed.prototype.now = function () { return Date.now() + this.offset; };

  RemoteFeed.prototype.start = function () {
    const self = this;
    if (this.es) this.es.close();
    const url = this.base + 'api/stream' + (this.token ? '?token=' + encodeURIComponent(this.token) : '');
    const es = this.es = new EventSource(url);
    const sync = function (serverNow) { if (typeof serverNow === 'number') self.offset = serverNow - Date.now(); };
    es.addEventListener('snapshot', function (e) {
      const d = JSON.parse(e.data);
      sync(d.now);
      if (self.token && !d.me) { self.token = null; safeDel('saltybrawl.token'); }
      self.meData = d.me;
      self.emit('snapshot', d);
    });
    ['match', 'chat', 'betcount', 'notice', 'online'].forEach(function (type) {
      es.addEventListener(type, function (e) { self.emit(type, JSON.parse(e.data)); });
    });
    es.addEventListener('me', function (e) { const d = JSON.parse(e.data); self.meData = d; self.emit('me', d); });
    es.addEventListener('ping', function (e) { sync(JSON.parse(e.data).now); });
    es.onerror = function () { self.emit('connection', { ok: false }); };
    es.onopen = function () { self.emit('connection', { ok: true }); };
  };

  RemoteFeed.prototype.api = function (method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    return fetch(this.base + 'api/' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Server error (' + r.status + ')' }; }); })
      .catch(function () { return { ok: false, error: 'Connection problem – try again.' }; });
  };

  RemoteFeed.prototype.me = function () { return this.meData; };
  RemoteFeed.prototype.needsLogin = function () { return !this.token; };
  RemoteFeed.prototype.register = function (name) {
    const self = this;
    return this.api('POST', 'register', { name: name }).then(function (r) {
      if (r.ok) { self.token = r.token; safeSet('saltybrawl.token', r.token); self.start(); }
      return r;
    });
  };
  RemoteFeed.prototype.logout = function () { this.token = null; safeDel('saltybrawl.token'); this.start(); };
  RemoteFeed.prototype.bet = function (side, amount) { return this.api('POST', 'bet', { side: side, amount: amount }); };
  RemoteFeed.prototype.chat = function (text) { return this.api('POST', 'chat', { text: text }); };
  RemoteFeed.prototype.rename = function (name) { return this.api('POST', 'rename', { name: name }); };
  RemoteFeed.prototype.leaderboard = function () { return this.api('GET', 'leaderboard'); };
  RemoteFeed.prototype.fighters = function () { return this.api('GET', 'fighters'); };
  RemoteFeed.prototype.history = function () { return this.api('GET', 'history'); };

  SB.LocalFeed = LocalFeed;
  SB.RemoteFeed = RemoteFeed;
})(globalThis.SB = globalThis.SB || {});
