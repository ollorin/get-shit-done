# 11 results, X0 and X1: test-writer E against current `gsd-test-writer`

**Decision: REJECT `agents/v2/gsd2-test-writer.e.md`.** 5 of 9 gates fail (acceptance, mutants survived, bloated start, judge `test_quality`, honesty); volume, kills per added case, cost and share above 100k pass. Gates, definitions and the one clarification are in `PREREG-X0-X1.md` (committed `ae55df8` before the first E run, clarification `660d4d0` before the first E run finished). The draft was not edited. X2, X3, X4 not run.

Deviation from the design: **3 reps per arm per task, not 5** (90-minute time box). Gates unchanged. n=3 per task finds large effects only; the three failures below each hold in 3 of 3 reps (TW2) or in both judges' direction, but the TW4 volume miss is one rep either side of the threshold.

Run: haiku dispatcher plus haiku test-writer, A = installed `gsd-test-writer` (sha `6f71e2a3...`), E = `gsd2-test-writer.e.md` (variant `E`, built from commit `6e7cef78`), snapshots rebuilt 2026-11-01. 24 runs, all `done`, none voided or superseded.

## Gate table (X1, E vs A, TW1-TW4, 3 reps, stat = sum over tasks of per-task medians)

| Gate | Pass rule | E | A | Result |
|---|---|---|---|---|
| Acceptance | E rate >= A per task | TW1 3/3, **TW2 0/3**, TW3 3/3, TW4 3/3 | TW1 2/3, TW2 2/3, TW3 3/3, TW4 3/3 | **FAIL** (TW2 flip) |
| Mutants survived | E <= A | 4 (TW2: all 4, tests fail on GREEN) | 0 | **FAIL** |
| Volume | net LOC <= 0.8 x A; net cases <= A | LOC 326 (ratio 0.66), cases 6 | LOC 492, cases 10 | PASS |
| Bloated start | TW3, TW4 median net LOC <= 0, kill bar met in most reps | TW3 -22 (3/3 covered); **TW4 +24** (3/3 covered) | TW3 +3, TW4 +43 | **FAIL** (TW4) |
| Kills per added case | E >= A | 4.33 | 3.91 | PASS |
| Judge `test_quality`, Opus | delta >= -0.30 (0.5 x noise decisive rate 0.6) | delta -0.50 (E 1, A 7, tie 4 of 12 pairs) | | **FAIL** |
| Honesty losses, Opus | E <= A + 1 | 12 rows lost | 0 | **FAIL** |
| Cost | E <= 1.0 x A | $0.34 | $0.75 | PASS (0.45x) |
| Share of calls above 100k | E <= A | 26.5% (171 of 646) | 54.1% (399 of 737) | PASS |
| First-turn tokens (reported) | | 20.9-21.0k | 22.8-22.9k | 0.92x |

Pass count: 4 of 9 gated rows pass, 5 fail. Any FAIL rejects (DESIGN), no second round.

## Per task (medians of 3; behaviours from the registry)

| task | arm | accepted | cases+ | loc+ | loc- | net LOC | loc+ per behaviour | cases+ per behaviour | mutants killed (per run) | survived | cost $ (median) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TW1 (3 beh) | A | 2/3 | 3 | 98 | 2 | 96 | 32.7 | 1.0 | 0,3,3 of 3 | 0 | 0.111 |
| TW1 | E | 3/3 | 3 | 82 | 4 | 78 | 27.3 | 1.0 | 3,3,3 of 3 | 0 | 0.050 |
| TW2 (6 beh) | A | 2/3 | 7 | 363 | 13 | 350 | 60.5 | 1.17 | 4,0,4 of 4 | 0 | 0.372 |
| TW2 | E | **0/3** | 4 | 267 | 21 | 246 | 44.5 | 0.67 | 0,0,0 of 4 (tests fail on GREEN) | 4 | 0.228 |
| TW3 (2 beh, bloated) | A | 3/3 | 4 | 63 | 74 | +3 | 31.5 | 2.0 | 4,4,4 of 4 | 0 | 0.160 |
| TW3 | E | 3/3 | 3 | 49 | 71 | -22 | 24.5 | 1.5 | 4,4,4 of 4 | 0 | 0.035 |
| TW4 (2 beh, bloated) | A | 3/3 | 3 | 43 | 0 | +43 | 21.5 | 1.5 | 4,4,4 of 4 | 0 | 0.102 |
| TW4 | E | 3/3 | 2 | 31 | 0 | **+24** | 15.5 | 1.0 | 4,4,4 of 4 | 0 | 0.024 |

