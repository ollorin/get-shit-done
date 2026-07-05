<purpose>
Execute entire ROADMAP.md autonomously with Opus coordinator spawning sub-coordinators per phase.
</purpose>

<core_principle>
Coordinator stays lean — parses roadmap, tracks DAG, spawns phases. Each phase gets fresh 200k context. No context rot across multi-phase execution.
</core_principle>

<required_reading>
Read STATE.md before any operation to load project context.
</required_reading>

<process>

<step name="initialize" priority="first">
Load roadmap context:

```bash
INIT_FILE="/tmp/gsd-roadmap-init-$$.json"
node ~/.claude/get-shit-done/bin/gsd-tools.js init execute-roadmap > "$INIT_FILE"
```

Parse JSON for:
- `roadmap_exists`: boolean — if false, error and exit
- `total_phases`: number of phases
- `execution_order`: ordered array of phase numbers
- `parallel_opportunities`: phases that can run together
- `next_executable`: phases immediately runnable
- `blocked_phases`: phases with unmet dependencies
- `has_execution_log`: whether previous execution exists
- `resume_state`: if previous incomplete execution found, resume context
- `coordinator_model`: model for this coordinator (opus)

**If `roadmap_exists` is false:** Error — ".planning/ROADMAP.md not found. Initialize project first."

**If `resume_state` is set:** Present resume prompt before continuing (see `<step name="resume_capability">`).
</step>

<step name="branch_guard">
**Check branch before any execution — never commit directly to main/master.**

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BRANCHING_STRATEGY=$(node ~/.claude/get-shit-done/bin/gsd-tools.js config-get git.branching_strategy 2>/dev/null || echo "none")
MILESTONE_VERSION=$(grep -m1 "^## Milestone" .planning/ROADMAP.md | sed 's/.*v\([0-9.]*\).*/\1/' || echo "")
MILESTONE_SLUG=$(grep -m1 "^## Milestone" .planning/ROADMAP.md | sed 's/## Milestone [^ ]* — //' | tr '[:upper:] ' '[:lower:]-' | tr -cd '[:alnum:]-' | cut -c1-40 || echo "work")
```

**If `CURRENT_BRANCH` is `main` or `master`:**

Present blocking message:
```
⛔ Branch Guard: You are on {CURRENT_BRANCH}

Roadmap execution commits many changes. Running on main risks polluting the main
branch with partial or broken work.

Options:
  A) Create milestone branch now: {MILESTONE_VERSION}-{MILESTONE_SLUG}
  B) Create custom branch — type: "branch my-branch-name"
  C) Override — I know what I'm doing (type "override")
```

Wait for user response:
- **"A"** or "yes": `git checkout -b "{MILESTONE_VERSION}-{MILESTONE_SLUG}"` → log branch → proceed
- **"branch {name}"**: `git checkout -b "{name}"` → log branch → proceed
- **"override"**: log warning, proceed on main (user explicitly accepted risk)
- **"stop"** / anything else: exit cleanly

**If `CURRENT_BRANCH` is NOT main/master:** Proceed silently — already on a feature branch.

**If `BRANCHING_STRATEGY` is "milestone" AND not on main:** Inform user which branch will be used (current branch — already correctly set up).
</step>

<step name="preflight_quota_estimate">
Before presenting the execution plan in `confirm_execution` below, estimate whether the current quota budget can plausibly cover the phases about to run. Read-only + one CLI call + a conditional log/prompt — matches this workflow's "coordinator stays lean" core principle, no extra context cost.

**1. Compute remaining phases** (reuse the exact same disk-status check `execute_phases` step 2 already uses for dependency checks — do not reinvent):
```bash
REMAINING_PHASES=0
# For each phase in {execution_order}:
for PHASE_NUM in {execution_order}; do
  PHASE_INFO=$(node ~/.claude/get-shit-done/bin/gsd-tools.js roadmap get-phase ${PHASE_NUM})
  DISK_STATUS=$(node -e "console.log(JSON.parse(process.argv[1]).disk_status || '')" "$PHASE_INFO")
  if [ "$DISK_STATUS" != "complete" ]; then
    REMAINING_PHASES=$((REMAINING_PHASES + 1))
  fi
