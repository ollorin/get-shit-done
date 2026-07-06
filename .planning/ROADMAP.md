# Roadmap: GSD Enhancements

## Milestones

- ✅ **v1.9.0 GSD Enhancements** — Phases 1-14 (shipped 2026-02-19)
- ✅ **v1.9.1 Upstream Sync** — Phases 18-20 (completed 2026-02-19)
- ✅ **v1.10.0 Autonomous Phase Discussion** — Phases 21-25, 33 (shipped 2026-02-21)
- ✅ **v1.11.0 System Hardening** — Phases 26-30 (completed 2026-02-20)
  - 26: Telegram MCP Reliability · 27: Knowledge Quality · 28: Compression Observability · 29: Session Fix · 30: Milestone Archival
- ✅ **v1.12.0 Autonomous Quality & Flow** — Phases 34-40 (completed 2026-03-11)
  - 34: Checkpoint & Plan-Structure Gates · 35: Test & Coverage Enforcement · 36: Migration Safety & Error Taxonomy
  - 37: PRD Traceability & Flow Context · 38: Dev Server Lifecycle & Knowledge Feedback
  - 39: Execution Intelligence · 40: Observability & Analytics
- 🚧 **v1.13.0 Product Discovery & Docs Automation** — Phases 41-43 (in progress)
  - 41: gsd:prd Workflow · 42: Milestone PRD Integration · 43: Docs Automation
