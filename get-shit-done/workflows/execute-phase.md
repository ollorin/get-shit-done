<purpose>
Execute all plans in a phase using wave-based parallel execution. Orchestrator stays lean — delegates plan execution to subagents.
</purpose>

<core_principle>
Orchestrator coordinates, not executes. A per-task executor loads `references/executor-task.md`; a spike plan executor loads the full execute-plan context. Orchestrator: discover plans → analyze deps → group waves → spawn agents → handle checkpoints → collect results.
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
LEGACY_FLAG=""
if [[ " $ARGUMENTS " == *" --legacy "* ]]; then LEGACY_FLAG="--legacy"; fi
AUTO_FLAG=""
if [[ " $ARGUMENTS " == *" --auto "* ]]; then AUTO_FLAG="--auto"; fi
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init execute-phase "${PHASE_ARG}" $LEGACY_FLAG $AUTO_FLAG)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

The orchestrator records the project root once (`PROJECT_ROOT`, the directory holding `.planning`), passes `--cwd "$PROJECT_ROOT"` on every gsd-tools and decisions.js call and names `PROJECT_ROOT` in every agent prompt; a shell's working directory is never assumed to persist between calls.

If the command exits 1 and INIT has `error: project_context_missing`: stop, print its `missing` list and `hint`. Do not continue without the brief and profile. When `LEGACY_FLAG` is set, put `legacy: true` in every spawned agent's prompt (the flag alone does not reach them; they pass `--legacy` to their own init call).

**Auto mode:** `auto_mode` (init) is the one rule for "no human is answering" (`references/auto-mode.md`, prompt classes K1-K6). When true, AskUserQuestion is never called and nothing waits for a reply: each prompt below takes its class action and logs an `auto_decision` event. Put `auto: true` in every spawned agent's prompt (they pass `--auto` to their own init call; an exported variable may not reach them). Chain-advance (`offer_next`) keeps its own trigger and is not part of this rule.

Parse JSON for: `auto_mode`, `executor_model`, `ruling_model`, `ruling_model_fallback`, `utility_model`, `reviewer_model`, `base_branch`, `ui_qa_mode`, `commit_docs`, `parallelization`, `branching_strategy`, `branch_name`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `plans`, `incomplete_plans`, `plan_count`, `incomplete_count`, `state_exists`, `roadmap_exists`, `phase_req_ids`, `risk_addons`, `phase_base` (`{phase base}` below; re-read it with init before the final review), `brief_path`, `stack_profile_path`, `stack_commands`. Every spawned agent receives `brief_path` and `stack_profile_path` (when not null) in its `<files_to_read>`, and `stack_commands` verbatim.

**Rigour and budget (print first):** init also returns the rigour fields. `references/rigour.md` is the contract (levels, risk-domain add-ons, caps, budget). Before anything else print its first line (`Phase {N}: rigour ..., risk domains: ..., budget ...`), counting what plan-phase already logged. Pass `rigour`, the spike roots and the remaining budget in every spawn prompt. Call `gsd-tools budget spend --phase {N}` once per child spawn, and `gsd-tools budget status --phase {N}` before each new gap cycle. At `warn` finish the current step and do no optional work; at `breach` start no new cycle, still run the final review and everything rule 12 of `references/rigour.md` lists (rule 7: two passes at risk add-ons) when every plan has a SUMMARY, then follow rigour.md rule 7: the phase completes only if nothing mandatory was skipped, else print the owner report naming what was skipped and end with the trailer `{"status": "blocked", "reason": "budget_exceeded"}`. Never report `completed` over a skipped mandatory check.

**Spike:** When `rigour` is `spike`: no test steward; the final review is the only review; the verifier prompt carries the spike checks and final-review questions of `references/rigour.md`; its findings follow rule 12 of `references/rigour.md` (`executor_model` is the floor `sonnet` or stronger, never `haiku`: the executor is the investigator; a spike plan is ONE executor on its `phase-plan-index` `executor_model` (its highest task tag, never below the floor)); the coordinator logs the ruling with `gsd-tools execution-log event --type spike_ruling --data '{"phase":"{N}"}'` when it spawns it; nothing open is silently parked, and a CRITICAL/HIGH is never left open without a closing record or a ruling id (the phase does not complete); the last spike phase writes `SPIKE-RESULT.md` (per question: answer, capture path, go/no-go, what must be rebuilt). Every executor prompt carries rule 11 of `references/rigour.md` (a "no" needs a root-cause or search capture, else `inconclusive`), the answer-table shape, "every probe asserts what it claims and a loosened assertion keeps the failing capture", "SUMMARY at most 15 lines" and "a probe row that records FAIL is a result, not a failed self-check: `## Self-Check: PASSED` when every file, capture and commit exists; the verdict is the first word after `Self-Check:`" (the executor agent file stays unchanged: its preamble is at its token budget).

**If `phase_found` is false:** Error — phase directory not found.
**If `plan_count` is 0:** Error — no plans found in phase.
**If `state_exists` is false but `.planning/` exists:** Offer reconstruct or continue. Auto (auto_mode, references/auto-mode.md K2): continue without reconstructing and log `auto_decision`.

