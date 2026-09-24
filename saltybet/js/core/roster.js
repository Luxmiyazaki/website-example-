/* Salty Brawl – the roster.
 * Every character's stats and look are derived deterministically from its
 * name, so the server and every browser build exactly the same roster. */
(function (SB) {
  'use strict';

  const TIERS = ['X', 'S', 'A', 'B', 'P'];
  const TIER_NAMES = { X: 'X (Broken)', S: 'S', A: 'A', B: 'B', P: 'P (Potato)' };

  // Power budget per tier: [hp, atk, def, skill]
  const TIER_POWER = {
    X: { hp: 1.35, atk: 1.3, def: 1.25, skill: 0.92 },
    S: { hp: 1.14, atk: 1.12, def: 1.1, skill: 0.76 },
    A: { hp: 1.05, atk: 1.04, def: 1.03, skill: 0.62 },
    B: { hp: 1.0, atk: 1.0, def: 1.0, skill: 0.5 },
    P: { hp: 0.88, atk: 0.88, def: 0.9, skill: 0.34 }
  };
  const TIER_ELO = { X: 1900, S: 1700, A: 1560, B: 1450, P: 1300 };

  const ARCHETYPES = {
    brawler: {
      body: ['fighter'], hats: ['band', 'band', 'spiky', 'none', 'cap'], special: ['fireball'], super: ['mega'],
      m: { hp: 1, atk: 1, def: 1, spd: 1, jump: 1, reach: 1, aggr: 0.62, size: 1 }
    },
    brute: {
      body: ['brute'], hats: ['none', 'horns', 'mohawk', 'none'], special: ['dash'], super: ['rush'],
      m: { hp: 1.24, atk: 1.16, def: 1.08, spd: 0.72, jump: 0.86, reach: 1.12, aggr: 0.7, size: 1.2 }
    },
    speedster: {
      body: ['slim'], hats: ['spiky', 'cap', 'none', 'band'], special: ['dash'], super: ['rush'],
      m: { hp: 0.84, atk: 0.88, def: 0.95, spd: 1.5, jump: 1.14, reach: 0.92, aggr: 0.8, size: 0.9 }
    },
    ninja: {
      body: ['slim'], hats: ['mask'], special: ['teleport'], super: ['rush'],
      m: { hp: 0.9, atk: 0.96, def: 0.95, spd: 1.3, jump: 1.2, reach: 0.96, aggr: 0.66, size: 0.95 }
    },
    mage: {
      body: ['mage'], hats: ['wizard'], special: ['beam', 'fireball'], super: ['hyper'],
      m: { hp: 0.86, atk: 1.06, def: 0.92, spd: 0.86, jump: 0.95, reach: 0.92, aggr: 0.42, size: 0.96 }
    },
    robot: {
      body: ['robot'], hats: ['antenna'], special: ['beam', 'fireball'], super: ['hyper', 'mega'],
      m: { hp: 1.1, atk: 1, def: 1.18, spd: 0.84, jump: 0.8, reach: 1, aggr: 0.56, size: 1.06 }
    },
    blob: {
      body: ['blob'], hats: ['none', 'none', 'horns', 'party'], special: ['spin'], super: ['mega'],
      m: { hp: 1.16, atk: 0.96, def: 0.96, spd: 0.8, jump: 1.1, reach: 0.9, aggr: 0.6, size: 1 }
    },
    wrestler: {
      body: ['brute'], hats: ['luchador', 'none', 'mohawk'], special: ['uppercut'], super: ['rush'],
      m: { hp: 1.16, atk: 1.12, def: 1.04, spd: 0.9, jump: 0.92, reach: 0.96, aggr: 0.7, size: 1.12 }
    },
    boss: {
      body: ['fighter'], hats: ['crown', 'horns', 'halo'], special: ['fireball', 'teleport', 'uppercut'], super: ['mega', 'hyper'],
      m: { hp: 1.08, atk: 1.08, def: 1.04, spd: 1.04, jump: 1, reach: 1.04, aggr: 0.64, size: 1.1 }, cape: true
    },
    joke: {
      body: ['fighter', 'slim', 'blob'], hats: ['none', 'cap', 'party', 'bucket'], special: ['fireball', 'spin', 'dash'], super: ['mega'],
      m: { hp: 0.94, atk: 0.9, def: 0.95, spd: 0.92, jump: 1, reach: 0.95, aggr: 0.55, size: 0.92 }, clumsy: true
    }
  };

  // name, tier, archetype, optional look overrides
  const LIST = [
    // ---- X: broken ----
    ['Omega Toaster', 'X', 'robot', { main: '#c9ccd4', accent: '#ff5a1f', eyes: 'glow' }],
    ['God Hand Gary', 'X', 'boss', { hat: 'halo', main: '#f4f1e6', accent: '#ffd23f' }],
    ['Chaos Grandma', 'X', 'mage', { main: '#7b2cbf', hair: '#e8e8e8', accent: '#ff4fd8' }],
    ['Final Form Frank', 'X', 'boss', { hat: 'spiky', hair: '#ffe14d', main: '#ff7b00' }],
    ['The Unbeatable Pigeon', 'X', 'speedster', { skin: '#9aa1ad', main: '#5c6b7a', hat: 'none', accent: '#8ee3c8' }],
    ['Cosmic Janitor', 'X', 'mage', { main: '#1d3fbf', accent: '#7df9ff', hat: 'cap' }],
    ['Mecha Mecha Man', 'X', 'robot', { main: '#e63946', accent: '#ffd166' }],
    ['Absolute Unit', 'X', 'brute', { main: '#2b2d42', hat: 'horns' }],
    // ---- S ----
    ['Kung Fu Kevin', 'S', 'brawler', { main: '#f8f8f8', accent: '#111111', hat: 'band' }],
    ['Shadow Dentist', 'S', 'ninja', { main: '#1b1b2f', accent: '#e0fbfc' }],
    ['Thunder Nun', 'S', 'mage', { main: '#141414', accent: '#fff275', hat: 'hood' }],
    ['Mecha Samurai', 'S', 'robot', { main: '#8d0801', accent: '#e9c46a' }],
    ['Iron Walrus', 'S', 'brute', { main: '#6c757d', skin: '#8d6e63', beard: true }],
    ['Lord Spaghettus', 'S', 'boss', { main: '#e9c46a', accent: '#d62828', hat: 'crown' }],
    ['Captain Cardio', 'S', 'speedster', { main: '#00b4d8', accent: '#ffffff', hat: 'band' }],
    ['Neon Ronin', 'S', 'ninja', { main: '#240046', accent: '#39ff14' }],
    ['Blizzard Betty', 'S', 'mage', { main: '#a2d2ff', accent: '#ffffff' }],
    ['Doctor Suplex', 'S', 'wrestler', { main: '#ffffff', accent: '#e63946' }],
    ['Vampire Accountant', 'S', 'boss', { skin: '#e8e0f0', main: '#1a1a1a', accent: '#9d0208', hat: 'none' }],
    ['Turbo Monk', 'S', 'brawler', { main: '#f77f00', hat: 'none', hair: 'none' }],
    ['Dragon Lady Linda', 'S', 'brawler', { main: '#2d6a4f', accent: '#d8f3dc', hat: 'none' }],
    ['Sgt. Meatwall', 'S', 'brute', { main: '#606c38', hat: 'cap' }],
    ['Plasma Prince', 'S', 'mage', { main: '#ff006e', accent: '#fb5607', hat: 'crown' }],
    ['Gigachad Jr.', 'S', 'wrestler', { main: '#023047', hat: 'none', beard: true }],
    // ---- A ----
    ['Karate Chad', 'A', 'brawler', { main: '#ffffff', accent: '#000000' }],
    ['Ninja Nana', 'A', 'ninja', { main: '#5a189a', hair: '#dddddd' }],
    ['Disco Inferno', 'A', 'speedster', { main: '#ffbe0b', accent: '#ff006e', hat: 'spiky' }],
    ['Sir Punchalot', 'A', 'brawler', { main: '#adb5bd', hat: 'bucket' }],
    ['Robo-Plumber', 'A', 'robot', { main: '#d00000', accent: '#1d4ed8' }],
    ['Jelly Jimmy', 'A', 'blob', { main: '#80ffdb' }],
    ['Great Wall of Greg', 'A', 'brute', { main: '#9c6644' }],
    ['Pyro Pete', 'A', 'mage', { main: '#dc2f02', accent: '#ffba08', special: 'fireball' }],
    ['Mister Mustache', 'A', 'wrestler', { main: '#3a0ca3', beard: true }],
    ['Glass Cannon Gloria', 'A', 'speedster', { main: '#f72585' }],
    ['Hot Sauce Hector', 'A', 'brawler', { main: '#e5383b', accent: '#ffba08' }],
    ['El Taco Loco', 'A', 'wrestler', { main: '#2a9d8f', hat: 'luchador' }],
    ['Baron von Slap', 'A', 'boss', { main: '#6a040f', hat: 'horns' }],
    ['Zombie Intern', 'A', 'brute', { skin: '#8fbc8f', main: '#3a5a40' }],
    ['Night Shift Nurse', 'A', 'ninja', { main: '#48cae4', accent: '#ffffff' }],
    ['Bubblegum Brawler', 'A', 'blob', { main: '#ff8fab' }],
    ['Laser Llama', 'A', 'robot', { main: '#f1e9da', accent: '#ff0054' }],
    ['Grill Sergeant', 'A', 'brute', { main: '#343a40', hat: 'cap' }],
    // ---- B ----
    ['Average Joe', 'B', 'brawler', { main: '#4361ee', hat: 'none' }],
    ['Grumpy Wizard', 'B', 'mage', { main: '#3c096c', beard: true }],
    ['Beach Bum Brad', 'B', 'brawler', { main: '#f4a261', hat: 'none', hair: '#ffd166' }],
    ['Crab Knight', 'B', 'robot', { main: '#e76f51', accent: '#f4a261' }],
    ["Lil' Stabby", 'B', 'speedster', { main: '#212529', hat: 'cap' }],
    ['Muscle Hamster', 'B', 'wrestler', { skin: '#d4a373', main: '#fefae0' }],
    ['Discount Ninja', 'B', 'ninja', { main: '#495057', accent: '#ffb703' }],
    ['Uncle Barbecue', 'B', 'brute', { main: '#bc6c25', beard: true }],
    ['Space Cowboy Carl', 'B', 'brawler', { main: '#8338ec', hat: 'cap' }],
    ['Sleepy Sensei', 'B', 'brawler', { main: '#e9edc9', hat: 'band', beard: true }],
    ['Captain Obvious', 'B', 'boss', { main: '#0077b6', hat: 'cap' }],
    ['Tax Evader Ted', 'B', 'speedster', { main: '#2b9348' }],
    ['Soggy Samurai', 'B', 'ninja', { main: '#457b9d' }],
    ['Party Goblin', 'B', 'blob', { main: '#70e000', hat: 'party' }],
    ['Knockoff Kenny', 'B', 'brawler', { main: '#e63946', hat: 'band' }],
    ['Gym Teacher Gus', 'B', 'wrestler', { main: '#e5e5e5', hat: 'cap' }],
    ['Hobo Wizard', 'B', 'mage', { main: '#7f5539', beard: true }],
    ['Slime Time Steve', 'B', 'blob', { main: '#9ef01a' }],
    // ---- P: potato ----
    ['Wet Cardboard Man', 'P', 'joke', { body: 'fighter', skin: '#b08968', main: '#9c6644', hat: 'none' }],
    ['Sad Potato', 'P', 'blob', { main: '#b5835a', eyes: 'sad' }],
    ['Intern #3', 'P', 'joke', { body: 'slim', main: '#dee2e6', hat: 'none' }],
    ['Lawn Gnome', 'P', 'joke', { body: 'blob', main: '#1d4ed8', hat: 'party', accent: '#e63946', beard: true }],
    ['Baby Dragon', 'P', 'blob', { main: '#52b788', hat: 'horns', special: 'fireball' }],
    ['Cursed Scarecrow', 'P', 'joke', { body: 'slim', main: '#bb9457', hat: 'cap' }],
    ['Mr. Noodle Arms', 'P', 'joke', { body: 'slim', main: '#ffd6a5' }],
    ['Grandpa Stumbles', 'P', 'brawler', { hair: '#eeeeee', beard: true, main: '#b7b7a4' }],
    ['Pixel Error', 'P', 'robot', { main: '#ff00ff', accent: '#000000' }],
    ['Placeholder Guy', 'P', 'joke', { body: 'fighter', main: '#999999', skin: '#bbbbbb', hat: 'none' }],
    ['Missing Texture', 'P', 'robot', { main: '#ff00ff', accent: '#111111', eyes: 'dot' }],
    ['Soup Boy', 'P', 'blob', { main: '#ffba08' }],
    ['Toddler With a Stick', 'P', 'joke', { body: 'slim', main: '#90e0ef', hat: 'none' }],
    ['Sock Puppet', 'P', 'blob', { main: '#f1faee', eyes: 'dot' }],
    ['Clumsy Knight', 'P', 'robot', { main: '#adb5bd', hat: 'bucket' }],
    ['Dollar Store Ninja', 'P', 'ninja', { main: '#6c757d' }],
    ['Budget Wizard', 'P', 'mage', { main: '#6d597a' }],
    ['Tired Dad', 'P', 'brute', { main: '#8d99ae', hat: 'cap' }]
  ];

  const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d9a066', '#a0522d'];
  const HAIRS = ['#1a1a1a', '#3b2314', '#8b4513', '#d4a017', '#b22222', '#f5f5f5', '#2e86ab', '#6a0dad'];

  function hsl(h, s, l) {
    return 'hsl(' + Math.round(h) + ',' + Math.round(s) + '%,' + Math.round(l) + '%)';
  }

  function slug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function buildFighter(entry) {
    const name = entry[0], tier = entry[1], archName = entry[2], over = entry[3] || {};
    const arch = ARCHETYPES[archName];
    const rng = new SB.RNG(SB.hash('fighter:' + name));
    const tp = TIER_POWER[tier];
    const m = arch.m;
    const j = function () { return rng.float(0.9, 1.1); };

    let skill = tp.skill * rng.float(0.86, 1.14);
    if (arch.clumsy) skill *= 0.8;
    const stats = {
      hp: Math.round(1000 * m.hp * tp.hp * j() / 10) * 10,
      atk: round2(m.atk * tp.atk * j()),
      def: round2(m.def * tp.def * j()),
      spd: round2(3.3 * m.spd * j()),
      jump: round2(14 * m.jump * rng.float(0.94, 1.06)),
      reach: round2(m.reach * j()),
      aggr: round2(Math.min(0.95, Math.max(0.2, m.aggr + rng.float(-0.14, 0.14)))),
      skill: round2(Math.min(0.97, Math.max(0.12, skill))),
      jumpy: round2(rng.float(0.4, 1.3)),
      size: round2(m.size * rng.float(0.95, 1.05))
    };

    const hue = rng.float(0, 360);
    const look = {
      body: rng.pick(arch.body),
      skin: rng.pick(SKINS),
      main: hsl(hue, rng.float(55, 85), rng.float(38, 58)),
      pants: hsl((hue + rng.float(-30, 30) + 360) % 360, rng.float(20, 50), rng.float(15, 30)),
      accent: hsl((hue + 180) % 360, rng.float(60, 90), rng.float(50, 65)),
      hair: rng.pick(HAIRS),
      hat: rng.pick(arch.hats),
      eyes: rng.pick(['normal', 'normal', 'angry', 'angry']),
      beard: false,
      cape: !!arch.cape,
      aura: tier === 'X' ? hsl(rng.float(0, 360), 100, 60) : null
    };
    if (archName === 'robot') look.eyes = 'visor';
    let special = rng.pick(arch.special);
    const superMove = rng.pick(arch.super);
    for (const k in over) {
      if (k === 'special') special = over[k];
      else look[k] = over[k];
    }

    return {
      id: slug(name),
      name: name,
      tier: tier,
      arch: archName,
      special: special,
      superMove: superMove,
      stats: stats,
      look: look,
      elo: TIER_ELO[tier] + Math.round((stats.skill - tp.skill) * 200)
    };
  }

  let cache = null;
  function build() {
    if (!cache) cache = LIST.map(buildFighter);
    return cache;
  }

  function byId() {
    const map = {};
    for (const f of build()) map[f.id] = f;
    return map;
  }

  const SPECIAL_NAMES = {
    fireball: 'Fireball', dash: 'Rush Dash', uppercut: 'Rising Uppercut', spin: 'Spin Cyclone',
    teleport: 'Shadow Step', beam: 'Beam Cannon'
  };
  const SUPER_NAMES = { mega: 'Mega Blast', rush: 'Thousand Fists', hyper: 'Hyper Beam' };

  SB.Roster = {
    TIERS: TIERS,
    TIER_NAMES: TIER_NAMES,
    TIER_ELO: TIER_ELO,
    SPECIAL_NAMES: SPECIAL_NAMES,
    SUPER_NAMES: SUPER_NAMES,
    build: build,
    byId: byId
  };
})(globalThis.SB = globalThis.SB || {});
