# 07 Runner status (A/B instruction eval)

Code: `~/get-shit-done/scripts/ab-eval/` (commits `a48be9b`, `a84800c`, `4ce5fec`, `8964fae` and the role-support commit that follows it). Usage: `scripts/ab-eval/README.md`.
Data: `~/ab-eval/` (not committed; 1.0 GiB of the 3 GiB cap on 2026-11-01).
Status (2026-11-01): 35 of 36 registered tasks are enabled and pass no-LLM calibration; every registered role has a
brief, a calibration mode and a grader. Live runs so far: E6 arm A (executor) and H1 arms A and B (runner). Judged
pairs and the other 33 tasks have not been run live, so decision gates G2-G6 are still not evaluated.

## Role support matrix (2026-11-01)

| role | enabled tasks | brief | calibration mode | grader (no LLM) | substance scored by |
|---|---|---|---|---|---|
| executor | 7 (E1-E7) | brief-executor | tests | visible/hidden tests, check/lint, fp delta, scope, fail-first, criticals | ab_judge |
| debugger | 3 (D1-D3) | brief-debugger | tests (D1), leak (D2), evidence (D3, read-only) | code grade (D1, D2), tree untouched (D3) | ab_match (D3 root cause), ab_judge |
| test-writer | 2 (TW1-TW2) | brief-test-writer | mutants | tests fail by assertion at base, pass on GREEN, kill >= `kill_bar` seeded mutants, no prod edits | ab_judge |
| docs-updater | 3 (DU1-DU3) | brief-docs-updater | evidence | contract parses, writes only under docs/ and CHANGELOG.md, negative control empty with reason (DU3) | ab_judge |
| review | 2 (R1-R2) | brief-reviewer (+ `.review/change.diff`) | evidence | report present, tree untouched | ab_match known recall |
| plancheck | 1 (R3) | brief-plancheck | evidence | report present, tree untouched | ab_match known recall |
| planner | 2 (P1, P2) | brief-planner | evidence | report present, scope file written, no out-of-scope | ab_match coverage items |
| verifier | 1 (V1) | brief-verifier | evidence | report present, scope file written | ab_match gap recall |
| runner | 1 (H1) | brief-runner | planted | exact counts, failing names, no edits | none (exact oracle) |
| coordinator | 3 (C1-C3) | brief-coordinator + stub children | coord | decision oracle from stub events, final tree and final JSON (ok, lie, die) | ab_judge |
| charlotte-qa | 2 (Q1-Q2) | brief-charlotte-qa (`mode`) | fixture | report present, tree untouched | ab_match seeded-defect recall |
| smoke (E2 agents) | 8 (S-PR, S-PJ, S-RS, S-RM, S-CM, S-IC, S-EG, S-PI) | brief-smoke | setup | report present, deliverable written in scope | ab_judge, rubric |
| (disabled) | S-DS | brief-smoke | - | - | needs the S-PI outputs of both arms; no task chaining |

How the pieces fit: the haiku dispatcher makes one Agent call to `subagent_type` from `ab_roles.subagent_type` (arm B
maps role to agent through `variants/B/roles.json`, for example `runner` to `gsd2-runner`). The agent and, for
coordinator tasks, its stub children come only from the `--agents` JSON (`ab_roles.build_agents`). `maxTurns`,
`effort` and `omitClaudeMd` in an agent def were accepted by `claude -p --agents` in the H1 runs.

## Calibration (no LLM), 2026-11-01

