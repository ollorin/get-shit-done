# 07 A/B results, wave 3: reviewer (R1, R2)

Status: **reviewer = REJECT Q** (one gate fails: G5, the honesty-loss clause). G1, G2, G3, G4, G6 pass.

Arm Q = `gsd2-reviewer` draft (`~/get-shit-done/agents/v2/gsd2-reviewer.md`, sha256 `e6f6aba6...`, variant Q built at `b5a5317`, hash equals the file at HEAD `ad0bd1c`, no stale-build drop). Arm A = `general-purpose` reviewer under the current instructions. Reviewer model sonnet, haiku dispatcher, any other model voids a run (none did). 2 tasks x 2 arms x 3 reps = 12 runs, 6 matched pairs. Judge Opus, blinded, both orders. Second judge (Fable) off (design default; not run). Gate text: `~/ab-eval/logs/wave3/agg/review-Q.txt`, `.REPORT.md`, `.decision.json`. Run log: `~/ab-eval/logs/wave3/runs.log`, `judge.log`.

Tasks: R1 wallet player-transaction view, known K1 `k in metadata` inherited-property read (required). R2 adjustment-authority amount parser, K1 unbounded digit runs before BigInt (required), K2 non-string amount throws TypeError (required). Calibration was already PASS (README/RUNNER matrix); no calibration or task change this wave.

## Gates (`ab_aggregate.py --judge-model opus --variant-b Q --role review`)

| gate | result | numbers |
|---|---|---|
| G1 manipulation | PASS | 6 runs per arm within 5% of 18,346 inherited chars |
| G2 acceptance | PASS | 6/6 vs 6/6, no task flips (acceptance = report present, tree untouched) |
| G3 known recall | PASS | A 0.83, Q 1.00 (below), required items short in Q: none |
| G4 criticals | PASS | 0 vs 0, no contamination, no tier violations, no denials |
| G5 judged | **FAIL** | pairs A-win 2, Q-win 3, tie 1; no task with an A major-win in both orders in >= 2 reps; **honesty-dimension losses Q 5 vs A 0 (limit A + 1)** |
| G6 first-turn tokens | PASS | median A 25,080, Q 18,044, ratio 0.72 (bar 0.75) |

Per-run first-turn tokens: A 25,076 to 25,084, Q 18,039 to 18,048 (all six each).

## Recall of known defects (`ab_match`, Sonnet matcher, `results/matches.jsonl`)

| task | A r1/r2/r3 | Q r1/r2/r3 |
|---|---|---|
| R1 K1 | found 3/3 | found 3/3 |
| R2 K1 (digit-run bound) | missed, missed, found | found 3/3 |
| R2 K2 (non-string throws) | found 3/3 | found 3/3 |

Per-run recall: A 1.0 on R1 x3, 0.5 (R2 r1, r2) and 1.0 (R2 r3); mean A 0.83. Q 1.0 in all six, mean 1.00. Q's win is R2 K1, which A missed in 2 of 3 reps. The Q draft's money/auth bullet ("fail-open reads, ... replay") and its severity-ordered "report every finding" instruction are the plausible cause; this is a hypothesis from the report text (Q R2 findings F1/F2 name both K1 and K2), not a traced mechanism.

## False positives and judge

No objective false-positive oracle exists for reviews; the figure is the judge's `false_positives` dimension per order verdict (12 verdicts): A better in 4 (R1 r1 both orders, R2 r2 both orders), Q better in 1 (R1 r3 o1), tie in 7. Q returned 4 to 7 findings per run (mean 5.3: 7, 4, 5, 5, 5, 6); A's prose reports were not counted (no parseable finding list).

| pair | verdict (both orders) |
|---|---|
| R1 r1 | A-win (Q buried K1 as LOW naming F5 while F4 calls the same guard redundant; speculative `crash_point` F3 at MED; F6 type-alias nit; F7 "could not run tests" listed as a finding) |
| R1 r2 | A-win (Q cites `:55` and `:41` where the code is at `:62` and `:51`; F5 evidence contradicts itself) |
| R1 r3 | Q-win |
| R2 r1 | Q-win (severity: Q rated the non-string throw HIGH, A did not find K1) |
| R2 r2 | tie (position-inconsistent: Q, then A) |
| R2 r3 | Q-win |

## Why Q lost G5 (traced)

All five honesty losses are on the disclosure axis, not on a wrong claim of a result (judge reasons in `~/ab-eval/judge/<PAIR>/o*/out-opus.json`):

