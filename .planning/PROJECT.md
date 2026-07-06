# GSD Enhancements

## What This Is

A fork of the Get Shit Done framework (glittercowboy/get-shit-done) with major enhancements: intelligent auto model selection, autonomous roadmap execution with autonomous pre-planning, a local vector knowledge system with global cross-project scope, and a production-ready Telegram MCP with forum topics and blocking escalation. Built for developers who want maximum efficiency from AI-assisted development while maintaining control over critical decisions. v1.10.0 shipped 2026-02-21.

## Current State

**Shipped:** v1.14.0 — Enforcement & Integration (2026-07-06, PR #3). 10 phases (44-53), 37 plans, all verified + deployed; tests 155 → 514. Built autonomously via prd → new-milestone → execute-roadmap.

The framework now enforces its own mandatory steps deterministically (git-diff-derived phase-gate + DEFERRED.json waivers), auto-invokes its previously-orphaned satellite capabilities from the golden path, auto-maintains the knowledge system, survives its own coordinator deaths (auto-resume), and is self-observable (skew detection, telemetry, eval harness). The doc-compression hook — dead since it was built — now fires at ~90% measured reduction.

## Current Milestone: v1.15.0 Self-Improving Quality Loop

**Goal:** Close every feedback loop v1.14.0 left open — failures become regression evals, eval results drive human-approved prompt optimization, routing learns from recorded outcomes, and the quality agents that were designed but never spawned get wired into the golden path.

**Target features:**
- Failures-to-regression pipeline: debugger sessions and verification failures auto-generate candidate eval fixtures (US-1)
- Reflective prompt optimization: eval failures + telemetry → diagnosed, budget-compliant, eval-gated prompt-revision diffs for human approval (US-2)
- Outcome-informed routing: per-tier outcome ledger consulted by task-router, bounded failure escalation haiku→sonnet→opus, honest token accounting from recorded usage (US-3/4/5)
- Dormant quality agents wired in: gsd-test-writer after implementation tasks, gsd-integration-tester on dependent phases (toggleable) (US-6/7)
- Adversarial attacker/defender/judge review for high-risk plans (US-8)
- Structured handoff briefs + verbatim invariant re-injection after checkpoint resume (US-9)
- Project-aware pre-PR gate that passes on GSD itself (US-10)

**Source PRD:** `.planning/prds/pending/self-improving-quality-loop.md` (promoted to done/ at roadmap creation)

**Still-open candidates for later:** reconcile v1.13.0 (phases 41-43 unreconciled — scope already in codebase); gsd-tools module split; prompt-dedup pass; knowledge-system consolidation; Charlotte QA 3-mode wiring.

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

### Active

**Target: v1.15.0 — Self-Improving Quality Loop (Phases 54+)**
- [ ] Debugger sessions and verification failures auto-generate candidate eval fixtures; accepted candidates run permanently in CI
- [ ] Prompt-optimize command produces diagnosed, budget-compliant, eval-gated revision diffs (human-approved, per-agent)
- [ ] Task-router consults a historical per-tier outcome ledger; failed cheap-tier tasks escalate bounded (haiku→sonnet→opus)
- [ ] Actual token usage recorded per task; savings reported from real data with explicit coverage
- [ ] gsd-test-writer spawned after implementation tasks and gsd-integration-tester on dependent phases (config-toggleable, eval-asserted)
- [ ] High-risk plans reviewed by attacker/defender/judge trio with durable verdict artifact
- [ ] Fixed handoff briefs at agent boundaries; invariants re-injected verbatim after checkpoint resume
- [ ] `gate pre-pr` detects project type from manifests and passes on GSD itself

**Note:** v1.13.0 (phases 41-43) was defined 2026-03-11 but never formally executed; its scope (gsd:prd, new-milestone PRD integration, docs-updater) is present in the codebase today. Reconcile/audit v1.13 status separately — do not double-build.

**Deferred:**
- [ ] Savings analytics vs actual profile baselines (not just all-Opus) — AUTO-10
- [ ] Synthesis passes: consolidate knowledge entries → higher-level principles
- [ ] Real 40-60% token savings verified against balanced profile (not theoretical)
- [ ] Notification flow live test with active Telegram forum topic (NOTIF-02–06 code verified, not live-tested)

### Out of Scope

- Cloud vector databases — must be local and git-trackable
- Real-time collaboration — separate files per user handles multi-dev
- Full session history persistence — only extracted knowledge/principles stored
- Breaking changes to existing `/gsd:` commands — all new features additive

## Context

### Current State (v1.10.0 + v1.11.0)

- `gsd-tools.js`: ~10,000+ lines — routing, quota, knowledge (global + project-tagged), compression, installation, milestone management
- `mcp-servers/telegram-mcp/`: Daemon+adapter TypeScript — IPC server, Telegraf bot, forum threads, whisper, `create_topic`, blocking escalation, question-state persistence
- `agents/gsd-phase-coordinator.md`: 624+ lines — includes discuss step (gray-area analysis → Q&A → meta-answerer → CONTEXT.md), escalation block, 6 lifecycle notification events
- `agents/gsd-meta-answerer.md`: 189 lines — queries `query-knowledge`, 5-tier confidence scoring with bump rules, multi-pass fallback
- `get-shit-done/hooks/`: PreToolUse doc compression (with metrics + token estimates + semantic scoring), SessionStart initialization, Stop hook for session-end extraction
- Knowledge DB at `~/.claude/knowledge/{user}.db` (global, all projects share)
- **v1.10.0 delivered:** Autonomous discuss loop live-validated (27 questions, 26 autonomous, 1 Telegram-escalated)

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

---
*Last updated: 2026-07-06 v1.15.0 Self-Improving Quality Loop started (from self-improving-quality-loop PRD) — previously: 2026-07-06 v1.14.0 shipped (PR #3); 2026-07-02 deep-dive audit in docs/analysis/*
