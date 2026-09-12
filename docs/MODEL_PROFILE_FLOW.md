# Model Profile "auto" — Complete Flow Diagram

## Configuration Entry Point

```
┌─────────────────────────────────────┐
│ .planning/config.json               │
│ {                                   │
│   "model_profile": "auto",          │ ← ACTIVATION SWITCH
│   "coordinator_model": "sonnet"     │ ← FALLBACK for non-auto
│ }                                   │
└────────────┬────────────────────────┘
             │
             │ READ BY:
             │ 1. gsd-planner (routing_pass step)
             │ 2. gsd-phase-coordinator (execute step)
```

---

## PLANNING PHASE

```
┌──────────────────────────────────────────────────────────────┐
│ GSD Planner Spawned                                          │
│ Writes PLAN.md with all tasks                               │
└──────────────────────┬───────────────────────────────────────┘
                       │
        ┌──────────────▼──────────────────┐
        │ Step: routing_pass              │
        │ LINE: 1166                      │
        └──────────────┬───────────────────┘
                       │
        ┌──────────────▼──────────────────────────────┐
        │ Check config model_profile                  │
        │ Line 1170: $(config get model_profile)     │
        └──────────────┬───────────────────────────────┘
                       │
         ┌─────────────┴──────────────┐
         │                            │
    ┌────▼────────────┐      ┌───────▼──────────┐
    │ model_profile   │      │ model_profile    │
    │ == "auto"?      │      │ != "auto"?       │
    │                 │      │                  │
    │ YES ↓           │      │ NO ↓             │
    │                 │      │                  │
    └────┬────────────┘      └───────┬──────────┘
         │                           │
         │ CONTINUE ROUTING PASS    │ SKIP (no routing)
         │ (lines 1175-1229)        │ → validate_plan
         │                           │
         └───────────────┬──────────┘
                         │
        ┌────────────────▼──────────────────────────────────┐
        │ Step 1: Parse all tasks from PLAN.md             │
        │ Extract: <name>, <action> for each task          │
        │ Build: tasks[] = [{index, name, action}, ...]    │
        └────────────────┬───────────────────────────────────┘
                         │
        ┌────────────────▼──────────────────────────────────┐
        │ Step 2: Spawn task-router agents in PARALLEL     │
        │ Line 1188-1195:                                  │
        │                                                  │
        │ Promise.all(tasks.map(task =>                   │
        │   Task({                                         │
        │     subagent_type: "gsd-task-router",          │
        │     prompt: "Route this task: {task.name}       │
        │              {task.action}"                     │
        │   })                                            │
        │ ))                                              │
        │                                                  │
        │ Each router receives:                           │
        │ - Task name                                     │
        │ - Task action/description                       │
        │ - Current quota state (from gsd-tools.js)      │
        │                                                  │
        │ Each router runs independently                  │
        └────────────────┬───────────────────────────────────┘
                         │
        ┌────────────────▼──────────────────────────────────┐
        │ Each Task Router Agent                           │
        │ Source: agents/gsd-task-router.md                │
        │                                                  │
        │ Process:                                         │
        │ 1. Read task description                        │
        │ 2. Apply complexity rubric:                     │
        │    - Default to haiku (~55%)                   │
        │    - Escalate to sonnet if judgment needed      │
        │    - Escalate to opus if hard decision          │
        │ 3. Check quota state                            │
        │    - >95% → force haiku                         │
        │    - >80% + opus → downgrade to sonnet         │
        │ 4. Return ROUTING DECISION                      │
        │                                                  │
        │ Output format (lines 99-112):                   │
        │   ROUTING DECISION                              │
        │   ================                              │
        │   Task: {name}                                  │
        │   Model: haiku|sonnet|opus                      │
        │   Reasoning: {one sentence}                     │
        │   Quota: {percent}% used, adjusted: X → Y      │
        └────────────────┬───────────────────────────────────┘
                         │
        ┌────────────────▼──────────────────────────────────┐
        │ Step 3: Parse routing decisions (line 1198-1202) │
        │                                                  │
        │ For each response:                              │
        │   regex: /^Model:\s*(haiku|sonnet|opus)/m      │
        │   extract tier or default to haiku             │
        │                                                  │
        │ Result: tier[] = [haiku, sonnet, haiku, ...]   │
        └────────────────┬───────────────────────────────────┘
                         │
        ┌────────────────▼──────────────────────────────────┐
        │ Step 4: Inject <model> elements (line 1204-1206) │
        │                                                  │
        │ For each task in PLAN.md:                       │
        │   Edit: after </name> tag, insert:             │
        │   <model>{tier}</model>                         │
        │                                                  │
        │ Before: <name>Task 1: Foo</name>               │
        │ After:  <name>Task 1: Foo</name>               │
        │         <model>haiku</model>                    │
        └────────────────┬───────────────────────────────────┘
                         │
        ┌────────────────▼──────────────────────────────────┐
        │ Step 5: Consistency check (line 1208)            │
        │                                                  │
        │ Scan for similar tasks:                         │
        │ - Same verb + same target pattern?             │
        │ - If tasks A & B similar but different tiers   │
        │   → downgrade both to lowest tier              │
        │                                                  │
        │ Example:                                        │
        │ - Task 1: "Add config field" → sonnet          │
        │ - Task 2: "Add config validation" → haiku      │
        │ - → both become haiku                          │
        └────────────────┬───────────────────────────────────┘
                         │
        ┌────────────────▼──────────────────────────────────┐
        │ Step 6: Log decisions (line 1210-1222)           │
        │                                                  │
        │ Write summary to stdout:                        │
        │   "Routing pass complete: 5 haiku, 3 sonnet,   │
        │    1 opus"                                      │
        │                                                  │
        │ Write JSON to EXECUTION_LOG.md (best-effort):  │
        │   {                                             │
        │     "type": "routing_decisions",               │
        │     "plan": "01-PLAN.md",                      │
        │     "phase": 1,                                │
        │     "decisions": [                             │
        │       {"index": 1, "name": "...", "tier": "haiku"},
        │       {"index": 2, "name": "...", "tier": "sonnet"}
        │     ],                                         │
        │     "summary": {                               │
        │       "haiku": 5,                              │
        │       "sonnet": 3,                             │
        │       "opus": 1                                │
        │     }                                          │
        │   }                                             │
        └────────────────┬───────────────────────────────────┘
                         │
        ┌────────────────▼──────────────────────────────────┐
        │ RESULT: PLAN.md Updated                         │
        │                                                  │
        │ Each task now has:                              │
        │ <task>                                          │
        │   <name>Task 1: Foo</name>                     │
        │   <model>haiku</model>                          │
        │   <action>...</action>                          │
        │   ...                                           │
        │ </task>                                         │
        │                                                  │
        │ Next step: validate_plan                        │
        └────────────────┬───────────────────────────────────┘
                         │
                         ▼
        ┌──────────────────────────────────┐
        │ Planner commits PLAN.md           │
        │ Continues to next phase           │
        └──────────────────────────────────┘
```