When `parallelization` is false, plans within a wave execute sequentially.

**Sync chain flag with intent** — if user invoked manually (no `--auto`), clear the ephemeral chain flag from any previous interrupted `--auto` chain. This does NOT touch `workflow.auto_advance` (the user's persistent settings preference). Must happen before any config reads (checkpoint handling also reads auto-advance flags):
```bash
if [[ ! "$ARGUMENTS" =~ --auto ]]; then
  node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" config-set workflow._auto_chain_active false 2>/dev/null
fi
```
</step>

<step name="handle_branching">
Check `branching_strategy` from init and guard against the base branch. The base branch is `base_branch` from init (config `git.base_branch`, else the remote's default branch); when it is null the protected names are `main` and `master`.

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
```

**If `CURRENT_BRANCH` is the base branch AND `branching_strategy` is "none":**

Auto (auto_mode, references/auto-mode.md K2): when `auto_mode` is true or the run is otherwise non-interactive, do NOT ask. Take option A (create the phase branch), log `Auto: branch guard -> gsd/phase-{phase_number}-{phase_slug}`, and continue. Never auto-select "override".

Otherwise block with:
```
⛔ Branch Guard: You are on {CURRENT_BRANCH}

Running on the base branch is not allowed. Options:
  A) Create phase branch: gsd/phase-{phase_number}-{phase_slug}
  B) Create custom branch — type: "branch my-branch-name"
  C) Override — I know what I'm doing (type "override")