done
```

**2. Run the estimate** (composes automatically with 51-01's self-healed `loadQuotaState` — never reads the raw quota file directly):
```bash
QUOTA_ESTIMATE=$(node ~/.claude/get-shit-done/bin/gsd-tools.js resilience estimate-quota --phases ${REMAINING_PHASES})
SUFFICIENT=$(node -e "console.log(JSON.parse(process.argv[1]).sufficient)" "$QUOTA_ESTIMATE")
ESTIMATED_TOKENS=$(node -e "console.log(JSON.parse(process.argv[1]).estimated_tokens)" "$QUOTA_ESTIMATE")
REMAINING_BUDGET=$(node -e "console.log(JSON.parse(process.argv[1]).remaining_budget)" "$QUOTA_ESTIMATE")
QUOTA_SOURCE=$(node -e "console.log(JSON.parse(process.argv[1]).source)" "$QUOTA_ESTIMATE")
```

**3. If `SUFFICIENT` is `false`:** this is a deliberate pause point, NOT a hard block — the human/autonomous caller can still choose to proceed. Log loudly:
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type quota_preflight_insufficient \
  --data '{"remaining_phases": '"${REMAINING_PHASES}"', "estimated_tokens": '"${ESTIMATED_TOKENS}"', "remaining_budget": '"${REMAINING_BUDGET}"', "source": "'"${QUOTA_SOURCE}"'"}'
```
Append to the `confirm_execution` prompt below:
```
⚠ Quota estimate: ~{ESTIMATED_TOKENS} tokens needed for {REMAINING_PHASES} remaining phases,
but only ~{REMAINING_BUDGET} tokens remain in the current session quota (source: {QUOTA_SOURCE}).
This run may hit a session/quota limit mid-phase.

Type "yes" to proceed anyway, "wait" to pause until quota resets, or "stop" to cancel.
```
If autonomous (no human present — same convention as `gsd-phase-coordinator.md`'s no-Telegram/no-`ask_blocking_question` autonomous path): default to "yes" (proceed), but the loud log above still fires unconditionally — never silently downgrade or skip the warning.

**4. If `SUFFICIENT` is `true`:** proceed silently (no extra prompt noise appended to `confirm_execution`), but still log for the analytics trail:
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type quota_preflight_ok \
  --data '{"remaining_phases": '"${REMAINING_PHASES}"', "estimated_tokens": '"${ESTIMATED_TOKENS}"', "remaining_budget": '"${REMAINING_BUDGET}"'}'
```
</step>

<step name="preflight_skew_check">
Self-referential staleness check (MILE-25): only meaningful when this orchestrator is itself running from a GSD source checkout (never for target projects being built with GSD). Read-only, non-blocking, never requires reinstall/restart to take effect for THIS run — it only affects future runs.

**1. Detect GSD source checkout:**
```bash
IS_GSD_CHECKOUT=false
if [ -f "get-shit-done/bin/gsd-tools.js" ]; then IS_GSD_CHECKOUT=true; fi
```

**2. If NOT a GSD source checkout:** log "skew check skipped — not a GSD source checkout" and continue to `confirm_execution`.

**3. If a GSD source checkout:** run the doctor check and log:
```bash
DOCTOR_RESULT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js doctor --raw)
CLEAN=$(node -e "console.log(JSON.parse(process.argv[1]).clean)" "$DOCTOR_RESULT")
if [ "$CLEAN" != "true" ]; then
  node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
    --type skew_detected \
    --data "$DOCTOR_RESULT"
  echo "⚠ Installed GSD copy has drifted from this source checkout — see execution log. This does not block the current run."
fi
```
</step>

<step name="confirm_execution">
Present execution plan to user before any autonomous action:

```
## Roadmap Execution Plan

**Total phases:** {total_phases}
**Execution order:** {execution_order}
**Parallel opportunities:** {parallel_opportunities}

### Phase Sequence

| # | Phase | Status | Dependencies |
|---|-------|--------|--------------|
| 1 | {name} | {disk_status} | {depends_on} |
...

**Estimated duration:** ~{N * 5-15} minutes (varies by phase complexity)

Confirm autonomous execution? This will execute all incomplete phases sequentially.

Type "yes" to begin, "skip {N}" to skip a phase, or "stop" to cancel.
```

If user types "stop": exit cleanly.
If user types "skip {N}": mark phase N as skipped in execution log, continue.
If user types "yes": proceed to `initialize_execution_log`.
</step>

<step name="initialize_execution_log">
Create or append to `.planning/EXECUTION_LOG.md`:

```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type roadmap_start \
  --data '{"total_phases": {N}, "execution_order": [...], "timestamp": "..."}'
```

Log format: JSONL lines after markdown header, enabling streaming append:
```
# Execution Log
{"type":"roadmap_start","timestamp":"...","total_phases":8,"execution_order":[1,3,2,4,5,6,7,8]}
```

**Create Telegram forum topic for this execution:**

Derive `roadmap_name` from the first heading in ROADMAP.md (`# Roadmap: {name}` → strip "Roadmap: " prefix). Fallback to "Roadmap" if not found.

