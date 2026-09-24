/* Salty Brawl – tiny synthesized sound effects (no audio files needed). */
(function (SB) {
  'use strict';

  function Audio() {
    this.enabled = false;
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.last = {};
  }

  Audio.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (this.enabled && !this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx && this.enabled && this.ctx.state === 'suspended') this.ctx.resume();
  };

  Audio.prototype.tone = function (type, f1, f2, dur, vol, delay) {
    const c = this.ctx, t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  };

  Audio.prototype.hiss = function (freq, q, dur, vol, delay) {
    const c = this.ctx, t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  };

  Audio.prototype.play = function (name) {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < 35) return; // avoid stacking
    this.last[name] = now;
    switch (name) {
      case 'hit': this.hiss(1800, 1, 0.07, 0.7); this.tone('sine', 180, 60, 0.08, 0.6); break;
      case 'hitHeavy': this.hiss(900, 0.8, 0.16, 0.9); this.tone('sine', 120, 40, 0.18, 0.9); break;
      case 'block': this.tone('square', 1600, 900, 0.05, 0.18); this.hiss(4000, 2, 0.04, 0.3); break;
      case 'whoosh': this.hiss(700, 0.6, 0.12, 0.25); break;
      case 'proj': this.tone('sawtooth', 220, 660, 0.18, 0.16); break;
      case 'super': this.tone('sawtooth', 110, 880, 0.5, 0.2); this.tone('square', 220, 1320, 0.5, 0.08, 0.05); break;
      case 'thud': this.tone('sine', 90, 35, 0.2, 0.8); this.hiss(300, 0.7, 0.15, 0.4); break;
      case 'ko': this.tone('sine', 70, 30, 0.9, 1); this.hiss(200, 0.5, 0.8, 0.5); break;
      case 'fight': this.tone('square', 392, 0, 0.12, 0.12); this.tone('square', 523, 0, 0.25, 0.12, 0.12); break;
      case 'bet': this.tone('square', 988, 0, 0.07, 0.1); this.tone('square', 1319, 0, 0.14, 0.1, 0.07); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, 0, 0.18, 0.2, i * 0.09)); break;
      case 'lose': [392, 330, 262].forEach((f, i) => this.tone('triangle', f, 0, 0.25, 0.18, i * 0.14)); break;
      case 'open': this.tone('triangle', 660, 0, 0.1, 0.12); this.tone('triangle', 880, 0, 0.15, 0.12, 0.1); break;
    }
  };

  SB.Audio = Audio;
})(globalThis.SB = globalThis.SB || {});
