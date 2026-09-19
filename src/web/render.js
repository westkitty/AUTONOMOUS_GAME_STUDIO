// Canvas renderer. Procedural board, glow, telegraphs, habit overlay, particles.
// Reads the production core (run) plus a small view state (v) that main.js
// animates. No game logic here.
import * as G from '../core/game.js';

const KIND_COLOR = { sentry: '--r1', hound: '--r2', chorus: '--r3', mirror: '--r4', archivist: '--r5' };

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.shake = 0;
    this.t = 0;
    this.refreshVars();
    this.resize();
  }
  // Palette lives on <body> (that's where colour-blind / high-contrast overrides
  // are declared), and it can change at runtime - so read it live, not once.
  refreshVars() {
    this.css = getComputedStyle(document.body);
  }
  color(v, a = 1) {
    const c = this.css.getPropertyValue(v).trim() || '#fff';
    return this.rgba(c, a);
  }
  rgba(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.c.clientWidth; this.h = this.c.clientHeight;
    this.c.width = this.w * dpr; this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
  }
  layout(run) {
    const pad = 46;
    const w = this.w, h = this.h;
    const cs = Math.min((w - pad * 2) / run.W, (h - pad * 2) / run.H);
    const bw = cs * run.W, bh = cs * run.H;
    const ox = (w - bw) / 2, oy = (h - bh) / 2 + 12;
    return { cs, ox, oy };
  }
  cellAt(run, cell, L) {
    const x = cell % run.W, y = (cell / run.W) | 0;
    return [L.ox + x * L.cs + L.cs / 2, L.oy + y * L.cs + L.cs / 2];
  }
  burst(run, cell, color, n = 14, sp = 2.4) {
    const L = this.layout(run);
    const [x, y] = this.cellAt(run, cell, L);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = sp * (0.4 + Math.random());
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color });
    }
  }
  shock(run, cell, color) {
    const L = this.layout(run);
    const [x, y] = this.cellAt(run, cell, L);
    this.particles.push({ ring: true, x, y, r: 4, life: 1, color });
  }

  draw(run, v) {
    this.t += 0.016;
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);

    // ambient vignette
    let g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, '#080d18'); g.addColorStop(1, '#02040a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    if (this.shake > 0.2) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.85;
    } else this.shake = 0;

    const L = this.layout(run);
    const wallSet = new Set(run.walls), hushSet = new Set(run.hush);

    // board tiles
    for (let y = 0; y < run.H; y++) for (let x = 0; x < run.W; x++) {
      const i = y * run.W + x;
      const cx = L.ox + x * L.cs, cy = L.oy + y * L.cs;
      if (wallSet.has(i)) {
        ctx.fillStyle = '#0a0f1a';
        this.rr(cx + 2, cy + 2, L.cs - 4, L.cs - 4, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(40,58,88,.5)'; this.rr(cx + 2, cy + 2, L.cs - 4, L.cs - 4, 5); ctx.stroke();
        continue;
      }
      ctx.fillStyle = hushSet.has(i) ? '#10161d' : '#0c1320';
      this.rr(cx + 1.5, cy + 1.5, L.cs - 3, L.cs - 3, 6); ctx.fill();
      if (hushSet.has(i)) {
        ctx.fillStyle = this.color('--hush', 0.35);
        this.rr(cx + 4, cy + 4, L.cs - 8, L.cs - 8, 4); ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(26,38,58,.7)'; this.rr(cx + 1.5, cy + 1.5, L.cs - 3, L.cs - 3, 6); ctx.stroke();
      }
    }

    if (v.habitOn) this.drawHabits(run, L);

    // gate
    if (run.gate.cell >= 0) {
      const [gx, gy] = this.cellAt(run, run.gate.cell, L);
      const open = run.gate.open;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * (open ? 4 : 1.4));
      ctx.save();
      ctx.translate(gx, gy);
      ctx.strokeStyle = this.color('--gate', open ? 0.4 + 0.6 * pulse : 0.25);
      ctx.lineWidth = open ? 3 : 1.5;
      ctx.setLineDash(open ? [] : [4, 5]);
      ctx.beginPath(); ctx.arc(0, 0, L.cs * 0.32, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      if (open) { ctx.fillStyle = this.color('--gate', 0.12 + 0.1 * pulse); ctx.beginPath(); ctx.arc(0, 0, L.cs * 0.3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }

    // motes
    for (const m of run.motes) {
      const [mx, my] = this.cellAt(run, m, L);
      const tw = 0.6 + 0.4 * Math.sin(this.t * 3 + m);
      ctx.save(); ctx.translate(mx, my);
      ctx.shadowColor = this.color('--mote'); ctx.shadowBlur = 14 * tw;
      ctx.fillStyle = this.color('--mote', 0.9);
      ctx.beginPath(); ctx.arc(0, 0, L.cs * 0.14 * tw, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // telegraphs + mirrors
    for (const r of run.readers) {
      const col = this.color(KIND_COLOR[r.kind]);
      if (r.kind === 'mirror') {
        const [mx, my] = this.cellAt(run, r.cell, L);
        this.drawEye(ctx, mx, my, L.cs * 0.3, col, r.stun > 0 ? 0.25 : 0.9, this.t);
      }
      if (r.trap >= 0 && r.stun <= 0) {
        const [tx, ty] = this.cellAt(run, r.trap, L);
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
        const alpha = 0.35 + 0.5 * r.conf * pulse;
        ctx.save();
        ctx.strokeStyle = col; ctx.fillStyle = this.color(KIND_COLOR[r.kind], alpha * 0.16);
        ctx.lineWidth = 2;
        this.rr(tx - L.cs / 2 + 3, ty - L.cs / 2 + 3, L.cs - 6, L.cs - 6, 7);
        ctx.fill(); ctx.stroke();
        // chevron confidence gauge
        this.drawChevrons(ctx, tx, ty, r.conf, col, L);
        ctx.restore();
      }
    }

    // player (smoothed display position)
    const dx = v.dx ?? v.pfx, dy = v.dy ?? v.pfy;
    const [px, py] = [L.ox + dx * L.cs + L.cs / 2, L.oy + dy * L.cs + L.cs / 2];
    ctx.save();
    const breathe = 1 + 0.06 * Math.sin(this.t * 3);
    ctx.shadowColor = this.color('--player'); ctx.shadowBlur = 22;
    ctx.fillStyle = this.color('--player');
    ctx.beginPath(); ctx.arc(px, py, L.cs * 0.2 * breathe, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath(); ctx.arc(px - L.cs * 0.05, py - L.cs * 0.05, L.cs * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // particles
    this.drawParticles(ctx);
    ctx.restore();
  }

  drawChevrons(ctx, x, y, conf, col, L) {
    const n = conf >= 0.9 ? 3 : conf >= 0.5 ? 2 : 1;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const r = L.cs * 0.3 + i * 4;
      ctx.beginPath();
      for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2 + this.t * 1.5;
        ctx.moveTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
        ctx.lineTo(x + Math.cos(ang + 0.5) * (r * 0.8), y + Math.sin(ang + 0.5) * (r * 0.8));
      }
      ctx.stroke();
    }
  }

  drawEye(ctx, x, y, r, col, a, t) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = col; ctx.globalAlpha = a; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * (0.4 + 0.25 * i), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // "see your tells": your own habit edges, weighted.
  drawHabits(run, L) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    for (const r of run.readers) {
      const col = this.color(KIND_COLOR[r.kind]);
      for (const e of G.habitEdges(run, r)) {
        if (e.dir !== undefined) continue;
        const [x1, y1] = this.cellAt(run, e.from, L);
        const [x2, y2] = this.cellAt(run, e.to, L);
        const a = Math.min(0.85, 0.12 + e.n * 0.14);
        ctx.strokeStyle = col; ctx.globalAlpha = a; ctx.lineWidth = Math.min(6, 1 + e.n * 1.2);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawParticles(ctx) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= p.ring ? 0.05 : 0.03;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      if (p.ring) {
        p.r += 3.4;
        ctx.strokeStyle = p.color; ctx.globalAlpha = p.life * 0.8; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      } else {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05;
        ctx.fillStyle = p.color; ctx.globalAlpha = p.life;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.4 * p.life, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  rr(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