---

## EXECUTION PHASE

```
┌──────────────────────────────────────────────────────────────┐
│ GSD Phase Coordinator Spawned                                │
│ (by execute-roadmap)                                         │
└──────────────────────┬───────────────────────────────────────┘
                       │
        ┌──────────────▼──────────────────┐
        │ Step: execute                    │
        │ LINE: 552                        │
        └──────────────┬───────────────────┘
                       │
        ┌──────────────▼──────────────────────────────┐
        │ Check config model_profile (line 562-568)   │
        │ Read: .planning/config.json                 │
        │       .model_profile                        │
        └──────────────┬───────────────────────────────┘
                       │
         ┌─────────────┴──────────────┐
         │                            │
    ┌────▼────────────┐      ┌───────▼──────────┐
    │ model_profile   │      │ model_profile    │
    │ == "auto"?      │      │ != "auto"?       │
    │                 │      │                  │
    │ YES ↓           │      │ NO ↓             │
    │                 │      │                  │
    └────┬────────────┘      └───────┬──────────┘
         │                           │
         │ ROUTING DETECTION         │ FIXED MODEL
         │ (lines 580-700)           │ (line 620)
         │                           │
         │                           │ EXECUTOR_MODEL =
         │                           │ coordinator_model
         │                           │ (default: sonnet)
         │                           │
         │                           │ Spawn single executor
         │                           │ Task({
         │                           │   model: "sonnet"
         │                           │ })
         │                           │
         └──────────────┬────────────┘
                        │
        ┌───────────────▼──────────────────────────────┐
        │ Step 2: Determine execution mode (line 580)  │
        │ (only in "auto" mode)                        │
        │                                              │
        │ Parse PLAN.md for <model> elements          │
        │ For each <task>:                            │
        │   model_el = extract <model> element        │
        │   task_name = extract <name> element        │
        │                                              │
        │   IF model_el matches /^(haiku|sonnet|opus)$:
        │     TASK_TIERS[index] = model_el            │
        │   ELIF task_name matches /^\[(haiku|sonnet|opus)\]/:
        │     TASK_TIERS[index] = matched tier (legacy)
        │   ELSE:                                      │
        │     TASK_TIERS[index] = "sonnet" (default)  │
        │                                              │
        │ Lines 582-594                               │
        └───────────────┬──────────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────────┐
        │ Check: Have any tasks explicit tiers?       │
        │ Lines 596-600                               │
        │                                              │
        │ IF yes:                                      │
        │   PER_TASK_MODE = true                      │
        │   → Spawn executor per task (2a below)      │
        │                                              │
        │ ELSE:                                        │
        │   PER_TASK_MODE = false                     │
        │   → Fallback to plan-level routing (2b)     │
        └───────────────┬──────────────────────────────┘
                        │
        ┌───────────────┴────────────────────────────┐
        │                                            │
        ▼ PER-TASK MODE (2a)                        ▼ PLAN-LEVEL (2b)

        For each task_index:                         Read plan objective
        (lines 664-700)                             from <objective> tag
                                                    (line 601-602)
        1. Read TASK_TIER from
           TASK_TIERS[task_index]                   Spawn single task-router:
                                                    Task({
        2. Check quota:                               subagent_type: "gsd-task-router",
           QUOTA_JSON = quota status --json            prompt: "Route: {OBJECTIVE}"
           session_percent = QUOTA_JSON.session.percent })

           IF session_percent > 95:                 Parse response for:
             TASK_TIER = "haiku"                    - Model tier
           ELIF session_percent > 80 AND            - Routing score
                TASK_TIER == "opus":                - Context docs
             TASK_TIER = "sonnet"
           ELSE:                                    Set EXECUTOR_MODEL
             (keep TASK_TIER)                       (line 609)

        3. Track: ROUTING_STATS[TASK_TIER] += 1    Log to execution log
           (line 678)                               (lines 614-617)

        4. Spawn executor:
           Task({                                   Spawn executor:
             subagent_type: "gsd-executor",        Task({
             model: "{TASK_TIER}",                  subagent_type: "gsd-executor",
             prompt: "Execute task {task_index}    model: "{EXECUTOR_MODEL}",
                     of plan {plan_number}"        prompt: "Execute plan
           })                                                {plan_number}"
           (lines 681-700)                         })
                                                   (lines 626-657)
        5. Executor runs, commits
           If fails: may signal
           "TASK FAILED [tier: {TASK_TIER}]"
           (line 143)
```

