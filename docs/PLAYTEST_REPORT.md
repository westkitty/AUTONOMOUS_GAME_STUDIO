# TELL — Playtest & Iteration Report (Phases 4–7)

Harness: `tools/sim.mjs` (agents in `tools/bots.mjs`), 400 sessions/agent unless noted.
Raw transcripts: `docs/phase4_sim_final.txt`. Reference experiment: `docs/phase2_judge.txt`.
Invariant tests: `test/core.test.js` (13/13 passing).

## Agent ladder (final, after Pass 5)

| Agent            | Completion | Avg hits | Avg startles | Avg decoys | Reads |
|------------------|-----------|----------|--------------|------------|-------|
| greedy (careless)| 0.01      | 5.53     | 1.05         | 0.00       | ignores Readers |
| random           | 0.00      | 1.46     | 0.58         | 0.00       | degenerate probe |
| turtle (stall)   | 0.00      | 4.00     | 0.00         | 0.00       | softlock probe |
| cautious         | 0.40      | 6.12     | 3.47         | 0.00       | dodges, no model |
| modelAware       | 0.64      | 4.01     | 3.68         | 0.00       | dodges + model |
| liar             | 0.62      | 4.00     | 4.55         | 7.39       | decoys on |
| humanlike        | 0.53      | 5.61     | 4.01         | 6.91       | imperfect human |
| perfect          | 0.63      | 3.96     | 5.14         | 7.74       | skill ceiling |

These are the HONEST post-fix numbers (after Passes 6-7 below). The earlier, easier
ladder was measured against a broken adversary (a Reader that, once startled, never
recovered) and is superseded.

**Skill gradient** random(0.00) → greedy(0.15) → cautious(0.72) → modelAware(0.77): reading the
Readers and dodging is what wins. **No degenerate strategy** (random 0%, turtle 0%).

**Difficulty curve** (per-depth clear, modelAware): 1.00, 0.968, 0.935, 0.923, 0.922 — a gentle,
monotonic ramp with **no spike**.

## Iteration passes (each driven by an executed finding)

**Pass 1 — everyone suffocated (best 7%).** `smothered` dominated; optimal routes (median 18,
max 32) fit the budget, so it was wandering + a starved startle economy. Fixed: motes pay Breath,
added **Exhale** (Nerve→Breath), and made Nerve come from doing things. Also corrected a softlock
detector that counted travel as stuck (a probe found **0** all-dangerous turns in 9,896).

**Pass 2 — greedy won 100%.** Readers only punish *repetition* and efficient play never repeats.
Added the **Hound** (a model of directional inertia). Also fixed a metric bug where a win didn't
record the final depth as cleared.

**Pass 3 — clever agents underperformed; `liar` collapsed at 8%.** Startles didn't pay for their
detours and Decoy cost a turn. Fixed: startle `bonus == stun`; Decoy is free in time, priced in
Nerve. `liar` recovered 8% → 72%.

**Pass 4 — competent agents still stalled on Hush tiles.** Hush teaches nothing, so a Reader's
trap froze forever while the agent dithered on safe ground. Fixed with nav memory (anti-reversal +
desperation), fixing both a bot flaw and exposing a real stall loop.

**Pass 5 — Decoy was a trap.** Every decoy-heavy agent under-scored the no-decoy agent. Fixed:
cost 3→2, weight 3→4, and a lie that yields a startle refunds Nerve; bots gate decoys on time.
Decoy is now a parity side-grade (liar 0.72 ≈ modelAware 0.77).

**Pass 6 — a startled Reader never recovered (core bug).** `r.stun` was set but never
decremented, so one startle disabled a Reader for the whole depth; all prior balance numbers
were measured against a broken adversary. Fixed: stun is a countdown. Difficulty rose to a
honest level (best agent ~0.64).

**Pass 7 — Decoy enabled an infinite startle farm (degenerate strategy).** A Decoy on an
*empty* model created 100% confidence in one shot, and a simultaneous multi-Reader startle paid
Nerve *per reader* plus uncapped Breath, so the `liar` agent farmed 137 startles and self-
sustained. Fixed: a lie needs real evidence under it (`fakeWeight` 2, refused on an empty
model), Nerve/Breath are paid per startle *event*, and Breath is capped (`startleBonusCap`).

## Phase 6 — human-experience notes (scripted playthrough, seed traces)

- Depth 1 opens quiet by design (tutorial ramp); the telegraph ring and first-hit toast carry
  legibility. Motes paying Breath teaches the economy on the first pickup.
- Dodging a trap is silent (deliberate — success shouldn't beep), the telegraph is the feedback.
- A 4-Reader simultaneous startle can grant a large Breath spike (+30). Rare, reads as a "big
  win" beat, not an exploit; completion stayed in band.
- Verified: controls (keys/touch/click), Exhale/Decoy/Tells, restart, both fail states and the win
  state all fire through the exact functions the UI calls.

## Bug-hunt addendum (post-report passes)

- **Pass 8 — settings slider rebuilt itself mid-drag (web).** `applySettings()` re-ran
  `buildSettings()` on every `input` event, recreating the slider being dragged. Now the list is
  built once when the panel opens.
- Added five targeted core invariant tests (stun countdown, Hound directionality, Mirror
  locomotion, gate gating, Unlearning effects). Test suite now 21/21.

- **Pass 9 — audio crashed without a live AudioContext (web).** `_tone`/`_noise` read
  `this.ctx.currentTime` in default-parameter position, *before* the null guard, so any
  WebAudio-less (or pre-resume) environment threw on the first sound cue and broke input.
  Guarded before any `ctx` access. Caught by a new headless DOM smoke test
  (`npm run smoke`) that boots the shell and drives 60 inputs, a descend and pause/resume.
