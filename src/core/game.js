// ============================================================================
//  TELL — production core
//
//  Central mechanic: every adversary is a *statistical model of the player*.
//  Each Reader commits a prediction of your next cell BEFORE you move, and the
//  commitment is visible. Efficiency demands repeating good routes; repetition
//  is exactly what a Reader learns. Reinforce a habit, then break it while the
//  Reader is certain, and it is startled — and startles are the game's time
//  economy. You cannot out-run the dark; you have to lie to it.
//
//  Pure simulation. No DOM, no globals, no timers. Deterministic for a seed.
//  Everything is JSON-serializable so a run can be saved and resumed exactly.
// ============================================================================
import { Rng } from './rng.js';
import { has, times, rollChoices } from './upgrades.js';

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const DIR_NAMES = ['up', 'right', 'down', 'left'];
export const STAY = 4;

// basis: what a Reader conditions its prediction on.
//   cell  — the tile you are standing on
//   route — the last two tiles (your routes, not just your tiles)
//   dir   — the last direction you travelled (your inertia)
export const READER_KINDS = {
  sentry:    { name: 'Sentry',    blurb: 'Learns where you go from each tile.',             basis: 'cell',  decay: 0 },
  archivist: { name: 'Archivist', blurb: 'Learns your *routes*, not just your tiles.',      basis: 'route', decay: 0 },
  chorus:    { name: 'Chorus',    blurb: 'Forgets the old you. Only recent habit counts.',  basis: 'cell',  decay: 0.16 },
  mirror:    { name: 'Mirror',    blurb: 'Wears your habit as a body and walks into it.',   basis: 'cell',  decay: 0 },
  hound:     { name: 'Hound',     blurb: 'Learns your momentum — which way you keep going.', basis: 'dir',   decay: 0 },
};

export const DEPTHS = [
  { n: 1, W: 7, H: 7, walls: 6,  hush: 2, motes: 4, breath: 32, readers: ['sentry'] },
  { n: 2, W: 7, H: 7, walls: 7,  hush: 2, motes: 5, breath: 34, readers: ['sentry', 'hound'] },
  { n: 3, W: 8, H: 8, walls: 9,  hush: 3, motes: 6, breath: 36, readers: ['hound', 'archivist'] },
  { n: 4, W: 8, H: 8, walls: 10, hush: 3, motes: 7, breath: 40, readers: ['hound', 'sentry', 'mirror'] },
  { n: 5, W: 9, H: 9, walls: 12, hush: 3, motes: 8, breath: 44, readers: ['hound', 'archivist', 'chorus', 'mirror'] },
];

export const BASE = {
  composure: 4,
  nerveMax: 6,
  decoyCost: 2,
  fakeWeight: 2,      // a lie amplifies a real habit; it cannot invent certainty
  nervePerStartle: 1,
  minSamples: 3,
  minConfidence: 0.34,
  startleAt: 0.75,
  stunBase: 3,
  stunPerConf: 10,
  maxStun: 10,
  moteBreath: 3,
  nervePerMote: 1,
  startleBonusCap: 8, // diminishing returns when several Readers startle at once
  exhaleCost: 3,
  exhaleBreath: 4,
};

// --- tuning helpers ---------------------------------------------------------
export function cfgOf(run) {
  const c = { ...BASE };
  // Easy Lie must actually change the price. (It was a no-op: the base cost had
  // already been lowered to the value the upgrade "discounted" to, so picking it
  // did nothing — a meaningless choice offered to players.)
  if (has(run, 'cheapdecoy')) c.decoyCost = 1;
  return c;
}

export function nerveMaxOf(run) { return BASE.nerveMax + 2 * times(run, 'nerve'); }
export function composureMaxOf(run) { return BASE.composure + times(run, 'composure'); }
export function breathBonusOf(run) { return 6 * times(run, 'breath'); }
export function hushBonusOf(run) { return 2 * times(run, 'hush'); }
export function stunBonusOf(run) { return times(run, 'stun'); }