If the Telegram MCP is available, create a dedicated forum topic to receive all execution notifications:

```
telegram_topic_id = null
try:
  topic_result = mcp__telegram__create_topic({
    title: "GSD: {roadmap_name} — {current_date}"
  })
  telegram_topic_id = topic_result.threadId
  // Store thread_id in execution log so phase coordinators can read it
  node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
    --type telegram_topic_created \
    --data '{"thread_id": {telegram_topic_id}, "title": "GSD: {roadmap_name} — {current_date}"}'
except (MCP not available / TELEGRAM_BOT_TOKEN not set):
  // No Telegram configured — silent, expected case
  telegram_topic_id = null

except (any other error — e.g. bot not admin, group not found, API error):
  // Telegram IS configured but create_topic failed — notify user visibly
  telegram_topic_id = null
  node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
    --type telegram_topic_failed \
    --data '{"reason": "{error.message}", "timestamp": "{ISO}"}'
  // Write a visible warning to the execution output:
  console.warn("WARNING: Telegram notifications disabled for this run — create_topic failed: {error.message}")
  // Also attempt to send a plain group message (no thread) if bot token is set:
  try:
    mcp__telegram__send_message({
      text: "WARNING: Failed to create forum topic for this roadmap run. Notifications are disabled.\nReason: {error.message}"
    })
  except: pass  // Best-effort only
```

if telegram_topic_id is null AND TELEGRAM_BOT_TOKEN is set:
  // Telegram is configured but not operational for this run
  // All subsequent `if telegram_topic_id is not null:` guards will correctly suppress notifications
  log.warn("Telegram topic creation failed — all thread-targeted notifications suppressed for this run")

The `telegram_topic_id` variable persists in the coordinator's context for the duration of the execution. Pass `thread_id: telegram_topic_id` (when non-null) to all subsequent `mcp__telegram__send_message` calls.

**Send execution start notification:**

```
if telegram_topic_id is not null:
  mcp__telegram__send_message({
    text: "Roadmap execution started\n\nPhases: {execution_order joined with ', '}\n\n{For each phase in execution_order: '- Phase {N}: {phase_name}'}\n\nTotal: {total_phases} phases",
    thread_id: telegram_topic_id
  })
```
</step>

<step name="execute_phases">
For each phase in execution order:

**1. Check skip list:**
- If user skipped this phase: log `phase_skipped`, continue to next

**2. Check dependencies:**
```bash
# For each dep in phase.depends_on:
node ~/.claude/get-shit-done/bin/gsd-tools.js roadmap get-phase {dep}
# Check disk_status == "complete"
```

If any dependency not complete:
- Attempt to execute dependency first (recursive)
- If dependency blocked: present blocker, wait for user resolution

**3. Log phase start:**
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type phase_start \
  --data '{"phase": {N}, "name": "...", "timestamp": "..."}'
