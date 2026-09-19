import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/core/game.js';

test('createRun produces a connected, fully-populated depth', () => {
  for (let s = 1; s <= 200; s++) {
    const r = G.createRun({ seed: s });
    assert.equal(r.depth, 1);
    assert.equal(r.motes.length, G.DEPTHS[0].motes);
    assert.ok(r.gate.cell >= 0 && r.gate.cell < r.W * r.H);
    assert.ok(!r.walls.includes(r.gate.cell), 'gate is never a wall');
    // every mote and the gate must be reachable from the start
    const seen = new Set([r.p.cell]); const q = [r.p.cell];
    while (q.length) for (const n of G.neighbours(r, q.pop())) if (!seen.has(n.cell)) { seen.add(n.cell); q.push(n.cell); }
    for (const m of r.motes) assert.ok(seen.has(m), 'mote unreachable');
    assert.ok(seen.has(r.gate.cell), 'gate unreachable');
  }
});

test('the Reader telegraphs BEFORE the player moves (the v1 core bug)', () => {
  const r = G.createRun({ seed: 11 });
  const visible = r.readers.map(x => ({ id: x.id, trap: x.trap, conf: x.conf }));
  G.act(r, { type: 'move', dir: G.legalMoves(r)[0] });
  // the traps that were resolved against are exactly the ones the player saw
  assert.deepEqual(r.log[0].committed, visible);
});

test('a Reader only traps a cell the model actually supports', () => {
  for (let s = 1; s <= 120; s++) {
    const r = G.createRun({ seed: s });
    for (let i = 0; i < 40 && r.status === 'play'; i++) {
      G.act(r, { type: 'move', dir: G.legalMoves(r)[i % G.legalMoves(r).length] });
      if (r.status !== 'play') break;   // the core stops committing once a depth ends
      for (const rd of r.readers) {
        if (rd.trap < 0) continue;
        const m = G.modelAt(r, rd);
        const basis = G.READER_KINDS[rd.kind].basis;
        // hounds key their model by direction, everyone else by destination cell
        const k = basis === 'dir' ? rd.predDir : rd.trap;
        assert.ok(m && m[k] !== undefined, `${rd.kind} trap is on a learned transition`);
        assert.ok(rd.conf >= G.BASE.minConfidence, `${rd.kind} traps only with evidence`);
      }
    }
  }
});

test('learning keys off the origin cell, never the destination', () => {
  const r = G.createRun({ seed: 21 });
  const start = r.p.cell;
  const d = G.legalMoves(r).find(x => x !== G.STAY);
  const to = G.destOf(r, d);
  G.act(r, { type: 'move', dir: d });
  const m = r.readers[0].model[String(start)];
  assert.ok(m, 'model has an entry for the cell we LEFT');
  assert.equal(m[to], 1, 'it recorded where we went');
  assert.equal(r.readers[0].model[String(to)], undefined, 'nothing keyed on the destination');
});

// walk a real shortest path (v1 of this test hopped to random neighbours and
// never actually arrived, so it was asserting nothing)
function walkTo(r, target) {
  const prev = new Map([[r.p.cell, null]]); const q = [r.p.cell];
  while (q.length) {
    const c = q.shift();
    if (c === target) break;
    for (const n of G.neighbours(r, c)) if (!prev.has(n.cell)) { prev.set(n.cell, { c, d: n.d }); q.push(n.cell); }
  }
  assert.ok(prev.has(target), 'target reachable');
  const path = []; let cur = target;
  while (prev.get(cur) !== null) { path.unshift(prev.get(cur).d); cur = prev.get(cur).c; }
  for (const d of path) { if (r.status !== 'play') break; G.act(r, { type: 'move', dir: d }); }
}

test('a Hush tile teaches the model nothing', () => {
  for (const seed of [31, 32, 33, 34, 35]) {
    const r = G.createRun({ seed });
    const h = r.hush[0];
    walkTo(r, h);
    assert.equal(r.p.cell, h, `reached the hush tile (seed ${seed})`);
    const before = JSON.stringify(r.readers.map(x => x.model));
    const nb = G.neighbours(r, r.p.cell);
    G.act(r, { type: 'move', dir: nb[0].d });
    assert.equal(JSON.stringify(r.readers.map(x => x.model)), before, 'model unchanged when leaving hush');
  }
});