export function startlePayoff(conf, run) {
  const c = cfgOf(run);
  const over = Math.max(0, conf - c.startleAt) / Math.max(1e-6, 1 - c.startleAt);
  const stun = Math.max(1, Math.min(c.maxStun + stunBonusOf(run),
    Math.round(c.stunBase + over * c.stunPerConf) + stunBonusOf(run)));
  // Every stunned turn comes with the Breath to use it. Measured: at bonus=stun/2
  // a detour to break a confident guess cost ~2 turns and returned ~1.5, so the
  // best agents AVOIDED startles and the whole bait-and-break engine went unused.
  return { stun, bonus: stun, over };
}

// --- grid -------------------------------------------------------------------
const key = (x, y, W) => y * W + x;

export function createRun(opts = {}) {
  const run = {
    seed: opts.seed ?? ((Math.random() * 1e9) | 0),
    depth: 0,
    upgrades: [],
    choice: null,
    status: 'play',
    cause: null,
    totalMoves: 0,
    totalStartles: 0,
    totalHits: 0,
    best: 0,
    log: [],
  };
  run.rng = new Rng(run.seed);
  newDepth(run);
  return run;
}

export function newDepth(run) {
  run.depth += 1;
  const D = DEPTHS[Math.min(run.depth, DEPTHS.length) - 1];
  const rng = run.rng;
  const W = D.W, H = D.H;
  const cfg = cfgOf(run);
  run.W = W; run.H = H;
  run.cfgKind = D;
  const cx = (W / 2) | 0, cy = (H / 2) | 0;
  const start = key(cx, cy, W);

  // walls, rejecting disconnected layouts
  let walls = [];
  for (let attempt = 0; attempt < 24; attempt++) {
    const cand = [];
    const pool = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = key(x, y, W);
      if (i !== start) pool.push(i);
    }
    rng.shuffle(pool);
    for (const i of pool) { if (cand.length < D.walls) cand.push(i); }
    if (connected(W, H, new Set(cand), start)) { walls = cand; break; }
    walls = cand.slice(0, Math.max(0, D.walls - 2));
  }
  const wallSet = new Set(walls);

  const free = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = key(x, y, W);
    if (!wallSet.has(i) && i !== start) free.push(i);
  }
  rng.shuffle(free);

  // gate as far from the start as possible, for a real crossing
  free.sort((a, b) => man(b, start, W) - man(a, start, W));
  const gateCell = free[rng.int(Math.min(4, free.length))];
  const gateSet = new Set([gateCell]);

  const rest = free.filter(i => !gateSet.has(i));
  rng.shuffle(rest);
  const hushCount = D.hush + hushBonusOf(run);
  const hush = rest.slice(0, hushCount);
  const hushSet = new Set(hush);
  const motes = rest.slice(hushCount, hushCount + D.motes);
  const moteSet = new Set(motes);

  run.walls = walls;
  run.wallSet = new Set(walls);
  run.hush = hush;
  run.hushSet = new Set(hush);
  run.motes = motes;
  run.gate = { cell: gateCell, open: false };
  run.p = {
    cell: start, prev: -1, lastDir: -1,
    composure: composureMaxOf(run),
    breath: D.breath + breathBonusOf(run),
    nerve: has(run, 'nerve') ? 2 : 0,
    hitThisDepth: false,
    decoyedThisDepth: false,
    startles: 0,
  };
  run.readers = D.readers.map((kind, i) => ({
    id: i, kind, model: {}, stun: 0, trap: -1, conf: 0, samples: 0,
    // Mirrors are bodies: they stand somewhere real and walk to where your
    // habit says you will be. They never spawn on the gate or a mote.
    cell: kind === 'mirror' ? (rest.find(x => !moteSet.has(x)) ?? rest[0]) : -1,
  }));
  run.turn = 0;
  run.status = 'play';
  run.cause = null;
  run.events = [];
  run.best = Math.max(run.best, run.depth);
  commitReaders(run);
  return run;
}

function man(a, b, W) {
  return Math.abs((a % W) - (b % W)) + Math.abs(((a / W) | 0) - ((b / W) | 0));
}

