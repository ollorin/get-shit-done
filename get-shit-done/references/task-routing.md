# Per-task executor routing

The standard path of `workflows/execute-phase.md` `execute_waves` at every rigour except spike (a spike plan is one executor on `executor_model`). The tool does the arithmetic (`routing escalation-decision`); this file only sequences it. The ladder is haiku, then sonnet; nothing escalates past sonnet.

<step name="per_task_routing">

**1. Read the tiers.** For each `<task>` of the plan (1-based `task_index`), in dependency and wave order: the tier is the `<model>` element text, else the `tier="..."` attribute of the `<task>` tag, case-insensitive; `verify form --plans-only` demands one at plan time, and a task still without a tag at execute time (a plan written before the rule) runs on `sonnet` (`phase-plan-index` lists each plan's `task_tiers` with that default applied). Keep `ROUTING_STATS` (count per tier).

**2. Spawn one executor per task, sequentially** (tasks may depend on each other). For each task:

1. `ROUTING_STATS[TASK_TIER] += 1`, then spawn:

```
Agent(
  subagent_type="gsd-executor",
  model="{TASK_TIER}",
  description="Execute task {task_index}",
  prompt="
    <objective>
    Execute task {task_index} of plan {plan_number} in phase {phase_number}-{phase_name}.
    Commit the task atomically. If this is the last task, create SUMMARY.md and update STATE.md.
    </objective>
    <execution_context>
    @~/.claude/get-shit-done/workflows/execute-plan.md
    @~/.claude/get-shit-done/templates/summary.md
    @~/.claude/get-shit-done/references/checkpoints.md
    @~/.claude/get-shit-done/references/tdd.md
    @~/.claude/get-shit-done/references/handoff-brief.md
    </execution_context>
    <handoff_brief>
    {HANDOFF_BRIEF: the 5 fixed sections per references/handoff-brief.md, as assembled in execute-phase}
    </handoff_brief>
    <files_to_read>
    - Plan: {phase_dir}/{plan_file}
    - State: .planning/STATE.md
    - Config: .planning/config.json (if exists)
    </files_to_read>
    <routing_context>
    Per-task routing active. This task routed to {TASK_TIER}.
    Task index: {task_index}
    </routing_context>
    <resume_from_task>{task_index}</resume_from_task>
  "
)
```

2. Wait for the executor to finish before spawning the next task.
3. On return, derive the task type once (best-effort; on failure use `other`): `node ~/.claude/get-shit-done/bin/gsd-tools.js routing task-type "{task_name}" --raw`.

**3. Success** (the return does not contain `TASK FAILED:`): log ONE outcome and record token usage (best-effort, never blocks), then go to the next task.
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event --type task_outcome \
  --data '{"phase":{phase_number},"plan":"{plan_file}","task_index":{task_index},"task_name":"{task_name}","task_type":"{TASK_TYPE_FOR_LOGGING}","tier":"{TASK_TIER}","outcome":"success","capability_related":true}'
node ~/.claude/get-shit-done/bin/gsd-tools.js token-usage record \
  --phase {phase_number} --plan "{plan_file}" --task-index {task_index} --task-name "{task_name}" --tier "{TASK_TIER}" --raw
```

**4. Failure** (the return contains `TASK FAILED:`): run the bounded escalation loop. `CURRENT_SIGNAL_TIER` is the tier in the signal's `[tier: X]` tag (no tag: routing was not active for this task, record it failed, no escalation, next task). `ERROR_SUMMARY` is the text after the final ` — `. `IS_NON_CAPABILITY_TAGGED` is true when the signal contains `[non-capability]`. `ESCALATIONS_USED = 0`.

LOOP (`FAILS_AT_TIER` starts at 1; a task escalates only on its second failure at a tier):
1. `DECISION_JSON = node ~/.claude/get-shit-done/bin/gsd-tools.js routing escalation-decision --current-tier "{CURRENT_SIGNAL_TIER}" --error-summary "{ERROR_SUMMARY}" --escalations-used {ESCALATIONS_USED} --raw`. The executor's own `[non-capability]` tag is authoritative: `EFFECTIVE_ESCALATE = DECISION_JSON.escalate AND (NOT IS_NON_CAPABILITY_TAGGED)`, `EFFECTIVE_REASON = "non_capability_failure"` when tagged, else `DECISION_JSON.reason`.
2. Log ONE failed-attempt outcome and its token usage:
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event --type task_outcome \
  --data '{"phase":{phase_number},"plan":"{plan_file}","task_index":{task_index},"task_name":"{task_name}","task_type":"{TASK_TYPE_FOR_LOGGING}","tier":"{CURRENT_SIGNAL_TIER}","outcome":"failure","capability_related":{true unless IS_NON_CAPABILITY_TAGGED}}'
node ~/.claude/get-shit-done/bin/gsd-tools.js token-usage record \
  --phase {phase_number} --plan "{plan_file}" --task-index {task_index} --task-name "{task_name}" --tier "{CURRENT_SIGNAL_TIER}" --raw
```
3. `EFFECTIVE_REASON` is not `non_capability_failure` and `FAILS_AT_TIER` is 1: `FAILS_AT_TIER = 2`, re-spawn the same task on the same tier, and on `TASK FAILED:` GOTO LOOP. `EFFECTIVE_ESCALATE` true and `FAILS_AT_TIER` is 2 (haiku only): `FAILS_AT_TIER = 1`, log `tier_escalation`, move one count in `ROUTING_STATS`, `ESCALATIONS_USED += 1`, re-spawn the same task with `TASK_TIER = DECISION_JSON.next_tier`, wait.
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event --type tier_escalation \
  --data '{"phase":{phase_number},"plan":"{plan_file}","task_index":{task_index},"task_name":"{task_name}","task_type":"{TASK_TYPE_FOR_LOGGING}","from_tier":"{CURRENT_SIGNAL_TIER}","to_tier":"{DECISION_JSON.next_tier}","reason":"{EFFECTIVE_REASON}"}'
```
   Still `TASK FAILED:`: refresh the three signal variables and GOTO LOOP (the tool bounds it: `escalate: false` once the ladder's bound is reached or the top tier failed). Succeeded: log ONE success outcome and its token usage at the FINAL tier, then the next task.
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event --type task_outcome \
  --data '{"phase":{phase_number},"plan":"{plan_file}","task_index":{task_index},"task_name":"{task_name}","task_type":"{TASK_TYPE_FOR_LOGGING}","tier":"{TASK_TIER}","outcome":"success","capability_related":true}'
node ~/.claude/get-shit-done/bin/gsd-tools.js token-usage record \
  --phase {phase_number} --plan "{plan_file}" --task-index {task_index} --task-name "{task_name}" --tier "{TASK_TIER}" --raw
```
4. Otherwise (a sonnet task that fails twice always lands here, never escalated further) log "Task {task_index} failed at {CURRENT_SIGNAL_TIER}, {EFFECTIVE_REASON}, no further escalation", record the task failed and continue; it falls into execute-phase's failure handling.

Escalation applies ONLY to capability-related errors signalled by the executor. Output-quality issues never trigger it; a `[non-capability]` failure (missing file, environment error) is recorded failed at once and is never escalated. The ladder lives in the tool (`routing escalation-decision`); never write a second ladder inline.

**5. After ALL plans and waves of the phase** (and before `post_phase_ux_sweep`): `node ~/.claude/get-shit-done/bin/gsd-tools.js routing ledger build --raw`, best-effort and idempotent: it folds every `task_outcome` and `tier_escalation` event into `.planning/routing-ledger.json`.

</step>
