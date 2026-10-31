# 07 Runner status (A/B instruction eval)

Code: `~/get-shit-done/scripts/ab-eval/` (commits `a48be9b`, `a84800c`). Usage: `scripts/ab-eval/README.md`.
Data: `~/ab-eval/` (not committed; 835 MB of the 3 GiB cap on 2026-10-31).
Status: pipeline runs end to end for one executor task on arm A. Arm B, judged pairs and most of the task
registry do not exist yet, so decision gates G2-G6 cannot be evaluated.

## Built in this pass

| gap | result |
|---|---|
| 1 deny hook | Traversal is judged by where a path resolves after the command's `cd` steps (`hooks/harness-deny.py` `escape_reason`). `cd apps/api && ... > ../../.tmp/x` is allowed. Anything resolving outside `runs/<RUN>/repo` is denied, including `cd ..` (previously allowed). Logic moved to pure `decide()`; 10 tests in `HarnessDenyTests`. The real hook process was checked on the original denied command (allowed) and on an outside traversal (denied). |
| 2 fail-first and recall | `ab_grade.fail_first`: re-runs each new test at the commit that lacks its implementation (scratch clone, `git reset --hard`). Statuses: proven, module-missing, green-at-red, unknown, claimed-only, absent. `ab_match.py`: Sonnet matcher over `oracle/known.json` into `results/matches.jsonl`. `ab_aggregate` G3 now evaluates hidden mean, proven count, known recall and required items. Its known-defect part is n/a and passes vacuously while no task has known items. |
| 3 judge self-test | `ab_judge.py selftest --model haiku`: OK, 6 dimensions parsed, overall tie. This proves the plumbing only. The expected preference (X matches the reference) was not asserted. Matcher `selftest --model sonnet`: OK. |
| 4 calibration | Registry (`examples/tasks.json`) holds one task, E6. It calibrates (table below). The other 11 DESIGN §2.1 rows are not registered. All 18 of their base and ref commits exist in the live repo. |
| 5 transcript sanity | Confirmed. `num_turns` counts only the dispatcher (one Agent call plus the final reply). The executor's tool calls are in `transcripts/<session>/subagents/agent-*.jsonl`: smoke 1 had 5 Read, 21 Bash, 3 Write, 4 Edit; smoke 2 had 8 Read, 24 Bash, 3 Write, 5 Edit. Acceptance came from `ab_grade` (visible and hidden tests re-run by the grader, `deno check`, `deno lint`, fp-gate delta, scope, criticals), not from the agent's report. |
| 6 smoke re-run | Done, see below. |
| extra | `fp_delta` failed open when `scripts/fp-gate.ts` or its config was missing from the snapshot (zero counters, so acceptance could pass unchecked). It now fails closed (`a84800c`, test `FpGateTests`). |

## Smoke E6 arm A (haiku), registry task E6

| run | status | acceptance | cost $ | wall s | dispatcher turns | api turns | 1st-turn tok (executor) | harness denials |
|---|---|---|---|---|---|---|---|---|
| `E6-A-r1-20261031-230319-6d0a9c` (before hook fix) | done | true | 0.170 | 114.4 | 2 | 26 | 33,871 | 1 (false positive, the `../../.tmp` redirect) |
| `E6-A-r1-20261031-232110-c5214e` (after hook fix, repo kept) | done | true | 0.181 | 140.3 | 2 | 29 | 33,865 | 0 |

Smoke 2 details: visible `deno task test` pass (1 test), hidden ref test pass, `deno check` and `deno lint` pass,
fp delta 0, no out-of-scope files, criticals none, 3 commits (RED `bf0538f`, GREEN, docs). `fail_first` =
`module-missing`: the RED commit holds only the test, so the test fails at type check (TS2307), not by assertion.
`deno fmt --check` fails on a pre-existing barrel file. It is reported only and is not in acceptance.

The smoke 2 denial log is empty. The original denied pattern was not re-issued by the agent in that run, so the
live proof is the process-level check above plus the unit tests, not a live re-run of that exact command.

## Calibration (DESIGN §4.6, no LLM)

| task | base commit | base visible | base hidden | ref visible (x3) | ref hidden (x3) | calib |
|---|---|---|---|---|---|---|
| E6 (`1f2010f81`, ref `8ec92a323`) | `1f2010f81` (snapshot `9fa53f8`) | FAIL (TS2307, module missing) | FAIL (api_mismatch) | PASS, PASS, PASS | PASS, PASS, PASS | ok=true |

Not calibrated (not registered): E1, E2, E3, E4, E5, E7, R1, R2, R3, P1, V1. Each needs a plan-derived scope, verify
command, hidden test list and, for R/P/V, `oracle/known.json`. Those were not written in this pass.

## Remaining gaps

1. Registry holds only E6. Gap 4 is closed for E6 only. Registering the other 11 DESIGN rows is the next step.
2. Arm B does not exist (no drafter, no `MOVES.tsv`). G2 to G6 need both arms, so they stay NOT_EVALUATED in practice.
3. Judged pairs have not been run live (`pack`/`judge`/`collapse`). G5 has no input yet.
4. No R, P or V task is registered, so the matcher has only been exercised on a fake report. The known-defect
   recall path and the required-item check are unit-tested only.
5. `fail_first` has only seen `module-missing` live. The `proven` path is unit-tested (`classify_red`). The
   candidate-commit scratch checkout is exercised by smoke 2.
6. G1 measures CLAUDE.md and rules only. Memory is not gated: smoke 2 loaded 13,902 chars of scrubbed memory.
   `variants/A/MANIFEST.md` says "+ MEMORY.md" but `expected.json` excludes it.
7. The deny hook still does not check absolute paths outside the snapshot (only the `ROOTS` substrings). This is
   unchanged from before.
8. Second judge is off (Fable needs a CEO ruling; DESIGN §8).
9. Smoke 2 kept `runs/E6-A-r1-20261031-232110-c5214e/repo` for inspection. Delete it when no longer needed.