```

**4. Spawn sub-coordinator (fresh context window):**

Read coordinator model from config (fallback to sonnet):
```bash
COORDINATOR_MODEL=$(jq -r '.coordinator_model // "sonnet"' .planning/config.json 2>/dev/null || echo "sonnet")
```

```
Agent(
  subagent_type="gsd-phase-coordinator",
  model="{COORDINATOR_MODEL}",
  description="Execute phase {N}",
  prompt="Execute Phase {N}: {name}

  Phase directory: .planning/phases/{phase_dir}/
  Phase goal: {goal}

  Full lifecycle — ALL steps mandatory, in order:
  1. Research (skip if not needed)
  2. Plan — MUST include tdd='true' tasks for API work, checkpoint:ui-qa for UI work.
     Planner MUST run validate_testing_gate before returning plans.
     If phase touches UI: generate E2E-TEST-PLAN.md via gsd-ui-inventory + gsd-e2e-test-generator.
  3. Execute — tdd tasks spawn gsd-test-writer (min 6 tests, 6 categories).
     checkpoint:ui-qa tasks trigger Charlotte QA loop (3 rounds) + MANDATORY ux-audit.
     Post-plan test gate: full test suite must pass before SUMMARY.md.
  4. Post-execution — If web project: run post_phase_ux_sweep (Charlotte ux-audit, unconditional).
     If e2e_flows in plan frontmatters: run Charlotte e2e mode.
     If UI built: run E2E gap closure (Step 6.5 of execute-phase).
  5. Verify — MUST spawn gsd-verifier agent. NEVER write VERIFICATION.md inline for phases with UI.
     Verifier checks QGATE-07 (Charlotte ran), QGATE-10 (test files exist), QGATE-13 (E2E plan exists).

  HARD RULES:
  - Phase with .tsx/.jsx files CANNOT have verifier: coordinator in VERIFICATION.md
  - Phase with API endpoints CANNOT skip tdd tasks
  - Charlotte QA + UX audit CANNOT be skipped for web projects
  - Individual plans MUST stay under 400 lines. If a plan exceeds 400 lines, split it.
    DB migrations, edge function handlers, and integration tests are three separate plans — not one.
  - Before writing SUMMARY.md, set charlotte_qa_ran in CHECKPOINT.json (true if Charlotte ran, false if no UI).
    The orchestrator validates this after you return.

  CONTEXT OVERFLOW PREVENTION:
  - Do NOT read the full edge function file if it exceeds 1000 lines. Use LSP or grep for the specific handler.
  - Do NOT accumulate multiple plan executions in a single context. Execute one plan, write SUMMARY, checkpoint, return.
  - If you are approaching context limits, return a checkpoint with resume_from instead of trying to finish.

  Create checkpoint after each step.
  telegram_topic_id: {telegram_topic_id}
  Return structured completion state as JSON."
)
```

**4a. Detect coordinator death (runs before step 5's status branches):**

A genuine coordinator death is different from a normal `status: "failed"` task-logic failure — either the `Agent()` call itself throws/errors, or the returned text does not parse as the expected status JSON contract (e.g. it IS the raw death message, such as "You've hit your session limit · resets 12:30am", instead of JSON).

1. If the `Agent()` call threw, OR the returned text fails to parse as the expected status JSON contract, run:
```bash
DEATH_CHECK=$(node ~/.claude/get-shit-done/bin/gsd-tools.js resilience parse-death --text "{raw returned text or error message}")
IS_DEATH=$(node -e "console.log(JSON.parse(process.argv[1]).is_death)" "$DEATH_CHECK")
RESET_TIME_ISO=$(node -e "console.log(JSON.parse(process.argv[1]).reset_time_iso || '')" "$DEATH_CHECK")
```

2. Separately (regardless of whether step 1 matched), check staleness of the phase's own CHECKPOINT.json — default threshold is read from config's `resilience.staleness_threshold_minutes` when `--threshold-minutes` is omitted:
```bash
STALENESS_CHECK=$(node ~/.claude/get-shit-done/bin/gsd-tools.js resilience check-staleness .planning/phases/{phase_dir}/CHECKPOINT.json)
IS_STALE=$(node -e "console.log(JSON.parse(process.argv[1]).stale)" "$STALENESS_CHECK")
```

3. **The coordinator is presumed dead if `IS_DEATH` is `true` OR `IS_STALE` is `true`.**

4. **If presumed dead:**
   - Log loudly (coordinator death detected):
     ```bash
     REASON=$([ "$IS_DEATH" = "true" ] && echo "death_signature" || echo "staleness")
     node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
       --type coordinator_death_detected \
       --data '{"phase": {N}, "reason": "'"${REASON}"'", "reset_time_iso": "'"${RESET_TIME_ISO}"'"}'
     ```
   - Get the resume brief before doing anything else:
     ```bash
     RESUME_BRIEF=$(node ~/.claude/get-shit-done/bin/gsd-tools.js resilience resume-brief {N})
     BRIEF_TEXT=$(node -e "console.log(JSON.parse(process.argv[1]).brief_text)" "$RESUME_BRIEF")
     RESUME_FROM=$(node -e "console.log(JSON.parse(process.argv[1]).resume_from)" "$RESUME_BRIEF")
     ```
     If the phase's CHECKPOINT.json is missing entirely (coordinator died before its first checkpoint), `resilience resume-brief` already reports `resume_from: "discuss"` and a "starting from scratch" `brief_text` — this workflow needs no special-case handling for the missing-checkpoint case beyond the loud logging above; it is never a silent no-op.
   - **Wait-until-reset:** if `RESET_TIME_ISO` is non-empty, compute the wait duration and cap it at a sane maximum (6 hours) — if the reset time is implausibly far out (or unparseable/negative), do NOT sleep; log and escalate instead:
     ```bash
     NOW_EPOCH=$(date -u +%s)
     RESET_EPOCH=$(date -u -d "${RESET_TIME_ISO}" +%s 2>/dev/null || date -u -jf "%Y-%m-%dT%H:%M:%S" "${RESET_TIME_ISO%%.*}" +%s 2>/dev/null || echo "")
     MAX_WAIT_SECONDS=$((6 * 3600))
     WAIT_SECONDS=$([ -n "$RESET_EPOCH" ] && echo $((RESET_EPOCH - NOW_EPOCH)) || echo -1)
     ```
     - If `WAIT_SECONDS` is negative or exceeds `MAX_WAIT_SECONDS`: log and escalate instead of hanging:
       ```bash
       node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
         --type death_reset_time_implausible \
         --data '{"phase": {N}, "reset_time_iso": "'"${RESET_TIME_ISO}"'", "wait_seconds": '"${WAIT_SECONDS}"', "cap_seconds": '"${MAX_WAIT_SECONDS}"'}'
       ```
       Escalate via the same fire-and-forget Telegram notification pattern used in `handle_failure` step 3 (if `telegram_topic_id` is not null) — do not respawn immediately in this case; treat it the same as a phase failure requiring human awareness (falls through to `handle_failure`).
     - Otherwise, actually pause with a polling sleep loop (matching the Charlotte QA health-check polling pattern used elsewhere in this codebase) until the reset time is reached, THEN proceed to respawn:
       ```bash
       while [ "$(date -u +%s)" -lt "${RESET_EPOCH}" ]; do
         sleep 60
       done
       ```
   - **Respawn** — a fresh `Agent()` call, not a retry of the dead one: re-run the exact same `Agent(subagent_type="gsd-phase-coordinator", ...)` spawn block from step 4 above, but prepend `BRIEF_TEXT` to the prompt with a clear "RESUMING FROM DEATH" preamble (reuse the brief text verbatim — do not re-derive it):
     ```
     Agent(
       subagent_type="gsd-phase-coordinator",
       model="{COORDINATOR_MODEL}",
       description="Execute phase {N} (auto-resume)",
       prompt="{BRIEF_TEXT}

       Execute Phase {N}: {name}
       ... (identical remaining prompt body to step 4's spawn block above — full lifecycle, HARD RULES, CONTEXT OVERFLOW PREVENTION, telegram_topic_id, structured completion state) ...
       "
     )
     ```
   - Log the auto-resume spawn:
     ```bash
     node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
       --type auto_resume_spawned \
       --data '{"phase": {N}, "resume_from": "'"${RESUME_FROM}"'"}'
     ```
   - After respawn, fall through to step 5's existing status-branching logic on the NEW return value (the respawned coordinator's actual completion status) — 4a itself never decides completed/failed/etc., it only gets a fresh attempt running.
   - **No human input required for this path.** If Telegram is configured, send a fire-and-forget notification (matching this file's existing "zero blocking call sites" precedent) but do not wait for a reply before respawning:
     ```
     if telegram_topic_id is not null:
       mcp__telegram__send_message({
         text: "Phase {N}: coordinator death detected ({REASON}), auto-resuming from {RESUME_FROM}...",
         thread_id: telegram_topic_id
       })
     ```

5. **If NOT presumed dead:** proceed directly to step 5's existing logic below, unchanged.

**5. Handle result:**
- `status: "completed"`: proceed to **5a** (Charlotte gate) then **5b** (integration gate)
- `status: "completed_with_deferrals"`: coordinator hit context limits. Spawn fresh agents for deferred steps:
  - If `"verify"` in deferred: spawn `gsd-verifier` with handoff_summary from return
  - If `"charlotte_qa"` in deferred: will be caught by 5a gate
  - After all deferrals resolved: proceed to 5a → 5b
- `status: "failed"`: see `<step name="handle_failure">`
- `status: "blocked"`: present blocker, wait for resolution
- `status: "gaps_found"`: offer gap closure cycle, then continue
- `status: "human_needed"`: present human items, await approval

Also check for deferred-items.md in the phase directory:
```bash
if [ -f ".planning/phases/{phase_dir}/deferred-items.md" ]; then
  # Phase deferred some work — surface it
  echo "⚠ Phase {N} has deferred items"
  cat ".planning/phases/{phase_dir}/deferred-items.md"
  # Ask: fix now or defer to gap closure?
fi
```

**5a. Charlotte QA gate (BLOCKING — owned by orchestrator, not coordinator):**

Check if the phase has UI work using the deterministic, git-diff-derived phase gate (never a markdown/frontmatter self-report scan):
```bash
PHASE_GATE_RESULT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js verify phase-gate {N})
HAS_UI=$(node -e "console.log(JSON.parse(process.argv[1]).has_ui === true ? 'true' : '')" "$PHASE_GATE_RESULT")
```

`has_ui` is computed from the phase's actual touched files (extension + route-path detection), independent of what any PLAN.md/SUMMARY.md self-reports — a `.tsx` file omitted from a plan's key-files still triggers this gate.

**If HAS_UI is non-empty:**

Check CHECKPOINT.json for `charlotte_qa_ran: true`. If missing or false:

```
⛔ CHARLOTTE QA GATE — BLOCKING

