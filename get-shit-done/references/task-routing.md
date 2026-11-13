# Per-task executor routing

The standard path of `workflows/execute-phase.md` `execute_waves` at every rigour except spike (a spike plan is one executor on `executor_model`). The tool does the arithmetic (`routing escalation-decision`); this file only sequences it. The ladder is haiku, then sonnet; executors never escalate past sonnet. One last rung, the rescue, is a single top-model debugger dispatch (step 4).

<step name="per_task_routing">

**1. Read the tiers.** For each `<task>` of the plan (1-based `task_index`), in dependency and wave order: the tier is the `<model>` element text, else the `tier="..."` attribute of the `<task>` tag, case-insensitive; `verify form --plans-only` demands one at plan time, and a task still without a tag at execute time (a plan written before the rule) runs on `sonnet` (`phase-plan-index` lists each plan's `task_tiers` with that default applied). Keep `ROUTING_STATS` (count per tier).

**2. Spawn one executor per dispatch, sequentially** (tasks may depend on each other). A dispatch is one task, except that consecutive `haiku` tasks of one plan with no `sonnet` task between them are ONE group dispatch (`task_index` = the group's first task, `last_index` = its last): the executor does them in order, one commit per task. A failure in a group is signalled for the failed task (tasks before it are committed): retry that task alone under step 4, then continue with the rest of the group as a new dispatch. Escalation applies to the failed task exactly as below. For each dispatch:

1. `ROUTING_STATS[TASK_TIER] += 1`, then spawn. A task executor loads `references/executor-task.md` and nothing else of the executor's long files: the prompt names that file, the plan path and the task number. `templates/summary.md` is added only when the dispatch includes the LAST task of the plan, `references/checkpoints.md` only for a `checkpoint:*` task. There is no handoff brief: the task's own `Rules applied:` lines carry the rules.

```
Agent(
  subagent_type="gsd-executor",
  model="{TASK_TIER}",
  description="Execute task {task_index}",
  prompt="
    <objective>
    Execute task {task_index}{ through {last_index} for a group} of plan {plan_number} in phase {phase_number}-{phase_name}.
    Commit each task atomically. If the last task of the plan is among them, finish the plan (executor-task.md, Last task of the plan).
    </objective>
    <execution_context>
    @~/.claude/get-shit-done/references/executor-task.md
    {dispatch includes the plan's last task: @~/.claude/get-shit-done/templates/summary.md}
    {checkpoint task only: @~/.claude/get-shit-done/references/checkpoints.md}
    </execution_context>
    <files_to_read>
    - Plan: {phase_dir}/{plan_file} (your task(s) only)
    - Brief and profile: {brief_path}, {stack_profile_path}
    </files_to_read>
    stack_commands: {stack_commands, verbatim}
    rigour: {rigour}
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
4. `DECISION_JSON.rescue` true, `EFFECTIVE_ESCALATE` false, `[non-capability]` absent and `FAILS_AT_TIER` is 2 (a sonnet-tier task, tagged or escalated, fails twice): the rescue, ONCE per task. Log `tier_escalation` with `"to_tier":"{DECISION_JSON.to}","rescue":true,"reason":"{EFFECTIVE_REASON}"`, then spawn `gsd-debugger` on `model="{DECISION_JSON.to}"` (`ruling_model`; a rejected spawn retries once on `ruling_model_fallback` and says so) for this task, in place of any sonnet debugger dispatch. Its brief: find the root cause, then either fix and verify it, or return the task to the planner with a written reason the plan is not executable as written (plan revision or blocked path). No second top-model attempt for the task.
5. Otherwise log "Task {task_index} failed at {CURRENT_SIGNAL_TIER}, {EFFECTIVE_REASON}, no further escalation", record the task failed and continue; it falls into execute-phase's failure handling.

Escalation applies ONLY to capability-related errors signalled by the executor. Output-quality issues never trigger it; a `[non-capability]` failure (missing file, environment error) is recorded failed at once and is never escalated. The ladder lives in the tool (`routing escalation-decision`); never write a second ladder inline.

**6. After ALL plans and waves of the phase** (and before `post_phase_ux_sweep`): `node ~/.claude/get-shit-done/bin/gsd-tools.js routing ledger build --raw`, best-effort and idempotent: it folds every `task_outcome` and `tier_escalation` event into `.planning/routing-ledger.json`.

</step>
