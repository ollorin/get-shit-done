# Simplification & Removal Plan

**Date:** 2026-07-02
**Anchor:** The maintainer's actual usage is one golden path — `/gsd:prd` → iterate to ready PRD → `/gsd:new-milestone` (roadmap from PRD) → `/gsd:execute-roadmap` (full overnight autonomous run) → `/gsd:progress` / `/gsd:audit-milestone` / `/gsd:complete-milestone`. Everything in the framework is judged against: *does it serve this path, or the token economy of this path?*

**Inputs:** [11-critical-path-trace.md](11-critical-path-trace.md), [12-orphan-verification.md](12-orphan-verification.md), main-session ground-truth greps (see below).

## Ground-Truth Corrections — read this before trusting any "orphan" claim

Dead-code claims went through three rounds, each shrinking the list:

1. **First-pass audit (docs 06/07/10)** claimed ~55% of knowledge modules + the observability layer + parallel-executor + telegram were orphaned. **Wrong on most counts.**
2. **Verification agent (doc 12)** corrected 49 of 67 suspects to wired (Telegram is definitively wired: `gsd-phase-coordinator.md:197+`, `execute-roadmap.md:425+`), leaving 18 "actually orphaned". **Still wrong on 12 of those 18.**
3. **Main-session greps (ground truth for these files):** `embeddings.js`, `knowledge-dedup.js`, `knowledge-evolution.js`, `knowledge-lifecycle.js`, `knowledge-checkpoint.js`, `knowledge-cost.js`, `knowledge-permissions.js`, `knowledge-feedback.js`, `llm-metrics.js`, `graduated-alerts.js`, `analysis-prompts.js`, `whisper-transcribe.js` are all `require()`d by `gsd-tools.js` or the wired knowledge core (e.g. `gsd-tools.js:2623,2732,2807,2899,3013,3711,4142,4233`; `knowledge-writer.js:235,243,290`; `knowledge-search.js:435`).

**Lesson for all future work on this audit: no deletion without a fresh grep in the same session.**

The *verified* dead list is small:

- `knowledge-conflicts.js`, `knowledge-principles.js`, `knowledge-qa.js`, `knowledge-safety.js`, `knowledge-scan.js`, `knowledge-synthesis.js` — referenced by nothing outside themselves (grep across bin/, workflows/, agents/, scripts/, hooks/, commands/, references/, templates/: only self-hit is `knowledge-safety.js`).
- `get-shit-done/modules/` (circuit-breaker, escalation, feedback, learning, validator) — each contains a real `index.js`, but **zero runtime references** to any `modules/...` path anywhere; only the installer/health-check touch them. The live implementations are the `bin/gsd-*.js` files.

An important nuance the binary wired/orphaned split misses: **"required by gsd-tools.js" ≠ "used by the golden path."** Many knowledge features (cost circuit-breaker, permissions, principle-feedback, checkpoints) are wired to CLI subcommands that no workflow or agent on the critical path ever invokes. They're reachable, but plausibly never executed in real usage. Those are Category C decisions below.

## Critical-Path Reality (doc 11)

- **Commands:** 6 of 33 are the mainline. The rest are satellites.
- **Workflows:** 10 of 39 reached transitively (prd, new-milestone, execute-roadmap, execute-phase, execute-plan, plan-phase, discuss-phase, progress, audit-milestone, complete-milestone).
- **Agents:** 12 of 23 spawned on path (coordinator, project-researcher, research-synthesizer, roadmapper, phase-researcher, planner, plan-checker, executor, verifier, charlotte-qa, test-writer, integration-checker). *Note: doc 11 didn't list gsd-docs-updater, but the executor spawns it as its mandatory final task (doc 03) — treat it as on-path.*
- **gsd-tools.js:** only ~30 of 140+ subcommands are invoked on the path.

## Category A — Delete now (verified safe, no user decision needed)