---

## EXECUTOR AGENT

```
┌──────────────────────────────────────────────────────────────┐
│ GSD Executor Spawned                                         │
│ Model: {task model from coordinator}                         │
│ File: agents/gsd-executor.md                                 │
└──────────────────────┬───────────────────────────────────────┘
                       │
        ┌──────────────▼──────────────────────────────┐
        │ Step: load_plan                             │
        │ Lines: 73-89                                │
        │                                              │
        │ Extract routing context if present:        │
        │ <routing_context>                           │
        │   Auto mode active.                         │
        │   Routed to {MODEL} ...                    │
        │ </routing_context>                          │
        │                                              │
        │ Parse: ROUTED_TIER = extract tier          │
        │ If not found: ROUTED_TIER = null           │
        └──────────────┬───────────────────────────────┘
                       │
        ┌──────────────▼──────────────────────────────┐
        │ Step: execute_tasks                         │
        │ For each task (type="auto"):               │
        │ (lines 133-162)                            │
        │                                              │
        │ 1. Execute task                            │
        │ 2. Verify done criteria met                │
        │ 3. Commit: git commit -m "..."             │
        │ 4. Track: TASK_ROUTING_TIER = ROUTED_TIER │
        │    (line 397)                              │
        │                                              │
        │ IF task fails + ROUTED_TIER set:          │
        │   Return: "TASK FAILED: {name}             │
        │            [tier: {ROUTED_TIER}] —         │
        │            {error}"                        │
        │   (lines 140-145)                          │
        │                                              │
        │ IF task fails + ROUTED_TIER null:         │
        │   Return: normal failure (no tier tag)    │
        └──────────────┬───────────────────────────────┘
                       │
        ┌──────────────▼──────────────────────────────┐
        │ Step: summary_creation                      │
        │ Create {phase}-{plan}-SUMMARY.md           │
        │ Lines: 405-462                              │
        │                                              │
        │ IF ROUTED_TIER was set for any task:      │
        │   Add "## Routing" section:                │
        │                                              │
        │   | Task | Routed Tier | Escalated |      │
        │   |------|-------------|-----------|      │
        │   | 1    | haiku       | no        |      │
        │   | 2    | sonnet      | no        |      │
        │   | 3    | haiku       | yes→sonnet|      │
        │                                              │
        │   Distribution: X haiku / Y sonnet / Z opus│
        │   Escalations: N (haiku → sonnet on retry) │
        │                                              │
        │ ELSE:                                       │
        │   Omit routing section                     │
        │   (routing not active)                      │
        │                                              │
        │ Lines 446-461                              │
        └──────────────┬───────────────────────────────┘
                       │
        ┌──────────────▼──────────────────────────────┐
        │ RESULT: SUMMARY.md Created                 │
        │                                              │
        │ Contains:                                   │
        │ - Phase info                                │
        │ - Tasks completed                           │
        │ - Deviations                                │
        │ - Routing stats (if routed)                │
        │ - Self-check results                       │
        └──────────────┬───────────────────────────────┘
                       │
        ┌──────────────▼──────────────────────────────┐
        │ Step: state_updates                         │
        │ Update .planning/STATE.md                   │
        │ Lines: 482-521                              │
        └──────────────┬───────────────────────────────┘
                       │
        ┌──────────────▼──────────────────────────────┐
        │ Step: final_commit                          │
        │ git commit -m "docs(...): complete plan"   │
        │ Includes: SUMMARY.md, STATE.md              │
        │ Lines: 542-550                              │
        └──────────────┬───────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │ Executor Complete                │
        │ Return to Coordinator             │
        └──────────────────────────────────┘
```

