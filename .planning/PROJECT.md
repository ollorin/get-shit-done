# GSD Enhancements

## What This Is

A fork of the Get Shit Done framework (glittercowboy/get-shit-done) with major enhancements: intelligent auto model selection, autonomous roadmap execution with autonomous pre-planning, a local vector knowledge system with global cross-project scope, and a production-ready Telegram MCP with forum topics and blocking escalation. Built for developers who want maximum efficiency from AI-assisted development while maintaining control over critical decisions. v1.10.0 shipped 2026-02-21.

## Current State

**Shipped:** v1.15.0 — Self-Improving Quality Loop (2026-07-06). 8 phases (54-61), 27 plans, all verified + deployed; tests 514 → 905. Built autonomously via new-milestone → execute-roadmap in a single ~17.6-hour run.

Every feedback loop the framework produces now closes itself: failures (debugger root-causes + verification gaps) become permanent CI regression evals; eval failures + telemetry drive diagnosed, budget-and-eval-gated prompt-revision diffs (human-approved, never auto-applied); the task-router consults a real outcome ledger and bounded-escalates failing tasks up the tier ladder; token savings are reported from actually-recorded usage instead of theoretical baselines; gsd-test-writer and gsd-integration-tester — designed in earlier milestones but never spawned — are now wired into the golden path (toggleable); high-risk plans get adversarial attacker/defender/judge review; structured handoff briefs and verbatim invariant re-injection keep long runs on-constraint across agent boundaries and resumes; and the pre-PR gate is project-aware, self-hosting on GSD's own repo.

## Current Milestone: Planning next

No active milestone. Run `/gsd:new-milestone` to start the next cycle (questioning → research → requirements → roadmap).

**Still-open candidates for later:** reconcile v1.13.0 (phases 41-43 completed on disk but never formally verified/archived through this workflow — still unreconciled after two milestone closures); gsd-tools.js module split + coverage raise; knowledge-system file consolidation (19 → ~6 files); Charlotte QA 3-mode (ui-qa/ux-audit/e2e) end-to-end wiring; cross-process file locking for STATE.md/ROADMAP.md/config.json; auto-applied prompt revisions (currently human-approved by deliberate MVP boundary); judge-panel calibration against human corrections; Windows path handling.

<details>
<summary>v1.15.0 milestone goal & target features (shipped)</summary>

**Goal:** Close every feedback loop v1.14.0 left open — failures become regression evals, eval results drive human-approved prompt optimization, routing learns from recorded outcomes, and the quality agents that were designed but never spawned get wired into the golden path.

**Delivered:** failures-to-regression pipeline (debugger + verification → CI eval cases); reflective prompt optimization (per-agent diagnosis → human-approved diff, budget/eval-gated); outcome-informed routing ledger + bounded haiku→sonnet→opus escalation; honest token accounting from recorded usage; gsd-test-writer/gsd-integration-tester wired into the golden path (toggleable); adversarial attacker/defender/judge review for high-risk plans; structured handoff briefs + verbatim invariant re-injection; project-aware pre-PR gate self-hosting on GSD. Full details: `.planning/milestones/v1.15.0-ROADMAP.md`.
</details>

<details>
<summary>v1.14.0 milestone goal & target features (shipped)</summary>

**Goal:** Make every mandatory GSD step deterministic and automatic — enforcement gates replace prose "MUST" language, satellite capabilities inject into the golden path, knowledge maintenance runs automatically, and the escalation channel is hardened for unattended runs.

**Delivered:** deterministic phase-gate + DEFERRED.json; satellite injections (mining/Nyquist/discovery/debugger); knowledge auto-wiring incl. secrets/PII filter; Telegram overnight fallback; run self-resilience (auto-resume, quota self-heal); observability (skew doctor, telemetry, model registry, eval harness, prompt budgets, injection hardening); reliability quick-wins + CI; doc-compression hook resurrected. Full details: `.planning/milestones/v1.14.0-ROADMAP.md`.
</details>

## Core Value

Claude learns to make autonomous decisions based on the user's reasoning patterns, only stopping for actions that are irreversible, external, or cost money — dramatically reducing interaction overhead while preserving safety.

## Requirements

### Validated

