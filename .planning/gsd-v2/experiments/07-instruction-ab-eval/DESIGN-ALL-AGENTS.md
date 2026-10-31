# 07b — A/B eval coverage for all GSD agents (extension of DESIGN.md)

Extends `DESIGN.md` (07) so every kept agent gets evidence in proportion to its use and $. DESIGN.md stays authoritative for everything not restated here: snapshot build (§4.2), invocation (§4.3), harness deny hook (§4.4), scheduling (§4.5), calibration (§4.6), metrics (§5), judge blinding (§5.2), gates G1-G6 (§6.2), runner layout (§7). Per-agent B contents, targets and dispositions come from `research/07-AGENT-AUDIT.md` (07A). Design only; nothing run. Usage figures: `metrics_v2.py` run 2026-10-31 21:16 UTC (4,032 spawns, est $6,900, ±30% index).

## 0. Answer

| Item | Choice |
|---|---|
| Tiering | E1 full A/B (3 reps, pairwise blind judge or deterministic oracle): executor, coordinator, planner, plan-checker, verifier, general-purpose reviewer + runner, test-writer, debugger, docs-updater, charlotte-qa. E2 one smoke pair each (rubric judge, no stats): phase-researcher, project-researcher, research-synthesizer, roadmapper, codebase-mapper, integration-checker, e2e-test-generator (absorbs ui-inventory), product-investigator, discovery-synthesizer. E3 archive, no eval: task-router, meta-answerer, nyquist-auditor, integration-tester, qa-analyst, plan-attacker, plan-defender, plan-judge (ui-inventory merged) |
| New E1 tasks | 15 on top of 07's 12: coordinator C1-C3 (synthetic phase, stub children), runner H1, test-writer TW1-TW2, debugger D1-D3, docs-updater DU1-DU3, charlotte-qa Q1-Q2, planner revision P2 (§2) |
| Variants | A = HEAD effective instructions; B = 07A slim target (delete/compress/move only, 07 §3.1 rule 2). Optional Q = B + 07A "quality" fixes (additions), run only where 07A flags a quality defect (§3) |
| Budget | 07 core $320-360 / 13-15 h + E1 additions ≈ $215 / 10.5 h + E2 ≈ $70 / 2.5 h + probes ≈ $5 → **≈ $610-650 est-$, ≈ 26-28 h wall at 2 parallel**. Optional Q arms ≈ $180 / 7 h (§6) |
| Order | probes → H1 → DU → C1-C3 → 07 smoke + executor → reviews/check/plan/verify (+P2) → TW, D → E2 → Q (after Charlotte screenshot fix) (§5) |
| Accept | 07 G1-G6 per agent, adapted for orchestrator (deterministic decision oracle replaces G5), oracle-only leaf roles, and n=1 rare agents (§4) |

## 1. Coverage map (all 27 defs + built-in general-purpose)

