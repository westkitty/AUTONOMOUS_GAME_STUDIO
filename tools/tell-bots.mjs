// Skill-ladder agents for the TELL prototype. Each embodies a different theory
// of how to play, so comparing their measured outcomes tests whether the
// mechanic actually rewards the intended skill.
import { DIRS, STAY, destOf, readerPredict, neighbours } from '../prototypes/tell/tell.mjs';

const dist = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

function nearestMote(g) {
  let best = null, bd = Infinity;
  for (const i of g.motes) {
    const mx = i % g.W, my = (i / g.W) | 0;
    const d = dist(g.px, g.py, mx, my);
    if (d < bd) { bd = d; best = { x: mx, y: my, i }; }
  }
  return best;
}

function towardScore(g, dir, tx, ty) {
  const to = destOf(g, dir);
  return -dist(to % g.W, (to / g.W) | 0, tx, ty);
}

// 1. Naive greedy — beeline to the nearest mote, ignore the Reader entirely.
export function greedyBot() {
  return (g, moves) => {
    const t = nearestMote(g);
    if (!t) return STAY;
    let best = STAY, bs = -Infinity;
    for (const d of moves) { const s = towardScore(g, d, t.x, t.y); if (s > bs) { bs = s; best = d; } }
    return best;
  };
}

// 2. Pure random — maximally unpredictable, zero intent.
export function randomBot() {
  return (g, moves) => moves[(g.rng() * moves.length) | 0];
}

// 3. Dodger — greedy, but never steps on the telegraphed trap.
export function dodgerBot() {
  return (g, moves) => {
    const safe = moves.filter(d => destOf(g, d) !== g.trap);
    const pool = safe.length ? safe : moves;
    const t = nearestMote(g);
    if (!t) return pool[0];
    let best = pool[0], bs = -Infinity;
    for (const d of pool) { const s = towardScore(g, d, t.x, t.y); if (s > bs) { bs = s; best = d; } }
    return best;
  };
}

// 4. Baiter — the intended expert strategy, with per-instance state.
//    Reinforcement is only *free* while the Reader is stunned (no trap), so the
//    engine is: FARM the stun window by bouncing one edge to push the Reader's
//    confidence at an anchor cell toward certainty, then BREAK it the moment the
//    stun ends and the trap is committed. Bigger confidence broken => bigger
//    stun => longer next farming window. A self-sustaining loop.
export function baiterBot(cfg = {}) {
  const baitTarget = cfg.baitTarget ?? 0.97;
  const state = { anchor: -1, partner: -1 };
  return (g, moves) => {
    const here = g.idx(g.px, g.py);
    // Safety is a HARD filter, applied before any strategy. (v1/v2 of this bot
    // treated dodging as a conditional and walked into traps 4.88x per game.)
    const safe = moves.filter(d => destOf(g, d) !== g.trap);
    const pool = safe.length ? safe : moves;
    const t = nearestMote(g);

    const bestIn = (scoreFn) => {
      let best = pool[0], bs = -Infinity;
      for (const d of pool) { const s = scoreFn(d); if (s > bs) { bs = s; best = d; } }
      return best;
    };

    // BREAK: the Reader is confident and committed -> deny it, hard.
    if (g.trap >= 0 && g.trapConfidence >= g.cfg.startleAt) {
      state.anchor = -1; state.partner = -1;
      return bestIn(d => (t ? towardScore(g, d, t.x, t.y) : 0)
        + 2 * (1 - readerPredict(g, destOf(g, d)).conf));   // break toward the unknown
    }

    // FARM: reinforce one edge toward certainty (only free while uncommitted).
    if (state.anchor < 0) {
      const nb = neighbours(g, g.px, g.py);
      if (nb.length) { state.anchor = here; state.partner = nb[(g.rng() * nb.length) | 0].i; }
    }
    if (state.anchor >= 0 && readerPredict(g, here).conf < baitTarget) {
      const goal = here === state.anchor ? state.partner : state.anchor;
      const d = pool.find(m => destOf(g, m) === goal);
      if (d !== undefined) return d;
      state.anchor = -1;                    // edge unavailable, re-anchor elsewhere
    }
    return bestIn(d => (t ? towardScore(g, d, t.x, t.y) : 0));
  };
}

// 5. Expert counter-modeler — scores every move on progress, safety, and how
//    much it *reduces* the Reader's future confidence.
export function expertBot() {
  return (g, moves) => {
    const t = nearestMote(g);
    let best = STAY, bs = -Infinity;
    for (const d of moves) {
      const to = destOf(g, d);
      let s = 0;
      if (to === g.trap) s -= 100;                       // never eat a trap
      if (t) s += 3 * towardScore(g, d, t.x, t.y);       // progress
      if (g.motes.has(to)) s += 6;                       // immediate pickup
      // unpredictability: prefer destinations whose model is diffuse
      const p = readerPredict(g, to);
      s += 4 * (1 - p.conf);
      // discourage reinforcing a single transition from the current cell
      const here = g.counts.get(g.idx(g.px, g.py));
      const already = here ? (here.get(to) || 0) : 0;
      const total = here ? [...here.values()].reduce((a, b) => a + b, 0) : 0;
      if (total > 0) s -= 5 * ((already + 1) / (total + 1));
      if (s > bs) { bs = s; best = d; }
    }
    return best;
  };
}