| Target | Size | Evidence | Notes |
|--------|------|----------|-------|
| A1. `bin/knowledge-{conflicts,principles,qa,safety,scan,synthesis}.js` | ~35KB | ground-truth grep: zero external references | Also remove any dormant DB tables/migrations they own if isolated. |
| A2. `get-shit-done/modules/` (all 5 subdirs) | ~small | zero runtime references | Update `scripts/install-modules.js` and `scripts/health-check.js` (which validates the stubs — doc 08 issue 5) accordingly; possibly delete install-modules.js itself. |
| A3. `skills/llmlingua-comparison/` | — | analysis artifact, not runtime (doc 07) | |
| A4. Orphaned hook files: `session-end.js` (superseded by session-end-standalone), `intel-*.js` already listed as orphans at `bin/install.js:723` | — | doc 08 issues 8–9 | Also make uninstall clean them (doc 08 issue 9). |
| A5. `scripts/install-hooks.js` if truly duplicated by `bin/install.js` step 2 | — | doc 08 issue 6 — re-verify with fresh grep of install-orchestrator | |
| A6. Stale references: QGATE-07, missing template refs (VALIDATION.md, verification-report.md), commands pointing at nonexistent workflows where feature is being dropped | — | doc 01 | Deletion of dangling pointers, not features. |

## Category B — Delete unless you actually use it (your call — grouped by feature stack)

Each stack is self-contained; deleting it removes command + workflow + agent + bin support together. None touch the golden path.

| Stack | Components | Recommendation |
|-------|-----------|----------------|
| B1. Discovery/product-investigation | `workflows/discover.md`, `discovery-phase.md`, `gsd-product-investigator`, `gsd-discovery-synthesizer`, `skills/gsd-discover/` | **Likely redundant now**: `/gsd:prd` covers concept maturation in your flow. ⚠️ Verify `skills/gsd-discover` isn't the live entry to these workflows before removing. |
| B2. Codebase mapping | `map-codebase` command+workflow, `gsd-codebase-mapper` | Keep only if you start GSD projects on existing codebases; you likely do — your call. |
| B3. Conversation mining / session intel | `mine-conversations`, `analyze-pending-sessions` (no command entry), `conversation-miner.js`, `historical-extract.js`, `session-analyzer.js`, `session-chunker.js`, `dashboard-server.js` | Heavy subsystem (~60KB+). If you never run `/gsd:mine-conversations` or look at the dashboard, delete the stack. Session-end knowledge extraction (hooks) is separate — keep that. |
| B4. Debug stack | `debug` command (its workflow is **missing** — doc 01 issue 1), `gsd-debugger.md` (36.8K) | Command is broken today. Either restore the workflow or delete the stack. If you debug via plain Claude Code, delete. |
| B5. Validate-phase / Nyquist | `validate-phase` command, `gsd-nyquist-auditor` | Retroactive gap-filling — superseded if P0 enforcement lands (gates prevent gaps instead of back-filling them). Delete after P0. |
| B6. Standalone research | `research-phase` command (docs say "usually use /gsd:plan-phase instead") | Thin; delete the standalone entry, keep the workflow (plan-phase uses it). |
| B7. Misc | `join-discord`, `list-phase-assumptions`, `insert-phase`/`remove-phase`/`add-phase` (roadmap surgery), `pause-work`/`resume-work`, `quick`, `add-todo`/`check-todos`, `settings`/`set-profile`, `update`/`reapply-patches` | Mostly small and harmless. Keep the ones you use (`settings`, `update`, probably `quick` and todos); `join-discord` and `list-phase-assumptions` are trivia — delete. |
| B8. Knowledge maintenance CLI | gsd-tools subcommands for knowledge cost circuit-breaker, permissions grant/revoke, principle feedback, checkpoints (`gsd-tools.js:2623–3013`) + their modules | Wired but almost certainly never invoked in your flow (principles engine they support is half-orphaned — its generator `knowledge-principles.js` is dead per A1). If you don't use these commands, strip commands + modules together. **Decide as one unit with A1.** |

## Category C — Don't fix, remove instead (items from the original P-backlog that deletion solves better)

