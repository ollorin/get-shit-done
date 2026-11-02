# Exp 14: pilot results (2026-11-02)

76 runs on Haiku, $18.42, weekly use 97% to 98%. Rows: `~/ab-eval/results/runs-ponytail.jsonl`. A pilot ships nothing. No blind judges.

## Verdicts

| role | verdict | next |
|---|---|---|
| reviewer | no harm or gain shown on Sonnet | full A/B with judges, required K1 as a gate |
| test-writer | best candidate | full A/B with same-period controls, many reps on TW2 |
| executor | this draft rejected | do not run a full A/B of it |

## Executor (same-load comparison)

| task | acceptance A | P | P without `git stash list` | median added A / P | mean cost A / P |
|---|---|---|---|---|---|
| E6 | 5/6 | 5/6 | 5/6 | 130 / 115 | $0.14 / $0.11 |
| E7 | 5/6 | 4/6 | 5/6 | 146 / 139 | $0.31 / $0.26 |
| E4 | 2/2 | 3/5 | 5/5 | 195 / 332 | $0.79 / $1.26 |

- Real harm in P: E7 r2 failed hidden tests with the smallest diff of the arm (61 lines, money-adjacent); E6 r1 ran `deno test --no-check` in a scratch copy, a forbidden flag.
- Hidden tests: A 14/14, P 16/17.
- Code volume: small cut on E6 and E7, more code and 60% more cost on E4. E1 (control from 2026-11-01, not same load): 949 vs 1098 lines, hidden tests fail in both arms.
- Reading: our executor gets decomposed plans, where the ladder finds little to cut. This matches the vendor's near-zero effect on surgical tasks. Sample is small; the verdict rests on no gain plus one real failure, not on a statistic.

## Test-writer

| task | acceptance A / P | added A / P |
|---|---|---|
| TW1 | 3/6 / 3/3 | 160 / 107 |
| TW3 | 3/3 / 3/3 | 73 / 63 |
| TW4 | 3/3 / 3/3 | 42 / 33 |
| TW2 | 0/3 / 1/6, same period, see below | 353 / 347 |

Controls for TW1, TW3, TW4 are from 2026-11-01, so this is not a same-load comparison. The section is scoped to non-T0, yet TW1 and TW3 (T0) also shrank; that may be noise or leakage, and needs a look.

TW2 is a real, hard check, not a grader or environment fault (the first reading here was wrong). The new behaviour contradicts an existing test: `[RV3-mines-2]` expects 500 and a reversal on a codeless insert failure, while the reference fix returns 503 and keeps the debit. The grader copies the agent's test file onto the reference tree (`ab_role_grade.py:255-266`), so the check passes only if the agent also updates that old test. Reproduced with the exact flow: 503 vs 500 at that assertion, 83 passed, 1 failed; the reference test file alone passes 86/86 with or without `.env.test` and with Redis unreachable.

Across all 24 completed TW2 runs the split is exact: the 6 that passed edited the RV3 tests (A 5, P 1), and the 18 that did not all failed (A 4, P 5, E 3, B 3, C 3).

| period | A | P | E |
|---|---|---|---|
| 2026-11-01 | 5/6 | | 0/3 |
| 2026-11-02 | 0/3 | 1/6 | |

Same frozen agent text, brief, overlay, memory and CLI version for A on both days (compared on disk). The swing is unexplained: run variance or a server-side model change, unverified. Consequences: P is not shown to be worse than A here, and test-writer E's TW2 gate (0/3 vs 2/3) is weaker than it looked, though it did fail this check for real, and its other failures stand. This task needs many more reps and same-period controls.

## Reviewer (both arms re-run on Haiku)

| task | findings per run Q2 / P | known defects Q2 / P |
|---|---|---|
| R1 | 4.0 / 2.5 | 1/6 / 0/6 |
| R2 | 4.2 / 3.8 | 8/12 / 8/12 |

About 22% fewer findings, recall about level (9/18 vs 8/18). R1 K1 is required and Haiku nearly always misses it in both arms, so this task says little on Haiku; Sonnet found it at 0.83 (`RESULTS-wave3-reviewer.md`, arm A). Whether the dropped findings were empty is unverified: no judge ran. A Haiku result is a signal only.

## Reviewer on Sonnet, the production tier (both arms alternating, same period, $1.39)

Rows: `~/ab-eval/results/runs-ponytail-sonnet.jsonl`.

| task | findings per run Q2 / P | HIGH total Q2 / P | known defects Q2 / P | cost total Q2 / P |
|---|---|---|---|---|
| R1 | 5.3 / 4.0 | 3 / 0 | 3/3 / 2/3 | $0.45 / $0.30 |
| R2 | 4.3 / 4.7 | 0 / 2 | 5/6 / 6/6 | $0.31 / $0.33 |

Recall is level (8/9 each), findings about 10% fewer in total, acceptance 6/6 each. Neither harm nor gain is shown. Watch: R1 K1 is required on a wallet task and P found it less often on both tiers (Sonnet 2/3 vs 3/3, Haiku 0/6 vs 1/6, together 2/9 vs 4/9); too few runs to conclude, and it is the risk "no case, no finding" was expected to carry. Whether the dropped findings were empty is still unjudged. Full A/B after the reset: Opus judges, more review tasks (only 2 exist), K1 as a named gate.

## Harness lessons

- Controls must run under the same conditions. Controls from the day before made TW2 look like a 5/6 to 1/6 regression caused by P; a same-day control scored 0/3. Round 1 and 2 readings of executor acceptance were also too harsh (5/9 vs 11/11).
- `git stash list` was graded as a bypass (`BYPASS_RE`); fixed. It appeared in 5 P runs and in no same-load A run, reason unknown, harmless.
