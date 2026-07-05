# Requirements: GSD

**Core Value:** Claude learns to make autonomous decisions based on the user's reasoning patterns, only stopping for actions that are irreversible, external, or cost money.

---

## v1.13.0 — Product Discovery & Docs Automation (Defined: 2026-03-11)

### v1 Requirements

#### PRD Workflow (gsd:prd)

- [ ] **PRD-01**: User can run `gsd:prd` with a concept description (text, file path, or URL to existing PRD) to initiate PRD maturation
- [ ] **PRD-02**: PM Discovery stage performs web research on competitive landscape then runs multi-round Q&A (max 4 questions/round) until confidence is sufficient to advance — agent states confidence and blocking gaps explicitly each round
- [ ] **PRD-03**: PO/BA Scoping stage reads existing codebase and `.planning/prds/done/` for dependency context, defines user stories and acceptance criteria through Q&A, and draws MVP vs Phase 2 boundary
- [ ] **PRD-04**: HL Tech Discovery stage identifies technology candidates and architectural constraints through research — explicitly does NOT write schemas, API routes, or implementation code (those belong to GSD's research phase)
- [ ] **PRD-05**: Completed PRD is stored at `.planning/prds/pending/{name}.md` in product-oriented format (WHAT/WHY: problem, goals, user stories, acceptance criteria, tech candidates, open questions — no HOW)
- [ ] **PRD-06**: PRD includes an explicit assumptions list (things assumed but not confirmed) that GSD's research phase can validate during implementation

#### Milestone PRD Integration (gsd:new-milestone)

- [ ] **MILE-01**: When invoked, `gsd:new-milestone` detects pending PRDs in `.planning/prds/pending/` and presents them as selectable options before asking "what to build next"
- [ ] **MILE-02**: When a PRD is selected, milestone phase decomposition is fully autonomous — agent reads PRD and derives phases with dependency ordering without requiring manual phase definition from user
- [ ] **MILE-03**: User sees proposed roadmap (phase names, goals, requirement coverage) as a single approval checkpoint before any branch or planning files are created
- [ ] **MILE-04**: On roadmap approval, selected PRD moves from `.planning/prds/pending/` to `.planning/prds/done/`

#### Docs Automation

- [ ] **DOCS-01**: Phase executor runs a Haiku docs agent as the last mandatory task in the final execution wave, after all feature work is committed
- [ ] **DOCS-02**: Docs agent scales output to what was built: new API endpoint → create/update `api/` file; new UI (backoffice or player) → create/update `frontend-operator/` or `frontend-player/` file; architectural decision → append to `architecture/` doc; internal refactoring → minimal changelog entry only
- [ ] **DOCS-03**: Phase verifier validates that docs were updated appropriately relative to what was built in the phase — flags as gap if docs agent was skipped or output does not match build scope
- [ ] **DOCS-04**: Docs agent reads existing `/docs` templates and frontmatter conventions from the target project before writing, producing content that matches the project's established style
- [ ] **DOCS-05**: Guard behavior: if `/docs` exists in the project → update existing files where relevant, create new files for new surfaces; if `/docs` does not exist → create the folder and seed with what was built. Content must be thin, focused, and useful for both AI agents and human developers — no padding, no invented content.

### v2 Requirements

#### PRD Workflow

- **PRD-07**: PRD maturation supports batch mode — process multiple concept descriptions in sequence, storing each to pending
- **PRD-08**: `gsd:prd` can accept a URL to a competitor's feature/product page and use it as PM Discovery research seed
- **PRD-09**: PRD confidence score is surfaced to user so they can override "advance to next stage" decision

#### Docs Automation

- **DOCS-06**: Milestone closure triggers a full docs audit — Haiku agent reviews all `/docs` against what shipped in the milestone, updates stale content, and creates an index if missing
- **DOCS-07**: Docs agent generates a cross-module integration map when multiple modules are built in the same milestone

### Out of Scope (v1.13.0)

| Feature | Reason |
|---------|---------|
| Automatic PRD generation without user input | PRD maturation is collaborative; user input validates product intent |
| Technical spec generation in `gsd:prd` | HOW questions are answered by GSD's research phase, not the PRD workflow |
| PRD version control / diff tracking | Git handles version history; no separate versioning needed |
| Public docs site generation | `/docs` is for internal AI/developer use; publishing is out of scope |
| Retroactive docs for all existing code | Only docs for newly built phase output; full historical docs is a separate initiative |

---

## v1.14.0 — Enforcement & Integration (Defined: 2026-07-02)

**Source PRD:** `.planning/prds/pending/enforcement-and-integration.md` (US-1..US-16, all in MVP boundary)
**Note:** US-14 is split into two requirements — MILE-18 (dead code with no replacement dependency, deleted early) and MILE-19 (deletions gated on replacements landing, deleted last) — per the PRD's risk-ascending ordering.

### v1 Requirements

#### Enforcement Gates

- [x] **MILE-05**: Deterministic `gsd-tools.js verify phase-gate {phase}` command computes expected artifacts from plan type and touched files, returns machine-readable JSON, exits non-zero on any missing artifact without a matching waiver, and is called as blocking (not advisory) by execute-phase/execute-roadmap; replaced prose "MUST" checklists are removed from agent prompts (US-1)
- [x] **MILE-06**: `HAS_UI` is computed from `git diff --name-only` (file extensions, route-pattern files), never from self-reported SUMMARY.md metadata — UI files omitted from SUMMARY are still detected and trigger Charlotte QA + E2E requirements (US-2)
- [x] **MILE-07**: Any skipped mandatory step requires a machine-readable `DEFERRED.json` entry (`{step, reason, approver, timestamp, phase, plan}`); self-waivers fire a non-blocking Telegram notification at write time; `audit-milestone` surfaces all waivers as a visible table (US-3)
- [x] **MILE-08**: `gsd-e2e-test-generator` auto-spawns when `HAS_UI=true` and `E2E-TEST-PLAN.md` is missing or has coverage gaps, before phase-gate evaluates — idempotent when coverage is complete, generator failure fails the gate with a clear `failure_type` (US-4)
- [x] **MILE-09**: `gsd-docs-updater` returns a structured contract and its failure (thrown error, timeout, or "no changes" with matched documentation-worthy signals) blocks phase completion, waivable only via DEFERRED.json — never log-and-continue (US-5)
- [x] **MILE-10**: The verifier classifies each PLAN.md requirement ID COVERED/PARTIAL/MISSING against test files, fails hollow tests (empty describe blocks, net-zero new assertions), blocking-spawns `gsd-nyquist-auditor` on gaps, and escalates unfillable gaps as `gaps_found`; `/gsd:validate-phase` is deleted once absorbed (US-6)

#### Satellite Injections

- [x] **MILE-11**: `complete-milestone` automatically mines the milestone's conversation sessions into the knowledge DB (gated by `auto_mine: true` default, deduped against session-end extraction, metadata to `.planning/milestones/v{X}-KNOWLEDGE.md`, non-blocking on failure) (US-7)
- [x] **MILE-12**: `/gsd:prd` auto-spawns 4–6 parallel `gsd-product-investigator` agents (Haiku, capped) when confidence < ~0.50 with unresolved gaps after max Q&A rounds; `gsd-discovery-synthesizer` merges findings; confidence ≥ ~0.65 stays dormant; standalone discover surfaces are deleted once landed (US-8)
- [x] **MILE-13**: Repeated execution failure auto-spawns `gsd-debugger`: 1st failure auto-retries silently, 2nd failure spawns the debugger with context, escalation includes debugger findings, hard stop at max-attempts ceiling (default 4); `workflows/debug.md` rebuilt slim around the existing agent (US-9)

#### Knowledge Auto-Wiring

- [x] **MILE-14**: Every knowledge write passes through `knowledge-safety.js` as a pre-write guard, including a new config-extensible secrets/PII regex filter (API-key-like tokens, emails, credential keywords — rejection preferred over redaction when ambiguous); the `storeInsights` transaction race is fixed; `knowledge-cost.js` circuit breaker is checked before extraction/embedding batches (US-10)
- [x] **MILE-15**: `pruneStaleEntries` + `checkpointWAL` run automatically at session-end and `complete-milestone`; `markPrincipleWrong` auto-triggers when verifier/executor finds a KB-sourced answer contradicted by execution outcome; `knowledge-checkpoint.js` auto-checkpoints before bulk operations (US-11)
- [x] **MILE-16**: Knowledge synthesis, principle extraction, and conflict detection run once per milestone at `complete-milestone` (never per-action), with a real Haiku call replacing the stubbed principle-text generator, plus a thin manual backstop command exposing the same code path (US-12)
- [x] **MILE-17**: `knowledge-qa.js`, `knowledge-scan.js`, and the `knowledge-permissions.js` grant/revoke CLI surface are deleted after fresh zero-reference greps; gsd-tools.js dispatch no longer references them (US-13)

#### Reliability & Deletions

- [ ] **MILE-18**: Category-A verified-dead code with no replacement dependency is removed early: `get-shit-done/modules/` stubs, `skills/llmlingua-comparison/`, orphaned hook files, `parallel-executor.js` + its requiring command, the broken quota auto-compression branch in `token-monitor.js`, stale template/QGATE-07 references, and `scripts/install-hooks.js` if confirmed duplicated — each preceded by a fresh zero-reference grep (US-14 part A)
- [x] **MILE-19**: Entry points obsoleted by this milestone's replacements are removed only after those replacements are confirmed working: the standalone `research-phase` command entry; `scripts/install-modules.js`/`scripts/health-check.js` updated to stop validating deleted stubs; final cross-milestone zero-reference grep sweep (US-14 part B)
- [x] **MILE-20**: P2 reliability quick-wins: unguarded `JSON.parse` sites wrapped with typed errors, unsanitized `execSync` replaced with `spawn`/`execFile` + argv arrays, atomic write-rename for `STATE.md`/`ROADMAP.md`/`config.json`, GitHub Actions running `npm test` on push/PR, and install hardening (hooks/dist build, timeout-wrapped PreToolUse, loud dependency failures) (US-15)

#### Telegram Escalation Reliability

- [x] **MILE-21**: Telegram escalation is hardened for unattended runs: prompt daemon-crash detection (typed error, not ~45s silent hang), single-owner question-timeout (race resolved), real file locking on JSONL state, detected/logged/retried delivery failures, and a configurable overnight blocking-question fallback (default: DEFERRED.json entry with `approver: "timeout-fallback"`, park item, continue non-dependent work) (US-16)

#### Scope Addition (2026-07-05 — all analysis-folder findings promoted; see docs/analysis/2026-07-02-deep-dive/17-scope-addition-v1.14.md)

- [x] **MILE-22**: Doc-compression hook actually fires — installer deploys `hook-config.json` to the guard path, protocol fields corrected (`tool_name`/`tool_input`), `require()`s guarded fail-open, real reduction measured; orphaned `per-turn.js` deleted; Stop hook registration timeout-wrapped (hooks analysis R-1, R-2, R-3)
- [x] **MILE-23**: `execute-roadmap` auto-resumes coordinator deaths — on subagent death matching session/quota-limit patterns, read phase CHECKPOINT.json and auto-spawn a successor from `resume_from` (with wait-until-reset when a reset time is present) and a staleness-heartbeat check (no checkpoint/transcript writes for N minutes ⇒ presumed dead); pre-flight quota estimate before a run (doc 15 S-1) — deterministic helpers + resilience CLI namespace landed in Plan 51-02; execute-roadmap.md prose wiring lands in Plan 51-03, which fully satisfies this requirement
- [x] **MILE-24**: Quota-tracker sanity — corrupted percentage readings (observed 28625%, 59196%) detected, reset, and logged loudly, never silently poisoning routing; STATE.md Current Position migrated to (or the `state advance-plan`/`update-progress` commands made tolerant of) the schema the CLI helpers expect, so manual state updates are no longer required (in-run findings, phases 44/49)
- [x] **MILE-25**: Version-skew detection — install writes a content-hash manifest + source git SHA; SessionStart (or `gsd doctor`) compares installed vs repo and warns; execute-roadmap pre-flight asserts freshness when running inside the GSD repo (doc 15 S-4, hooks R-6)
- [x] **MILE-26**: Agent self-report telemetry — coordinator/executor/verifier return contracts extended with `{context_pressure, instructions_not_followed, ambiguities, tool_errors_swallowed}`, appended to a run JSONL and surfaced in the analytics report (doc 15 S-5)
- [ ] **MILE-27**: Model-registry indirection — tier→model mapping + per-tier operating parameters read from one config-sourced registry consumed by `gsd-circuit-breaker.js`/`gsd-escalation.js`/`analytics.js` (no duplicated tier tables); `verify test-content` `countAssertions` recognizes `assert.method(` namespace style (doc 15 S-7 + Phase 48 finding)
- [ ] **MILE-28**: Workflow crash-point audit — enumerate state-mutating steps across golden-path workflows, classify idempotent/resumable/neither, fix the "neither" cases; document a quarterly upstream cherry-pick review policy and refresh UPSTREAM-DIFF.md as the first instance (doc 15 S-8, S-9)
- [ ] **MILE-29**: Behavioral eval harness — golden mini-project fixture repo + eval runner executing plan→execute→verify with cheap models, asserting on artifacts (agents spawned, gates fired, DEFERRED.json on skip, atomic commits); runnable locally and wired into CI on prompt-file changes (doc 15 S-2)
- [ ] **MILE-30**: Prompt budgets + instruction architecture — per-agent token budget enforced by a CI check (coordinator ≤8k core); hard-rules-first preamble + on-demand references applied to the 5 oversized agents (coordinator 17.5k, planner 14.5k, verifier 12.4k, debugger 9.4k, executor 9.2k); behavior preservation verified via the MILE-29 harness (doc 15 S-3)
- [ ] **MILE-31**: Prompt-injection hardening — data-not-instructions framing for file-derived content in agent prompts; injection-pattern screening at the knowledge write path (composes with the MILE-14 filter); an adversarial fixture in the eval harness that attempts to derail the executor (doc 15 S-6)

### v2 Requirements (Deferred — PRD "Phase 2")

- gsd-tools.js command-surface pruning + 4–6-module split (simplification-plan D1)
- Full agent-prompt token-dedup pass (~19–22K duplicated tokens, D2)
- Knowledge system 19→~7 file consolidation (D3)
- Command-surface honesty pass (D4)
- `analytics.js`/`savings-report.js` merge + P3 token-economy-truth backlog (C4)
- P4 structural hygiene (Windows paths, prompt-regression harness, remaining command↔workflow mismatches)
- Category B leftovers: codebase-mapping stack (B2), `join-discord`/`list-phase-assumptions` (B7)
- Config-flag replacement for `knowledge-permissions.js` boundary machinery (only if a real need surfaces)

### Out of Scope (v1.14.0)

| Feature | Reason |
|---------|---------|
| `new-project` vs `new-milestone` consolidation (D5) | Explicitly dropped by the maintainer — closed, not deferred |
| AST-based route detection for HAS_UI | Diff/extension matching sufficient until real false positives/negatives shown |
| Entropy-based secret scanning | Regex starter set is MVP; follow-up only if false-negative rate proves too high |
| Requirement-ID convention redesign for Nyquist matching | Known MVP limitation accepted; redesign is a larger separate effort |
| New CI gates (lint, typecheck, coverage thresholds) | CI scope is narrowly "run existing 155-test suite on push/PR" |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PRD-01 | Phase 41 | Pending |
| PRD-02 | Phase 41 | Pending |
| PRD-03 | Phase 41 | Pending |
| PRD-04 | Phase 41 | Pending |
| PRD-05 | Phase 41 | Pending |
| PRD-06 | Phase 41 | Pending |
| MILE-01 | Phase 42 | Pending |
| MILE-02 | Phase 42 | Pending |
| MILE-03 | Phase 42 | Pending |
| MILE-04 | Phase 42 | Pending |
| DOCS-01 | Phase 43 | Pending |
| DOCS-02 | Phase 43 | Pending |
| DOCS-03 | Phase 43 | Pending |
| DOCS-04 | Phase 43 | Pending |
| DOCS-05 | Phase 43 | Pending |
| MILE-05 | Phase 45 | Complete |
| MILE-06 | Phase 45 | Complete |
| MILE-07 | Phase 45 | Complete |
| MILE-08 | Phase 46 | Complete |
| MILE-09 | Phase 46 | Complete |
| MILE-10 | Phase 46 | Complete |
| MILE-11 | Phase 48 | Complete |
| MILE-12 | Phase 48 | Complete |
| MILE-13 | Phase 48 | Complete |
| MILE-14 | Phase 49 | Complete |
| MILE-15 | Phase 49 | Complete |
| MILE-16 | Phase 49 | Complete |
| MILE-17 | Phase 49 | Complete |
| MILE-18 | Phase 44 | Complete |
| MILE-19 | Phase 50 | Complete |
| MILE-20 | Phase 44 | Complete |
| MILE-21 | Phase 47 | Complete |
| MILE-22 | Phase 50 | Complete |
| MILE-23 | Phase 51 | Complete |
| MILE-24 | Phase 51 | Complete |
| MILE-25 | Phase 52 | Complete |
| MILE-26 | Phase 52 | Complete |
| MILE-27 | Phase 52 | Pending |
| MILE-28 | Phase 52 | Pending |
| MILE-29 | Phase 53 | Pending |
| MILE-30 | Phase 53 | Pending |
| MILE-31 | Phase 53 | Pending |

**Coverage:**
- v1.13.0 requirements: 15 total — mapped: 15, unmapped: 0 ✓
- v1.14.0 requirements: 27 total — mapped: 27, unmapped: 0 ✓ (17 original MILE-05..21 + 10 scope-addition MILE-22..31)

---
*Requirements defined: 2026-03-11 (v1.13.0), 2026-07-02 (v1.14.0)*
*Last updated: 2026-07-05 — v1.14.0 scope expanded: MILE-22..31 (all analysis-folder findings) added; Phases 51-53 created, Phase 50 extended. MILE-18 status corrected Pending→Complete (delivered in Phase 44).*