| Agent | Spawns / est $ (34 d) | Tier | Tasks | Why this tier |
|---|---|---|---|---|
| gsd-executor | 1,144 / $2,390 | E1 | 07 E1-E7 | 35% of $ |
| gsd-phase-coordinator | 91 / $1,145 | E1 | C1-C3 (new) | 17% of $; excluded by 07 §2.4 |
| general-purpose (reviewer, 580 "review" spawns) | 2,178 total / $1,787 | E1 | 07 R1, R2 | review = 17.6% of $ (01 §3a) |
| general-purpose (Haiku runner, 1,040) | incl. above | E1 | H1 (new) | most-spawned shape; D4 target 33.6k → ≤8k first turn |
| gsd-planner | 119 / $420 | E1 | 07 P1 + P2 (new, revision mode) | Opus $3.92/spawn |
| gsd-verifier | 88 / $223 | E1 | 07 V1 | phase-end Opus gate |
| gsd-plan-checker | 102 / $212 | E1 | 07 R3 | largest def (33.9 KB) |
| gsd-debugger | 52 / $83 | E1 | D1-D3 (new) | 0 tasks in 07 |
| gsd-test-writer | 31 / $37 | E1 | TW1-TW2 (new) | T0 test quality |
| gsd-docs-updater | 81 / $16 | E1 | DU1-DU3 (new) | cheap, mandatory per plan, omitClaudeMd candidate |
| gsd-charlotte-qa | 28 / $18 | E1 (kept) | Q1-Q2 (new) | UI QA stays LLM-driven (DECISIONS row 4) |
| gsd-phase-researcher | 14 / $64 | E2 | S-PR | rare, Opus/Sonnet |
| gsd-project-researcher | 0 | E2 | S-PJ | kept by 05 D8 (rare by design) |
| gsd-research-synthesizer | 0 | E2 | S-RS | kept by 05 D8 |
| gsd-roadmapper | 2 / $0.4 | E2 | S-RM | once per milestone |
| gsd-codebase-mapper | 1 / $3 | E2 | S-CM | onboarding only |
| gsd-integration-checker | 2 / $2 | E2 | S-IC | milestone audit |
| gsd-e2e-test-generator (+ ui-inventory merged) | 1 / $0.4 | E2 | S-EG | spawned by execute-phase:600, plan-phase:283-284 |
| gsd-product-investigator | 0 | E2 | S-PI | `/gsd:prd` (prd.md:138,286) |
| gsd-discovery-synthesizer | 0 | E2 | S-DS | `/gsd:prd` (prd.md:148,296) |
| plan-attacker / defender / judge | 18 / 17 / 20, $24 | E3 | — | 05 D8: replaced by an attack dimension in the Opus checker |
| task-router, meta-answerer, nyquist-auditor, integration-tester, qa-analyst | 0 each | E3 | — | never ran (01-F12); knowledge DB dead (05-M4) |
| gsd-ui-inventory | 0 | E3 (merge) | covered by S-EG | 2.6 KB; its one job becomes step 0 of e2e-test-generator |

Only agents whose B differs from A need runs. All kept agents differ at least in the shared inherited block (07 §3.2 CLAUDE.md/MEMORY cuts), so every kept agent gets at least one smoke pair.

## 2. New tasks

All shas on `feature/codebase-review-hardening` (ancestry checked with `git merge-base --is-ancestor`). Base = parent of the historical outcome. Scope rules from 07 §2.2 apply (no stack, no integration, no Charlotte gate, no mutation-under-lock).

### 2.1 E1 tasks

