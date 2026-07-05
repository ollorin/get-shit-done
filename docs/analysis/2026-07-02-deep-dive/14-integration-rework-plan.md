# Integration & Rework Plan — "Inject, Don't Delete"

**Date:** 2026-07-02
**Maintainer decisions that shaped this doc** (recorded from live session):
1. Satellite stacks: don't just delete — evaluate injecting them into the golden path (prd → new-milestone → execute-roadmap → complete-milestone) so they run automatically.
2. Knowledge maintenance CLI: review purpose/value of each module, then rework + rewire so it works **automatically** (nobody runs manual maintenance commands).
3. `/gsd:new-project`: **leave as-is** (decision closed; simplification plan D5 dropped).
4. Sequencing: no preference; this plan supersedes the "decisions needed" section of [13-simplification-plan.md](13-simplification-plan.md).

**Detail inputs:** [14a-knowledge-modules-review.md](14a-knowledge-modules-review.md) (per-module purpose/state/value), [14b-injection-points.md](14b-injection-points.md) (exact hook points in golden-path files). Verdicts below are the main session's synthesis — where they differ from 14a/14b's raw suggestions, this doc wins.

## Part 1 — Satellite stacks: injection design

Ordered by implementation risk (lowest first, per 14b):

### 1.1 Conversation mining → `complete-milestone` (lowest risk, do first)
- **Hook:** new step in `workflows/complete-milestone.md` right after archival: spawn conversation-miner over the milestone's session date range → knowledge DB + `milestones/v{X}-KNOWLEDge.md` metadata.
- **Trigger:** always, behind `auto_mine: true` config toggle.
- **Guard:** dedup against what session-end hooks already extracted (three-stage dedup exists in the write path — verify it catches re-mining).
- **Consequence:** `/gsd:mine-conversations` stays as manual backfill for pre-GSD history; `analyze-pending-sessions` workflow becomes reachable (was entry-less).

### 1.2 Nyquist auditor → verifier gate (converges with P0-6)
- **Hook:** `agents/gsd-verifier.md` init: requirement-to-test coverage scan; if gaps → spawn `gsd-nyquist-auditor` as a **blocking** step, wired into the execute-phase pre-verify gates.
- **Trigger:** requirement-to-test gaps detected; dormant when no requirements/tests apply.
- **Consequence:** `/gsd:validate-phase` (retroactive manual) becomes redundant → delete the standalone command after this lands. This is the enforcement-gap fix (P0) absorbing a satellite, exactly the right pattern.

### 1.3 Discovery → confidence-gated stage inside `/gsd:prd`
- **Hook:** `workflows/prd.md` after Q&A loops (steps 1d/2d): when confidence < ~0.5 on unresolved dimensions, auto-spawn parallel `gsd-product-investigator` agents targeted at the gaps; `gsd-discovery-synthesizer` merges results into the PRD draft.
- **Trigger:** low confidence only; dormant when the concept is already clear (≥ ~0.65).
- **Token control:** investigators run on Haiku; cap the fan-out (14b flags 80–100k concurrent tokens if uncapped).
- **Consequence:** standalone `discover`/`discovery-phase` workflows + `skills/gsd-discover` fold in and the standalones get deleted. PRD quality is the single highest-leverage input to an overnight run — this is where discovery belongs.

### 1.4 Debugger → execution failure paths (highest value for overnight autonomy, most complex)
- **Hooks:** `workflows/execute-phase.md` plan-failure handling and `workflows/execute-roadmap.md` `handle_failure`: on **2nd failure of the same task/phase**, auto-spawn `gsd-debugger` (scientific-method investigation, persistent debug state) instead of blind retry or immediate Telegram escalation. Escalate to Telegram only with the debugger's findings attached.
- **Trigger:** repeat failure; first failure keeps the current cheap retry.
- **Prerequisite:** the missing `workflows/debug.md` must be rebuilt in slim form (the agent 36.8K prompt exists and is the substance; the orchestration wrapper is what's missing).
- **Consequence:** overnight runs stop dying (or stalling on escalations) for bugs a systematic investigation could clear autonomously. This directly serves the "execute fully overnight" use case.

## Part 2 — Knowledge maintenance: automatic wiring

Write-path (every knowledge write — cheap, always on):
| Module | Purpose | Wiring |
|--------|---------|--------|
| knowledge-dedup / knowledge-evolution | duplicate detection / entry evolution | already in write path — keep; fix the storeInsights transaction race (doc 06) |
| knowledge-safety | write-guard | wire into `knowledge-writer.storeInsights`; **note: 14a found NO real secrets/PII filtering exists anywhere — build it into this module; genuine gap for a DB fed by automatic extraction** |
| knowledge-cost | budget circuit breaker | check before extraction/embedding batches (mining, session-end); auto-enable with config budget |

Event-triggered:
| Module | Purpose | Wiring |
|--------|---------|--------|
| knowledge-lifecycle | TTL pruning of stale entries | auto at session-end hook or milestone completion (cheap) |
| knowledge-feedback | mark wrong/outdated knowledge | auto-trigger when verifier/executor finds a knowledge-DB answer was wrong — closes the quality loop that manual CLI never closed |
| knowledge-checkpoint | DB snapshot/restore | auto-checkpoint before bulk ops (mining runs, backfills) |

Milestone-cadence batch ("knowledge consolidation pass" at complete-milestone, alongside 1.1):
| Module | Purpose | Wiring |
|--------|---------|--------|
| knowledge-synthesis + knowledge-principles | consolidate accumulated entries into higher-level principles (a known deferred roadmap item) | run once per milestone; NOT "before every agent action" (14a's suggestion — rejected as token-prohibitive) |
| knowledge-conflicts | detect contradictory entries | run inside the same consolidation pass |

Still delete (low value even reworked):
- **knowledge-qa.js, knowledge-scan.js** — 14a rates Low; purposes overlap with the write-path guards above.
- **knowledge-permissions.js** — cross-project permission machinery is overkill for a solo maintainer; replace with a config flag if any boundary is needed, delete the grant/revoke CLI surface.

## Part 3 — What this changes in the simplification plan (doc 13)

- **B1 discovery / B3 mining / B4 debugger / B5 nyquist:** delete-candidates → **integrate per Part 1**, then delete only the standalone entry points that the integration obsoletes.
- **A1:** shrinks — conflicts/principles/synthesis come back to life (Part 2 batch pass); **qa/safety/scan**: qa + scan still deleted, safety is reworked into the write guard.
- **B8:** knowledge CLI subcommands survive only as thin manual overrides on top of the automatic triggers; permissions surface deleted.
- **D5 (new-project collapse): dropped** — maintainer keeps it as-is.
- Everything else in doc 13 (Category A remainder, C, D1–D4) stands.

## Part 4 — Resulting milestone shape

All of this composes into one coherent milestone — **"Enforcement & Integration"** — with two thrusts that share the same philosophy (*mandatory things become deterministic and automatic*):
1. **P0 enforcement gates** (master summary): deterministic phase-gate, diff-based UI detection, structured deferral, auto-E2E-generation, blocking docs, test-content gate — with Nyquist injection (1.2) folded in.
2. **Integrations** (this doc): mining→milestone, discovery→prd, debugger→failure paths, knowledge auto-wiring.
Plus the P2 quick wins (JSON.parse guards, execSync, locking, CI) as low-risk parallel work, and doc 13 Category A deletions (as amended by Part 3) as the cleanup wave.

Suggested implementation order within the milestone (risk-ascending, per 14b): quick wins + deletions → mining → nyquist/P0 gates → knowledge write-path wiring → discovery → debugger.
