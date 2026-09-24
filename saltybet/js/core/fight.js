/* Salty Brawl – deterministic fighting game simulation.
 *
 * The same seed + fighters always produce the exact same fight, tick for
 * tick, on every machine. The server (or the solo-mode league) simulates the
 * whole fight instantly to know the winner; browsers replay it in real time.
 * Only + - * / Math.floor/round/abs/min/max/sqrt are used here, which are
 * exactly specified by IEEE-754, so results never drift between engines. */
(function (SB) {
  'use strict';

  const TPS = 60;
  const STAGE_W = 1400;
  const VIEW_W = 960;
  const WALL = 24;
  const MAX_SEP = 820;
  const ROUND_TIME = 60;
  const ROUNDS_TO_WIN = 2;
  const MAX_ROUNDS = 5;
  const GRAVITY = 0.62;
  const METER_MAX = 1000;
  const MAX_TICKS = 40000;
  const DMG = 1.5; // global damage multiplier (tunes the average match length)
  const T = { INTRO: 110, FIGHT_AT: 64, KO: 150, SLOWMO: 75, TIMEOVER: 130, ROUNDOVER: 80, MATCHOVER: 220 };

  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function buildMoves(st, special, superMove) {
    const r = st.reach * st.size;
    const moves = {
      jab: { key: 'jab', kind: 'melee', startup: 4, active: 3, recovery: 8, dmg: 26, reach: 50 * r, lo: 0.55, hi: 0.86, hitstun: 15, blockstun: 9, push: 4.5, cancel: ['kick', 'heavy', 'special'] },
      kick: { key: 'kick', kind: 'melee', startup: 7, active: 4, recovery: 13, dmg: 44, reach: 70 * r, lo: 0.3, hi: 0.68, hitstun: 18, blockstun: 11, push: 6, cancel: ['heavy', 'special'] },
      heavy: { key: 'heavy', kind: 'melee', startup: 11, active: 5, recovery: 20, dmg: 70, reach: 78 * r, lo: 0.48, hi: 0.95, hitstun: 22, blockstun: 14, push: 8.5, cancel: ['special', 'super'] },
      sweep: { key: 'sweep', kind: 'melee', startup: 8, active: 5, recovery: 21, dmg: 44, reach: 82 * r, lo: 0, hi: 0.26, trip: true, blockstun: 12, push: 4 },
      air: { key: 'air', kind: 'melee', air: true, startup: 4, active: 12, recovery: 3, dmg: 46, reach: 46 * r, lo: -0.15, hi: 0.45, hitstun: 17, blockstun: 10, push: 5 }
    };
    const sp = {
      fireball: { kind: 'proj', startup: 13, active: 2, recovery: 24, dmg: 60, speed: 6.5 + st.spd * 0.6, pw: 36, ph: 30, py: 0.62, hitstun: 20, blockstun: 14, push: 7 },
      dash: { kind: 'dash', startup: 8, active: 16, recovery: 18, dmg: 66, reach: 36 * r, vx: 10 + st.spd, lo: 0.25, hi: 0.9, launch: true, blockstun: 15, push: 9 },
      uppercut: { kind: 'uppercut', startup: 3, active: 16, recovery: 18, dmg: 84, reach: 40 * r, vx: 2.5, vy: 14, lo: 0.3, hi: 1.35, launch: true, invuln: 10, blockstun: 14, push: 5 },
      spin: { kind: 'spin', startup: 6, active: 40, recovery: 16, dmg: 19, reach: 46 * r, back: 30, vx: 3.4, lo: 0.15, hi: 0.9, interval: 8, hitstun: 13, blockstun: 8, push: 2.5 },
      teleport: { kind: 'teleport', startup: 18, active: 5, recovery: 15, dmg: 62, reach: 58 * r, lo: 0.35, hi: 0.9, hitstun: 22, blockstun: 13, push: 7, invuln: 18 },
      beam: { kind: 'beam', startup: 20, active: 30, recovery: 22, dmg: 14, reach: 540, lo: 0.52, hi: 0.74, interval: 6, hitstun: 12, blockstun: 8, push: 1.5 }
    }[special];
    sp.key = 'special';
    sp.type = special;
    const su = {
      mega: { kind: 'proj', startup: 34, active: 2, recovery: 28, dmg: 220, speed: 8.5, pw: 96, ph: 96, py: 0.55, hitstun: 30, launch: true, blockstun: 24, push: 10, invuln: 36 },
      rush: { kind: 'rush', startup: 22, active: 44, recovery: 24, dmg: 28, reach: 44 * r, vx: 14, lo: 0.2, hi: 0.95, interval: 5, maxHits: 8, hitstun: 14, blockstun: 10, push: 1, invuln: 22 },
      hyper: { kind: 'beam', startup: 32, active: 60, recovery: 28, dmg: 19, reach: 1000, lo: 0.34, hi: 0.86, interval: 5, hitstun: 12, blockstun: 8, push: 1.2, invuln: 32 }
    }[superMove];
    su.key = 'super';
    su.type = superMove;
    su.super = true;
    moves.special = sp;
    moves.super = su;
    return moves;
  }

  function makeFighter(def, side) {
    const st = def.stats;
    return {
      side: side,
      id: def.id,
      name: def.name,
      st: st,
      moves: buildMoves(st, def.special, def.superMove),
      w: 50 * st.size,
      h: 130 * st.size,
      maxHp: st.hp,
      hp: st.hp,
      meter: 0,
      x: 0, y: 0, vx: 0, vy: 0, face: 1,
      state: 'idle', t: 0, move: null, mv: null,
      hits: 0, lastHitT: -99, hitConfirmed: false,
      stun: 0, invuln: 0, landT: 4, combo: 0, comboDmg: 0, walkDir: 0,
      roundWins: 0, dmgDealt: 0,
      ai: { wait: 0, threat: false, blockAt: -1, chain: null, airDone: false }
    };
  }

  function create(desc) {
    const sim = {
      desc: desc,
      tick: 0,
      rng: new SB.RNG(desc.seed),
      f: [makeFighter(desc.red, 'red'), makeFighter(desc.blue, 'blue')],
      projectiles: [],
      events: [],
      phase: 'intro', pt: 0,
      round: 1,
      timer: ROUND_TIME, timerTicks: 0,
      hitstop: 0,
      live: false,
      roundWinner: null, roundKind: null,
      winner: null, decidedTick: -1,
      roundLog: [],
      nextId: 1
    };
    resetRound(sim);
    return sim;
  }

  function resetRound(sim) {
    const mid = STAGE_W / 2;
    const pos = [mid - 170, mid + 170];
    for (let i = 0; i < 2; i++) {
      const f = sim.f[i];
      f.x = pos[i]; f.y = 0; f.vx = 0; f.vy = 0;
      f.face = i === 0 ? 1 : -1;
      f.hp = f.maxHp;
      setState(f, 'idle');
      f.stun = 0; f.invuln = 0; f.combo = 0; f.comboDmg = 0;
      f.ai.wait = 0; f.ai.threat = false; f.ai.blockAt = -1; f.ai.chain = null;
    }
    sim.projectiles = [];
    sim.timer = ROUND_TIME;
    sim.timerTicks = 0;
    sim.hitstop = 0;
    sim.phase = 'intro';
    sim.pt = 0;
    sim.roundWinner = null;
    sim.roundKind = null;
  }

  function setState(f, s) {
    f.state = s;
    f.t = 0;
    if (s !== 'attack') { f.move = null; f.mv = null; }
  }

  function emit(sim, ev) {
    ev.tick = sim.tick;
    sim.events.push(ev);
  }

  // ---------------------------------------------------------------- main step
  function step(sim) {
    sim.events.length = 0;
    if (sim.phase === 'done') return;
    sim.tick++;
    const a = sim.f[0], b = sim.f[1];

    if (sim.tick >= MAX_TICKS && sim.phase !== 'matchover') {
      // Safety net – never reached in practice, but guarantees an ending.
      const ra = a.hp / a.maxHp, rb = b.hp / b.maxHp;
      endMatch(sim, ra >= rb ? 'red' : 'blue');
      return;
    }

    switch (sim.phase) {
      case 'intro': {
        if (sim.pt === 0) {
          const final = a.roundWins === ROUNDS_TO_WIN - 1 && b.roundWins === ROUNDS_TO_WIN - 1;
          emit(sim, { type: 'announce', text: final ? 'FINAL ROUND' : 'ROUND ' + sim.round });
        }
        if (sim.pt === T.FIGHT_AT) emit(sim, { type: 'announce', text: 'FIGHT!', big: true });
        a.t++; b.t++;
        sim.pt++;
        if (sim.pt >= T.INTRO) { sim.phase = 'fight'; sim.pt = 0; }
        break;
      }
      case 'fight': {
        if (sim.hitstop > 0) { sim.hitstop--; break; }
        update(sim, true);
        sim.timerTicks++;
        if (sim.timerTicks % TPS === 0 && sim.timer > 0) sim.timer--;
        if (a.hp <= 0 || b.hp <= 0) endRound(sim, 'ko');
        else if (sim.timer <= 0) endRound(sim, 'time');
        break;
      }
      case 'ko': {
        if (sim.hitstop > 0) sim.hitstop--;
        else if (sim.pt >= T.SLOWMO || sim.pt % 3 === 0) update(sim, false);
        sim.pt++;
        if (sim.pt >= T.KO) finishRound(sim);
        break;
      }
      case 'timeover': {
        update(sim, false);
        sim.pt++;
        if (sim.pt >= T.TIMEOVER) finishRound(sim);
        break;
      }
      case 'roundover': {
        a.t++; b.t++;
        sim.pt++;
        if (sim.pt >= T.ROUNDOVER) { sim.round++; resetRound(sim); }
        break;
      }
      case 'matchover': {
        a.t++; b.t++;
        sim.pt++;
        if (sim.pt >= T.MATCHOVER) sim.phase = 'done';
        break;
      }
    }
  }

  function endRound(sim, kind) {
    const a = sim.f[0], b = sim.f[1];
    let w = null;
    if (kind === 'ko') {
      if (a.hp > 0 || b.hp > 0) w = a.hp > 0 ? 'red' : 'blue';
    } else {
      const ra = a.hp / a.maxHp, rb = b.hp / b.maxHp;
      w = ra > rb ? 'red' : rb > ra ? 'blue' : null;
    }
    sim.roundWinner = w;
    sim.roundKind = kind;
    sim.phase = kind === 'ko' ? 'ko' : 'timeover';
    sim.pt = 0;
    sim.projectiles.length = 0;
    let text = 'K.O.';
    if (kind === 'time') text = 'TIME OVER';
    else if (!w) text = 'DOUBLE K.O.';
    emit(sim, { type: 'announce', text: text, big: true, ko: kind === 'ko' });
    emit(sim, { type: 'ko', kind: kind });
  }

  function finishRound(sim) {
    const a = sim.f[0], b = sim.f[1];
    const w = sim.roundWinner;
    sim.roundLog.push({ winner: w, kind: sim.roundKind, redHp: a.hp, blueHp: b.hp });
    if (w) {
      const wf = w === 'red' ? a : b;
      const lf = w === 'red' ? b : a;
      wf.roundWins++;
      setState(wf, 'win');
      wf.y = 0; wf.vx = 0; wf.vy = 0;
      if (lf.state !== 'ko') { setState(lf, 'lose'); lf.y = 0; lf.vx = 0; lf.vy = 0; }
      if (wf.hp >= wf.maxHp) emit(sim, { type: 'announce', text: 'PERFECT', sub: true });
      if (wf.roundWins >= ROUNDS_TO_WIN) { endMatch(sim, w); return; }
    } else {
      for (const f of sim.f) if (f.state !== 'ko') { setState(f, 'lose'); f.y = 0; f.vx = 0; f.vy = 0; }
      emit(sim, { type: 'announce', text: 'DRAW', sub: true });
    }
    if (sim.round >= MAX_ROUNDS) {
      let pick;
      if (a.roundWins !== b.roundWins) pick = a.roundWins > b.roundWins ? 'red' : 'blue';
      else if (a.dmgDealt !== b.dmgDealt) pick = a.dmgDealt > b.dmgDealt ? 'red' : 'blue';
      else pick = sim.rng.chance(0.5) ? 'red' : 'blue';
      endMatch(sim, pick);
      return;
    }
    sim.phase = 'roundover';
    sim.pt = 0;
  }

  function endMatch(sim, side) {
    sim.winner = side;
    sim.decidedTick = sim.tick;
    sim.phase = 'matchover';
    sim.pt = 0;
    const wf = side === 'red' ? sim.f[0] : sim.f[1];
    if (wf.state !== 'win') { setState(wf, 'win'); wf.y = 0; wf.vx = 0; wf.vy = 0; }
    emit(sim, { type: 'announce', text: wf.name.toUpperCase() + ' WINS', winner: side });
  }

  // ------------------------------------------------------------------ update
  function update(sim, live) {
    const a = sim.f[0], b = sim.f[1];
    sim.live = live;
    if (live) {
      think(sim, a, b);
      think(sim, b, a);
    }
    updateFighter(sim, a, b);
    updateFighter(sim, b, a);
    physics(sim, a);
    physics(sim, b);
    resolvePush(a, b);
    face(a, b);
    face(b, a);
    if (live) {
      // both hits are checked before either is applied, so trades happen
      const ha = checkHit(a, b), hb = checkHit(b, a);
      const ma = a.mv, mb = b.mv;
      if (ha) applyHit(sim, a, b, ma, ha, null);
      if (hb) applyHit(sim, b, a, mb, hb, null);
    }
    updateProjectiles(sim, live);
  }

  function canAct(f) {
    return f.state === 'idle' || f.state === 'walk';
  }

  function gapOf(f, o) {
    return Math.abs(o.x - f.x) - (f.w + o.w) / 2;
  }

  function isMeleeSpecial(f) {
    const k = f.moves.special.kind;
    return k === 'dash' || k === 'spin' || k === 'uppercut' || k === 'teleport';
  }

  function ownProjectile(sim, f) {
    for (const p of sim.projectiles) if (p.owner === f.side) return true;
    return false;
  }

  function threatened(sim, f, o, gap) {
    if (o.state === 'attack') {
      const mv = o.mv;
      if (o.t < mv.startup + mv.active) {
        const facingMe = sign(f.x - o.x) === o.face;
        if (mv.kind === 'teleport') return true;
        if (mv.kind === 'beam' || mv.kind === 'dash' || mv.kind === 'rush') {
          if (facingMe && gap < mv.reach + (mv.vx || 0) * mv.active) return true;
        } else if (mv.kind !== 'proj' && facingMe && gap < mv.reach + 28) {
          return true;
        }
      }
    }
    for (const p of sim.projectiles) {
      if (p.owner !== f.side && sign(f.x - p.x) === sign(p.vx) && Math.abs(f.x - p.x) < 300) return true;
    }
    return false;
  }

  function startMove(sim, f, key) {
    const mv = f.moves[key];
    if (key === 'super') {
      if (f.meter < METER_MAX) return false;
      f.meter = 0;
      emit(sim, { type: 'super', side: f.side, name: f.moves.super.type });
    }
    setState(f, 'attack');
    f.move = key;
    f.mv = mv;
    f.hits = 0;
    f.lastHitT = -99;
    f.hitConfirmed = false;
    f.ai.chain = null;
    if (mv.invuln) f.invuln = Math.max(f.invuln, mv.invuln);
    if (!mv.air) f.vx *= 0.3;
    f.meter = Math.min(METER_MAX, f.meter + 3);
    emit(sim, { type: 'whoosh', side: f.side, key: key });
    return true;
  }

  function walk(f, dir, ticks) {
    if (f.state !== 'walk') setState(f, 'walk');
    f.walkDir = dir;
    f.ai.wait = ticks;
  }

  function jump(sim, f, dir) {
    setState(f, 'jump');
    f.vy = f.st.jump;
    f.vx = dir * (f.st.spd * 1.3 + 1);
    f.y = 0.01;
    f.ai.airDone = false;
    emit(sim, { type: 'jump', side: f.side });
  }

  function think(sim, f, o) {
    const ai = f.ai, rng = sim.rng, st = f.st;
    const gap = gapOf(f, o);

    // --- defense: react to incoming attacks with a skill based delay
    const threat = threatened(sim, f, o, gap);
    if (threat) {
      if (!ai.threat) {
        ai.threat = true;
        ai.blockAt = rng.chance(0.15 + 0.6 * st.skill) ? sim.tick + Math.round(16 - 12 * st.skill) : -1;
      }
    } else {
      ai.threat = false;
      ai.blockAt = -1;
      if (f.state === 'block') setState(f, 'idle');
    }
    if (f.state === 'block' || f.state === 'blockstun') return;
    if (ai.blockAt >= 0 && sim.tick >= ai.blockAt && canAct(f) && f.y === 0) {
      setState(f, 'block');
      f.face = sign(o.x - f.x) || f.face;
      return;
    }

    // --- in the air: maybe a jumping attack
    if (f.state === 'jump') {
      if (!ai.airDone && f.vy < 3 && f.y > 12 && gap < f.moves.air.reach + 36) {
        ai.airDone = true;
        if (rng.chance(0.35 + 0.55 * st.skill)) startMove(sim, f, 'air');
      }
      return;
    }

    if (!canAct(f)) return;

    if (f.state === 'walk' && f.walkDir === sign(o.x - f.x) && gap <= f.moves.jab.reach) ai.wait = 0;
    if (ai.wait > 0) { ai.wait--; return; }
    decide(sim, f, o, gap);
  }

  function decide(sim, f, o, gap) {
    const rng = sim.rng, st = f.st, ai = f.ai, mv = f.moves;
    const toward = sign(o.x - f.x) || f.face;
    const oAir = o.y > 25;
    const oVuln = (o.state === 'attack' && o.t > o.mv.startup + o.mv.active) || o.state === 'land';
    const oDown = o.state === 'down' || o.state === 'getup' || o.state === 'fall';
    const spKind = mv.special.kind;
    const ranged = spKind === 'proj' || spKind === 'beam';
    const pause = function () { return rng.int(1, Math.round(4 + 12 * (1 - st.skill))); };

    // Super move when the bar is full
    if (f.meter >= METER_MAX && !oDown) {
      const sk = mv.super.kind;
      const ok = sk === 'rush' ? gap < 320 : sk === 'beam' ? true : gap > 60;
      if (ok && rng.chance(0.1 + st.skill * 0.15)) { startMove(sim, f, 'super'); return; }
    }

    // Punish a whiffed attack
    if (oVuln && gap < mv.heavy.reach + 4 && rng.chance(0.25 + st.skill * 0.6)) {
      startMove(sim, f, isMeleeSpecial(f) && rng.chance(0.5) ? 'special' : 'heavy');
      return;
    }

    // Anti-air
    if (oAir && gap < 150 && o.vy < 5 && rng.chance(st.skill * 0.75)) {
      startMove(sim, f, spKind === 'uppercut' ? 'special' : 'heavy');
      return;
    }

    // Opponent knocked down: take position
    if (oDown) {
      if (gap > 110) walk(f, toward, rng.int(6, 14));
      else if (gap < 30) walk(f, -toward, rng.int(6, 12));
      else { setState(f, 'idle'); ai.wait = pause(); }
      return;
    }

    if (gap <= mv.kick.reach) {
      const r = rng.next();
      if (r < st.aggr) {
        const opts = [['jab', 34], ['kick', 28], ['heavy', 12 + 10 * st.skill], ['sweep', 11]];
        if (isMeleeSpecial(f)) opts.push(['special', 12]);
        else if (spKind === 'proj' && !ownProjectile(sim, f)) opts.push(['special', 3]);
        if (rng.chance(st.jumpy * 0.05)) { jump(sim, f, toward); return; }
        startMove(sim, f, rng.weighted(opts));
      } else if (r < st.aggr + (1 - st.aggr) * 0.55) {
        walk(f, -toward, rng.int(8, 22));
      } else {
        setState(f, 'idle');
        ai.wait = pause() + rng.int(0, 8);
      }
      return;
    }

    if (gap <= 260) {
      if (ranged && !ownProjectile(sim, f) && rng.chance(0.1 + (1 - st.aggr) * 0.16)) { startMove(sim, f, 'special'); return; }
      if (spKind === 'dash' && rng.chance(0.07 + st.aggr * 0.05)) { startMove(sim, f, 'special'); return; }
      if (spKind === 'teleport' && rng.chance(0.05)) { startMove(sim, f, 'special'); return; }
      if (rng.chance(st.jumpy * 0.13)) { jump(sim, f, toward); return; }
      if (rng.chance(0.25 + st.aggr * 0.75)) walk(f, toward, rng.int(6, 20));
      else if (rng.chance(0.5)) walk(f, -toward, rng.int(6, 16));
      else { setState(f, 'idle'); ai.wait = pause(); }
      return;
    }

    // Far away
    if (ranged && !ownProjectile(sim, f) && (spKind === 'proj' || gap < mv.special.reach) &&
        rng.chance(0.14 + (1 - st.aggr) * 0.2)) { startMove(sim, f, 'special'); return; }
    if (spKind === 'teleport' && rng.chance(0.06)) { startMove(sim, f, 'special'); return; }
    if (spKind === 'dash' && gap < 400 && rng.chance(0.06)) { startMove(sim, f, 'special'); return; }
    if (gap < 420 && rng.chance(st.jumpy * 0.06)) { jump(sim, f, toward); return; }
    if (rng.chance(0.35 + st.aggr * 0.65)) walk(f, toward, rng.int(10, 30));
    else { setState(f, 'idle'); ai.wait = pause() + 4; }
  }

  function updateFighter(sim, f, o) {
    f.t++;
    if (f.invuln > 0) f.invuln--;
    switch (f.state) {
      case 'idle': f.vx *= 0.7; break;
      case 'walk': f.vx = f.walkDir * f.st.spd * (f.walkDir === f.face ? 1 : 0.75); break;
      case 'land': f.vx *= 0.6; if (f.t >= f.landT) setState(f, 'idle'); break;
      case 'block': f.vx *= 0.7; break;
      case 'blockstun':
        f.vx *= 0.85;
        if (--f.stun <= 0) setState(f, 'block');
        break;
      case 'hitstun':
        f.vx *= 0.85;
        if (--f.stun <= 0) { setState(f, 'idle'); f.combo = 0; f.comboDmg = 0; }
        break;
      case 'down':
        if (f.t >= 38 && f.hp > 0) setState(f, 'getup');
        break;
      case 'getup':
        if (f.t >= 18) { setState(f, 'idle'); f.invuln = 8; f.combo = 0; f.comboDmg = 0; }
        break;
      case 'ko': case 'win': case 'lose': f.vx *= 0.8; break;
      case 'attack': updateAttack(sim, f, o); break;
      default: break;
    }
  }

  function updateAttack(sim, f, o) {
    const mv = f.mv, t = f.t;
    const act = mv.startup + mv.active;
    const end = act + mv.recovery;
    switch (mv.kind) {
      case 'melee':
        if (!mv.air) f.vx *= 0.75;
        break;
      case 'proj':
        f.vx *= 0.7;
        if (t === mv.startup) spawnProjectile(sim, f, mv);
        break;
      case 'dash':
      case 'spin':
        if (t > mv.startup && t <= act) f.vx = f.face * mv.vx; else f.vx *= 0.8;
        break;
      case 'rush':
        if (t > mv.startup && t <= act) f.vx = f.hits > 0 ? 0 : f.face * mv.vx; else f.vx *= 0.8;
        break;
      case 'uppercut':
        if (t === mv.startup) { f.vy = mv.vy; f.vx = f.face * mv.vx; f.y = Math.max(f.y, 0.01); }
        break;
      case 'teleport':
        f.vx = 0;
        if (t === mv.startup) {
          const dir = sign(o.x - f.x) || f.face;
          const off = o.w / 2 + f.w / 2 + 14;
          let nx = o.x + dir * off;
          if (nx < WALL + f.w / 2 || nx > STAGE_W - WALL - f.w / 2) nx = o.x - dir * off;
          f.x = clamp(nx, WALL + f.w / 2, STAGE_W - WALL - f.w / 2);
          f.y = 0;
          f.face = sign(o.x - f.x) || -dir;
          emit(sim, { type: 'teleport', side: f.side });
        }
        break;
      case 'beam':
        f.vx = 0;
        break;
    }
    if (f.ai.chain && f.hitConfirmed && t >= act) {
      const next = f.ai.chain;
      f.ai.chain = null;
      if (startMove(sim, f, next)) return;
    }
    if (t >= end) {
      if (f.y > 0) { setState(f, 'jump'); f.ai.airDone = true; } else setState(f, 'idle');
    }
  }

  function physics(sim, f) {
    if (f.y > 0 || f.vy > 0) {
      f.vy -= GRAVITY;
      f.x += f.vx;
      f.y += f.vy;
      if (f.y <= 0) { f.y = 0; f.vy = 0; land(sim, f); }
    } else {
      f.x += f.vx;
      f.y = 0;
    }
    const lo = WALL + f.w / 2, hi = STAGE_W - WALL - f.w / 2;
    if (f.x < lo) { f.x = lo; if (f.vx < 0) f.vx = 0; }
    if (f.x > hi) { f.x = hi; if (f.vx > 0) f.vx = 0; }
  }

  function land(sim, f) {
    switch (f.state) {
      case 'jump':
        setState(f, 'land'); f.landT = 4; f.vx = 0;
        emit(sim, { type: 'land', side: f.side, x: f.x });
        break;
      case 'attack':
        if (f.mv.air || f.mv.kind === 'uppercut') {
          const up = f.mv.kind === 'uppercut';
          setState(f, 'land'); f.landT = up ? 14 : 5; f.vx = 0;
          emit(sim, { type: 'land', side: f.side, x: f.x });
        }
        break;
      case 'fall':
        f.vx *= 0.3;
        setState(f, f.hp <= 0 ? 'ko' : 'down');
        emit(sim, { type: 'thud', side: f.side, x: f.x });
        break;
      default:
        break;
    }
  }

  function pushable(f) {
    return f.state !== 'down' && f.state !== 'ko' && f.state !== 'fall';
  }

  function resolvePush(a, b) {
    for (let pass = 0; pass < 2; pass++) {
      if (!pushable(a) || !pushable(b)) break;
      if (Math.abs(a.y - b.y) > Math.min(a.h, b.h) * 0.65) break;
      const minD = (a.w + b.w) / 2;
      const dx = b.x - a.x;
      const d = Math.abs(dx);
      if (d >= minD) break;
      const s = sign(dx) || a.face;
      const over = minD - d;
      const loA = WALL + a.w / 2, hiA = STAGE_W - WALL - a.w / 2;
      const loB = WALL + b.w / 2, hiB = STAGE_W - WALL - b.w / 2;
      if (pass === 0) {
        a.x -= s * over / 2;
        b.x += s * over / 2;
      } else {
        // someone is pinned against a wall: push the other one fully
        const aPinned = a.x <= loA || a.x >= hiA;
        if (aPinned) b.x += s * over; else a.x -= s * over;
      }
      a.x = clamp(a.x, loA, hiA);
      b.x = clamp(b.x, loB, hiB);
    }
    const dx = b.x - a.x;
    if (Math.abs(dx) > MAX_SEP) {
      const ex = (Math.abs(dx) - MAX_SEP) / 2;
      const s = sign(dx);
      a.x += s * ex;
      b.x -= s * ex;
    }
  }

  function face(f, o) {
    if (f.y > 0) return;
    if (f.state === 'idle' || f.state === 'walk' || f.state === 'land' || f.state === 'getup') {
      const s = sign(o.x - f.x);
      if (s) f.face = s;
    }
  }

  // ------------------------------------------------------------------ combat
  function hittable(f) {
    if (f.invuln > 0) return false;
    return f.state !== 'down' && f.state !== 'getup' && f.state !== 'ko' && f.state !== 'fall';
  }

  function hitbox(f, mv) {
    const front = f.x + f.face * f.w * 0.5;
    let x1, x2;
    if (mv.kind === 'spin') {
      x1 = f.x - f.face * (f.w * 0.5 + mv.back);
      x2 = front + f.face * mv.reach;
    } else {
      x1 = front - f.face * f.w * 0.3;
      x2 = front + f.face * mv.reach;
    }
    return {
      l: Math.min(x1, x2), r: Math.max(x1, x2),
      b: f.y + mv.lo * f.h, t: f.y + mv.hi * f.h
    };
  }

  function hurtbox(f) {
    let top = f.h;
    if (f.state === 'attack' && f.move === 'sweep') top = f.h * 0.55;
    return { l: f.x - f.w / 2, r: f.x + f.w / 2, b: f.y, t: f.y + top };
  }

  function overlap(p, q) {
    return p.l < q.r && p.r > q.l && p.b < q.t && p.t > q.b;
  }

  function checkHit(att, def) {
    if (att.state !== 'attack') return null;
    const mv = att.mv;
    if (mv.kind === 'proj') return null;
    const t = att.t;
    if (t <= mv.startup || t > mv.startup + mv.active) return null;
    if (mv.interval) {
      if (att.lastHitT >= 0 && t - att.lastHitT < mv.interval) return null;
      if (mv.maxHits && att.hits >= mv.maxHits) return null;
    } else if (att.hits > 0) {
      return null;
    }
    if (!hittable(def)) return null;
    const hb = hitbox(att, mv), hu = hurtbox(def);
    if (!overlap(hb, hu)) return null;
    return {
      x: (Math.max(hb.l, hu.l) + Math.min(hb.r, hu.r)) / 2,
      y: (Math.max(hb.b, hu.b) + Math.min(hb.t, hu.t)) / 2
    };
  }

  function launch(f, dir, vy, vx) {
    setState(f, 'fall');
    f.vy = vy;
    f.vx = dir * vx;
    f.y = Math.max(f.y, 1);
    f.stun = 0;
  }

  function applyHit(sim, att, def, mv, pt, proj) {
    if (!proj) { att.hits++; att.lastHitT = att.t; }
    const dir = proj ? sign(proj.vx) : (sign(def.x - att.x) || att.face);
    const facingAttacker = def.face === -dir;
    const blocking = (def.state === 'block' || def.state === 'blockstun') && facingAttacker;
    const raw = DMG * mv.dmg * att.st.atk / def.st.def;

    if (blocking) {
      let chip = Math.round(raw * (mv.super ? 0.22 : 0.1));
      if (!mv.super && def.hp - chip < 1) chip = Math.max(0, def.hp - 1);
      def.hp = Math.max(0, def.hp - chip);
      setState(def, 'blockstun');
      def.stun = mv.blockstun;
      def.vx = dir * mv.push * 0.9;
      def.meter = Math.min(METER_MAX, def.meter + 18);
      att.meter = Math.min(METER_MAX, att.meter + 6);
      sim.hitstop = mv.interval ? 2 : 4;
      if (def.hp <= 0) launch(def, dir, 8, 4);
      emit(sim, { type: 'block', x: pt.x, y: pt.y, side: att.side, super: !!mv.super });
      return;
    }

    const scale = Math.max(0.3, 1 - 0.1 * def.combo);
    const dmg = Math.max(1, Math.round(raw * scale));
    def.hp = Math.max(0, def.hp - dmg);
    def.combo++;
    def.comboDmg += dmg;
    att.dmgDealt += dmg;
    att.meter = Math.min(METER_MAX, att.meter + dmg * 0.8 + 6);
    def.meter = Math.min(METER_MAX, def.meter + dmg * 0.55);
    def.ai.blockAt = -1;

    const lastRushHit = mv.maxHits && att.hits >= mv.maxHits;
    if (def.hp <= 0) launch(def, dir, 9, 4.5);
    else if (mv.launch || lastRushHit || def.y > 0) launch(def, dir, mv.launch || lastRushHit ? 10 : 7, 4);
    else if (mv.trip) launch(def, dir, 4.5, 1.5);
    else {
      setState(def, 'hitstun');
      def.stun = mv.hitstun;
      def.vx = dir * mv.push;
    }
    sim.hitstop = mv.interval ? 2 : clamp(Math.round(3 + dmg / 10), 3, 12);

    emit(sim, {
      type: 'hit', x: pt.x, y: pt.y, dmg: dmg, side: att.side,
      heavy: dmg >= 60 || def.hp <= 0, super: !!mv.super, combo: def.combo
    });

    if (!proj) {
      att.hitConfirmed = true;
      if (mv.cancel && !att.ai.chain && def.hp > 0) {
        const opts = [];
        for (const k of mv.cancel) {
          if (k === 'super' && att.meter < METER_MAX) continue;
          if (k === 'special' && !isMeleeSpecial(att) && att.moves.special.kind !== 'proj') continue;
          if (k === 'special' && att.moves.special.kind === 'proj' && ownProjectile(sim, att)) continue;
          opts.push(k);
        }
        if (opts.length && sim.rng.chance(0.15 + 0.7 * att.st.skill)) att.ai.chain = sim.rng.pick(opts);
      }
    }
  }

  function spawnProjectile(sim, f, mv) {
    sim.projectiles.push({
      id: sim.nextId++,
      owner: f.side,
      x: f.x + f.face * (f.w * 0.5 + mv.pw * 0.5),
      y: f.y + f.h * mv.py,
      vx: f.face * mv.speed,
      w: mv.pw, h: mv.ph,
      mv: mv,
      super: !!mv.super,
      life: 0,
      dead: false
    });
    emit(sim, { type: 'proj', side: f.side, super: !!mv.super });
  }

  function projBox(p) {
    return { l: p.x - p.w / 2, r: p.x + p.w / 2, b: p.y - p.h / 2, t: p.y + p.h / 2 };
  }

  function updateProjectiles(sim, live) {
    const list = sim.projectiles;
    for (const p of list) {
      p.x += p.vx;
      p.life++;
      if (p.x < -150 || p.x > STAGE_W + 150 || p.life > 400) p.dead = true;
    }
    if (live) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.dead) continue;
        for (let j = i + 1; j < list.length; j++) {
          const q = list[j];
          if (q.dead || q.owner === p.owner) continue;
          if (!overlap(projBox(p), projBox(q))) continue;
          if (p.super && !q.super) q.dead = true;
          else if (q.super && !p.super) p.dead = true;
          else { p.dead = true; q.dead = true; }
          emit(sim, { type: 'clash', x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
        }
      }
      for (const p of list) {
        if (p.dead) continue;
        const att = p.owner === 'red' ? sim.f[0] : sim.f[1];
        const def = p.owner === 'red' ? sim.f[1] : sim.f[0];
        if (!hittable(def)) continue;
        const hu = hurtbox(def);
        if (!overlap(projBox(p), hu)) continue;
        p.dead = true;
        applyHit(sim, att, def, p.mv, { x: p.x + p.vx, y: p.y }, p);
      }
    }
    sim.projectiles = list.filter(function (p) { return !p.dead; });
  }

  // ------------------------------------------------------------------ public
  function simulate(desc) {
    const sim = create(desc);
    while (sim.phase !== 'done') step(sim);
    const a = sim.f[0], b = sim.f[1];
    return {
      winner: sim.winner,
      ticks: sim.tick,
      decidedTick: sim.decidedTick,
      rounds: sim.roundLog,
      redRounds: a.roundWins,
      blueRounds: b.roundWins,
      perfect: sim.roundLog.some(function (r) {
        return r.winner && (r.winner === 'red' ? r.redHp === a.maxHp : r.blueHp === b.maxHp);
      })
    };
  }

  SB.Fight = {
    TPS: TPS,
    STAGE_W: STAGE_W,
    VIEW_W: VIEW_W,
    ROUND_TIME: ROUND_TIME,
    ROUNDS_TO_WIN: ROUNDS_TO_WIN,
    METER_MAX: METER_MAX,
    T: T,
    create: create,
    step: step,
    simulate: simulate
  };
})(globalThis.SB = globalThis.SB || {});