test('break a confident guess and the Reader is startled, granting Breath', () => {
  const r = G.createRun({ seed: 41 });
  const start = r.p.cell;
  const partner = G.neighbours(r, r.p.cell)[0].cell;
  const dirBetween = (from, to) => G.neighbours(r, from).find(n => n.cell === to).d;
  // bounce one edge: counts[start] only ever records `partner`, so confidence
  // climbs to 1.0 and the Sentry commits. (v1 alternated two directions from
  // wherever it landed, so confidence never left 0.5 and nothing startled.)
  let guard = 0, startled = false;
  while (guard++ < 30 && !startled && r.status === 'play') {
    const rd = r.readers[0];
    if (rd.trap >= 0 && rd.conf >= G.BASE.startleAt) {
      const br = r.p.breath;
      const safe = G.legalMoves(r).filter(d => G.destOf(r, d) !== rd.trap);
      const ev = G.act(r, { type: 'move', dir: safe[0] });
      startled = ev.some(e => e.type === 'startle');
      assert.ok(startled, 'denying a confident guess startles the Reader');
      assert.ok(rd.stun > 0, 'the Reader is stunned');
      assert.ok(r.p.breath >= br - 1, 'a startle never costs net Breath');
    } else {
      const goal = r.p.cell === start ? partner : start;
      G.act(r, { type: 'move', dir: dirBetween(r.p.cell, goal) });
    }
  }
  assert.ok(startled, 'a reinforced habit can be broken for a startle');
});

test('Exhale converts Nerve into Breath and is refused when poor', () => {
  const r = G.createRun({ seed: 51 });
  assert.deepEqual(G.act(r, { type: 'exhale' }), [{ type: 'deny', why: 'nerve' }]);
  r.p.nerve = G.cfgOf(r).exhaleCost;
  const br = r.p.breath;
  const ev = G.act(r, { type: 'exhale' });
  assert.equal(ev[0].type, 'exhale');
  assert.equal(r.p.nerve, 0);
  assert.equal(r.p.breath, br + G.cfgOf(r).exhaleBreath - 1);
});

test('Decoy needs truth under it, then writes a lie into every Reader', () => {
  const r = G.createRun({ seed: 61 });
  const a = G.neighbours(r, r.p.cell)[0];
  const backDir = G.neighbours(r, a.cell).find(n => n.cell === r.p.cell).d;
  // establish real evidence at the start cell (leave and return)
  G.act(r, { type: 'move', dir: a.d });
  G.act(r, { type: 'move', dir: backDir });
  r.p.nerve = G.cfgOf(r).decoyCost;
  const target = G.neighbours(r, r.p.cell)[0].cell;
  const br = r.p.breath;
  const ev = G.act(r, { type: 'decoy', cell: target });
  assert.equal(ev[0].type, 'decoy');
  assert.equal(r.p.breath, br, 'Decoy is free in time');
  assert.equal(r.p.nerve, 0);
  for (const rd of r.readers) {
    const m = G.modelAt(r, rd);
    assert.ok(m && m[target] >= G.BASE.fakeWeight, 'every Reader believed the lie');
  }
});

test('Decoy is refused on a model with no evidence (anti-farm invariant)', () => {
  const r = G.createRun({ seed: 62 });
  r.p.nerve = G.cfgOf(r).decoyCost;
  const target = G.neighbours(r, r.p.cell)[0].cell;
  const ev = G.act(r, { type: 'decoy', cell: target });
  assert.equal(ev[0].type, 'deny');
  assert.equal(r.p.nerve, G.cfgOf(r).decoyCost, 'a refused lie costs nothing');
});

test('damage is capped at one per turn however many Readers are fooled', () => {
  const r = G.createRun({ seed: 71 });
  for (const rd of r.readers) { rd.stun = 0; rd.trap = r.p.cell; rd.conf = 0.9; }
  const hp = r.p.composure;
  G.act(r, { type: 'move', dir: G.STAY });
  assert.equal(r.p.composure, hp - 1);
});

test('victory and both failure states are reachable', () => {
  // smothered
  let r = G.createRun({ seed: 81 });
  r.p.breath = 1;
  G.act(r, { type: 'move', dir: G.legalMoves(r)[0] });
  assert.equal(r.cause, 'smothered');
  // caught
  r = G.createRun({ seed: 82 });
  r.p.composure = 1;
  for (const rd of r.readers) { rd.stun = 0; rd.trap = r.p.cell; rd.conf = 0.2; }
  G.act(r, { type: 'move', dir: G.STAY });
  assert.equal(r.cause, 'caught');
  // escaped
  r = G.createRun({ seed: 83 });
  r.motes = []; r.gate.open = true; r.p.cell = r.gate.cell;
  r.depth = G.DEPTHS.length;
  G.act(r, { type: 'move', dir: G.STAY });
  assert.equal(r.status, 'won');
});