| ID | Role / model | Tier | Base | Ref outcome | Scope given to the agent | Acceptance oracle | Instruction sensitivity |
|---|---|---|---|---|---|---|---|
| C1 | gsd-phase-coordinator / sonnet | T1 | `ed0a7bec5` (398-01 SUMMARY present; 398-02 wave 2 → 398-03 wave 3, `depends_on` chain) | none (synthetic) | "Execute phase 398 from step execute (CHECKPOINT resume_from: execute); plans 398-02, 398-03 only" — scrub deletes 398-04..07 | decision oracle §2.3, scenario `ok,ok` | supervision, spot-check, verifier spawn, return JSON (07A coordinator rows) |
| C2 | same | T1 | same | none | same | scenario: 398-02 attempt 1 returns `## PLAN COMPLETE` but SUMMARY says `## Self-Check: FAILED` and no tagged commit (lying child) | "a child's self-report is a claim" (`gsd-phase-coordinator.md:33`), spot-check digest (`:83-88`) |
| C3 | same | T1 | same | none | same | scenario: 398-02 attempt 1 dies (API-error text, no artifacts); 398-03 runs 420 s (> 5-min cache TTL) | re-dispatch rule, polling vs foreground wait (01-F2), cacheTtl 1h |
| H1 | general-purpose / haiku vs gsd2-runner / haiku | T2 | `fd5396a8b` (07 E3 base) + one planted failing assertion in `configurations` handler tests | none | "Run `cd apps/api && deno task test <file>`; report pass/fail counts and the failing test names; do not edit" | exact counts + failing names; honesty; no edits | inherited 16k block + 8.4k skill listing irrelevant to the job (01 §2a) |
| TW1 | gsd-test-writer / haiku | T0 (auth) | `d9c763d07` | RED `dc276d613` (`operator-login-m1.test.ts` OLU1-OLU2, unit part only); GREEN `2e4942b38` | 399-23 Task 1 unit behaviours, files `operator-login-m1.test.ts`; integration file out of scope | (a) new tests fail at base by assertion, (b) pass with GREEN prod diff applied, (c) kill ≥ ref's count of 3 seeded mutants of GREEN (§2.4), (d) no prod edits, (e) T1/T0 budget | test economy vs "BREAK things" role (07A test-writer), fixture rules, RED-first |
| TW2 | same | T0 (money) | `71af0a621` | RED `5e729b744` (unit part: `mines-handlers.test.ts`, `slots-handlers.test.ts`); GREEN `73ee91bb4` + `97ce31615` restricted to `apps/api/functions/**` non-test files | 400-30 RED unit behaviours | as TW1; calibration must show ref unit tests pass with the restricted GREEN (else task replaced) | money-path tests, mutation naming |
| D1 | gsd-debugger / sonnet, `goal: find_and_fix`, `interactive: false` | T2 (tooling) | `3cf806c04` | `5698409cb` (coverage-gate surfaces the real `deno coverage` error) | symptom text from transcript `agent-adf5172e9f67bc424.jsonl` first prompt, paths rewritten | hidden `coverage-gate.test.ts@5698409cb` passes; root cause named (matcher); no unrelated edits | debugger methodology lives in never-read `debugger-detail.md` (07A) |
| D2 | same | T2 (test infra) | `d6f93fb60` | `39e80115a` (reaper fixtures wait on real seconds) | symptom from `agent-ab9d57516901959fe.jsonl` | hidden `reap-stale-test-processes.test.ts@39e80115a` behaviour cases pass 3/3 (flake check); root cause matched | no-sleep / wait rules, fix-in-test-not-prod |
| D3 | same, `goal: find_root_cause_only`, read-only | T0-adjacent (2FA) | `0076ad324` | root cause in `b8761c1fe` (policy row rewritten mid-flow → `PENDING_2FA_MODE`); transcript `agent-a428fa306f771a23f.jsonl` | symptom text only; "do not run integration tests; static trace" | matcher: names `loginOperatorThrough2FA` / policy-row rewrite mechanism; zero edits | diagnose-only mode, honesty about unrun steps |
| DU1 | gsd-docs-updater / haiku | T2 | `f107b6d43` | `125eb6c90` (`docs/authentication.md` +30) | SUMMARY `399-16-SUMMARY.md` path, as in `agent-a9a15e7c31745acfd.jsonl` | contract parses (`written_files/commit/errors`); writes only `docs/**`; Sonnet grounded-claim check: every claim traceable to code at base; ref topic covered | report contract, padding guard, Glob tool absent |
| DU2 | same | T2 | `670435d11` | `e4f53986e` (currency-attributes, pvp-arena docs; the ref also edited `.claude/rules/database.md`) | `400-12-SUMMARY.md` | as DU1; any write under `.claude/**` = critical (07A docs-updater: rules are not docs) | scope of writable paths |
| DU3 | same | T2 (negative control) | `ab5333de8` | ref wrote nothing ("No doc writes were needed for 400-41", `agent-a7d9aa366778a1f45.jsonl`) | `400-41-SUMMARY.md` | writes nothing, says so; contract `written_files: []` with a reason (not a silent no-op) | executor digest calls `[]`+`[]` a failure (`gsd-executor.md:278`) while docs-updater allows it (`gsd-docs-updater.md` report section) |
| Q1 | gsd-charlotte-qa / haiku, `mode: ui-qa` | T2 | static fixture app `harness/fixtures/qa-app/` (3 pages) with 6 seeded defects: dead button, console error, 500 on submit, missing field label, unhandled empty state, overflow at 375 px | none | test flows listed in brief; app served by `charlotte_dev_serve` (probe S9) | seeded-defect recall, false positives, JSON `output_format` valid, Observation Contract (no causal clauses) | screenshot discipline vs 180 s timeouts (01-F4); suite_preconditions irrelevant here |
| Q2 | same, `mode: ux-audit` | T2 | same fixture | none | same | as Q1 for the 3 UX defects; severity calibration | ux_audit_protocol size (3.7 KB) |
| P2 | gsd-planner / opus, revision mode | T1 | `7dabd66f1` (390-01 R1 plan + `390-01-PLAN-CHECK-R1.md`) | revised plan R2 present at `2ae3b723d` (07 E4 base) | "Revise 390-01 per the checker report" | matcher: HIGH-1 and PC1-PC5 each addressed in the revised plan; `verify plan-structure` exit 0; no non-markdown file created (MANDATE-7) | revision-mode text lives in never-read `planner-detail.md` |

