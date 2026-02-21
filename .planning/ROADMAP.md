# Roadmap: GSD Enhancements

## Milestones

- ✅ **v1.9.0 GSD Enhancements** — Phases 1-14 (shipped 2026-02-19)
- ✅ **v1.9.1 Upstream Sync** — Phases 18-20 (completed 2026-02-19)
- ✅ **v1.10.0 Autonomous Phase Discussion** — Phases 21-25, 33 (shipped 2026-02-21)
- ✅ **v1.11.0 System Hardening** — Phases 26-30 (completed 2026-02-20)
  - 26: Telegram MCP Reliability · 27: Knowledge Quality · 28: Compression Observability · 29: Session Fix · 30: Milestone Archival

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
| 32. Reliability & Quality Gap Fixes | TBD | 4/4 | Complete | 2026-02-21 |
| 33. v1.10.0 Tech Debt Closure | v1.10.0 | 2/2 | Complete | 2026-02-21 |

### Phase 31: Per-task model routing — executor becomes mini-orchestrator (Option A)

**Goal:** When model_profile is "auto", each task in a PLAN.md gets assigned an optimal model tier (haiku/sonnet/opus) by the planner's post-draft routing pass, and the coordinator spawns per-task executors at those tiers with lightweight runtime quota downgrade — making the executor a mini-orchestrator rather than a single-tier runner
**Depends on:** Phase 30
**Plans:** 3/3 plans complete

Plans:
- [x] 31-01-PLAN.md — Add routing pass to gsd-planner: post-draft tier tagging of task names when model_profile="auto"
- [ ] 31-02-PLAN.md — Update gsd-phase-coordinator: parse per-task tier tags, apply quota downgrade, spawn per-task executors, add routing stats to Telegram notification
- [ ] 31-03-PLAN.md — Update gsd-executor: haiku→sonnet escalation on retry, routing tier tracking in SUMMARY.md

### Phase 32: Reliability & Quality Gap Fixes

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

### Phase 33: v1.10.0 Tech Debt Closure

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

---
*Roadmap created: 2026-02-15 | Last updated: 2026-02-21 — v1.10.0 Autonomous Phase Discussion milestone archived*