---

## SUPPORT AGENTS (Hardcoded Tiers)

```
These agents are ALWAYS spawned with fixed models,
regardless of model_profile setting:

┌──────────────────────────────┐
│ Knowledge Mining             │ → model="haiku"
│ Extraction from user session │ (simple data collect)
└──────────────────────────────┘

┌──────────────────────────────┐
│ Meta-Answerer Q&A            │ → model="sonnet"
│ Answer questions about phase │ (reasoning required)
└──────────────────────────────┘

┌──────────────────────────────┐
│ Charlotte QA (UI Testing)    │ → model="haiku" (Round 1)
│ Automated web testing        │ → model="sonnet" (Rounds 2+)
│ Line 785, 964, 1000         │ (escalate if issues found)
└──────────────────────────────┘

┌──────────────────────────────┐
│ UI Fix Agent                 │ → model="haiku" or "sonnet"
│ Fix issues from QA           │ (severity-based: critical/high→sonnet)
│ Line 852                     │ (medium/low→haiku)
└──────────────────────────────┘

┌──────────────────────────────┐
│ Verifier                     │ → model="sonnet"
│ Verify phase goal achieved   │ (verification judgment)
│ Line 1027                    │
└──────────────────────────────┘

┌──────────────────────────────┐
│ Integration Tester           │ → model="sonnet"
│ Test phase dependencies      │ (multi-system reasoning)
│ Line 1091                    │
└──────────────────────────────┘
```