### 2.2 E2 smoke tasks (1 run per arm)

| ID | Agent / model | Base | Ref | Brief | Rubric items (pass/fail, plus one blind pairwise judgment) |
|---|---|---|---|---|---|
| S-PR | gsd-phase-researcher / sonnet | `4739bf24b` | `816216617` (`399-RESEARCH.md`) | spawn prompt from `agent-ac78119adf41c8e85.jsonl` | RESEARCH.md written at the expected path; covers A3a-C9-1 and MILE-07/08; claims cite file:line that exist at base; no edits outside the phase dir; max_ctx reported (researcher median 265k, 6/14 compacted) |
| S-PJ | gsd-project-researcher / sonnet | HEAD-frozen sha of the eval | none | one dimension (PITFALLS) for a pending PRD under `.planning/prds/pending/` | file written to `.planning/research/`; opinionated recommendations with sources; confidence levels; no repo edits |
| S-RS | gsd-research-synthesizer / sonnet | `ea1fdf9e3` with `.planning/research/SUMMARY.md` deleted | `ea1fdf9e3:.planning/research/SUMMARY.md` | the new-project synthesizer prompt | SUMMARY.md written; every section traces to one of STACK/FEATURES/ARCHITECTURE/PITFALLS; roadmap implications present |
| S-RM | gsd-roadmapper / sonnet | `a227e1134` | `b580c954e` (v0.1.34 roadmap) | prompt from `agent-a5d6418f64f28c833.jsonl` | every requirement mapped to one phase; 2-5 observable success criteria per phase; no unmapped requirement vs ref REQUIREMENTS |
| S-CM | gsd-codebase-mapper / sonnet | HEAD-frozen sha | none | `focus: quality` on `apps/api/libs/domain` | CONVENTIONS.md + TESTING.md written; every convention cites a real file; no forbidden files read (`forbidden_files` section) |
| S-IC | gsd-integration-checker / sonnet | `4e0a498dd` (last commit before the 2026-10-09 00:25 UTC check) | verdict in `agent-aa49ae0b46db6ef69.jsonl`: 5 of 8 PASS, 3 FAIL | same prompt, static only | recall of the 3 FAIL items (Sonnet matcher); no stack commands |
| S-EG | gsd-e2e-test-generator / sonnet (+ merged inventory step for B) | `21e935fc0` | `6629fae1f` (`399/E2E-TEST-PLAN.md`) | prompt from `agent-aa1a73bb0b26b1232.jsonl` | plan covers the ref's UI flows; fixture-isolation mandate R1-R7 respected; scenario format valid |
| S-PI | gsd-product-investigator / sonnet | HEAD-frozen sha | none | one dimension of a pending PRD | structured report per `output_format`; claims sourced |
| S-DS | gsd-discovery-synthesizer / opus | HEAD-frozen sha + S-PI outputs from both arms (each arm synthesizes its own investigator output) | none | prd.md:148 template | PRD sections complete; gaps listed; no invented facts |

### 2.3 Orchestrator A/B without a live phase (C1-C3)

Running a real phase costs ~$12-130 per coordinator spawn and hours of stack time (01 §1, §3c). The eval needs only the coordinator's decisions, so its children are stubs.

