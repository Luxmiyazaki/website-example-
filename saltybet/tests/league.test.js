const test = require('node:test');
const assert = require('node:assert');
const SB = require('./helpers');

function makeLeague(config, storage) {
  let now = 1000000;
  const league = new SB.League({
    seed: 99,
    now: () => now,
    storage: storage || null,
    config: Object.assign({ betOpenMs: 10000, bots: 25, matchmakingCount: 3, exhibitionCount: 2 }, config || {})
  });
  const events = [];
  league.on((type, data, to) => events.push({ type, data, to }));
  return {
    league, events,
    advance(ms, stepMs = 250) { const end = now + ms; while (now < end) { now += stepMs; league.update(now); } },
    get now() { return now; }
  };
}

function runUntil(ctx, pred, maxMs = 3 * 3600 * 1000) {
  let waited = 0;
  while (!pred() && waited < maxMs) { ctx.advance(1000, 500); waited += 1000; }
  assert.ok(pred(), 'condition not reached in time');
}

test('payout: winners get their wager back plus their share of the losing pot', () => {
  const ctx = makeLeague({ bots: 0 });
  const L = ctx.league;
  const a = L.addPlayer('alice').player, b = L.addPlayer('bob').player, c = L.addPlayer('carol').player;
  ctx.advance(250);
  const m = L.match;
  assert.equal(m.phase, 'open');
  assert.ok(L.placeBet(a.id, 'red', 100).ok);
  assert.ok(L.placeBet(b.id, 'red', 300).ok);
  assert.ok(L.placeBet(c.id, 'blue', 200).ok);
  assert.equal(L.placeBet(a.id, 'blue', 10).ok, false, 'only one bet per match');
  assert.equal(L.placeBet(c.id, 'blue', 99999).ok, false, 'cannot bet more than balance');
  assert.equal(a.balance, 300);
  ctx.advance(10000);
  assert.equal(m.phase, 'locked');
  assert.equal(L.placeBet(c.id, 'red', 1).ok, false, 'no bets after lock');
  assert.deepEqual(m.pots, { red: 400, blue: 200 });
  runUntil(ctx, () => m.phase === 'payout');
  if (m.winner === 'red') {
    assert.equal(a.balance, 300 + 100 + 50);   // 100 * 200/400
    assert.equal(b.balance, 100 + 300 + 150);
    assert.equal(c.balance, 200);
  } else {
    assert.equal(a.balance, 300);
    assert.equal(b.balance, 100);
    assert.equal(c.balance, 200 + 200 + 400); // 200 * 400/200
  }
  assert.equal(a.bets, 1);
});

test('full cycle: matchmaking -> tournament -> exhibitions -> matchmaking', () => {
  const ctx = makeLeague();
  const L = ctx.league;
  const me = L.addPlayer('tester').player;
  const modes = [];
  L.on((type, data) => { if (type === 'match' && data.phase === 'open') modes.push(data.mode); });
  let champion = null;
  L.on((type, data) => { if (type === 'chat' && /tournament champion/.test(data.text)) champion = data.text; });
  // bet every match to exercise tournament balances
  L.on((type, data) => {
    if (type === 'match' && data.phase === 'open') {
      const r = L.placeBet(me.id, 'red', data.mode === 'tournament' ? me.tbalance : Math.max(1, Math.floor(me.balance / 4)));
      assert.ok(r.ok, r.error);
    }
  });
  runUntil(ctx, () => modes.length >= 3 + 15 + 2 + 1);
  assert.deepEqual(modes.slice(0, 21), [
    'matchmaking', 'matchmaking', 'matchmaking',
    ...Array(15).fill('tournament'),
    'exhibition', 'exhibition', 'matchmaking'
  ]);
  assert.ok(champion, 'a champion was announced');
  assert.equal(me.tbalance, 0);
  for (const id in L.state.players) {
    const p = L.state.players[id];
    assert.ok(Number.isFinite(p.balance) && p.balance >= 0, p.name + ' balance ' + p.balance);
  }
  const total = Object.values(L.state.records).reduce((s, r) => s + r.w + r.l, 0);
  assert.equal(total, 2 * 20);
});

test('bailout: broke players are topped up at the next match', () => {
  const ctx = makeLeague({ bots: 0 });
  const L = ctx.league;
  const p = L.addPlayer('brokeguy').player;
  ctx.advance(250);
  L.placeBet(p.id, 'red', 400);
  L.addPlayer('other');
  const o = L.findByName('other');
  L.placeBet(o.id, 'blue', 400);
  const m = L.match;
  runUntil(ctx, () => L.match && L.match !== m && L.match.phase === 'open');
  const loser = m.winner === 'red' ? o : p;
  assert.equal(loser.balance, 100, 'bailout to $100');
});

test('restart refunds bets of an unfinished match', () => {
  let saved = null;
  const storage = { load: () => saved, save: (s) => { saved = JSON.parse(JSON.stringify(s)); } };
  const ctx = makeLeague({ bots: 5 }, storage);
  const p = ctx.league.addPlayer('refundme').player;
  ctx.advance(250);
  ctx.league.placeBet(p.id, 'blue', 250);
  assert.equal(p.balance, 150);
  const ctx2 = makeLeague({ bots: 5 }, storage);
  assert.equal(ctx2.league.state.players[p.id].balance, 400);
});

test('snapshot hides the fight until bets are locked', () => {
  const ctx = makeLeague();
  ctx.advance(250);
  const snap = ctx.league.snapshot();
  assert.equal(snap.match.phase, 'open');
  assert.equal(snap.match.fight, undefined);
  assert.equal(snap.match.pots, undefined);
  ctx.advance(10000);
  const locked = ctx.league.snapshot();
  assert.equal(locked.match.phase, 'locked');
  assert.ok(locked.match.fight.seed);
  assert.equal(locked.match.winner, undefined);
  // the browser can replay the fight and gets the same winner the league will pay out
  const replay = SB.Fight.simulate(locked.match.fight);
  runUntil(ctx, () => ctx.league.match.phase === 'payout');
  assert.equal(ctx.league.match.winner, replay.winner);
});