function connected(W, H, wallSet, start) {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const c = q.pop();
    const cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = key(nx, ny, W);
      if (wallSet.has(n) || seen.has(n)) continue;
      seen.add(n); q.push(n);
    }
  }
  let open = 0;
  for (let i = 0; i < W * H; i++) if (!wallSet.has(i)) open++;
  return seen.size === open;
}

// --- reader model -----------------------------------------------------------
export function ctxKey(run, reader, cell, prev, lastDir) {
  // Always keyed off the state the player is LEAVING, never the destination.
  const basis = READER_KINDS[reader.kind].basis;
  if (basis === 'route') return `${prev}>${cell}`;
  if (basis === 'dir') return `d${lastDir ?? -1}`;
  return `${cell}`;
}

export function predict(run, reader) {
  const p = run.p;
  const ck = ctxKey(run, reader, p.cell, p.prev, p.lastDir);
  const m = reader.model[ck];
  if (!m) return { cell: -1, conf: 0, samples: 0, dir: -1, ctx: ck };
  let total = 0, best = -1, bestC = 0;
  for (const k in m) { const c = m[k]; total += c; if (c > bestC) { bestC = c; best = +k; } }
  if (total === 0) return { cell: -1, conf: 0, samples: 0, dir: -1, ctx: ck };
  const conf = bestC / total;
  if (READER_KINDS[reader.kind].basis === 'dir') {
    // a direction habit resolves to the tile that way, if there is one
    const nb = neighbours(run, p.cell).find(n => n.d === best);
    return { cell: nb ? nb.cell : -1, conf, samples: total, dir: best, ctx: ck };
  }
  return { cell: best, conf, samples: total, dir: -1, ctx: ck };
}

// What the Reader believes about every option you have. Exposed so the UI can
// draw the model and so bots can reason about it.
export function modelAt(run, reader) {
  const ck = ctxKey(run, reader, run.p.cell, run.p.prev, run.p.lastDir);
  return reader.model[ck] || null;
}

// Every transition the Reader has ever learned, for the "see your tells" overlay.
export function habitEdges(run, reader) {
  const out = [];
  const basis = READER_KINDS[reader.kind].basis;
  for (const ck in reader.model) {
    if (basis === 'dir') {
      for (const d in reader.model[ck]) out.push({ after: +ck.slice(1), dir: +d, n: reader.model[ck][d] });
    } else if (basis === 'route') {
      const [a, b] = ck.split('>').map(Number);
      for (const to in reader.model[ck]) out.push({ from: b, to: +to, n: reader.model[ck][to], via: a });
    } else {
      const from = +ck;
      for (const to in reader.model[ck]) out.push({ from, to: +to, n: reader.model[ck][to] });
    }
  }
  return out;
}

function decayModel(reader, rate) {
  if (!rate) return;
  for (const ck in reader.model) {
    const m = reader.model[ck];
    for (const k in m) { m[k] = m[k] * (1 - rate); if (m[k] < 0.35) delete m[k]; }
    if (!Object.keys(m).length) delete reader.model[ck];
  }
}

function learn(run, reader, from, prev, to, lastDir, dir) {
  const ck = ctxKey(run, reader, from, prev, lastDir);
  const m = reader.model[ck] || (reader.model[ck] = {});
  const k = READER_KINDS[reader.kind].basis === 'dir' ? dir : to;
  m[k] = (m[k] || 0) + 1;
}

export function commitReaders(run) {
  const c = cfgOf(run);
  for (const r of run.readers) {
    // Stun is a countdown, not a permanent knockout. (v1 forgot to decrement it,
    // so one startle disabled a Reader for the whole depth — balance was being
    // measured against a broken adversary.)
    if (r.stun > 0) { r.stun--; r.trap = -1; r.conf = 0; r.samples = 0; continue; }
    const p = predict(run, r);
    const need = r.kind === 'hound' ? 2 : c.minSamples;
    r.conf = p.conf; r.samples = p.samples; r.predDir = p.dir;
    r.trap = (p.cell >= 0 && p.samples >= need && p.conf >= c.minConfidence) ? p.cell : -1;
  }
}

// --- player options ---------------------------------------------------------
function wallSetOf(run) {
  if (!run.wallSet) run.wallSet = new Set(run.walls);
  return run.wallSet;
}