| Element | Design |
|---|---|
| Stub defs | `harness/stubs/*.json` passed via `--agents` with the same names the coordinator spawns: `gsd-executor`, `gsd-verifier`, `gsd-plan-checker`, `gsd-docs-updater`, `gsd-test-writer`, plus `review-stub`. Body: "Run `python3 /Users/ollorin/ab-eval/harness/stub_child.py --role <role> --run <RUN> --prompt-file -` with your full prompt on stdin, Bash timeout 600000; print its stdout verbatim as your final message; do nothing else." Model haiku, tools Bash only |
| `stub_child.py` | reads `runs/<RUN>/scenario.yaml` (per plan: list of attempts `ok|lie|die`, `duration_s`); on `ok`: waits `duration_s` inside Python, writes `398-NN-SUMMARY.md` with `## Self-Check: PASSED` and a `## Defect Classes` row, commits `feat(398-NN): stub`, prints the canned executor return with the JSON trailer (`gsd-executor.md:434-442`); `lie`: prints `## PLAN COMPLETE` but writes `Self-Check: FAILED` and no commit; `die`: prints an API-error line, writes nothing. Verifier stub writes `398-VERIFICATION.md` `status: passed`. Review stub returns "0 findings" JSON |
| Reviews | CLAUDE.md tiering makes the coordinator spawn general-purpose reviewers. Overriding the built-in `general-purpose` name via `--agents` is probe S10; fallback: the brief says "reviews in this harness use `review-stub`", identical in both arms |
| Scenarios | C1 `ok,ok` (120 s each); C2 `398-02: [lie, ok]`, `398-03: [ok]`; C3 `398-02: [die, ok]`, `398-03: [ok 420 s]` |
| Decision oracle (`ab_grade.py --coord`) | C1: 2 executor spawns in wave order (398-03 never before 398-02's SUMMARY), ≥1 review spawn per plan, 1 verifier spawn, final JSON `status: completed`, `CHECKPOINT.json last_step: verify`. C2: 398-02 not treated as done — either a re-dispatch followed by success, or a returned `status: failed, step: execute` naming the Self-Check (both accepted; the def's digest says HARD FAIL `:84-86`, CLAUDE.md says re-dispatch; 07A flags the contradiction). Rejected: `completed` without a passing 398-02 SUMMARY, coordinator writing a SUMMARY or code itself, 398-03 dispatched before 398-02 is good. C3: exactly one re-dispatch of 398-02, then `completed` |
| Criticals | coordinator Edit/Write outside `.planning/**`/`.tmp/**`; `completed` without VERIFICATION `passed`; a child still running when the coordinator returns (transcript: Agent result missing at the final turn); spawn without `model` (tier rule) |
| Cost metrics | coordinator API turns during child runs, `sleep/until/ping` Bash calls (D2 classes), cache-write tokens and `ephemeral_1h` vs `5m` split (06 P4 fields), wall, est $ |
| Q arm | gsd2 coordinator (D1: foreground parallel spawns with explicit `run_in_background: false`, `verify plan-done`) — this is exp 10's variant. C1-C3 become exp 10's correctness gate before its live T1 phase (05 wave 1) |

### 2.4 Test-writer grading (TW1, TW2)

1. At base: run the agent's new/changed test files → each new test must fail by assertion (not module-missing) → `fail_first=proven`.
2. Apply the GREEN prod diff (non-test files only) to a scratch clone → tests pass 3/3.
3. Seeded mutants (written once at setup by a Sonnet drafter, reviewed by the main session, frozen in `oracle/mutants/*.patch`; 3 per task, each a one-line change on a behaviour the plan names, e.g. reserve-before-verify order in `operator-login.ts`, debit-key check in the slots spin handler). Kill count A vs B; the ref test's kill count is the calibration bar.
4. Scope: no edits to non-test files (test-writer step 6 "fix the implementation" `gsd-test-writer.md` `<process>` is out of scope in this task and counts as `scope_out`).

## 3. Variants per agent

| Agent group | A | B (from 07A; delete/compress/move only) | Q (optional, additions) |
|---|---|---|---|
| executor, planner, plan-checker, verifier | 07 §3.2 | 07 §3.2, amended by 07A: the verifier and planner Hard Rules Digests are **compressed, not deleted** — they are the only procedure text those agents see (`verifier-detail.md` read by 2/88, `planner-detail.md` 1/119; `@` refs are not expanded, 06 P9) | executor: 07 C; verifier: Layer-1 gates 8g-8j replaced by one `gsd-tools` call (script); planner: `<model>`/escalate rule inlined (05-M2b) |
| coordinator | HEAD def | compress digest 8.0 → ~2 KB, drop dead telegram notification and duplicated review_tiering | gsd2 coordinator (D1) |
| reviewer (general-purpose) | built-in + historical brief | inherited block per 07 §3.2 | gsd2-reviewer def (D4, ≤3k tok) |
| runner (H1) | general-purpose haiku | — (no B: the change is a new def) | gsd2-runner: omitClaudeMd, tools Bash+Read, ≤1.5k tok |
| test-writer, debugger, docs-updater, charlotte-qa | HEAD def | 07A target | test-writer: drop impl-fix step, resolve role contradiction; docs-updater: omitClaudeMd + script classification; debugger: inline 1 KB methodology core |
| E2 agents | HEAD def | 07A target + shared inherited cuts | none |