1. R1 r2, both orders (2 losses). A ran `deno test .../player-transaction-view.test.ts` (7 passed; the one Bash test call in 6 A runs, transcript `R1-A-r2`). Q ran nothing (subagent tool use: 2 Bash `cat`) and its report says nothing about unit tests. The judge text says Q "claimed execution was forbidden"; that sentence is not in Q's report (`grep -i forbid` on `R1-Q-r2.../report.md` finds only line 40's unrelated "mutant run"), so that part of the judge reason is **unverified**. The supportable part is: A disclosed and ran, Q was silent.
2. R1 r3, both orders (2 losses). Q's closing note says only that integration tests were not run (`R1-Q-r3.../report.md:41,46`), leaving unit-test status unstated; A stated what was and was not executed.
3. R2 r2 o1 (1 loss). A disclosed the failed `zg query` caller trace (`ZVEC_FILE_META_MISSING`); Q only lists zg as a probe. Q's R2 r2 report does say "NOT RUN: the unit tests were not run" (line 46), so its loss is on the caller trace only; the other order is a tie.

Structural cause: the draft's contract is "Your entire reply is one JSON array and nothing else" (`gsd2-reviewer.md`, Report section). There is no field for what was run, not run or unverified, so disclosure depends on whether the model volunteers it inside a finding. The Q reports in the run directories carry prose around the JSON (e.g. R2-Q-r1 preamble, R1-Q-r3 closing note at lines 46), which comes from the haiku dispatcher, so NOT RUN text in those reports is not the reviewer's own disclosure (unverified for the other runs). The draft also permits "allowlisted unit-test shapes" but Q ran none in 6 runs and never used `zg query` (A used it in 3 of 6). Q's wrong line numbers (R1 r2) trace to reading the diff and file with `cat` without line numbers (Q-r2 tool calls: 2 Bash `cat`), against the draft's "Read files by section with offset and limit".

## Cost and time (result lines, 3 runs per cell pair)

| arm | run cost | mean wall | mean output tokens |
|---|---|---|---|
| A | $1.262 (6 runs) | 54.7 s | 3,094 |
| Q | $0.768 (6 runs) | 45.1 s | 2,619 |

Q costs 0.61x A. Judge calls (12 Opus calls) and 12 Sonnet matcher calls are not in these totals. Total wave wall time about 40 min including setup.

## Decision

**REJECT Q as drafted.** Rejected on the honesty clause alone; it is a cheap defect (no place to disclose), not a quality deficit: Q has equal acceptance, better recall (1.00 vs 0.83), passes G6 at 0.72 (every B/C cell in wave 2 failed the 0.75 bar), and wins 3 of 6 pairs to A's 2. Caveats: 6 pairs on 2 tasks cannot establish non-inferiority (design 6.3 power note), the honesty count rests on 5 verdicts from 3 reps, and blinding is imperfect because Q's JSON-array report format differs visibly from A's prose. No rerun was done (time-box rule); no draft was edited.

## Most valuable change for the next candidate

Add a mandatory final array element, for example `{"id":"META","ran":["..."],"not_run":["..."],"unverified":["..."]}`, and require the reviewer to run the changed unit-test file once (`deno test <file>`) and record the result, plus `Read` with offset/limit (or `cat -n`) for every cited line. This targets all five honesty losses and the one wrong-anchor loss, and keeps the JSON-only contract that makes the output machine-filterable.

## Operations

- Setup: `ab_setup.py base`, `index`, `variant` for A and Q on R1 and R2 (pristine-A, pristine-Q). R1 and R2 each used 680 MB (raw 201 MB + two pristine 237 MB); the first queue (12 jobs) was **refused by the 3.0 GiB eval-size cap** (3.02 GiB) with no run started, so no row exists from it. I deleted only `tasks/R1/raw` and `tasks/R2/raw` (my own regenerable scratch) and reran the identical queue.
- No partial R-task rows from the earlier operator: `results/runs.jsonl` had no R1/R2 rows and no R run directories. Nothing superseded. No harness defect found, no harness change, no void runs.
- Quota: seven_day utilisation 0.64 at start, 0.71 at end (limit for a new batch 0.82). Disk free 11 GiB at start, 15 GiB at end (floor 7 GiB). `~/ab-eval` 2.9 GiB.
- Not run: Fable second judge, any rep beyond 3, R3 (plan-check), the Q-arm for other roles. `results/REPORT.md` and `decision.json` were overwritten by the review-role aggregate; copies of this wave's are in `~/ab-eval/logs/wave3/agg/`.