export function neighbours(run, cell) {
  const out = [];
  const cx = cell % run.W, cy = (cell / run.W) | 0;
  const wallSet = wallSetOf(run);
  for (let d = 0; d < 4; d++) {
    const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
    if (nx < 0 || ny < 0 || nx >= run.W || ny >= run.H) continue;
    const n = key(nx, ny, run.W);
    if (wallSet.has(n)) continue;
    out.push({ d, cell: n });
  }
  return out;
}

export function legalMoves(run) {
  return neighbours(run, run.p.cell).map(n => n.d).concat([STAY]);
}

export function destOf(run, dir) {
  if (dir === STAY) return run.p.cell;
  const n = neighbours(run, run.p.cell).find(x => x.d === dir);
  return n ? n.cell : run.p.cell;
}

// A move is "safe" if no Reader has trapped that cell and no Mirror stands on it.
export function dangerOf(run, cell) {
  let n = 0;
  for (const r of run.readers) {
    if (r.kind === 'mirror' ? r.cell === cell : r.trap === cell) n++;
  }
  return n;
}

export function isHush(run, cell) {
  if (!run.hushSet) run.hushSet = new Set(run.hush);
  return run.hushSet.has(cell);
}

// --- the turn ---------------------------------------------------------------
export function act(run, action) {
  if (run.status !== 'play') return [];
  const ev = [];
  const c = cfgOf(run);
  const p = run.p;
  const from = p.cell;
  const fromPrev = p.prev;
  const lastDirBefore = p.lastDir;

  if (action.type === 'exhale') {
    if (p.nerve < c.exhaleCost) { ev.push({ type: 'deny', why: 'nerve' }); return ev; }
    p.nerve -= c.exhaleCost;
    p.breath += c.exhaleBreath - 1;      // exhaling takes a moment: -1 for the turn
    run.turn++;
    ev.push({ type: 'exhale', breath: c.exhaleBreath });
    finishTurn(run, ev, null);
    return ev;
  }

  if (action.type === 'decoy') {
    const target = action.cell;
    if (p.nerve < c.decoyCost) { ev.push({ type: 'deny', why: 'nerve' }); return ev; }
    if (!neighbours(run, from).some(n => n.cell === target)) { ev.push({ type: 'deny', why: 'range' }); return ev; }
    let applied = 0;
    for (const r of run.readers) {
      const ck = ctxKey(run, r, from, fromPrev);
      const m = r.model[ck];
      if (!m || !Object.keys(m).length) continue;   // a lie needs some truth under it
      m[target] = (m[target] || 0) + c.fakeWeight;
      applied++;
    }
    if (!applied) { ev.push({ type: 'deny', why: 'no-truth' }); return ev; }
    p.nerve -= c.decoyCost;
    p.decoyedThisDepth = true;
    ev.push({ type: 'decoy', from, target });
    // Free in time, priced in Nerve. (When it cost a turn, the agent that used
    // it most scored 8% — it bled Breath on lies and smothered 184/200 runs.)
    run.turn++;
    finishTurn(run, ev, null);
    return ev;
  }

  const dir = action.dir;
  const to = destOf(run, dir);
  const trapsCommitted = run.readers.map(r => ({ id: r.id, trap: r.trap, conf: r.conf }));
  const traps = run.readers.filter(r => r.kind !== 'mirror' && r.trap === to);
  const mirrors = run.readers.filter(r => r.kind === 'mirror' && r.cell === to);
  const startles = run.readers.filter(r =>
    r.trap >= 0 && r.trap !== to && r.conf >= c.startleAt);

  // --- resolve
  p.prev = from;
  p.lastDir = to === from ? (lastDirBefore ?? -1) : dir;
  p.cell = to;
  run.turn++; run.totalMoves++;
  p.breath -= 1;
  ev.push({ type: 'move', from, to, dir });

  const moteIdx = run.motes.indexOf(to);
  if (moteIdx >= 0) {
    run.motes.splice(moteIdx, 1);
    const gain = has(run, 'motewind') ? c.moteBreath + 2 : c.moteBreath;
    p.breath += gain;
    p.nerve = Math.min(nerveMaxOf(run), p.nerve + c.nervePerMote);
    ev.push({ type: 'mote', cell: to, breath: gain });
  }

  // Hush tiles swallow your tell: nothing is learned from them.
  if (!isHush(run, from)) {
    for (const r of run.readers) {
      decayModel(r, READER_KINDS[r.kind].decay);
      learn(run, r, from, fromPrev, to, lastDirBefore, dir);
    }
  } else {
    ev.push({ type: 'hush', cell: from });
  }

  // damage: capped at one per turn, however many Readers were fooled by you
  const hurt = traps.length + mirrors.length;
  if (hurt > 0) {
    p.composure -= 1;
    run.totalHits++;
    ev.push({ type: 'hit', cell: to, by: (traps[0] || mirrors[0]).kind });
    if (!p.hitThisDepth && has(run, 'secondwind')) {
      p.breath += 6; p.hitThisDepth = true;
      ev.push({ type: 'secondwind', breath: 6 });
    }
  }

  // startles: confident Readers you denied
  if (startles.length) {
    let bestStun = 0, sumBonus = 0, bestConf = 0;
    for (const r of startles) {
      const pay = startlePayoff(r.conf, run);
      r.stun = Math.max(r.stun, pay.stun);
      bestStun = Math.max(bestStun, pay.stun);
      sumBonus += pay.bonus;
      bestConf = Math.max(bestConf, r.conf);
    }
    // Nerve and Breath are paid per startle EVENT, not per Reader, and Breath is
    // capped - otherwise four simultaneous startles farmed the economy every turn.
    const bonus = Math.min(c.startleBonusCap, sumBonus);
    p.breath += bonus;
    p.nerve = Math.min(nerveMaxOf(run), p.nerve + c.nervePerStartle);
    p.startles++; run.totalStartles += startles.length;
    ev.push({ type: 'startle', stun: bestStun, bonus, conf: bestConf, count: startles.length });
  }

  // Mirrors wear your habit as a body: they walk to where they expected you.
  for (const r of run.readers) {
    if (r.kind !== 'mirror') continue;
    const want = r.trap >= 0 ? r.trap : r.cell;
    r.cell = want;
  }

  finishTurn(run, ev, to, trapsCommitted);
  return ev;
}