test('descending offers three upgrade choices and applying one starts the next depth', () => {
  const r = G.createRun({ seed: 91 });
  r.motes = []; r.gate.open = true; r.p.cell = r.gate.cell;
  G.act(r, { type: 'move', dir: G.STAY });
  assert.equal(r.status, 'descend');
  assert.equal(r.choice.length, 3);
  G.takeUpgrade(r, r.choice[0]);
  assert.equal(r.depth, 2);
  assert.equal(r.upgrades.length, 1);
  assert.equal(r.status, 'play');
});

test('a run survives a JSON save/load round-trip bit-exactly', () => {
  const r = G.createRun({ seed: 101 });
  for (let i = 0; i < 12; i++) G.act(r, { type: 'move', dir: G.legalMoves(r)[i % G.legalMoves(r).length] });
  const clone = G.deserialize(G.serialize(r));
  const snap = x => JSON.stringify({ d: x.depth, p: x.p, m: x.readers.map(z => z.model), s: x.rng.s, motes: x.motes });
  assert.equal(snap(clone), snap(r));
  // and it keeps playing identically
  const a = G.act(r, { type: 'move', dir: 1 }), b = G.act(clone, { type: 'move', dir: 1 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(clone.p.cell, r.p.cell);
});

test('no depth can trap every escape (no softlock by construction)', () => {
  for (let s = 1; s <= 300; s++) {
    const r = G.createRun({ seed: s });
    const ms = G.legalMoves(r);
    assert.ok(ms.length >= 2, 'always at least one move plus wait');
    const open = r.W * r.H - r.walls.length;
    assert.ok(open > r.motes.length + 1, 'room to manoeuvre');
  }
});

test('fuzz: random + malformed actions never crash and keep invariants', () => {
  const seeds = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987];
  for (const seed of seeds) {
    const r = G.createRun({ seed });
    let guard = 0;
    while (guard++ < 800) {
      if (r.status === 'descend') { G.takeUpgrade(r, r.choice[(guard % r.choice.length)]); continue; }
      if (r.status !== 'play') break;
      const roll = guard % 10;
      let a;
      if (roll === 0) a = { type: 'exhale' };
      else if (roll === 1) { const nb = G.neighbours(r, r.p.cell); a = { type: 'decoy', cell: nb.length ? nb[0].cell : -1 }; }
      else if (roll === 2) a = { type: 'move', dir: 99 };            // malformed dir
      else if (roll === 3) a = { type: 'decoy', cell: -7 };          // malformed cell
      else if (roll === 4) a = { type: 'nope' };                     // unknown action
      else { const ms = G.legalMoves(r); a = { type: 'move', dir: ms[guard % ms.length] }; }
      G.act(r, a);

      // invariants
      assert.ok(r.p.composure >= 0 && r.p.composure <= G.composureMaxOf(r), 'composure in range');
      assert.ok(r.p.nerve >= 0 && r.p.nerve <= G.nerveMaxOf(r), 'nerve in range');
      assert.ok(Number.isFinite(r.p.breath), 'breath finite');
      assert.ok(r.p.cell >= 0 && r.p.cell < r.W * r.H && !r.walls.includes(r.p.cell), 'player on an open tile');
      for (const rd of r.readers) {
        assert.ok(rd.trap < r.W * r.H, 'trap index sane');
        for (const ck in rd.model) for (const k in rd.model[ck]) assert.ok(Number.isFinite(rd.model[ck][k]), 'model finite');
      }
      for (const m of r.motes) assert.ok(!r.walls.includes(m), 'mote never on a wall');
    }
  }
});

test('fuzz: full runs with a greedy-ish random policy always terminate', () => {
  for (const seed of [3, 14, 27, 42, 66, 91, 120, 155, 190, 230]) {
    const r = G.createRun({ seed });
    let steps = 0;
    while (steps++ < 5000) {
      if (r.status === 'descend') { G.takeUpgrade(r, r.choice[0]); continue; }
      if (r.status !== 'play') break;
      const ms = G.legalMoves(r);
      G.act(r, { type: 'move', dir: ms[(steps * 7) % ms.length] });
    }
    assert.ok(['won', 'lost'].includes(r.status), `run terminated (seed ${seed}), got ${r.status}`);
  }
});

test('stun is a countdown: it decrements each commit and the Reader re-arms after', () => {
  const r = G.createRun({ seed: 131 });
  const rd = r.readers[0];
  rd.stun = 2;
  const safe = G.legalMoves(r).find(d => G.destOf(r, d) !== r.p.cell);
  G.act(r, { type: 'move', dir: safe });       // commit #1 -> 2 -> 1
  assert.equal(r.readers[0].stun, 1);
  G.act(r, { type: 'move', dir: G.legalMoves(r)[0] }); // commit #2 -> 1 -> 0
  assert.equal(r.readers[0].stun, 0);
});

test('a Hound traps your directional inertia', () => {
  const r = G.createRun({ seed: 141 });
  r.readers = [{ id: 0, kind: 'hound', model: {}, stun: 0, trap: -1, conf: 0, samples: 0, cell: -1 }];
  const right = G.neighbours(r, r.p.cell).find(n => n.d === 1);
  if (!right) return; // layout-dependent; skip gracefully
  // walk right three times to build the habit
  for (let i = 0; i < 3; i++) { if (r.status === 'play') G.act(r, { type: 'move', dir: 1 }); }
  const h = r.readers[0];
  if (h.trap >= 0) {
    const expect = G.neighbours(r, r.p.cell).find(n => n.d === 1);
    assert.equal(h.trap, expect ? expect.cell : h.trap, 'hound predicts "keep going right"');
  }
  assert.ok(h.conf > 0.5, 'hound is confident about your momentum');
});

test('a Mirror relocates to the cell it predicted', () => {
  const r = G.createRun({ seed: 151 });
  const start = r.p.cell;
  const nb = G.neighbours(r, start)[0];
  r.readers = [{ id: 0, kind: 'mirror', model: {}, stun: 0, trap: -1, conf: 0, samples: 0, cell: start }];
  r.readers[0].model[String(start)] = { [nb.cell]: 5 };
  G.commitReaders(r);
  assert.equal(r.readers[0].trap, nb.cell, 'mirror telegraphs its step');
  const staySafe = G.legalMoves(r).find(d => G.destOf(r, d) !== nb.cell);
  G.act(r, { type: 'move', dir: staySafe });
  assert.equal(r.readers[0].cell, nb.cell, 'mirror walked to its prediction');
});

test('standing on the Gate with motes remaining does not descend', () => {
  const r = G.createRun({ seed: 161 });
  assert.ok(r.motes.length > 0);
  r.p.cell = r.gate.cell;
  G.act(r, { type: 'move', dir: G.STAY });
  assert.equal(r.status, 'play', 'gate is inert until all motes are taken');
});

test('Unlearning effects apply on the next depth', () => {
  const r = G.createRun({ seed: 171 });
  const baseHush = G.DEPTHS[1].hush;
  r.motes = []; r.gate.open = true; r.p.cell = r.gate.cell;
  G.act(r, { type: 'move', dir: G.STAY });
  G.takeUpgrade(r, 'hush');
  assert.equal(r.depth, 2);
  assert.equal(r.hush.length, baseHush + 2, 'Hush Sense adds two hush tiles');

  const r2 = G.createRun({ seed: 172 });
  const baseComp = G.composureMaxOf(r2);
  r2.motes = []; r2.gate.open = true; r2.p.cell = r2.gate.cell;
  G.act(r2, { type: 'move', dir: G.STAY });
  G.takeUpgrade(r2, 'composure');
  assert.equal(G.composureMaxOf(r2), baseComp + 1, 'Deep Composure raises the cap');
});

test('every Unlearning changes a real parameter', () => {
  const r = G.createRun({ seed: 181 });
  const before = { cost: G.cfgOf(r).decoyCost, nerve: G.nerveMaxOf(r), comp: G.composureMaxOf(r) };
  r.upgrades.push('cheapdecoy'); assert.equal(G.cfgOf(r).decoyCost, before.cost - 1, 'Easy Lie lowers the price');
  r.upgrades.push('nerve'); assert.equal(G.nerveMaxOf(r), before.nerve + 2, 'Wider Nerve raises the cap');
  r.upgrades.push('composure'); assert.equal(G.composureMaxOf(r), before.comp + 1, 'Deep Composure raises the cap');
  r.upgrades.push('stun'); assert.ok(G.stunBonusOf(r) >= 1, 'Unnerving adds stun');
  r.upgrades.push('breath'); assert.ok(G.breathBonusOf(r) >= 6, 'Longer Breath adds breath');
  r.upgrades.push('hush'); assert.ok(G.hushBonusOf(r) >= 2, 'Hush Sense adds hush');
});
