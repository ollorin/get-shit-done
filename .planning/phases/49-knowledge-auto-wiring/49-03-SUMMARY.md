---
phase: 49-knowledge-auto-wiring
plan: 03
subsystem: knowledge
tags: [synthesis, principles, consolidation, conflict-detection, circuit-breaker, complete-milestone]

# Dependency graph
requires:
  - phase: 49-01
    provides: GSD_KNOWLEDGE_DB_PATH override (all new tests here use it against isolated temp DBs); circuit-breaker plumbing pattern
  - phase: 49-02
    provides: mine_milestone_conversations step in complete-milestone.md (this plan's new step composes immediately after it, without disturbing its existing prune/checkpoint additions)
provides:
  - synthesizePrinciples(conn, options, synthesizeFn) — injectable-synthesizer signature; real synthesized text replaces the "first 10 words" stub whenever a synthesizer is supplied, with graceful stub fallback when it is not
  - Circuit breaker gate at the top of synthesizePrinciples (checked before any embedding/clustering work) — shared by both the automatic workflow path and the manual backstop, since both call this same function
  - Conflict detection against existing same-topic principles via knowledge-conflicts.js's resolvePrincipleConflict — ambiguous conflicts are flagged to .planning/knowledge/CONFLICTS.jsonl and never silently overwritten
  - `knowledge consolidate` CLI backstop command (optional --principles JSON) calling the identical synthesizePrinciples function as the automatic path
  - New consolidate_knowledge step in complete-milestone.md, composing after mine_milestone_conversations and before reorganize_roadmap_and_delete_originals, gated by auto_consolidate config (default true), non-blocking on any failure
affects: [49-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injectable synthesizer with stub fallback: synthesizeFn is optional; when omitted or when it returns nothing usable for a cluster, the pre-existing stub text is used instead of crashing — preserves backward compatibility for any caller that doesn't supply real synthesis."
    - "Never a parallel implementation: the manual `knowledge consolidate` CLI backstop and the automatic complete-milestone.md workflow step both call the exact same synthesizePrinciples() function — the CLI's --principles flag is just a way to feed pre-synthesized (Haiku-generated) text into that one function from a context (a workflow step) that has access to Agent()/Task() but the CLI itself does not."
    - "Conflict-shaped object adapters: buildExistingConflictObject/buildCandidateConflictObject translate knowledge rows and freshly-extracted principle candidates into the {content, metadata:{category,confidence}} shape knowledge-conflicts.js's scorePrinciple() expects, without needing to change that module."

key-files:
  created: []
  modified:
    - get-shit-done/bin/knowledge-synthesis.js
    - get-shit-done/bin/gsd-tools.js
    - get-shit-done/workflows/complete-milestone.md
    - get-shit-done/bin/gsd-tools.test.js

requirements-completed: [MILE-16]

key-decisions:
  - "Resumed as coordinator #3 after coordinator #2 left Task 1 (knowledge-synthesis.js refactor + gsd-tools.js consolidate command) done but uncommitted on disk, and Tasks 2-4 (tests, workflow step, structural tests) entirely unwritten. Verified Task 1's uncommitted diff against the plan's must_haves line-by-line before building on it — found it coherent, correct, and matching the plan's A1-A4/Part-B spec exactly (circuit breaker gate first, injectable synthesizer with stub fallback, conflict detection via resolvePrincipleConflict, manual backstop calling the identical function) — kept it as-is rather than reworking."
  - "Discovered and worked around a pre-existing footgun in insertKnowledge/knowledge-crud.js while writing Task 2's tests: mixing embedding-less and embedding-bearing inserts in the same DB desyncs the knowledge table's rowid from the vec0 shadow table's auto-incrementing rowid, throwing 'Rowid mismatch' on the first embedding-bearing insert after any embedding-less one. Not in this plan's scope to fix — all Task 2 test fixtures were written to always pass a real generated embedding on every insertKnowledge call within a given test DB, keeping the two tables in lockstep from the first row."
  - "Validated the conflict-detection test's confidence/priority arithmetic empirically before writing it as an assertion: buildCandidateConflictObject never sets metadata.category, so every synthesized candidate always scores at the 'convenience' priority (0.3) in resolvePrincipleConflict. To land the existing-vs-candidate score gap inside the 20% ambiguity threshold, the test's existing principle fixture also omits category (defaulting to the same 'convenience' 0.3) and sets confidence: 0.85 against a candidate whose 5-identical-member cluster deterministically caps confidence at 1.0 — producing scores 0.255 vs 0.3 (15% gap, ambiguous)."
  - "synthesizePrinciples writes CONFLICTS.jsonl relative to process.cwd() (not an injectable cwd param) — since this function is called directly (not via CLI subprocess) in 4 of Task 2's 5 tests, each test process.chdir()s into a throwaway temp directory for its duration (restored in afterEach) rather than ever risking a write into the real repo's .planning/knowledge/ directory."
  - "consolidate_knowledge step's Agent() call for per-cluster Haiku synthesis was written as prompt text only (matching Phase 48's and this plan's own documented precedent) — the live Haiku call itself was not exercised this session, consistent with the workflow-step-authoring constraint noted in the plan (writing an Agent() call requires no tool; invoking it does)."

test-coverage:
  - "Phase 49-03: milestone consolidation (5 tests) — sufficient cluster stores injected synthesizer text (not the stub); insufficient cluster produces zero principles without lowering the bar; conflicting same-topic principles are flagged to CONFLICTS.jsonl with the original principle byte-for-byte unchanged; circuit breaker blocks synthesis before the injected synthesizer is ever called; manual `knowledge consolidate` CLI backstop produces an identical synthesized count/text/topic to the direct synthesizePrinciples call against identically-seeded DBs"
  - "Phase 49-03: complete-milestone consolidation step wiring (6 tests) — consolidate_knowledge step exists positioned after mine_milestone_conversations and before reorganize_roadmap_and_delete_originals; references the knowledge consolidate CLI command; contains an Agent() call with subagent_type=\"general-purpose\" and model=\"haiku\"; is gated by auto_consolidate; declares a non-blocking guarantee; loadConfig() returns auto_consolidate: true by default"
  - "307/307 tests passing (296 pre-existing + 11 new); no test touches the live ~/.claude/knowledge/ DB (all isolated via GSD_KNOWLEDGE_DB_PATH); no test leaves stray CONFLICTS.jsonl writes in the real repo (all conflict-writing tests chdir into a temp directory for their duration)"

commits:
  - "(Task 1 was already complete and uncommitted on disk from the prior coordinator session — verified against plan must_haves, kept as-is, committed together with Tasks 2-4 as part of this plan's atomic commit sequence)"

deferred:
  - "docs: no Agent/Task tool guaranteed available mid-plan for gsd-docs-updater — same precedent as 49-01/49-02; phase-level docs gate to be satisfied with a real gsd-docs-updater run at the end of phase 49 per resume instructions"
  - "Live Haiku Agent() call inside complete-milestone.md's new consolidate_knowledge step was written as prompt text but not exercised this session (no real milestone completion triggered it) — matches Phase 48's documented precedent for the same limitation"

charlotte-qa: not-applicable (no UI surface touched)
---

## What was built

Replaced `knowledge-synthesis.js`'s "first 10 words" stub principle-generation with a real injectable-synthesizer pathway, added conflict detection so synthesis never silently clobbers a contradicting existing principle, gated the whole thing behind the existing cost circuit breaker, and wired it into `complete-milestone.md` to run once per milestone (never per-action).

1. **Injectable synthesizer (`synthesizePrinciples(conn, options, synthesizeFn)`)**: for each cluster whose cohesion+size-bonus confidence meets the existing threshold, `synthesizeFn(cluster)` — if supplied — replaces the stubbed principle text. If no synthesizer is supplied, or it returns nothing usable, the original stub (`generatePrincipleText`) is used as a graceful fallback. This means every existing/future caller that invokes the function with no third argument keeps working exactly as before.

2. **Circuit breaker gate**: `shouldBlockCostlyAction(db)` is checked at the very top of `synthesizePrinciples`, before any clustering/embedding work fires. If blocked, the function returns immediately with `reason: 'circuit_breaker_blocked'` and neither `clusterKnowledge` nor any synthesizer is ever called. Both the automatic workflow path and the manual CLI backstop get this protection for free since both call this one function.

3. **Conflict detection**: before inserting any qualifying candidate principle, the module queries existing `principle`-type rows sharing the same inferred topic. If any exist, both the existing row(s) and the new candidate are scored via `knowledge-conflicts.js`'s `resolvePrincipleConflict()`. An ambiguous result (`resolved: false`, scores within 20%) is appended as a JSON line to `.planning/knowledge/CONFLICTS.jsonl` and the candidate is skipped — never silently overwriting the existing principle. A clear win for either side proceeds/skips accordingly without being logged as a conflict.

4. **Manual `knowledge consolidate` backstop CLI**: a new subcommand under `gsd-tools.js knowledge consolidate` (optional `--scope` and `--principles '<json>'`) that opens the same connection type used elsewhere (`cmdKnowledgePrune`'s pattern) and calls the identical `synthesizePrinciples` function — with `--principles` supplied, it is the exact mechanism `complete-milestone.md`'s new step uses to feed real Haiku-synthesized text in after spawning `Agent()` calls per cluster; without it, every cluster falls back to the stub, useful for ad hoc manual exercising of the clustering/confidence/conflict logic.

5. **New `consolidate_knowledge` step in `complete-milestone.md`**: inserted immediately after `mine_milestone_conversations`'s closing `</step>` and before `reorganize_roadmap_and_delete_originals`, so principle synthesis sees freshly-mined entries. Gated by a new `auto_consolidate` config default (`true`, added alongside `auto_mine`'s precedent in both `loadConfig()`'s defaults object and its final per-key return mapping — the second was necessary because `loadConfig()` builds its return value key-by-key rather than spreading `defaults`). The step: discovers clusters via `knowledge consolidate --raw`, checks for `circuit_breaker_blocked`/`insufficient_knowledge` before spawning any Haiku calls, spawns one `Agent(subagent_type="general-purpose", model="haiku", ...)` call per cluster (falling back to the stub non-fatally on failure), finalizes by re-invoking `knowledge consolidate --principles '[...]'` with the real synthesized text, writes a `.planning/milestones/v[X.Y]-CONSOLIDATION.md` metadata file unconditionally, and wraps the entire step in the same non-blocking guarantee pattern already established by `mine_milestone_conversations` — this step can never be the reason a milestone fails to complete.

## Verification

`npm test` — 307/307 passing (296 pre-existing + 11 new Phase 49-03 tests). Manually confirmed:
- `node --check` passes on `knowledge-synthesis.js` and `gsd-tools.js`
- Empty-DB smoke test: `knowledge consolidate --raw` against a fresh temp DB returns `{"synthesized": 0, "reason": "insufficient_knowledge", ...}` without throwing
- `complete-milestone.md` has 16 `<step name=...>` opens and 16 matching `</step>` closes (balanced nesting) after the insertion
- `consolidate_knowledge` step is positioned strictly between `mine_milestone_conversations`'s close and `reorganize_roadmap_and_delete_originals`'s open
- `config get auto_consolidate --raw` returns `true` with no `.planning/config.json` present