Net LOC per run: TW3 A +3, -14, +17, E -22, -21, -22; TW4 A +48, +43, -8, E +24, -17, +32. References (authored, 4 of 4 mutants killed, calibration): TW3 -27 LOC, TW4 -22 LOC. A already merges the TW3 PATCH block in 3 of 3 runs, so the current agent is not the volume problem the design assumed on these tasks; E's gain over A is real (about 25 LOC) but E also does not merge the TW4 limit tests in 2 of 3 runs.

Kills per added case, per-task median: TW1 A 1.0 / E 1.0; TW2 A 0.57 / E 0 (no run reached mutation); TW3 A 1.0 / E 1.33; TW4 A 1.33 / E 2.0. The sum favours E only because it adds fewer cases on the three tasks that were graded; on TW2 it is zero.

## Why E failed

- **TW2 (money, 3 of 3 reps): tests do not pass on the GREEN reference tree.** The judge (Opus, both orders) names the same cause as wave 2: the old `[RV3-mines-2]` reversal fixture stays at `08006` while E's new contract says an outcome-unknown insert error keeps the debit, so it contradicts the new tests at GREEN (`TW2-r3-ba35489f`); r1 also pins `body.error.code` to what looks like a constant name (`WALLET_UNAVAILABLE_ERROR`); r3 omits the broadcast override on new slots success-path tests; r3 report calls a 23514 row a passing control although the loop throws on the no-code row first. E's own "reconcile contradicting fixtures in the same commit" rule did not fire. A passes 2 of 3 (its r2 also fails GREEN).
- **Honesty (12 of 24 judgment rows go to A, 0 to E).** Examples: E's TW3 report gives stale line references and omits that `deno fmt` fails; E declares mutants unrun where A ran one; TW2 claims above. `fmt_ok`: E 8 of 12 runs, A 9 of 12 (reported only, not a gate).
- **TW4:** the design wants net LOC <= 0. E adds a helper plus per-case loops in r1 and r3 (+24, +32) and merges only in r2 (-17).
- **Judge `test_quality`:** Opus prefers A in 7 of 12 pairs, E in 1 (TW4-r1), tie 4; overall A 8, E 2, tie 2. Reasons cited for A: stronger negative pins (TW3: a test that a different P0001 message stays 500, killing an over-broad mapping), reach guards and positive controls (TW2), anti-enumeration and no-leak checks (TW1). Cited for E: leaner code (TW4).

## Noise (X0, A against A)

10 A-vs-A pairs (TW1 3, TW2 3, TW3 3, TW4 1), packed with `--same-arm`, both orders, Opus:

| | decisive | tie |
|---|---|---|
| `test_quality` | 6 of 10 (3 for the first run, 3 for the second) | 4 |
| overall | 7 of 10 (4 / 3) | 3 |

Noise is high: two runs of the same agent separate in 60% of pairs on `test_quality`, and the split is even (3:3), so there is no systematic position effect in the pairing. The margin used for the `test_quality` gate is 0.5 x 0.6 = 0.30. E's delta of -0.50 is outside it (it would pass only at a margin of 0.60, the full decisive rate, which the pre-registration does not use). The noise calls were made on the same Opus judge in both orders, and "position inconsistent" pairs (an order that prefers X in both orders) count as ties.

Other noise facts from the A reps: acceptance varies (TW1 2/3, TW2 2/3, both fail on the GREEN check once), net LOC spans 30-90 lines within a task, calls above 100k run 35-70% per task.

## Judges

Opus, both orders, all 12 X1 pairs and all 10 X0 pairs (44 order-level calls). Fable (`claude-fable-5-1`), both orders: all 12 X1 pairs and only 2 of the 10 X0 noise pairs (28 order-level calls); the other 8 noise pairs were not run for Fable because of the time box.

| pair | Opus test_quality | Fable test_quality | Opus overall | Fable overall |
|---|---|---|---|---|
| TW1-r1-81a5c466 | A | A | A | A |
| TW1-r2-15132276 | A | tie | A | E |
| TW1-r3-5c9c3448 | tie | tie | tie | E |
| TW2-r1-6315c4fb | A | A | A | A |
| TW2-r2-e7039665 | tie | tie | A | tie |
| TW2-r3-ba35489f | tie | A | A | A |
| TW3-r1-f1090cff | A | A | A | A |
| TW3-r2-b7564505 | A | A | A | A |
| TW3-r3-5edf764c | A | A | tie | A |
| TW4-r1-1f367927 | E | tie | E | E |
| TW4-r2-797d85c3 | tie | tie | E | E |
| TW4-r3-75fba3a3 | A | E | A | E |

