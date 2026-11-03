# Exp 15: A/B round 2, bench first

CEO, 2026-11-03: after the weekly reset (18:00 CET) run A/B tests; prove on a small sample that tests and grading are right, then run full samples large enough to decide. Development stays stopped until the CEO's command. Status: approved by the CEO on 2026-11-03: start 18:01 CET, budget 5% of the week, trial first and then batches without a word per batch. This budget replaces the larger sizes and costs below where they conflict.

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

- Executor: postponed with its stage 3 runs.
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
| V2 | A/A: same text under two labels | TW2 4+4, TW1, R1, R2 3+3, 2 new tasks per role 3+3 | no material gap; the spread sets N for stage 3 |
| V3 | sabotage arm: "skip reading callers, skip tests" | TW1, R2, 2 new x 2 | bench catches it clearly |
| V4 | stronger model as positive control: Sonnet vs Haiku | reviewer tasks only, from the Haiku and Sonnet rows plus new tasks x 2; other roles skipped, too costly in this budget | Sonnet scores higher, else that task has no headroom and goes |
| V5 | judge and matcher | selftests, 4 A/A pairs, 4 planted pairs | planted pairs resolved, A/A even |
| V6 | end-to-end read | 3 runs per role read by hand | numbers match what the agent did |

### Stage 2 gates, numeric, frozen before any run

Rows: `results/runs-round2-stage2.jsonl`, never pooled into stage 3. Haiku rows of V4 use reps from 101.

- V1: every new task's `calib.json` ok: reference passes, each mutant killed by the reference tests, known-bad fails. A task that fails goes.
- V2 A vs A2, pooled over tasks: the bootstrap interval covers 0 on the primary metric (test-writer kills per 100 added lines, reviewer recall) and on acceptance; |gap| under 0.15 recall, under 25% of control kills per 100, under 20 points acceptance. A single task at 4+4 may swing more: a swing on one task only is a noise reading that sets N, a same-direction gap on most tasks is a no go. The spread of per-task gaps sets N: stage 3 keeps its planned N if a 10-point recall gap or 25% kills gap is resolvable at that spread, else tasks are added before reps.
- V3 S vs A: S scores worse on the primary metric on at least 3 of the 4 tasks and pooled by more than the V2 gap. Fewer is a no go: the bench cannot see a bad prompt.
- V4 Sonnet vs Haiku, reviewer: Sonnet pooled recall above Haiku. A task where neither model separates and recall sits at 0 or 1 for both goes as having no headroom. Fewer than 6 real-finding tasks left is a no go.
- V5: `ab_match.py selftest` and `ab_judge.py selftest` pass; 4 A/A pairs show no 4-0 for either label; 4 pairs of S vs A go to A at least 3 of 4.
- V6: 3 runs per role read by hand: the reported kills, recall, findings and added lines match the transcript and the diff. One mismatch is a no go until the metric is fixed and rerun.

No go: stop and report to the CEO, no stage 3. About $20, 3 h including stage 1 tasks (estimate). Go: tell the CEO in one message and start stage 3.

## Stage 3: several variants, screen then decide

CEO, 2026-11-03: test both shorter and better instructions, keep the best by price and quality. Each role has the current text as control plus three kinds of variant. New drafts are written after the reset and frozen before any run.

| role | control | quality added | shorter | shorter and better |
|---|---|---|---|---|
| test-writer, Haiku | A | P: A + one good test per behaviour. K: A + each new test names the break it catches and proves it with a mutant | E: rejected earlier, not re-run | E2: E + find old tests the new behaviour contradicts (its TW2 failure) |
| reviewer, Sonnet | A | V: Q2 + read every caller, without "no case, no finding" | Q2 | P: Q2 + all check-before-report rules |

Screen: all four arms, 2 reps per task, arms alternating. This only removes clearly weak arms; it cannot rank close ones. Final: control and the best new arm, extra reps, screen runs count.

| role | screen | final | est. cost |
|---|---|---|---|
| test-writer | A, P, K, E2: 8 tasks x 2 | 2 arms: 8 tasks x 5 more, 56 runs per arm | $29 |
| reviewer | A, V, Q2, P: 10 tasks x 2 | 2 arms: 10 tasks x 4 more, 60 runs per arm, judges on a sample | $30 |

Pick by price and quality: drop any arm that fails a guard or is worse on the primary metric. Among the rest, a clearly better arm wins even if it costs more, up to 1.5x; with no clear quality gap, the cheapest wins. Above 1.5x goes to the CEO. Sizes see differences of about 20 points or d=0.5 and up.

Executor (A, E, P, no-`Agent`) waits for next week's budget. A clear stage 2 failure in one role moves its budget to the other.

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

Hard stop at 5% weekly use, read after every run (`--quota-ceiling 0.05` refuses from 0.06, so set 0.045 to stop at 5%; the reading is rounded to 1%). Plan: stage 1 about $10, stage 2 about $10, stage 3 $59, reserve $11, total $90 at $18 per 1%. That rate comes from one rounded step; re-measure it at the first 1% and scale stage 3 down, tasks first kept, if it is lower. This chat's own turns count too. When the stop hits, whatever finished is reported, with what it can and cannot decide.

Concurrency at most 2; no stack, so `db reset` and the lock are not involved. Rows in `results/runs-round2.jsonl`.

## Resume

Status table in `RESULTS.md`, one row per batch. The driver skips completed runs.