| Original backlog item | New recommendation |
|----------------------|--------------------|
| C1. P1-5 parallel-executor.js "integrate or delete" | **Delete the unused execution path.** Wave parallelism already happens via coordinator prompt orchestration; a second, never-instantiated engine is pure risk. Keep only if a measured bottleneck appears. (It is `require()`d by gsd-tools — remove the requiring command too.) |
| C2. P3-4 broken quota auto-compression in token-monitor.js | Remove the broken branch (nonexistent hook config path) instead of fixing; quota downgrade decisions belong in the router, not a side channel. |
| C3. P3-5 compression measurement | Doc-compression hooks are wired and plausibly valuable — keep, but delete any *unimplemented* compression claims/config from docs rather than building to match the docs. |
| C4. analytics.js vs savings-report.js overlap | Keep one reporting path (analytics feeds `rtk`-style gain reporting; savings-report computes vs baselines). Merge into a single honest report fed by real token accounting (P3-1). Delete the other. |
| C5. Verifier/plan-checker double-checking overlap with P0 gates | Once deterministic `verify phase-gate` exists, strip the equivalent prose checklists from agent prompts instead of maintaining both (removes tokens *and* drift risk). |
| C6. 11 command↔workflow mismatches (doc 01) | Resolve by **deletion** wherever the feature lands in Category A/B; only `debug` (if kept) needs a build-fix. |

## Category D — Consolidate (keep the capability, shrink the footprint)

- **D1. gsd-tools.js: prune before splitting.** The original P4-1 plan (15-module split, ~100h) is over-engineered relative to value. Instead: delete subcommands orphaned by Categories A–C (140+ → ~70), *then* split only what remains into 4–6 modules (state, roadmap/phases, verify/gates, knowledge, misc). Est. 400KB → ~200KB with far less effort.
- **D2. Agent prompt dedup (~19–22K tokens, doc 04):** extract the 8× duplicated project-context-discovery block, frontmatter parsing, goal-backward explanation into shared references loaded once. Directly cuts per-phase token cost on the golden path — this is a P3-level win, not cosmetic.
- **D3. Knowledge system 19 → ~7 files:** after A1/B8, consolidate to db, crud, search, writer(+dedup+evolution), extraction, lifecycle, embeddings. Centralize the fragmented thresholds (doc 06 issue 3) as part of the merge.
- **D4. Command surface honesty:** workflows with no command entry (`diagnose-issues`, `health`, `transition`, `analyze-pending-sessions`) — wire the ones worth keeping (`health` is a good candidate) into commands, delete the rest. An unreachable workflow is documentation cosplay.
- **D5. new-project vs new-milestone:** your flow starts from PRD, not from `/gsd:new-project` questioning. Consider making new-project a thin wrapper: init config + delegate to the same PRD→milestone path, rather than maintaining two parallel onboarding flows (new-project.md is 32.8K).

## Category E — Keep and harden (the golden path; never remove)

prd / new-milestone / execute-roadmap / execute-phase / execute-plan / plan-phase / discuss-phase workflows; coordinator, planner, plan-checker, researcher(s), executor, verifier, test-writer, charlotte-qa, integration-checker, docs-updater, task-router agents; Telegram MCP (wired, essential for overnight runs — fix doc 09 reliability issues: unused lockfile dep, daemon-crash hang, timeout race); doc-compression hooks; knowledge core (db/crud/search/writer/extraction/dedup/lifecycle/embeddings); statusline/check-update; installer (fix doc 08 issues).

All P0 enforcement items from the master summary apply here unchanged — they are the *must fix* counterpart to this plan's *must remove*.

## Estimated impact

- **Code:** ~35KB verified-dead knowledge modules + modules/ stubs + (pending your calls) up to ~150KB of stack deletions (B3+B4 alone ≈ 100KB) + ~50% of gsd-tools.js command surface.
- **Tokens per overnight run:** D2 prompt dedup (~1K+ tokens per agent spawn × dozens of spawns) + C5 checklist stripping are the real recurring wins.
- **Maintenance:** every deleted stack is a stack that can no longer drift, contradict the golden path, or mislead an agent mid-run (the doc 01 mismatches were exactly this failure).
- **Risk discipline:** nothing in Category B/C gets deleted without a same-session grep (see Ground-Truth Corrections).

## Decisions needed from the maintainer — ✅ RESOLVED 2026-07-02

Superseded by **[14-integration-rework-plan.md](14-integration-rework-plan.md)**:
1. Satellite stacks (B1/B3/B4/B5): **integrate into the golden path** (discovery→prd, mining→complete-milestone, debugger→failure paths, nyquist→verifier gate), then delete only the obsoleted standalone entry points.
2. Knowledge maintenance (A1/B8): **rework + auto-wire** high-value modules (safety/lifecycle/cost/feedback/checkpoint + milestone-cadence synthesis/principles/conflicts); delete qa, scan, permissions surface.
3. D5 new-project: **leave as-is** (dropped).
