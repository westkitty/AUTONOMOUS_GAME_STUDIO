# TELL

> It is learning how you move.

**TELL** is a turn-based browser game whose adversaries are not monsters — they are
*statistical models of the player*. Every Reader watches a different pattern in your movement
and, **before you move**, marks the tile it believes you will step onto. Efficiency demands
repeating good routes; repetition is exactly what a Reader learns. Break a certainty and the
Reader is *startled* — the game's only real source of Breath. You cannot outrun the dark.
You have to lie to it.

The game was invented, built, playtested and balanced by an autonomous studio loop: research →
invention → three runnable prototypes → selection by executed output → production → seven-agent
automated playtesting → five evidence-driven balancing passes → human-experience pass → QA.
The full record lives in `DESIGN.md` and `docs/PLAYTEST_REPORT.md`.

## Play

```
npm start        # serves the game; open the printed preview URL
```

Open the preview in a browser. Five depths, escalating Readers (Sentry, Hound, Archivist,
Chorus, Mirror), Unlearning upgrades between depths, save/resume, settings (colour-blind,
high-contrast, reduced motion, text size), full keyboard + touch + click controls.

- Move `↑↓←→` / `WASD` · wait `Space` · Exhale `E` · Decoy `Q` then a direction ·
  tells `H` · menu `Esc`

## Develop / verify

```
npm test         # 13 invariant tests over the headless core
npm run sim      # seven automated playtesters, metrics + verdicts (RUNS= / BOTS=)
npm run proto    # re-run the Phase-2 reference experiment on the winning mechanic
```

The simulation core (`src/core/`) is pure, deterministic and JSON-serializable — the same module
drives the shipped game, the automated playtesters and the tests, so what is measured is what
ships.

## Layout

```
src/core/      headless simulation (game, rng, upgrades) — no DOM
src/web/       browser shell (renderer, audio, input, HUD, settings, save)
tools/         serve.mjs (static server), bots.mjs (playtesters), sim.mjs (harness)
prototypes/    tell/ reference experiment + judge.mjs
test/          core.test.js
docs/          phase2_judge.txt, phase4_sim_*.txt, PLAYTEST_REPORT.md
DESIGN.md      research + invention log (Phases 1–2)
```