- ✅ **v1.14.0 Enforcement & Integration** — Phases 44-53 (shipped 2026-07-06, PR #3) — full details: `.planning/milestones/v1.14.0-ROADMAP.md`
  - 44: Reliability Foundations · 45: Phase-Gate & Deferral · 46: Artifact & Coverage Gates · 47: Telegram Reliability · 48: Satellite Injections
  - 49: Knowledge Auto-Wiring · 50: Final Sweep & Hook Fixes · 51: Run Resilience · 52: Skew/Telemetry/Registry · 53: Eval Harness/Prompt Hygiene/Injection
- 🚧 **v1.15.0 Self-Improving Quality Loop** — Phases 54-61 (roadmap created 2026-07-06)
  - 54: Structured Handoffs & Invariant Re-Injection · 55: Failures-to-Regression Pipeline · 56: Reflective Prompt Optimization
  - 57: Outcome-Informed Routing Ledger & Bounded Escalation · 58: Honest Token Accounting · 59: Dormant Quality Agents Wired In
  - 60: Adversarial Plan Review · 61: Project-Aware Pre-PR Gate

## Phases

<details>
<summary>✅ v1.9.0 GSD Enhancements (Phases 1-14) — SHIPPED 2026-02-19</summary>

- [x] Phase 1: Auto Mode Foundation (9/9 plans) — completed 2026-02-16
- [x] Phase 2: Auto Mode Refinement (6/6 plans) — completed 2026-02-16
- [x] Phase 3: Knowledge System Foundation (5/5 plans) — completed 2026-02-16
- [x] Phase 4: Knowledge Extraction & Hooks (6/6 plans) — completed 2026-02-16
- [x] Phase 5: Knowledge Permissions & Safety (6/6 plans) — completed 2026-02-16
- [x] Phase 6: Autonomous Execution Core (6/6 plans) — completed 2026-02-16
- [x] Phase 7: Autonomous Execution Optimization (6/6 plans) — completed 2026-02-16
- [x] Phase 8: Notifications & Observability (8/8 plans) — completed 2026-02-16
- [x] Phase 8.1: Telegram MCP Server (6/6 plans) — completed 2026-02-16
- [x] Phase 9: Doc Compression Hooks (5/5 plans) — completed 2026-02-17
- [x] Phase 10: GSD Installation System (4/4 plans) — completed 2026-02-17
- [x] Phase 10.1: Multi-Instance MCP Safety (4/4 plans) — completed 2026-02-17
- [x] Phase 11: Session-End Knowledge Extraction (4/4 plans) — completed 2026-02-17
- [x] Phase 12: Historical Conversation Mining (3/3 plans) — completed 2026-02-18
- [x] Phase 13: Cross-Phase Integration Fixes (1/1 plans) — completed 2026-02-18
- [x] Phase 14: Telegram MCP Audit & Rework (6/6 plans) — completed 2026-02-18

Full details: `.planning/milestones/v1.9.0-ROADMAP.md`

</details>

<details>
<summary>✅ v1.9.1 Upstream Sync (Phases 18-20) — COMPLETE 2026-02-19</summary>

**Milestone Goal:** Review glittercowboy/get-shit-done upstream commits and port the most valuable improvements into this fork without breaking fork-specific features (auto routing, knowledge system, Telegram MCP, autonomous execution).

#### Phase 18: Upstream Audit — COMPLETE
**Goal**: Developer can see exactly what upstream has added since the fork diverged, with every change categorized and evaluated for portability
**Depends on**: Nothing (first phase of milestone)
**Requirements**: AUDT-01, AUDT-02
**Plans**: 1/1

Plans:
- [x] 18-01: Fetch upstream, compare commit history, produce UPSTREAM-DIFF.md — completed 2026-02-19

#### Phase 19: Bug Fixes & Context Window Management — COMPLETE
**Goal**: All upstream stability fixes and context window improvements are running in the fork with no regressions to existing fork-specific features
**Depends on**: Phase 18
**Requirements**: BUGF-01, BUGF-02, CTXT-01
**Plans**: 2/2

Plans:
- [x] 19-01: Port upstream bug fixes to shared code paths — completed 2026-02-19
- [x] 19-02: Port upstream context window management improvements — completed 2026-02-19

#### Phase 20: Git Branching & Autonomous Execution — COMPLETE
**Goal**: GSD creates feature branches at phase start and any compatible upstream execution improvements are integrated without breaking the fork's sub-coordinator design
**Depends on**: Phase 19
**Requirements**: GIT-01, GIT-02, EXEC-01, EXEC-02
**Plans**: 2/2

Plans:
- [x] 20-01: Implement early git branching at phase start — completed 2026-02-19
- [x] 20-02: Port compatible upstream autonomous execution improvements — completed 2026-02-19

</details>

<details>
<summary>✅ v1.10.0 Autonomous Phase Discussion (Phases 21-25, 33) — SHIPPED 2026-02-21</summary>

- [x] Phase 21: Knowledge Global Migration (3/3 plans) — completed 2026-02-19
- [x] Phase 22: Discuss Step & Meta-Answerer (4/4 plans) — completed 2026-02-19
- [x] Phase 23: Telegram Escalation (2/2 plans) — completed 2026-02-19
- [x] Phase 24: Telegram Notifications (4/4 plans) — completed 2026-02-19
- [x] Phase 25: End-to-End Validation (4/4 plans) — completed 2026-02-19
- [x] Phase 33: v1.10.0 Tech Debt Closure (2/2 plans) — completed 2026-02-21

Full details: `.planning/milestones/v1.10.0-ROADMAP.md`

</details>

<details>
<summary>✅ v1.11.0 System Hardening (Phases 26-32) — COMPLETE 2026-02-21</summary>

#### Phase 26: Telegram MCP Reliability
**Goal**: Fix three silent failure modes in the Telegram MCP daemon that cause polling callers to always wait full timeouts, questions to be lost on daemon restart, and timed-out questions to disappear without user notification
**Depends on**: Phase 25 (validation complete)
**Requirements**: TREL-01, TREL-02, TREL-03
**Success Criteria** (what must be TRUE):
  1. `check_question_answers` with `wait_seconds` wakes immediately when an answer arrives — confirmed by timing a reply that arrives before the timeout
  2. Restarting the Telegram daemon while a question is pending restores the question state and the next `check_question_answers` poll returns it as still-pending
  3. When a question times out, a message appears in the Telegram thread ("Question timed out after N minutes") before the question is removed from internal state
**Plans**: 3 plans

Plans:
- [x] 26-01: Fix EventEmitter glob listener — add `anyAnswer` event to `QuestionService.deliverAnswer()`, replace `once('answer:*')` with `once('anyAnswer')` in `daemon/index.ts`
- [x] 26-02: Daemon restart question persistence — serialize `questions` map to `~/.claude/knowledge/question-state.jsonl` on every `ask()`/`deliverAnswer()`, restore on startup in `daemon/index.ts`
- [x] 26-03: Timeout notification — send thread message before `cleanUpQuestion()` fires, with DM-mode fallback via `sendToGroup()`

#### Phase 27: Knowledge System Quality
**Goal**: Close three gaps in the knowledge pipeline: near-duplicate entries accumulating due to skipped embedding dedup, meta-answerer escalating to Telegram on questions it could answer with broader queries, and no mechanism to prune stale low-utility entries
**Depends on**: Phase 26
**Requirements**: KQUAL-01, KQUAL-02, KQUAL-03
**Success Criteria** (what must be TRUE):
  1. Writing two semantically identical but differently-worded entries to the knowledge DB results in only one entry being stored (embedding similarity dedup fires at write time)
  2. The meta-answerer runs a `--type decision` query and a keyword-broadened query before assigning confidence 0.0 — reducing unnecessary Telegram escalations on sparse KB
  3. Running `gsd-tools knowledge prune` reports entries deleted by the staleness rules, and the command runs automatically when the DB exceeds 10MB
**Plans**: 3 plans

Plans:
- [x] 27-01: Stage-3 embedding dedup — call `generateEmbeddingCached()` with `Promise.race` 2s timeout in `knowledge-writer.js` before `checkDuplicate()`, pass result as third argument — completed 2026-02-20
- [x] 27-02: Meta-answerer multi-pass fallback — add `--type decision` pass and keyword-broadened pass in `agents/gsd-meta-answerer.md` before conceding confidence 0.0 — completed 2026-02-20
- [x] 27-03: Knowledge DB pruning — add `pruneStaleEntries()` to `knowledge-lifecycle.js`, `knowledge prune [--dry-run]` CLI command, auto-trigger at 10MB from `knowledge-checkpoint.js` — completed 2026-02-20

#### Phase 28: Compression & Observability
**Goal**: Make the doc compression pipeline actually observable — write the metrics it was designed to track, measure token reduction instead of char reduction, and add query-context-aware paragraph scoring to improve coverage on long prose files
**Depends on**: Phase 26
**Requirements**: COBS-01, COBS-02, COBS-03
**Success Criteria** (what must be TRUE):
  1. After doc compression runs, `gsd-tools compress metrics` returns real data (timestamps, files, reduction percentages) instead of "No compression metrics yet"
  2. The metrics output includes `originalTokensEst` and `compressedTokensEst` alongside char counts, calculated via `Math.ceil(length / 4)`
  3. When a query context string is available in the hook input, `HeaderExtractor` scores paragraphs by term overlap and selects the highest-scoring ones rather than always taking the first 300 chars per section
**Plans**: 3 plans

Plans:
- [x] 28-01: Write compression metrics JSONL — add `fs.appendFileSync` to `compression-metrics.jsonl` after `recordSuccess()` in `doc-compression-hook.js` with `{timestamp, file, originalChars, compressedChars, reductionPercent}`
- [x] 28-02: Token-based metrics — add `estimateTokens(text)` helper, log `originalTokensEst`/`compressedTokensEst` in metrics JSONL and `compress metrics` CLI output
- [x] 28-03: Semantic paragraph scoring — add `selectiveExtract(content, queryContext)` to `header-extractor.js` scoring paragraphs by term overlap; fall back to structural extraction when no query context

#### Phase 29: Session Extraction Fix
**Goal**: Fix the session-end knowledge extraction hook so it actually fires when Claude Code sessions end — currently wired to SIGTERM which Claude Code does not send, meaning the entire Phase 11/12 session extraction pipeline is silently inactive
**Depends on**: Phase 28
**Requirements**: SFIX-01
**Success Criteria** (what must be TRUE):
  1. After a Claude Code session ends, a new entry appears in the knowledge DB extracted from that session's responses — confirmed by checking DB before/after a session that contains a decision
  2. The hook fires via the Claude Code `Stop` hook mechanism (registered in `~/.claude/settings.json`) not SIGTERM
**Plans**: 1 plan

Plans:
- [x] 29-01: Session-end Stop hook — create `bin/hooks/session-end-standalone.js` reading from Claude Code hook JSON on stdin, accumulate via temp file keyed on `CLAUDE_SESSION_ID`, register as `Stop` hook in `install.js` — completed 2026-02-20

#### Phase 30: Milestone Summary & Archival
**Goal**: After a milestone completes, an automated step generates a structured milestone summary (what was built, decisions made, plan count, duration) and archives completed phase artifacts to a milestone subfolder for fast future reference
**Depends on**: Phase 29
**Requirements**: ARCH-01, ARCH-02, ARCH-03
**Success Criteria** (what must be TRUE):
  1. Running `/gsd:complete-milestone` after a milestone produces a milestone summary document written to `.planning/milestones/{version}-SUMMARY.md` containing a one-liner per phase, total plan count, total duration, and key decisions
  2. Completed phase directories are moved (not copied) to `.planning/milestones/{version}/phases/` on archival, leaving only the milestone summary in `.planning/milestones/`
  3. The milestone summary is committed to the repo as a readable artifact and optionally broadcast via Telegram if a telegram_topic_id is active
  4. Re-running `/gsd:complete-milestone` on an already-archived milestone is idempotent — no duplicate moves or overwrites
**Plans**: 1 plan

Plans:
- [x] 30-01: Milestone summarize & archive-phases commands — completed 2026-02-20

#### Phase 31: Per-Task Model Routing

**Goal:** When model_profile is "auto", each task in a PLAN.md gets assigned an optimal model tier (haiku/sonnet/opus) by the planner's post-draft routing pass, and the coordinator spawns per-task executors at those tiers with lightweight runtime quota downgrade — making the executor a mini-orchestrator rather than a single-tier runner
**Depends on:** Phase 30
**Plans:** 3/3 plans complete

Plans:
- [x] 31-01-PLAN.md — Add routing pass to gsd-planner: post-draft tier tagging of task names when model_profile="auto"
- [ ] 31-02-PLAN.md — Update gsd-phase-coordinator: parse per-task tier tags, apply quota downgrade, spawn per-task executors, add routing stats to Telegram notification
- [ ] 31-03-PLAN.md — Update gsd-executor: haiku→sonnet escalation on retry, routing tier tracking in SUMMARY.md

#### Phase 32: Reliability & Quality Gap Fixes

**Goal:** Close nine specific gaps identified by post-v1.11.0 audit: Telegram replies written to CONTEXT.md but never injected into the knowledge DB; silent Telegram topic creation failure swallowing all notifications for an entire roadmap run; session-end hook .done race condition allowing duplicate extraction; answered questions accumulating in question-state.jsonl forever; IPC server buffering unbounded partial JSON; embedding dedup timeout hardcoded at 2s; knowledge evolution running without a transaction; compression cache never invalidating on file modification; and knowledge search claiming RRF but performing sequential FTS-then-vector
**Depends on:** Phase 31
**Requirements**: GAP-01 through GAP-09
**Success Criteria** (what must be TRUE):
  1. After a Telegram escalation, a new knowledge DB entry appears with confidence 1.0 for the question+answer pair — confirmed by querying the DB immediately after escalation completes
  2. When `create_topic` fails at roadmap start, a visible warning is emitted to the execution log and Telegram notifications are explicitly disabled (not silently no-op) for that run
  3. Two concurrent Stop hook invocations for the same session produce exactly one knowledge extraction — confirmed by running two simultaneous invocations and checking DB entry count
  4. Restarting the Telegram daemon after answering two questions leaves question-state.jsonl with zero answered entries (pruned on startup)
  5. Sending 2MB of partial JSON to the IPC server closes the socket before the process exceeds 50MB RSS increase
  6. Setting `knowledge.embedding_timeout_ms: 500` in config.json causes `GSD_DEBUG=1` logs to show the configured timeout being used
  7. Writing two entries where the second write fails mid-operation (vector table update) leaves the DB with either both tables updated or neither — no orphaned main-table entries
  8. After modifying a compressed doc, the next hook invocation produces a fresh compression result (cache miss) rather than serving the stale cached version
  9. A search query that matches 3 documents in FTS at ranks [1,2,5] and the same documents in vector at ranks [3,1,2] produces a merged result ranked by RRF score rather than FTS rank alone
**Plans:** 4/4 complete

Plans:
- [x] 32-01-PLAN.md — GAP-03 atomic .done guard + GAP-05 IPC buffer cap + GAP-07 evolution mutex — completed 2026-02-21
- [x] 32-02-PLAN.md — GAP-04 question-state prune on startup + GAP-02 create_topic failure warning — completed 2026-02-21
- [x] 32-03-PLAN.md — GAP-06 embedding timeout configurable + GAP-01 Telegram escalation answers to KB — completed 2026-02-21
- [x] 32-04-PLAN.md — GAP-08 compression cache mtime verification + GAP-09 searchKnowledgeAsync + RRF — completed 2026-02-21

#### Phase 33: v1.10.0 Tech Debt Closure

**Goal:** Fix the confidence type contract bug in query-knowledge output (string "medium" returned instead of numeric float, breaking meta-answerer scoring when KB has entries) and update REQUIREMENTS.md traceability + SUMMARY.md frontmatter to accurately reflect v1.10.0 completion
**Depends on:** Phase 32
**Success Criteria** (what must be TRUE):
  1. `query-knowledge` returns `confidence: 0.7` (float) as the fallback when a KB entry lacks `metadata.confidence` — confirmed by inserting a test entry without confidence metadata and querying it
  2. REQUIREMENTS.md traceability table shows all 25 v1.10.0 requirements as "Complete" and all 25 checkboxes checked `[x]`
  3. Plans 22-02, 22-03, 22-04, 23-01, 24-02, 24-03, 24-04 each have correct `requirements-completed` arrays in their SUMMARY.md frontmatter matching the requirements they implemented
**Plans:** 2/2 plans complete

Plans:
- [x] 33-01-PLAN.md — Fix `confidence` string/float bug in `gsd-tools.js` line 8947 + update REQUIREMENTS.md traceability (20 Pending → Complete, 20 checkboxes) — completed 2026-02-21
- [x] 33-02-PLAN.md — Backfill `requirements-completed` in 7 SUMMARY.md files (22-02, 22-03, 22-04, 23-01, 24-02, 24-03, 24-04) — completed 2026-02-21

</details>

<details>
<summary>✅ v1.12.0 Autonomous Quality & Flow (Phases 34-40) — COMPLETE 2026-03-11</summary>

#### Phase 34: Checkpoint & Plan-Structure Gates

**Goal:** The coordinator refuses to advance through its lifecycle when plans are structurally incomplete — plan execution is blocked when test tasks are absent, phase completion is blocked when VERIFICATION.md is missing or not passed, and CHECKPOINT.json semantics are standardized so the coordinator's step tracking is unambiguous
**Depends on:** Phase 33
**Requirements:** QGATE-01, QGATE-02, QGATE-06, QGATE-09
**Success Criteria** (what must be TRUE):
  1. Submitting a plan that lacks `tdd="true"` test tasks to the coordinator's plan step causes `gsd-tools.js verify plan-structure` to emit a non-zero exit and the coordinator halts before spawning an executor
  2. Calling `gsd-tools.js phase complete` when the phase directory has no VERIFICATION.md (or VERIFICATION.md `status` is not `passed`) returns an error and refuses to mark the phase done
  3. `gsd-tools.js phase complete` also fails when any PLAN.md in the phase directory lacks a matching SUMMARY.md or when CHECKPOINT.json `last_step` is not `verify`
  4. CHECKPOINT.json `step_status: "complete"` is documented to mean the step ran — outcome is always read from VERIFICATION.md `status`, not inferred from checkpoint alone; coordinator prompt updated to reflect this contract
**Plans:** 2/2 plans complete

Plans:
- [ ] 34-01: Add `verify plan-structure` subcommand to gsd-tools.js — checks tdd and ui-qa task presence; wire into coordinator plan step as hard gate
- [ ] 34-02: Add phase completeness validation to `phase complete` subcommand — VERIFICATION.md existence + status, SUMMARY.md coverage, CHECKPOINT.json last_step; document CHECKPOINT semantics in coordinator checkpoint_protocol

#### Phase 35: Test & Coverage Enforcement

**Goal:** Executors and verifiers enforce hard quality standards — the test suite runs after every plan, Charlotte sweeps web projects unconditionally, coverage thresholds are configurable and enforced, and the verifier hard-fails when implementation files have no corresponding test files
**Depends on:** Phase 34
**Requirements:** QGATE-03, QGATE-04, QGATE-07, QGATE-08, QGATE-10
**Success Criteria** (what must be TRUE):
  1. After all tasks in a plan complete, the executor runs the full project test suite; if any test fails, SUMMARY.md is not created and the plan is marked failed
  2. For a project with React/Next.js/Vue/Svelte detected in package.json, Charlotte UX sweep runs after every plan's executor phase regardless of whether the coordinator happened to notice .tsx in SUMMARY.md
  3. When `testing.coverage_threshold` is set in config.json, the executor reads it and blocks SUMMARY.md creation if the measured coverage falls below the threshold
  4. The verifier marks a phase `gaps_found` (not warning) when SUMMARY.md key-files includes .tsx/.jsx but no Charlotte QA session entry appears in the phase record
  5. The verifier hard-fails (`gaps_found`) when a .ts/.tsx/.js implementation file listed in SUMMARY.md key-files has no corresponding test file — a warning is never emitted for this condition
**Plans:** 3/3 complete

Plans:
- [x] 35-01: Executor post-plan test suite gate — run test command after task completion, block SUMMARY.md on failure; add coverage threshold check when config.testing.coverage_threshold is set
- [x] 35-02: Charlotte mandatory sweep — detect web framework in package.json; unconditional Charlotte step in executor for web projects; add coverage threshold enforcement
- [x] 35-03: Verifier hard-fail rules — gaps_found on missing Charlotte QA for UI files; gaps_found on implementation files with no test counterpart

#### Phase 36: Migration Safety & Error Taxonomy

**Goal:** Migration timestamp conflicts are caught before they reach the commit and VERIFICATION.md gaps carry structured type information so the gap-closure planner can route fixes intelligently rather than treating all gaps as equivalent
**Depends on:** Phase 34
**Requirements:** QGATE-05, FLOW-03
**Success Criteria** (what must be TRUE):
  1. Running `gsd-tools.js verify migration-timestamps` before commit scans all migration files, detects duplicate timestamps, and auto-resolves conflicts by incrementing the conflicting timestamp — the scan runs as part of the verifier step for projects with a migrations directory
  2. VERIFICATION.md gap entries include a `failure_type` field set to one of the documented enum values (`stub | unwired | missing_artifact | semantic_stub | broken_chain | regression | missing_test`) — the verifier populates this field; gaps without a type are rejected as malformed
  3. The gap-closure planner reads `failure_type` from each gap and selects a fix strategy accordingly — stub gaps get a different plan template than regression gaps
**Plans:** 2/2 plans complete

Plans:
- [ ] 36-01: Migration timestamp conflict detection — add `verify migration-timestamps` subcommand to gsd-tools.js; auto-resolve by incrementing duplicate timestamps; wire into verifier for projects with migrations directory
- [ ] 36-02: VERIFICATION.md failure_type enum — update verifier agent prompt to populate failure_type on each gap; update gap-closure planner to route by type

#### Phase 37: PRD Traceability & Flow Context

**Goal:** Plans built on PRD input are traceable to their source requirements, and Wave 2+ executors within a phase receive accurate context about what was actually built in prior waves rather than relying on what earlier plans assumed they would build
**Depends on:** Phase 34
**Requirements:** FLOW-02, FLOW-04
**Success Criteria** (what must be TRUE):
  1. Running the PRD Express Path in plan-phase produces a PRD-TRACE.md file mapping each PRD requirement to its REQ-ID; the verifier reads PRD-TRACE.md and flags intent mismatches between the PRD requirement and the implementation SUMMARY.md
  2. When a phase contains multiple waves, the coordinator injects a `<completed_plans_context>` block into each Wave 2+ executor spawn — the block contains the key-files and decisions from each completed plan's SUMMARY.md, not the original plan assumptions
  3. PRD-TRACE.md is included in the audit-milestone cross-reference output alongside REQUIREMENTS.md
**Plans:** 2/2 plans complete

Plans:
- [ ] 37-01: PRD-TRACE.md generation — add PRD-TRACE.md write step to plan-phase PRD Express Path; update verifier to check intent alignment against PRD-TRACE.md when present
- [ ] 37-02: Wave context carry-forward — add completed_plans_context assembly in coordinator between waves; inject into Wave 2+ executor spawns; update audit-milestone to include PRD-TRACE.md

#### Phase 38: Dev Server Lifecycle & Knowledge Feedback

**Goal:** Dev server management is unified so every part of GSD that needs a running server uses the same config-driven module, and the knowledge DB is continuously fed from phase execution so decisions and anti-patterns discovered during a run are persisted immediately rather than only at session end
**Depends on:** Phase 35
**Requirements:** FLOW-05, FLOW-06
**Success Criteria** (what must be TRUE):
  1. A `dev_servers` registry in config.json defines named servers with start command, health endpoint, and port; `gsd-tools.js service-health start <name>` starts the server and waits for the health endpoint, and `service-health stop <name>` cleanly terminates it after phase completion
  2. Charlotte QA, the coordinator UI loop, and the post-phase UX sweep all reference `service-health` rather than spawning their own server processes — no duplicate server starts for the same phase
  3. After each phase completes, the transition workflow writes decisions from SUMMARY.md key decisions into the knowledge DB as `source_type: decision` entries; the verifier writes identified anti-patterns as `source_type: anti_pattern` entries with `confidence: 0.9`
**Plans:** TBD

Plans:
- [ ] 38-01: service-health module in gsd-tools.js — config.json dev_servers registry; start/stop/status subcommands with health polling; update coordinator, Charlotte, and UX sweep references
- [ ] 38-02: Knowledge DB feedback from execution — transition workflow writes SUMMARY.md decisions to KB; verifier writes anti-patterns; wire into both agent prompts

#### Phase 39: Execution Intelligence

**Goal:** The executor and coordinator detect problems before they cause failures — dependency drift is caught before a phase starts, file conflicts between parallel phases are surfaced in the execution plan, and inter-task type errors are caught and auto-fixed within a plan before they accumulate
**Depends on:** Phase 35
**Requirements:** FLOW-01, FLOW-07, FLOW-08
**Success Criteria** (what must be TRUE):
  1. Before executing a phase, `gsd-tools.js verify dependency-stability <phase>` checks that key files from depended-on phases have not been modified by intervening phases; a drift report is produced and the coordinator surfaces it before proceeding
  2. When `roadmap analyze` identifies parallel-eligible phases, the output includes a `file_conflicts` section listing files claimed by more than one parallel phase — shown in the execution plan confirmation prompt before the run starts
  3. The executor runs `tsc --noEmit` (or equivalent) between tasks; a type error triggers one auto-fix attempt before the error is logged as a gap and execution continues to the next task — type errors never abort the entire plan
**Plans:** 3/3 complete

Plans:
- [x] 39-01: Dependency drift detection — add `verify dependency-stability <phase>` subcommand to gsd-tools.js; wire into coordinator pre-execution check; emit drift report
- [x] 39-02: Parallel file conflict detection — update `roadmap analyze` to compute file_conflicts across parallel-eligible phases; add to execution plan confirmation output
- [x] 39-03: Inter-task type checking — add tsc step between tasks in executor; one auto-fix retry; log as gap on second failure; never abort plan

#### Phase 40: Observability & Analytics

**Goal:** Execution is observable in real time through context budget monitoring with automatic mode switching, and historically through an analytics command that generates reports from accumulated execution data and self-tunes config thresholds from actual history
**Depends on:** Phase 39
**Requirements:** FLOW-09, FLOW-10
**Success Criteria** (what must be TRUE):
  1. When the coordinator's context window reaches 60% usage, it switches to compressed response mode and sends a Telegram notification; at 80% it considers spawning the verifier as a fresh subagent with a context handoff summary
  2. Running `gsd-tools.js analytics report` produces a summary from EXECUTION_LOG.md and SUMMARY metrics including phase durations, plan counts, failure rates, and model tier distribution
  3. Running `gsd-tools.js analytics calibrate` reads actual execution history and updates config.json thresholds (e.g. complexity tier boundaries, coverage thresholds) based on observed outcomes — a dry-run flag shows proposed changes without writing
  4. `execute-roadmap` automatically runs `analytics report` at completion and appends the summary to the execution log
**Plans:** TBD

Plans:
- [ ] 40-01: Context budget monitoring — add context usage tracking to coordinator; compressed mode at 60%; fresh-subagent consideration at 80%; Telegram notification on mode switch
- [ ] 40-02: Analytics command group — `analytics report` from EXECUTION_LOG.md + SUMMARY metrics; `analytics calibrate` updates config thresholds from history; auto-run report at execute-roadmap completion

</details>

### v1.13.0 Product Discovery & Docs Automation (Phases 41-43)

**Milestone Goal:** Add a structured PRD maturation workflow (`gsd:prd`) that takes raw product ideas through PM/PO/tech stages to produce product-oriented PRDs, update `gsd:new-milestone` to consume PRDs autonomously, and embed mandatory docs updates into the phase execution and verification cycle.

**Dependency note:** Phase 42 depends on Phase 41 (needs `.planning/prds/` structure defined first). Phase 43 is independent and can execute in parallel with Phase 41.

#### Phase 41: gsd:prd Workflow

**Goal:** User can mature a raw product concept into a structured PRD through three sequential PM/PO/tech stages with confidence-driven Q&A, producing a stored product-oriented PRD at `.planning/prds/pending/` that is ready for milestone planning
**Depends on:** Phase 40 (v1.12.0 complete)
**Requirements:** PRD-01, PRD-02, PRD-03, PRD-04, PRD-05, PRD-06
**Success Criteria** (what must be TRUE):
  1. User runs `gsd:prd` with a concept description (text input, file path, or URL) and the workflow starts without error, entering the PM Discovery stage
  2. PM Discovery stage performs competitive web research, then conducts multi-round Q&A (max 4 questions per round) stating current confidence and blocking gaps explicitly each round — Q&A stops only when confidence is sufficient to advance, not after a fixed number of rounds
  3. PO/BA Scoping stage reads the existing codebase and `.planning/prds/done/` for context before defining user stories and acceptance criteria through Q&A, and draws an explicit MVP vs Phase 2 boundary
  4. HL Tech Discovery stage identifies technology candidates and architectural constraints — the output contains no schemas, API routes, or implementation code
  5. A completed PRD file appears at `.planning/prds/pending/{name}.md` containing problem statement, goals, user stories, acceptance criteria, tech candidates, open questions, and an explicit assumptions list
**Plans:** TBD

Plans:
- [ ] 41-01: Scaffold `gsd:prd` workflow + `.planning/prds/` directory structure + PRD output template
- [ ] 41-02: PM Discovery stage — web research step + confidence-driven multi-round Q&A loop
- [ ] 41-03: PO/BA Scoping stage — codebase + done-PRD context read + user story / acceptance criteria Q&A + MVP boundary
- [ ] 41-04: HL Tech Discovery stage — research step + tech candidate output with no-HOW guard

#### Phase 42: Milestone PRD Integration

**Goal:** When starting a new milestone, the user is offered existing pending PRDs as selectable options, and selecting one drives fully autonomous phase decomposition with a single approval checkpoint before any branch or planning files are created
**Depends on:** Phase 41 (`.planning/prds/` structure must exist)
**Requirements:** MILE-01, MILE-02, MILE-03, MILE-04
**Success Criteria** (what must be TRUE):
  1. Running `gsd:new-milestone` when `.planning/prds/pending/` contains one or more PRD files presents those PRDs as numbered options before asking "what to build next"
  2. Selecting a PRD produces a complete phase decomposition (phase names, goals, requirement coverage, dependency ordering) without the user defining any phases manually
  3. User sees a single approval screen showing the proposed roadmap before any branch or planning files are created — nothing is written until the user approves
  4. After roadmap approval, the selected PRD file moves from `.planning/prds/pending/` to `.planning/prds/done/` — the pending folder no longer contains that PRD
**Plans:** TBD

Plans:
- [ ] 42-01: Detect and present pending PRDs in `gsd:new-milestone` — scan `.planning/prds/pending/`, present as options, fall through to manual input when none found
- [ ] 42-02: Autonomous phase decomposition from PRD — read selected PRD, derive phases with dependency ordering, present single approval checkpoint
- [ ] 42-03: PRD lifecycle on approval — move PRD from pending to done on roadmap approval; update REQUIREMENTS.md traceability

#### Phase 43: Docs Automation

**Goal:** Every phase execution automatically produces appropriately-scoped documentation as a mandatory final step, and the verifier gates phase completion on docs being present and proportionate to what was built
**Depends on:** Phase 40 (v1.12.0 complete — independent of Phases 41 and 42)
**Requirements:** DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05
**Success Criteria** (what must be TRUE):
  1. After all feature tasks complete in the final execution wave, a Haiku docs agent runs as the last mandatory task — it is not skippable and fires regardless of what was built
  2. Docs output scales to build scope: a new API endpoint produces a file in `api/`; a new UI surface produces a file in `frontend-operator/` or `frontend-player/`; an architectural decision appends to `architecture/`; an internal refactoring produces only a minimal changelog entry
  3. The docs agent reads existing `/docs` templates and frontmatter conventions from the target project before writing any content, and its output matches the established project style
  4. The phase verifier marks the phase `gaps_found` when the docs agent was skipped or when docs scope does not match build scope (e.g., new endpoint built but no `api/` doc entry produced)
  5. When `/docs` does not exist in the project, the agent creates the folder and seeds it with content covering what was built; when `/docs` exists, the agent updates existing files where relevant and creates new files only for new surfaces — no padding or invented content in either case
**Plans:** TBD

Plans:
- [ ] 43-01: `gsd-docs-updater` Haiku agent — reads `/docs` conventions, scales output to build scope, guards against padding and invented content
- [ ] 43-02: Executor final-wave integration — wire docs agent as last mandatory task after feature work is committed; pass SUMMARY.md build scope as context
- [ ] 43-03: Verifier docs validation gate — check docs appropriateness relative to build scope; `gaps_found` on skip or scope mismatch

### ✅ v1.14.0 Enforcement & Integration (Phases 44-53) — SHIPPED 2026-07-06 (PR #3)

> Full phase details archived to `.planning/milestones/v1.14.0-ROADMAP.md`. All 10 phases verified (gsd-verifier + verify phase-gate) and deployed; tests 155 → 514. Section retained below for in-place history.

**Milestone Goal:** Make every mandatory GSD step deterministic and automatic — deterministic enforcement gates replace prose "MUST" language, valuable satellite capabilities (mining, Nyquist, discovery, debugger) inject into the golden path, knowledge maintenance runs automatically on its natural triggers, the escalation channel is hardened for unattended overnight runs, and (scope addition 2026-07-05) the framework becomes self-resilient and self-observable: it survives its own coordinator deaths, detects stale installs, measures its own prompts, and hardens against injection.

**Branch:** `feature/enforcement-and-integration` (existing)
**Source PRD:** `.planning/prds/done/enforcement-and-integration.md` (US-1..US-16) + scope addition `docs/analysis/2026-07-02-deep-dive/17-scope-addition-v1.14.md` (MILE-22..31, promoted from analysis docs 15/16 by maintainer 2026-07-05)

**Dependency note:** Core (44→45→46→47→48→49) landed & verified. Phase 50 (extended) then 51→52→53 run sequentially. 51 (auto-resume/state sanity) precedes 52 (skew/telemetry/registry — self-report rides the same return-contract changes) precedes 53 (eval harness/prompt hygiene/injection — largest; every prior phase becomes its test corpus).

**Scope notes:** No new UI anywhere in this milestone (PRD-confirmed) — no Charlotte QA or E2E-regression phase required. Every phase carries its own integration-test success criterion. US-14 split: MILE-18 (Phase 44) vs MILE-19 (Phase 50). rtk fixes (hooks R-4/R-5) are OUT — separate rtk repo.

**Status (2026-07-05):** Phases 44-49 ✅ complete/verified/deployed (tests 155→317). Extended scope 50-53 pending.

#### Phase 44: Reliability Foundations & Dead-Code Cleanup

**Goal:** The 11,695-line `gsd-tools.js` and the installer no longer crash or silently corrupt state, CI runs the test suite on every push/PR, and verified-dead code with no replacement dependency is removed — de-risking every gate built on top in later phases
**Depends on:** Phase 43 (v1.13.0 scope present in codebase)
**Requirements:** MILE-18, MILE-20
**Success Criteria** (what must be TRUE):
  1. Unguarded `JSON.parse` call sites in gsd-tools.js are wrapped with try/catch producing typed, actionable errors; `execSync` calls with unsanitized interpolation are replaced with `spawn`/`execFile` + argv arrays; `STATE.md`/`ROADMAP.md`/`config.json` read-modify-write operations use atomic write-rename so no update is silently lost under parallel execution
  2. A GitHub Actions workflow runs `npm test` on push and pull request; install builds `hooks/dist` if missing, `PreToolUse` hooks are timeout-wrapped, and hook dependency failures fail the install loudly instead of registering silently
  3. `get-shit-done/modules/` stubs, `skills/llmlingua-comparison/`, orphaned hook files, `parallel-executor.js` + its requiring command, the broken quota auto-compression branch in `token-monitor.js`, and stale template/QGATE-07 references are removed — each deletion preceded by a fresh zero-reference grep in the same session; `scripts/install-hooks.js` removed only if confirmed fully duplicated by `bin/install.js`
  4. Integration tests cover: malformed JSON per guarded site (typed error, not crash); execSync replacement sites (no shell injection via crafted branch/file names); concurrent `STATE.md` writes (both updates preserved); CI config runs on push and PR events
**Plans:** 5/5 plans executed — PHASE COMPLETE, VERIFIED (status: passed, 2026-07-04)

Plans:
- [x] 44-01: JSON.parse guards + execSync → spawn/execFile hardening in gsd-tools.js
- [x] 44-02: Atomic write-rename for STATE.md / ROADMAP.md / config.json read-modify-write paths
- [x] 44-03: GitHub Actions CI (npm test on push/PR) + installer fixes (hooks/dist build, timeout-wrapped PreToolUse, loud dependency failures)
- [x] 44-04: Category-A dead-code deletions with fresh zero-reference greps (modules/ stubs, llmlingua-comparison, orphaned hooks, parallel-executor, quota branch, stale refs, install-hooks.js if duplicated)
- [x] 44-05: Integration tests — JSON guard sites, injection resistance, concurrent state writes

#### Phase 45: Deterministic Phase-Gate & Deferral Protocol

**Goal:** Phase completion is blocked by a single deterministic tool call that computes expected artifacts from plan type and the actual git diff, and every intentional skip of a mandatory step requires a machine-readable, auditable `DEFERRED.json` waiver — silent skipping becomes structurally impossible
**Depends on:** Phase 44
**Requirements:** MILE-05, MILE-06, MILE-07
**Success Criteria** (what must be TRUE):
  1. `gsd-tools.js verify phase-gate {phase}` exists, returns machine-readable JSON, and exits non-zero when any expected artifact (test changes for tdd tasks, Charlotte QA evidence for UI files, docs commit for documentation-worthy signals, E2E-TEST-PLAN.md for UI plans, VERIFICATION.md) is missing without a matching waiver; malformed plan frontmatter yields a graceful typed error, not a crash
  2. `HAS_UI` is computed from `git diff --name-only` file extensions and route-pattern files, independent of SUMMARY.md content — a `.tsx` file omitted from SUMMARY `key-files` is still detected; zero-UI plans are not falsely flagged
  3. `DEFERRED.json` (`{step, reason, approver, timestamp, phase, plan}`) is defined, documented, and satisfies any expected-artifact check in place of the artifact; every self-waiver fires a non-blocking Telegram notification at write time; `audit-milestone` surfaces all accumulated waivers as a visible table
  4. `execute-phase.md`, `execute-roadmap.md`, `gsd-executor.md`, and `gsd-phase-coordinator.md` call phase-gate and treat non-zero exit as blocking; skipping a mandatory step requires writing the waiver as part of the skip; the prose "MUST" checklists the gate replaces are removed from the corresponding agent prompts (not left duplicated)
  5. Integration tests cover: all artifacts present → pass; each artifact type missing individually → correct `failure_type`; waiver present for missing artifact → pass; malformed frontmatter → typed error; UI file omitted from SUMMARY → detected; non-UI plan → not flagged; mixed plan → detected; valid waiver → pass; missing waiver → fail; malformed JSON waiver → loud typed error, never silently ignored
**Plans:** 5/5 plans complete

Plans:
- [ ] 45-01: `verify phase-gate` subcommand — expected-artifact computation from plan type + touched files, machine-readable JSON output, typed failure types
- [ ] 45-02: Diff-based HAS_UI detection (extensions + route patterns, SUMMARY-independent)
- [ ] 45-03: DEFERRED.json waiver protocol — schema, gate integration, fire-and-forget Telegram notification, audit-milestone waiver table
- [ ] 45-04: Workflow/agent wiring — blocking phase-gate calls in execute-phase/execute-roadmap/executor/coordinator + removal of replaced prose MUST checklists
- [ ] 45-05: Integration tests — phase-gate matrix, HAS_UI detection cases, waiver valid/missing/malformed

#### Phase 46: Artifact-Generation & Coverage Gates

**Goal:** The gates that demand artifacts also produce or verify them — the E2E generator auto-runs when its artifact is required, docs-updater failure blocks instead of logging, and the verifier requires real, non-hollow test coverage per requirement with the Nyquist auditor auto-filling gaps — so no gate ever demands an artifact nothing creates
**Depends on:** Phase 45
**Requirements:** MILE-08, MILE-09, MILE-10
**Success Criteria** (what must be TRUE):
  1. `gsd-e2e-test-generator` auto-spawns when `HAS_UI=true` and `E2E-TEST-PLAN.md` is missing or has coverage gaps, before phase-gate evaluates; when the plan already covers all pages the generator is not re-invoked; generator failure fails phase-gate with a clear `failure_type`, never a silent pass
  2. `gsd-docs-updater` returns a structured contract (written-files list, commit hash or none, errors); thrown error, timeout, or "no changes" with matched documentation-worthy signals is a hard failure that blocks the phase, waivable only via DEFERRED.json — never silent continuation
  3. The verifier's init step classifies each PLAN.md requirement ID COVERED / PARTIAL / MISSING against test files; an empty describe block or net-zero new assertions since a prior commit fails the gate; gaps blocking-spawn `gsd-nyquist-auditor`; unfillable gaps escalate as `gaps_found`, never silently pass
  4. `/gsd:validate-phase` is deleted once this lands — its function fully absorbed into the verifier gate (fresh zero-reference grep before deletion)
  5. Integration tests cover: E2E gap → generator spawned → plan produced; full coverage → generator skipped; generator failure → gate fails; docs success → pass; docs exception → block; docs no-changes-with-signals + no waiver → block; empty test file → `missing_test`; real assertions → pass; unmatched requirement → MISSING + nyquist invoked; unfillable gap → `gaps_found`
**Plans:** 4/4 plans complete

Plans:
- [ ] 46-01: E2E generator auto-spawn — gap detection, idempotent skip on full coverage, failure_type on generator failure
- [ ] 46-02: Docs-updater structured contract + blocking docs gate in executor/execute-plan, DEFERRED.json-only waiver path
- [ ] 46-03: Test-content gate — requirement→test coverage scan, hollow-test detection, net-new assertion check, nyquist-auditor blocking spawn
- [ ] 46-04: Delete /gsd:validate-phase (post-grep) + integration tests for all three gates

#### Phase 47: Telegram Escalation Reliability

**Goal:** The escalation channel every other autonomy feature routes through is reliable for unattended runs — daemon death is detected instead of silently hanging, state files can't corrupt, delivery failures are detected and retried, and a blocking question that goes unanswered overnight resolves to a defined fallback instead of hanging the run
**Depends on:** Phase 45 (timeout fallback writes DEFERRED.json entries), Phase 44
**Requirements:** MILE-21
**Success Criteria** (what must be TRUE):
  1. The adapter detects daemon death/unavailability promptly and surfaces a typed error to the calling agent instead of hanging ~45s in a silent reconnect loop; the daemon/adapter double-timer race is resolved to exactly one owner of the question timeout, and daemon crash during a pending question fails the question deterministically
  2. JSONL question/session state writes use real file locking (the vendored `proper-lockfile`) or atomic write-rename — no concurrent-daemon corruption; notification delivery failure is detected, logged loudly, and retried with bounded backoff, never silently dropped
  3. A blocking question that reaches its timeout during autonomous execution resolves to a configurable fallback (default: DEFERRED.json entry with `approver: "timeout-fallback"`, blocked item parked, run continues with non-dependent work); daemon-down-at-escalation-time logs the failure, applies the same fallback, and the escalation failure appears in the milestone audit
  4. Integration tests cover: daemon down → prompt typed error, not 45s hang; question timeout → fallback fires + DEFERRED entry written; concurrent state writes → no corruption; delivery failure → logged + retried, run continues
**Plans:** 3/3 plans complete

Plans:
- [ ] 47-01: Daemon-crash detection + double-timer race fix (single timeout owner, deterministic failure on crash during pending question)
- [ ] 47-02: JSONL state locking (proper-lockfile or atomic rename) + delivery-failure detection, loud logging, bounded-backoff retry
- [ ] 47-03: Overnight blocking-question timeout fallback (DEFERRED.json + park + continue) + integration tests

#### Phase 48: Satellite Injections — Mining, Discovery, Debugger

**Goal:** The three remaining satellite capabilities are reachable from the golden path automatically — conversation mining runs at milestone completion, deep discovery fires inside `/gsd:prd` when confidence stays low, and repeated execution failures auto-spawn the debugger (routing any remaining escalation through the now-reliable Telegram channel) — so nothing valuable depends on someone remembering to run a standalone command
**Depends on:** Phase 47 (debugger escalation path), Phase 46
**Requirements:** MILE-11, MILE-12, MILE-13
**Success Criteria** (what must be TRUE):
  1. `complete-milestone.md` gains a mining step (after archival, gated by `auto_mine: true` default) that mines the milestone's session date range into the knowledge DB, writes metadata to `.planning/milestones/v{X}-KNOWLEDGE.md`, is verified deduped against session-end extraction, and is non-blocking on failure (logged, milestone still completes)
  2. `prd.md` Stages 1d/2d auto-spawn 4–6 parallel `gsd-product-investigator` agents (Haiku, capped fan-out) when confidence < ~0.50 with unresolved gaps after max Q&A rounds; `gsd-discovery-synthesizer` merges findings and updates confidence; confidence ≥ ~0.65 stays dormant; `workflows/discover.md`, `discovery-phase.md`, and `skills/gsd-discover/` are deleted once this lands
  3. A retry counter per plan/phase lives in `.planning/execution-state.json`; 1st failure auto-retries with no user prompt; 2nd failure of the same task/phase auto-spawns `gsd-debugger` with context (error, last completed step, files modified); post-debugger Telegram escalation includes the debugger's findings; hard stop at a configurable max-attempts ceiling (default 4); `workflows/debug.md` is rebuilt slim around the existing `gsd-debugger` agent, fixing the broken `/gsd:debug` command
  4. Integration tests cover: `auto_mine: true` + sessions → mined; `auto_mine: false` → skipped; mining throws → milestone still completes; low confidence + gaps → investigators spawn capped at 6; high confidence → no spawn; investigator failure → standard unresolved-gap handling, no hard block; failure at threshold → debugger spawned; below threshold → standard path; at max-attempts ceiling → hard stop with escalation, not another debug attempt
**Plans:** 4/4 plans complete

Plans:
- [ ] 48-01: Mining injection into complete-milestone — auto_mine config gate, session date-range scan, dedup verification, v{X}-KNOWLEDGE.md metadata, non-blocking failure
- [ ] 48-02: Discovery injection into prd.md — confidence-gated investigator fan-out (4-6 Haiku, capped), synthesizer merge, delete discover.md/discovery-phase.md/gsd-discover (post-grep)
- [ ] 48-03: Debugger injection — execution-state.json retry counter, auto-retry then 2nd-failure debugger spawn, findings-attached escalation, max-attempts ceiling, slim workflows/debug.md rebuild
- [ ] 48-04: Integration tests — mining gate cases, discovery spawn/dormant/failure cases, retry-threshold matrix

#### Phase 49: Knowledge Auto-Wiring & CLI Cleanup

**Goal:** The knowledge system operates fully automatically on its natural triggers — every write passes a safety gate with secrets/PII filtering, lifecycle/feedback/checkpoint fire on their events, consolidation runs once per milestone — and the manual CLI surface those triggers make redundant is deleted
**Depends on:** Phase 44 (parallel-eligible with Phases 45-48)
**Requirements:** MILE-14, MILE-15, MILE-16, MILE-17
**Success Criteria** (what must be TRUE):
  1. `knowledge-safety.js` is wired into `knowledge-writer.storeInsights` as a pre-write guard; a config-extensible secrets/PII regex filter (API-key-like tokens, emails, credential keywords; rejection preferred over redaction when ambiguous) runs on every write — matching content is never persisted verbatim, clean content passes unchanged; the `storeInsights` transaction race is fixed; `knowledge-cost.js`'s circuit breaker is checked before extraction/embedding batches with the existing configured budget
  2. `pruneStaleEntries` + `checkpointWAL` run automatically at the session-end hook and at `complete-milestone`; `markPrincipleWrong` auto-triggers when the verifier or executor finds a KB-sourced answer contradicted by execution outcome (entry confidence auto-degraded); `knowledge-checkpoint.js` auto-checkpoints before bulk operations
  3. `complete-milestone.md` gains a knowledge-consolidation step (clustering → principle synthesis with a real Haiku call replacing the "first 10 words" stub → conflict detection) that runs once per milestone, never before every agent action; a thin manual backstop command exposes the same code path on demand; insufficient clusters force no principle
  4. `knowledge-qa.js`, `knowledge-scan.js`, and the `knowledge-permissions.js` grant/revoke CLI surface are deleted after a fresh zero-reference grep across bin/, workflows/, agents/, scripts/, hooks/, commands/, references/, templates/; gsd-tools.js command dispatch no longer references them
  5. Integration tests cover: secret pattern → redacted/rejected; clean content → unchanged; budget exceeded → circuit breaker blocks + logs; concurrent writes → no lost update; session-end → prune runs; verification failure tied to KB answer → feedback recorded; bulk op → checkpoint first; sufficient cluster → principle with LLM-generated text; insufficient cluster → none; conflicting principles → flagged, not silently overwritten
**Plans:** 4/4 plans complete

Plans:
- [x] 49-01: Write-path safety — knowledge-safety wiring into storeInsights, config-extensible secrets/PII regex filter, transaction race fix, cost circuit-breaker pre-check
- [x] 49-02: Event triggers — lifecycle prune/checkpointWAL at session-end + complete-milestone, verifier/executor feedback auto-trigger, pre-bulk-op checkpoint
- [x] 49-03: Milestone consolidation pass — clustering, real Haiku principle synthesis (cost-capped), conflict detection, thin manual backstop command
- [x] 49-04: Knowledge CLI deletions (qa/scan/permissions grant-revoke, post-grep) + integration tests

#### Phase 50: Final Deletions, Hook Fixes & Verification Sweep (EXTENDED)

**Goal:** The standalone entry points obsoleted by this milestone's replacements are removed now that those replacements are confirmed working, the dead/broken Claude Code hooks are fixed or removed, and a final zero-reference sweep proves the framework carries no dangling references to anything deleted across the milestone
**Depends on:** Phases 44, 48, 49 (all replacements landed and verified)
**Requirements:** MILE-19, MILE-22
**Success Criteria** (what must be TRUE):
  1. The standalone `research-phase` command entry is removed only after the existing `plan-phase` research step is confirmed as its working replacement
  2. `scripts/install-modules.js` and `scripts/health-check.js` are updated to stop validating the stubs deleted in Phase 44
  3. A fresh grep across `bin/`, `workflows/`, `agents/`, `scripts/`, `hooks/`, `commands/`, `references/`, `templates/` for every file/command deleted across Phases 44-49 returns zero references — verified in the same session as the final deletions
  4. The doc-compression hook actually fires: installer deploys `hook-config.json` to the guard path, the hook reads `tool_name`/`tool_input` (not `tool`/`parameters`), its `require()`s are try/caught fail-open, and a real Read produces a non-empty compression-metrics JSONL with a measured reduction percentage (hooks analysis R-1)
  5. Orphaned `per-turn.js` is deleted (fresh zero-reference grep) and the Stop hook registration in `install.js` is timeout-wrapped like the PreToolUse hooks (R-2, R-3)
**Plans:** 2/2 plans executed

Plans:
- [x] 50-01: Remove standalone research-phase entry (replacement-confirmed), update install-modules.js/health-check.js, run final cross-milestone zero-reference grep sweep
- [x] 50-02: Doc-compression hook triple-fix (installer hook-config.json deploy, protocol field names, guarded requires) + measure real reduction; delete per-turn.js; timeout-wrap Stop hook registration

#### Phase 51: Run Resilience — Auto-Resume & State Sanity

**Goal:** An overnight run survives coordinator deaths without human forensics — provider-limit deaths auto-resume from checkpoints, quota readings can't silently poison routing, and the state helpers work against the real STATE.md
**Depends on:** Phase 50. Evidence: three live coordinator deaths this run (2026-07-02/04/05), each recovered by manual orchestrator forensics; corrupted quota readings (28625%, 59196%) in phases 44/49; STATE.md schema mismatch deferred since 44-01.
**Requirements:** MILE-23, MILE-24
**Success Criteria** (what must be TRUE):
  1. In a test harness, a coordinator killed mid-phase is detected (staleness heartbeat: no CHECKPOINT.json/transcript write for N minutes, OR a session/quota-limit death signature) and `execute-roadmap` auto-spawns a successor from the phase's `resume_from` with no human input; when the death message carries a reset time, the orchestrator waits until then
  2. Before a run, execute-roadmap estimates cost (phases × observed avg tokens) against remaining budget and surfaces a deliberate pause point rather than dying mid-phase
  3. A corrupted quota-tracker percentage is detected, reset, and logged loudly; routing falls back to the genuine tier, never a poisoned reading
  4. `gsd-tools.js state advance-plan`/`update-progress` operate correctly against the repo's actual STATE.md format (schema migrated or commands made tolerant) — no more manual state edits
  5. Integration tests cover: killed-coordinator → successor spawned from checkpoint; reset-time death → wait; corrupted quota → reset+log; state advance-plan round-trip on real STATE.md
**Plans:** 3/3 plans complete

Plans:
- [ ] 51-01: Quota corruption self-heal (loadQuotaState) + corruption-log.jsonl audit trail, and tolerant STATE.md field parsing for state advance-plan/update-progress against the real plain-prose format
- [ ] 51-02: Deterministic auto-resume helpers (parseDeathSignature, parseResetTime, checkStaleness, parseCheckpointForResume, buildResumeBrief, estimateQuotaForRemainingPhases) + resilience CLI namespace
- [ ] 51-03: Wire execute-roadmap.md prose (pre-flight quota estimate + death-detection/auto-respawn/wait-until-reset), verified via grep-assertion tests

#### Phase 52: Skew Detection, Telemetry & Model Registry

**Goal:** The framework can tell when it's stale, agents report their own failure modes, model knowledge lives in one place, and state-mutating workflow steps are crash-safe
**Depends on:** Phase 51 (self-report rides the same return-contract changes auto-resume touches)
**Requirements:** MILE-25, MILE-26, MILE-27, MILE-28
**Success Criteria** (what must be TRUE):
  1. `install` writes a content-hash manifest + source git SHA; a SessionStart/`gsd doctor` check compares installed vs repo and warns on drift; execute-roadmap pre-flight asserts freshness when run inside the GSD repo — reproduced against the exact skew this milestone hit repeatedly
  2. Coordinator/executor/verifier returns carry `{context_pressure, instructions_not_followed, ambiguities, tool_errors_swallowed}`, appended to a run JSONL and summarized in `analytics report`
  3. One config-sourced tier→model registry (with per-tier operating params) is consumed by gsd-circuit-breaker.js/gsd-escalation.js/analytics.js — no duplicated tier tables; a model upgrade touches one file. `verify test-content` countAssertions recognizes `assert.method(` style (Phase 48 finding)
  4. Golden-path state-mutating steps are enumerated and classified idempotent/resumable/neither; the "neither" cases are fixed; a quarterly upstream-review policy is documented and UPSTREAM-DIFF.md refreshed once
  5. Integration tests cover: skew manifest mismatch → warning; self-report fields present in returns + JSONL; registry single-source consumed by all three modules; countAssertions namespace style
**Plans:** 4/4 plans complete

Plans:
- [ ] 52-01-PLAN.md — Skew detection: install manifest source_git_sha, gsd-tools.js doctor command, SessionStart caching, additive execute-roadmap.md pre-flight (MILE-25)
- [ ] 52-02-PLAN.md — Self-report telemetry: coordinator/executor/verifier return-contract fields, gsd-tools.js telemetry append/summarize, analytics.js Self-Report Telemetry section (MILE-26)
- [ ] 52-03-PLAN.md — Model registry: config-sourced tier/threshold/escalation-ladder registry consumed by gsd-circuit-breaker.js/gsd-escalation.js/analytics.js with dedicated parity tests; countAssertions namespace-style fix (MILE-27)
- [ ] 52-04-PLAN.md — Crash-point audit: docs/CRASH-POINT-AUDIT.md across the 4 golden-path workflows, idempotency fixes for confirmed "neither" cases, UPSTREAM-DIFF.md quarterly review policy (MILE-28)

#### Phase 53: Eval Harness, Prompt Hygiene & Injection Hardening

**Goal:** Prompt and workflow changes become measurable, prompts fit in budget with hard rules up front, and file-derived content can't hijack agents
**Depends on:** Phase 52 (eval harness asserts on telemetry + skew-clean installs). Ordered last: largest, and every earlier phase's changes become its test corpus.
**Requirements:** MILE-29, MILE-30, MILE-31
**Success Criteria** (what must be TRUE):
  1. A golden mini-project fixture repo + eval runner executes plan→execute→verify with cheap models and asserts on artifacts (right agents spawned, gates fired, DEFERRED.json written on skip, commits atomic); runnable locally and wired into CI on prompt-file changes
  2. A CI check enforces per-agent token budgets (coordinator ≤8k core); the 5 oversized agents (coordinator 17.5k, planner 14.5k, verifier 12.4k, debugger 9.4k, executor 9.2k) are restructured hard-rules-first with on-demand references; the eval harness confirms behavior is preserved
  3. Agent prompts frame file-derived content as data-not-instructions; the knowledge write path screens injection patterns (composing with the MILE-14 secrets filter); an adversarial fixture in the eval harness that tries to derail the executor is caught
  4. Integration tests / eval scenarios cover: a known-good roadmap passes the harness; a prompt edit that drops a mandatory gate is caught by the harness; an over-budget agent fails the CI budget check; the adversarial fixture does not derail the executor
**Plans:** 3/3 plans complete
Plans:
- [ ] 53-01-PLAN.md — Behavioral eval harness: golden fixture project, pure assertion functions, eval CLI, CI wiring (MILE-29)
- [ ] 53-02-PLAN.md — Prompt budgets: budget-check script + hard-rules-first restructure of the 5 oversized agents, verified via the eval harness (MILE-30)
- [ ] 53-03-PLAN.md — Injection hardening: content-firewall convention, knowledge-write injection screening, adversarial eval fixture (MILE-31)

### 🚧 v1.15.0 Self-Improving Quality Loop (Phases 54-61)

**Milestone Goal:** Close every feedback loop v1.14.0 left open — failures become regression evals, eval results drive human-approved prompt optimization, routing learns from recorded outcomes, and the quality agents that were designed but never spawned get wired into the golden path.

**Source PRD:** `.planning/prds/pending/self-improving-quality-loop.md` (US-1..US-10, all in MVP boundary; promoted to `done/` at roadmap creation)

**Dependency note:** Phase 54 (structured handoffs + invariant re-injection) lands first — it touches the coordinator/executor/verifier return-contract plumbing that Phases 55-61 all build on top of. 55 (failures-to-regression) precedes 56 (prompt optimization needs eval failures as its input signal) and 59 (test-writer/integration-tester wiring feeds gaps_found into the same fixture pipeline). 57 (routing ledger + escalation) precedes 58 (honest token accounting reads the same per-task execution records). 60 (adversarial plan review) only needs the Phase 54 handoff/invariant plumbing. 61 (pre-PR gate) is last — it is the final quality gate and depends on the full milestone's surface area existing to self-host meaningfully.

**Scope notes:** No new UI in this milestone — all work is CLI/prompt/workflow-layer (no Charlotte QA or E2E-regression phase required). Every phase carries its own integration-test success criterion per house convention. Prompt revisions remain human-approved in MVP (US-2); auto-applied revisions are deferred. Judge-panel calibration against human corrections is deferred.

#### Phase 54: Structured Handoffs & Invariant Re-Injection

**Goal:** Long runs stay on-constraint across agent boundaries and resumes
**Depends on:** Nothing (first phase of milestone)
**Requirements:** MILE-40
**Success Criteria** (what must be TRUE):
  1. A fixed handoff brief structure (phase goal, key decisions, open risks, file map, hard rules) is defined once in references and used at coordinator→executor and executor→verifier boundaries
  2. On checkpoint resume, hard rules and phase invariants are re-read verbatim from source files — never from summaries — and an eval assertion proves the resume path includes them
  3. Prompt budgets still pass for all agents modified to carry the handoff brief
  4. Integration tests cover: handoff brief presence assertions on a golden fixture, resume-path invariant re-injection assertion, budget check on modified agents
**Plans:** 4/4 plans complete

Plans:
- [ ] 54-01: TBD (planned during plan-phase)

#### Phase 55: Failures-to-Regression Pipeline

**Goal:** Every failure becomes a permanent regression eval
**Depends on:** Phase 54
**Requirements:** MILE-32
**Success Criteria** (what must be TRUE):
  1. Completing a gsd-debugger session with a confirmed root cause writes a candidate eval fixture (input, expected assertion) to a review queue directory; a debugger session aborted without root cause writes nothing
  2. A phase-verification failure (`gaps_found`) writes a candidate fixture describing the gap
  3. An accepted candidate becomes a permanent eval case executed by the existing eval harness in CI; a rejected candidate is archived, not silently deleted
  4. Integration tests cover: candidate generation from a seeded debug session, review-queue accept/reject transitions, CI pickup of an accepted fixture, malformed candidate file handled loudly
**Plans:** 1/3 plans executed

Plans:
- [ ] 55-01: TBD (planned during plan-phase)

#### Phase 56: Reflective Prompt Optimization

**Goal:** Evidence-based, human-approved prompt-revision diffs
**Depends on:** Phase 55
**Requirements:** MILE-33
**Success Criteria** (what must be TRUE):
  1. A prompt-optimize run for a target agent reads that agent's eval failures and telemetry entries and produces a natural-language diagnosis plus a candidate prompt revision as a diff
  2. The candidate is auto-rejected if it exceeds the agent's prompt budget or fails any existing eval assertion; the command never auto-applies a revision — output is always a diff for human approval
  3. Optimization is per-agent (one target agent per run), never whole-pipeline; a run with no eval failures and no telemetry for the target agent reports "no signal" and exits cleanly
  4. Integration tests cover: diagnosis generation from seeded failures, budget-violation rejection, eval-failure rejection, the no-signal path, diff format validity
**Plans:** TBD

Plans:
- [ ] 56-01: TBD (planned during plan-phase)

#### Phase 57: Outcome-Informed Routing Ledger & Bounded Escalation

**Goal:** Routing learns from outcomes; failures self-heal across tiers
**Depends on:** Phase 54
**Requirements:** MILE-34, MILE-35
**Success Criteria** (what must be TRUE):
  1. A routing ledger is built from EXECUTION_LOG.md routing decisions plus telemetry outcomes, persisted per-project; the task router demonstrably reads the ledger and adjusts tier assignment when historical evidence contradicts the heuristic
  2. Ledger absence or corruption degrades gracefully to heuristic-only routing (fail-open, loud warning); a ledger with fewer than a minimum sample count for a task type is ignored for that type
  3. A haiku-tier task failure signaled by the executor triggers a sonnet retry, sonnet failure triggers opus, opus failure escalates to the existing failure-handling path — escalation is bounded (one retry per tier) and recorded in the execution log and routing ledger; failures that are not tier-capability-related (missing file, environment error) never trigger tier escalation
  4. Integration tests cover: ledger build from seeded logs, router consultation changing a tier decision, corrupt-ledger fail-open, minimum-sample threshold, haiku→sonnet→opus chain, bound enforcement, non-capability failure exclusion, ledger recording of escalation outcome
**Plans:** TBD

Plans:
- [ ] 57-01: TBD (planned during plan-phase)

#### Phase 58: Honest Token Accounting

**Goal:** Savings claims verifiable from real recorded usage
**Depends on:** Phase 57
**Requirements:** MILE-36
**Success Criteria** (what must be TRUE):
  1. Actual token usage per task is recorded during execution into a durable per-project record
  2. The savings report computes savings from recorded usage against the configured profile baseline, and explicitly states when no recorded data exists instead of inventing numbers
  3. Partial data (some tasks recorded, some not) is reported with an explicit coverage percentage
  4. Integration tests cover: usage recording during a seeded run, report computation from recorded data, the empty-data honesty path, partial-coverage reporting
**Plans:** TBD

Plans:
- [ ] 58-01: TBD (planned during plan-phase)

#### Phase 59: Dormant Quality Agents Wired In

**Goal:** Test-writer + integration-tester join the golden path
**Depends on:** Phase 55
**Requirements:** MILE-37, MILE-38
**Success Criteria** (what must be TRUE):
  1. With the toggle enabled, the executor spawns gsd-test-writer after each implementation task that touches source code; the eval harness asserts the spawn occurred on the golden fixture. With the toggle disabled (default preserves current behavior), no spawn occurs and existing flows are unchanged; test-writer output failing to materialize (no test file written) is a loud executor deviation, not a silent skip
  2. With the toggle enabled, the coordinator spawns gsd-integration-tester at phase completion when the phase declares dependencies on prior phases; eval harness asserts the spawn on a dependent-phase fixture. Phases with no dependencies never spawn it
  3. Integration-tester `gaps_found` feeds the existing verification failure path (and thus Phase 55's fixture generation)
  4. Integration tests cover: spawn-on-implementation assertion, toggle-off no-op, missing-output deviation path, dependent-phase spawn assertion, independent-phase no-spawn, gaps_found propagation
**Plans:** TBD

Plans:
- [ ] 59-01: TBD (planned during plan-phase)

#### Phase 60: Adversarial Plan Review

**Goal:** High-risk plans get attacker/defender/judge review
**Depends on:** Phase 54
**Requirements:** MILE-39
**Success Criteria** (what must be TRUE):
  1. Plans marked high-risk (config criteria or explicit flag) are reviewed by attacker (finds flaws), defender (rebuts from plan evidence), and judge (rules) instead of a single-pass plan-checker
  2. The judge verdict is a durable artifact attached to the plan, and presentation order of attack/defense is randomized
  3. A judge ruling of critical flaws routes into the existing plan-revision loop; non-high-risk plans keep the existing single plan-checker path unchanged
  4. Integration tests cover: trio spawn on a high-risk fixture, verdict artifact written, revision-loop routing on a critical verdict, single-checker path preserved otherwise
**Plans:** TBD

Plans:
- [ ] 60-01: TBD (planned during plan-phase)

#### Phase 61: Project-Aware Pre-PR Gate

**Goal:** Pre-PR gate self-hosts on GSD and any project type
**Depends on:** Phases 54-60
**Requirements:** MILE-41
**Success Criteria** (what must be TRUE):
  1. The pre-PR gate detects project type and command set from the project's own manifest files and runs those checks
  2. The gate passes on the GSD repo itself (self-hosting proof)
  3. Unknown project types degrade to a minimal universal check set with a loud notice, never a crash
  4. Integration tests cover: detection across at least two project types, GSD self-run pass, unknown-type degradation
**Plans:** TBD

Plans:
- [ ] 61-01: TBD (planned during plan-phase)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Auto Mode Foundation | v1.9.0 | 9/9 | Complete | 2026-02-16 |
| 2. Auto Mode Refinement | v1.9.0 | 6/6 | Complete | 2026-02-16 |
| 3. Knowledge System Foundation | v1.9.0 | 5/5 | Complete | 2026-02-16 |
| 4. Knowledge Extraction & Hooks | v1.9.0 | 6/6 | Complete | 2026-02-16 |
| 5. Knowledge Permissions & Safety | v1.9.0 | 6/6 | Complete | 2026-02-16 |
| 6. Autonomous Execution Core | v1.9.0 | 6/6 | Complete | 2026-02-16 |
| 7. Autonomous Execution Optimization | v1.9.0 | 6/6 | Complete | 2026-02-16 |
| 8. Notifications & Observability | v1.9.0 | 8/8 | Complete | 2026-02-16 |
| 8.1. Telegram MCP Server | v1.9.0 | 6/6 | Complete | 2026-02-16 |
| 9. Doc Compression Hooks | v1.9.0 | 5/5 | Complete | 2026-02-17 |
| 10. GSD Installation System | v1.9.0 | 4/4 | Complete | 2026-02-17 |
| 10.1. Multi-Instance MCP Safety | v1.9.0 | 4/4 | Complete | 2026-02-17 |
| 11. Session-End Knowledge Extraction | v1.9.0 | 4/4 | Complete | 2026-02-17 |
| 12. Historical Conversation Mining | v1.9.0 | 3/3 | Complete | 2026-02-18 |
| 13. Cross-Phase Integration Fixes | v1.9.0 | 1/1 | Complete | 2026-02-18 |
| 14. Telegram MCP Audit & Rework | v1.9.0 | 6/6 | Complete | 2026-02-18 |
| 18. Upstream Audit | v1.9.1 | 1/1 | Complete | 2026-02-19 |
| 19. Bug Fixes & Context Window Management | v1.9.1 | 2/2 | Complete | 2026-02-19 |
| 20. Git Branching & Autonomous Execution | v1.9.1 | 2/2 | Complete | 2026-02-19 |
| 21. Knowledge Global Migration | v1.10.0 | 3/3 | Complete | 2026-02-19 |
| 22. Discuss Step & Meta-Answerer | v1.10.0 | 4/4 | Complete | 2026-02-19 |
| 23. Telegram Escalation | v1.10.0 | 2/2 | Complete | 2026-02-19 |
| 24. Telegram Notifications | v1.10.0 | 4/4 | Complete | 2026-02-19 |
| 25. End-to-End Validation | v1.10.0 | 4/4 | Complete | 2026-02-19 |
| 26. Telegram MCP Reliability | v1.11.0 | 3/3 | Complete | 2026-02-20 |
| 27. Knowledge System Quality | v1.11.0 | 3/3 | Complete | 2026-02-20 |
| 28. Compression & Observability | v1.11.0 | 3/3 | Complete | 2026-02-20 |
| 29. Session Extraction Fix | v1.11.0 | 1/1 | Complete | 2026-02-20 |
| 30. Milestone Summary & Archival | v1.11.0 | 1/1 | Complete | 2026-02-20 |
| 31. Per-Task Model Routing | v1.11.0 | 3/3 | Complete | 2026-02-21 |
| 32. Reliability & Quality Gap Fixes | v1.11.0 | 4/4 | Complete | 2026-02-21 |
| 33. v1.10.0 Tech Debt Closure | v1.10.0 | 2/2 | Complete | 2026-02-21 |
| 34. Checkpoint & Plan-Structure Gates | v1.12.0 | 2/2 | Complete | 2026-03-10 |
| 35. Test & Coverage Enforcement | v1.12.0 | 3/3 | Complete | 2026-03-11 |
| 36. Migration Safety & Error Taxonomy | v1.12.0 | 2/2 | Complete | 2026-03-10 |
| 37. PRD Traceability & Flow Context | v1.12.0 | 2/2 | Complete | 2026-03-10 |
| 38. Dev Server Lifecycle & Knowledge Feedback | v1.12.0 | 2/2 | Complete | 2026-03-11 |
| 39. Execution Intelligence | v1.12.0 | 3/3 | Complete | 2026-03-11 |
| 40. Observability & Analytics | v1.12.0 | 2/2 | Complete | 2026-03-11 |
| 41. gsd:prd Workflow | v1.13.0 | 0/TBD | Not started | - |
| 42. Milestone PRD Integration | v1.13.0 | 0/TBD | Not started | - |
| 43. Docs Automation | v1.13.0 | 0/TBD | Not started | - |
| 44. Reliability Foundations & Dead-Code Cleanup | v1.14.0 | 5/5 | Complete | 2026-07-04 |
| 45. Deterministic Phase-Gate & Deferral Protocol | v1.14.0 | 5/5 | Complete | 2026-07-04 |
| 46. Artifact-Generation & Coverage Gates | v1.14.0 | 4/4 | Complete | 2026-07-04 |
| 47. Telegram Escalation Reliability | v1.14.0 | 3/3 | Complete | 2026-07-04 |
| 48. Satellite Injections: Mining, Discovery, Debugger | v1.14.0 | 4/4 | Complete | 2026-07-04 |
| 49. Knowledge Auto-Wiring & CLI Cleanup | v1.14.0 | 4/4 | Complete | 2026-07-05 |
| 50. Final Deletions, Hook Fixes & Verification Sweep | v1.14.0 | 2/2 | Complete | 2026-07-05 |
| 51. Run Resilience — Auto-Resume & State Sanity | v1.14.0 | 3/3 | Complete | 2026-07-05 |
| 52. Skew Detection, Telemetry & Model Registry | v1.14.0 | 4/4 | Complete | 2026-07-05 |
| 53. Eval Harness, Prompt Hygiene & Injection Hardening | v1.14.0 | 3/3 | Complete | 2026-07-05 |
| 54. Structured Handoffs & Invariant Re-Injection | 4/4 | Complete   | 2026-07-06 | - |
| 55. Failures-to-Regression Pipeline | 1/3 | In Progress|  | - |
| 56. Reflective Prompt Optimization | v1.15.0 | 0/TBD | Not started | - |
| 57. Outcome-Informed Routing Ledger & Bounded Escalation | v1.15.0 | 0/TBD | Not started | - |
| 58. Honest Token Accounting | v1.15.0 | 0/TBD | Not started | - |
| 59. Dormant Quality Agents Wired In | v1.15.0 | 0/TBD | Not started | - |
| 60. Adversarial Plan Review | v1.15.0 | 0/TBD | Not started | - |
| 61. Project-Aware Pre-PR Gate | v1.15.0 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-15 | Last updated: 2026-07-06 — v1.15.0 Self-Improving Quality Loop roadmap created: phases 54-61 (MILE-32..41 from self-improving-quality-loop PRD)*
