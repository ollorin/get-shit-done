# GSD Deep-Dive Audit — Master Summary

**Date:** 2026-07-02
**Method:** 10 parallel Haiku analysis agents, one per subsystem, each writing a detailed evidence-based doc to this directory. Synthesis and prioritization by the main (Fable) session.
**Goal:** Full understanding of what exists + what must be reworked, feeding an improvement roadmap for the GSD framework. Maintainer's stated pain point: *mandatory steps (test creation/updates, Haiku+Charlotte functional QA) often get skipped in real usage.*

> ⚠️ **Confidence note:** These are first-pass findings by Haiku agents. Line numbers and quotes were pulled from real files, but each finding should be re-verified before implementing a fix. Items marked `[verify]` have known ambiguity. One direct contradiction between agents is flagged in Theme 2 (Telegram wiring).
>
> 🔄 **2026-07-02 update (same day):** A verification round (docs 11–13) **substantially corrected Theme 2 and parts of P1**: most "orphaned" code is actually wired — including Telegram (definitively used by `gsd-phase-coordinator.md:197+` and `execute-roadmap.md:425+`), the observability layer, and the knowledge satellite modules required by `gsd-tools.js`. The verified-dead list is only 6 knowledge files + the `modules/` stubs. See [12-orphan-verification.md](12-orphan-verification.md) (itself partially corrected by main-session greps recorded in doc 13) and **[13-simplification-plan.md](13-simplification-plan.md)**, which supersedes P1 and reframes several P-items as removals. Doc [11-critical-path-trace.md](11-critical-path-trace.md) maps the maintainer's golden path (prd → new-milestone → execute-roadmap): 10/39 workflows, 12/23 agents, ~30/140 gsd-tools commands are actually on it.

## Index of Area Reports

| Doc | Area | Headline |
|-----|------|----------|
| [01-command-layer-and-planning-workflows.md](01-command-layer-and-planning-workflows.md) | Commands + planning workflows | 11 command↔workflow mismatches; E2E "hard rule" has no blocking gate |
| [02-execution-workflows.md](02-execution-workflows.md) | Execution workflows + gates | Enforcement table: 7 deterministic vs 8 prompt-only vs 3 advisory gates; unreported deferral is undetectable |
| [03-execution-agents.md](03-execution-agents.md) | Executor/verifier/QA agents | Concrete skip-loopholes for tests, Charlotte QA, docs, integration tests |
| [04-planning-agents.md](04-planning-agents.md) | Coordinator/planner/checker agents | Context-budget monitoring described but not implemented; ~20K tokens of prompt duplication |
| [05-gsd-tools-core.md](05-gsd-tools-core.md) | gsd-tools.js core CLI | 11,695 lines, 140+ commands, ~6% command test coverage, 81 empty catch blocks |
| [06-knowledge-system.md](06-knowledge-system.md) | Knowledge DB / embeddings | ~55% of knowledge modules orphaned; race condition in storeInsights |
| [07-routing-and-token-economy.md](07-routing-and-token-economy.md) | Model routing + token savings | Savings numbers computed from phantom data; parallel-executor.js dead code |
| [08-infrastructure-install-hooks-modules.md](08-infrastructure-install-hooks-modules.md) | Install/hooks/modules | hooks/dist build gap can block install; PreToolUse hooks have no timeout |
| [09-telegram-mcp.md](09-telegram-mcp.md) | Telegram MCP | Solid architecture; locking dep unused; wiring status contradicts other reports `[verify]` |
| [10-self-testing-and-ci.md](10-self-testing-and-ci.md) | GSD self-testing + CI | 155 tests all pass locally, but **no CI runs them**; observability layer is dead code |
| [15-model-perspective-additions.md](15-model-perspective-additions.md) | Model's own additions (2026-07-04) | Session-limit resilience (observed live ×2), behavioral eval harness, prompt size budgets, version-skew detection, self-report telemetry, injection hardening |

## The Six Cross-Cutting Themes

### Theme 1 — The enforcement gap (confirms the maintainer's pain point)

The framework *talks* mandatory but *enforces* optional. Across workflows and agents, the pattern repeats:

- **Prompt-only gates dominate.** Report 02's enforcement table: of ~18 identified gates, only 7 are deterministic (a script blocks progress); 8 are "You MUST..." prose with no check; 3 are advisory.
- **Self-reported evidence.** Charlotte QA triggering depends on the executor correctly populating SUMMARY `key-files` / declaring the web framework — if metadata is incomplete, QA silently never fires (03).
- **Existence ≠ content.** Verifier checks that test files and SUMMARY.md *exist*, not that tests have assertions or SUMMARYs have substance. Hollow `.test.ts` files pass the gate (03).
- **Non-blocking failures.** Docs-updater failure is explicitly "continue to state updates" in the executor while the same file claims docs are "not skippable" (03). E2E test plan is hard-failed by the verifier but nothing upstream ever auto-generates it — the tool that would (gsd-e2e-test-generator) is never auto-invoked (03).
- **Unreported deferral is invisible.** A coordinator that hits context limits can drop verification or QA without recording a deferral; the orchestrator only detects *missing files*, not *silently skipped stages* (02).
- **Deferral detection is regex-fragile.** Fixed patterns miss "postponed", "held for Phase X.2" etc. (03).