- ✓ Existing GSD codebase mapped (`.planning/codebase/`) — v1.9.0
- ✓ Three-tier model profiles work (quality/balanced/budget) — v1.9.0
- ✓ Phase-based roadmap execution via manual commands — v1.9.0
- ✓ Complexity detection algorithm (keywords + length + structural → 0-100 score → tier) — v1.9.0
- ✓ Default to Sonnet when complexity unclear — v1.9.0
- ✓ Sonnet validates Haiku output for quality assurance — v1.9.0
- ✓ `/gsd:set-profile auto` as new profile option — v1.9.0
- ✓ Token/cost tracking for savings measurement — v1.9.0
- ✓ Quota awareness: track session/weekly limits, adjust model usage accordingly — v1.9.0
- ✓ Circuit breakers: iteration caps (15-20), timeouts, error escalation — v1.9.0
- ✓ Feedback loop: user marks wrong model choices, system learns — v1.9.0
- ✓ `/gsd:execute-roadmap` command with Opus coordinator — v1.9.0
- ✓ Sub-coordinator handles full cycle: research → plan → execute → verify — v1.9.0
- ✓ Fresh context per phase (no context rot) — v1.9.0
- ✓ EXECUTION_LOG.md for real-time progress tracking — v1.9.0
- ✓ Failure handling with retry/skip/escalate options — v1.9.0
- ✓ Parallel phase execution where dependency graph allows — v1.9.0
- ✓ Local vector database (SQLite + sqlite-vec, git-friendly) — v1.9.0
- ✓ Dual scope: global (`~/.claude/knowledge/`) + project (`.planning/knowledge/`) — v1.9.0
- ✓ Session-end knowledge extraction via Haiku Task() subagents — v1.9.0
- ✓ Historical conversation mining reusing session extraction pipeline — v1.9.0
- ✓ Safety model: stop-and-ask for irreversible/external/costly actions — v1.9.0
- ✓ Explicit permission tracking with cost thresholds — v1.9.0
- ✓ Hooks integration: configurable timing (per-turn vs session-end) — v1.9.0
- ✓ Telegram MCP daemon+adapter: forum threads, multi-session, voice transcription — v1.9.0
- ✓ One-command installation with npm workspaces and health check — v1.9.0
- ✓ Doc compression hooks (60-70% token reduction via PreToolUse) — v1.9.0
- ✓ Multi-instance MCP safety: per-session JSONL and file locking — v1.9.0
- ✓ Upstream commits audited — selective porting approach, requirements verification loop ported — v1.9.1
- ✓ Git branching at phase start (branching_strategy=phase, findPhaseInternal bug fixed) — v1.9.1
- ✓ Phase coordinator auto-routing verified intact after upstream sync — v1.9.1
- ✓ Knowledge DB migrated to `~/.claude/knowledge/` shared across all projects with project tagging — v1.10.0
- ✓ Conversation miner scans all projects feeding one unified global DB — v1.10.0
- ✓ `query-knowledge` gsd-tools command returns past decisions with confidence scores — v1.10.0
- ✓ Phase coordinator runs autonomous discuss step (gray-area → 10-20 Q&A per area) before research — v1.10.0
- ✓ `gsd-meta-answerer` agent answers questions from global KB, flags uncertain ones — v1.10.0
- ✓ CONTEXT.md written from autonomous answers before research begins in execute-roadmap — v1.10.0
- ✓ Telegram escalation: sensitive questions via `ask_blocking_question`, execution blocks until answered — v1.10.0
- ✓ Telegram forum topic per milestone: `create_topic` tool, thread_id stored in EXECUTION_LOG.md — v1.10.0
- ✓ Phase lifecycle notifications posted to milestone topic (start, context, research, plans, complete, failure) — v1.10.0
- ✓ End-to-end validation: full loop from phase start → autonomous Q&A → Telegram reply → CONTEXT.md — v1.10.0
- ✓ Telegram MCP reliability: EventEmitter fix, daemon restart persistence, timeout notifications — v1.11.0
- ✓ Knowledge quality: embedding dedup, meta-answerer multi-pass fallback, DB pruning — v1.11.0
- ✓ Compression observability: metrics JSONL, token estimates, semantic paragraph scoring — v1.11.0
- ✓ Session-end Stop hook (replaces broken SIGTERM approach) — v1.11.0
- ✓ Milestone summarize & archive-phases commands — v1.11.0
- ✓ Debugger sessions and verification failures auto-generate candidate eval fixtures; accepted candidates run permanently in CI (MILE-32) — v1.15.0
- ✓ Prompt-optimize command produces diagnosed, budget-compliant, eval-gated revision diffs, human-approved per-agent (MILE-33) — v1.15.0
- ✓ Task-router consults a historical per-tier outcome ledger; failed cheap-tier tasks escalate bounded haiku→sonnet→opus (MILE-34/35) — v1.15.0
- ✓ Actual token usage recorded per task; savings reported from real data with explicit coverage (MILE-36) — v1.15.0
- ✓ gsd-test-writer spawned after implementation tasks and gsd-integration-tester on dependent phases, config-toggleable and eval-asserted (MILE-37/38) — v1.15.0
- ✓ High-risk plans reviewed by attacker/defender/judge trio with durable verdict artifact (MILE-39) — v1.15.0
- ✓ Fixed handoff briefs at agent boundaries; invariants re-injected verbatim after checkpoint resume (MILE-40) — v1.15.0
- ✓ `gate pre-pr` detects project type from manifests and passes on GSD itself (MILE-41) — v1.15.0

