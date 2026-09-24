/* Salty Brawl – deterministic random numbers.
 * Shared by browser and Node (everything hangs off globalThis.SB). */
(function (SB) {
  'use strict';

  // mulberry32: tiny, fast and identical on every JS engine.
  function RNG(seed) {
    this.s = (seed >>> 0) || 1;
  }
  RNG.prototype.next = function () {
    let a = (this.s = (this.s + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.float = function (a, b) {
    if (a === undefined) return this.next();
    return a + (b - a) * this.next();
  };
  RNG.prototype.int = function (a, b) { // inclusive
    return a + Math.floor(this.next() * (b - a + 1));
  };
  RNG.prototype.chance = function (p) {
    return this.next() < p;
  };
  RNG.prototype.pick = function (arr) {
    return arr[Math.floor(this.next() * arr.length)];
  };
  RNG.prototype.weighted = function (entries) { // [[value, weight], ...]
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this.next() * total;
    for (const e of entries) {
      r -= e[1];
      if (r < 0) return e[0];
    }
    return entries[entries.length - 1][0];
  };
  RNG.prototype.shuffle = function (arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  };

  // FNV-1a string hash -> uint32
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function randomSeed() {
    return (Math.floor(Math.random() * 4294967296) ^ (Date.now() & 0xffffffff)) >>> 0;
  }

  SB.RNG = RNG;
  SB.hash = hash;
  SB.randomSeed = randomSeed;
})(globalThis.SB = globalThis.SB || {});