Construction (07 §3.1 rules 1-4) and the Opus MOVES.tsv review apply per agent; T0-relevant rows (test-writer, debugger D3, verifier, planner) go to the Opus reviewer. H1 and every Q arm are additions and are never mixed into B.

## 4. Acceptance per agent

| Agent class | Gates | Adaptation of 07 §6.2 |
|---|---|---|
| Leaf E1 with oracle + judge (executor, planner, plan-checker, verifier, reviewer, debugger, test-writer, docs-updater) | G1-G6 | G2/G3 per role oracle (§2.1); pairs = 3 per task; G5 bootstrap clusters by task over that role's tasks only; roles with ≤ 3 tasks (debugger 3, docs 3, test-writer 2, planner 2) cannot pass G5 on statistics alone, so G5 there = "no task where A wins both orders with weight major in ≥ 2 of 3 reps" |
| Orchestrator (coordinator C1-C3) | G1, G2′, G4, G6′ | G2′: every scenario's decision oracle B passes ≥ A's count (3 reps), no scenario flips from 3/3 to ≤ 1/3. No G5 (deterministic oracle replaces the judge). G6′: coordinator first-turn tok B ≤ 0.75 A; for Q: poll calls ≤ 10 per run and parent cache-write ≤ 0.3 A |
| Runner H1 | G2, G4, G6′ | exact-answer oracle; 3/3 required in both arms; G6′ first-turn tok ≤ 8k (D4 target) |
| Charlotte QA (Q1-Q2) | G1, G3′, G4 | G3′: seeded-defect recall B ≥ A − 1 (of 6) summed over reps, false positives B ≤ A + 1, JSON valid 3/3; run only after exp 02 screenshot fix ships (else wall is dominated by 180 s timeouts) |
| E2 (n = 1) | G1, rubric, G4, judge veto | B passes iff every rubric item A passed also passes in B, no B-only critical, and the judge does not prefer A with weight `major` in both orders. A fail → attribute to a MOVES row, restore it (B′), one re-run; second fail → keep A for that agent. No statistical claim is made |
| E3 | none | archive is `git mv agents/<x>.md agents/_archive/` + removing spawn sites (07A lists them); rollback `git mv` back |

Post-rollout monitoring (07 §6.5) extends to: coordinator resumes/phase, debugger `inconclusive` share, docs-updater empty-contract rate, test-writer `FAILURE: 0 tests` rate, charlotte-qa JSON parse failures.

## 5. Order (cheapest high-value first)

| Step | Content | est $ | Wall at 2 parallel | Gate to continue |
|---|---|---|---|---|
| 0 | 07 probes S1-S8 + S9-S13 (§7) | 10 | 1.5 h | all pass or redesign |
| 1 | H1 runner (A vs gsd2-runner) | 2 | 0.2 h | 1,040 spawns/34 d at stake for $2 |
| 2 | DU1-DU3 | 20 | 0.5 h | — |
| 3 | C1-C3 (A vs B; Q if exp 10 is ready) | 50 | 2.5 h | harm stop as 07 §6.4 |
| 4 | 07 S1 smoke, then executor E1-E7 | 07 | 07 | 07 §6.4 |
| 5 | 07 R1-R3, P1, V1 + P2 | 07 + 41 | 07 + 0.8 h | — |
| 6 | TW1-TW2, D1-D3 | 90 | 3.5 h | — |
| 7 | E2 smokes (9 pairs) | 70 | 2.5 h | per-agent rule §4 |
| 8 | Q1-Q2 after exp 02 rollout | 13 | 1.2 h | — |

## 6. Budget (07 §6.6 unit costs; ±30%)

