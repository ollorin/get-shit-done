# v1.14.0 Scope Addition — Analysis-Folder Findings Promoted

**Date:** 2026-07-05
**Maintainer decision (recorded from live session):** "add S-1 auto-resume to v1.14.0 scope, and all other findings from folder with analysis."
**Status:** STAGED — to be applied to ROADMAP.md/REQUIREMENTS.md/PROJECT.md in the orchestrator's gate window after Phase 49 completes (avoiding concurrent-edit race with the running coordinator). Once applied, this doc is the traceability record.

Sources: [15-model-perspective-additions.md](15-model-perspective-additions.md) (S-1..S-9), [16-hooks-analysis.md](16-hooks-analysis.md) (R-1..R-6), plus in-run findings (quota tracker corruption, STATE.md schema mismatch, countAssertions regex). rtk items (R-4, R-5) are NOT included — separate repo, filed separately.

## New requirements (continue from MILE-21)

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| MILE-22 | Doc-compression hook actually fires: installer deploys hook-config.json to the guard path, protocol fields corrected (tool_name/tool_input), requires guarded fail-open, reduction measured with real metrics; orphaned per-turn.js deleted; Stop hook registration timeout-wrapped | R-1, R-2, R-3 | 50 (extended) |
| MILE-23 | execute-roadmap auto-resumes coordinator deaths: on subagent death matching session/quota-limit patterns, read phase CHECKPOINT.json and auto-spawn successor from resume_from (with wait-until-reset option when a reset time is present); pre-flight quota estimate before starting a run | S-1 | 51 |
| MILE-24 | Quota tracker sanity: corrupted percentage readings (observed 28625%, 59196%) detected and self-healed (reset + loud log), never silently poisoning routing; STATE.md Current Position migrated to the schema `state advance-plan`/`update-progress` expect (or the commands made format-tolerant) so manual state updates are no longer required | in-run findings (phases 44, 49) | 51 |
| MILE-25 | Version-skew detection: install writes a content-hash manifest + source git SHA; SessionStart (or `gsd doctor`) compares installed vs repo and warns; execute-roadmap pre-flight asserts freshness when running in the GSD repo itself | S-4, R-6 | 52 |
| MILE-26 | Agent self-report telemetry: coordinator/executor/verifier return contracts extended with {context_pressure, instructions_not_followed, ambiguities, tool_errors_swallowed}; appended to a run JSONL; surfaced in analytics report | S-5 | 52 |
| MILE-27 | Model-registry indirection: tier→model mapping + per-tier operating parameters read from one config-sourced registry; gsd-circuit-breaker.js, gsd-escalation.js, analytics.js consume it (no duplicated tier tables); `verify test-content` countAssertions recognizes `assert.method(` namespace style | S-7 + Phase 48 finding | 52 |
| MILE-28 | Workflow crash-point audit: enumerate state-mutating steps across golden-path workflows, classify idempotent/resumable/neither, fix the "neither" cases; document a quarterly upstream cherry-pick review policy (refresh UPSTREAM-DIFF.md as first instance) | S-8, S-9 | 52 |
| MILE-29 | Behavioral eval harness: golden mini-project fixture repo + eval runner executing plan→execute→verify with cheap models, asserting on artifacts (agents spawned, gates fired, DEFERRED.json written on skip, commits atomic); runnable locally and wired into CI on prompt-file changes | S-2 | 53 |
| MILE-30 | Prompt budgets + instruction architecture: per-agent token budget enforced by CI check (coordinator ≤8k core); hard-rules-first preamble + on-demand references convention applied to the 5 oversized agents (coordinator 17.5k, planner 14.5k, verifier 12.4k, debugger 9.4k, executor 9.2k); behavior preservation verified via MILE-29 harness | S-3 | 53 |
| MILE-31 | Prompt-injection hardening: data-not-instructions framing convention for file-derived content in agent prompts; injection-pattern screening at the knowledge write path (composes with the US-10 filter); adversarial fixture in the eval harness that attempts to derail the executor | S-6 | 53 |

## New phases

### Phase 50 (EXTENDED — was "Final Deletions & Verification Sweep")
Adds MILE-22 to existing MILE-19. New success criteria: compression hook fires on a real Read (metrics JSONL non-empty) with measured reduction reported; per-turn.js gone (fresh grep); Stop hook has a timeout in the deployed settings registration.

### Phase 51: Run Resilience — Auto-Resume & State Sanity (MILE-23, MILE-24)
**Goal:** An overnight run survives coordinator deaths without human forensics — provider-limit deaths auto-resume from checkpoints, quota readings can't silently poison routing, and state helpers work against the real STATE.md.
**Depends on:** 50. Evidence: three live coordinator deaths this run (2026-07-02, 07-04, 07-05), each recovered manually; corrupted quota readings in phases 44/49; STATE.md schema mismatch deferred since 44-01.
Success criteria (sketch): kill a coordinator mid-phase in a test harness → orchestrator respawns successor from CHECKPOINT.json without human input; quota file corrupted → detected, reset, logged loudly, routing falls back cleanly; `state advance-plan` works against the repo's actual STATE.md.

### Phase 52: Skew Detection, Telemetry & Registry (MILE-25, MILE-26, MILE-27, MILE-28)
**Goal:** The framework can tell when it's stale, agents report their own failure modes, model knowledge lives in one place, and state-mutating workflow steps are crash-safe.
**Depends on:** 51 (self-report rides the same return-contract changes auto-resume touches).

### Phase 53: Eval Harness & Prompt Hygiene (MILE-29, MILE-30, MILE-31)
**Goal:** Prompt and workflow changes are measurable, prompts fit in budget with hard rules up front, and file-derived content can't hijack agents.
**Depends on:** 52 (eval harness asserts on telemetry + skew-clean installs). Ordered last: largest, and every earlier phase's changes become its test corpus.

## Application checklist (orchestrator, at Phase 49 gate)
1. Append MILE-22..MILE-31 to REQUIREMENTS.md with traceability rows (Phase 50-53, Pending).
2. Extend Phase 50 section in ROADMAP.md (goal line + MILE-22 + new success criteria); append Phase 51/52/53 sections; update Milestones header line (44-53) and Progress table.
3. Update PROJECT.md Current Milestone target-features list with the addition summary.
4. Log `scope_added` event to EXECUTION_LOG.md; notify Telegram topic 3208.
5. Spawn Phase 50 with the extended scope; then 51 → 52 → 53 sequentially before pre-PR gates.
