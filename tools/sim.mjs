// PHASE 4 — simulation harness. Runs many sessions per agent and reports the
// metrics the brief asks for: completion, failure causes, dominant strategies,
// unused mechanics, difficulty spikes, degenerate strategies, resource
// runaway, softlocks.
import * as G from '../src/core/game.js';
import { ROSTER } from './bots.mjs';

const RUNS = +(process.env.RUNS || 300);
const only = process.env.BOTS ? process.env.BOTS.split(',') : Object.keys(ROSTER);

function oneSession(Bot, seed) {
  const run = G.createRun({ seed });
  const bot = Bot();
  const m = {
    won: false, cause: null, depth: 0, turns: 0, hits: 0, startles: 0,
    decoys: 0, exhales: 0, motes: 0, hushSteps: 0, nerveEnd: 0, breathEnd: 0,
    softlock: false, depthReached: [], stuckRun: 0, maxStuckRun: 0,
  };
  let guard = 0;
  while (guard++ < 4000) {
    if (run.status === 'descend') {
      m.depthReached.push(run.depth);
      G.takeUpgrade(run, run.choice[(run.rng.next() * run.choice.length) | 0]);
      continue;
    }
    if (run.status !== 'play') break;

    const a = bot(run);
    if (a.type === 'decoy') m.decoys++;
    if (a.type === 'exhale') m.exhales++;
    // A REAL softlock is the only kind that counts: every legal move is
    // dangerous, repeatedly, so the player cannot act without being hurt.
    // (v1 of this detector counted ordinary travel as "stuck" and produced
    //  123 false positives; a direct probe found 0 all-dangerous turns.)
    const ms = G.legalMoves(run);
    if (ms.every(d => G.dangerOf(run, G.destOf(run, d)) > 0)) {
      m.stuckRun++;
      m.maxStuckRun = Math.max(m.maxStuckRun, m.stuckRun);
      if (m.stuckRun >= 5) m.softlock = true;
    } else m.stuckRun = 0;
    const ev = G.act(run, a);
    for (const e of ev) if (e.type === 'hush') m.hushSteps++;
    if (run.status === 'won' || run.status === 'lost') break;
  }
  m.won = run.status === 'won';
  if (m.won) m.depthReached.push(run.depth);   // escaping clears the last depth
  m.cause = run.cause;
  m.depth = run.depth;
  m.turns = run.turn;
  m.hits = run.totalHits;
  m.startles = run.totalStartles;
  m.motes = G.DEPTHS.slice(0, run.depth).reduce((a, d) => a + d.motes, 0) - run.motes.length;
  m.nerveEnd = run.p ? run.p.nerve : 0;
  m.breathEnd = run.p ? run.p.breath : 0;
  m.upgrades = run.upgrades.length;
  return m;
}

const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const r3 = n => +Number(n).toFixed(3);

const report = {};
for (const name of only) {
  const Bot = ROSTER[name];
  const ms = [];
  for (let s = 1; s <= RUNS; s++) ms.push(oneSession(Bot, s * 7919 + 13));

  const won = ms.filter(m => m.won).length;
  const causes = {};
  for (const m of ms) causes[m.cause] = (causes[m.cause] || 0) + 1;

  // per-depth clear rate = of sessions that REACHED depth d, how many got past it
  const reached = {}, cleared = {};
  for (const m of ms) {
    for (let d = 1; d <= G.DEPTHS.length; d++) {
      if (m.depth >= d) reached[d] = (reached[d] || 0) + 1;
      if (m.depthReached.includes(d)) cleared[d] = (cleared[d] || 0) + 1;
    }
  }
  const perDepth = {};
  for (let d = 1; d <= G.DEPTHS.length; d++) {
    perDepth[d] = reached[d] ? r3((cleared[d] || 0) / reached[d]) : null;
  }

  report[name] = {
    sessions: RUNS,
    completionRate: r3(won / RUNS),
    avgDepthReached: r3(avg(ms.map(m => m.depth))),
    lossCauses: causes,
    perDepthClearRate: perDepth,
    avgTurns: r3(avg(ms.map(m => m.turns))),
    avgHits: r3(avg(ms.map(m => m.hits))),
    avgStartles: r3(avg(ms.map(m => m.startles))),
    avgDecoys: r3(avg(ms.map(m => m.decoys))),
    avgExhales: r3(avg(ms.map(m => m.exhales))),
    decoyUsingSessions: r3(ms.filter(m => m.decoys > 0).length / RUNS),
    avgHushSteps: r3(avg(ms.map(m => m.hushSteps))),
    avgNerveAtEnd: r3(avg(ms.map(m => m.nerveEnd))),
    avgBreathAtEnd: r3(avg(ms.map(m => m.breathEnd))),
    breathEndOnWins: r3(avg(ms.filter(m => m.won).map(m => m.breathEnd))),
    nerveEndOnWins: r3(avg(ms.filter(m => m.won).map(m => m.nerveEnd))),
    softlockSessions: ms.filter(m => m.softlock).length,
    longestStuckRun: Math.max(...ms.map(m => m.maxStuckRun)),
  };
}

console.log(`TELL simulation — ${RUNS} sessions per agent, ${only.length} agents`);
console.log('='.repeat(78));
for (const [k, v] of Object.entries(report)) {
  console.log(`\n### ${k}`);
  console.log(JSON.stringify(v, null, 1));
}

// --- automated verdicts -----------------------------------------------------
console.log('\n' + '='.repeat(78));
console.log('AUTOMATED VERDICTS');
const names = Object.keys(report);
const best = names.reduce((a, b) => report[a].completionRate > report[b].completionRate ? a : b);
console.log(`dominant strategy            : ${best} (${report[best].completionRate})`);
console.log(`degenerate win (random/turtle): random=${report.random?.completionRate} turtle=${report.turtle?.completionRate}`);
for (const n of names) {
  const v = report[n];
  const flags = [];
  if (v.softlockSessions > 0) flags.push(`SOFTLOCK x${v.softlockSessions}`);
  if (v.avgDecoys < 0.05 && n !== 'turtle' && n !== 'random') flags.push('DECOY UNUSED');
  if (v.avgStartles < 0.1 && n !== 'turtle') flags.push('STARTLE UNUSED');
  // Runaway only counts if the agent actually FINISHED with resources to burn;
  // dying with Breath to spare is just a different failure, not an exploit.
  if (v.breathEndOnWins > 30) flags.push('BREATH RUNAWAY');
  if (v.nerveEndOnWins > 4.5) flags.push('NERVE RUNAWAY');
  const rates = Object.values(v.perDepthClearRate).filter(x => x !== null);
  const drop = rates.length > 1 ? Math.min(...rates) : 1;
  if (drop < 0.35 && rates.length > 1) flags.push(`SPIKE at clear<0.35`);
  console.log(`${n.padEnd(12)} ${flags.length ? flags.join(', ') : 'ok'}`);
}
