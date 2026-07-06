# Handoff Brief — Fixed 5-Section Structure

**Design decision (rationale):** The handoff brief is defined ONCE here and reused
verbatim at both the coordinator -> executor and executor -> verifier boundaries
(Plan 04). It formalizes the lightweight ad-hoc `handoff_summary` in
`coordinator-detail.md`'s `context_budget_monitoring` (phase goal, key decisions,
tasks completed, files modified) into a fixed 5-section structure so long runs stay
on-constraint across agent boundaries, instead of each spawn site improvising its
own shape. It does not discard that lightweight summary's intent — it gives it a
canonical, enforceable form that a pure function can assemble and validate.

## The 5 Sections (exact order)

1. **Phase Goal** (field key: `phase_goal`) — the outcome-shaped goal from ROADMAP.md
   for the current phase.
2. **Key Decisions** (field key: `key_decisions`) — locked decisions/constraints for
   this phase that the receiving agent must not re-litigate.
3. **Open Risks** (field key: `open_risks`) — known risks / watch-items still live
   for this phase.
4. **File Map** (field key: `file_map`) — the files this phase owns/touches.
5. **Hard Rules** (field key: `hard_rules`) — non-negotiable rules the receiving
   agent MUST honor.

Each section may be supplied as a plain string or an array of strings (arrays
render as one bullet per line). A missing or blank section still renders under
its label with the placeholder `(none provided)` — the fixed 5-section structure
is never collapsed or omitted, only degraded.

## How it is injected

The coordinator calls `buildHandoffBrief(fields)` (in `get-shit-done/bin/gsd-tools.js`,
also reachable via `gsd-tools.js handoff brief --json '{...}'`), wraps the resulting
`brief_text` in a `<handoff_brief>` block in the executor and verifier spawn
prompts, and @-mentions this file so the receiving agent can see the canonical
structure definition, not just the filled-in instance.

## Hard Rules here are a HANDOFF echo, not the source of truth

The `hard_rules` section in a handoff brief is a point-in-time echo, useful for
keeping a freshly spawned agent on-constraint without it having to re-read every
source file. It is NOT the authoritative source. On checkpoint RESUME, hard
rules/invariants are re-read verbatim from source files (ROADMAP.md) — that
re-injection is Plan 02's job, not this brief's. A handoff brief that goes stale
(e.g. a decision changes after the brief was built) must never be treated as
overriding a fresh re-read of ROADMAP.md.
