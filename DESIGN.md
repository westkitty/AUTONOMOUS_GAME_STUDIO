# TELL — Autonomous Game Studio Design Log

## PHASE 1 — RESEARCH

Sources surveyed: experimental/jam games, board-game mechanism taxonomies, puzzle-game
rule-escalation design, systems-driven sims, and the game-AI design-pattern literature.

Design principles extracted (and used):

1. **AI as Adversary + AI is Visualized** (Treanor, *AI-Based Game Design Patterns*, FDG 2015).
   When an opponent's *internal state* is directly visible, the player stops playing the world
   and starts playing the model. The design space becomes "manipulate what it believes."
   → This became the core of TELL.
2. **Opponent modelling as gameplay, not just difficulty.** The literature (Albrecht & Stone's
   opponent-modelling survey; *Alien: Isolation*'s alien that learns repeated tactics) treats
   prediction as an *unfair advantage* the player cannot see. Inverting that — showing the
   prediction before it resolves — turns an AI cheat into a legible mind-game.
3. **Feedback geometry determines cognition** (mechanics-to-cognition synthesis): short-horizon
   feedback produces reactive heuristics; delayed, interdependent outcomes produce forward
   simulation and counterfactual reasoning. → TELL's model is *delayed*: a habit you build now
   is what kills you six turns later.
4. **Simultaneous / committed action selection** (RoboRally, Race for the Galaxy): tension comes
   from committing before you see the opponent's choice. → The Reader commits its trap *before*
   you move, and you can read the commitment.
5. **Constraints drive invention** (FAD jam, "draw nothing on screen"). → One grid, one verb.
6. **Push-your-luck as an economy** (Unstable Load): safety and yield must be in direct
   conflict, not merely co-present.

Nothing was cloned. The central mechanic is not taken from any surveyed title.

## PHASE 2 — INVENTION

Twenty-four central mechanics were generated. Rejected as obvious / derivative / already
well-covered: gravity flip, time rewind, deckbuilder, tower defence, colour matching,
tetromino stacking, one-button rhythm, snake growth, tower-climb platformer, roguelike
card combat, word-chain, light/shadow stealth, magnetism, conveyor factory, rope physics,
territory painting, dice-face-shaped pieces, health-as-currency, reverse tower defence,
infection-spreading rules, symbiotic two-body control, score-spawns-hazards, queue-order
survival, echolocation-only navigation.

Three genuinely different candidates were built as **runnable** experiments and judged on
executed output (`node prototypes/judge.mjs`, transcript in `docs/phase2_judge.txt`):

### Candidate A — TELL
The adversary *is* a statistical model of the player. Each turn it commits a trap onto the
cell it predicts you will enter, based on your own transition history, and the commitment is
visible before you move. Break a confident guess and it is startled.

### Candidate B — ECHO
Temporal self-cooperation: record K turns, then a ghost replays them while you control a
second body; the exit opens only on frames where the two of you hold two plates at once.

### Candidate C — GARDEN
Ecology steering: seed a cellular automaton with cyclic dominance and steer it only by
pruning; harvest target biomass before the season ends.

### Measured results (400 seeds for A, 24 layouts for B, 120 seeds for C)

| Candidate | Headline measured signal |
|---|---|
| **A — TELL** | Skill gradient (best−worst win rate) **0.850**. greedy 39.0%, random **0.25%**, dodger 64.0%, baiter 48.5%, expert **85.25%**. No degenerate strategy: pure randomness dies 399/400. |
| **B — ECHO** | 100% of layouts solvable, median 154 distinct solutions (robust, forgiving) — but **naive-play win rate 0.000**: the obvious way to play fails 24/24 layouts. |
| **C — GARDEN** | random and greedy bots **both win 100%** with yield SD **0.00**. Player actions have no measurable effect on the outcome. No agency. |

Rubric totals (A/B/C): **33 / 21 / 26**. **Winner: A — TELL.**

### Findings that changed the design (all from execution, none assumed)

- **F1 — v1 of the core was unplayable, and the harness hid it.** `greedy` and `reactive` bots
  produced *byte-identical* statistics. Tracing showed `g.trap` was computed inside `step()`,
  so the policy saw the *previous* turn's trap. The prediction was never visible before the
  move, destroying the whole premise. Fixed by splitting the turn into
  commit → reveal → act → resolve. (`startleBonus` was also rewinding the turn counter —
  the trace showed `turn 2 → turn 0`; time is now *granted*, never rewound.)
- **F2 — the startle engine is not on the winning path.** The strongest bot triggers
  **0.14** startles per game while the slow-but-safe dodger farms **6.36**. An intended
  mechanic that the best strategy ignores is dead weight. → In production, **startles are the
  primary time economy**, so baiting becomes load-bearing rather than decorative.
- **F3 — Breath, not the Reader, was the binding constraint.** Timeouts were the dominant loss
  for every skilled bot (dodger 144/400, baiter 206/400, expert 59/400) while they took
  **0.00** hits. Threat and economy were parallel, not interlocked. → Production makes the two
  feed each other.
- **F4 — two of my own "expert" bots were broken, not the design.** Both baiter implementations
  scored 3% because they treated dodging as a conditional branch and fell through to a move
  that walked onto the trap (4.88 hits/game). Corrected by making safety a hard filter.
  Recorded so the 48.5% figure is attributable to the *strategy*, not to a bug.

### Losers deleted

`prototypes/echo/` and `prototypes/garden/` were removed from the repository. Neither mechanic
appears anywhere in the production game. Candidate A's prototype is retained at
`prototypes/tell/` as the reference experiment the production core descends from.
