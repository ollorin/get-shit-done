<purpose>
Execute all plans in a phase using wave-based parallel execution. Orchestrator stays lean — delegates plan execution to subagents.
</purpose>

<core_principle>
Orchestrator coordinates, not executes. Each subagent loads the full execute-plan context. Orchestrator: discover plans → analyze deps → group waves → spawn agents → handle checkpoints → collect results.
</core_principle>

## E2E Testing — Non-Negotiable Rules

These rules CANNOT be skipped, deferred, or deprioritized by any subagent:

1. **Every UI page created or modified MUST have e2e test coverage** — verified by post-execution inventory scan
2. **E2E tests MUST exercise ALL interactive elements** — not just "page loads"
3. **E2E tests MUST check for data display bugs** — NaN, undefined, null, [object Object], empty strings where values expected
4. **E2E tests MUST open every dropdown, modal, and sub-section** — visual completeness
5. **New regression-worthy tests MUST be tagged `regression`** — selected by test generator
6. **Pre-dev test generation (Step 5.6) and pre-gate gap closure (Step 6.35, runs BEFORE phase-gate) are MANDATORY for web phases** — not optional, not deferrable
7. **Subagents that skip or defer e2e testing will trigger verification failure** — QGATE-07 enforces this

<required_reading>
Read STATE.md before any operation to load project context.
</required_reading>

<process>

<step name="initialize" priority="first">
Load all context in one call:

```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init execute-phase "${PHASE_ARG}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for: `executor_model`, `verifier_model`, `commit_docs`, `parallelization`, `branching_strategy`, `branch_name`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `plans`, `incomplete_plans`, `plan_count`, `incomplete_count`, `state_exists`, `roadmap_exists`, `phase_req_ids`.

**If `phase_found` is false:** Error — phase directory not found.
**If `plan_count` is 0:** Error — no plans found in phase.
**If `state_exists` is false but `.planning/` exists:** Offer reconstruct or continue.

When `parallelization` is false, plans within a wave execute sequentially.

**Sync chain flag with intent** — if user invoked manually (no `--auto`), clear the ephemeral chain flag from any previous interrupted `--auto` chain. This does NOT touch `workflow.auto_advance` (the user's persistent settings preference). Must happen before any config reads (checkpoint handling also reads auto-advance flags):
```bash
if [[ ! "$ARGUMENTS" =~ --auto ]]; then
  node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config-set workflow._auto_chain_active false 2>/dev/null
fi
```
</step>

<step name="handle_branching">
Check `branching_strategy` from init and guard against main/master:

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
```

**If `CURRENT_BRANCH` is `main` or `master` AND `branching_strategy` is "none":**

Block with:
```
⛔ Branch Guard: You are on {CURRENT_BRANCH}

Running on main is not allowed. Options:
  A) Create phase branch: gsd/phase-{phase_number}-{phase_slug}
  B) Create custom branch — type: "branch my-branch-name"
  C) Override — I know what I'm doing (type "override")
```
- **"A"**: `git checkout -b "gsd/phase-{phase_number}-{phase_slug}"`
- **"branch {name}"**: `git checkout -b "{name}"`
- **"override"**: proceed on main (user accepted risk)
- **"stop"**: exit

**If `CURRENT_BRANCH` is NOT main/master:** Proceed silently.

**"phase" or "milestone":** Use pre-computed `branch_name` from init:
```bash
git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"
```

All subsequent commits go to this branch. User handles merging.
</step>

<step name="validate_phase">
From init JSON: `phase_dir`, `plan_count`, `incomplete_count`.

Report: "Found {plan_count} plans in {phase_dir} ({incomplete_count} incomplete)"
</step>

<step name="discover_and_group_plans">
Load plan inventory with wave grouping in one call:

```bash
PLAN_INDEX=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" phase-plan-index "${PHASE_NUMBER}")
```

Parse JSON for: `phase`, `plans[]` (each with `id`, `wave`, `autonomous`, `objective`, `files_modified`, `task_count`, `has_summary`), `waves` (map of wave number → plan IDs), `incomplete`, `has_checkpoints`.

**Null safety:** `objective` may be `null` if the plan frontmatter omits it — always use a fallback: `plan.objective ?? "(no objective)"`. Do NOT pipe through python3 or shell scripts that assume fields are non-null; read the JSON value directly from the bash variable.

**Filtering:** Skip plans where `has_summary: true`. If `--gaps-only`: also skip non-gap_closure plans. If all filtered: "No matching incomplete plans" → exit.

Report:
```
## Execution Plan

**Phase {X}: {Name}** — {total_plans} plans across {wave_count} waves

| Wave | Plans | What it builds |
|------|-------|----------------|
| 1 | 01-01, 01-02 | {from plan objectives, 3-8 words} |
| 2 | 01-03 | ... |
```
</step>

<step name="execute_waves">
Execute each wave in sequence. Within a wave: parallel if `PARALLELIZATION=true`, sequential if `false`.

Initialize context tracking: `COMPLETED_CONTEXT_BLOCK = ""` (updated after each wave completes).

**For each wave:**

