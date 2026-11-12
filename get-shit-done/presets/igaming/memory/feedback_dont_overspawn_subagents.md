---
name: feedback_dont_overspawn_subagents
description: "Don't over-spawn or over-intervene with subagents during autonomous roadmap execution — trust the phase-coordinator's own nested agent management"
metadata: 
  node_type: memory
  type: feedback
  modified: 2026-09-11T08:31:45.694Z
  originSessionId: a1894921-c321-4953-a2e4-f815991253a7
---

Corrected 2026-08-28, mid v0.1.29 roadmap execution (after Phase 341): "don't spawn too many
subagents."

**Context this fired in:** during phases 338-341, beyond the one `gsd-phase-coordinator` per phase
(correct — matches `execute-roadmap.md`'s design), I was frequently reaching directly into that
coordinator's own NESTED sub-agents (individual `gsd-executor` instances) via `SendMessage` to
relay status, resolve wave-collision confusion, or unblock a seemingly-stalled agent — sometimes
sending near-duplicate messages to multiple candidate agent IDs when unsure which one a peer
message was meant for.

**How to apply going forward:**
- Keep the top-level pattern as-is: exactly one `gsd-phase-coordinator` per phase, spawned
  sequentially, not parallel batches, per [[user_role_ceo_cpo]]'s GSD-workflow-driven model.
- Do NOT reach past the coordinator into its own nested executors unless the coordinator itself is
  confirmed dead/stalled with no other path forward (matching the death-detection discipline
  already in [[reference_session_limit_supervisor]]) — trust the coordinator to manage its own
  wave/executor coordination; that's its job, not the top-level orchestrator's.
- When a peer-agent message arrives whose addressee is ambiguous, prefer relaying through the
  coordinator (which has the actual routing context) over broadcasting to multiple guessed agent
  IDs.

**Tightened 2026-09-11, mid v0.1.32 Phase 371 (explicit owner correction): "stop running stuff
yourself, you have specialized agents."** The narrow "gap-fill" exception below — direct top-level
`Bash(run_in_background)` polling of a preflight/test PID when a coordinator ended its turn on a
placeholder while real work was still running — is REVOKED. That session repeatedly hit coordinators
returning bare prose ("I'll wait for X") instead of real completions, and I filled the gap myself
(tracking PIDs directly, editing a test file directly, spawning ad-hoc Haiku diagnostic agents
directly) rather than pushing the responsibility back onto the agent framework. The owner's
correction makes clear this was the wrong instinct even when it produced correct results — it is not this
orchestrator's job to run or poll shell commands, edit code, or personally diagnose flakes.

**Corrected pattern:** when a coordinator/executor returns a placeholder instead of a real result,
do NOT take over the work yourself. Instead, `SendMessage`/resume that SAME agent (or respawn a
fresh one scoped to exactly the remaining work) with an explicit instruction to track its own
background command to actual completion in its own tool calls and return a real structured result —
never end its turn on a promise to report later. Verifying against on-disk artifacts
(`.preflight-passed` mtime, `VERIFICATION.md` status — see [[bug_gsd_false_gate_pass_under_resume]])
to catch a false "passed" claim is still correct and necessary; personally running the fix,
re-running the tests, or polling the process in my own Bash calls is not.

**2026-10-14 (v0.1.34 run):** the "max 2 parallel" ceiling is per spawner, so nested fan-out reached ~6 agents (+ an orphaned executor from a dead coordinator) and burned ~40% of a 5h session limit early. Brief every coordinator with a TREE-WIDE cap of 2 concurrent agents and "children spawn none"; after a coordinator death, ListAgents and TaskStop orphaned children before respawning.
**Amended same day:** the tree-wide cap of 2 applies to Sonnet/Opus agents; multiple parallel Haiku implementers on disjoint file sets are allowed (cheap), still never two gsd-executors in one phase.
