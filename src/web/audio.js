// Fully procedural WebAudio. No samples. Every cue is a small synthesized shape.
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.mute = false;
    this.vol = 0.8;
    this.droneNodes = null;
  }
  _ensure() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.mute ? 0 : this.vol;
    this.master.connect(this.ctx.destination);
  }
  resume() { this._ensure(); if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = this.mute ? 0 : v; }
  setMute(m) { this.mute = m; if (this.master) this.master.gain.value = m ? 0 : this.vol; }

  _tone(o = {}) {
    if (!this.ctx) return;   // guard BEFORE any this.ctx access (default args ran first)
    const { f = 440, d = 0.2, type = 'sine', g = 0.12, to = null } = o;
    const t = o.t ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gn = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + d);
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(g, t + 0.012);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(gn); gn.connect(this.master);
    osc.start(t); osc.stop(t + d + 0.05);
  }
  _noise(o = {}) {
    if (!this.ctx) return;
    const { d = 0.2, g = 0.12, hp = 800 } = o;
    const t = o.t ?? this.ctx.currentTime;
    const len = Math.max(1, (d * this.ctx.sampleRate) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const gn = this.ctx.createGain(); gn.gain.value = g;
    src.connect(f); f.connect(gn); gn.connect(this.master);
    src.start(t);
  }

  step(dir) {
    const base = 300 + (dir + 1) * 40;
    this._tone({ f: base, to: base * 0.8, d: 0.09, type: 'triangle', g: 0.05 });
  }
  mote() { this._tone({ f: 660, to: 990, d: 0.22, type: 'sine', g: 0.12 }); this._tone({ f: 1320, d: 0.3, type: 'sine', g: 0.05 }); }
  hit() { this._tone({ f: 190, to: 60, d: 0.3, type: 'sawtooth', g: 0.16 }); this._noise({ d: 0.2, g: 0.12, hp: 300 }); }
  startle() { this._tone({ f: 340, to: 1400, d: 0.4, type: 'sine', g: 0.12 }); this._tone({ f: 520, to: 2000, d: 0.45, type: 'triangle', g: 0.06 }); }
  decoy() { this._tone({ f: 500, to: 300, d: 0.18, type: 'square', g: 0.06 }); }
  exhale() { this._tone({ f: 900, to: 300, d: 0.35, type: 'sine', g: 0.08 }); this._noise({ d: 0.3, g: 0.05, hp: 1200 }); }
  hush() { this._tone({ f: 200, to: 160, d: 0.25, type: 'sine', g: 0.04 }); }
  gate() { this._tone({ f: 220, to: 440, d: 0.5, type: 'sine', g: 0.12 }); this._tone({ f: 330, to: 660, d: 0.6, type: 'sine', g: 0.08 }); }
  descend() {
    if (!this.ctx) return; [220, 175, 140, 110].forEach((f, i) => this._tone({ f, d: 0.4, type: 'sine', g: 0.1, t: this.ctx.currentTime + i * 0.16 })); }
  lose() {
    if (!this.ctx) return; [300, 240, 180, 90].forEach((f, i) => this._tone({ f, to: f * 0.8, d: 0.5, type: 'sawtooth', g: 0.09, t: this.ctx.currentTime + i * 0.2 })); }
  win() {
    if (!this.ctx) return; [440, 550, 660, 880].forEach((f, i) => this._tone({ f, d: 0.5, type: 'sine', g: 0.1, t: this.ctx.currentTime + i * 0.15 })); }
  deny() { this._tone({ f: 240, to: 200, d: 0.12, type: 'square', g: 0.05 }); }

  // ambient drone whose tension rises with the highest Reader confidence
  droneStart() {
    this._ensure(); if (!this.ctx || this.droneNodes) return;
    const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator();
    const g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
    o1.type = 'sine'; o2.type = 'sine';
    o1.frequency.value = 55; o2.frequency.value = 55.6;
    f.type = 'lowpass'; f.frequency.value = 300;
    g.gain.value = 0.0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    this.droneNodes = { o1, o2, g, f };
  }
  droneTension(conf) {
    if (!this.droneNodes) return;
    const { o2, g, f } = this.droneNodes;
    const t = this.ctx.currentTime;
    g.gain.linearRampToValueAtTime(0.03 + conf * 0.05, t + 0.4);
    f.frequency.linearRampToValueAtTime(300 + conf * 900, t + 0.4);
    o2.frequency.linearRampToValueAtTime(55.6 + conf * 6, t + 0.4);
  }
  droneStop() {
    if (!this.droneNodes) return;
    const { o1, o2, g } = this.droneNodes;
    const t = this.ctx.currentTime;
    g.gain.linearRampToValueAtTime(0, t + 0.5);
    setTimeout(() => { o1.stop(); o2.stop(); }, 600);
    this.droneNodes = null;
  }
}
