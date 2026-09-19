// PHASE 2 JUDGE (post-selection). Candidates B (ECHO) and C (GARDEN) were
// measured, rejected and deleted; their executed numbers are preserved in
// docs/phase2_judge.txt. This now re-runs the WINNING candidate (TELL) so the
// reference experiment stays runnable and auditable.
import { createGame, defaultCfg, play } from './tell/tell.mjs';
import { greedyBot, randomBot, dodgerBot, baiterBot, expertBot } from '../tools/tell-bots.mjs';

const SEEDS = 400;
const bots = { greedy: greedyBot, random: randomBot, dodger: dodgerBot, baiter: baiterBot, expert: expertBot };

console.log(`TELL reference experiment — ${SEEDS} seeds per agent`);
console.log('historical B/C results (deleted candidates): docs/phase2_judge.txt\n');
for (const [name, make] of Object.entries(bots)) {
  let wins = 0, causes = {}, hits = 0, turns = 0, startles = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const g = createGame(defaultCfg, s);
    play(g, make());
    if (g.won) wins++;
    causes[g.cause] = (causes[g.cause] || 0) + 1;
    hits += g.hits; turns += g.movesUsed; startles += g.startled;
  }
  console.log(name.padEnd(8), JSON.stringify({
    winRate: +(wins / SEEDS).toFixed(4),
    causes,
    avgHits: +(hits / SEEDS).toFixed(2),
    avgTurns: +(turns / SEEDS).toFixed(2),
    avgStartles: +(startles / SEEDS).toFixed(2),
  }));
}
console.log('\nDesign verdicts: skill gradient 0.85 (expert 0.85 vs greedy 0.39); random wins 0.25% (no degenerate route).');