| Item | Runs | Unit | est $ | Serial min |
|---|---|---|---|---|
| 07 core (12 tasks) | 72 + 72 judge | 07 §6.6 | 320-360 | ~1,400 |
| C1-C3 | 18 coordinator (Sonnet, ~$2.5 incl. Haiku stubs) | deterministic oracle; Sonnet report check $0.3 | 50 | 300 |
| H1 | 6 (A $0.18, B ≤ $0.07) | oracle only | 2 | 20 |
| TW1-TW2 | 12 (Haiku $0.5) + 12 Opus judge ($2) | | 30 | 160 |
| D1-D3 | 18 (Sonnet $1.3) + 18 judge ($2) | | 60 | 300 |
| DU1-DU3 | 18 (Haiku $0.1) + 18 judge ($1, small packets) + matcher | | 20 | 90 |
| Q1-Q2 | 12 (Haiku/Sonnet ~$0.7) + matcher | | 13 | 150 |
| P2 | 6 (Opus $3.9) + 6 judge ($2.5) + matcher | | 41 | 90 |
| E2 smokes | 18 runs + 18 judge calls | $1-3 per run | 70 | 300 |
| probes S9-S13 | — | | 5 | 60 |
| **Total** | | | **≈ 610-650** | **≈ 2,870 → ≈ 26-28 h at 2 parallel** |
| optional Q arms (executor C, coordinator gsd2, verifier script, test-writer) | | | ≈ 180 | ≈ 7 h |

Quota: wk3 burn was est $1,277 in 4.3 days (05-M6), so the full set is ≈ 2 days of normal burn. Run in three windows: steps 0-3 (≈ $80) any time utilization < 0.60; steps 4-5 after the Tue 2026-11-03 17:00 UTC reset (06 P2); steps 6-8 the following window. 07 §4.5 pause rules apply throughout.

## 7. Additional probes (each blocks the tasks that need it)

| # | Assumption | Probe | Pass condition | Blocks |
|---|---|---|---|---|
| S9 | Charlotte MCP works under the harness: `--mcp-config` with only `charlotte`, `charlotte_dev_serve` serves `harness/fixtures/qa-app/`, tools callable from a subagent | haiku subagent navigates the fixture and reads one console error | console entry returned; no other MCP server loaded | Q1-Q2 |
| S10 | `--agents` JSON names override what a subagent (depth 2) spawns, including built-in `general-purpose` | coordinator-like parent spawns `gsd-executor` and `general-purpose` with sentinel prompts | both children's `prompt_snapshot.systemPrompt` carry the stub sentinel | C1-C3 (fallback in §2.3) |
| S11 | a stub child's in-Python 420 s wait is not blocked by the product's sleep guard (06 P6: `sleep N≥25` blocked) or the harness hook, and Bash `timeout: 600000` holds in a subagent | stub child with `duration_s: 420` | returns after ~420 s, no deny | C3 |
| S12 | mutant patches apply and the test file runs offline in the snapshot | apply each `oracle/mutants/*.patch` to a scratch clone of the GREEN tree, run the ref test | ref test fails on every mutant (else the mutant is replaced) | TW1-TW2 |
| S13 | `omitClaudeMd: true` set in `--agents` JSON is honoured (06 P1 tested it on a file-defined agent) | sentinel CLAUDE.md in snapshot; runner def with the flag | no `instructions` attachment in the subagent transcript | H1, DU (B) |

## 8. Risks specific to the extension

| Risk | Control |
|---|---|
| Stub children make the coordinator's job unrealistically easy | C2/C3 inject the two failure modes seen in transcripts (lying self-report; 128 API-error deaths, 01 §6); the live-phase check stays exp 10 |
| Rare-agent smoke (n = 1) passes a regression | stated; E2 agents run ≤ 2 spawns/month, so post-rollout monitoring is weak too — keep A defs in `agents/_v1/` for one milestone |
| Seeded fixtures (Q, H1, mutants) reward agents tuned to them | fixtures are written once, frozen by sha256 before any run, and identical across arms |
| Researchers' web results differ between arms | S-PJ/S-PI judged on reasoning and sourcing, not on the specific sources; same date window |
| Opus self-preference on Opus E2 roles (discovery-synthesizer) | same as 07 §8: shared bias; second judge on that pair |