```
- **"A"**: `git checkout -b "gsd/phase-{phase_number}-{phase_slug}"`
- **"branch {name}"**: `git checkout -b "{name}"`
- **"override"**: proceed on the base branch (user accepted risk)
- **"stop"**: exit

**If `CURRENT_BRANCH` is NOT the base branch:** Proceed silently.

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

Parse JSON for: `phase`, `plans[]` (each with `id`, `wave`, `autonomous`, `objective`, `files_modified`, `task_count`, `has_summary`, `gap_closure`, `depends_on`, `declared_wave`), `waves` (map of effective wave number → plan IDs; `wave` is already raised past every `depends_on` plan, `declared_wave` is the frontmatter value), `incomplete`, `has_checkpoints`.

**Null safety:** `objective` may be `null` if the plan frontmatter omits it — always use a fallback: `plan.objective ?? "(no objective)"`. Do NOT pipe through python3 or shell scripts that assume fields are non-null; read the JSON value directly from the bash variable.

**Filtering:** Skip plans where `has_summary: true`. If `--gaps-only`: also skip plans where `gap_closure` is not `true` (a light-path gap plan, see plan-phase 8b, runs executor then verifier with no extra review). If all filtered: "No matching incomplete plans" → exit.

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
Execute each wave in sequence. Plans of a wave run one after another (rigour.md "Never relaxed" 6: one executor at a time per phase); `PARALLELIZATION` is ignored.

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

   **Model rule:** every spawn passes `model` explicitly (never omit; an omitted model inherits the spawner's tier), taken from init: fix dispatches `executor_model`; executors per the per-task routing below (a spike plan: its `executor_model` in `phase-plan-index`); a task escalates from haiku to sonnet after 2 failures; a sonnet task (or a spike plan executor) that fails twice gets ONE rescue, a `gsd-debugger` dispatch on `ruling_model` that fixes it or returns it to the planner, in place of a sonnet debugger, never an opus executor; the test steward and the fix re-check `reviewer_model`; the final phase review passes (verifier), rulings `ruling_model`, the configured top model (`references/models.md`; a rejected spawn retries once on `ruling_model_fallback` and says so); watchdogs and reports `utility_model`. This workflow holds no model literals.

   **Handoff brief (plan-level executor spawns at spike, and the verifier; a per-task executor gets none).** Assemble the fixed 5-section brief per `@get-shit-done/references/handoff-brief.md`, deterministically when possible: `node ~/.claude/get-shit-done/bin/gsd-tools.js handoff brief --json '{...}'` returns `brief_text`. PHASE GOAL from ROADMAP.md; KEY DECISIONS locked in CONTEXT.md and STATE.md for this phase; OPEN RISKS (the plan-checker's unresolved issues and watch-items); FILE MAP of the files the phase touches; HARD RULES the executor must honor. Put the result in `<handoff_brief>` of the spawn prompts below and of the verifier prompt.

   **Per-task routing.** Except at spike, spawn one executor per task, on the task's tier tag, with the bounded escalation loop and token-usage records, as `@~/.claude/get-shit-done/references/task-routing.md` says. The plan-level spawns below are the spike path (one executor per plan, `model` = the plan's `executor_model`).

   **For Wave 1 executors** (wave_number == 1, no prior context):
   ```
   Agent(
     subagent_type="gsd-executor",
     model="{plan executor_model}",
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
       @~/.claude/get-shit-done/references/handoff-brief.md
       </execution_context>

       <handoff_brief>
       {HANDOFF_BRIEF}
       </handoff_brief>

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
     model="{plan executor_model}",
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
       @~/.claude/get-shit-done/references/handoff-brief.md
       </execution_context>

       <handoff_brief>
       {HANDOFF_BRIEF}
       </handoff_brief>

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
   - Check the commit count for the plan is at least its task count (a plan that declares one aggregate commit is exempt)

   If ANY spot-check fails: report which plan failed, route to failure handler — ask "Retry plan?" or "Continue with remaining waves?"
   Auto (auto_mode, references/auto-mode.md K5): do not ask; run the deterministic ladder below (`execution-state record-failure`) for the plan and continue with the waves that do not depend on it.

   If pass:
   ```
   ---
   ## Wave {N} Complete

   **{Plan ID}: {Plan Name}**
   {What was built — from SUMMARY.md}
   {Notable deviations, if any}

   **Deviation note:** every departure from a plan or from this workflow (a task skipped or changed, a rule not followed, a model or round count different from what the rigour level calls for) gets one `deviation: {plan} - {what} - {why}` line in this wave report and in the `### Deviations` list of the aggregate result below. When you commit planning files for it, add `--trailer "Deviation: {plan}: {what}"` to `gsd-tools commit` so the git history carries it. No deviation: write `deviation: none`.

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

   1. **Clean interruption** — the trailer's `status` is `"interrupted"` (the executor self-stopped at a context-pressure boundary and wrote EXECUTOR-HANDOFF.json; header reads `## PLAN INTERRUPTED`; it may also have sent an App #1 `to: "main"` continuation signal). Handle as the pre-spawn handoff case (step 0.5 above), INCLUDING its resume-by-agentId-vs-cold-spawn decision (App #2): `EXECUTOR_AGENT_IDS[{plan_id}]` is normally still set, so PREFER `SendMessage(to: <agentId>, …)` to resume that executor from `next_task_index`; FALL BACK to archiving the handoff and cold-spawning a continuation executor with a `<prior_executor_handoff>` block. Log `--type executor_clean_interruption`. Do NOT call `execution-state record-failure`. A `status: "blocked"` trailer is NOT an interruption — surface it to the user with its `recommended_split`. Auto (auto_mode, references/auto-mode.md K4): park the phase and return `status: blocked` with the `recommended_split`; never wait.

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

   For real failures (not the classifyHandoffIfNeeded runtime bug, and not an executor death/interruption handled above) of a spike plan executor, call execution-state to get the auto-retry/debug/escalate decision. A per-task failure (standard path) never calls it: the ladder of `task-routing.md` (retry, escalation, the one rescue) already ran, so a task it leaves failed goes straight to the `escalate` branch below:

   ```bash
   STATE_RESULT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" execution-state record-failure \
     --phase {N} --plan {plan_id} --error "{error message}" --step "{last completed step}" \
     --files "{comma-separated files modified}" --raw)
   ```

   Parse `action`, `attempts`, `max_attempts` from `STATE_RESULT`.

   - **`action == "retry"`** (1st failure): Log "Auto-retry {plan_id} (attempt 2 of {max_attempts}) — no user prompt." Re-spawn the plan's executor fresh with the same plan context plus the failing evidence of the previous attempt (`references/task-routing.md` step 4). On success: `execution-state record-success --phase {N} --plan {plan_id}`, continue to next wave. On failure again: repeat this step (`attempts` is now 2).

   - **`action == "debug"`** (the 2nd failure; the tool returns it once per plan, every later failure is `escalate`): Log "Auto-spawning rescue debugger (`ruling_model`) for {plan_id} after {attempts} failures", log `tier_escalation` with `rescue:true`. Invoke @~/.claude/get-shit-done/workflows/debug.md non-interactively on the top model:
     ```
     mode: symptoms_prefilled: true, interactive: false, goal: find_and_fix
     model: {ruling_model}  (a rejected spawn retries once on {ruling_model_fallback})
     symptoms: expected="plan {plan_id} completes successfully", actual="{error}", errors="{error}", reproduction="re-run plan {plan_id}", timeline="this execution"
     debug_file: .planning/debug/{phase}-{plan_id}-attempt{attempts}.md
     ```
     After the debug workflow returns, re-spawn the plan's executor. On success: `execution-state record-success --phase {N} --plan {plan_id}`. On failure again: the next `record-failure` call returns `escalate`.

   - **`action == "escalate"`** (a failure after the rescue, or the `max_attempts` ceiling, or a task the per-task ladder left failed — NEVER spawn another debug attempt):
     1. Read the most recent `.planning/debug/{phase}-{plan_id}-attempt*.md` file's findings summary (or "No debugger findings available" if none exist).
     2. Never block on a human: write the debugger findings to `FAILURE.md`, run `deferred add --step execution --reason "..." --approver auto-escalate`, and print the finding in chat; record in SUMMARY.md that the plan was escalated.
     3. Mark this plan failed, report partial completion, continue with non-dependent plans only.

5.5. **Live course-correction relay (App #3, `@get-shit-done/references/agent-messaging.md`):** if a checker or QA agent (gsd-plan-checker, the UI QA agent) that is running while an executor is STILL producing work `SendMessage`s you (`to: "main"`) a mid-run finding, you MAY relay a correction to the in-flight executor: `SendMessage(to: <EXECUTOR_AGENT_IDS[{plan_id}]>, …)` with the finding so it can adjust before finishing wrong, instead of letting the plan complete and be redone. This stays coordinator-mediated (the checker/QA agent never messages the executor directly). The agent's structured return stays the durable record; delivery is at the executor's next tool round (hard semantic #1), so the relay is best effort, never a guaranteed halt. With no executor agentId, handle the finding after the run.

6. **Execute checkpoint plans between waves** — see `<checkpoint_handling>`.

7. **Proceed to next wave.**
</step>

<step name="checkpoint_handling">
Plans with `autonomous: false` require user interaction.

**Auto-mode checkpoint handling:**

`auto_mode` comes from init (no separate config reads). When executor returns a checkpoint AND `auto_mode` is true:
- **human-verify** → Auto-spawn continuation agent with `{user_response}` = `"approved"`. Log `⚡ Auto-approved checkpoint`.
- **decision** → Auto-spawn continuation agent with `{user_response}` = first option from checkpoint details. Log `⚡ Auto-selected: [option]`.
- **human-action** → Auto (auto_mode, references/auto-mode.md K4): never approve it. Park the phase, return `status: blocked` with the checkpoint's awaited action (auth gates cannot be automated), and report it in the final summary. When `auto_mode` is false, present it to the user (standard flow below).

**UI QA checkpoints — always auto-run (the UI QA capability is the human here):**

When executor returns `Type: ui-qa` — regardless of `auto_mode`:

1. Log: `⚡ UI QA: Starting UI QA automated testing...`

2. **Auto-start dev servers** — do NOT ask user to start servers:
   - For each `stack.services[]` entry (`gsd-tools.js profile get stack.services`; CLAUDE.md `## QA / Dev Server` is the fallback; neither: stop and report `stack.services is not set`), probe its `url`:
     ```bash
     curl -s --max-time 3 "$SERVICE_URL" > /dev/null 2>&1 && echo UP || echo DOWN
     ```
   - If DOWN: start it with its `launch` command in background.
   - Wait up to 30s for the service to respond. If still DOWN after 30s: log warning, proceed anyway (the UI QA agent reports server errors as issues).

3. **Run UI QA loop** (max 3 rounds):
   ```
   MAX_ROUNDS = 3
   round = 1
   qa_passed = false

   while round <= MAX_ROUNDS AND qa_passed == false:
     qa_result = Agent(
       subagent_type="<UI QA agent: stack.capabilities.ui_qa.agent; legacy: the project's configured QA agent>",
       model="{utility_model}",
       description="UI QA round {round}",
       prompt="mode=ui-qa\n<what_built>{what_built}</what_built>\n<test_flows>{test_flows}</test_flows>\n<round>{round}</round>{IF round > 1: <previous_issues>{previous_report}</previous_issues>}"
     )

     if qa_result.passed:
       qa_passed = true
       break

     if round == MAX_ROUNDS:
       Present ONLY the issue report — NOT server start instructions:
       "UI QA found {N} issues after {MAX_ROUNDS} rounds. Type 'continue' to proceed, or describe what to fix."
       Wait for user response. If 'continue': break. Else: spawn fix agent, re-run QA.
       Auto (auto_mode, references/auto-mode.md K1/K4): do not wait. When a QA run is recorded in the round reports, take 'continue' and keep the issue list for the verifier (K1); when no run is recorded, park the phase (K4).
       break

     FIX_TIER = qa_result.severity_counts.critical > 0 OR qa_result.severity_counts.high > 0 ? "{reviewer_model}" : "{executor_model}"
     Agent(subagent_type="general-purpose", model="{FIX_TIER}", description="Fix UI issues round {round}",
       prompt="Fix these UI issues: {qa_result.report_markdown}\nCommit each fix atomically.")
     round++
   ```

4. Spawn continuation agent with `{user_response}` = "UI QA passed" (or issue summary if not passed).
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

### Deviations
[One `deviation:` line per deviation from the wave reports and SUMMARYs, or "none"]
```
</step>


<checkpoint type="verify" name="phase-completion-gate">
  <!-- Fires after all waves complete, before pre_verify_gates and verify_phase_goal. -->
  <!-- All blocking items must pass before the verifier is spawned. -->

  <!-- SUMMARY presence and Self-Check are checked by the script (`verify phase-gate`, step pre_verify_gates), not here. -->

  <!-- FPGATE-01 / DFGATE-01: prevention-infrastructure lifecycle gates. -->
  <!-- Each closes a documented POSTMORTEM escape class. If the target repo ships the -->
  <!-- corresponding Layer-1 gate (an entry in `stack.gates[]`), the gate RUNS it; if the -->
  <!-- profile has no such entry, the gate degrades to the static check described inline. -->

  <item id="FPGATE-01" severity="blocking">
    <check>The FP/routing/sizing violation-ratchet diff for this phase's changes is &lt;= 0 (no directory's violation count exceeds its recorded baseline)</check>
    <command>the run command of this ratchet's entry in `stack.gates[]` of `.planning/config.json` (legacy: no `stack.gates` => the repo's shipped FP gate script, as before) 2>&1 || echo FPGATE_FAIL</command>
    <pass>Gate exits 0 — every directory's measured violation count is at or below its `scripts/fp-violation-baseline.json` baseline (the ratchet is DOWN-only: a phase may reduce or hold counts, never raise them). If `stack.gates[]` is declared but has no entry for this ratchet (legacy with no `stack.gates` and no shipped FP gate script likewise), PASS only when no new empty-catch, non-`match()` handler, or oversized file was introduced by this phase.</pass>
    <fail>BLOCKING — a directory's violation count rose above baseline (`FPGATE_FAIL`, or the gate's `exceeded[]` array is non-empty). A phase may NEVER raise the ratchet. Closes POSTMORTEM FP classes 1 (swallowed errors), 2 (mutation), 7 (god-files/size), 8 (non-`match()` branching). Fix the new violations or, for a seeded pre-existing count, re-baseline deliberately — do NOT bypass.</fail>
  </item>

  <item id="DFGATE-01" severity="blocking">
    <check>No plan or SUMMARY in this phase contains deferral language for this phase's own tests/QA/verification</check>
    <command>grep -rniE "tests? to be added later|QA deferred|will verify in (the )?next phase|deferred to (post-milestone|future phase)|TODO:? add auth|follow-?up:? (add )?tests|test later|verify later" .planning/phases/{phase_dir}/ 2>/dev/null || echo NONE</command>
    <pass>Output is NONE. The `deferred-items.md` sanctioned channel (pre-existing, out-of-scope issues from the executor's `&lt;scope_boundary&gt;`) is exempt — only deferral of THIS phase's own tests/QA/verification trips the gate.</pass>
    <fail>BLOCKING — convert every match into a concrete test/QA task in THIS phase, or move a genuinely out-of-scope, pre-existing item into `deferred-items.md` with a justification. Never `--no-verify` past it.</fail>
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
     model="{reviewer_model}",
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

**Output:** Updated scenarios in `stack.paths.e2e_scenarios`, updated E2E-TEST-PLAN.md with coverage status, `E2E-GENERATION-FAILED.json` written on failure / cleared on success.

</step>

<step name="post_phase_ux_sweep">

After ALL plans in this phase have completed execution, before `pre_verify_gates`.

**Skip** when `ui_qa_mode` (init) is `none`, or when this phase produced no web UI: `verify phase-gate "${PHASE}" --pre-verifier` reports `ui_qa_required: false` AND no SUMMARY.md `key-files` entry is a web-framework view file. Otherwise run the UX audit below; a project that declares the UI QA capability has no mechanism to skip it for a phase that changed UI.

1. **Start the services** without asking:
   ```bash
   SH_RESULT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" service-health start default --raw 2>/dev/null)
   SH_STATUS=$(echo "$SH_RESULT" | node -e "try{const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(r.status||'')}catch{}")
   ```
   `already_running` or `started`: continue. `no_config` or empty: probe each `stack.services[].url` and start a DOWN one with its `launch` command in the background, waiting up to 30s; with no `stack.services` and no CLAUDE.md section, stop and report `stack.services is not set`. `start_timeout`: read the project's CLAUDE.md startup instructions and retry; still failing after 60s returns a `human-action` checkpoint (never skip the sweep: the UI QA capability cannot test a dead server). Auto (auto_mode, references/auto-mode.md K4): park the phase and report the dead service; never wait.
2. Derive the test scope from the phase success criteria and the SUMMARY.md `key-files`.
3. Run the UI QA agent once with `mode=ux-audit`:
   ```
   Agent(
     subagent_type="<UI QA agent: stack.capabilities.ui_qa.agent; legacy: the project's configured QA agent>",
     model="{reviewer_model}",
     description="UX audit phase {phase_number}",
     prompt="mode=ux-audit\nwhat_built={phase goal + key UI files from the SUMMARYs}\ntest_flows={derived from the phase success criteria}\nround=1"
   )
   ```
4. Issues found: spawn a fix agent (`model` per the FIX_TIER rule in `checkpoint_handling`), then re-run the audit; at most 2 fix rounds for UX issues, critical/high blocking.

This runs IN ADDITION to any `ui-qa` checkpoint inside individual plans: those test one plan's scope, this tests the whole phase's UI together.

</step>

<step name="post_phase_e2e">

After `post_phase_ux_sweep` and before `pre_verify_gates`. Runs only when `stack.capabilities.ui_qa` and a `stack.services[].launch` command exist and `ui_qa_mode` is not `none`; otherwise skip.

1. Collect `e2e_flows` from every plan frontmatter in this phase:
   ```bash
   E2E_FLOWS=$(for plan in {phase_dir}/*-PLAN.md; do
     node ~/.claude/get-shit-done/bin/gsd-tools.js frontmatter get "$plan" --field e2e_flows 2>/dev/null
   done | jq -s 'flatten | unique')
   ```
2. Empty or null: skip this step.
3. Start the services exactly as in `post_phase_ux_sweep` step 1, then spawn the UI QA agent with `mode=e2e`:
   ```
   Agent(
     subagent_type="<UI QA agent>",
     model="{reviewer_model}",
     description="E2E test phase {phase_number}",
     prompt="mode=e2e\ne2e_flows={E2E_FLOWS}\nproject_dir={project_dir}\nround=1"
   )
   ```
4. Parse the results:
   - All flows pass: log `E2E: {N} flows passing` and continue.
   - A flow fails with Critical or High severity: create a gap entry and spawn a gap-closure plan. BLOCKING: do not proceed to verification until the gaps are closed.
   - A flow fails with Medium severity: create a gap entry and record it in the phase QA report; the verifier flags it as `gaps_found`. Never ignore it.
   - A flow fails with Low severity: log it as informational and record it in the phase QA report.

</step>

<step name="docs_update">
After the last wave and the UI steps, before `mechanical_gates` (the capture must be newer than every commit but the verifier's own); not at `spike`. ONCE per phase, never per plan or task. Skip (one-line note) when the phase diff holds no documentation-worthy change: a new or changed endpoint, route or page, schema or migration, service or middleware, or auth or onboarding flow (not refactors, tests, CI or config only).

ONE dispatch, `Agent(subagent_type="gsd-docs-updater", model="{utility_model}", description="Docs phase {N}")`, given the phase's SUMMARY paths, the changed files and the project root. It follows the project's `/docs` conventions, commits, and returns `written_files`, `commit`, `errors`. A thrown error, a non-empty `errors`, or empty `written_files` with `commit: "none"` for a documentation-worthy phase is a failed step: re-dispatch once, then record the exception with `deferred add "${PHASE}" --step docs --reason <reason> --approver <approver>` (auto mode: never approve it yourself; park the phase and name the missing docs). Name the written files in the verifier prompt.
</step>

<step name="mechanical_gates">
After the last wave, the UI steps and `docs_update`, before `pre_verify_gates`. Run the mechanical gates ONCE on the final tree and write their output to `{phase_dir}/captures/gates.txt` (create the directory). The final review reads that capture and never re-run the full suite.

1. Every entry of `gsd-tools profile get stack.gates` (typecheck, lint, format and the project's ratchet, security and dependency gates; legacy: no `stack.gates` => the gate scripts the repo ships; none configured: the profile's `typecheck` and `lint` commands), then the full test run `<stack_commands.test_all>`, each through the profile's own command. For each the capture holds the command, `rc=`, the pass/fail counts, the per-file or per-bucket seconds the runner prints, and for a gate that scans files the number it scanned. A gate that scanned 0 files is inert and counts as failed.
2. A red result: ONE `{executor_model}` fix dispatch with the failing lines (rule 12 of `references/rigour.md` gives its shape); then re-run only the touched test files (and their bucket when the project defines buckets) and append that output to `gates.txt`. The full run is not repeated.
3. This is the phase's one full run. The twice-green pass over all buckets runs once at milestone end, never per phase (`references/gsd-test-protocol.md` `test_cost_rule`).
</step>

<step name="test_steward">
After `mechanical_gates`, before `pre_verify_gates`. Standard rigour only: skip at `spike`, and skip (one-line note, no dispatch) when `git diff {phase base}..HEAD --name-only` lists no test file.

ONE dispatch, `Agent(subagent_type="gsd-test-writer", model="{reviewer_model}", description="Test steward phase {N}")`, given the phase's test files, `{phase_dir}/captures/gates.txt`, the plans' `<acceptance>` rows and `stack_commands`. It deletes, merges or speeds up tests as its role file says (a deletion only with a cited surviving proof) and returns net change and runtime delta. Rerun only the files it touched and append the output to `gates.txt`; the gates capture is appended after the steward's commit. Pass its return to the final pass(es): a phase with a net-positive test count and no stated reason is a finding for the final review.
</step>

<step name="pre_verify_gates">

### Step 6.4: Pre-Verification Gates (BLOCKING)

Before proceeding to verification, these gates must pass. They cannot be deferred.

**Gate 1 — Deterministic phase-gate (BLOCKING):**

`--pre-verifier` exempts the two artifacts the verifier itself writes (`{N}-VERIFICATION.md` existence/status and `ui_qa_ran`); running the gate without it before the verifier is circular. The final gate (after the verifier, no flag) still requires both.

Run the deterministic, git-diff-derived phase gate instead of self-reporting artifact existence. This single call replaces the prior "check `type: frontend`/`checkpoint: ui-qa`/`.tsx`/`.jsx` by hand" prose — it covers UI QA evidence, plus test/docs/e2e-plan/verification existence, from actual touched files and waivers, not plan self-reports:

```bash
PHASE_GATE_RESULT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" verify phase-gate "${PHASE}" --pre-verifier)
PHASE_GATE_EXIT=$?
```

This is the form gate: form is checked here, by a script, and nowhere else. At `spike` the script reports `test`, `docs`, `ui_qa` and `e2e_plan` as `not_applicable` itself: write no waiver, no `deferred add` and no `A-` row for them. If `PHASE_GATE_EXIT` is non-zero, split the output:

- **Form errors** (`form_errors`: SUMMARY Self-Check section missing; a planning-record line cite in a PLAN or SUMMARY this phase wrote): no fix dispatch, no ruling, no waiver, no gap, no park; plan caps are a plan-time check. They are closed in `update_roadmap` with `phase complete --form-debt`.
- **Missing work** (`failures` and `work_errors`: `missing_evidence`, `missing_test`, `missing_docs`, `missing_charlotte_qa` (the legacy code for UI QA), `e2e_generation_failed`): (a) produce the missing artifact and re-run the gate, or (b) for a documented exception run `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" deferred add "${PHASE}" --step <step> --reason <reason> --approver <approver>` and re-run. A skip is always recorded with `deferred add`, never after the fact.

Auto (auto_mode, references/auto-mode.md K4): missing work takes (a), then the gate re-runs; never approve a waiver (b) yourself. Still missing after one fix round: park the phase, return `status: blocked` naming the failures. Form errors never park; missing work always does.

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
Check must_haves against actual codebase. Review the phase diff `git diff {phase base}..HEAD -- . ':!.planning'` against the plans{, the threat model `{N}-THREAT-MODEL.md` when present}, with the final-review brief of `references/rigour.md` rule 11, and write the findings to `{phase_dir}/{N}-REVIEW.md` (record format: rule 10). The test steward's return: {net change and runtime delta, or "skipped"}; a net-positive test count with no stated reason is a finding. Gate and test results: read `{phase_dir}/captures/gates.txt` (it must be newer than the last code commit); do not re-run the full suite.
Cross-reference requirement IDs from PLAN frontmatter against REQUIREMENTS.md — every ID MUST be accounted for.
Judge product truth only; form was gated by a script. A form defect you notice is mentioned in your report body and never changes the status.
Cite planning records by id (D-NN, A-NN, requirement id, plan id), never by line; code by file:line.
risk_addons: {risk_addons}
On a re-verification (after a gap cycle) check only the truths that failed last time and the files the gap plans changed, rewrite VERIFICATION only, and append your verdict per earlier finding to `{N}-REVIEW.md` keeping its `passes`.
Create VERIFICATION.md.
@~/.claude/get-shit-done/references/handoff-brief.md
<handoff_brief>
{HANDOFF_BRIEF, with HARD RULES = the rules the phase was verified against}
</handoff_brief>",
  subagent_type="gsd-verifier",
  model="{ruling_model}",  # the configured top model: the final phase review always runs on it (references/models.md)
  description="Verify phase {phase_number}"
)
```

**Passes.** The prompt above is final pass 1. Standard: ONE pass, then rule 12 of `references/rigour.md` (fix, `{reviewer_model}` re-check which rewrites the statuses and counts, ruling) before the status routing below. Risk add-ons (`risk_addons` true), sequential: pass 1 (`passes: 1`), then ONE fix dispatch for its findings, then pass 2, then (only when pass 2 has findings) its fix dispatch, the `{reviewer_model}` re-check of those fix commits only, and the one ruling for what stays open at CRITICAL/HIGH. Pass 2 is a fresh `{ruling_model}` agent on the FIXED tree. Its prompt is NOT the prompt above (that is pass 1's plan-and-diff brief); use this one, the brief itself is rule 10 of `references/rigour.md`:

```text
Final review pass 2, phase {phase_number} (dir {phase_dir}, goal {goal}, requirement ids {phase_req_ids}). Brief: `references/rigour.md` rule 10, pass 2. Diff: `git diff {phase base}..HEAD -- . ':!.planning'`; also read {phase_dir}/captures/gates.txt and the test steward's return ({net change and runtime delta, or "skipped"}).
Pass 1 finding ids and the fix commit shas (only to judge each closed / still open and any new defect a fix introduced; they are not things to look for): {ids}; {shas}.
Rewrite {phase_dir}/{N}-REVIEW.md with `passes: 2` and VERIFICATION's status and `open_critical_high`.
```

After pass 2's own fix, rule 12's re-check rewrites them again. It runs once even when pass 1 had no findings. The phase report lists the `scriptable: yes` findings as proposed project gates.

**Spike:** when `rigour` is `spike`, replace the check list in the prompt with the spike checks and the final-review questions of `references/rigour.md` (verifier row); nothing else is checked. At every rigour the prompt asks for `open_critical_high` (and `ruled_by` after a ruling) in the VERIFICATION frontmatter. The final review and its fix dispatch are never skipped for budget (rigour.md rule 7); `phase complete` refuses while a CRITICAL/HIGH is open without a ruling id. A rejected spawn retries once on `{ruling_model_fallback}` and says so.

Read status:
```bash
grep "^status:" "$PHASE_DIR"/*-VERIFICATION.md | cut -d: -f2 | tr -d ' '
```

Record the lifecycle marker immediately, on all three statuses (`phase complete` in `update_roadmap` refuses a phase whose `CHECKPOINT.json` is not at `verify`; this command is its only writer):
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" phase checkpoint "${PHASE_NUMBER}" --step verify --status {passed|human_needed|gaps_found}
```

| Status | Action |
|--------|--------|
| `passed` | → update_roadmap |
| `human_needed` | Present items for human testing, get approval or feedback. Auto (auto_mode, references/auto-mode.md K4): do not wait; park the phase and return `status: human_needed` with the items |
| `gaps_found` | A gap is a failed product truth, never a form defect. Present gap summary, offer `/gsd:plan-phase {phase} --gaps`. Auto (auto_mode, references/auto-mode.md K5): one closure cycle (`/gsd:plan-phase {phase} --gaps --auto --no-advance`, then `/gsd:execute-phase {phase} --gaps-only --auto --no-transition`); still `gaps_found` afterwards: return `status: gaps_found` |

Commit the verifier's output AFTER the dispatch and AFTER the status routing above is read, but **before acting on the routing**, on ALL THREE paths (`passed`, `human_needed` and `gaps_found`):

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs(phase-${PHASE_NUMBER}): record verification" --files {phase_dir}/*-VERIFICATION.md
```

Add `{phase_dir}/{N}-REVIEW.md` to `--files` when it exists.

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

When `form_errors` remain at the pre-verifier or final gate, run `phase complete "${PHASE_NUMBER}" --form-debt` instead: it records them in VERIFICATION frontmatter `form_debt` and still refuses on missing work. A form debt never parks, never becomes `gaps_found` and never blocks dependents.

The CLI handles:
- Marking phase checkbox `[x]` with completion date
- Updating Progress table (Status → Complete, date)
- Updating plan count to final
- Advancing STATE.md to next phase

Extract from result: `next_phase`, `next_phase_name`, `is_last_phase`.

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" commit "docs(phase-{X}): complete phase execution" --files .planning/ROADMAP.md .planning/STATE.md .planning/REQUIREMENTS.md {phase_dir}/*-VERIFICATION.md
```
</step>

<step name="demo_script">
Skip when `gsd-tools.js config get demo.mode --raw` is `off`, when `gsd-tools.js verify phase-gate {X}` does not report `ui_qa_required: true`, or when the VERIFICATION status is not `passed`. Otherwise follow `@~/.claude/get-shit-done/workflows/demo.md` section 1 (script only, no stack, one `utility_model` call) and commit the two files with the phase docs. Recording happens later, in the stack window, per `demo.md` section 2.
</step>

<step name="offer_next">

**Exception:** If `gaps_found`, the `verify_phase_goal` step already presents the gap-closure path (`/gsd:plan-phase {X} --gaps`). No additional routing needed — skip auto-advance.

**No-transition check (spawned by auto-advance chain):**

Parse `--no-transition` flag from $ARGUMENTS.

**If `--no-transition` flag present:**

Execute-phase was spawned by a caller that sequences phases itself (plan-phase's auto-advance, or the phase coordinator). Do NOT run transition.md.
After verification passes and roadmap is updated, return completion status to parent:

```
## PHASE COMPLETE

Phase: ${PHASE_NUMBER} - ${PHASE_NAME}
Plans: ${completed_count}/${total_count}
Verification: {Passed | Gaps Found}

[Include aggregate_results output]
```

End with a fenced JSON trailer as the last content: `{"status": "completed"|"gaps_found"|"human_needed"|"blocked"|"failed", "phase": "{N}", "completed_plans": {n}, "total_plans": {n}}`; `completed` only when `phase complete` exited 0.

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

<live_window_protocol>
A phase that needs the shared local stack (migrations, DB fixtures, integration tests) follows the project's shared-stack rule (`.claude/rules/shared-stack.md`, "Live windows": entry gate, polling, per-plan landing, edge-source freeze). It applies only when `stack.isolation.lock_dir` is set; a project without a shared stack has no live window. An unattended agent that hits a permission prompt stops and reports the exact command string; it never reshapes the command.
</live_window_protocol>

<context_efficiency>
Orchestrator: ~10-15% context. Subagents: fresh 200k each. No polling (Task blocks). No context bleed.
</context_efficiency>

<failure_handling>
- **classifyHandoffIfNeeded false failure:** Agent reports "failed" but error is `classifyHandoffIfNeeded is not defined` → Claude Code bug, not GSD. Spot-check (SUMMARY exists, commits present) → if pass, treat as success
- **Agent fails mid-plan:** Missing SUMMARY.md → report, ask user how to proceed. Auto (auto_mode, references/auto-mode.md K5): run the `execution-state record-failure` ladder instead of asking
- **Dependency chain breaks:** Wave 1 fails → Wave 2 dependents likely fail → user chooses attempt or skip. Auto (auto_mode, references/auto-mode.md K5): skip the dependents and continue with independent plans
- **All agents in wave fail:** Systemic issue → stop, report for investigation
- **Checkpoint unresolvable:** "Skip this plan?" or "Abort phase execution?" → record partial progress in STATE.md. Auto (auto_mode, references/auto-mode.md K4): park the phase
</failure_handling>

<resumption>
Re-run `/gsd:execute-phase {phase}` → discover_plans finds completed SUMMARYs → skips them → resumes from first incomplete plan → continues wave execution.

STATE.md tracks: last completed plan, current wave, pending checkpoints.
</resumption>