| task | role | mode | result | proven |
|---|---|---|---|---|
| E6 | executor | tests | PASS | visible/hidden red at base (both), green at ref x3 |
| E1 | executor | tests | PASS | visible/hidden red at base (both), green at ref x3 |
| E2 | executor | tests | PASS | visible/hidden red at base (both), green at ref x3 |
| E3 | executor | tests | PASS | visible/hidden red at base (both), green at ref x3 |
| E4 | executor | tests | PASS | visible/hidden red at base (visible), green at ref x3 |
| E5 | executor | tests | PASS | visible/hidden red at base (both), green at ref x3 |
| E7 | executor | tests | PASS | visible/hidden red at base (hidden), green at ref x3 |
| D1 | debugger | tests | PASS | visible/hidden red at base (both), green at ref x3 |
| D2 | debugger | leak | PASS | base leaks 21 orphan `sleep 3600` at base `ed73a6a8e`; ref `8de12e662` leaks 0 x3 |
| D3 | debugger | evidence | PASS | known defect/gap present at base and absent/fixed at ref (git show regexes), 1 evidence checks |
| DU1 | docs-updater | evidence | PASS | known defect/gap present at base and absent/fixed at ref (git show regexes), 3 evidence checks |
| DU2 | docs-updater | evidence | PASS | known defect/gap present at base and absent/fixed at ref (git show regexes), 3 evidence checks |
| DU3 | docs-updater | evidence | PASS | known defect/gap present at base and absent/fixed at ref (git show regexes), 2 evidence checks |
| P2 | planner | evidence | PASS | known defect/gap present at base and absent/fixed at ref (git show regexes), 6 evidence checks |
| R1 | review | evidence | PASS | known defect/gap present at base and absent/fixed at ref (git show regexes), 1 evidence checks |
| R2 | review | evidence | PASS | known defect/gap present at base and absent/fixed at ref (git show regexes), 2 evidence checks |
| R3 | plancheck | evidence | PASS | known defect/gap present at base and absent/fixed at ref (git show regexes), 6 evidence checks |
| P1 | planner | evidence | PASS | known defect/gap present at base and absent/fixed at ref (git show regexes), 6 evidence checks |
| V1 | verifier | evidence | PASS | known defect/gap present at base and absent/fixed at ref (git show regexes), 4 evidence checks |
| S-PR | smoke | setup | PASS | inputs present, outputs absent, ref outputs exist, agent def and brief render |
| S-PJ | smoke | setup | PASS | inputs present, outputs absent, ref outputs exist, agent def and brief render |
| S-RS | smoke | setup | PASS | inputs present, outputs absent, ref outputs exist, agent def and brief render |
| S-RM | smoke | setup | PASS | inputs present, outputs absent, ref outputs exist, agent def and brief render |
| S-CM | smoke | setup | PASS | inputs present, outputs absent, ref outputs exist, agent def and brief render |
| S-IC | smoke | setup | PASS | inputs present, outputs absent, ref outputs exist, agent def and brief render |
| S-EG | smoke | setup | PASS | inputs present, outputs absent, ref outputs exist, agent def and brief render |
| S-PI | smoke | setup | PASS | inputs present, outputs absent, ref outputs exist, agent def and brief render |
| S-DS | smoke | - | disabled | needs the S-PI outputs of both arms as input; the runner has no task chaining (one task, one snapshot) |
| TW1 | test-writer | mutants | PASS | ref tests fail at base by assertion, pass on GREEN x3, kill 3 of 3 seeded mutants by assertion |
| TW2 | test-writer | mutants | PASS | ref tests fail at base by assertion, pass on GREEN x3, kill 4 of 4 seeded mutants by assertion |
| H1 | runner | planted | PASS | planted tree fails with exactly 4 passed / 1 failed and the 2 expected names x3; unplanted base passes |
| C1 | coordinator | coord | PASS | real stub_child.py follows the scenario, SUMMARY/VERIFICATION/deps_ok as specified |
| C2 | coordinator | coord | PASS | real stub_child.py follows the scenario, SUMMARY/VERIFICATION/deps_ok as specified |
| C3 | coordinator | coord | PASS | real stub_child.py follows the scenario, SUMMARY/VERIFICATION/deps_ok as specified |
| Q1 | charlotte-qa | fixture | PASS | each seeded defect regex present in the seeded app and absent in the clean control; snapshot carries the fixture |
| Q2 | charlotte-qa | fixture | PASS | each seeded defect regex present in the seeded app and absent in the clean control; snapshot carries the fixture |

Calibration also checks the snapshot promises of every task (inputs present, outputs absent, kept planning files,
restored paths, overlay bytes, planted patch applied, review diff non-empty) on `pristine-A`.

Why E1, E4, E7 and D2 failed before and what changed:

| task | cause | fix |
|---|---|---|
| E1 | visible command `deno test ../../scripts/...` fails 4 of 24 at the ref (no `deno task` permission flags); the hidden copy passed | verify is now `deno task test ../../scripts/validation/grid-check.test.ts` |
| E4 | the ref commits are test-only: the hidden copies pass at base because production code already works; the stale visible tests are what fail | `calibration.base_red = visible` |
| E7 | the visible `resolve-gap.test.ts` at base is the plan's old test and passes; the failing part is the ref's 3 added cases | `calibration.base_red = hidden` |
| D2 | registered base `d6f93fb60` and ref `39e80115a` are about a different fix (poll-iteration fixtures); the test passes at both. The orphan `sleep 3600` leak the brief describes is fixed by `8de12e662` | base `ed73a6a8e`, ref `8de12e662`, leak mode: 21 orphans at base, 0 at ref x3 (pattern `sleep 3600`) |

## Artifacts authored