---

## Full Picture Summary

```
START
  │
  ├─→ Config: model_profile = ?
  │
  ├─→ PLANNER writes PLAN.md
  │     │
  │     ├─ IF auto:
  │     │    └─ Spawn task-router per task → Inject <model> tags
  │     │
  │     └─ ELSE:
  │          └─ Skip routing
  │
  ├─→ ROADMAP executes phases
  │     │
  │     └─→ COORDINATOR per phase
  │           │
  │           ├─ IF auto:
  │           │    ├─ Detect <model> tags in PLAN.md
  │           │    ├─ Per-task mode: spawn executor per task with tier
  │           │    └─ OR plan-level: spawn task-router for whole plan
  │           │
  │           └─ ELSE:
  │                └─ Use fixed coordinator_model for all executors
  │
  ├─→ EXECUTOR spawned (at assigned model tier)
  │     │
  │     ├─ Tracks ROUTED_TIER from routing context
  │     ├─ Executes all tasks
  │     ├─ Creates SUMMARY.md with routing stats (if routed)
  │     │
  │     └─ IF task fails + routed:
  │          └─ Signal failure with [tier: {ROUTED_TIER}]
  │
  ├─→ SUPPORT AGENTS (always fixed tiers):
  │     ├─ Knowledge mining (haiku)
  │     ├─ Meta-answerer (sonnet)
  │     ├─ Charlotte QA (haiku→sonnet on retry)
  │     ├─ UI fixer (dynamic: severity-based)
  │     ├─ Verifier (sonnet)
  │     └─ Integration tester (sonnet)
  │
  └─→ END (SUMMARY.md + routing stats logged)
```

---

## Timeline Example

**Scenario:** Phase 1 with 5 tasks, model_profile="auto"

```
T=0:00  Planner spawned
        Writes PLAN.md (5 tasks)

T=0:15  Routing pass starts
        Spawns 5 task-router agents in parallel

T=0:25  All task-routers return decisions:
        Task 1: haiku (simple bug fix)
        Task 2: haiku (add field)
        Task 3: sonnet (refactor)
        Task 4: haiku (update config)
        Task 5: sonnet (schema design)

T=0:30  PLAN.md updated with <model> tags
        Written to disk

T=0:45  Coordinator spawned
        Detects: auto mode + <model> tags present
        Mode: PER_TASK

T=0:50  Spawn executor for Task 1 (haiku)

T=1:05  Task 1 complete, committed
        Spawn executor for Task 2 (haiku)

T=1:20  Task 2 complete, committed
        Spawn executor for Task 3 (sonnet)

T=1:50  Task 3 complete, committed
        Spawn executor for Task 4 (haiku)

T=2:05  Task 4 complete, committed
        Spawn executor for Task 5 (sonnet)

T=2:45  Task 5 complete, committed

T=2:50  SUMMARY.md created with:
        Distribution: 3 haiku / 2 sonnet / 0 opus

T=2:55  Final commit (SUMMARY.md + STATE.md)

T=3:00  Executor returns, coordinator continues
```

---

## Key Decision Points

| Question | Answer | Location |
|----------|--------|----------|
| Is model_profile set to "auto"? | Check config.json | Planner 1170, Coordinator 565 |
| Does PLAN.md have `<model>` tags? | Parse and count | Coordinator 587-594 |
| Which mode should execute use? | If tags found: per-task; else: plan-level | Coordinator 596-600 |
| Is quota running low? | Check quota status | Task-router 75-84, Coordinator 668-676 |
| Did a routed task fail? | Check for `[tier: X]` in signal | Executor 143-145 |
| Which agent is running? | Check subagent_type and model | Various |
| Should routing be included in SUMMARY? | Check if ROUTED_TIER was set | Executor 461 |

