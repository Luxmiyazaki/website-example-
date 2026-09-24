/* Salty Brawl – the "stream": draws stages, fighters, effects and HUD on a
 * canvas by replaying the deterministic fight simulation in real time. */
(function (SB) {
  'use strict';

  const W = 960, H = 540, GROUND_Y = 478;
  const D2R = Math.PI / 180;
  const Fight = SB.Fight;
  const STAGE_NAMES = ['Dusk Dojo', 'Neon Alley', 'Magma Pit', 'Orbital Ring', 'Salt Beach', 'The Salt Mine'];

  // ------------------------------------------------------------ colour utils
  const colorCache = new Map();
  function parseColor(c) {
    if (colorCache.has(c)) return colorCache.get(c);
    let rgb = [128, 128, 128];
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    } else if (c.indexOf('hsl') === 0) {
      const m = c.match(/-?[\d.]+/g).map(Number);
      const hh = m[0] / 360, s = m[1] / 100, l = m[2] / 100;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      const f = function (t) {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      rgb = [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255].map(Math.round);
    } else if (c.indexOf('rgb') === 0) {
      rgb = c.match(/[\d.]+/g).slice(0, 3).map(Number);
    }
    colorCache.set(c, rgb);
    return rgb;
  }
  const shadeCache = new Map();
  function shade(c, k) { // k<0 darker, k>0 lighter
    const key = c + '|' + k;
    let v = shadeCache.get(key);
    if (v) return v;
    const rgb = parseColor(c);
    const t = k < 0 ? 0 : 255, a = Math.abs(k);
    v = 'rgb(' + rgb.map(function (x) { return Math.round(x + (t - x) * a); }).join(',') + ')';
    shadeCache.set(key, v);
    return v;
  }
  function rgba(c, a) {
    const rgb = parseColor(c);
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function line(ctx, x1, y1, x2, y2, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  function circle(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  function ease(k) { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); }
  function lerp(a, b, k) { return a + (b - a) * k; }

  // ------------------------------------------------------------------ poses
  const IDLE = { lean: 6, fs: 40, fe: 95, bs: 25, be: 105, fh: 22, fk: 18, bh: -18, bk: 12, head: 0, rot: 0, air: 0 };
  function P(o) { return Object.assign({}, IDLE, o); }
  const POSE = {
    idle: P({}),
    block: P({ lean: -6, fs: 100, fe: 115, bs: 85, be: 125, fh: 25, fk: 30, bh: -22, bk: 20 }),
    hit: P({ lean: -24, fs: -30, fe: 40, bs: -50, be: 30, fh: 15, fk: 25, bh: -25, bk: 10, head: -20 }),
    jump: P({ lean: 5, fs: 60, fe: 80, bs: 30, be: 90, fh: 70, fk: 110, bh: 10, bk: 100, air: 1 }),
    land: P({ lean: 15, fs: 50, fe: 90, bs: 30, be: 100, fh: 42, fk: 75, bh: -22, bk: 60 }),
    win: P({ lean: 0, fs: 172, fe: 10, bs: 30, be: 100, fh: 12, fk: 5, bh: -12, bk: 5 }),
    lose: P({ lean: 22, fs: 8, fe: 10, bs: 4, be: 10, fh: 10, fk: 25, bh: -10, bk: 25, head: 25 }),
    lying: P({ lean: 0, fs: 160, fe: 10, bs: 140, be: 20, fh: 5, fk: 10, bh: -5, bk: 15, air: 1, rot: -90, hipY: 13 }),
    fall: P({ lean: -10, fs: 150, fe: 30, bs: 120, be: 40, fh: 40, fk: 50, bh: 10, bk: 30, air: 1, rot: -50 }),
    charge: P({ lean: -6, fs: 160, fe: 20, bs: 150, be: 30, fh: 25, fk: 20, bh: -22, bk: 12 })
  };
  const ATTACK = {
    jab: [P({ lean: 8, fs: 55, fe: 70 }), P({ lean: 14, fs: 90, fe: 0, bs: 35, be: 110, fh: 32, fk: 20, bh: -26, bk: 10 })],
    kick: [P({ lean: -4, fh: 60, fk: 90 }), P({ lean: -18, fs: 50, fe: 80, bs: -20, be: 60, fh: 92, fk: 0, bh: -8, bk: 5 })],
    heavy: [P({ lean: -12, fs: -40, fe: 100, bs: 20 }), P({ lean: 28, fs: 95, fe: -5, bs: -35, be: 30, fh: 35, fk: 30, bh: -38, bk: 5 })],
    sweep: [P({ lean: 20, fh: 50, fk: 90, bh: 60, bk: 140 }), P({ lean: 35, fs: 20, fe: 40, bs: -60, be: 0, fh: 88, fk: 0, bh: 70, bk: 150 })],
    air: [P({ fh: 60, fk: 100, bh: 10, bk: 100, air: 1 }), P({ lean: 10, fs: 30, fe: 90, bs: -30, be: 60, fh: 62, fk: 0, bh: -10, bk: 110, air: 1 })],
    proj: [P({ lean: -4, fs: 15, fe: 110, bs: 5, be: 120 }), P({ lean: 14, fs: 88, fe: 0, bs: 82, be: 5, fh: 34, fk: 22, bh: -28, bk: 8 })],
    beam: [P({ lean: -4, fs: 15, fe: 110, bs: 5, be: 120 }), P({ lean: 18, fs: 90, fe: 0, bs: 84, be: 4, fh: 38, fk: 26, bh: -30, bk: 6 })],
    dash: [P({ lean: 20, fh: 40, fk: 60 }), P({ lean: 38, fs: 70, fe: 30, bs: -40, be: 40, fh: 60, fk: 70, bh: -40, bk: 30 })],
    uppercut: [P({ lean: 20, fs: 30, fe: 120, fh: 45, fk: 80, bh: -10, bk: 70 }), P({ lean: -5, fs: 176, fe: 0, bs: -30, be: 60, fh: 20, fk: 60, bh: -10, bk: 80, air: 1 })],
    spin: [P({ fs: 60, bs: -60 }), P({ lean: 0, fs: 90, fe: 0, bs: -90, be: 0, fh: 12, fk: 5, bh: -12, bk: 5 })],
    teleport: [P({}), P({ lean: 28, fs: 95, fe: -5, bs: -35, be: 30, fh: 35, fk: 30, bh: -38, bk: 5 })],
    rush: [P({ lean: 10, fs: 40, fe: 100 }), P({ lean: 22, fs: 90, fe: 0, bs: 60, be: 60, fh: 40, fk: 30, bh: -34, bk: 10 })],
    rush2: P({ lean: 22, fs: 50, fe: 70, bs: 92, be: 0, fh: 40, fk: 30, bh: -34, bk: 10 })
  };

  function lerpPose(p, q, k) {
    const o = {};
    for (const key in p) o[key] = typeof p[key] === 'number' && typeof q[key] === 'number' ? lerp(p[key], q[key], k) : q[key];
    if (q.hipY !== undefined || p.hipY !== undefined) {
      const a = p.hipY !== undefined ? p.hipY : hipHeight(p);
      const b = q.hipY !== undefined ? q.hipY : hipHeight(q);
      o.hipY = lerp(a, b, k);
    }
    o.air = k < 0.5 ? p.air : q.air;
    return o;
  }

  function hipHeight(p) {
    const f = 30 * Math.cos(p.fh * D2R) + 30 * Math.cos((p.fh - p.fk) * D2R);
    const b = 30 * Math.cos(p.bh * D2R) + 30 * Math.cos((p.bh - p.bk) * D2R);
    return Math.max(f, b);
  }

  function attackPoseName(mv) {
    if (mv.key !== 'special' && mv.key !== 'super') return mv.key;
    switch (mv.type) {
      case 'fireball': case 'mega': return 'proj';
      case 'beam': case 'hyper': return 'beam';
      default: return mv.type;
    }
  }

  function poseFor(f) {
    const t = f.t;
    switch (f.state) {
      case 'idle': {
        const b = Math.sin(t * 0.08);
        return Object.assign({}, POSE.idle, { fs: 40 + b * 4, bs: 25 - b * 3, lean: 6 + b * 1.5, fk: 18 + b * 3, bk: 12 + b * 3 });
      }
      case 'walk': {
        const back = f.walkDir !== f.face;
        const ph = t * 0.22 * (back ? -1 : 1);
        const s = Math.sin(ph);
        return Object.assign({}, POSE.idle, {
          fh: 8 + 26 * s, bh: 8 - 26 * s,
          fk: 14 + 22 * Math.max(0, Math.cos(ph)), bk: 14 + 22 * Math.max(0, -Math.cos(ph)),
          fs: 42 + 8 * s, bs: 22 - 8 * s, lean: back ? 0 : 9
        });
      }
      case 'jump': return POSE.jump;
      case 'land': return POSE.land;
      case 'block': case 'blockstun': return POSE.block;
      case 'hitstun': return POSE.hit;
      case 'fall': return Object.assign({}, POSE.fall, { rot: -25 - Math.min(65, t * 5) });
      case 'down': case 'ko': return POSE.lying;
      case 'getup': return lerpPose(POSE.lying, POSE.idle, ease(t / 18));
      case 'win': {
        const b = Math.sin(t * 0.12);
        return Object.assign({}, POSE.win, { fs: 168 + b * 8, lean: b * 3 });
      }
      case 'lose': return POSE.lose;
      case 'attack': {
        const mv = f.mv;
        const name = attackPoseName(mv);
        const pair = ATTACK[name] || ATTACK.jab;
        let wind = pair[0];
        let act = pair[1];
        if (mv.super && (mv.type === 'mega' || mv.type === 'hyper')) wind = POSE.charge;
        const base = f.y > 0 ? POSE.jump : POSE.idle;
        const s = mv.startup, a = mv.active;
        if (name === 'rush' && t > s && t <= s + a) return Math.floor(t / 3) % 2 ? act : ATTACK.rush2;
        if (t <= s) return lerpPose(base, wind, ease(t / Math.max(1, s * 0.7)));
        if (t <= s + a) return act;
        return lerpPose(act, base, ease((t - s - a) / mv.recovery));
      }
      default: return POSE.idle;
    }
  }

  // ------------------------------------------------------------ the fighter
  // f: {state, t, mv, face, y, walkDir, invuln, st:{size}} ; sx/sy = feet on screen
  function drawFighter(ctx, f, look, sx, sy, scale, opts) {
    opts = opts || {};
    const S = f.st.size * scale;
    const p = poseFor(f);
    const flash = opts.flash || null;
    const col = function (c) { return flash || c; };
    let alpha = opts.alpha === undefined ? 1 : opts.alpha;
    if (f.state === 'attack' && f.mv && f.mv.kind === 'teleport' && f.t < f.mv.startup) alpha *= Math.max(0, 1 - f.t / 7);
    if (f.invuln > 0 && (f.state === 'idle' || f.state === 'walk') && Math.floor(f.t / 3) % 2) alpha *= 0.55;
    if (alpha <= 0.01) return;

    const body = look.body;
    const thick = body === 'brute' ? 15 : body === 'slim' || body === 'mage' ? 8.5 : 11;
    const skin = col(look.skin);
    const main = col(look.main);
    const pants = col(body === 'robot' ? shade(look.main, -0.25) : look.pants);
    const accent = col(look.accent);
    const hair = look.hair === 'none' ? null : col(look.hair);
    const dark = function (c) { return flash || shade(c, -0.28); };

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.scale(f.face * S, S);

    // aura for X tier
    if (look.aura && !opts.noAura) {
      const pulse = 0.35 + 0.15 * Math.sin((opts.time || 0) / 180);
      const g = ctx.createRadialGradient(0, -65, 10, 0, -65, 95);
      g.addColorStop(0, rgba(look.aura, pulse));
      g.addColorStop(1, rgba(look.aura, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-100, -170, 200, 200);
    }

    if (body === 'blob') {
      drawBlob(ctx, f, p, look, col, dark, opts);
      ctx.restore();
      return;
    }

    const hipY = p.hipY !== undefined ? p.hipY : p.air ? 58 : hipHeight(p);
    const hip = { x: 0, y: -hipY };
    if (p.rot) {
      ctx.translate(hip.x, hip.y);
      ctx.rotate(p.rot * D2R);
      ctx.translate(-hip.x, -hip.y);
    }
    const L = p.lean * D2R;
    const sh = { x: hip.x + Math.sin(L) * 36, y: hip.y - Math.cos(L) * 36 };
    const neck = { x: hip.x + Math.sin(L) * 41, y: hip.y - Math.cos(L) * 41 };
    const HA = L + p.head * D2R;
    const head = { x: neck.x + Math.sin(HA) * 13, y: neck.y - Math.cos(HA) * 13 };
    function limbPts(o, a1, bend, len) {
      const A = a1 * D2R, B = (a1 + bend) * D2R;
      const m = { x: o.x + Math.sin(A) * len, y: o.y + Math.cos(A) * len };
      return [m, { x: m.x + Math.sin(B) * len, y: m.y + Math.cos(B) * len }];
    }
    const armLen = body === 'blob' ? 13 : 22;
    const fa = limbPts(sh, p.fs, p.fe, armLen);
    const ba = limbPts({ x: sh.x - 3, y: sh.y + 1 }, p.bs, p.be, armLen);
    const fl = limbPts(hip, p.fh, -p.fk, 30);
    const bl = limbPts({ x: hip.x - 2, y: hip.y }, p.bh, -p.bk, 30);

    ctx.lineCap = body === 'robot' ? 'butt' : 'round';
    ctx.lineJoin = 'round';

    // cape (behind everything)
    if (look.cape) {
      const sway = Math.sin((opts.time || 0) / 260 + f.t * 0.05) * 6;
      ctx.fillStyle = dark(look.accent);
      ctx.beginPath();
      ctx.moveTo(sh.x + 4, sh.y - 2);
      ctx.lineTo(sh.x - 10, sh.y - 2);
      ctx.quadraticCurveTo(hip.x - 34 + sway, hip.y + 10, hip.x - 30 + sway, -6);
      ctx.lineTo(hip.x - 4, -10);
      ctx.closePath();
      ctx.fill();
    }

    function drawArm(pts, origin, back) {
      const sleeve = body === 'brute' || body === 'robot' ? (body === 'robot' ? main : skin) : main;
      const c1 = back ? dark(sleeve) : sleeve;
      const c2 = back ? dark(body === 'robot' ? main : skin) : (body === 'robot' ? main : skin);
      line(ctx, origin.x, origin.y, pts[0].x, pts[0].y, thick, c1);
      line(ctx, pts[0].x, pts[0].y, pts[1].x, pts[1].y, thick * 0.92, c2);
      const fist = body === 'robot' ? accent : body === 'mage' ? skin : (look.hat === 'band' || look.hat === 'spiky' ? col('#c1121f') : skin);
      circle(ctx, pts[1].x, pts[1].y, thick * 0.62, back ? dark(fist) : fist);
      if (body === 'robot') circle(ctx, pts[0].x, pts[0].y, thick * 0.45, back ? dark(accent) : accent);
    }
    function drawLeg(pts, origin, back) {
      const c = back ? dark(pants) : pants;
      line(ctx, origin.x, origin.y, pts[0].x, pts[0].y, thick * 1.12, c);
      line(ctx, pts[0].x, pts[0].y, pts[1].x, pts[1].y, thick, c);
      const shoe = back ? col('#1a1a1a') : col('#262626');
      ctx.fillStyle = shoe;
      ctx.beginPath();
      ctx.ellipse(pts[1].x + 4, pts[1].y - 2, thick * 0.8, thick * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawArm(ba, { x: sh.x - 3, y: sh.y + 1 }, true);
    drawLeg(bl, { x: hip.x - 2, y: hip.y }, true);

    // torso
    const tw = body === 'brute' ? 19 : body === 'slim' ? 11 : body === 'robot' ? 17 : 14;
    const hw = body === 'brute' ? 14 : body === 'slim' ? 9 : 11;
    const px = Math.cos(L), py = Math.sin(L);
    ctx.fillStyle = main;
    ctx.beginPath();
    if (body === 'robot') {
      ctx.moveTo(sh.x - px * tw, sh.y - py * tw);
      ctx.lineTo(sh.x + px * tw, sh.y + py * tw);
      ctx.lineTo(hip.x + px * hw, hip.y + py * hw);
      ctx.lineTo(hip.x - px * hw, hip.y - py * hw);
    } else {
      ctx.moveTo(neck.x - px * tw, neck.y - py * tw + 3);
      ctx.quadraticCurveTo(neck.x, neck.y - 4, neck.x + px * tw, neck.y + py * tw + 3);
      ctx.lineTo(hip.x + px * hw, hip.y + py * hw);
      ctx.lineTo(hip.x - px * hw, hip.y - py * hw);
    }
    ctx.closePath();
    ctx.fill();
    if (body === 'robot') {
      ctx.strokeStyle = dark(look.main);
      ctx.lineWidth = 2;
      ctx.stroke();
      circle(ctx, (sh.x + hip.x) / 2 + px * 3, (sh.y + hip.y) / 2, 5, accent);
    } else if (body === 'brute') {
      // tank top straps / chest line
      line(ctx, neck.x - px * 6, neck.y + 6, hip.x - px * 2, hip.y - 6, 2, dark(look.main));
    } else {
      // gi collar
      ctx.strokeStyle = dark(look.main);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(neck.x - px * 6, neck.y + 2);
      ctx.lineTo((neck.x + hip.x) / 2 + px * 3, (neck.y + hip.y) / 2);
      ctx.stroke();
    }
    // belt
    line(ctx, hip.x - px * (hw + 1), hip.y - py * (hw + 1) - 3, hip.x + px * (hw + 1), hip.y + py * (hw + 1) - 3, 5, body === 'robot' ? dark(look.main) : accent);

    // mage robe skirt
    if (body === 'mage') {
      ctx.fillStyle = main;
      ctx.beginPath();
      ctx.moveTo(hip.x - px * 13, hip.y - 4);
      ctx.lineTo(hip.x + px * 13, hip.y - 4);
      ctx.lineTo(fl[0].x + 14, Math.min(fl[0].y + 18, -4));
      ctx.lineTo(bl[0].x - 14, Math.min(bl[0].y + 18, -4));
      ctx.closePath();
      ctx.fill();
      line(ctx, bl[0].x - 12, Math.min(bl[0].y + 16, -6), fl[0].x + 12, Math.min(fl[0].y + 16, -6), 3, accent);
    }

    drawLeg(fl, hip, false);
    drawHead(ctx, head, HA, look, col, dark, skin, hair, f, opts);
    drawArm(fa, sh, false);

    ctx.restore();
  }

  function drawHead(ctx, h, ang, look, col, dark, skin, hair, f, opts) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(ang);
    const robot = look.body === 'robot';
    const r = look.body === 'brute' ? 12 : 13;
    const hat = look.hat;
    // neck
    if (!robot) line(ctx, 0, r - 2, -1, r + 6, 8, skin);
    if (robot) {
      ctx.fillStyle = col(look.main);
      rr(ctx, -r, -r, r * 2, r * 2, 4);
      ctx.fill();
      ctx.strokeStyle = dark(look.main);
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (hat === 'luchador') {
      circle(ctx, 0, 0, r, col(look.main));
    } else {
      circle(ctx, 0, 0, r, skin);
    }
    // hair (behind hats)
    if (hair && !robot && hat !== 'luchador' && hat !== 'mask' && hat !== 'hood' && hat !== 'bucket') {
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(0, -1, r + 1, Math.PI * 0.95, Math.PI * 2.05);
      ctx.quadraticCurveTo(r * 0.3, -r * 0.35, -r * 0.9, -r * 0.1);
      ctx.fill();
    }
    // eyes
    const eyes = look.eyes;
    const hitNow = f.state === 'hitstun' || f.state === 'fall' || f.state === 'ko' || f.state === 'down';
    if (robot || eyes === 'visor') {
      ctx.fillStyle = col('#111');
      rr(ctx, -2, -5, r + 1, 7, 3);
      ctx.fill();
      ctx.fillStyle = col(look.accent);
      ctx.fillRect(1, -3, r - 3, 3);
    } else if (hitNow) {
      line(ctx, 3, -5, 9, 1, 2, col('#111'));
      line(ctx, 9, -5, 3, 1, 2, col('#111'));
    } else if (eyes === 'dot') {
      circle(ctx, 6, -2, 1.8, col('#111'));
    } else {
      circle(ctx, 6, -2, 3.2, col('#fff'));
      circle(ctx, 7.2, -2, 1.7, col(eyes === 'glow' ? look.accent : '#111'));
      if (eyes === 'angry') line(ctx, 2, -7, 10, -4.5, 2, col('#111'));
      if (eyes === 'sad') line(ctx, 2, -5, 10, -7.5, 2, col('#111'));
    }
    if (look.beard && !robot) {
      ctx.fillStyle = hair || col('#444');
      ctx.beginPath();
      ctx.moveTo(-2, 4);
      ctx.quadraticCurveTo(6, 16, r, 4);
      ctx.quadraticCurveTo(6, 8, -2, 4);
      ctx.fill();
    }
    // hats
    switch (hat) {
      case 'band': {
        ctx.fillStyle = col(look.accent);
        ctx.fillRect(-r, -8, r * 2, 4.5);
        const w = Math.sin((opts.time || 0) / 120) * 3;
        line(ctx, -r, -6, -r - 10, -2 + w, 3, col(look.accent));
        line(ctx, -r, -6, -r - 8, 3 + w, 3, col(look.accent));
        break;
      }
      case 'spiky':
        ctx.fillStyle = hair || col('#222');
        ctx.beginPath();
        ctx.moveTo(-r, -2);
        for (let i = 0; i < 5; i++) {
          const a = Math.PI + i * (Math.PI / 4);
          ctx.lineTo(Math.cos(a - 0.2) * r * 1.8 - 3, Math.sin(a - 0.2) * r * 1.8);
          ctx.lineTo(Math.cos(a + 0.25) * r * 0.9, Math.sin(a + 0.25) * r * 0.9);
        }
        ctx.closePath();
        ctx.fill();
        break;
      case 'mohawk':
        ctx.fillStyle = col(look.accent);
        ctx.beginPath();
        ctx.moveTo(-r * 0.8, -r * 0.5);
        ctx.lineTo(-r * 0.4, -r * 1.9);
        ctx.lineTo(r * 0.2, -r * 1.6);
        ctx.lineTo(r * 0.5, -r * 0.8);
        ctx.closePath();
        ctx.fill();
        break;
      case 'cap':
        ctx.fillStyle = col(look.accent);
        ctx.beginPath();
        ctx.arc(0, -3, r + 0.5, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(0, -5, r + 9, 3.5);
        break;
      case 'horns':
        ctx.fillStyle = col('#f1e3c6');
        [[-5, 1], [5, 1]].forEach(function (h) {
          ctx.beginPath();
          ctx.moveTo(h[0] - 3, -r + 2);
          ctx.quadraticCurveTo(h[0] - 2, -r - 12, h[0] + 6, -r - 14);
          ctx.quadraticCurveTo(h[0] + 1, -r - 6, h[0] + 3, -r + 3);
          ctx.fill();
        });
        break;
      case 'crown':
        ctx.fillStyle = col('#ffd23f');
        ctx.beginPath();
        ctx.moveTo(-10, -r + 1);
        ctx.lineTo(-11, -r - 10);
        ctx.lineTo(-5, -r - 4);
        ctx.lineTo(0, -r - 12);
        ctx.lineTo(5, -r - 4);
        ctx.lineTo(11, -r - 10);
        ctx.lineTo(10, -r + 1);
        ctx.closePath();
        ctx.fill();
        circle(ctx, 0, -r - 3, 1.8, col('#e63946'));
        break;
      case 'halo':
        ctx.strokeStyle = col('#ffe066');
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(-1, -r - 9, 11, 3.5, -0.1, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'wizard':
        ctx.fillStyle = col(look.main);
        ctx.beginPath();
        ctx.moveTo(-r - 6, -r + 5);
        ctx.lineTo(r + 7, -r + 5);
        ctx.lineTo(-6, -r - 30);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = col(look.accent);
        ctx.fillRect(-r - 6, -r + 3, r * 2 + 13, 3);
        circle(ctx, -3, -r - 12, 2.2, col('#ffe066'));
        break;
      case 'mask':
        ctx.fillStyle = col(look.main);
        ctx.beginPath();
        ctx.arc(0, 0, r + 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = skin;
        ctx.fillRect(-2, -6, r + 1, 7);
        circle(ctx, 6, -2.5, 2.4, col('#fff'));
        circle(ctx, 7, -2.5, 1.3, col('#111'));
        line(ctx, -r, -5, -r - 12, -1 + Math.sin((opts.time || 0) / 100) * 3, 3, col(look.accent));
        break;
      case 'luchador':
        ctx.fillStyle = col(look.accent);
        ctx.beginPath();
        ctx.moveTo(8, -r + 3);
        ctx.lineTo(0, -4);
        ctx.lineTo(-6, -r + 2);
        ctx.fill();
        circle(ctx, 6, -2, 3.4, col('#fff'));
        circle(ctx, 7, -2, 1.7, col('#111'));
        ctx.fillStyle = skin;
        ctx.fillRect(2, 4, 9, 5);
        break;
      case 'antenna':
        line(ctx, -2, -r, -4, -r - 12, 2, col('#888'));
        circle(ctx, -4, -r - 13, 3, col(look.accent));
        break;
      case 'party':
        ctx.fillStyle = col(look.accent);
        ctx.beginPath();
        ctx.moveTo(-9, -r + 3);
        ctx.lineTo(9, -r + 3);
        ctx.lineTo(1, -r - 22);
        ctx.closePath();
        ctx.fill();
        circle(ctx, 1, -r - 23, 3, col('#fff'));
        break;
      case 'bucket':
        ctx.fillStyle = col('#9aa0a6');
        rr(ctx, -r - 1, -r - 2, r * 2 + 2, r * 2 + 3, 4);
        ctx.fill();
        ctx.fillStyle = col('#222');
        ctx.fillRect(1, -4, r, 3);
        break;
      case 'hood':
        ctx.fillStyle = col(look.main);
        ctx.beginPath();
        ctx.arc(-2, 0, r + 4, Math.PI * 0.35, Math.PI * 1.95);
        ctx.fill();
        ctx.fillStyle = col('#fff');
        ctx.fillRect(-4, -r + 1, r + 4, 3);
        break;
    }
    ctx.restore();
  }

  function drawBlob(ctx, f, p, look, col, dark, opts) {
    const main = col(look.main);
    let sq = 1;
    if (f.state === 'land') sq = 0.82;
    else if (f.state === 'jump') sq = 1.12;
    else if (f.state === 'idle') sq = 1 + Math.sin(f.t * 0.1) * 0.03;
    else if (f.state === 'hitstun') sq = 0.9;
    const lying = f.state === 'down' || f.state === 'ko';
    ctx.save();
    if (lying) { ctx.translate(-10, 8); ctx.scale(1.25, 0.5); }
    else if (f.state === 'getup') { const k = Math.min(1, f.t / 18); ctx.translate(-10 * (1 - k), 8 * (1 - k)); ctx.scale(1.25 - 0.25 * k, 0.5 + 0.5 * k); }
    else if (p.rot) ctx.rotate(p.rot * D2R * 0.5);
    const spin = f.state === 'attack' && f.mv && f.mv.type === 'spin' && f.t > f.mv.startup && f.t <= f.mv.startup + f.mv.active;
    if (spin) ctx.scale(Math.cos(f.t * 0.7) || 0.05, 1);
    const cy = -36 * sq;
    // feet (a kick swings the front foot far out)
    const foot = function (a, x0) {
      const A = a * D2R;
      return { x: x0 + Math.sin(A) * 24, y: -4 - (1 - Math.cos(A)) * 16 };
    };
    const ff = foot(p.fh, 8), bf = foot(p.bh, -8);
    ctx.fillStyle = dark(look.main);
    ctx.beginPath();
    ctx.ellipse(bf.x, bf.y, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (ff.y < -8) line(ctx, 10, cy + 20, ff.x, ff.y, 9, dark(look.main));
    ctx.beginPath();
    ctx.ellipse(ff.x, ff.y, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // arms grow out of the sides of the body
    const armPts = function (ox, oy, a, b) {
      const A = a * D2R, B = (a + b) * D2R;
      const m = { x: ox + Math.sin(A) * 18, y: oy + Math.cos(A) * 18 };
      return [{ x: ox, y: oy }, m, { x: m.x + Math.sin(B) * 18, y: m.y + Math.cos(B) * 18 }];
    };
    const ba = armPts(-22, cy + 2, p.bs, p.be);
    line(ctx, ba[0].x, ba[0].y, ba[1].x, ba[1].y, 9, dark(look.main));
    line(ctx, ba[1].x, ba[1].y, ba[2].x, ba[2].y, 8, dark(look.main));
    circle(ctx, ba[2].x, ba[2].y, 6, dark(look.main));
    // body
    const g = ctx.createRadialGradient(-10, cy - 14, 6, 0, cy, 44);
    g.addColorStop(0, shade(look.main, 0.35));
    g.addColorStop(1, main);
    ctx.fillStyle = col === undefined ? main : (main === look.main ? g : main);
    ctx.beginPath();
    ctx.ellipse(0, cy, 34 / Math.sqrt(sq), 36 * sq, p.lean * D2R * 0.4, 0, Math.PI * 2);
    ctx.fill();
    // face
    const hitNow = f.state === 'hitstun' || f.state === 'fall' || lying;
    if (hitNow) {
      line(ctx, 8, cy - 14, 16, cy - 6, 2.5, col('#111'));
      line(ctx, 16, cy - 14, 8, cy - 6, 2.5, col('#111'));
    } else if (look.eyes === 'dot') {
      circle(ctx, 12, cy - 10, 2.5, col('#111'));
      circle(ctx, 24, cy - 10, 2.5, col('#111'));
    } else {
      circle(ctx, 10, cy - 10, 6, col('#fff'));
      circle(ctx, 23, cy - 10, 5, col('#fff'));
      circle(ctx, 12, cy - 9, 2.8, col('#111'));
      circle(ctx, 24.5, cy - 9, 2.4, col('#111'));
      if (look.eyes === 'sad') { line(ctx, 5, cy - 18, 15, cy - 20, 2, col('#111')); line(ctx, 19, cy - 20, 28, cy - 17, 2, col('#111')); }
      if (look.eyes === 'angry') { line(ctx, 4, cy - 20, 15, cy - 16, 2.5, col('#111')); line(ctx, 19, cy - 16, 29, cy - 20, 2.5, col('#111')); }
    }
    ctx.strokeStyle = col('#111');
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (f.state === 'attack' || f.state === 'win') ctx.arc(18, cy + 3, 5, 0, Math.PI);
    else { ctx.moveTo(13, cy + 5); ctx.lineTo(23, cy + 5); }
    ctx.stroke();
    if (look.beard) {
      ctx.fillStyle = col('#f1f1f1');
      ctx.beginPath();
      ctx.moveTo(4, cy + 4);
      ctx.quadraticCurveTo(18, cy + 30, 30, cy + 2);
      ctx.fill();
    }
    // hat
    const top = cy - 36 * sq;
    if (look.hat === 'party') {
      ctx.fillStyle = col(look.accent);
      ctx.beginPath();
      ctx.moveTo(-8, top + 6); ctx.lineTo(12, top + 6); ctx.lineTo(4, top - 22);
      ctx.fill();
      circle(ctx, 4, top - 23, 3.5, col('#fff'));
    } else if (look.hat === 'horns') {
      ctx.fillStyle = col('#f1e3c6');
      ctx.beginPath();
      ctx.moveTo(-10, top + 8); ctx.quadraticCurveTo(-14, top - 10, -4, top - 12); ctx.quadraticCurveTo(-8, top, -2, top + 6);
      ctx.moveTo(10, top + 8); ctx.quadraticCurveTo(10, top - 10, 20, top - 10); ctx.quadraticCurveTo(14, top, 16, top + 8);
      ctx.fill();
    }
    // front arm
    const fa = armPts(24, cy + 4, p.fs, p.fe);
    line(ctx, fa[0].x, fa[0].y, fa[1].x, fa[1].y, 9, main);
    line(ctx, fa[1].x, fa[1].y, fa[2].x, fa[2].y, 8, main);
    circle(ctx, fa[2].x, fa[2].y, 6.5, dark(look.main));
    ctx.restore();
  }

  // ------------------------------------------------------------------ stages
  const stageCache = {};
  function stageData(idx) {
    if (stageCache[idx]) return stageCache[idx];
    const rng = new SB.RNG(9000 + idx);
    const d = { far: [], mid: [], deco: [] };
    for (let x = -100; x < 1900; x += rng.int(60, 140)) d.far.push({ x: x, h: rng.int(60, 190), w: rng.int(80, 180), s: rng.next() });
    for (let x = -100; x < 2300; x += rng.int(90, 220)) d.mid.push({ x: x, h: rng.int(60, 200), w: rng.int(50, 120), s: rng.next(), c: rng.int(0, 4) });
    for (let i = 0; i < 90; i++) d.deco.push({ x: rng.float(0, 2000), y: rng.float(0, 1), s: rng.next(), t: rng.float(0, 6.28) });
    stageCache[idx] = d;
    return d;
  }

  function drawStage(ctx, idx, camX, time) {
    const d = stageData(idx);
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    switch (idx) {
      case 0: { // Dusk Dojo
        g.addColorStop(0, '#2b1055'); g.addColorStop(0.55, '#d53369'); g.addColorStop(1, '#ffb86c');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND_Y);
        const sunX = 560 - camX * 0.05;
        const sg = ctx.createRadialGradient(sunX, 330, 20, sunX, 330, 190);
        sg.addColorStop(0, 'rgba(255,230,160,0.95)'); sg.addColorStop(0.35, 'rgba(255,200,120,0.5)'); sg.addColorStop(1, 'rgba(255,160,100,0)');
        ctx.fillStyle = sg; ctx.fillRect(sunX - 200, 130, 400, 400);
        circle(ctx, sunX, 330, 62, '#ffe0a3');
        ctx.fillStyle = '#4a1d5e';
        ctx.beginPath(); ctx.moveTo(0, GROUND_Y);
        for (const m of d.far) { const x = m.x - camX * 0.15; ctx.lineTo(x, 380 - m.h * 0.7); ctx.lineTo(x + m.w * 0.5, 400); }
        ctx.lineTo(W, GROUND_Y); ctx.fill();
        ctx.fillStyle = '#2a0f38';
        for (const m of d.mid) {
          const x = m.x - camX * 0.45;
          if (x < -150 || x > W + 150) continue;
          if (m.c < 2) { // pagoda
            ctx.fillRect(x + 10, 470 - m.h * 0.8, 24, m.h * 0.8);
            for (let k = 0; k < 3; k++) {
              const yy = 470 - m.h * 0.8 + k * 26;
              ctx.beginPath(); ctx.moveTo(x - 16 - k * 4, yy + 10); ctx.lineTo(x + 22, yy - 12); ctx.lineTo(x + 60 + k * 4, yy + 10); ctx.fill();
            }
          } else { // tree
            ctx.fillRect(x + 20, 400, 8, 80);
            circle(ctx, x + 24, 395, 26 + m.s * 12, '#2a0f38');
          }
        }
        // lanterns
        for (let i = 0; i < 6; i++) {
          const x = i * 300 + 80 - camX * 0.8;
          const sw = Math.sin(time / 700 + i) * 4;
          line(ctx, x, 0, x + sw, 70, 2, '#2b1a1a');
          const lg = ctx.createRadialGradient(x + sw, 86, 2, x + sw, 86, 40);
          lg.addColorStop(0, 'rgba(255,120,60,0.55)'); lg.addColorStop(1, 'rgba(255,120,60,0)');
          ctx.fillStyle = lg; ctx.fillRect(x + sw - 40, 46, 80, 80);
          ctx.fillStyle = '#e63946'; rr(ctx, x + sw - 11, 70, 22, 30, 9); ctx.fill();
        }
        ctx.fillStyle = '#7a4a2a'; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#6a3e22' : '#855433'; ctx.fillRect(0, GROUND_Y + i * 16, W, 8); }
        ctx.strokeStyle = 'rgba(40,20,10,0.5)'; ctx.lineWidth = 2;
        for (let x = -((camX) % 120); x < W; x += 120) { ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo(x - 30, H); ctx.stroke(); }
        break;
      }
      case 1: { // Neon Alley
        g.addColorStop(0, '#07081c'); g.addColorStop(1, '#2a1250');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND_Y);
        for (let i = 0; i < 40; i++) { const s = d.deco[i]; circle(ctx, (s.x - camX * 0.05) % W, s.y * 200, 1 + s.s, 'rgba(255,255,255,' + (0.3 + 0.3 * Math.sin(time / 500 + s.t)) + ')'); }
        for (const b of d.far) {
          const x = b.x - camX * 0.2;
          if (x < -200 || x > W + 50) continue;
          const top = 300 - b.h;
          ctx.fillStyle = '#141a3a'; ctx.fillRect(x, top, b.w, GROUND_Y - top);
          ctx.fillStyle = 'rgba(255,214,102,0.55)';
          for (let wy = top + 10; wy < GROUND_Y - 30; wy += 18) for (let wx = x + 8; wx < x + b.w - 10; wx += 16) if ((Math.floor(wx * 7 + wy * 3 + b.s * 100)) % 5 < 2) ctx.fillRect(wx, wy, 7, 9);
        }
        for (const b of d.mid) {
          const x = b.x - camX * 0.5;
          if (x < -200 || x > W + 50) continue;
          const top = 360 - b.h * 0.6;
          ctx.fillStyle = '#0b0d22'; ctx.fillRect(x, top, b.w + 40, GROUND_Y - top);
          const neon = ['#ff2e97', '#00f0ff', '#b8ff3b', '#ffae00', '#b066ff'][b.c];
          const on = Math.sin(time / 300 + b.s * 10) > -0.8;
          ctx.save();
          ctx.shadowColor = neon; ctx.shadowBlur = on ? 16 : 0;
          ctx.strokeStyle = on ? neon : rgba(neon, 0.3); ctx.lineWidth = 3;
          rr(ctx, x + 10, top + 20, b.w + 18, 26, 6); ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = '#16161f'; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
        const pg = ctx.createLinearGradient(0, GROUND_Y, 0, H);
        pg.addColorStop(0, 'rgba(255,46,151,0.18)'); pg.addColorStop(1, 'rgba(0,240,255,0.05)');
        ctx.fillStyle = pg; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
        ctx.fillStyle = '#e9d8a6';
        for (let x = -(camX % 160); x < W; x += 160) ctx.fillRect(x, GROUND_Y + 34, 70, 5);
        break;
      }
      case 2: { // Magma Pit
        g.addColorStop(0, '#120000'); g.addColorStop(0.6, '#4a0808'); g.addColorStop(1, '#ff5500');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND_Y);
        const vx = 480 - camX * 0.12;
        ctx.fillStyle = '#1c0505';
        ctx.beginPath(); ctx.moveTo(vx - 420, GROUND_Y); ctx.lineTo(vx - 70, 170); ctx.lineTo(vx + 70, 170); ctx.lineTo(vx + 420, GROUND_Y); ctx.fill();
        const glow = 0.6 + 0.3 * Math.sin(time / 400);
        ctx.strokeStyle = 'rgba(255,120,0,' + glow + ')'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(vx - 20, 172); ctx.quadraticCurveTo(vx - 60, 280, vx - 150, 460); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(vx + 25, 172); ctx.quadraticCurveTo(vx + 90, 300, vx + 120, 460); ctx.stroke();
        const cg = ctx.createRadialGradient(vx, 160, 5, vx, 160, 110);
        cg.addColorStop(0, 'rgba(255,200,50,0.8)'); cg.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = cg; ctx.fillRect(vx - 110, 50, 220, 220);
        ctx.fillStyle = '#2a0d0d';
        for (const m of d.mid) {
          const x = m.x - camX * 0.5;
          if (x < -150 || x > W + 150) continue;
          ctx.beginPath(); ctx.moveTo(x - 40, GROUND_Y); ctx.lineTo(x + 10, GROUND_Y - m.h * 0.5); ctx.lineTo(x + 40, GROUND_Y - m.h * 0.3); ctx.lineTo(x + 80, GROUND_Y); ctx.fill();
        }
        for (const e of d.deco) {
          const yy = (1 - ((time / 6000 + e.s) % 1)) * GROUND_Y;
          const xx = (e.x - camX * 0.7 + Math.sin(time / 800 + e.t) * 20) % 1100 - 70;
          circle(ctx, xx, yy, 1.5 + e.s * 1.5, 'rgba(255,' + Math.floor(120 + e.s * 100) + ',0,' + (0.4 + e.s * 0.5) + ')');
        }
        ctx.fillStyle = '#2b1a14'; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
        ctx.strokeStyle = 'rgba(255,90,0,' + (0.5 + 0.3 * Math.sin(time / 300)) + ')'; ctx.lineWidth = 3;
        for (let x = -(camX % 200); x < W; x += 200) { ctx.beginPath(); ctx.moveTo(x, GROUND_Y + 10); ctx.lineTo(x + 40, GROUND_Y + 30); ctx.lineTo(x + 20, GROUND_Y + 55); ctx.stroke(); }
        break;
      }
      case 3: { // Orbital Ring
        ctx.fillStyle = '#03030a'; ctx.fillRect(0, 0, W, GROUND_Y);
        const ng = ctx.createRadialGradient(300, 150, 10, 300, 150, 380);
        ng.addColorStop(0, 'rgba(120,40,200,0.35)'); ng.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ng; ctx.fillRect(0, 0, W, GROUND_Y);
        for (const s of d.deco) circle(ctx, (s.x - camX * 0.03) % W, s.y * 420, 0.6 + s.s * 1.2, 'rgba(255,255,255,' + (0.4 + 0.5 * Math.abs(Math.sin(time / 900 + s.t))) + ')');
        const px = 700 - camX * 0.05;
        const plg = ctx.createRadialGradient(px - 40, 140, 10, px, 170, 110);
        plg.addColorStop(0, '#7fdbff'); plg.addColorStop(1, '#0b3d91');
        ctx.fillStyle = plg; circle(ctx, px, 170, 95, plg);
        ctx.strokeStyle = 'rgba(200,230,255,0.6)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(px, 175, 170, 28, -0.25, 0, Math.PI * 2); ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const x = i * 260 - camX * 0.7;
          ctx.fillStyle = '#1e2430'; ctx.fillRect(x, 0, 34, GROUND_Y);
          ctx.fillStyle = '#00e5ff'; ctx.fillRect(x + 14, 40, 6, GROUND_Y - 80);
        }
        ctx.fillStyle = '#1e2430'; ctx.fillRect(0, 0, W, 26);
        ctx.fillStyle = '#3a4250'; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
        ctx.strokeStyle = 'rgba(0,229,255,0.35)'; ctx.lineWidth = 1;
        for (let x = -(camX % 60); x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo(x + (x - W / 2) * 0.3, H); ctx.stroke(); }
        ctx.fillStyle = '#00e5ff'; ctx.fillRect(0, GROUND_Y, W, 3);
        break;
      }
      case 4: { // Salt Beach
        g.addColorStop(0, '#2d9cdb'); g.addColorStop(1, '#bde8ff');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND_Y);
        circle(ctx, 800 - camX * 0.04, 90, 44, '#fff3b0');
        for (let i = 0; i < 6; i++) {
          const c = d.far[i];
          const x = ((c.x + time / 60 - camX * 0.1) % 1300) - 150;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath(); ctx.ellipse(x, 60 + c.s * 90, 60, 18, 0, 0, Math.PI * 2); ctx.ellipse(x + 34, 50 + c.s * 90, 40, 20, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#0277bd'; ctx.fillRect(0, 330, W, 80);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
        for (let r = 0; r < 4; r++) {
          ctx.beginPath();
          for (let x = 0; x <= W; x += 20) ctx.lineTo(x, 345 + r * 18 + Math.sin(x / 40 + time / 500 + r) * 3);
          ctx.stroke();
        }
        ctx.fillStyle = '#f6dca5'; ctx.fillRect(0, 405, W, GROUND_Y - 405);
        for (const m of d.mid) {
          const x = m.x - camX * 0.55;
          if (x < -150 || x > W + 150 || m.c > 2) continue;
          ctx.strokeStyle = '#6d4c2f'; ctx.lineWidth = 10;
          ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.quadraticCurveTo(x + 20, 360, x + 40, 280); ctx.stroke();
          ctx.fillStyle = '#2e7d32';
          for (let k = 0; k < 5; k++) {
            const a = -2.6 + k * 0.55 + Math.sin(time / 900 + m.s * 6) * 0.05;
            ctx.beginPath(); ctx.moveTo(x + 40, 280); ctx.quadraticCurveTo(x + 40 + Math.cos(a) * 40, 280 + Math.sin(a) * 40 - 10, x + 40 + Math.cos(a) * 80, 280 + Math.sin(a) * 60 + 20); ctx.lineTo(x + 40 + Math.cos(a) * 70, 280 + Math.sin(a) * 50 + 24); ctx.fill();
          }
        }
        ctx.fillStyle = '#eccb86'; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
        ctx.fillStyle = 'rgba(160,120,60,0.35)';
        for (const s of d.deco) ctx.fillRect((s.x - camX) % W, GROUND_Y + 6 + s.y * 55, 3, 2);
        break;
      }
      default: { // The Salt Mine
        g.addColorStop(0, '#0c0c12'); g.addColorStop(1, '#262636');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND_Y);
        ctx.fillStyle = '#1b1b26';
        for (const m of d.far) {
          const x = m.x - camX * 0.2;
          ctx.beginPath(); ctx.moveTo(x - 60, 0); ctx.lineTo(x, m.h * 0.6); ctx.lineTo(x + 70, 0); ctx.fill();
        }
        for (const m of d.mid) {
          const x = m.x - camX * 0.5;
          if (x < -120 || x > W + 120) continue;
          const gl = 0.55 + 0.45 * Math.abs(Math.sin(time / 700 + m.s * 9));
          ctx.fillStyle = 'rgba(235,235,255,' + (0.5 + 0.3 * gl) + ')';
          ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo(x + 12, GROUND_Y - m.h * 0.5); ctx.lineTo(x + 26, GROUND_Y - m.h * 0.35); ctx.lineTo(x + 36, GROUND_Y); ctx.fill();
          ctx.fillStyle = 'rgba(255,200,220,0.5)';
          ctx.beginPath(); ctx.moveTo(x + 30, GROUND_Y); ctx.lineTo(x + 44, GROUND_Y - m.h * 0.3); ctx.lineTo(x + 56, GROUND_Y); ctx.fill();
        }
        for (let i = 0; i < 7; i++) {
          const x = i * 240 + 60 - camX * 0.6;
          line(ctx, x, 0, x, 60, 2, '#555');
          const lg = ctx.createRadialGradient(x, 72, 3, x, 72, 120);
          lg.addColorStop(0, 'rgba(255,190,90,0.45)'); lg.addColorStop(1, 'rgba(255,190,90,0)');
          ctx.fillStyle = lg; ctx.fillRect(x - 120, 0, 240, 200);
          circle(ctx, x, 72, 8, '#ffcf70');
        }
        ctx.fillStyle = '#cfcfd8'; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
        ctx.fillStyle = '#6b4f3a';
        for (let x = -(camX % 40); x < W; x += 40) ctx.fillRect(x, GROUND_Y + 22, 24, 8);
        ctx.fillStyle = '#8a8a96'; ctx.fillRect(0, GROUND_Y + 18, W, 4); ctx.fillRect(0, GROUND_Y + 32, W, 4);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ Stream
  function Stream(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audio = opts.audio || null;
    this.match = null;
    this.sim = null;
    this.simKey = null;
    this.particles = [];
    this.shake = 0;
    this.cam = Fight.STAGE_W / 2 - W / 2;
    this.trail = [1, 1];
    this.combo = [null, null];
    this.lastFrame = 0;
    this.superFlash = null;
  }

  Stream.STAGE_NAMES = STAGE_NAMES;
  Stream.drawFighter = drawFighter;

  Stream.prototype.setMatch = function (m) {
    this.match = m;
    if (m && m.fight) {
      const key = m.id + ':' + m.fight.seed;
      if (key !== this.simKey) {
        this.simKey = key;
        this.sim = Fight.create(m.fight);
        this.particles = [];
        this.trail = [1, 1];
        this.combo = [null, null];
        this.cam = Fight.STAGE_W / 2 - W / 2;
      }
    } else if (!m || !m.fight) {
      this.sim = null;
      this.simKey = null;
    }
  };

  Stream.prototype.frame = function (now) {
    const c = this.canvas, ctx = this.ctx;
    const k = c.width / W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const realNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this.lastFrame ? Math.min(100, realNow - this.lastFrame) : 16;
    this.lastFrame = realNow;
    const m = this.match;
    if (!m) { this.drawWaiting(ctx, realNow, 'Connecting to the Salt Mine…'); return; }
    if (!this.sim || now < m.startAt) { this.drawVS(ctx, m, now, realNow); return; }

    const sim = this.sim;
    const tps = m.fight.tps || 60;
    const target = Math.floor((now - m.startAt) * tps / 1000);
    let steps = 0;
    const behind = target - sim.tick;
    while (sim.tick < target && sim.phase !== 'done' && steps < 30000) {
      Fight.step(sim);
      steps++;
      if (behind < 20 || target - sim.tick < 4) this.handleEvents(sim.events, realNow);
    }
    this.drawFight(ctx, sim, m, realNow, dt);
  };

  Stream.prototype.handleEvents = function (events, t) {
    const au = this.audio;
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const n = e.super ? 16 : e.heavy ? 12 : 7;
          const colr = e.super ? '#ff4fd8' : e.heavy ? '#ffd23f' : '#fff3b0';
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * (e.heavy ? 9 : 5);
            this.particles.push({ kind: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 14 + Math.random() * 10, c: colr, s: e.heavy ? 3 : 2 });
          }
          this.particles.push({ kind: 'ring', x: e.x, y: e.y, life: 0, max: e.heavy ? 16 : 10, c: colr, s: e.heavy ? 50 : 28 });
          this.shake = Math.max(this.shake, e.super ? 10 : e.heavy ? 7 : 2.5);
          if (au) au.play(e.heavy || e.super ? 'hitHeavy' : 'hit');
          break;
        }
        case 'block':
          for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            this.particles.push({ kind: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, life: 0, max: 12, c: '#7fdbff', s: 2 });
          }
          this.particles.push({ kind: 'ring', x: e.x, y: e.y, life: 0, max: 10, c: '#7fdbff', s: 30 });
          if (au) au.play('block');
          break;
        case 'clash':
          this.particles.push({ kind: 'ring', x: e.x, y: e.y, life: 0, max: 18, c: '#ffffff', s: 70 });
          if (au) au.play('hitHeavy');
          break;
        case 'land': case 'thud':
          for (let i = 0; i < (e.type === 'thud' ? 8 : 4); i++) {
            this.particles.push({ kind: 'dust', x: e.x + (Math.random() - 0.5) * 40, y: 4, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 1.2, life: 0, max: 26, c: 'rgba(220,210,190,', s: 6 + Math.random() * 8 });
          }
          if (e.type === 'thud') { this.shake = Math.max(this.shake, 4); if (au) au.play('thud'); }
          break;
        case 'teleport': {
          const f = e.side === 'red' ? this.sim.f[0] : this.sim.f[1];
          for (let i = 0; i < 10; i++) this.particles.push({ kind: 'dust', x: f.x + (Math.random() - 0.5) * 50, y: 20 + Math.random() * 100, vx: 0, vy: 0.5, life: 0, max: 24, c: 'rgba(150,80,220,', s: 8 + Math.random() * 10 });
          if (au) au.play('whoosh');
          break;
        }
        case 'whoosh': if (au && (e.key === 'heavy' || e.key === 'kick')) au.play('whoosh'); break;
        case 'proj': if (au) au.play(e.super ? 'super' : 'proj'); break;
        case 'super':
          this.superFlash = { side: e.side, name: e.name, t: t };
          if (au) au.play('super');
          break;
        case 'ko': if (au) au.play('ko'); break;
        case 'announce': if (au && (e.text === 'FIGHT!')) au.play('fight'); break;
        case 'jump': break;
      }
    }
  };

  Stream.prototype.drawFight = function (ctx, sim, m, t, dt) {
    const a = sim.f[0], b = sim.f[1];
    const targetCam = Math.max(0, Math.min(Fight.STAGE_W - W, (a.x + b.x) / 2 - W / 2));
    this.cam += (targetCam - this.cam) * Math.min(1, dt / 90);
    if (sim.phase === 'intro' && sim.pt < 3) this.cam = targetCam;
    const cam = this.cam;
    const sx = function (x) { return x - cam; };
    const sy = function (y) { return GROUND_Y - y; };

    ctx.save();
    if (this.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.pow(0.86, dt / 16);
    }
    drawStage(ctx, m.fight.stage || 0, cam, t);

    // super darken
    let superOn = null;
    for (const f of sim.f) if (f.state === 'attack' && f.mv && f.mv.super && f.t <= f.mv.startup) superOn = f;
    if (superOn) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    // shadows
    for (const f of sim.f) {
      const s = Math.max(0.35, 1 - f.y / 260);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * s) + ')';
      ctx.beginPath();
      ctx.ellipse(sx(f.x), GROUND_Y + 2, f.w * 0.75 * s, 7 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // fighters: the attacker is drawn in front
    const order = (a.state === 'attack' && b.state !== 'attack') ? [b, a] : [a, b];
    for (const f of order) {
      const look = (f.side === 'red' ? m.fight.red : m.fight.blue).look;
      let flash = null;
      if (f.state === 'hitstun' && f.t < 3) flash = '#ffffff';
      else if (f.state === 'blockstun' && f.t < 2) flash = '#bde0fe';
      if (f.state === 'attack' && f.mv && f.mv.super && f.t <= f.mv.startup && Math.floor(f.t / 3) % 2) flash = '#fff6c2';
      drawFighter(ctx, f, look, sx(f.x), sy(f.y), 1, { flash: flash, time: t });
    }

    // beams
    for (const f of sim.f) {
      if (f.state !== 'attack' || !f.mv || f.mv.kind !== 'beam') continue;
      const mv = f.mv;
      if (f.t <= mv.startup || f.t > mv.startup + mv.active) {
        if (f.t <= mv.startup) {
          const cx = sx(f.x + f.face * (f.w * 0.5 + 16)), cy = sy(f.y + f.h * (mv.lo + mv.hi) / 2);
          const r = 6 + 14 * (f.t / mv.startup);
          const look = (f.side === 'red' ? m.fight.red : m.fight.blue).look;
          const gg = ctx.createRadialGradient(cx, cy, 1, cx, cy, r * 2);
          gg.addColorStop(0, '#ffffff'); gg.addColorStop(0.4, look.accent); gg.addColorStop(1, rgba(look.accent, 0));
          ctx.fillStyle = gg; ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
        }
        continue;
      }
      const o = f === a ? b : a;
      const front = f.x + f.face * f.w * 0.5;
      let end = front + f.face * mv.reach;
      const yLo = f.y + mv.lo * f.h, yHi = f.y + mv.hi * f.h;
      const inFront = Math.sign(o.x - f.x) === f.face;
      const yOverlap = o.y < yHi && o.y + o.h > yLo;
      if (inFront && yOverlap && Math.abs(o.x - front) < mv.reach && o.state !== 'down' && o.state !== 'ko') end = o.x - f.face * o.w * 0.3;
      const look = (f.side === 'red' ? m.fight.red : m.fight.blue).look;
      const x1 = sx(front), x2 = sx(end);
      const y1 = sy(yHi), y2 = sy(yLo);
      const mid = (y1 + y2) / 2, hh = (y2 - y1) / 2 * (0.85 + 0.15 * Math.sin(t / 30));
      const bg = ctx.createLinearGradient(0, mid - hh, 0, mid + hh);
      bg.addColorStop(0, rgba(look.accent, 0));
      bg.addColorStop(0.3, rgba(look.accent, 0.9));
      bg.addColorStop(0.5, '#ffffff');
      bg.addColorStop(0.7, rgba(look.accent, 0.9));
      bg.addColorStop(1, rgba(look.accent, 0));
      ctx.fillStyle = bg;
      ctx.fillRect(Math.min(x1, x2), mid - hh, Math.abs(x2 - x1), hh * 2);
      circle(ctx, x2, mid, hh * 1.1, rgba('#ffffff', 0.8));
    }

    // projectiles
    for (const p of sim.projectiles) {
      const owner = p.owner === 'red' ? m.fight.red : m.fight.blue;
      const x = sx(p.x), y = sy(p.y);
      const r = p.w / 2;
      const pulse = 1 + 0.12 * Math.sin(t / 40 + p.id);
      const gg = ctx.createRadialGradient(x, y, 2, x, y, r * 1.6 * pulse);
      gg.addColorStop(0, '#ffffff');
      gg.addColorStop(0.35, owner.look.accent);
      gg.addColorStop(1, rgba(owner.look.accent, 0));
      ctx.fillStyle = gg;
      ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
      if (Math.random() < 0.7) this.particles.push({ kind: 'dust', x: p.x - p.vx * 2, y: p.y + (Math.random() - 0.5) * p.h * 0.5, vx: -p.vx * 0.1, vy: 0, life: 0, max: 14, c: 'rgba(255,255,255,', s: r * 0.4 });
      if (p.super) {
        ctx.strokeStyle = rgba('#ffffff', 0.6);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, r * pulse, t / 100, t / 100 + 4); ctx.stroke();
      }
    }

    // particles
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life += dt / 16.7;
      if (p.life >= p.max) { ps.splice(i, 1); continue; }
      const k = p.life / p.max;
      if (p.kind === 'spark') {
        p.x += p.vx * dt / 16.7; p.y += p.vy * dt / 16.7;
        line(ctx, sx(p.x), sy(p.y), sx(p.x - p.vx * 2), sy(p.y - p.vy * 2), p.s * (1 - k), p.c);
      } else if (p.kind === 'ring') {
        ctx.strokeStyle = rgba(p.c, 1 - k);
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.s * (0.3 + k), 0, Math.PI * 2); ctx.stroke();
      } else {
        p.x += p.vx * dt / 16.7; p.y += p.vy * dt / 16.7;
        circle(ctx, sx(p.x), sy(p.y), p.s * (0.6 + k), p.c + (0.45 * (1 - k)) + ')');
      }
    }
    if (ps.length > 400) ps.splice(0, ps.length - 400);
    ctx.restore();

    this.drawHUD(ctx, sim, m, t);
  };

  Stream.prototype.drawHUD = function (ctx, sim, m, t) {
    const a = sim.f[0], b = sim.f[1];
    const self = this;
    // health bars
    [a, b].forEach(function (f, i) {
      const ratio = f.hp / f.maxHp;
      if (self.trail[i] < ratio) self.trail[i] = ratio;
      else if (f.state !== 'hitstun' || sim.phase !== 'fight') self.trail[i] += (ratio - self.trail[i]) * 0.06;
      const x = i === 0 ? 20 : 540, w = 400, y = 16, h = 24;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath();
      if (i === 0) { ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + w + 12, y - 4); ctx.lineTo(x + w + 4, y + h + 4); ctx.lineTo(x - 4, y + h + 4); }
      else { ctx.moveTo(x - 12, y - 4); ctx.lineTo(x + w + 4, y - 4); ctx.lineTo(x + w + 4, y + h + 4); ctx.lineTo(x - 4, y + h + 4); }
      ctx.fill();
      ctx.fillStyle = '#5a0000';
      ctx.fillRect(x, y, w, h);
      const tw = w * Math.max(0, self.trail[i]);
      ctx.fillStyle = '#ff5a3c';
      if (i === 0) ctx.fillRect(x, y, tw, h); else ctx.fillRect(x + w - tw, y, tw, h);
      const fw = w * ratio;
      const lg = ctx.createLinearGradient(0, y, 0, y + h);
      const low = ratio < 0.25 && Math.floor(t / 250) % 2;
      lg.addColorStop(0, low ? '#ffb3b3' : '#fff3a0');
      lg.addColorStop(0.5, low ? '#ff4d4d' : '#ffd400');
      lg.addColorStop(1, low ? '#b30000' : '#e0a100');
      ctx.fillStyle = lg;
      if (i === 0) ctx.fillRect(x, y, fw, h); else ctx.fillRect(x + w - fw, y, fw, h);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      // name
      ctx.font = 'italic 900 19px "Arial Black", Impact, sans-serif';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      const name = f.name.toUpperCase();
      const nx = i === 0 ? x : x + w;
      ctx.strokeText(name, nx, y + h + 22);
      ctx.fillStyle = i === 0 ? '#ff6b6b' : '#6ba8ff';
      ctx.fillText(name, nx, y + h + 22);
      // round markers
      for (let r = 0; r < Fight.ROUNDS_TO_WIN; r++) {
        const cx = i === 0 ? x + w - 10 - r * 22 : x + 10 + r * 22;
        ctx.fillStyle = f.roundWins > r ? '#ffd23f' : 'rgba(0,0,0,0.6)';
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, y + h + 15, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      // power meter
      const mx = i === 0 ? 20 : 700, my = 506, mw = 240, mh = 14;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
      const mk = f.meter / Fight.METER_MAX;
      const full = mk >= 1;
      ctx.fillStyle = full ? (Math.floor(t / 120) % 2 ? '#00e5ff' : '#ffffff') : '#1e88e5';
      if (i === 0) ctx.fillRect(mx, my, mw * mk, mh); else ctx.fillRect(mx + mw - mw * mk, my, mw * mk, mh);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(mx, my, mw, mh);
      ctx.font = 'italic 900 13px "Arial Black", Impact, sans-serif';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillStyle = full ? '#ffd23f' : '#fff';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      const lbl = full ? 'SUPER READY' : 'POWER';
      ctx.strokeText(lbl, i === 0 ? mx : mx + mw, my - 6);
      ctx.fillText(lbl, i === 0 ? mx : mx + mw, my - 6);
      ctx.restore();
    });

    // timer
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    rr(ctx, 446, 8, 68, 52, 8); ctx.fill();
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = '900 38px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = sim.timer <= 10 && sim.phase === 'fight' && Math.floor(t / 300) % 2 ? '#ff4d4d' : '#fff';
    ctx.fillText(String(sim.timer).padStart(2, '0'), 480, 49);
    ctx.restore();

    // combo counters
    [a, b].forEach(function (f, i) {
      const def = i === 0 ? b : a;
      if (def.combo >= 2) self.combo[i] = { n: def.combo, dmg: def.comboDmg, until: t + 1200 };
      const c = self.combo[i];
      if (!c || t > c.until) return;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (c.until - t) / 300);
      ctx.textAlign = i === 0 ? 'left' : 'right';
      const x = i === 0 ? 24 : 936;
      ctx.font = 'italic 900 42px "Arial Black", Impact, sans-serif';
      ctx.lineWidth = 6; ctx.strokeStyle = '#000';
      ctx.strokeText(c.n + ' HITS', x, 214);
      ctx.fillStyle = '#ff9f1c';
      ctx.fillText(c.n + ' HITS', x, 214);
      ctx.font = 'italic 800 16px "Arial Black", Impact, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeText(c.dmg + ' DAMAGE', x, 238);
      ctx.fillStyle = '#fff';
      ctx.fillText(c.dmg + ' DAMAGE', x, 238);
      ctx.restore();
    });

    // super move name
    if (this.superFlash && t - this.superFlash.t < 1300) {
      const sf = this.superFlash;
      const k = (t - sf.t) / 1300;
      ctx.save();
      ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      const left = sf.side === 'red';
      const y = 120;
      ctx.fillStyle = left ? 'rgba(200,20,40,0.85)' : 'rgba(20,70,200,0.85)';
      const slide = Math.min(1, k * 6);
      ctx.fillRect(left ? -20 + (1 - slide) * -400 : 380 + (1 - slide) * 400, y - 32, 600, 46);
      ctx.font = 'italic 900 30px "Arial Black", Impact, sans-serif';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillStyle = '#fff';
      ctx.fillText((SB.Roster.SUPER_NAMES[sf.name] || 'SUPER').toUpperCase() + '!', left ? 30 : 930, y);
      ctx.restore();
    }

    // announcements (derived from the simulation state)
    let text = null, pt = 0, color = '#ffd23f', size = 76;
    if (sim.phase === 'intro') {
      if (sim.pt < Fight.T.FIGHT_AT) {
        const final = a.roundWins === Fight.ROUNDS_TO_WIN - 1 && b.roundWins === Fight.ROUNDS_TO_WIN - 1;
        text = final ? 'FINAL ROUND' : 'ROUND ' + sim.round; pt = sim.pt; color = '#ffffff'; size = 64;
      } else { text = 'FIGHT!'; pt = sim.pt - Fight.T.FIGHT_AT; color = '#ff4d4d'; size = 96; }
    } else if (sim.phase === 'ko') {
      if (sim.pt < 120) { text = sim.roundWinner ? 'K.O.' : 'DOUBLE K.O.'; pt = sim.pt; color = '#ff2d2d'; size = 110; }
    } else if (sim.phase === 'timeover') {
      text = 'TIME OVER'; pt = sim.pt; color = '#ffffff'; size = 80;
    } else if (sim.phase === 'roundover') {
      const last = sim.roundLog[sim.roundLog.length - 1];
      if (last && last.winner) {
        const wf = last.winner === 'red' ? a : b;
        const perfect = (last.winner === 'red' ? last.redHp : last.blueHp) >= wf.maxHp;
        text = perfect ? 'PERFECT' : null; pt = sim.pt; size = 80;
      } else { text = 'DRAW'; pt = sim.pt; }
    } else if (sim.phase === 'matchover' || sim.phase === 'done') {
      const wf = sim.winner === 'red' ? a : b;
      text = wf.name.toUpperCase() + ' WINS'; pt = sim.phase === 'done' ? 99 : sim.pt; size = 60;
      color = sim.winner === 'red' ? '#ff5a5a' : '#5a9bff';
    }
    if (text) {
      const pop = Math.min(1, pt / 8);
      const sc = 1 + (1 - pop) * 0.8;
      ctx.save();
      ctx.translate(W / 2, H / 2 - 10);
      ctx.scale(sc, sc);
      ctx.globalAlpha = pop;
      ctx.font = 'italic 900 ' + size + 'px "Arial Black", Impact, sans-serif';
      let fs = size;
      while (ctx.measureText(text).width > W - 60 && fs > 24) { fs -= 4; ctx.font = 'italic 900 ' + fs + 'px "Arial Black", Impact, sans-serif'; }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 10; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    if (sim.phase === 'done' || (m.phase === 'payout' && sim.phase === 'matchover' && sim.pt > 120)) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      rr(ctx, 330, 330, 300, 38, 10); ctx.fill();
      ctx.font = '800 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText('Next match is loading…', 480, 355);
      ctx.restore();
    }
  };

  Stream.prototype.drawVS = function (ctx, m, now, t) {
    // split background
    ctx.save();
    const lg = ctx.createLinearGradient(0, 0, W / 2, H);
    lg.addColorStop(0, '#3d0008'); lg.addColorStop(1, '#c1121f');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(540, 0); ctx.lineTo(420, H); ctx.lineTo(0, H); ctx.fill();
    const bg = ctx.createLinearGradient(W, 0, W / 2, H);
    bg.addColorStop(0, '#00123d'); bg.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(540, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(420, H); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 18;
    const off = (t / 25) % 60;
    for (let x = -600; x < W + 600; x += 60) { ctx.beginPath(); ctx.moveTo(x + off, 0); ctx.lineTo(x + off - 300, H); ctx.stroke(); }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(540, 0); ctx.lineTo(420, H); ctx.stroke();

    const frame = Math.floor(t / 16.7);
    const sides = [['red', m.red, 250, 1], ['blue', m.blue, 710, -1]];
    for (const s of sides) {
      const card = s[1];
      const f = { state: 'idle', t: frame, face: s[3], y: 0, walkDir: 0, invuln: 0, st: card.stats, mv: null };
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(s[2], 452, 70 * card.stats.size, 12, 0, 0, Math.PI * 2); ctx.fill();
      drawFighter(ctx, f, card.look, s[2], 450, 2, { time: t });
    }
    // names
    ctx.textBaseline = 'alphabetic';
    for (const s of sides) {
      const card = s[1];
      const left = s[0] === 'red';
      const x = left ? 28 : W - 28;
      ctx.textAlign = left ? 'left' : 'right';
      ctx.font = 'italic 900 34px "Arial Black", Impact, sans-serif';
      let fs = 34;
      while (ctx.measureText(card.name.toUpperCase()).width > 390 && fs > 18) { fs -= 2; ctx.font = 'italic 900 ' + fs + 'px "Arial Black", Impact, sans-serif'; }
      ctx.lineWidth = 7; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
      ctx.strokeText(card.name.toUpperCase(), x, 62);
      ctx.fillStyle = '#fff';
      ctx.fillText(card.name.toUpperCase(), x, 62);
      ctx.font = '800 15px system-ui, sans-serif';
      const r = card.record;
      const games = r.w + r.l;
      const info = card.tier + ' TIER  •  ' + r.w + 'W-' + r.l + 'L' + (games ? ' (' + Math.round(r.w * 100 / games) + '%)' : '') + '  •  ELO ' + r.elo;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      const iw = ctx.measureText(info).width + 20;
      ctx.fillRect(left ? x - 8 : x - iw + 8, 72, iw, 26);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(info, left ? x + 2 : x - 2, 90);
    }
    // VS
    const pulse = 1 + 0.05 * Math.sin(t / 200);
    ctx.save();
    ctx.translate(480, 262);
    ctx.scale(pulse, pulse);
    ctx.font = 'italic 900 120px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 12; ctx.strokeStyle = '#000';
    ctx.strokeText('VS', 0, 0);
    const vg = ctx.createLinearGradient(0, -50, 0, 50);
    vg.addColorStop(0, '#fff7ae'); vg.addColorStop(1, '#ff9f1c');
    ctx.fillStyle = vg;
    ctx.fillText('VS', 0, 0);
    ctx.restore();

    // mode line
    let mode = m.mode.toUpperCase();
    if (m.info && m.info.round) mode += '  •  ' + m.info.round.toUpperCase() + '  •  ' + m.info.tier + ' TIER';
    else if (m.info && m.info.tier) mode += '  •  ' + m.info.tier + ' TIER';
    if (m.info && m.info.requestedBy) mode += '  •  REQUESTED BY ' + m.info.requestedBy.toUpperCase();
    ctx.font = '800 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const mw = ctx.measureText(mode).width + 30;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    rr(ctx, 480 - mw / 2, 118, mw, 28, 14); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(mode, 480, 137);

    // bottom band
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 472, W, 68);
    ctx.textAlign = 'center';
    if (m.phase === 'open') {
      const left = Math.max(0, Math.ceil((m.closesAt - now) / 1000));
      ctx.font = 'italic 900 30px "Arial Black", Impact, sans-serif';
      ctx.fillStyle = '#7CFC8A';
      ctx.fillText('BETS ARE OPEN!', 480, 506);
      ctx.font = '800 16px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('Betting closes in ' + left + 's  •  ' + m.bettors + ' bettors', 480, 530);
      const k = Math.max(0, Math.min(1, (m.closesAt - now) / (m.closesAt - m.openedAt)));
      ctx.fillStyle = k < 0.2 ? '#ff4d4d' : '#ffd23f';
      ctx.fillRect(0, 472, W * k, 4);
    } else {
      ctx.font = 'italic 900 26px "Arial Black", Impact, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('BETS ARE LOCKED', 480, 502);
      if (m.pots) {
        ctx.font = '800 17px system-ui, sans-serif';
        ctx.fillStyle = '#ff8080';
        ctx.textAlign = 'right';
        ctx.fillText(SB.League.money(m.pots.red), 460, 528);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('vs', 480, 528);
        ctx.fillStyle = '#80b0ff';
        ctx.textAlign = 'left';
        ctx.fillText(SB.League.money(m.pots.blue), 500, 528);
      }
    }
    ctx.restore();
  };

  Stream.prototype.drawWaiting = function (ctx, t, msg) {
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg, W / 2, H / 2);
    const k = (t / 600) % 1;
    for (let i = 0; i < 3; i++) circle(ctx, W / 2 - 20 + i * 20, H / 2 + 30, 5, 'rgba(255,210,63,' + (0.3 + 0.7 * ((k * 3 - i + 3) % 3 < 1 ? 1 : 0)) + ')');
  };

  SB.Stream = Stream;
})(globalThis.SB = globalThis.SB || {});