0. **Proactive usage-window check (Executor Resilience Protocol — only when configured, default OFF):**

   ```bash
   USAGE_THRESHOLD=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config get usage_pause_threshold_tokens --raw 2>/dev/null)
   ```
   If `USAGE_THRESHOLD` is empty/`null`: skip this check entirely — zero overhead, the default state.

   Otherwise:
   ```bash
   USAGE=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" resilience usage-window --hours 5)
   TOTAL_TOKENS=$(node -e "console.log(JSON.parse(process.argv[1]).total_tokens)" "$USAGE")
   ```
   If `TOTAL_TOKENS >= USAGE_THRESHOLD`: do NOT start this wave. Write `.planning/phases/{phase_dir}/PAUSED.json` (`type: "usage_estimate"`, the `$USAGE` JSON, `resume_instruction: "retry once usage drops or the session window rolls over"`) and return `status: "paused_session_limit"` to this coordinator's own caller — same contract as the reactive death-detection path in step 5 below, just triggered before a wave that would likely die mid-flight rather than after.

   This is an ESTIMATE, not a hard limit — see `@get-shit-done/references/resilience.md` for the calibration caveat before setting `resilience.usage_pause_threshold_tokens`.

0.5. **Check for a prior interrupted executor run, per plan about to be spawned (Executor Resilience Protocol):**

   ```bash
   HANDOFF_PATH=".planning/phases/{phase_dir}/EXECUTOR-HANDOFF.json"
   TASK_CKPT_PATH=".planning/phases/{phase_dir}/TASK-CHECKPOINT.json"
   ```
   If `HANDOFF_PATH` exists, OR `TASK_CKPT_PATH` exists with no matching `{plan_id}-SUMMARY.md` (a death with no clean handoff):
   1. Verify every commit hash it claims actually exists: `git log --oneline --all | grep -F "{hash}"` for each. If any is missing, the state is unverifiable — log loudly and fall back to a normal fresh spawn instead of trusting it.
   2. Archive it: `mkdir -p .planning/phases/{phase_dir}/resolved-handoffs && mv "$HANDOFF_PATH" ".planning/phases/{phase_dir}/resolved-handoffs/{plan_id}-$(date -u +%Y%m%dT%H%M%SZ).json"` (skip the `mv` if only TASK-CHECKPOINT.json existed).
   3. **Prefer resume-by-agentId over cold fresh-spawn when in-session (App #2, `@get-shit-done/references/agent-messaging.md`).** Decide by this rule:
      - **agentId present AND same session** (`EXECUTOR_AGENT_IDS[{plan_id}]` is set — the interrupted executor ran in THIS coordinator session, not across a quota/launchd resume): `SendMessage(to: <agentId>, …)` to RESUME that same executor from its transcript, telling it to continue from `next_task_index`. Its transcript carries richer context (already-loaded files, key decisions) than a handoff doc can. This is the preferred path.
      - **else → cold spawn from handoff** (agentId not captured, or crossed a session boundary — a fresh `claude -p` after a quota/launchd resume, where the agentId is gone per hard semantic #3): spawn a NEW executor with a `<prior_executor_handoff>` block PREPENDED to the normal spawn prompt below (step 2) — completed tasks + commit hashes, resume-from task index, key decisions, files modified. Do NOT re-run completed tasks.

      Either way the handoff file remains the durable record; resume-by-agentId is an in-session optimization, never a replacement for it.

   Exact `<prior_executor_handoff>` block format and both JSON schemas: `@get-shit-done/references/resilience.md`.

   If neither file exists: proceed to a normal fresh spawn (step 2, unchanged).

1. **Describe what's being built (BEFORE spawning):**

   Read each plan's `<objective>`. Extract what's being built and why.

   ```
   ---
   ## Wave {N}

   **{Plan ID}: {Plan Name}**
   {2-3 sentences: what this builds, technical approach, why it matters}

   Spawning {count} agent(s)...
   ---
   ```

   - Bad: "Executing terrain generation plan"
   - Good: "Procedural terrain generator using Perlin noise — creates height maps, biome zones, and collision meshes. Required before vehicle physics can interact with ground."

2. **Spawn executor agents:**

   Pass paths only — executors read files themselves with their fresh 200k context.
   This keeps orchestrator context lean (~10-15%).

   **Capture each executor's `agentId` from its spawn result and retain it** (keyed by
   `{plan_id}`, e.g. `EXECUTOR_AGENT_IDS[{plan_id}] = <agentId>`). This enables
   resume-by-agentId (App #2 below and step 0.5 / step 5.1) — an in-session SendMessage
   resume of the SAME executor from its transcript is richer than a cold handoff respawn.
   The agentId is SAME-SESSION only (hard semantic #3, `@get-shit-done/references/agent-messaging.md`):
   across a quota/launchd resume it is gone, and the handoff-doc + PAUSED.json path is the
   ONLY durable cross-session recovery. Retaining it costs nothing; if unavailable, every
   path below falls back to the existing cold fresh-spawn.

   **For Wave 1 executors** (wave_number == 1, no prior context):
   ```
   Agent(
     subagent_type="gsd-executor",
     model="{executor_model}",
     description="Execute plan {plan_number}",
     prompt="
       <objective>
       Execute plan {plan_number} of phase {phase_number}-{phase_name}.
       Commit each task atomically. Create SUMMARY.md. Update STATE.md and ROADMAP.md.
       </objective>

       <execution_context>
       @~/.claude/get-shit-done/workflows/execute-plan.md
       @~/.claude/get-shit-done/templates/summary.md
       @~/.claude/get-shit-done/references/checkpoints.md
       @~/.claude/get-shit-done/references/tdd.md
       </execution_context>

       <files_to_read>
       Read these files at execution start using the Read tool:
       - {phase_dir}/{plan_file} (Plan)
       - .planning/STATE.md (State)
       - .planning/config.json (Config, if exists)
       - ./CLAUDE.md (Project instructions, if exists — follow project-specific guidelines and coding conventions)
       - .claude/skills/ or .agents/skills/ (Project skills, if either exists — list skills, read SKILL.md for each, follow relevant rules during implementation)
       </files_to_read>

       <success_criteria>
       - [ ] All tasks executed
       - [ ] Each task committed individually
       - [ ] SUMMARY.md created in plan directory
       - [ ] STATE.md updated with position and decisions
       - [ ] ROADMAP.md updated with plan progress (via `roadmap update-plan-progress`)
       </success_criteria>
     "
   )
   ```

   **For Wave 2+ executors** (wave_number >= 2 — inject completed_plans_context from prior wave SUMMARYs):
   ```
   Agent(
     subagent_type="gsd-executor",
     model="{executor_model}",
     description="Execute plan {plan_number}",
     prompt="
       <objective>
       Execute plan {plan_number} of phase {phase_number}-{phase_name}.
       Commit each task atomically. Create SUMMARY.md. Update STATE.md and ROADMAP.md.
       </objective>

       <execution_context>
       @~/.claude/get-shit-done/workflows/execute-plan.md
       @~/.claude/get-shit-done/templates/summary.md
       @~/.claude/get-shit-done/references/checkpoints.md
       @~/.claude/get-shit-done/references/tdd.md
       </execution_context>

       <files_to_read>
       Read these files at execution start using the Read tool:
       - {phase_dir}/{plan_file} (Plan)
       - .planning/STATE.md (State)
       - .planning/config.json (Config, if exists)
       - ./CLAUDE.md (Project instructions, if exists — follow project-specific guidelines and coding conventions)
       - .claude/skills/ or .agents/skills/ (Project skills, if either exists — list skills, read SKILL.md for each, follow relevant rules during implementation)
       </files_to_read>

       <completed_plans_context>
       The following plans completed in prior waves. Build on what was ACTUALLY built (from SUMMARY.md), not what plans assumed.

       {COMPLETED_CONTEXT_BLOCK}
       </completed_plans_context>

       <success_criteria>
       - [ ] All tasks executed
       - [ ] Each task committed individually
       - [ ] SUMMARY.md created in plan directory
       - [ ] STATE.md updated with position and decisions
       - [ ] ROADMAP.md updated with plan progress (via `roadmap update-plan-progress`)
       </success_criteria>
     "
   )
   ```

3. **Wait for all agents in wave to complete.**

4. **Report completion — spot-check claims first:**

   For each SUMMARY.md:
   - Verify first 2 files from `key-files.created` exist on disk
   - Check `git log --oneline --all --grep="{phase}-{plan}"` returns ≥1 commit
   - Check for `## Self-Check: FAILED` marker

   If ANY spot-check fails: report which plan failed, route to failure handler — ask "Retry plan?" or "Continue with remaining waves?"

   If pass:
   ```
   ---
   ## Wave {N} Complete

   **{Plan ID}: {Plan Name}**
   {What was built — from SUMMARY.md}
   {Notable deviations, if any}

   {If more waves: what this enables for next wave}
   ---
   ```

   - Bad: "Wave 2 complete. Proceeding to Wave 3."
   - Good: "Terrain system complete — 3 biome types, height-based texturing, physics collision meshes. Vehicle physics (Wave 3) can now reference ground surfaces."

4.5. **Assemble completed_plans_context (only if a next wave exists):**

   After all spot-checks pass for the current wave, and if `current_wave < total_waves`:

   ```
   COMPLETED_CONTEXT_PARTS = []

   For each plan that has completed in waves 1..current_wave (all completed plans so far):
     SUMMARY_PATH = "{phase_dir}/{plan_id}-SUMMARY.md"
     If SUMMARY_PATH does not exist: skip this plan with warning "Skipping {plan_id} — SUMMARY.md not found"

     Extract from SUMMARY.md frontmatter:
       node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" summary-extract "$SUMMARY_PATH" \
         --fields key-files,key-decisions,provides 2>/dev/null

     If extraction succeeds, read the one-liner (first **bold** line after the # heading in SUMMARY.md):
       ONE_LINER = first line matching /^\*\*.+\*\*/ in SUMMARY.md body

     Assemble context part:
       "Plan {plan_id} ({ONE_LINER or 'no one-liner'}):\n
        Files created: {key-files.created joined with ', ' or 'none'}\n
        Files modified: {key-files.modified joined with ', ' or 'none'}\n
        Key decisions: {key-decisions joined with '; ' or 'none'}\n
        Provides: {provides joined with ', ' or 'none'}"

     Append to COMPLETED_CONTEXT_PARTS

   COMPLETED_CONTEXT_BLOCK = COMPLETED_CONTEXT_PARTS joined with "\n\n"

   If COMPLETED_CONTEXT_BLOCK is empty (all extractions failed):
     COMPLETED_CONTEXT_BLOCK = "Prior wave plans completed but SUMMARY.md context unavailable — proceed based on plan files."
   ```

   Store COMPLETED_CONTEXT_BLOCK — it will be injected into Wave {current_wave + 1} executor spawns in step 2 above.

5. **Handle failures:**

   **Known Claude Code bug (classifyHandoffIfNeeded):** If an agent reports "failed" with error containing `classifyHandoffIfNeeded is not defined`, this is a Claude Code runtime bug — not a GSD or agent issue. The error fires in the completion handler AFTER all tool calls finish. In this case: run the same spot-checks as step 4 (SUMMARY.md exists, git commits present, no Self-Check: FAILED). If spot-checks PASS → treat as **successful**. If spot-checks FAIL → treat as real failure below.

   **Executor death / clean interruption detection (Executor Resilience Protocol — runs before the retry ladder below, for EVERY executor return):** An executor's return means one of three distinct things. Only the last is a genuine task-logic failure; the first two must never touch the retry counter below.

   **Parse the machine-readable status FIRST — do not string-match the prose header.** Every non-dead executor return ends with a fenced ```json trailer carrying `{"status": "complete"|"interrupted"|"blocked", ...}`. Extract the last fenced JSON block and read `.status`; the `## PLAN …` header is human-readable garnish that a reworded line or an em-dash could break. Only if NO parseable JSON trailer exists do you fall through to the raw-death path (2). This is the fix for the class of coordinator-parse failures where a prose-only return was misread as a death.

   1. **Clean interruption** — the trailer's `status` is `"interrupted"` (the executor self-stopped at a context-pressure boundary and wrote EXECUTOR-HANDOFF.json; header reads `## PLAN INTERRUPTED`; it may also have sent an App #1 `to: "main"` continuation signal). Handle identically to the pre-spawn handoff case (step 0.5 above), INCLUDING its resume-by-agentId-vs-cold-spawn decision (App #2): since this interruption just happened in THIS session, `EXECUTOR_AGENT_IDS[{plan_id}]` is normally still set — PREFER `SendMessage(to: <agentId>, …)` to resume that same executor from its transcript from `next_task_index`; FALL BACK to archiving the handoff and cold-spawning a continuation executor with a `<prior_executor_handoff>` block when the agentId is unavailable. Log `--type executor_clean_interruption`. Do NOT call `execution-state record-failure`. A `status: "blocked"` trailer is NOT an interruption — surface it to the user with its `recommended_split`; the plan needs re-splitting before it can proceed.

   2. **Genuine death** — `Agent()` threw, OR the return has NO parseable JSON status trailer at all (e.g. it IS a raw death message):
      ```bash
      DEATH_CHECK=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" resilience parse-death --text "{raw returned text or error message}")
      IS_DEATH=$(node -e "console.log(JSON.parse(process.argv[1]).is_death)" "$DEATH_CHECK")
      RESET_TIME_ISO=$(node -e "console.log(JSON.parse(process.argv[1]).reset_time_iso || '')" "$DEATH_CHECK")
      STALENESS_CHECK=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" resilience check-staleness ".planning/phases/{phase_dir}/TASK-CHECKPOINT.json")
      IS_STALE=$(node -e "console.log(JSON.parse(process.argv[1]).stale)" "$STALENESS_CHECK")
      ```
      - **`IS_DEATH` true AND `RESET_TIME_ISO` non-empty** (session/quota-limit death): write `.planning/phases/{phase_dir}/PAUSED.json` (`type: "session_limit"`, `reset_time_iso`, `plan`, the last known TASK-CHECKPOINT.json contents, `resume_instruction`). Compute the wait, capped at 6 hours, using the identical epoch-math pattern as `execute-roadmap.md`'s 4a step. If the wait is **under 30 minutes**: sleep-loop (same pattern), then spawn a continuation executor directly. If **30 minutes or longer**, or the reset time is implausible/unparseable: do NOT sleep here — return `status: "paused_session_limit"` with `reset_time_iso` to this coordinator's own caller instead of blocking this coordinator's context for hours. Log `--type executor_death_detected`.
      - **`IS_DEATH` true with no reset time, OR `IS_STALE` true** (context-overflow death — no clean handoff, but committed work exists on disk): handle identically to the pre-spawn handoff case (step 0.5 above) — spawn a continuation executor from TASK-CHECKPOINT.json immediately, no waiting. Log `--type executor_death_detected`.
      - **Neither matches:** fall through to the retry/debug/escalate ladder below — this is a genuine task-logic failure.

   Full wait/respawn/bubble-up decision tree and the PAUSED.json schema: `@get-shit-done/references/resilience.md`.

   For real failures (not the classifyHandoffIfNeeded runtime bug, and not an executor death/interruption handled above), call execution-state to get the auto-retry/debug/escalate decision:

   ```bash
   STATE_RESULT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" execution-state record-failure \
     --phase {N} --plan {plan_id} --error "{error message}" --step "{last completed step}" \
     --files "{comma-separated files modified}" --raw)
   ```

   Parse `action`, `attempts`, `max_attempts` from `STATE_RESULT`.

   - **`action == "retry"`** (1st failure): Log "Auto-retry {plan_id} (attempt 2 of {max_attempts}) — no user prompt." Re-spawn the plan's executor fresh with the same plan context. On success: `execution-state record-success --phase {N} --plan {plan_id}`, continue to next wave. On failure again: repeat this step (`attempts` is now 2).

   - **`action == "debug"`** (2nd+ failure, below the ceiling): Log "Auto-spawning debugger for {plan_id} after {attempts} failures." Invoke @~/.claude/get-shit-done/workflows/debug.md non-interactively:
     ```
     mode: symptoms_prefilled: true, interactive: false, goal: find_and_fix
     symptoms: expected="plan {plan_id} completes successfully", actual="{error}", errors="{error}", reproduction="re-run plan {plan_id}", timeline="this execution"
     debug_file: .planning/debug/{phase}-{plan_id}-attempt{attempts}.md
     ```
     After the debug workflow returns, re-spawn the plan's executor. On success: `execution-state record-success --phase {N} --plan {plan_id}`. On failure again: repeat this step (`attempts` increments via the next `record-failure` call).

   - **`action == "escalate"`** (at the `max_attempts` ceiling — NEVER spawn another debug attempt):
     1. Read the most recent `.planning/debug/{phase}-{plan_id}-attempt*.md` file's findings summary (or "No debugger findings available" if none exist).
     2. If a blocking Telegram question tool (`mcp__telegram__ask_blocking_question`) is available in this execution context: escalate using the IDENTICAL Step A + Step A-fallback pattern already defined in `agents/gsd-phase-coordinator.md` (~lines 386-425) — same call shape, same fallback (on daemon-down/timeout: log loudly, `deferred add --step execution --reason "..." --approver timeout-fallback`, continue). Do NOT modify `gsd-phase-coordinator.md` — this is a new call site elsewhere that reuses its documented pattern verbatim.
     3. If that tool is not available in this execution context (e.g. a standalone `/gsd:execute-phase` run without roadmap-level Telegram wiring): fall back to `AskUserQuestion` if interactive, or the existing fire-and-forget notification + `FAILURE.md` write if fully autonomous — document which path was taken in SUMMARY.md.
     4. Mark this plan failed, report partial completion, continue with non-dependent plans only.

5.5. **Live course-correction relay (App #3, `@get-shit-done/references/agent-messaging.md`):** if a checker or QA agent (gsd-plan-checker, gsd-charlotte-qa) that is running while an executor is STILL producing work `SendMessage`s you (`to: "main"`) a mid-run finding, you MAY relay a correction to the in-flight executor: `SendMessage(to: <EXECUTOR_AGENT_IDS[{plan_id}]>, …)` with the finding so it can adjust before finishing wrong, instead of letting the plan complete and be redone. This stays coordinator-mediated (the checker/QA agent never messages the executor directly). It is additive — the checker/QA agent's structured return is still the durable record, and delivery is at the executor's next tool round (hard semantic #1), so treat the relay as a best-effort tightening, never a guaranteed real-time halt. If the executor's agentId is unavailable, fall back to normal post-run handling (its next return, or the checker/QA report driving a fix pass).

6. **Execute checkpoint plans between waves** — see `<checkpoint_handling>`.

7. **Proceed to next wave.**
</step>

<step name="checkpoint_handling">
Plans with `autonomous: false` require user interaction.

**Auto-mode checkpoint handling:**

Read auto-advance config (chain flag + user preference):
```bash
AUTO_CHAIN=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config get workflow._auto_chain_active --raw --default false)
AUTO_CFG=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config get workflow.auto_advance --raw --default false)
```

When executor returns a checkpoint AND (`AUTO_CHAIN` is `"true"` OR `AUTO_CFG` is `"true"`):
- **human-verify** → Auto-spawn continuation agent with `{user_response}` = `"approved"`. Log `⚡ Auto-approved checkpoint`.
- **decision** → Auto-spawn continuation agent with `{user_response}` = first option from checkpoint details. Log `⚡ Auto-selected: [option]`.
- **human-action** → Present to user (existing behavior below). Auth gates cannot be automated.

**UI QA checkpoints — always auto-run (Charlotte is the human here):**

When executor returns `Type: ui-qa` — regardless of AUTO_CHAIN or AUTO_CFG:

1. Log: `⚡ UI QA: Starting Charlotte automated testing...`

2. **Auto-start dev servers** — do NOT ask user to start servers:
   - For each URL implied by `<what-built>` (default: http://localhost:3000):
     ```bash
     curl -s --max-time 3 http://localhost:3000 > /dev/null 2>&1 && echo UP || echo DOWN
     ```
   - If DOWN: detect framework and start in background:
     - NX monorepo: `npx nx dev {app-name}` (app name from checkpoint `<apps>` tag or CLAUDE.md)
     - Next.js/Vite/other: `npm run dev` or `yarn dev` in background
   - Wait up to 30s for server to respond. If still DOWN after 30s: log warning, proceed anyway (Charlotte reports server errors as issues).

3. **Run Charlotte QA loop** (max 3 rounds):
   ```
   MAX_ROUNDS = 3
   round = 1
   qa_passed = false

   while round <= MAX_ROUNDS AND qa_passed == false:
     qa_result = Agent(
       subagent_type="gsd-charlotte-qa",
       model="haiku",
       description="UI QA round {round}",
       prompt="mode=ui-qa\n<what_built>{what_built}</what_built>\n<test_flows>{test_flows}</test_flows>\n<round>{round}</round>{IF round > 1: <previous_issues>{previous_report}</previous_issues>}"
     )

     if qa_result.passed:
       qa_passed = true
       break

     if round == MAX_ROUNDS:
       Present ONLY the issue report — NOT server start instructions:
       "Charlotte found {N} issues after {MAX_ROUNDS} rounds. Type 'continue' to proceed, or describe what to fix."
       Wait for user response. If 'continue': break. Else: spawn fix agent, re-run QA.
       break

     FIX_TIER = qa_result.severity_counts.critical > 0 OR qa_result.severity_counts.high > 0 ? "sonnet" : "haiku"
     Agent(subagent_type="general-purpose", model="{FIX_TIER}", description="Fix UI issues round {round}",
       prompt="Fix these UI issues: {qa_result.report_markdown}\nCommit each fix atomically.")
     round++
   ```

4. Spawn continuation agent with `{user_response}` = "Charlotte QA passed" (or issue summary if not passed).
5. Log: `⚡ UI QA: {passed/failed} — {N} issues {found/fixed}`

**Standard flow (not auto-mode, or human-action type):**

1. Spawn agent for checkpoint plan
2. Agent runs until checkpoint task or auth gate → returns structured state
3. Agent return includes: completed tasks table, current task + blocker, checkpoint type/details, what's awaited
4. **Present to user:**
   ```
   ## Checkpoint: [Type]

   **Plan:** 03-03 Dashboard Layout
   **Progress:** 2/3 tasks complete

   [Checkpoint Details from agent return]
   [Awaiting section from agent return]
   ```
5. User responds: "approved"/"done" | issue description | decision selection
6. **Spawn continuation agent (NOT resume)** using continuation-prompt.md template:
   - `{completed_tasks_table}`: From checkpoint return
   - `{resume_task_number}` + `{resume_task_name}`: Current task
   - `{user_response}`: What user provided
   - `{resume_instructions}`: Based on checkpoint type
7. Continuation agent verifies previous commits, continues from resume point
8. Repeat until plan completes or user stops

**Why fresh agent, not resume:** Resume relies on internal serialization that breaks with parallel tool calls. Fresh agents with explicit state are more reliable.

**Checkpoints in parallel waves:** Agent pauses and returns while other parallel agents may complete. Present checkpoint, spawn continuation, wait for all before next wave.
</step>

<step name="aggregate_results">
After all waves:

```markdown
## Phase {X}: {Name} Execution Complete

**Waves:** {N} | **Plans:** {M}/{total} complete

| Wave | Plans | Status |
|------|-------|--------|
| 1 | plan-01, plan-02 | ✓ Complete |
| CP | plan-03 | ✓ Verified |
| 2 | plan-04 | ✓ Complete |

### Plan Details
1. **03-01**: [one-liner from SUMMARY.md]
2. **03-02**: [one-liner from SUMMARY.md]

### Issues Encountered
[Aggregate from SUMMARYs, or "None"]
```
</step>


<checkpoint type="verify" name="phase-completion-gate">
  <!-- Fires after all waves complete, before pre_verify_gates and verify_phase_goal. -->
  <!-- All blocking items must pass before the verifier is spawned. -->

  <item id="PHGATE-01" severity="blocking">
    <check>All plans have a corresponding SUMMARY.md</check>
    <pass>SUMMARIES count >= PLANS count (every plan has a summary)</pass>
    <fail>Missing SUMMARY.md — re-run failed plans before verification</fail>
  </item>

  <item id="PHGATE-02" severity="blocking">
    <check>No SUMMARY.md contains Self-Check: FAILED</check>
    <command>grep -rl "Self-Check: FAILED" .planning/phases/{phase_dir}/ 2>/dev/null || echo NONE</command>
    <pass>Output is NONE (no failed self-checks)</pass>
    <fail>Self-check failed in listed SUMMARY.md — investigate and fix before verification</fail>
  </item>

  <item id="PHGATE-03" severity="blocking">
    <check>Audit log file exists for this phase</check>
    <pass>phase-{N}-audit.jsonl exists in .planning/audit/</pass>
    <fail>BLOCKING — .planning/audit/phase-{N}-audit.jsonl does not exist. Phase cannot be marked complete without an audit entry. Verify all plans wrote their audit entries (check CPGATE-04 in each plan's execution). See ~/.claude/get-shit-done/references/audit-log.md.</fail>
  </item>

</checkpoint>

<step name="e2e_coverage_closure">

### Step 6.35: Pre-Gate E2E Coverage Closure (BLOCKING, runs before phase-gate)

**Trigger:** Same as Step 5.6 in plan-phase — web project with UI changes. This step runs BEFORE Gate 1 (`verify phase-gate` in `pre_verify_gates` below) so the `e2e_plan` artifact phase-gate demands has a chance to actually be produced first — a gate must never demand an artifact that nothing creates (MILE-08, Loophole 5).

**Process:**

1. Run the deterministic pre-check:
   ```bash
   E2E_GAP_RESULT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" verify e2e-gaps "${PHASE}")
   E2E_GAP_EXIT=$?
   ```
   Parse JSON fields: `has_ui`, `gaps`, `gap_count`, `generation_failed`.

2. **If `has_ui` is `false`:** Skip this entire step — proceed directly to `pre_verify_gates`. Nothing to close for a non-UI phase.

3. **If `gap_count == 0` and `generation_failed == false`:** **Idempotent skip.** Log: "E2E-TEST-PLAN.md already covers all touched UI pages — generator not re-invoked." Proceed to `pre_verify_gates`. Do NOT spawn the generator — full coverage already exists, re-invoking it would be wasted cost.

4. **Otherwise** (gaps exist, or a stale `generation_failed` marker is present from a prior failed attempt): spawn the generator with the gap list as its UI-inventory-gap input, plus phase context:
   ```
   Agent(
     subagent_type="gsd-e2e-test-generator",
     model="sonnet",
     description="Close E2E coverage gaps for phase {PHASE}",
     prompt="
       Phase: {PHASE_NUMBER} - {PHASE_NAME}
       Phase directory: {PHASE_DIR}
       UI coverage gaps (page basenames with no e2e scenario mention): {gaps}
       Existing E2E-TEST-PLAN.md (if any): {PHASE_DIR}/E2E-TEST-PLAN.md
       Read the phase's PLAN.md/SUMMARY.md files to understand what these pages do.
       Write/update scenarios covering every listed gap. Update E2E-TEST-PLAN.md so it
       explicitly names each covered page (verify e2e-gaps checks for the page's basename
       appearing in the plan text).
     "
   )
   ```

5. **On generator success** (returns written scenario files + an updated `E2E-TEST-PLAN.md`, no thrown error): delete the marker if present —
   ```bash
   rm -f "${PHASE_DIR}/E2E-GENERATION-FAILED.json"
   ```
   Re-run `verify e2e-gaps "${PHASE}"` to confirm `gap_count == 0` now. **If gaps remain** after a generation attempt (the generator produced a plan that still omits a page): treat this the same as failure (step 6 below) — never silently proceed with residual gaps.

6. **On generator failure** (Agent() throws, times out, or returns no plan / clearly malformed output) **OR residual gaps remain after a generation attempt**: write the marker —
   ```bash
   cat > "${PHASE_DIR}/E2E-GENERATION-FAILED.json" <<EOF
   {"error": "<short description>", "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
   EOF
   ```
   Do NOT proceed to `pre_verify_gates` silently — the next Gate 1 (`verify phase-gate`) will now surface this as `failure_type: e2e_generation_failed`, which the operator/coordinator handles exactly like any other Gate 1 failure: fix (retry generation) or `deferred add --step e2e_plan --reason ... --approver ...` for a documented exception.

**Hard rule:** Phase execution is NOT complete until every UI page created/modified has at least one e2e scenario covering:
- Page loads without console errors
- All interactive elements are clickable/fillable
- All data displays show valid values (no NaN, undefined, null)
- All forms submit successfully with valid data
- All forms show validation errors with invalid data

**Output:** Updated scenarios in `apps/e2e-charlotte/scenarios/`, updated E2E-TEST-PLAN.md with coverage status, `E2E-GENERATION-FAILED.json` written on failure / cleared on success.

</step>

<step name="pre_verify_gates">

### Step 6.4: Pre-Verification Gates (BLOCKING)

Before proceeding to verification, these gates must pass. They cannot be deferred.

**Gate 1 — Deterministic phase-gate (BLOCKING):**

Run the deterministic, git-diff-derived phase gate instead of self-reporting artifact existence. This single call replaces the prior "check `type: frontend`/`checkpoint: ui-qa`/`.tsx`/`.jsx` by hand" prose — it covers Charlotte QA evidence, plus test/docs/e2e-plan/verification existence, from actual touched files and waivers, not plan self-reports:

```bash
PHASE_GATE_RESULT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" verify phase-gate "${PHASE}")
PHASE_GATE_EXIT=$?
```

If `PHASE_GATE_EXIT` is non-zero: **BLOCKING** — do not proceed to verifier spawn. Present the failing checks (the `failures` array in the JSON output) to the operator/coordinator with two options:
(a) fix the missing artifact (e.g. run Charlotte QA if `missing_charlotte_qa`) and re-run `verify phase-gate`, or
(b) for a legitimate, documented exception, run `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" deferred add "${PHASE}" --step <step> --reason <reason> --approver <approver>`, then re-run `verify phase-gate` to confirm it now passes waived.

Skipping a mandatory step requires calling `deferred add` as part of the skip — never logged-and-forgotten after the fact. Do not allow silent continuation past a non-zero exit.

**Gate 2 — Integration tests green:**

All integration tests must pass before SUMMARY.md is considered complete:
```bash
cd apps/api && NODE_ENV=test DENO_ENV=test deno task test:ci
```
If failures: fix before proceeding. Do not write "tests pass" in SUMMARY.md if they don't.

**Gate 3 — Cross-layer consistency (if phase added enums, types, or status values):**

If the phase introduced a new enum value, status string, or type discriminator:
- Verify it exists in ALL layers: DB constraint, RPC validation, edge function validation, frontend type, UI display map
- A value present in one layer but missing in another is a blocking defect

</step>

<step name="close_parent_artifacts">
**For decimal/polish phases only (X.Y pattern):** Close the feedback loop by resolving parent UAT and debug artifacts.

**Skip if** phase number has no decimal (e.g., `3`, `04`) — only applies to gap-closure phases like `4.1`, `03.1`.

**1. Detect decimal phase and derive parent:**
```bash
# Check if phase_number contains a decimal
if [[ "$PHASE_NUMBER" == *.* ]]; then
  PARENT_PHASE="${PHASE_NUMBER%%.*}"
fi
```

**2. Find parent UAT file:**
```bash
PARENT_INFO=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" find-phase "${PARENT_PHASE}" --raw)
# Extract directory from PARENT_INFO JSON, then find UAT file in that directory
```

**If no parent UAT found:** Skip this step (gap-closure may have been triggered by VERIFICATION.md instead).

**3. Update UAT gap statuses:**

Read the parent UAT file's `## Gaps` section. For each gap entry with `status: failed`:
- Update to `status: resolved`

**4. Update UAT frontmatter:**

If all gaps now have `status: resolved`:
- Update frontmatter `status: diagnosed` → `status: resolved`
- Update frontmatter `updated:` timestamp

**5. Resolve referenced debug sessions:**

For each gap that has a `debug_session:` field:
- Read the debug session file
- Update frontmatter `status:` → `resolved`
- Update frontmatter `updated:` timestamp
- Move to resolved directory:
```bash
mkdir -p .planning/debug/resolved
mv .planning/debug/{slug}.md .planning/debug/resolved/
```

**6. Commit updated artifacts:**
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs(phase-${PARENT_PHASE}): resolve UAT gaps and debug sessions after ${PHASE_NUMBER} gap closure" --files .planning/phases/*${PARENT_PHASE}*/*-UAT.md .planning/debug/resolved/*.md
```
</step>

<step name="verify_phase_goal">
Verify phase achieved its GOAL, not just completed tasks.

```
Agent(
  prompt="Verify phase {phase_number} goal achievement.
Phase directory: {phase_dir}
Phase goal: {goal from ROADMAP.md}
Phase requirement IDs: {phase_req_ids}
Check must_haves against actual codebase.
Cross-reference requirement IDs from PLAN frontmatter against REQUIREMENTS.md — every ID MUST be accounted for.
Create VERIFICATION.md.",
  subagent_type="gsd-verifier",
  model="{verifier_model}",
  description="Verify phase {phase_number}"
)
```

Read status:
```bash
grep "^status:" "$PHASE_DIR"/*-VERIFICATION.md | cut -d: -f2 | tr -d ' '
```

| Status | Action |
|--------|--------|
| `passed` | → update_roadmap |
| `human_needed` | Present items for human testing, get approval or feedback |
| `gaps_found` | Present gap summary, offer `/gsd:plan-phase {phase} --gaps` |

**If human_needed:**
```
## ✓ Phase {X}: {Name} — Human Verification Required

All automated checks passed. {N} items need human testing:

{From VERIFICATION.md human_verification section}

"approved" → continue | Report issues → gap closure
```

**If gaps_found:**
```
## ⚠ Phase {X}: {Name} — Gaps Found

**Score:** {N}/{M} must-haves verified
**Report:** {phase_dir}/{phase_num}-VERIFICATION.md

### What's Missing
{Gap summaries from VERIFICATION.md}

---
## ▶ Next Up

`/gsd:plan-phase {X} --gaps`

<sub>`/clear` first → fresh context window</sub>

Also: `cat {phase_dir}/{phase_num}-VERIFICATION.md` — full report
Also: `/gsd:verify-work {X}` — manual testing first
```

Gap closure cycle: `/gsd:plan-phase {X} --gaps` reads VERIFICATION.md → creates gap plans with `gap_closure: true` → user runs `/gsd:execute-phase {X} --gaps-only` → verifier re-runs.
</step>

<step name="update_roadmap">
**Mark phase complete and update all tracking files:**

```bash
COMPLETION=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" phase complete "${PHASE_NUMBER}")
```

The CLI handles:
- Marking phase checkbox `[x]` with completion date
- Updating Progress table (Status → Complete, date)
- Updating plan count to final
- Advancing STATE.md to next phase
- Updating REQUIREMENTS.md traceability

Extract from result: `next_phase`, `next_phase_name`, `is_last_phase`.

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs(phase-{X}): complete phase execution" --files .planning/ROADMAP.md .planning/STATE.md .planning/REQUIREMENTS.md {phase_dir}/*-VERIFICATION.md
```
</step>

<step name="offer_next">

**Exception:** If `gaps_found`, the `verify_phase_goal` step already presents the gap-closure path (`/gsd:plan-phase {X} --gaps`). No additional routing needed — skip auto-advance.

**No-transition check (spawned by auto-advance chain):**

Parse `--no-transition` flag from $ARGUMENTS.

**If `--no-transition` flag present:**

Execute-phase was spawned by plan-phase's auto-advance. Do NOT run transition.md.
After verification passes and roadmap is updated, return completion status to parent:

```
## PHASE COMPLETE

Phase: ${PHASE_NUMBER} - ${PHASE_NAME}
Plans: ${completed_count}/${total_count}
Verification: {Passed | Gaps Found}

[Include aggregate_results output]
```

STOP. Do not proceed to auto-advance or transition.

**If `--no-transition` flag is NOT present:**

**Auto-advance detection:**

1. Parse `--auto` flag from $ARGUMENTS
2. Read both the chain flag and user preference (chain flag already synced in init step):
   ```bash
   AUTO_CHAIN=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config get workflow._auto_chain_active --raw --default false)
   AUTO_CFG=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config get workflow.auto_advance --raw --default false)
   ```

**If `--auto` flag present OR `AUTO_CHAIN` is true OR `AUTO_CFG` is true (AND verification passed with no gaps):**

```
╔══════════════════════════════════════════╗
║  AUTO-ADVANCING → TRANSITION             ║
║  Phase {X} verified, continuing chain    ║
╚══════════════════════════════════════════╝
```

Execute the transition workflow inline (do NOT use Task — orchestrator context is ~10-15%, transition needs phase completion data already in context):

Read and follow `~/.claude/get-shit-done/workflows/transition.md`, passing through the `--auto` flag so it propagates to the next phase invocation.

**If neither `--auto` nor `AUTO_CFG` is true:**

The workflow ends. The user runs `/gsd:progress` or invokes the transition workflow manually.
</step>

</process>

<context_efficiency>
Orchestrator: ~10-15% context. Subagents: fresh 200k each. No polling (Task blocks). No context bleed.
</context_efficiency>

<failure_handling>
- **classifyHandoffIfNeeded false failure:** Agent reports "failed" but error is `classifyHandoffIfNeeded is not defined` → Claude Code bug, not GSD. Spot-check (SUMMARY exists, commits present) → if pass, treat as success
- **Agent fails mid-plan:** Missing SUMMARY.md → report, ask user how to proceed
- **Dependency chain breaks:** Wave 1 fails → Wave 2 dependents likely fail → user chooses attempt or skip
- **All agents in wave fail:** Systemic issue → stop, report for investigation
- **Checkpoint unresolvable:** "Skip this plan?" or "Abort phase execution?" → record partial progress in STATE.md
</failure_handling>

<resumption>
Re-run `/gsd:execute-phase {phase}` → discover_plans finds completed SUMMARYs → skips them → resumes from first incomplete plan → continues wave execution.

STATE.md tracks: last completed plan, current wave, pending checkpoints.
</resumption>