| artifact | where | validated by |
|---|---|---|
| per-task briefs (35) | `examples/briefs/<ID>.md` | `BriefTests`-style test renders every enabled brief for both arms |
| TW1 mutants (3): skip refusal, fail open, wrong scope | `examples/artifacts/TW1/mutants/` | calibration: ref tests kill 3 of 3 by assertion |
| TW2 mutants (4): codeless insert reverses, debit key dropped, insert error ignored, in-lock nonce re-check removed | `examples/artifacts/TW2/mutants/` | calibration: 4 of 4 by assertion. First versions of m3, m4 were killed by TypeScript errors, not assertions; calibration now counts a kill only when a test failed by assertion (`classify_red`), and both mutants were rewritten to type-check |
| H1 planted assertion (`TEST_COIN_SEED_KEYS.length` 16 to 17 in `arena-config-keys.test.ts`), exact oracle 4 passed / 1 failed | `examples/artifacts/H1/plant.patch`, `tasks.json` `expect` | calibration x3 stable, unplanted base passes. `delete-config.test.ts` was the first choice and was dropped: 2 of its tests already fail at `fd5396a8b` (E3's bug) |
| coordinator overlay (CHECKPOINT resume_from execute, 3 plans) and scenarios C1 ok, C2 lie, C3 die (398-03 takes 420 s) | `examples/artifacts/C-coord/`, `harness/stub_child.py` | calibration runs the real stub through each scenario |
| seeded QA app (3 pages) with 6 functional and 3 UX defects | `fixtures/qa-app-seeded/`, `examples/artifacts/Q/defects.json` | calibration: each defect regex present in seeded, absent in the clean `qa-app` |
| `mkmutant.py` | one-hunk patch from `<rev>:<path>` with an exact old/new string | used for TW1, TW2, H1 |

The mutants use the same one-line old/new idea as `scripts/gsd-mutate/` but are unified-diff patches applied with
`git apply` to a scratch GREEN tree inside the eval (gsd-mutate refuses non-worktree primaries and needs
`apps/` or `libs/` targets; TW1 and TW2 are applied only to `~/ab-eval` scratch trees, never to the live repo).

## Smoke: non-executor role path (H1, haiku, 1 rep per arm)

| run | agent | acceptance | role checks | cost $ | wall s | subagent first-turn tok | denials |
|---|---|---|---|---|---|---|---|
| `H1-A-r1-20261101-012210-15a922` | general-purpose | true | counts_exact, failing_names, no_edits all true | 0.0109 | 22.3 | 24,752 | 0 |
| `H1-B-r1-20261101-012246-6c8a00` | gsd2-runner (B draft) | true | same | 0.0078 | 19.7 | 4,309 | 0 |

Both subagents reported 4 passed / 1 failed and the planted failing step. The transcript meta confirms the B subagent
was `gsd2-runner`. The first-turn drop (24.8k to 4.3k) is the `omitClaudeMd` effect. One rep per arm proves the path,
not the G6 gate. The gsd2-runner draft lists `/Users/ollorin/igaming-platform/apps/api` as its test-command shape; the live repo root is
denied inside a snapshot (`HarnessDenyTests.test_roots_and_stack_still_denied`). In this run the agent used the
snapshot path (`.../runs/<RUN>/repo/apps/api`) with one Bash call and no denial.

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

## Remaining gaps

1. Only E6 (arm A) and H1 (arms A, B) have run live. The coordinator stubs (C1-C3) have only been exercised by the
   stub itself in calibration, not under a live Sonnet coordinator; the `Agent` name routing of stubs
   (`gsd-executor`, `gsd-verifier`, `general-purpose` as review) is unverified live.
2. Q1-Q2 need probe S9 (Charlotte MCP under the harness, `charlotte_dev_serve` serving `qa-fixture/qa-app`) and the
   exp 02 screenshot fix before a live run; `harness/charlotte-mcp.json` is written but never started.
3. Planner and verifier acceptance has no `gsd-tools verify plan-structure` / `verify references` call (the CLI is
   unavailable in a snapshot); P1 `plan_ok` and V1 `verify_ok` are process checks plus matcher recall.
4. S-DS is disabled: it needs both arms' S-PI outputs, and the runner has no task chaining.
5. Arm B: ten `gsd2-*` drafts are mapped by role; no `MOVES.tsv` review exists, so B is a draft, not a candidate.
6. Judged pairs have not been run live; G2-G6 are not evaluated. Second judge is off.
7. Host disk: the runner's 5 GiB hard floor stopped one calibration pass at 4.4 GiB free (host pressure, not
   `~/ab-eval`, which is 1.0 GiB). `~/ab-eval/logs/calib-retry.sh` waits for headroom.
8. Unchanged from the previous pass: G1 measures CLAUDE.md and rules only (memory is not gated), and the deny hook
   does not check absolute paths outside the snapshot beyond its `ROOTS` substrings.
