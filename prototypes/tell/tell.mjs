// CANDIDATE A (reference implementation) — "TELL"
//
// Central mechanic: the adversary IS a statistical model of the player.
//
// Turn sequence (order matters — this was the v1 bug):
//   1. readerThink()  -> the Reader commits a trap and it is VISIBLE
//   2. the player chooses a move
//   3. resolve()      -> move applied, model updated, hit / startle resolved
//   4. readerThink()  -> next trap committed, visible for the next decision
//
// The tension: efficiency demands repeating good routes; repetition is exactly
// what the Reader learns. Deliberately reinforcing a habit and then breaking it
// startles the Reader (stun = safe turns), which is the intended expert play.
//
// Pure sim. No DOM. Deterministic for a given seed.

export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const DIR_NAMES = ['up', 'right', 'down', 'left'];
export const STAY = 4;

export const defaultCfg = {
  W: 7, H: 7,
  wallCount: 7,
  motes: 8,
  hp: 5,
  turnBudget: 60,      // moves available; can be granted more
  minSamples: 3,       // evidence the Reader needs before it dares to trap
  minConfidence: 0.34, // share of a cell's transitions needed to commit
  startleAt: 0.75,     // confidence at which being wrong startles the Reader
  stunBase: 1,         // safe turns from a bare-minimum startle
  stunPerConf: 8,      // extra safe turns, scaled by how confident it was
  maxStun: 8,
  startleBonus: 2,     // extra moves granted by a startle
};

// How badly the Reader is rattled, as a function of the confidence you broke.
// This is what makes *deliberately* baiting it to near-certainty worth more
// than casually sidestepping an early guess.
export function startlePayoff(conf, cfg) {
  const C = { ...defaultCfg, ...cfg };
  const over = Math.max(0, conf - C.startleAt) / Math.max(1e-6, 1 - C.startleAt);
  const stun = Math.max(1, Math.min(C.maxStun, Math.round(C.stunBase + over * C.stunPerConf)));
  return { stun, bonus: Math.max(1, Math.round(stun / 2)), over };
}

export function createGame(cfg, seed) {
  const C = { ...defaultCfg, ...cfg };
  const W = C.W, H = C.H;
  const rng = makeRng(seed);
  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const walls = new Set();

  let guard = 0;
  while (walls.size < C.wallCount && guard++ < 400) {
    const x = (rng() * W) | 0, y = (rng() * H) | 0;
    if (x === (W / 2) | 0 && y === (H / 2) | 0) continue;
    walls.add(idx(x, y));
  }
  // reject layouts that disconnect the arena
  const cx0 = (W / 2) | 0, cy0 = (H / 2) | 0;
  {
    const start = idx(cx0, cy0);
    const seen = new Set([start]); const q = [start];
    while (q.length) {
      const c = q.pop(); const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!inside(nx, ny) || walls.has(idx(nx, ny))) continue;
        const n = idx(nx, ny);
        if (!seen.has(n)) { seen.add(n); q.push(n); }
      }
    }
    if (seen.size < W * H - walls.size) walls.clear();
  }

  const motes = new Set();
  while (motes.size < C.motes && guard++ < 3000) {
    const x = (rng() * W) | 0, y = (rng() * H) | 0;
    const i = idx(x, y);
    if (walls.has(i) || i === idx(cx0, cy0)) continue;
    motes.add(i);
  }

  const g = {
    cfg: C, W, H, rng, walls, idx, inside,
    px: cx0, py: cy0,
    motes, hp: C.hp,
    movesUsed: 0, turnsLeft: C.turnBudget,
    collected: 0,
    counts: new Map(),   // fromCell -> Map(toCell -> n)
    trap: -1, trapConfidence: 0, trapSamples: 0,
    stun: 0, startled: 0, hits: 0,
    over: false, won: false, cause: null,
    log: [],
  };
  readerThink(g);           // the first trap is committed and visible from turn 1
  return g;
}

export function neighbours(g, x, y) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
    if (!g.inside(nx, ny) || g.walls.has(g.idx(nx, ny))) continue;
    out.push({ x: nx, y: ny, d, i: g.idx(nx, ny) });
  }
  return out;
}

export function legalMoves(g) {
  const moves = neighbours(g, g.px, g.py).map(n => n.d);
  moves.push(STAY);
  return moves;
}

export function destOf(g, dir) {
  if (dir === STAY) return g.idx(g.px, g.py);
  const nx = g.px + DIRS[dir][0], ny = g.py + DIRS[dir][1];
  if (!g.inside(nx, ny) || g.walls.has(g.idx(nx, ny))) return g.idx(g.px, g.py);
  return g.idx(nx, ny);
}

// The Reader's model: order-1 Markov counts over the player's own transitions.
export function readerPredict(g, from = g.idx(g.px, g.py)) {
  const m = g.counts.get(from);
  if (!m) return { cell: -1, conf: 0, samples: 0 };
  let total = 0, best = -1, bestC = 0;
  for (const [to, c] of m) { total += c; if (c > bestC) { bestC = c; best = to; } }
  if (total === 0) return { cell: -1, conf: 0, samples: 0 };
  return { cell: best, conf: bestC / total, samples: total };
}

export function readerThink(g) {
  if (g.stun > 0 || g.over) { g.trap = -1; g.trapConfidence = 0; g.trapSamples = 0; return; }
  const p = readerPredict(g);
  if (p.cell >= 0 && p.samples >= g.cfg.minSamples && p.conf >= g.cfg.minConfidence) {
    g.trap = p.cell; g.trapConfidence = p.conf; g.trapSamples = p.samples;
  } else { g.trap = -1; g.trapConfidence = 0; g.trapSamples = p.samples; }
}

function learn(g, from, to) {
  let m = g.counts.get(from);
  if (!m) { m = new Map(); g.counts.set(from, m); }
  m.set(to, (m.get(to) || 0) + 1);
}

export function step(g, dir) {
  if (g.over) return g;
  const trap = g.trap, conf = g.trapConfidence;   // committed BEFORE the player moved
  const from = g.idx(g.px, g.py);
  const to = destOf(g, dir);
  learn(g, from, to);
  g.px = to % g.W; g.py = (to / g.W) | 0;
  g.movesUsed++; g.turnsLeft--;

  if (g.motes.has(to)) { g.motes.delete(to); g.collected++; }

  let event = null;
  if (trap >= 0 && to === trap) {
    g.hp -= 1; g.hits++; event = 'hit';
  } else if (trap >= 0 && conf >= g.cfg.startleAt) {
    const pay = startlePayoff(conf, g.cfg);
    g.stun = pay.stun; g.startled++; g.lastPayoff = pay;
    g.turnsLeft += pay.bonus;                   // grant time, never rewind the clock
    event = 'startle';
  }
  if (g.stun > 0) g.stun--;

  if (g.hp <= 0) { g.over = true; g.won = false; g.cause = 'caught'; }
  else if (g.collected >= g.cfg.motes) { g.over = true; g.won = true; g.cause = 'complete'; }
  else if (g.turnsLeft <= 0) { g.over = true; g.won = false; g.cause = 'timeout'; }

  g.log.push({ turn: g.movesUsed, from, to, trap, conf, event });
  readerThink(g);
  return g;
}

export function play(g, policy, maxSteps = 4000) {
  let n = 0;
  while (!g.over && n++ < maxSteps) step(g, policy(g, legalMoves(g)));
  return g;
}
