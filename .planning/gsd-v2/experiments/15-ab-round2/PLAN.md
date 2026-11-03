# Exp 15: A/B round 2, bench first

CEO, 2026-11-03: after the weekly reset (18:00 CET) run A/B tests; prove on a small sample that tests and grading are right, then run full samples large enough to decide. Development stays stopped until the CEO's command. Status: plan, awaiting approval.

## Why earlier rounds showed no gain

Not evidence that prompts are ideal. The bench could not see a gain:

1. All earlier variants were cuts, judged by non-inferiority plus token savings (`07/DESIGN.md` §6.2). They could only tie or lose on quality. P is the first additive arm.
2. Executor acceptance has no headroom. Control on `runs*.jsonl`: E1, E2, E3 0/13 (hidden tests fail on `api_mismatch`, so they test API guessing), E4, E6, E7 23/25. Reviewer recall 8/9. Floor or ceiling either way.
3. Metrics are binary pass/fail, on 2 review tasks and 3-6 reps.
4. Same-agent runs split heavily: Opus judge decisive on 7 of 10 A-vs-A pairs (`11/RESULTS-X0-X1.md`), TW2 control 5/6 then 0/3.

Evidence that prompts are not ideal: 34% of mutants survive and 64% of test cases look redundant (`12/FULL-RUN.md`), 76% of late review findings are churn (`13/RESULT.md`).

## Stage 0: no LLM, before the reset

| # | check | pass means |
|---|---|---|
| 0.1 | harness unit tests | all green |
| 0.2 | `ab_calib` on every kept task | reference passes, planted-bad fails, on the current grader |
| 0.3 | criticals audit on stored transcripts, all 27 rows | each rule's hits are read; false positives fixed, as `git stash list` was. `shared-stack-attempted` (14) first |
| 0.4 | snapshot identity script | arms differ only in the agent entry, by hash; refuses otherwise |
| 0.5 | driver | arms alternate per rep in random block order, records order and model per run, batches under 110 min, stop rules below |
| 0.6 | grader logs | every check keeps its output (`green.log` was added for one) |
| 0.7 | this file's gates are committed before any run | no gate moves after data |

Mutation run and development stay off while anything runs.

## Stage 1: task set, after the reset

A task is kept only if the control scores 30-80% on its metric, or the metric is continuous.

- Executor: fix E1-E3 by giving the API in the brief, or drop them. Add 3 tasks from real plans where the review loop later found HIGH defects (hidden tests = those fixes). Add 2 non-money tasks with room to over-build.
- Reviewer: add 8 tasks from real 401/402 findings with confirmed fixes, plus 2 clean final diffs for false positives.
- Test-writer: add 4 tasks from exp 12 modules with many survivors. Keep TW1-TW4.

New metrics:

| role | primary | guards |
|---|---|---|
| test-writer | mutants killed per 100 added lines; survivors | acceptance, honesty judge, no prod edits |
| reviewer | known-defect recall; share of findings Opus rules real; findings on clean diffs | required items by name |
| executor | share of hidden cases passed; findings from one fixed Sonnet reviewer per 100 lines | criticals, `fp` counters, added lines |

## Stage 2: small-sample validity. Go/no-go

| # | check | size | must show |
|---|---|---|---|
| V1 | known answers (no LLM) | every new task | reference passes, known-bad fails, on every new metric |
| V2 | A/A: same text under two labels | TW2 6+6, TW1, E6, E7, R1, R2 3+3, 2 new tasks per role 3+3 | no material gap; the spread sets N for stage 3 |
| V3 | sabotage arm: "skip reading callers, skip tests" | 4 tasks x 3 | bench catches it clearly |
| V4 | stronger model as positive control: Sonnet vs Haiku | TW2 and 1 executor task x 3 | Sonnet scores higher, else that task has no headroom and goes |
| V5 | judge and matcher | selftests, 4 A/A pairs, 4 planted pairs | planted pairs resolved, A/A even |
| V6 | end-to-end read | 3 runs per role read by hand | numbers match what the agent did |

No go: stop and report to the CEO, no stage 3. About $50, 3 h including stage 1 tasks (estimate).

## Stage 3: full runs, one role at a time

| order | role | arms | size | est. cost |
|---|---|---|---|---|
| 1 | test-writer | A, P | 8 tasks x 10 per arm | $32 |
| 2 | reviewer, Sonnet | A, Q2, P | 10 tasks x 6 per arm | $60 with judging |
| 3 | executor, Haiku | A, E, P | 8 tasks x 6 per arm | $75 |
| 4 | executor without `Agent` (already approved) | A, no-Agent | E6, E7, 2 new x 6 | $20 |

Later, not today: docs-updater B2, planner and other roles, Bladebro.

Sizes come from power at 80%, alpha 0.05: binary 50% vs 80% needs 39 per arm, 70% vs 90% 62, 90% vs 80% 199; continuous effect d=0.5 needs 63, d=0.8 25. So differences under about 15-20 points are not worth buying. V2 may change sizes before stage 3, not after.

## Decision rule

Task-clustered bootstrap, 95% interval, primary metric.

- Ship: interval favours the arm and excludes 0, guards no worse than -10 points, no critical only in the arm on a T0 task.
- Reject: interval favours control, or a guard fails.
- No difference: the arm ships only if cheaper and guards hold; otherwise the current text stays. This is a valid result.
- Stop an arm early on two real hidden-test failures on money paths beyond control, or harm the audit confirms.
- A ship still goes through backup, `docs/v2/CHANGES.md`, narrow installer, one role at a time, then real-phase metrics compared.

## Budget and safety

Total about $320 (estimate). 1% of the week measured at about $18 from one rounded step (97 to 98), so about 18% of the week, with a wide margin. Hard stop at 20% used by this experiment. Concurrency at most 2; no stack, so `db reset` and the lock are not involved. Rows in `results/runs-round2.jsonl`.

## Resume

Status table in `RESULTS.md`, one row per batch. The driver skips completed runs.