### Active

(None yet — requirements for the next milestone are defined via `/gsd:new-milestone`.)

**Note:** v1.13.0 (phases 41-43) was defined 2026-03-11 but never formally executed; its scope (gsd:prd, new-milestone PRD integration, docs-updater) is present in the codebase today. This has now carried across two milestone closures (v1.14.0 and v1.15.0) without being reconciled. Reconcile/audit v1.13 status separately before it goes stale further — do not double-build.

**Deferred:**
- [ ] Savings analytics vs actual profile baselines (not just all-Opus) — AUTO-10
- [ ] Synthesis passes: consolidate knowledge entries → higher-level principles
- [ ] Real 40-60% token savings verified against balanced profile (not theoretical)
- [ ] Notification flow live test with active Telegram forum topic (NOTIF-02–06 code verified, not live-tested)
- [ ] Auto-applied prompt revisions (human approval is a deliberate MVP boundary in v1.15.0, not a technical limitation)
- [ ] Judge-panel calibration against human corrections (needs a corpus of human rulings that doesn't exist yet)
- [ ] gsd-tools.js module split / knowledge-system consolidation (structural refactors orthogonal to feedback-loop closure)

### Out of Scope

- Cloud vector databases — must be local and git-trackable
- Real-time collaboration — separate files per user handles multi-dev
- Full session history persistence — only extracted knowledge/principles stored
- Breaking changes to existing `/gsd:` commands — all new features additive

## Context

### Current State (post-v1.15.0)

- `gsd-tools.js`: ~14,800 lines — routing (+ outcome ledger + bounded escalation), quota, knowledge (global + project-tagged, consolidation/synthesis), compression, installation, milestone management, eval harness, prompt-optimize, token-usage ledger, pre-pr-checks/gate
- `mcp-servers/telegram-mcp/`: Daemon+adapter TypeScript — IPC server, Telegraf bot, forum threads, whisper, `create_topic`, blocking escalation, question-state persistence
- `agents/`: 5 largest agents (coordinator/planner/verifier/debugger/executor) restructured hard-rules-first (v1.14.0) and now carry structured handoff briefs + verbatim invariant re-injection at boundaries (v1.15.0); gsd-plan-attacker/gsd-plan-defender/gsd-plan-judge trio added for high-risk plan review; gsd-test-writer/gsd-integration-tester wired into the golden path (config-toggleable)
- `get-shit-done/hooks/`: PreToolUse doc compression (metrics + token estimates + semantic scoring, ~90% measured reduction), SessionStart initialization, Stop hook for session-end extraction
- Knowledge DB at `~/.claude/knowledge/{user}.db` (global, all projects share); milestone-cadence consolidation now runs real cluster→principle synthesis (not stub text)
- Test suite: 905/905 passing (was 155 at start of v1.14.0, 514 at start of v1.15.0)
- **Known unresolved:** v1.13.0 (phases 41-43) built but never formally verified/archived through complete-milestone — carried across two subsequent milestone closures as-is in REQUIREMENTS.md history

### Tech Stack

Node.js (CommonJS gsd-tools.js + ESM modules), TypeScript (telegram-mcp), SQLite + sqlite-vec, better-sqlite3, Telegraf, Pino, Unix socket IPC (NDJSON), OpenTelemetry, @xenova/transformers (Nomic Embed), whisper-node

## Constraints

- **Git-friendly storage**: Knowledge DB single file per user — clean commits
- **Fallback behavior**: All features work without knowledge DB present
- **Token limits**: Session/weekly quota tracked; auto-downgrade at 80%/95%
- **Context window**: Fresh context per coordinator spawned phase
- **Multi-developer**: Separate DB files per OS username, no merge conflicts
- **Backward compatibility**: All existing `/gsd:` commands unchanged

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Sequence: Auto Mode → Knowledge → Autonomous → Integration | Auto mode enables autonomous roadmap; both enhance knowledge system | ✓ Good — phases flowed naturally |
| Sonnet as default when complexity unclear | Better to over-invest than under-invest in reasoning | ✓ Good — safe fallback |
| Separate DB files per user | Avoids merge conflicts, simpler than namespaced entries | ✓ Good — works cleanly |
| Session-end extraction (not per-turn) | Less noise; batch at session close captures full context | ✓ Good — lower overhead |
| Stop-and-ask for irreversible/external/costs | Clear safety boundary that enables trust in autonomous mode | ✓ Good — principle holds |
| Task() subagent pattern for all Haiku calls | Zero direct API calls in modules; coordinators handle invocation | ✓ Good — consistent pattern |
| Daemon+adapter Telegram MCP architecture | Thin stdio adapter proxies to long-running daemon via Unix socket | ✓ Good — multi-session clean |
| Lazy-load heavy dependencies (transformers.js, opossum, whisper) | Avoid startup crashes when deps unavailable | ✓ Good — resilient |
| Fail-open circuit breaker (errors → proceed:true) | Never block execution due to safety module failures | ✓ Good — preserves safety |
| Phase 14 replaced Phase 08.1 standalone bot entirely | Daemon architecture solved all multi-session and routing problems | ✓ Good — clean slate |
| Multi-signal 0-100 complexity scoring (keyword + length + structural) | Graduated scoring vs binary match, tier boundaries at 30/70 | ✓ Good — accurate routing |
| Global knowledge DB at `~/.claude/knowledge/` (not project-scoped) | Shared across all projects; project_slug field enables scoped queries | ✓ Good — enables cross-project learning |
| Sensitivity filter gates Telegram escalation (6 criteria) | Only truly sensitive questions escalate; non-sensitive go to Claude's Discretion | ✓ Good — reduced noise |
| Confidence threshold 0.7 fixed (not configurable) | Predictable behavior; bump rules handle edge cases | ✓ Good — simple and effective |
| `create_topic` returns threadId verbatim; null-guards all send_message calls | Forum topic creation is non-fatal; notifications gracefully degrade | ✓ Good — resilient to Telegram unavailability |
| Phase 25 validation ran with null telegram_topic_id | Deliberately decoupled discuss/escalation test from notification test | ✓ Good — tested each concern independently |
| `confidence: 0.7` float fallback (not string 'medium') | Type contract between query-knowledge and meta-answerer numeric scoring | ✓ Good — fixes silent failure on KB hits |
| Phase 54 (structured handoffs) ordered first in v1.15.0, foundation for 55/57/60 | Coordinator/executor/verifier return-contract plumbing every later phase builds on | ✓ Good — no rework needed downstream |
| Requirement IDs continue shared MILE- prefix (not new US- prefix) for v1.15.0 | MILE-32..41 map 1:1 to PRD US-1..US-10, consistent with v1.13.0/v1.14.0 numbering space | ✓ Good — single traceability table across milestones |
| Candidate eval fixtures live under `tests/eval-regressions/` (git-tracked), not `.planning/` (gitignored) | Accepted candidates must survive as permanent CI artifacts | ✓ Good — verified via dual CI wiring (npm test + eval-harness.yml) |
| Prompt-optimize never auto-applies a revision — always outputs a diff for human approval | Deliberate MVP safety boundary; auto-apply deferred to v2 | ✓ Good — verified: real-repo smoke test showed byte-identical git status before/after |
| Bounded escalation is one retry per tier (haiku→sonnet→opus), only for capability-related failures | Non-capability failures (missing file, env error) must never trigger a wasted tier escalation | ✓ Good — classifyFailure/decideEscalation enforce this with 15 non-capability patterns |
| Token usage recorded as `source:'estimated'` when the golden path doesn't pass explicit token counts | Honest accounting means never fabricating precision the system doesn't have | ✓ Good — savings report surfaces coverage percentage explicitly |
| gsd-test-writer/gsd-integration-tester spawns are config-toggleable, default off | Zero behavior change for existing projects unless explicitly opted in | ✓ Good — toggle-off path proven a no-op by regression tests |
| Adversarial trio (attacker/defender/judge) only engages for high-risk plans; presentation order randomized via content-hash (not `Math.random()`) | Reproducible fixtures for testing while still avoiding order bias in practice | ✓ Good — non-high-risk plans keep the unchanged single-checker path |
| Pre-PR gate derives checks from the project's own manifest files (package.json scripts etc.) rather than a hardcoded tool list | Must self-host on GSD and degrade gracefully on unknown project types | ✓ Good — self-hosting proof passed against the real repo root, 905/905 |

---
*Last updated: 2026-07-06 after v1.15.0 milestone (Self-Improving Quality Loop, 8 phases 54-61, 27 plans, 905/905 tests) — previously: 2026-07-06 v1.15.0 started; 2026-07-06 v1.14.0 shipped (PR #3); 2026-07-02 deep-dive audit in docs/analysis/*
