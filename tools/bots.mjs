// PHASE 4 — automated playtesters for the production game.
// Navigation is BFS-gradient based (v1 used Manhattan distance and oscillated,
// which made the game look far harder than it is: failing runs burned the whole
// Breath budget while clearing runs took ~18 turns). With a real gradient the
// measured difficulty reflects the game rather than a weak navigator.
import * as G from '../src/core/game.js';

// Distance field: for every open cell, the shortest walk to the nearest target.
function field(run, targets) {
  const f = new Map();
  const q = [];
  for (const t of targets) { if (!f.has(t)) { f.set(t, 0); q.push(t); } }
  while (q.length) {
    const c = q.shift();
    for (const n of G.neighbours(run, c)) {
      if (!f.has(n.cell)) { f.set(n.cell, f.get(c) + 1); q.push(n.cell); }
    }
  }
  return f;
}

function targetsFor(run) {
  return run.gate.open ? [run.gate.cell] : run.motes.slice();
}

function baseScore(run, dir, f) {
  const to = G.destOf(run, dir);
  let s = 0;
  const d = f.get(to);
  s += d === undefined ? -60 : -6 * d;              // follow the gradient
  if (run.motes.includes(to)) s += 12;
  if (run.gate.open && to === run.gate.cell) s += 500;
  if (G.isHush(run, to)) s += 0.25;                 // tie-breaker only (1.5 caused stall loops)
  if (dir === G.STAY) s -= 2;                       // standing still is a last resort
  return s;
}

function bestMove(run, f, opts = {}, lastTo = -1) {
  const c = G.cfgOf(run);
  let best = null, bs = -Infinity;
  for (const d of G.legalMoves(run)) {
    const to = G.destOf(run, d);
    let s = baseScore(run, d, f);
    if (to === lastTo) s -= 4;                       // anti-reversal
    const danger = G.dangerOf(run, to);
    if (danger > 0) s -= opts.safety * 200 * danger;

    if (opts.modelAware) {
      let startleValue = 0, maxConf = 0;
      for (const r of run.readers) {
        maxConf = Math.max(maxConf, G.predict(run, r).conf);
        if (r.trap >= 0 && r.trap !== to && r.conf >= c.startleAt) {
          startleValue += 14 * G.startlePayoff(r.conf, run).bonus;
        }
      }
      s += startleValue;                            // breaking a guess buys time
      s += 4 * (1 - maxConf);                       // stay unreadable
      // a Hound reads momentum: continuing your last direction feeds it
      for (const r of run.readers) {
        if (G.READER_KINDS[r.kind].basis === 'dir' && d === run.p.lastDir) {
          s -= 8 * G.predict(run, r).conf;
        }
      }
      const m = G.modelAt(run, run.readers[0]);
      if (m) {
        const total = Object.values(m).reduce((a, b) => a + b, 0);
        s -= 4 * ((m[to] || 0) / Math.max(1, total));
      }
    }
    if (s > bs) { bs = s; best = d; }
  }
  return best === null ? G.STAY : best;
}

// Navigation memory shared by the competent agents.
//   anti-reversal: don't undo last turn's move just because it is "safe"
//   desperation:   if nothing has happened for a while, stop dodging and push
//                  through — a real player eats one hit rather than dithers.
function makeNav() {
  const st = { lastTo: -1, idle: 0, motes: -1, startles: -1 };
  return (run, opts) => {
    const o = { ...opts };
    if (st.motes < 0) { st.motes = run.motes.length; st.startles = run.totalStartles; }
    const progressed = run.motes.length < st.motes || run.totalStartles > st.startles;
    st.motes = run.motes.length; st.startles = run.totalStartles;
    st.idle = progressed ? 0 : st.idle + 1;
    if (st.idle > 6) o.safety = 0.05;        // push through rather than stall
    const dir = bestMove(run, field(run, targetsFor(run)), o, st.lastTo);
    st.lastTo = G.destOf(run, dir);
    return { type: 'move', dir };
  };
}

