# Executor Resilience Protocol

This file documents the executor-level extension of the coordinator-death-recovery machinery that already exists in `workflows/execute-roadmap.md` (its `4a. Detect coordinator death` step — see that file for the original, roadmap-orchestrator → phase-coordinator implementation). This document covers the SAME failure modes one level down: phase-coordinator → plan-executor.

> **Scope boundary — read this before assuming this protocol "just handles" a session-limit death.** Every recovery mechanism described below — the sleep-loops, the wait-until-reset logic, the respawn — is PROSE EXECUTED BY AN LLM ORCHESTRATOR. It only fires while that specific orchestrator process is alive and able to keep running tool calls in a loop (e.g. `execute-roadmap.md`'s 4a step recovering a *spawned phase-coordinator sub-agent* that died, while the roadmap orchestrator itself survives to detect it and act). None of it can fire for the failure mode where the TOP-LEVEL orchestrator process is what dies — a process cannot observe or recover from its own death, and there is no meta-orchestrator above it within this protocol to notice. Earlier phrasing here implied this protocol was a complete answer to session-limit death; it is not, and that gap cost real debugging time chasing a "wait-until-reset" path that structurally cannot run when nothing is left running to run it.
>
> The mechanism that actually survives a top-level orchestrator death is external to this protocol and external to the Claude process entirely: an OS-level supervisor script that wraps the `claude` invocation, watches the child process, detects it dying on a session/quota limit, waits for the actual reset, and launches a **brand-new** `claude` process (no memory of the old one — it re-derives everything from `.planning/EXECUTION_LOG.md` / `CHECKPOINT.json` / `ROADMAP.md` on disk). See `workflows/execute-roadmap.md`'s `<autonomous_resumption>` section for the supervisor invocation pattern and the `GSD_AUTONOMOUS=1` contract that lets a relaunched, unattended orchestrator pass the two human-approval gates (`resume_capability`, `confirm_execution`) it would otherwise stall on with nobody present to answer them.

**Why a separate level is needed:** `execute-roadmap.md`'s 4a step detects a dead *coordinator* and resumes it from its phase-level `CHECKPOINT.json` (lifecycle granularity — which of discuss/research/plan/execute/verify ran). That granularity is too coarse for an executor: a single `execute-plan` run can contain many tasks, and a coordinator-level resume would restart the ENTIRE plan from scratch, redoing already-committed tasks. This protocol adds task-level granularity underneath it, plus a self-stop that lets an executor volunteer to hand off cleanly before it dies, instead of only being detected dead after the fact.

Two failure modes are addressed:

1. **Context overflow** — the executor's context window fills up mid-plan.
2. **Session limit death** — the account's rolling session window resets mid-plan, killing the executor.

Both are handled by the same underlying data: a per-task checkpoint that survives the executor's death, and (when the executor gets the chance) a richer handoff written just before it stops.

---

## Artifact Schemas

All three artifacts live in `.planning/phases/{phase_dir}/` and are written with the Write tool directly (plain JSON file writes — the same convention CHECKPOINT.json uses, see `checkpoints.md`). None of them are committed per-write except where noted.

### TASK-CHECKPOINT.json

Written after **every** task commit, by the executor itself (`<task_commit_protocol>` step 6 in `agents/gsd-executor.md`). Overwrite-latest — only the most recent state matters. NOT committed per-task (too noisy); it rides along in the plan's final SUMMARY.md commit, or is committed immediately if a handoff/pause fires.

```json
{
  "phase": 61,
  "plan": "61-02",
  "last_completed_task": { "index": 3, "name": "Add refresh token rotation" },
  "task_commit_hash": "a1b2c3d",
  "completed_tasks": [
    { "index": 1, "name": "Add refresh endpoint", "commit": "9f8e7d6" },
    { "index": 2, "name": "Add sliding expiry", "commit": "b2c3d4e" },
    { "index": 3, "name": "Add refresh token rotation", "commit": "a1b2c3d" }
  ],
  "next_task_index": 4,
  "timestamp": "2026-07-13T02:00:00Z"
}
```

Purpose: a continuation agent respawned after this executor dies (with no clean handoff — see PAUSED.json below) reads this file to know exactly which task to resume from, without re-deriving state from `git log`.

### EXECUTOR-HANDOFF.json

Written ONLY by the executor's own `<executor_resilience_protocol>` self-stop (`agents/gsd-executor.md`) when it voluntarily stops at a task boundary due to context pressure. Richer than TASK-CHECKPOINT.json — carries narrative state a bare task index can't. Committed immediately (`chore` commit) alongside TASK-CHECKPOINT.json, because this is a deliberate stopping point, not an ongoing-work checkpoint.

```json
{
  "phase": 61,
  "plan": "61-02",
  "reason": "context_pressure",
  "last_completed_task": { "index": 3, "name": "Add refresh token rotation" },
  "next_task_index": 4,
  "completed_task_commits": ["9f8e7d6", "b2c3d4e", "a1b2c3d"],
  "files_modified": ["apps/api/functions/auth-refresh/index.ts", "libs/domain/src/session.ts"],
  "deviations": ["[Rule 2 - Missing validation] Added input validation on refresh token format"],
  "key_decisions": ["Refresh tokens rotate on every use, not just on expiry"],
  "verification_state": "Tasks 1-3 verified individually; full plan verification not yet run",
  "resume_instructions": "Start at task 4 (revoke old refresh token on rotation). Auth module context already loaded in prior commits — no need to re-read auth-refresh/index.ts from scratch."
}
```

### PAUSED.json

Written by the **coordinator** (`workflows/execute-phase.md`), not the executor, when an executor death or a proactive usage-window check indicates the account's session limit is (or is about to be) hit. Distinct `type` values distinguish why it was written:

```json
{
  "type": "session_limit",
  "reset_time_iso": "2026-07-13T08:00:00Z",
  "phase": 61,
  "plan": "61-02",
  "task_checkpoint": { "...": "last known TASK-CHECKPOINT.json contents, verbatim" },
  "resume_instruction": "Respawn executor for plan 61-02 from TASK-CHECKPOINT.json's next_task_index once reset_time_iso has passed."
}
```

`type` is one of:
- `"session_limit"` — a reactive death detection found a session/usage/quota/rate-limit death message with a parseable reset time.
- `"usage_estimate"` — a proactive `resilience usage-window` check (see below) found accumulated usage over the configured threshold BEFORE spawning a wave, and paused preemptively rather than starting work likely to die mid-flight. In this case `task_checkpoint` is replaced by the usage-window JSON that triggered the pause, and `reset_time_iso` may be absent (session-window boundaries aren't precisely knowable from transcript scanning alone).

---

## Executor Self-Stop (context pressure)

Full text lives in `<executor_resilience_protocol>` in `agents/gsd-executor.md` — this is a summary.

At every task boundary the executor self-assesses context pressure (best-effort estimate — no tool call, just weighing tool output volume / files read / tasks done vs. remaining). At **>= 80% estimated usage with tasks still remaining**, it STOPS at the boundary: writes EXECUTOR-HANDOFF.json + TASK-CHECKPOINT.json, commits them, and returns `## PLAN INTERRUPTED — continuation needed` instead of `## PLAN COMPLETE`.

**This is correct behavior, not a failure.** The failure this exists to prevent is pushing past 80% and dying mid-task with no handoff — that loses uncommitted work and forces the coordinator to fall back to a coarser, less certain recovery path (TASK-CHECKPOINT.json alone, or worse, nothing).

---

## Coordinator-Side Handling (`workflows/execute-phase.md`)

Three entry points, all documented inline in `execute-phase.md` with pointers back here for the schemas:

### 1. Pre-spawn handoff check

Before spawning an executor for any plan, the coordinator checks for a leftover EXECUTOR-HANDOFF.json (or an orphaned TASK-CHECKPOINT.json with no matching SUMMARY.md — a death with no clean handoff) from a prior interrupted run of that same plan. If found:

1. Verify the claimed commits actually exist (`git log --oneline --all | grep`) — never trust unverifiable state.
2. Archive the handoff to `.planning/phases/{phase_dir}/resolved-handoffs/`.
3. Spawn the executor with a `<prior_executor_handoff>` block PREPENDED to the normal spawn prompt.

### 2. `<prior_executor_handoff>` continuation-spawn contract

Injected into the executor's prompt exactly like the existing `<completed_plans_context>` block used for Wave 2+ spawns (see `execute-phase.md`'s `execute_waves` step) — same mechanism, one plan instead of many:

```
<prior_executor_handoff>
A previous executor run on this plan stopped at task {next_task_index - 1} ({reason}).
Do NOT redo these completed tasks — their commits already exist:
{completed_task_commits, one per line, with task names}

Key decisions already made: {key_decisions}
Files already modified: {files_modified}
Resume from task {next_task_index}. {resume_instructions}
</prior_executor_handoff>
```

### 3. Executor death / clean interruption detection

Runs in `execute-phase.md`'s `handle_failure` step, BEFORE the existing retry/debug/escalate ladder. An executor's return means one of:

| Return shape | Meaning | Coordinator action |
|---|---|---|
| `## PLAN INTERRUPTED — continuation needed` | Clean self-stop, EXECUTOR-HANDOFF.json written | Same as pre-spawn handoff (above) — immediate continuation respawn. NOT a retry/failure. |
| `Agent()` threw, or return doesn't parse as PLAN COMPLETE / checkpoint / PLAN INTERRUPTED, AND `resilience parse-death` matches with a reset time | Session/quota-limit death | Write PAUSED.json (`type: "session_limit"`). If wait < 30 min: sleep-loop (same pattern as `execute-roadmap.md` 4a) then respawn. If wait >= 30 min or reset time implausible: return `status: "paused_session_limit"` to this coordinator's own caller instead of blocking its own context for hours. |
| Same, but no reset time AND `resilience check-staleness` on TASK-CHECKPOINT.json reports `stale: true` | Context-overflow death, no clean handoff, but committed work exists | Same as pre-spawn handoff — immediate continuation respawn from TASK-CHECKPOINT.json. No waiting; nothing to wait for. |
| Neither of the above | Genuine task-logic failure | Falls through to the existing `execution-state record-failure` retry/debug/escalate ladder, unchanged. |

The wait-vs-bubble-up split (30 minutes) exists because a coordinator sleeping for hours risks becoming the next death itself — better to hand the wait off to whatever is driving this coordinator (the roadmap orchestrator, or the main session) than to block silently.

---

## Usage Estimator (`resilience usage-window`)

```bash
node gsd-tools.js resilience usage-window [--hours 5]
```

Scans every `~/.claude/projects/{slug}/*.jsonl` transcript file (not just the current project) for message entries with a `timestamp` inside the trailing N-hour window, and sums their `message.usage` fields (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). Returns:

```json
{
  "window_hours": 5,
  "total_tokens": 111999182,
  "input_tokens": 169915,
  "output_tokens": 472927,
  "cache_creation_tokens": 9267646,
  "cache_read_tokens": 102088694,
  "by_model_family": { "opus": 63026594, "sonnet": 0, "haiku": 0, "fable": 48972588 },
  "messages_count": 357
}
```

### Wiring into `execute-phase.md`

Before spawning each wave, the coordinator reads `resilience.usage_pause_threshold_tokens` from config (`node gsd-tools.js config get usage_pause_threshold_tokens`). **Default is `null` (off) — zero behavior change unless a project explicitly opts in.** When set and `total_tokens >= threshold`: write PAUSED.json (`type: "usage_estimate"`) and return `status: "paused_session_limit"` instead of starting a wave likely to die mid-flight.

### Calibration caveat — read before enabling

This is an **estimate**, not an authoritative quota figure:

- It sums transcript-reported `usage` blocks across ALL projects sharing this machine's `~/.claude/projects/`, not just this one — a busy unrelated project inflates the number.
- Transcript `usage` is per-API-call and may include retried/superseded calls.
- It has no visibility into the account's actual rolling session-limit window boundary — a 5-hour lookback is a proxy, not the real window.
- There is no built-in default threshold. A project must measure its own account's real ceiling and set `resilience.usage_pause_threshold_tokens` with a safety margin below it. Leave it unset until you've done that measurement.

---

## Config

`.planning/config.json`:

```json
{
  "resilience": {
    "staleness_threshold_minutes": 30,
    "usage_pause_threshold_tokens": null
  }
}
```

Both keys are read via `loadConfig()` in `gsd-tools.js` with the same "top-level key or nested `resilience.*` section" fallback used throughout the config system — `node gsd-tools.js config get staleness_threshold_minutes` / `config get usage_pause_threshold_tokens`.

---

## Relationship to coordinator-level resilience

| | Coordinator death (`execute-roadmap.md` 4a) | Executor death (this document) |
|---|---|---|
| Detected by | Roadmap orchestrator | Phase coordinator (`execute-phase.md`) |
| Granularity | Lifecycle step (discuss/research/plan/execute/verify) | Task index within a single plan |
| Self-stop available | No — coordinator is only detected dead after the fact | Yes — `<executor_resilience_protocol>` lets the executor volunteer a clean stop before dying |
| Resume artifact | Phase `CHECKPOINT.json` | `TASK-CHECKPOINT.json` (forced) or `EXECUTOR-HANDOFF.json` (clean stop) |
| Wait/respawn pattern | Sleep-loop capped at 6h, always local to the roadmap orchestrator | Same sleep-loop pattern, but bubbles up to the coordinator's own caller if the wait is >= 30 minutes (a phase coordinator has less budget to spend sleeping than the top-level roadmap orchestrator) |

Both layers log distinct `execution-log event --type` values so a post-mortem can tell which layer intervened: coordinator-level events are `coordinator_death_detected` / `auto_resume_spawned` / `death_reset_time_implausible` (unchanged, existing); executor-level events are `executor_clean_interruption` / `executor_death_detected` / `usage_pause_triggered`.