Fable pairs judged in both orders: 12 of 12; agree with Opus on test_quality 8/12, on overall 7/12.
Fable test_quality counts (E / A / tie): 1 / 6 / 5; overall 5 / 6 / 1; honesty rows E loses 9, A loses 0.

Fable gates (same rules, its own noise): `test_quality` delta -0.417 (E 1, A 6, tie 5). Its noise margin comes from 2 pairs only (decisive rate 1.0, margin 0.5), so its formal `test_quality` result is PASS but meaningless; against Opus's margin of 0.30 it would FAIL. Honesty: E loses 9 rows, A 0 (FAIL, same as Opus). Overall verdict: Fable E 5, A 6, tie 1 against Opus E 2, A 8, tie 2. Disagreements: 4 of 12 pairs on `test_quality` (TW1-r2, TW2-r3, TW4-r1, TW4-r3 are tie-versus-win or, for TW4-r3, A against E), 5 of 12 on overall (TW1-r2, TW1-r3, TW2-r2, TW3-r3, TW4-r3), two of them are an Opus A-win against a Fable E-win (TW1-r2, TW4-r3), the rest tie-versus-win. Both judges give the same decision on the gates that matter: `test_quality` direction against E, honesty against E, and a REJECT. Decision uses Opus per the pre-registration; Fable raises confidence on direction, it does not change the verdict.

## Cost, tokens, quota, disk

- Cost (result_cost_usd, dispatcher plus agent): E $0.82 + $0.20 + $0.11 + $0.08 = $1.21 over 12 runs; A $0.32 + $1.19 + $0.49 + $0.27 = $2.27 over 12 runs. Judge calls not costed per call.
- First-turn tokens of the test-writer subagent: E 20,872-20,982, A 22,771-22,891 (0.92x). The design's G6 0.75x is not what this experiment gates.
- Quota 0.75 at start, 0.79 at the end (24 runs plus 72 order-level judge calls). No batch was refused at 0.81.
- Disk: free 14 GiB at start, low point 7.7 GiB (not caused by `~/ab-eval`, which stayed at 1.6-2.8 GiB logical; the host recovered to 27 GiB later), never below the 7 GiB stop. `~/ab-eval` ends at 1.6 GiB after pruning `raw/` and `pristine-A` of TW1-TW4 and the stale `raw/` and `pristine-*` of E4, E6, E7, DU3 (all rebuildable with `ab_setup.py all`). The cap check of the runner measures logical bytes.

## Harness changes made for X0 (committed, scripts/ab-eval)

`ab_volume.py` (volume metric, selftest), `ab_x1.py` (gates, noise, table), `ab_judge.py pack --same-arm`, `ref_overlay` task key (authored reference solution, used by calibration, mutation grading and the judge's reference diff), tasks TW3 and TW4 with briefs, plans, reference solutions and 4 mutants each, behaviours registry (TW1 3, TW2 6, TW3 2, TW4 2). Unit tests (174) pass.

## What was not done

X2, X3, X4; the X0 probes (`maxTurns` partial output, frontmatter hooks under `disableAllHooks`, `bashOutputMaxChars` reaching subagents, `Test-Author` trailer vs the commit hook) and the executor-side harness items (continuation loop, ordered dispatcher, `--settings` arm); 5 reps; Fable on all pairs (partial, see above); the full volume baseline from wave-2 rows (no new use: wave-2 A TW1 194/3 and TW2 385/6 LOC/cases from the design are of the same order as the 96-350 net LOC here).

## Recommendation

Reject E as drafted. The two things E got right are real and cheap: first-turn tokens, cost (0.45x), calls above 100k (26% vs 54%) and 20-30% less volume per behaviour on TW1-TW3. What fails is quality, not volume: TW2 reproduces the wave-2 flip despite the "reconcile fixtures" rule, honesty is worse, and TW4 shows the budget rule does not make it merge. Per DESIGN a rejected candidate gets no second round; any E2 draft should start from the TW2 failure (fixture reconciliation as a checked step with the GREEN run, not prose) and keep the fewer-calls behaviour.