function plan(run, opts) {
  return { type: 'move', dir: bestMove(run, field(run, targetsFor(run)), opts, -1) };
}

// 1. Greedy — beeline, ignore the Readers entirely. A careless player.
export function greedy() { return (run) => plan(run, { safety: 0 }); }

// 2. Random — the degenerate "just be unpredictable" theory.
export function random() {
  return (run) => {
    const ms = G.legalMoves(run);
    return { type: 'move', dir: ms[(run.rng.next() * ms.length) | 0] };
  };
}

// 3. Turtle — never move. Pure stall probe.
export function turtle() { return () => ({ type: 'move', dir: G.STAY }); }

// 4. Cautious — navigates well, never steps into telegraphed danger.
export function cautious() { const nav = makeNav(); return (run) => nav(run, { safety: 1 }); }

// Shared economy: convert Nerve into Breath when time runs short.
export function needsAir(run) {
  const c = G.cfgOf(run);
  return run.p.breath <= 9 && run.p.nerve >= c.exhaleCost;
}

// 5. Model-aware — dodges, farms startles for time, routes via hush.
export function modelAware() {
  const nav = makeNav();
  return (run) => {
    if (needsAir(run)) return { type: 'exhale' };
    return nav(run, { safety: 1, modelAware: true });
  };
}

// 6. Liar — model-aware, and it spends Nerve on Decoys to push a nearly-certain
//    Reader over the startle threshold so the break it plans pays maximum time.
export function liar() {
  const nav = makeNav();
  const cd = { t: -99 };
  return (run) => {
    const c = G.cfgOf(run);
    if (run.p.breath <= 6 && run.p.nerve >= c.exhaleCost) return { type: 'exhale' };
    // A lie is a setup, not a spammable button: only when there is time to
    // cash it in, and never twice inside the same short window.
    if (run.p.nerve >= c.decoyCost && run.p.breath > 15 && run.turn - cd.t >= 4) {
      for (const r of run.readers) {
        const p = G.predict(run, r);
        if (p.cell >= 0 && p.samples >= c.minSamples && p.conf >= c.minConfidence && p.conf < c.startleAt) {
          if (G.neighbours(run, run.p.cell).some(n => n.cell === p.cell)) { cd.t = run.turn; return { type: 'decoy', cell: p.cell }; }
        }
      }
    }
    if (needsAir(run)) return { type: 'exhale' };
    return nav(run, { safety: 1, modelAware: true });
  };
}

// 7. Noisy human — right idea, sloppy hands. The agent whose numbers should
//    look most like a real session.
export function humanlike(noise = 0.16) {
  const think = liar();
  return (run) => {
    if (run.rng.next() < noise) {
      const ms = G.legalMoves(run);
      return { type: 'move', dir: ms[(run.rng.next() * ms.length) | 0] };
    }
    return think(run);
  };
}

// 8. Perfect — the skill ceiling. Full route planning, never eats a trap, always
//    converts Nerve optimally. Used to prove the game is winnable at all.
export function perfect() {
  const nav = makeNav();
  const cd = { t: -99 };
  return (run) => {
    const c = G.cfgOf(run);
    // always keep breathing if it can afford to
    if (run.p.breath <= 4 && run.p.nerve >= c.exhaleCost) return { type: 'exhale' };
    // decoy a nearly-certain Reader over the threshold, then break it next turn
    if (run.p.nerve >= c.decoyCost && run.p.breath > 15 && run.turn - cd.t >= 4) {
      for (const r of run.readers) {
        const pr = G.predict(run, r);
        if (pr.cell >= 0 && pr.conf >= c.minConfidence && pr.conf < c.startleAt
            && G.neighbours(run, run.p.cell).some(n => n.cell === pr.cell)) { cd.t = run.turn; return { type: 'decoy', cell: pr.cell }; }
      }
    }
    return nav(run, { safety: 1, modelAware: true });
  };
}

export const ROSTER = { greedy, random, turtle, cautious, modelAware, liar, humanlike, perfect };
