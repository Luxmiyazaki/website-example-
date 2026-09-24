/* Salty Brawl – the league: match cycle, betting, payouts, tournaments,
 * exhibitions, bettor bots, chat and persistence.
 *
 * Runs unchanged in the browser (solo mode) and in Node (server mode).
 * Everything that happens is published through `on(fn)` as
 * fn(type, data, targetPlayerId|null). */
(function (SB) {
  'use strict';

  const DEFAULTS = {
    betOpenMs: 30000,       // betting window
    preFightMs: 2500,       // "bets locked" -> fight starts
    postFightMs: 2500,      // fight animation over -> next betting window
    tps: 60,                // fight ticks per second (120 = turbo)
    matchmakingCount: 100,  // matchmaking matches between tournaments
    tournamentSize: 16,
    exhibitionCount: 25,
    startBalance: 400,
    bailout: 100,
    tournamentBase: 1000,
    bots: 60,
    historySize: 40,
    chatHistory: 80,
    botChat: true,
    stages: 6
  };

  // [bets needed, rank name, bailout/tournament bonus]
  const RANKS = [
    [0, 'Rookie', 0], [25, 'Level 1', 25], [50, 'Level 2', 50], [75, 'Level 3', 75], [100, 'Level 4', 100],
    [150, 'Level 5', 125], [250, 'Salty Seasoned', 150], [400, 'Salty Veteran', 175], [550, 'Salty Pro', 200],
    [800, 'Salty Master', 250], [1500, 'Illuminatus', 300], [3000, 'Skull&Bones', 350], [6000, 'Ultra Salty', 400],
    [12000, 'Mega Salty', 450], [25000, 'Giga Salty', 500], [50000, 'Omega Salty', 550]
  ];

  const BOT_NAMES = [
    'SaltLord99', 'xX_AllIn_Xx', 'PotatoProphet', 'BailoutBrian', 'UpsetEnjoyer', 'RedIsDead', 'BlueForever',
    'TierXorBust', 'MugenMaster', 'ComboBreaker', 'ChipDamageChad', 'SaltMiner', 'DegenerateDave', 'OddsOracle',
    'ZoningZach', 'CornerCarry', 'JankEnjoyer', 'FavoritesOnly', 'GigaSalty', 'LuckyLuchador', 'ExhibitionEddie',
    'PotatoTierPete', 'MoneyMatchMo', 'CountRedula', 'BlueberryBets', 'TwoForOne', 'SaltShaker', 'KOkid',
    'RoundThreeRandy', 'ParryPatty', 'WhaleWatcher', 'PennyPincher', 'Illuminatus_Rex', 'DoubleKOdan',
    'HypeTrainHank', 'TurtleTactics', 'RiggedRick', 'BetaBettor', 'SnackTimeSam', 'GrandmaGambler', 'NotAbot',
    'PocketSand', 'ZeroToHero', 'SaltVault', 'TiltedTom', 'FiveDollarFrank', 'BigBailout', 'ClutchCarla',
    'ChokeArtist', 'SilentBettor', 'RedRocket', 'BlueScreen', 'LowTierLarry', 'SweepSweeper', 'SuperMeterSue',
    'ThePayoutKid', 'OneMoreMatch', 'ChatIsRigged', 'MrOddsOn', 'NoScopeNora'
  ];
  const BOT_STYLES = [
    ['favorite', 30], ['stats', 18], ['random', 16], ['upset', 12], ['allin', 10], ['loyal', 8], ['whale', 6]
  ];

  const LINES = {
    open: [
      '{red} easy money', 'who even is {blue}', '{blue} got this', 'red for the upset', 'blue is free salt',
      '{red} in {tier} tier?? lol', 'i have a good feeling about {blue}', 'going all in, wish me luck',
      'this matchup again', '{red} has a nasty super', 'never bet against {blue}', 'coin flip time',
      'my bailout is ready', 'is {red} any good?', 'stats say {blue}', 'SaltyGod pls', 'HYPE',
      '{red} {red} {red}', 'blue blue blue', 'last time {blue} got bodied', 'i trust {red} with my life'
    ],
    locked: [
      'those odds tho', 'look at that pot', 'here we go', 'please {red} please', 'come on blue',
      'upset incoming', 'i regret everything', 'favorite never loses right?', 'LET\'S GO', 'feelsbadman'
    ],
    fight: [
      'GET HIM', 'block you idiot', 'ResidentSleeper', 'this AI is braindead', 'combo!', 'PogChamp',
      'nice super', 'why is it walking backwards', 'OH NO', 'Kreygasm', 'jump in jump in', 'CLOSE',
      'this is fine', 'hes throwing', 'LUL', 'FIGHT FOR ME', 'turtling again', 'zoning simulator'
    ],
    win: [
      'EZ', 'called it', 'PAID', 'money money money', 'never doubted', '{winner} DA GAWD', 'thank you {winner}',
      'salt for everyone else', 'GG', 'stonks', 'I AM RICH'
    ],
    lose: [
      'SALT', 'rigged', 'bailout gang', 'why do i do this', 'nooooo', 'i hate this game', 'unbelievable',
      '{loser} you had ONE job', 'back to $100', 'my money...', 'this is why i drink', 'NotLikeThis'
    ],
    upset: [
      'UPSET!!!', 'THE SALT IS REAL', 'WHAT', 'HOLY', '{winner} DA GAWD', 'nobody saw that coming',
      'the underdog did it', 'SALTY SALTY SALTY'
    ]
  };

  function nice(n) {
    if (n >= 100000) return Math.floor(n / 1000) * 1000;
    if (n >= 10000) return Math.floor(n / 100) * 100;
    if (n >= 1000) return Math.floor(n / 10) * 10;
    return Math.floor(n);
  }

  function money(n) {
    return '$' + Math.floor(n).toLocaleString('en-US');
  }

  function odds(r, b) {
    if (!r || !b) return null;
    const x = r >= b ? r / b : b / r;
    const v = Math.round(x * 10) / 10;
    return r >= b ? [v, 1] : [1, v];
  }

  function rankOf(bets) {
    let i = 0;
    while (i + 1 < RANKS.length && bets >= RANKS[i + 1][0]) i++;
    return i;
  }

  function nameColor(name) {
    return 'hsl(' + (SB.hash('color:' + name) % 360) + ',70%,62%)';
  }

  function defaultToken() {
    let s = '';
    for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  // ------------------------------------------------------------------ League
  function League(opts) {
    opts = opts || {};
    this.cfg = Object.assign({}, DEFAULTS, opts.config || {});
    this.clock = opts.now || function () { return Date.now(); };
    this.storage = opts.storage || null;
    this.makeToken = opts.makeToken || defaultToken;
    this.rng = new SB.RNG(opts.seed || SB.randomSeed());
    this.listeners = [];
    this.roster = SB.Roster.build();
    this.defs = SB.Roster.byId();
    this.match = null;
    this.chatLog = [];
    this.chatSeq = 0;
    this.pendingChat = [];
    this.state = this.freshState();
    let saved = null;
    try { saved = this.storage ? this.storage.load() : null; } catch (e) { saved = null; }
    if (saved) this.restore(saved);
    this.ensureBots();
  }

  League.RANKS = RANKS;
  League.DEFAULTS = DEFAULTS;
  League.odds = odds;
  League.money = money;
  League.rankOf = rankOf;

  const P = League.prototype;

  P.on = function (fn) {
    this.listeners.push(fn);
    const self = this;
    return function () { self.listeners = self.listeners.filter(function (x) { return x !== fn; }); };
  };

  P.emit = function (type, data, to) {
    for (const fn of this.listeners.slice()) {
      try { fn(type, data, to || null); } catch (e) { /* a broken listener must not stop the league */ }
    }
  };

  P.now = function () { return this.clock(); };

  P.freshState = function () {
    const records = {};
    for (const f of this.roster) records[f.id] = this.freshRecord(f);
    return {
      v: 1, matchNo: 0,
      mode: 'matchmaking', remaining: this.cfg.matchmakingCount,
      tournament: null, lastChampion: null,
      records: records, players: {}, history: [], inflight: null
    };
  };

  P.freshRecord = function (f) {
    return { tier: f.tier, w: 0, l: 0, streak: 0, elo: f.elo, recent: [], run: [], last: 0 };
  };

  P.restore = function (saved) {
    if (!saved || saved.v !== 1) return;
    const s = this.state;
    s.matchNo = saved.matchNo || 0;
    if (saved.mode === 'matchmaking' || saved.mode === 'tournament' || saved.mode === 'exhibition') {
      s.mode = saved.mode;
      s.remaining = saved.remaining;
    }
    s.tournament = saved.tournament || null;
    if (s.mode === 'tournament' && !s.tournament) { s.mode = 'matchmaking'; s.remaining = this.cfg.matchmakingCount; }
    s.lastChampion = saved.lastChampion || null;
    for (const id in s.records) if (saved.records && saved.records[id]) Object.assign(s.records[id], saved.records[id]);
    s.players = saved.players || {};
    s.history = saved.history || [];
    // A match was running when we shut down: give everybody their wager back.
    if (saved.inflight && saved.inflight.bets) {
      for (const b of saved.inflight.bets) {
        const p = s.players[b.pid];
        if (!p) continue;
        if (b.t) p.tbalance = (p.tbalance || 0) + b.amount; else p.balance += b.amount;
      }
    }
    s.inflight = null;
  };

  P.serialize = function () {
    const s = this.state;
    return {
      v: 1, matchNo: s.matchNo, mode: s.mode, remaining: s.remaining,
      tournament: s.tournament, lastChampion: s.lastChampion,
      records: s.records, players: s.players, history: s.history, inflight: s.inflight
    };
  };

  P.save = function () {
    if (!this.storage) return;
    try { this.storage.save(this.serialize()); } catch (e) { /* storage full / unavailable */ }
  };

  P.ensureBots = function () {
    const rng = new SB.RNG(SB.hash('bots'));
    for (let i = 0; i < this.cfg.bots; i++) {
      const name = i < BOT_NAMES.length ? BOT_NAMES[i] : 'Bettor' + (1000 + i);
      const style = rng.weighted(BOT_STYLES);
      const balance = Math.round(100 * Math.pow(10, rng.float(0.3, style === 'whale' ? 4.4 : 3.6)));
      const bets = Math.floor(Math.pow(10, rng.float(0.5, 4.2)));
      const loyal = rng.chance(0.5) ? 'red' : 'blue';
      const activity = rng.float(0.45, 0.95);
      const id = 'bot:' + i;
      if (this.state.players[id]) continue;
      this.state.players[id] = {
        id: id, name: name, bot: true, style: style, loyal: loyal, activity: activity,
        balance: balance, tbalance: 0, tbase: 0, bets: bets,
        wins: Math.floor(bets * 0.52), losses: bets - Math.floor(bets * 0.52)
      };
    }
  };

  // ----------------------------------------------------------------- players
  P.bonus = function (p) {
    return RANKS[rankOf(p.bets)][2];
  };

  P.bailoutAmount = function (p) {
    return this.cfg.bailout + this.bonus(p);
  };

  P.findByName = function (name) {
    const n = String(name).toLowerCase();
    for (const id in this.state.players) if (this.state.players[id].name.toLowerCase() === n) return this.state.players[id];
    return null;
  };

  P.addPlayer = function (name, id) {
    name = String(name || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return { ok: false, error: 'Name must be 3-16 letters, numbers or _.' };
    if (this.findByName(name)) return { ok: false, error: 'That name is taken.' };
    const p = {
      id: id || ('p:' + this.makeToken().slice(0, 12)),
      name: name, bot: false, token: this.makeToken(),
      balance: this.cfg.startBalance, tbalance: 0, tbase: 0,
      bets: 0, wins: 0, losses: 0, created: this.now()
    };
    if (this.state.mode === 'tournament') {
      p.tbase = this.cfg.tournamentBase + this.bonus(p);
      p.tbalance = p.tbase;
    }
    this.state.players[p.id] = p;
    this.save();
    return { ok: true, player: p };
  };

  P.renamePlayer = function (pid, name) {
    const p = this.state.players[pid];
    if (!p || p.bot) return { ok: false, error: 'Unknown player.' };
    name = String(name || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return { ok: false, error: 'Name must be 3-16 letters, numbers or _.' };
    const other = this.findByName(name);
    if (other && other !== p) return { ok: false, error: 'That name is taken.' };
    p.name = name;
    this.save();
    this.emit('me', this.publicMe(p), p.id);
    return { ok: true };
  };

  P.playerByToken = function (token) {
    if (!token) return null;
    for (const id in this.state.players) {
      const p = this.state.players[id];
      if (!p.bot && p.token === token) return p;
    }
    return null;
  };

  P.publicMe = function (p, extra) {
    if (!p) return null;
    const r = rankOf(p.bets);
    const m = this.match;
    const bet = m && m.bets[p.id] ? { side: m.bets[p.id].side, amount: m.bets[p.id].amount, matchId: m.id } : null;
    const me = {
      id: p.id, name: p.name, balance: p.balance,
      tbalance: p.tbalance, tbase: p.tbase, tournament: this.state.mode === 'tournament',
      bets: p.bets, wins: p.wins, losses: p.losses,
      rank: r, rankName: RANKS[r][1], nextRank: RANKS[r + 1] ? RANKS[r + 1][0] : null,
      bailout: this.bailoutAmount(p), bet: bet
    };
    if (extra) for (const k in extra) me[k] = extra[k];
    return me;
  };

  // ------------------------------------------------------------------- clock
  P.update = function (now) {
    if (now === undefined) now = this.now();
    for (let guard = 0; guard < 20; guard++) {
      const m = this.match;
      if (!m) { this.openMatch(now); continue; }
      if (m.phase === 'open') {
        this.runBotBets(m, now);
        if (now >= m.closesAt) { this.lockMatch(m, now); continue; }
      } else if (m.phase === 'locked') {
        if (now >= m.payoutAt) { this.payoutMatch(m, now); continue; }
      } else if (m.phase === 'payout') {
        if (now >= m.nextAt) { this.match = null; continue; }
      }
      break;
    }
    this.flushChat(now);
  };

  // ---------------------------------------------------------------- matches
  P.fighterCard = function (id) {
    const d = this.defs[id], r = this.state.records[id];
    return {
      id: id, name: d.name, tier: r.tier, arch: d.arch, special: d.special, superMove: d.superMove,
      stats: d.stats, look: d.look,
      record: { w: r.w, l: r.l, streak: r.streak, elo: Math.round(r.elo), recent: r.recent.slice(-10) }
    };
  };

  P.fightDef = function (id) {
    const d = this.defs[id];
    return {
      id: d.id, name: d.name, tier: this.state.records[id].tier, special: d.special, superMove: d.superMove,
      stats: d.stats, look: d.look
    };
  };

  P.tierPools = function () {
    const pools = {};
    for (const f of this.roster) {
      const t = this.state.records[f.id].tier;
      (pools[t] = pools[t] || []).push(f.id);
    }
    return pools;
  };

  P.pickMatchmaking = function () {
    const rng = this.rng, recs = this.state.records;
    const pools = this.tierPools();
    const entries = [];
    for (const t in pools) if (pools[t].length >= 2) entries.push([t, pools[t].length]);
    const tier = rng.weighted(entries);
    // prefer the characters that have waited the longest
    const pool = rng.shuffle(pools[tier].slice()).sort(function (a, b) { return recs[a].last - recs[b].last; });
    const cands = pool.slice(0, Math.min(pool.length, 5));
    const red = cands.splice(rng.int(0, cands.length - 1), 1)[0];
    const blue = cands.splice(rng.int(0, cands.length - 1), 1)[0];
    return rng.chance(0.5) ? [red, blue] : [blue, red];
  };

  P.statusInfo = function () {
    const s = this.state;
    let text;
    if (s.mode === 'tournament') {
      const t = s.tournament;
      const left = t.current.length - t.idx * 2 + t.next.length;
      text = t.current.length === 2 ? 'FINAL ROUND! Stay tuned for exhibitions after the tournament!'
        : left + ' characters are left in the bracket!';
      return { mode: s.mode, text: text, tier: t.tier, left: left, round: t.round };
    }
    if (s.mode === 'exhibition') {
      text = s.remaining === 1 ? 'Matchmaking mode will be activated after the next exhibition match!'
        : s.remaining + ' exhibition matches left!';
      return { mode: s.mode, text: text, remaining: s.remaining };
    }
    text = s.remaining === 1 ? 'Tournament mode will be activated after the next match!'
      : s.remaining + ' more matches until the next tournament!';
    return { mode: s.mode, text: text, remaining: s.remaining };
  };

  P.openMatch = function (now) {
    const s = this.state, cfg = this.cfg, rng = this.rng;
    // Bailouts
    for (const id in s.players) {
      const p = s.players[id];
      const b = this.bailoutAmount(p);
      if (p.balance < b) {
        p.balance = b;
        if (!p.bot) this.emit('notice', { kind: 'bailout', text: 'You have been bailed out! Your balance is now ' + money(b) + '.' }, p.id);
      }
      if (s.mode === 'tournament' && p.tbalance < p.tbase) p.tbalance = p.tbase;
    }

    let red, blue;
    const info = {};
    if (s.mode === 'tournament') {
      const t = s.tournament;
      red = t.current[t.idx * 2];
      blue = t.current[t.idx * 2 + 1];
      info.tier = t.tier;
      info.round = t.current.length === 2 ? 'Final' : t.current.length === 4 ? 'Semifinal' : t.current.length === 8 ? 'Quarterfinal' : 'Round of ' + t.current.length;
    } else if (s.mode === 'exhibition') {
      const ids = rng.shuffle(this.roster.map(function (f) { return f.id; }));
      red = ids[0]; blue = ids[1];
      const bots = Object.keys(s.players).filter(function (id) { return s.players[id].bot; });
      info.requestedBy = bots.length ? s.players[rng.pick(bots)].name : 'the crowd';
    } else {
      const pair = this.pickMatchmaking();
      red = pair[0]; blue = pair[1];
      info.tier = s.records[red].tier;
    }
    s.records[red].last = s.matchNo + 1;
    s.records[blue].last = s.matchNo + 1;

    const m = {
      id: ++s.matchNo, mode: s.mode, red: red, blue: blue, info: info,
      phase: 'open', stage: rng.int(0, cfg.stages - 1),
      openedAt: now, closesAt: now + cfg.betOpenMs,
      bets: {}, betOrder: [], pots: { red: 0, blue: 0 }, botPlan: []
    };
    this.match = m;

    for (const id in s.players) {
      const p = s.players[id];
      if (!p.bot || !rng.chance(p.activity)) continue;
      m.botPlan.push({ at: now + cfg.betOpenMs * rng.float(0.04, 0.93), pid: id });
    }
    m.botPlan.sort(function (a, b) { return a.at - b.at; });

    const tierTxt = info.tier ? '(' + info.tier + ' Tier) ' : '';
    const modeTxt = s.mode === 'tournament' ? '(tournament' + (info.round ? ' ' + info.round.toLowerCase() : '') + ')' : '(' + s.mode + ')';
    this.system('Bets are OPEN for ' + this.defs[red].name + ' vs ' + this.defs[blue].name + '! ' + tierTxt + modeTxt, now);
    this.scheduleBotChat('open', now + 1500, now + cfg.betOpenMs - 1500, rng.int(2, 4), m);
    this.emit('match', this.publicMatch(m));
  };

  P.lockMatch = function (m, now) {
    const cfg = this.cfg;
    m.phase = 'locked';
    m.lockedAt = now;
    m.botPlan = [];
    m.fight = {
      seed: this.rng.int(1, 2147483646),
      red: this.fightDef(m.red),
      blue: this.fightDef(m.blue),
      stage: m.stage,
      tps: cfg.tps
    };
    m.result = SB.Fight.simulate(m.fight);
    m.startAt = now + cfg.preFightMs;
    m.payoutAt = m.startAt + Math.ceil(m.result.decidedTick * 1000 / cfg.tps) + 300;
    m.endAt = m.startAt + Math.ceil(m.result.ticks * 1000 / cfg.tps);
    m.nextAt = m.endAt + cfg.postFightMs;
    this.state.inflight = { match: m.id, bets: m.betOrder.map(function (pid) { return { pid: pid, amount: m.bets[pid].amount, t: m.bets[pid].t }; }) };
    this.save();

    const o = odds(m.pots.red, m.pots.blue);
    this.system('Bets are locked. ' + this.defs[m.red].name + ' (' + (o ? o[0] : '-') + ') - ' + money(m.pots.red) + ', ' +
      this.defs[m.blue].name + ' (' + (o ? o[1] : '-') + ') - ' + money(m.pots.blue), now);
    this.scheduleBotChat('locked', now + 500, now + cfg.preFightMs + 2000, this.rng.int(1, 3), m);
    this.scheduleBotChat('fight', m.startAt + 4000, m.payoutAt - 1500, this.rng.int(2, 5), m);
    this.emit('match', this.publicMatch(m));
  };

  P.payoutMatch = function (m, now) {
    const s = this.state;
    const w = m.result.winner, l = w === 'red' ? 'blue' : 'red';
    const W = m.pots[w], L = m.pots[l];
    const winners = [];
    for (const pid of m.betOrder) {
      const b = m.bets[pid], p = s.players[pid];
      if (!p) continue;
      p.bets++;
      if (b.side === w) {
        const gain = W > 0 ? Math.ceil(b.amount * L / W) : 0;
        if (b.t) p.tbalance += b.amount + gain; else p.balance += b.amount + gain;
        p.wins++;
        b.gain = gain;
        winners.push({ name: p.name, gain: gain, bot: !!p.bot });
      } else {
        p.losses++;
        b.gain = -b.amount;
      }
    }
    m.upset = W > 0 && L >= W * 2;
    m.phase = 'payout';
    m.winner = w;
    m.paidAt = now;
    winners.sort(function (a, b) { return b.gain - a.gain; });
    m.topWinners = winners.slice(0, 8);

    this.updateRecords(m, w, now);

    const o = odds(m.pots.red, m.pots.blue);
    s.history.push({
      id: m.id, mode: m.mode, red: m.red, blue: m.blue, winner: w,
      redName: this.defs[m.red].name, blueName: this.defs[m.blue].name,
      pots: { red: m.pots.red, blue: m.pots.blue }, odds: o, upset: m.upset, t: now
    });
    if (s.history.length > this.cfg.historySize) s.history.splice(0, s.history.length - this.cfg.historySize);

    this.system(this.defs[m[w]].name + ' wins! Payouts to Team ' + (w === 'red' ? 'Red' : 'Blue') + '.', now);
    this.advanceMode(m, w, now);
    s.inflight = null;
    this.save();

    for (const pid of m.betOrder) {
      const p = s.players[pid];
      if (!p || p.bot) continue;
      const b = m.bets[pid];
      this.emit('me', this.publicMe(p, { result: { matchId: m.id, won: b.side === w, gain: b.gain, side: b.side } }), pid);
    }

    const bw = this.rng.int(2, 3), bl = this.rng.int(2, 3);
    this.scheduleBotChat('win', now + 400, now + 5000, bw, m);
    this.scheduleBotChat(m.upset ? 'upset' : 'lose', now + 400, now + 5500, m.upset ? bl + 2 : bl, m);
    this.emit('match', this.publicMatch(m));
  };

  P.updateRecords = function (m, w, now) {
    const s = this.state;
    const rw = s.records[m[w]], rl = s.records[m[w === 'red' ? 'blue' : 'red']];
    const ew = 1 / (1 + Math.pow(10, (rl.elo - rw.elo) / 400));
    const k = 32;
    rw.elo += k * (1 - ew);
    rl.elo -= k * (1 - ew);
    rw.w++; rl.l++;
    rw.streak = rw.streak > 0 ? rw.streak + 1 : 1;
    rl.streak = rl.streak < 0 ? rl.streak - 1 : -1;
    rw.recent.push('W'); rl.recent.push('L');
    if (rw.recent.length > 10) rw.recent.shift();
    if (rl.recent.length > 10) rl.recent.shift();
    if (m.mode !== 'matchmaking') return;
    // Tier promotion / demotion based on the last 10 matchmaking results
    const order = SB.Roster.TIERS;
    const self = this;
    [[m[w], true], [m[w === 'red' ? 'blue' : 'red'], false]].forEach(function (e) {
      const r = s.records[e[0]];
      r.run.push(e[1] ? 1 : 0);
      if (r.run.length > 10) r.run.shift();
      if (r.run.length < 10) return;
      const wins = r.run.reduce(function (a, b) { return a + b; }, 0);
      const idx = order.indexOf(r.tier);
      let to = null;
      if (wins >= 8 && idx > 0) to = order[idx - 1];
      if (wins <= 2 && idx < order.length - 1) to = order[idx + 1];
      if (to) {
        const up = order.indexOf(to) < idx;
        r.tier = to;
        r.run = [];
        self.system(self.defs[e[0]].name + ' has been ' + (up ? 'promoted' : 'demoted') + ' to ' + to + ' tier!', now);
      }
    });
  };

  P.advanceMode = function (m, w, now) {
    const s = this.state, cfg = this.cfg;
    if (s.mode === 'tournament') {
      const t = s.tournament;
      t.next.push(m[w]);
      t.idx++;
      if (t.idx * 2 >= t.current.length) {
        if (t.next.length === 1) { this.endTournament(t.next[0], now); return; }
        t.current = t.next;
        t.next = [];
        t.idx = 0;
        t.round++;
      }
      return;
    }
    s.remaining--;
    if (s.remaining > 0) return;
    if (s.mode === 'matchmaking') this.startTournament(now);
    else {
      s.mode = 'matchmaking';
      s.remaining = cfg.matchmakingCount;
      this.system('Matchmaking mode has been activated!', now);
    }
  };

  P.startTournament = function (now) {
    const s = this.state, cfg = this.cfg, rng = this.rng;
    const size = cfg.tournamentSize;
    const pools = this.tierPools();
    const ok = SB.Roster.TIERS.filter(function (t) { return pools[t] && pools[t].length >= size; });
    let tier, entrants;
    if (ok.length) {
      tier = rng.pick(ok);
      entrants = rng.shuffle(pools[tier].slice()).slice(0, size);
    } else {
      // not enough characters in one tier: take the biggest tier and fill up with the closest ratings
      tier = SB.Roster.TIERS.slice().sort(function (a, b) { return (pools[b] || []).length - (pools[a] || []).length; })[0];
      const base = pools[tier].slice();
      const avg = base.reduce(function (sum, id) { return sum + s.records[id].elo; }, 0) / base.length;
      const rest = this.roster.map(function (f) { return f.id; }).filter(function (id) { return base.indexOf(id) < 0; })
        .sort(function (a, b) { return Math.abs(s.records[a].elo - avg) - Math.abs(s.records[b].elo - avg); });
      entrants = rng.shuffle(base.concat(rest.slice(0, size - base.length)));
    }
    s.tournament = { tier: tier, round: 1, current: entrants, next: [], idx: 0 };
    s.mode = 'tournament';
    s.remaining = size;
    for (const id in s.players) {
      const p = s.players[id];
      p.tbase = cfg.tournamentBase + this.bonus(p);
      p.tbalance = p.tbase;
      if (!p.bot) this.emit('me', this.publicMe(p), p.id);
    }
    this.system('Tournament mode has been activated! ' + size + ' ' + tier + ' tier characters enter the bracket. Everyone gets a tournament balance!', now);
  };

  P.endTournament = function (champion, now) {
    const s = this.state, cfg = this.cfg;
    const tier = s.tournament.tier;
    for (const id in s.players) {
      const p = s.players[id];
      const gain = Math.max(0, (p.tbalance || 0) - (p.tbase || 0));
      p.balance += gain;
      p.tbalance = 0;
      p.tbase = 0;
      if (!p.bot) {
        this.emit('notice', { kind: 'tournament', text: gain > 0 ? 'Tournament over! ' + money(gain) + ' in winnings was added to your balance.' : 'Tournament over! No tournament winnings this time.' }, p.id);
        this.emit('me', this.publicMe(p), p.id);
      }
    }
    s.lastChampion = { id: champion, name: this.defs[champion].name, tier: tier, t: now };
    this.system(this.defs[champion].name + ' is the tournament champion! Exhibition matches are next.', now);
    s.tournament = null;
    s.mode = 'exhibition';
    s.remaining = cfg.exhibitionCount;
  };

  // --------------------------------------------------------------- betting
  P.placeBet = function (pid, side, amount) {
    const m = this.match, p = this.state.players[pid];
    if (!p) return { ok: false, error: 'Unknown player.' };
    if (!m || m.phase !== 'open') return { ok: false, error: 'Bets are locked until the next match.' };
    if (m.bets[pid]) return { ok: false, error: 'You already bet on this match.' };
    if (side !== 'red' && side !== 'blue') return { ok: false, error: 'Pick red or blue.' };
    amount = Math.floor(Number(amount));
    if (!isFinite(amount) || amount < 1) return { ok: false, error: 'Enter a wager of at least $1.' };
    const t = m.mode === 'tournament';
    const bal = t ? p.tbalance : p.balance;
    if (amount > bal) return { ok: false, error: 'You only have ' + money(bal) + '.' };
    if (t) p.tbalance -= amount; else p.balance -= amount;
    m.bets[pid] = { side: side, amount: amount, t: t, at: this.now() };
    m.betOrder.push(pid);
    m.pots[side] += amount;
    this.emit('betcount', { matchId: m.id, count: m.betOrder.length });
    if (!p.bot) {
      this.state.inflight = { match: m.id, bets: m.betOrder.map(function (id) { return { pid: id, amount: m.bets[id].amount, t: m.bets[id].t }; }) };
      this.save();
      this.emit('me', this.publicMe(p), pid);
    }
    return { ok: true };
  };

  P.runBotBets = function (m, now) {
    while (m.botPlan.length && m.botPlan[0].at <= now) {
      const e = m.botPlan.shift();
      this.botBet(m, this.state.players[e.pid]);
    }
  };

  P.botBet = function (m, p) {
    if (!p || m.bets[p.id]) return;
    const rng = this.rng, recs = this.state.records;
    const rr = recs[m.red], rb = recs[m.blue];
    const pRed = 1 / (1 + Math.pow(10, (rb.elo - rr.elo) / 400)) + rng.float(-0.12, 0.12);
    const fav = pRed >= 0.5 ? 'red' : 'blue';
    const t = m.mode === 'tournament';
    const bal = t ? p.tbalance : p.balance;
    if (bal < 1) return;
    let side, frac;
    switch (p.style) {
      case 'favorite': side = fav; frac = rng.float(0.05, 0.25); break;
      case 'upset': side = fav === 'red' ? 'blue' : 'red'; frac = rng.float(0.02, 0.12); break;
      case 'allin': side = rng.chance(pRed) ? 'red' : 'blue'; frac = 1; break;
      case 'stats': {
        const conf = Math.min(1, Math.abs(pRed - 0.5) * 2);
        side = fav; frac = 0.04 + conf * 0.5; break;
      }
      case 'loyal': side = p.loyal; frac = rng.float(0.05, 0.2); break;
      case 'whale': side = fav; frac = rng.float(0.02, 0.08); break;
      default: side = rng.chance(0.5) ? 'red' : 'blue'; frac = rng.float(0.03, 0.4);
    }
    if (t && (p.style === 'allin' || rng.chance(0.5))) frac = 1;
    if (bal <= this.bailoutAmount(p) && rng.chance(0.6)) frac = 1; // bailout money goes all in
    const amount = Math.max(1, Math.min(bal, nice(bal * frac)));
    this.placeBet(p.id, side, amount);
  };

  // ------------------------------------------------------------------- chat
  P.pushChat = function (msg) {
    msg.id = ++this.chatSeq;
    this.chatLog.push(msg);
    if (this.chatLog.length > this.cfg.chatHistory) this.chatLog.shift();
    this.emit('chat', msg);
  };

  P.system = function (text, now) {
    this.pushChat({ t: now || this.now(), kind: 'system', name: 'SaltyBot', text: text, color: '#ffd23f' });
  };

  P.chat = function (pid, text) {
    const p = this.state.players[pid];
    if (!p) return { ok: false, error: 'Unknown player.' };
    text = String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    if (!text) return { ok: false, error: 'Empty message.' };
    const now = this.now();
    if (p.lastChat && now - p.lastChat < 1000) return { ok: false, error: 'Slow down!' };
    p.lastChat = now;
    const r = rankOf(p.bets);
    this.pushChat({ t: now, kind: 'user', name: p.name, text: text, rank: r, color: nameColor(p.name) });
    return { ok: true };
  };

  P.scheduleBotChat = function (kind, from, to, count, m) {
    if (!this.cfg.botChat) return;
    const s = this.state, rng = this.rng;
    const bots = Object.keys(s.players).filter(function (id) { return s.players[id].bot; });
    if (!bots.length || to <= from) return;
    const w = m.winner || null;
    const winnerName = w ? this.defs[m[w]].name : '';
    const loserName = w ? this.defs[m[w === 'red' ? 'blue' : 'red']].name : '';
    for (let i = 0; i < count; i++) {
      let pid = rng.pick(bots);
      if (m.phase === 'payout' && (kind === 'win' || kind === 'lose')) {
        // winners brag, losers complain
        const want = kind === 'win' ? w : (w === 'red' ? 'blue' : 'red');
        const pool = m.betOrder.filter(function (id) { return s.players[id].bot && m.bets[id].side === want; });
        if (pool.length) pid = rng.pick(pool);
      }
      const text = rng.pick(LINES[kind])
        .replace(/\{red\}/g, this.defs[m.red].name).replace(/\{blue\}/g, this.defs[m.blue].name)
        .replace(/\{tier\}/g, this.state.records[m.red].tier)
        .replace(/\{winner\}/g, winnerName).replace(/\{loser\}/g, loserName);
      this.pendingChat.push({ at: rng.float(from, to), pid: pid, text: text });
    }
    this.pendingChat.sort(function (a, b) { return a.at - b.at; });
  };

  P.flushChat = function (now) {
    while (this.pendingChat.length && this.pendingChat[0].at <= now) {
      const c = this.pendingChat.shift();
      const p = this.state.players[c.pid];
      if (!p) continue;
      this.pushChat({ t: now, kind: 'bot', name: p.name, text: c.text, rank: rankOf(p.bets), color: nameColor(p.name) });
    }
  };

  // ---------------------------------------------------------------- queries
  P.publicMatch = function (m) {
    if (!m) return null;
    const out = {
      id: m.id, mode: m.mode, phase: m.phase, stage: m.stage, info: m.info,
      openedAt: m.openedAt, closesAt: m.closesAt, startAt: m.startAt || null, payoutAt: m.payoutAt || null,
      endAt: m.endAt || null, nextAt: m.nextAt || null,
      red: this.fighterCard(m.red), blue: this.fighterCard(m.blue),
      bettors: m.betOrder.length,
      status: this.statusInfo()
    };
    if (m.phase !== 'open') {
      const s = this.state;
      out.pots = { red: m.pots.red, blue: m.pots.blue };
      out.odds = odds(m.pots.red, m.pots.blue);
      out.fight = m.fight;
      const list = m.betOrder.map(function (pid) {
        const p = s.players[pid], b = m.bets[pid];
        return { name: p.name, side: b.side, amount: b.amount, bot: !!p.bot, rank: rankOf(p.bets), gain: b.gain };
      }).sort(function (a, b) { return b.amount - a.amount; });
      out.bettorList = { red: list.filter(function (x) { return x.side === 'red'; }).slice(0, 60), blue: list.filter(function (x) { return x.side === 'blue'; }).slice(0, 60) };
    }
    if (m.phase === 'payout') {
      out.winner = m.winner;
      out.upset = m.upset;
      out.topWinners = m.topWinners;
    }
    return out;
  };

  P.historyList = function (n) {
    return this.state.history.slice(-(n || 15));
  };

  P.snapshot = function (pid) {
    const p = pid ? this.state.players[pid] : null;
    return {
      now: this.now(),
      cfg: { betOpenMs: this.cfg.betOpenMs, tps: this.cfg.tps, startBalance: this.cfg.startBalance, bailout: this.cfg.bailout, tournamentBase: this.cfg.tournamentBase },
      match: this.publicMatch(this.match),
      status: this.statusInfo(),
      history: this.historyList(15),
      chat: this.chatLog.slice(-50),
      me: this.publicMe(p),
      champion: this.state.lastChampion,
      ranks: RANKS
    };
  };

  P.leaderboard = function (pid) {
    const all = [];
    for (const id in this.state.players) {
      const p = this.state.players[id];
      all.push({ id: id, name: p.name, balance: p.balance, bot: !!p.bot, rank: rankOf(p.bets), rankName: RANKS[rankOf(p.bets)][1], wins: p.wins, losses: p.losses });
    }
    all.sort(function (a, b) { return b.balance - a.balance; });
    let mine = null;
    for (let i = 0; i < all.length; i++) if (all[i].id === pid) { mine = { place: i + 1, entry: all[i] }; break; }
    return { top: all.slice(0, 50).map(function (e, i) { return Object.assign({ place: i + 1 }, e, { id: undefined }); }), me: mine ? { place: mine.place, entry: Object.assign({}, mine.entry, { id: undefined }) } : null, total: all.length };
  };

  P.fighterList = function () {
    const self = this;
    return this.roster.map(function (f) { return self.fighterCard(f.id); });
  };

  SB.League = League;
})(globalThis.SB = globalThis.SB || {});