function finishTurn(run, ev, to, trapsCommitted) {
  const p = run.p;
  if (!run.motes.length && !run.gate.open) {
    run.gate.open = true;
    ev.push({ type: 'gateopen', cell: run.gate.cell });
  }
  if (p.composure <= 0) { run.status = 'lost'; run.cause = 'caught'; }
  else if (run.gate.open && to === run.gate.cell) {
    if (run.depth >= DEPTHS.length) { run.status = 'won'; run.cause = 'escaped'; }
    else { run.status = 'descend'; run.cause = 'descend'; run.choice = rollChoices(run.rng, 3, run.upgrades); }
  } else if (p.breath <= 0) { run.status = 'lost'; run.cause = 'smothered'; }
  if (run.status === 'play') commitReaders(run);
  // Record the telegraph that was in force, so the commit->reveal->act->resolve
  // invariant is checkable after the fact (and so replays can be audited).
  run.log.push({
    turn: run.turn, from: run.p.prev, to,
    committed: trapsCommitted || [],
    status: run.status,
  });
  run.events = ev;
}

export function takeUpgrade(run, id) {
  run.upgrades.push(id);
  if (id === 'composure') run.p.composure = Math.min(composureMaxOf(run), run.p.composure + 1);
  run.choice = null;
  run.status = 'play';
  newDepth(run);
  return run;
}

// --- save / load ------------------------------------------------------------
export function serialize(run) {
  const { rng, wallSet, hushSet, ...rest } = run;
  return JSON.stringify({ ...rest, rngState: run.rng.s });
}

export function deserialize(str) {
  const o = JSON.parse(str);
  const s = o.rngState; delete o.rngState;
  o.rng = new Rng(s);
  o.wallSet = new Set(o.walls);
  return o;
}