Phase {N} has UI work but no Charlotte QA evidence.
Running Charlotte QA now...
```

1. Start dev servers (detect from CLAUDE.md or plan files)
2. Spawn `gsd-charlotte-qa` with `mode=ui-qa` on phase UI pages
3. If critical/high issues → spawn fix agent → re-run (max 3 rounds)
4. Run regression: all `regression`-tagged Charlotte scenarios must pass
5. Only after pass → set `charlotte_qa_ran: true` in CHECKPOINT.json → proceed to 5b

If Charlotte QA genuinely cannot be run (e.g. dev environment unavailable) and proceeding anyway is a deliberate, approved decision: this is a genuine mandatory-step skip, not a routine no-UI skip. Run `node ~/.claude/get-shit-done/bin/gsd-tools.js deferred add {N} --step charlotte_qa --reason <reason> --approver <approver>` as part of the skip — never logged-and-forgotten afterward. Do not set `charlotte_qa_ran: true` for QA that did not actually happen; record the waiver instead and let `verify phase-gate` honor it.

**Why the orchestrator owns this gate:** Coordinators that overflow context drop Charlotte as a late step and write "code-level verification" — which missed 5 real UI bugs in v0.1.9. The orchestrator runs this check AFTER the coordinator returns, so context overflow cannot bypass it.

**5b. Cross-phase integration checkpoint (UNCONDITIONAL — every phase):**

Run after EVERY completed phase. No conditional.

1. Run unit + integration tests:
```bash
cd apps/api && NODE_ENV=test DENO_ENV=test deno task test:ci 2>&1 | tail -5
cd apps/api && NODE_ENV=test DENO_ENV=test deno test --allow-all --env-file=.env.test functions/__tests__/*.integration.test.ts 2>&1 | tail -10
```

2. If phase touched frontend: run frontend tests + builds:
```bash
CI=true npx nx test player-web && CI=true npx nx test operator-web
npx nx build player-web && npx nx build operator-web
```

If ANY failures → log `integration_test_failure` → **STOP. Fix before next phase.**

```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type cross_phase_integration \
  --data '{"phase": {N}, "tests_passed": true, "timestamp": "..."}'
```

**Why unconditional:** The v0.1.9 conditional ("if migrations changed") was always true but never triggered — the orchestrator skipped it. Removing the condition removes the failure mode. Cost is ~30s/phase. Savings when 15 failures compound: hours.

**6. Archive phase context:**
- Compress completed phase to summary (SUMMARYs already created by executor)
- Clean up ephemeral checkpoints
- Present phase completion report:

```
## Phase {N} Complete: {Name}

**Status:** Completed
**Plans executed:** {M}
**Duration:** ~{T} minutes

### What was built
{from phase SUMMARY.md one-liner}

{If more phases: "Next: Phase {N+1}: {Name}"}
```
</step>

<step name="handle_failure">
On phase failure:

**Scope note:** `handle_failure` is entered ONLY for genuine `status: "failed"` task-logic failures. A detected coordinator death (session/quota-limit death or CHECKPOINT.json staleness) is handled entirely by `execute_phases` step 4a above and never reaches this retry/debug/escalate ladder — a session/quota death retried immediately here would just die again before the reset, which is exactly the failure mode 4a exists to avoid. (The one exception: an implausible reset time detected in 4a explicitly falls through to this step, since that case genuinely needs human/escalation visibility rather than a blind respawn.)

1. **Log failure:**
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type phase_failed \
  --data '{"phase": {N}, "error": "...", "timestamp": "..."}'
```

2. **Call execution-state to get the auto-retry/debug/escalate decision** (phase-granularity, no `--plan`):
   ```bash
   STATE_RESULT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js execution-state record-failure --phase {N} --error "{error}" --step "{step}" --files "{files}" --raw)
   ```
   Branch on `action` (same retry/debug/escalate semantics as `execute-phase.md`, phase-level):
   - **"retry"** (1st failure): log auto-retry, re-run `execute-phase {N}` fresh, no user prompt.
   - **"debug"** (2nd+ failure, below the ceiling): auto-spawn @~/.claude/get-shit-done/workflows/debug.md non-interactively (`mode: symptoms_prefilled: true, interactive: false, goal: find_and_fix`) with phase-level context from `FAILURE.md` (error, last completed step, files touched), `debug_file: .planning/debug/phase-{N}-attempt{attempts}.md`, then re-run `execute-phase {N}`.
   - **"escalate"** (at the ceiling — NEVER spawn another debug attempt): hard stop. This workflow's existing Telegram notification (the `mcp__telegram__send_message` call below) is fire-and-forget, NOT `ask_blocking_question` — per the confirmed finding that `execute-roadmap.md` has zero blocking call sites. Keep it fire-and-forget; just append the debugger's findings (from the most recent phase-level debug file, `.planning/debug/phase-{N}-attempt*.md`) to the notification text and to `FAILURE.md` below. Still offer the existing retry/skip/stop reply options.
   - On success at any branch: `execution-state record-success --phase {N}`.

3. **Send failure notification:**
```
if telegram_topic_id is not null:
  mcp__telegram__send_message({
    text: "Phase {N} failed\n\nError: {error}\nLast step: {step}\n{If action == escalate: Debugger findings: {findings}\n}\nOptions: reply 'retry', 'skip', or 'stop'",
    thread_id: telegram_topic_id
  })
```

4. **Create detailed checkpoint:**
```
## Phase {N} Failed

**Error:** {error}
**Last completed step:** {step}
**Files modified:** {files}
{If action == escalate: **Debugger findings:** {findings}}

### Options
- "retry" — retry this phase with fresh context
- "skip" — skip this phase and continue (may block dependent phases)
- "stop" — stop execution, preserve partial state
```

5. **Store failure context for manual intervention:**
- Checkpoint file at `.planning/phases/{phase_dir}/FAILURE.md`
- Include: error, last step, files touched, suggested fixes, and (if `action == escalate`) the debugger's findings
</step>

<step name="resume_capability">
If previous execution incomplete (resume_state set):

```
## Resume Previous Execution

A previous roadmap execution was interrupted:
- **Last phase started:** {resume_state.phase} ({resume_state.phase_name})
- **Status:** {resume_state.status}
- **Execution log:** .planning/EXECUTION_LOG.md

### Resume Options
- "resume" — continue from {next_phase_after_last}
- "restart" — start fresh from beginning (overwrites log)
- "stop" — exit without resuming
```

**Resume flow:**
1. Find last `phase_complete` event in EXECUTION_LOG.md
2. Skip all phases up to and including last complete
3. Start from next incomplete phase
4. Re-check all dependencies (may have changed)
</step>

<step name="completion">
After all phases complete (or all remaining skipped):

1. **Log roadmap complete:**
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type roadmap_complete \
  --data '{"completed_phases": [...], "skipped_phases": [...], "timestamp": "..."}'
```

1a. **Auto-run analytics report:**

Run the analytics report immediately after logging roadmap_complete, and print it to coordinator output for the user to review:

```bash
ANALYTICS_REPORT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js analytics report 2>/dev/null || echo "Analytics report unavailable")

# Append a summary event to the execution log (best-effort)
REPORT_LINES=$(echo "$ANALYTICS_REPORT" | wc -l | tr -d ' ')
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type analytics_report \
  --data '{"report_lines": '"$REPORT_LINES"', "auto_generated": true}' 2>/dev/null || true

# Print report to coordinator output
echo ""
echo "=== Analytics Report ==="
echo "$ANALYTICS_REPORT"
echo "========================"
echo ""
```

2. **Send execution complete notification:**
```
if telegram_topic_id is not null:
  // Build one-liner per phase from SUMMARYs
  phase_lines = []
  for each completed_phase:
    summary_oneliner = read first non-blank, non-heading line from .planning/phases/{phase_dir}/*-SUMMARY.md
    phase_lines.push("- Phase {N} ({name}): {summary_oneliner}")

  mcp__telegram__send_message({
    text: "Roadmap execution complete\n\nCompleted: {completed_count}/{total_phases}\nSkipped: {skipped_count}\n\n{phase_lines joined with newline}",
    thread_id: telegram_topic_id
  })
```

3. **Pre-PR quality gates (programmatic enforcement):**

Check current branch:
```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
```

If `CURRENT_BRANCH` is `main` or `master`: skip steps 3 and 4.

Otherwise:

```bash
GATE_RESULT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr)
```

Parse the JSON output. If `action_required` is true:
- Run EVERY check listed in `checks` array
- Each check must exit 0
- Run the full suite TWICE — both runs must be green
- After both runs pass, mark the gate:
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr --mark-passed
```

If any check fails: **STOP. Fix the failure. Re-run from the beginning.**

There is NO bypass. The `gate pre-pr --mark-passed` command writes a marker to EXECUTION_LOG.md.
The PR creation step below checks for this marker.

### E2E Regression Gate (Web Projects)

**Before marking the gate as passed:**

1. Start frontend dev servers (required for Charlotte):
```bash
npx nx dev player-web &
npx nx dev operator-web &
# Wait for both to be ready
```

2. Run Charlotte regression tests:
```bash
cd apps/e2e-charlotte && deno task test:regression
```

3. ALL regression-tagged tests must PASS
4. If any fail:
   - Show failure report
   - Spawn debug agent to diagnose
   - Create fix plan
   - Execute fixes
   - Re-run regression
   - Max 3 attempts before escalating to user
5. This gate is NON-NEGOTIABLE for web projects — no PR without green regression

4. **Push branch and open PR (requires gate marker):**

```bash
# Verify gate was passed
GATE_CHECK=$(node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr)
if echo "$GATE_CHECK" | grep -q '"passed":true'; then
  git push -u origin {CURRENT_BRANCH}
  gh pr create ...
else
  echo "ERROR: Quality gates not passed. Run all checks first."
  echo "$GATE_CHECK"
  exit 1
fi
```

Then create PR:
```bash
gh pr create \
  --title "feat: {roadmap_name}" \
  --body "## Summary

Automated roadmap execution complete.

**Phases completed:** {completed_count}/{total_phases}
**Phases skipped:** {skipped_count}

### What was built
{One line per completed phase from SUMMARY.md}

---
🤖 Generated by GSD execute-roadmap" \
  --base main
```

Capture the PR URL from output. If `gh pr create` fails (no auth, no remote, etc.): log the error visibly and continue — don't abort the summary.

If `telegram_topic_id` is not null and PR was created:
```
mcp__telegram__send_message({
  text: "PR opened: {PR_URL}",
  thread_id: telegram_topic_id
})
```

4. **Present completion summary:**
```
## Roadmap Execution Complete

**Phases completed:** {N}/{total}
**Phases skipped:** {M}
**Total duration:** ~{T} minutes

### What was built
{One line per completed phase from SUMMARY.md}

### Next Steps
- PR: {PR_URL} — wait for CI to pass
- Run /gsd:complete-milestone once CI is green
```

5. **Clean up:**
- Remove ephemeral checkpoint files
- Preserve EXECUTION_LOG.md for history
</step>

</process>

<context_efficiency>
Coordinator: ~10-15% context. Each phase sub-coordinator: fresh 200k context window. No state leaks between phases. Execution log is the only shared state — JSONL for streaming append without full-file reads.
</context_efficiency>

<failure_handling>
- **ROADMAP.md missing:** Error immediately, no execution
- **Phase sub-coordinator fails:** Present options (retry/skip/stop), preserve partial state
- **Dependency chain breaks:** Phase N failed means Phase N+1 may also fail — user chooses continue or stop
- **Interrupted execution:** Resume via EXECUTION_LOG.md scan on next run
- **All phases fail:** Systemic issue — stop, report, suggest investigation
- **classifyHandoffIfNeeded false failure:** Agent reports failed but error is Claude Code bug — spot-check SUMMARY.md + commits — if pass, treat as success
</failure_handling>

<resumption>
Re-run `/gsd:execute-roadmap` → init detects EXECUTION_LOG.md with incomplete state → resume_state set → present resume prompt → user chooses "resume" → skip completed phases → continue from next incomplete phase.

EXECUTION_LOG.md is the source of truth for execution state. Each phase start/complete event timestamped and logged. Enables post-mortem analysis of execution history.
</resumption>

<parallel_execution>
When `parallel_opportunities` contains multiple phases:
- Phases with no mutual dependencies can run simultaneously
- Spawn multiple sub-coordinators in parallel via Agent()
- Wait for all to complete before proceeding to dependent phases
- Handle mixed results: some pass, some fail, some blocked

**Parallelism limits (ENFORCED):**

| Phase type | Max parallel | Rationale |
|------------|-------------|-----------|
| Schema-only (migrations, RPCs, no edge function) | 3 | Low context, independent schemas |
| Feature (DB + edge function + tests) | 2 | High context, shared edge function file |
| UI (frontend components + pages) | 2 | Charlotte QA contention, shared dev server |

When the orchestrator identifies N parallelizable phases:
- If N > max_parallel for the type: split into batches of max_parallel
- Run batch 1, wait for all to complete + pass gates (5a, 5b)
- Then run batch 2

**Why not more:** v0.1.9 ran 3 feature phases in parallel — 2 of 3 had context issues. The coordinator's 200k context window is consumed by: reading existing code (~40%), planning (~20%), executing (~30%), verifying (~10%). With complex feature phases, 200k is barely enough for 1 full lifecycle. Parallel doesn't help if coordinators overflow.
</parallel_execution>
