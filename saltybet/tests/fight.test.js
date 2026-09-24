const test = require('node:test');
const assert = require('node:assert');
const SB = require('./helpers');

const roster = SB.Roster.build();

test('roster has enough characters for a 16 man bracket in every normal tier', () => {
  const count = {};
  for (const f of roster) count[f.tier] = (count[f.tier] || 0) + 1;
  for (const t of ['S', 'A', 'B', 'P']) assert.ok(count[t] >= 16, t + ' tier has ' + count[t]);
  assert.equal(new Set(roster.map((f) => f.id)).size, roster.length, 'ids are unique');
});

test('fights are deterministic', () => {
  for (let i = 0; i < 20; i++) {
    const desc = { seed: 1000 + i, red: roster[i], blue: roster[roster.length - 1 - i] };
    const a = SB.Fight.simulate(desc), b = SB.Fight.simulate(JSON.parse(JSON.stringify(desc)));
    assert.deepEqual(a, b);
  }
});

test('stepping tick by tick matches the instant simulation', () => {
  const desc = { seed: 777, red: roster[10], blue: roster[20] };
  const res = SB.Fight.simulate(desc);
  const sim = SB.Fight.create(desc);
  let decided = -1;
  while (sim.phase !== 'done') {
    SB.Fight.step(sim);
    if (decided < 0 && sim.winner) decided = sim.tick;
  }
  assert.equal(sim.winner, res.winner);
  assert.equal(sim.tick, res.ticks);
  assert.equal(decided, res.decidedTick);
});

test('every fight ends with a winner in a sane amount of time', () => {
  const rng = new SB.RNG(4242);
  for (let i = 0; i < 300; i++) {
    const a = rng.pick(roster), b = rng.pick(roster);
    const r = SB.Fight.simulate({ seed: rng.int(1, 2e9), red: a, blue: b });
    assert.ok(r.winner === 'red' || r.winner === 'blue');
    assert.ok(r.decidedTick > 0 && r.decidedTick < r.ticks);
    assert.ok(r.ticks < 60 * 60 * 6, 'fight too long: ' + r.ticks);
    assert.ok(r.redRounds === 2 || r.blueRounds === 2 || r.rounds.length === 5);
  }
});

test('higher tiers beat lower tiers most of the time', () => {
  const rng = new SB.RNG(1);
  const tier = (t) => roster.filter((f) => f.tier === t);
  let wins = 0;
  const n = 120;
  for (let i = 0; i < n; i++) {
    const r = SB.Fight.simulate({ seed: rng.int(1, 2e9), red: rng.pick(tier('S')), blue: rng.pick(tier('P')) });
    if (r.winner === 'red') wins++;
  }
  assert.ok(wins / n > 0.75, 'S beat P only ' + wins + '/' + n);
});