**Root cause:** enforcement lives in prompts (which degrade under context pressure) instead of in `gsd-tools.js` (which doesn't). The fix direction is clear: every mandatory step gets a machine-checkable artifact + a deterministic gate that diffs *expected* vs *actual* artifacts before a phase can be marked complete.

### Theme 2 — Built-but-never-wired (dead code epidemic)

A striking share of the codebase is fully implemented but invoked by nothing:

- **Knowledge system:** 9 of ~19 modules orphaned (~76KB): feedback, cost, permissions, qa, synthesis, conflicts, principles, safety, scan (06).
- **Observability:** execution-log.js, observability.js, session-quality-gates.js, gsd-validator.js — zero references from workflows/agents; autonomous runs have no audit trail (10).
- **Parallelism:** parallel-executor.js (506 lines) never instantiated; coordinator spawns executors sequentially anyway (07).
- **Modules dir:** `get-shit-done/modules/` (circuit-breaker, escalation, feedback, learning, validator) are placeholder stubs; real logic lives in `bin/`, and health-check validates the *stubs* (08).
- **Telegram:** report 09 greps found zero workflow/agent references to the 6 MCP tools — but report 02 and CHANGELOG describe Telegram escalation as wired. `[verify — one of these is wrong]`
- **Analytics:** analytics.js and savings-report.js have no CLI entry points (07).

**Root cause:** phases shipped the *code* and marked done without shipping the *integration* — itself an instance of Theme 1 (verifier checked existence, not wiring).

### Theme 3 — Token-economy claims are unverified

The fork's core value proposition (cost optimization) rests on machinery that partially doesn't run:

- savings-report.js computes "40–60% vs all-Opus" from `token_budget.json` that is never populated in real execution (07) — already a known deferred item in `.planning/`.
- token-monitor.js auto-compression at 80% quota references a hook config path that doesn't exist; fails silently (07).
- Compression's "60–70% reduction" claim is not measured; report 07 says the hook implementation is missing `[verify against hooks/compression/]`.
- task-router scoring is a judgment rubric, not the deterministic keyword/structure scoring the docs describe; routing-rules.md pattern table is never consulted (07).
- Prompt bloat: ~19–22K tokens of near-identical sections duplicated across planning agents (04); planning workflows inline ~2K-char researcher prompts 4× per run (01).

### Theme 4 — gsd-tools.js is a liability at the center of everything

The single 11,695-line file that everything depends on (05):

- 140+ commands, ~200 handlers, 1,800 lines of switch dispatch; only 9 commands have tests (~6%).
- 81 empty catch blocks → silent failures; 15 unguarded `JSON.parse` on state files → crash on corruption; 7 `execSync` calls with unsanitized interpolation → injection class; read-modify-write on STATE.md/ROADMAP.md with no locking → lost updates under the parallelism the framework itself encourages.
- macOS/Linux path assumptions throughout.

### Theme 5 — Consistency drift between layers

- 11 command↔workflow mismatches: commands pointing at nonexistent workflows (debug, generate-e2e-coverage, open-pr, reapply-patches `[verify]`), workflows with no command, silent name remaps (resume-work→resume-project) (01).
- plan-phase.md vs execute-phase.md contradict on E2E enforcement wording; QGATE-07 referenced but undefined (01).
- Stale template references (VALIDATION.md, verification-report.md) (01).
- Coordinator describes context-budget monitoring (thresholds, compressed mode) that has no implementation (04).

### Theme 6 — GSD doesn't apply GSD to itself

- 155 tests pass locally (4.8s) but **there is no CI** — `.github/workflows/` only auto-labels issues (10).
- No prompt-regression testing: agent/workflow MDs (the actual product) are validated by string-matching structure tests only (10).
- Install has real failure modes: hooks/dist not built on source installs; PreToolUse hooks can wedge a session with no timeout; hook deps failing silently while the hook still registers (08).

## Prioritized Improvement Backlog

Ordered by (impact on maintainer's goals: reliability of mandatory steps, then token economy) × (effort). Each item names its evidence doc.

### P0 — Close the enforcement gap (the reason for this audit)

| # | Item | Evidence | Sketch |
|---|------|----------|--------|
| P0-1 | **Deterministic phase-completion gate**: `gsd-tools.js verify phase-gate` computes *expected artifacts* (tests changed? E2E plan? QA report? docs commit? VERIFICATION.md?) from plan type + files touched, and blocks completion until each is present or carries an explicit, machine-readable waiver. | 02, 03 | Replace prompt-only gates with one tool call the orchestrator must run; exit code drives flow. |
| P0-2 | **Auto-detect UI work from git diff, not self-reported metadata**: derive "UI phase" from actual created/modified file extensions and routes, then *require* Charlotte QA + E2E artifacts. | 03 | Kills the key-files/metadata loophole. |
| P0-3 | **Structured deferral protocol**: any skipped mandatory step must write a `DEFERRED.json` entry (step, reason, approver); orchestrator diffs expected-vs-done and treats unrecorded gaps as failures. | 02, 03 | Makes silent skipping impossible by construction. |
| P0-4 | **Auto-invoke gsd-e2e-test-generator** when the phase gate demands E2E plans (currently verifier demands what nothing produces). | 03 | |
| P0-5 | **Make docs-updater failure blocking** (or explicitly waivable via P0-3) — resolve the "not skippable but non-blocking" contradiction. | 03 | |
| P0-6 | **Test-content gate**: verifier runs the test suite and requires net-new/changed assertions for tdd tasks, not file existence. | 03 | |

### P1 — Wire or delete (dead code) — **SUPERSEDED by [13-simplification-plan.md](13-simplification-plan.md)**

| # | Item | Evidence | 2026-07-02 status |
|---|------|----------|-------------------|
| P1-1 | ~~9 orphaned knowledge modules~~ → verified dead: only conflicts/principles/qa/safety/scan/synthesis (6 files); the rest are required by gsd-tools.js. | 06, 13 | → Simplification plan A1/B8 |
| P1-2 | ~~Wire execution-log/observability~~ → they ARE wired (verification round corrected doc 10). Confirm coverage instead. | 10, 12 | closed as mis-finding |
| P1-3 | ~~Telegram contradiction~~ → RESOLVED: wired (coordinator + execute-roadmap). Keep; fix doc 09 reliability issues. | 09, 12 | closed |
| P1-4 | Delete `get-shit-done/modules/` stubs; fix health-check/install-modules. | 08, 13 | → Simplification plan A2 |
| P1-5 | parallel-executor.js → **delete the unused path**, don't integrate. | 07, 13 | → Simplification plan C1 |

### P2 — Core reliability quick wins (est. ~2 days total)

| # | Item | Evidence |
|---|------|----------|
| P2-1 | Guard all 15 unguarded `JSON.parse` sites in gsd-tools.js with typed error messages. | 05 |
| P2-2 | Replace/escape the 7 injectable `execSync` calls (spawn + argv). | 05 |
| P2-3 | Add file locking (or atomic write-rename) for STATE.md / ROADMAP.md / config.json read-modify-write. | 05, 06 |
| P2-4 | Triage the 81 empty catch blocks: log-and-continue vs fail-loud. | 05 |
| P2-5 | **GitHub Actions CI**: run `npm test` on push/PR (suite already passes in 4.8s — this is free reliability). | 10 |
| P2-6 | Fix install: build hooks/dist during install; timeout-wrap PreToolUse hooks; fail install loudly when hook deps fail. | 08 |
| P2-7 | Wrap knowledge-writer storeInsights in a transaction; fix `db.vectorEnabled` check; log FTS degradation. | 06 |

### P3 — Token economy: make the claims true

| # | Item | Evidence |
|---|------|----------|
| P3-1 | Real token accounting: populate token_budget.json from actual usage during execution; report savings against the *configured profile*, not theoretical all-Opus. | 07 |
| P3-2 | Deterministic task-router scoring (structured features: must-have count, file count, task type) + actually consult routing-rules.md, with the LLM as tiebreaker only. | 07 |
| P3-3 | Deduplicate the ~20K tokens of repeated agent-prompt boilerplate into shared references loaded once. | 04 |
| P3-4 | Fix or remove the broken quota auto-compression path in token-monitor.js. | 07 |
| P3-5 | Measure compression hook reduction for real, or delete the claim. | 07 |

### P4 — Structural hygiene

| # | Item | Evidence |
|---|------|----------|
| P4-1 | Split gsd-tools.js into command modules + shared lib (proposal sketched in 05); raise command test coverage as modules split out. | 05 |
| P4-2 | Reconcile the 11 command↔workflow mismatches; fix stale template refs; define or remove QGATE-07. | 01 |
| P4-3 | Consolidate knowledge system 19 files → ~6 (proposal in 06); centralize thresholds into config. | 06 |
| P4-4 | Prompt-regression harness: golden-scenario tests that feed canned phase states through workflows and assert on required spawns/gates. | 10 |
| P4-5 | Windows path handling in gsd-tools.js (or explicitly declare macOS/Linux-only). | 05 |

## How to Resume This Work

1. Read this file first; it links every area report.
2. Before implementing any item, re-verify its evidence in the linked doc against the current source (Haiku first-pass; line numbers may drift).
3. Suggested execution route: turn P0 into a GSD milestone ("Enforcement Hardening") — it's the highest-leverage fix and directly addresses the observed skipped-steps failure mode. P2 items are safe quick wins that can be batched alongside.
4. Open contradictions to resolve first: Telegram wiring (P1-3), compression hook implementation status (P3-5), open-pr/reapply-patches workflow existence (P4-2).
