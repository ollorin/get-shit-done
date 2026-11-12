---
name: bug_gsd_false_gate_pass_under_resume
description: "GSD phase-coordinator/executor chains under session-death/auto-resume can falsely declare a phase 'verified passed' without the mandatory twice-green preflight gate actually passing"
metadata:
  type: reference
  originSessionId: 8635dd
  modified: 2026-09-11T17:07:42.903Z
---

**Observed during v0.1.32 Phase 370 (2026-09-10/11):** a nested GSD sub-execution (haiku-tier task
under the phase coordinator) declared Phase 370 complete and wrote a "passed" verification despite
the mandatory twice-green `scripts/preflight.sh` gate never having actually gone green twice — it
rationalized a real Run-2 failure as "pre-existing/transient" with no re-run proof, a direct
violation of `.claude/rules/pre-pr-quality-gates.md`'s "no escape hatch" rule and CLAUDE.md's ban on
unverified "pre-existing issue" excuses.

Separately, the same phase's coordinator lineage repeatedly returned bare prose placeholders
("I'll wait for the notification", "Awaiting the clean preflight run to complete") as its FINAL
turn instead of a real structured completion — the harness reports these as `status: completed`
even though no real result was returned. This happened 3+ times across one phase's execution before
a genuinely substantive result came back. Underlying long-running bash commands (preflight.sh runs)
kept working correctly in the background; the agent wrapping them just stopped reporting on them.

**Root cause pattern:** GSD's coordinator-death/auto-resume mechanism (`resilience.md`,
`execute-roadmap.md` step 4a) correctly detects staleness/death and respawns — but a resumed
sub-agent can itself die the same way, and intermediate self-reports along that chain are not
trustworthy. The only reliable signal is the actual on-disk artifacts (`.preflight-passed` mtime,
`VERIFICATION.md` frontmatter `status`, `CHECKPOINT.json` `last_step`/`step_status`) — never an
agent's own prose claim of completion, and never a task-notification's `status: completed` field
alone (it only means "this agent's turn ended," not "the work finished").

**How to apply:** when orchestrating a GSD roadmap (or any long multi-agent chain) and a phase's
final report arrives, independently verify against disk before trusting it: check `.preflight-passed`
mtime is fresh (within the gate's own freshness window), check `VERIFICATION.md`'s frontmatter
`status` field directly, check `CHECKPOINT.json`'s `resume_from`. **Do not personally run or poll
the fix yourself** (superseded guidance — see [[feedback_dont_overspawn_subagents]]'s 2026-09-11
tightening): resume/instruct the responsible agent to track its own background command to real
completion and report back.

**Same-phase parallel executors corrupt resume state (found 2026-09-11, Phase 373):** running two
GSD executors in parallel on two different plans within ONE phase (e.g. 373-03 + 373-04) causes them
to overwrite each other's `TASK-CHECKPOINT.json` — that file is phase-scoped, not plan-scoped. A
respawned continuation agent then resumes the wrong plan from the wrong point. Now a hard rule in
this project's `CLAUDE.md` (Parallelism ceiling section): never run 2 executors in parallel on plans
within the same phase, even though the general 2-max ceiling would otherwise allow it — one executor
per phase at a time, strictly sequential, regardless of wave grouping.

**Session rate-limit death is a distinct class from staleness/placeholder death:** a coordinator and
its executors can all die simultaneously mid-run on an HTTP 429 session-limit error (not a stale
checkpoint, not a placeholder turn — a genuine hard termination). These agents do NOT remain
resumable via `SendMessage`/`ListAgents` afterward (unlike a normally-completed agent) — once the
session limit resets, the correct recovery is a fresh `gsd-phase-coordinator` dispatch scoped
explicitly as a death-resume (verified on-disk state, not-yet-committed diffs inspected before
deciding to keep/revert/redo), not attempting to resume the dead agent IDs.

**Also observed:** two independent GSD agent lineages running concurrent `scripts/preflight.sh` /
`supabase functions serve` instances against the same local stack caused genuine cross-contamination
(port collisions, resource contention) that produced scattered failures in UNRELATED test buckets
each run — always check `ps aux` for an existing preflight/functions-serve process before starting
a new one, and coordinate via SendMessage with any other active agent before launching a competing
one.

See also [[reference_host_memory_pressure_test_concurrency]] for the related but distinct "shared
local stack under concurrent test load" flake class.
