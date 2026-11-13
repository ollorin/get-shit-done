# gsd-executor.md — Execution Procedure Detail (Phase 53-02, MILE-30)

This file holds the FULL, VERBATIM procedural detail relocated from
`agents/gsd-executor.md` during the MILE-30 hard-rules-first
restructuring: the complete execution_flow (load_project_state, load_plan,
load_user_reasoning_context, record_start_time, determine_execution_pattern,
execute_tasks), the inter-task syntax check procedure, the acceptance-row
task handling procedure, the post-plan test suite gate procedure, the
SUMMARY.md creation procedure, the
STATE.md update procedure, the requirements-completion procedure, and the
final commit procedure. Nothing here was reworded, summarized, or deleted.

The core preamble of `gsd-executor.md` keeps `<scope_boundary>`,
`<auto_mode_detection>`, `<deviation_rules>` (Rules 1-4 and rule priority --
the actual decision-making foundation of this agent), `<authentication_gates>`,
`<checkpoint_protocol>`, `<checkpoint_return_format>`,
`<continuation_handling>`, `<task_commit_protocol>`, `<self_check>`,
`<completion_format>`, `<success_criteria>`, and a `<hard_rules_digest>` of
additional verbatim HARD RULE/BLOCK/CRITICAL excerpts pulled from the
procedures relocated here so they surface early in the prompt. Those
excerpts are a surfacing aid only -- the complete, authoritative procedural
context for every rule still lives here, unchanged.

---

<execution_flow>

<step name="load_project_state" priority="first">
Load execution context:

```bash
LEGACY_FLAG=""  # "--legacy" when your spawn prompt says `legacy: true`
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init execute-phase "${PHASE}" $LEGACY_FLAG)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

If the command exits 1 and INIT has `error: project_context_missing`: stop, print its `missing` list and `hint`. Do not continue without the brief and profile. A legacy project (no brief, no profile) runs with `--legacy` (`LEGACY_FLAG`, set when your spawn prompt says `legacy: true`) or `GSD_LEGACY=1` exported.

Extract from init JSON: `executor_model`, `commit_docs`, `phase_dir`, `plans`, `incomplete_plans`.

Also read STATE.md for position, decisions, blockers:
```bash
cat .planning/STATE.md 2>/dev/null
```

If STATE.md missing but .planning/ exists: offer to reconstruct or continue without.
If .planning/ missing: Error — project not initialized.
</step>

<step name="load_plan">
Read the plan file provided in your prompt context.

Parse: frontmatter (phase, plan, type, autonomous, wave, depends_on, requirements), objective, context (@-references), tasks with types, verification/success criteria, output spec.

**If plan references CONTEXT.md:** Honor user's vision throughout execution.

**Extract requirements IDs from frontmatter** for use in the `update_requirements` step:
```bash
REQUIREMENTS=$(node ~/.claude/get-shit-done/bin/gsd-tools.js frontmatter get {plan_path} --field requirements 2>/dev/null || echo "[]")
```

**Extract routing context if present:**
If the prompt contains a `<routing_context>` block:
  ROUTED_TIER = parse the tier from "This task routed to {tier}" line (haiku|sonnet)
  If no routing_context or parse fails: ROUTED_TIER = null
</step>

<step name="load_user_reasoning_context">
Query the knowledge DB for user preferences and decisions relevant to this plan.

Use the phase goal from the plan's frontmatter or objective section as the query term:

```bash
USER_CONTEXT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js \
  query-knowledge "{phase_goal_or_objective}" 2>/dev/null || echo "[]")
```

If `USER_CONTEXT` is empty or errors: log "No user context found" and continue — non-fatal.

If results exist: Throughout task execution, apply these as implicit constraints:
- **Preferences** (e.g. "prefers functional over class-based"): Apply when choices arise
- **Decisions** (e.g. "use bun not npm"): Apply exactly, do not deviate
- **Anti-patterns** (e.g. "avoid direct DB calls in controllers"): Never reproduce
- **Principles** (e.g. "performance over code elegance"): Use as tiebreaker

These supplement (not override) the plan's explicit task instructions. If a user decision conflicts with a plan task, honor the plan — it was written after the decision and may intentionally override it.

Log: "User context loaded: {N} items from knowledge DB"
</step>

<step name="record_start_time">
```bash
PLAN_START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PLAN_START_EPOCH=$(date +%s)
```
</step>

<step name="determine_execution_pattern">
```bash
grep -n "type=\"checkpoint" [plan-path]
```

**Pattern A: Fully autonomous (no checkpoints)** — Execute all tasks, create SUMMARY, commit.

**Pattern B: Has checkpoints** — Execute until checkpoint, STOP, return structured message. You will NOT be resumed.

**Pattern C: Continuation** — Check `<completed_tasks>` in prompt, verify commits exist, resume from specified task.
</step>

<step name="execute_tasks">
For each task:

1. **If `type="auto"`:**
   - A task with `<acceptance>` rows: write the failing test from the rows first and capture the red run, then the code, then run that test file once (see acceptance_rows below)
   - Execute task, apply deviation rules as needed
   - Handle auth errors as authentication gates
   - **Failure signaling for coordinator escalation (routing active only):**
     If ROUTED_TIER is set AND a task fails with an error/exception AND all retries are exhausted:
       Classify the failure before signaling (best-effort -- never blocks the signal itself):
         node ~/.claude/get-shit-done/bin/gsd-tools.js routing classify-failure "{error_summary}" --raw
       If that command succeeds and returns `capability_related: false`, append a `[non-capability]`
       marker to the signal:
         "TASK FAILED: {task_name} [tier: {ROUTED_TIER}] [non-capability] — {error_summary}"
       Otherwise (capability_related: true, OR the classify-failure command fails/is unavailable)
       use the EXISTING unmarked format, unchanged:
         "TASK FAILED: {task_name} [tier: {ROUTED_TIER}] — {error_summary}"
       This format allows the coordinator to parse the tier (and the non-capability marker, when
       present) and decide whether to re-spawn at a higher tier. A `[non-capability]`-tagged failure
       is never escalated by the coordinator (missing file, environment error, etc. — the next tier
       up cannot fix these).
       If ROUTED_TIER is null (routing not active): return failure using existing behavior (no
       structured tag, no classification call).

     Note: The executor does NOT switch tiers mid-execution. Model tier is fixed at spawn time. The
     coordinator (not the executor) is responsible for deciding to re-spawn at a higher tier when it
     receives a capability-related failure signal.
     Failure signaling only applies to errors/exceptions. Output quality issues do not trigger this
     signal.
   - Run verification, confirm done criteria
   - **Cross-boundary done check:** If the task creates code that crosses a service boundary (frontend handler that should call a backend route, API route that should mutate a database), verify the full chain before marking done — not just that the local artifact builds. A frontend form handler is not "done" if it only updates UI state without making the API call the done criterion implies. A backend route is not "done" if the frontend has no path to call it. Check that the wiring exists and carries the right signal, not just that each side compiles independently.
   - **Knowledge feedback on contradiction (non-blocking):** If, during task execution, a specific entry from `USER_CONTEXT` (loaded via `query-knowledge` above) turns out to be contradicted by the actual outcome (e.g. a "preference" entry recommended an approach that a test or the user's own correction proved wrong), call `node ~/.claude/get-shit-done/bin/gsd-tools.js mark-wrong <id> --severity <minor|major|critical> --reason "<reason>"` using that entry's `id` field. Best-effort only — never block task completion or the plan's overall execution on this call's outcome.
   - Commit (see task_commit_protocol — this also writes/overwrites `.planning/phases/{phase_dir}/TASK-CHECKPOINT.json`, step 6 of that protocol; see `<executor_resilience_protocol>` in `agents/gsd-executor.md` and `@get-shit-done/references/resilience.md` for how a continuation agent consumes it)
   - Track completion + commit hash for Summary
   - **Inter-task syntax check** (runs after each task commit — see inter_task_syntax_check block below)

2. **If `type="checkpoint:*"`:**
   - Check auto mode detection (see auto_mode_detection)
   - If auto mode active and type is `human-verify` or `decision`: auto-approve/select first option
   - If auto mode active and type is `human-action`: STOP — return structured checkpoint message
   - If type is `checkpoint:ui-qa`: STOP — always return structured checkpoint message (coordinator runs QA loop)
   - If auto mode not active: STOP immediately — return structured checkpoint message
   - A fresh agent will be spawned to continue

3. After all tasks: run overall verification, confirm success criteria, document deviations
</step>

</execution_flow>

<inter_task_syntax_check>

**Purpose:** After each `type="auto"` task commit, run a lightweight JavaScript syntax check on modified .js files. Catches syntax errors early with one auto-fix attempt before logging as a gap. Syntax errors NEVER abort the plan.

**Steps (run after each task commit, before moving to the next task):**

**Step 1 — Get changed JavaScript files:**
```bash
CHANGED_JS=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | grep '\.js$' || true)
```

If CHANGED_JS is empty (no .js files changed, git unavailable, or initial commit): skip the syntax check silently and continue to the next task.

**Step 2 — Run node --check on each changed .js file:**
```bash
SYNTAX_ERRORS=""
for JS_FILE in $CHANGED_JS; do
  if [ -f "$JS_FILE" ]; then
    CHECK_OUTPUT=$(node --check "$JS_FILE" 2>&1)
    if [ $? -ne 0 ]; then
      SYNTAX_ERRORS="${SYNTAX_ERRORS}
${JS_FILE}: ${CHECK_OUTPUT}"
    fi
  fi
done
```

**If no syntax errors (SYNTAX_ERRORS is empty):** Log "Syntax check passed for task {task_index}" and continue to the next task.

**If syntax errors found — make one auto-fix attempt:**

1. Read each failing .js file and identify the specific syntax error from the node --check output (line number and error type)
2. Fix the syntax error inline (e.g., missing closing bracket, unclosed string, invalid token)
3. Commit the fix: `git commit -m "fix({plan_id}): auto-fix syntax error in {file} after task {task_index}"`
4. Re-run the check:
   ```bash
   RECHECK_ERRORS=""
   for JS_FILE in $CHANGED_JS; do
     if [ -f "$JS_FILE" ]; then
       RECHECK_OUTPUT=$(node --check "$JS_FILE" 2>&1)
       if [ $? -ne 0 ]; then
         RECHECK_ERRORS="${RECHECK_ERRORS}
${JS_FILE}: ${RECHECK_OUTPUT}"
       fi
     fi
   done
   ```

**If re-check passes:** Log "Syntax auto-fixed and verified for task {task_index}" and continue to the next task.

**If re-check also fails — log as gap (NEVER abort the plan):**

Append to `deferred-items.md` in the phase directory:
```
- [SYNTAX-GAP] node --check failed after auto-fix attempt for task {task_index}: {RECHECK_ERRORS} — files: {CHANGED_JS}
```

Log: "Syntax check gap logged for task {task_index} — proceeding to next task"

Continue to the next task immediately.

**Constraint:** Syntax errors discovered by the inter-task check do not abort the plan on the first occurrence. However, if the same file has syntax errors across 2 consecutive task commits, escalate to a checkpoint — do NOT silently continue. Persistent syntax errors indicate a deeper problem that must be addressed before more work is built on top of broken code.

**Scope:** Only .js files changed in the current task's commit. Does not check .ts, .jsx, .md, or other file types. Does not recursively check the entire codebase — only the delta.

</inter_task_syntax_check>

<test_task_handling>

## Acceptance-row tasks

**Phase-gate authority note:** Plan-level test correctness is this section and the post-plan test gate below. Phase-level artifact EXISTENCE (test file, UI QA evidence, docs commit, E2E-TEST-PLAN.md, VERIFICATION.md) is enforced by `gsd-tools.js verify phase-gate {phase}` at the orchestrator level. A mandatory step genuinely skipped needs `gsd-tools.js deferred add {phase} --step <step> --reason <reason> --approver <approver>`.

A task that builds behaviour carries `<acceptance>` rows written by the planner; you write the test and the code in this one dispatch:

1. From the rows, write the failing test first: one case per row, asserting exactly what the row names, plus its positive control. The case text is fixed by the plan: never weaken, drop or reword a row to make it pass; a wrong row is a deviation you report (`[Rule 4]`), not an edit.
2. Run the test file; save the failing run to a capture (`{phase_dir}/captures/`). A row that is green before the code exists cannot fail: report it.
3. Write the code. Run the same test file once. On a risk-domain row apply the named mutant, confirm the test goes red, revert it (in a throwaway worktree, `git worktree add .tmp/wt-<name>`, never the shared tree), and save that capture too.
4. Still failing after 2 fix attempts: `TASK FAILED`. Never log a failing row as a gap and continue.
5. Commit test and code together (`task_commit_protocol`). Last task of the plan: fill `## Test Delta` in the exact machine-parsed format of the summary template (`added/updated/merged/deleted/net_test_loc`, repeatable `bucket_seconds`, `| DISPOSITION | file | covered by (existing *.test.* path:line, or mutant id mXX1 / RED <sha>) |` rows).

</test_task_handling>

<post_plan_test_gate>

## Post-Plan Test Suite Gate

After ALL tasks in the plan complete, run the plan's affected test files plus their single bucket, once, as a final quality gate before creating SUMMARY.md; the full suite runs once per phase in `mechanical_gates` per `test_cost_rule`.
**Test cost:** no full pre-PR gate run inside a plan. See gsd-test-protocol.md `test_cost_rule`.

**SUMMARY.md creation is BLOCKED if:**
- Test suite fails (non-zero exit code)
- Test suite times out (5-minute limit, exit code 124)
- Measured coverage falls below `testing.coverage_threshold` on the touched libs/files (when set in config.json)

**Step 1: Detect test command**

```bash
# Try config.json first
TEST_CMD=$(node ~/.claude/get-shit-done/bin/gsd-tools.js config get testing.test_command 2>/dev/null || echo "")

# Fallback: the test_all command from stack_commands (init output)
if [ -z "$TEST_CMD" ]; then TEST_CMD="<stack_commands.test_all>"; fi
```

Whichever command is detected, narrow it to the plan's affected test files plus their single bucket (`test_cost_rule` step 1); a whole-project command is never run inside a plan.

If TEST_CMD is empty after all detection attempts AND this plan has no task with `<acceptance>` rows or `type: tdd`: log "No test command found and no acceptance rows — skipping post-plan test gate" and proceed to `<summary_creation>`.

**However:** If TEST_CMD is empty BUT this plan has `<acceptance>` rows, this is a HARD FAILURE. The rows should have produced tests and a test runner. Log: "CRITICAL: Plan has acceptance rows but no test command found — test infrastructure was not properly set up." Set TEST_GATE_BLOCKED=true, TEST_GATE_REASON="missing_test_infrastructure". Do NOT create SUMMARY.md.

**CRITICAL: Infrastructure unavailability is NOT the same as "no test command found".** If TEST_CMD exists but tests fail because services are down, you MUST attempt infrastructure startup (Step 1.5 below). Only when TEST_CMD truly cannot be detected from any config file should this gate be skipped.

**Step 1.5: Infrastructure startup (if TEST_CMD found)**

If TEST_CMD is non-empty, do a quick pre-flight run to detect infrastructure errors BEFORE the full 5-minute run:

```bash
# Quick pre-flight to detect infrastructure errors
PRE_FLIGHT_FILE="/tmp/gsd-pregate-$$.txt"
timeout 30 bash -c "${TEST_CMD}" > "${PRE_FLIGHT_FILE}" 2>&1
PRE_FLIGHT_EXIT=$?
PRE_FLIGHT_OUTPUT=$(cat "${PRE_FLIGHT_FILE}" 2>/dev/null || echo "")
rm -f "${PRE_FLIGHT_FILE}"

# Detect infrastructure unavailability
INFRA_ERROR=false
if echo "$PRE_FLIGHT_OUTPUT" | grep -qiE "ECONNREFUSED|connection refused|not running|database.*unavailable|connect.*failed|service.*unavailable"; then
  INFRA_ERROR=true
fi
```

If INFRA_ERROR=true AND PRE_FLIGHT_EXIT != 0:

1. Log: "Infrastructure appears to be down — reading CLAUDE.md for startup commands..."

2. Read the project's CLAUDE.md (same approach as the UI QA agent: `find . -maxdepth 2 -name "CLAUDE.md" | head -1`). Look for a `## Dev / Infrastructure` or a section naming a `stack.services[]` entry or `## QA / Dev Server` section — extract the infrastructure startup command.

3. If CLAUDE.md has a startup command: run it. Example: if CLAUDE.md names the start command of a `stack.services[]` entry → run it with `2>&1 | tail -10`. Wait up to 60s for it to complete.

4. If no CLAUDE.md startup command found, try common fallbacks in order:
   - If the config directory of a `stack.services[]` entry exists: that entry's start command
   - If a container compose file exists in the repo: its detached up command

5. After startup attempt, wait 5 seconds, then proceed to Step 2 (full test run).

**HARD RULE:** NEVER treat infrastructure unavailability as "no test command found". Do NOT skip the test gate because infrastructure is down. Infrastructure that won't start = hard blocker. If startup fails and tests still fail → TEST_GATE_BLOCKED=true. Do NOT create SUMMARY.md.

**Step 2: Run test suite (5-minute timeout)**

```bash
TEST_OUTPUT_FILE="/tmp/gsd-test-output-$$.txt"
timeout 300 bash -c "${TEST_CMD}" > "${TEST_OUTPUT_FILE}" 2>&1
TEST_EXIT_CODE=$?
TEST_OUTPUT=$(tail -50 "${TEST_OUTPUT_FILE}" 2>/dev/null || echo "")
rm -f "${TEST_OUTPUT_FILE}"
```

**Step 3: Read coverage threshold from config.json**

```bash
COVERAGE_THRESHOLD=$(node ~/.claude/get-shit-done/bin/gsd-tools.js config get testing.coverage_threshold 2>/dev/null || echo "")
COVERAGE_BLOCKED=false
COVERAGE_FOUND=""
```

If COVERAGE_THRESHOLD is set (non-empty) AND TEST_EXIT_CODE == 0, attempt to parse coverage from TEST_OUTPUT:
- Look for Istanbul/nyc format: `All files | N.N |` — extract the first numeric value in that row
- Look for `Statements   : N.N%` or `Lines        : N.N%` patterns
- Look for `Coverage: N.N%` in the test runner output
- Parse the found value as a float

If a coverage value is found:
```
COVERAGE_FOUND = parsed float
if COVERAGE_FOUND < COVERAGE_THRESHOLD:
  COVERAGE_BLOCKED = true
  Log: "Coverage ${COVERAGE_FOUND}% < threshold ${COVERAGE_THRESHOLD}% — SUMMARY.md will be blocked"
```

If coverage cannot be parsed from output: log "WARNING: Coverage threshold set (${COVERAGE_THRESHOLD}%) but unable to parse coverage from output. Adding warning to SUMMARY.md." Add a warning section to SUMMARY.md: "Coverage threshold configured but coverage data could not be parsed from test output. Manual verification required." Continue but document the gap — do NOT silently pass.

**Step 4: Decision logic**

| Condition | Action |
|-----------|--------|
| TEST_EXIT_CODE == 124 (timeout) | Set TEST_GATE_BLOCKED=true, TEST_GATE_REASON="timeout" |
| TEST_EXIT_CODE != 0 (not timeout) | Set TEST_GATE_BLOCKED=true, TEST_GATE_REASON="test_failure" |
| TEST_EXIT_CODE == 0 AND COVERAGE_BLOCKED=true | Set TEST_GATE_BLOCKED=true, TEST_GATE_REASON="coverage_below_threshold" |
| TEST_EXIT_CODE == 0 AND NOT COVERAGE_BLOCKED | Set TEST_GATE_BLOCKED=false, log "Test suite passed — proceeding to SUMMARY.md" |

**Step 5: If TEST_GATE_BLOCKED=true — return failure, do NOT create SUMMARY.md**

```
Return:
## PLAN FAILED: Test gate blocked SUMMARY.md creation

**Reason:** {TEST_GATE_REASON}
{If TEST_GATE_REASON == "coverage_below_threshold":}
**Coverage:** {COVERAGE_FOUND}% (threshold: {COVERAGE_THRESHOLD}%)
{If TEST_GATE_REASON == "test_failure" or "timeout":}
**Test output (last 30 lines):**
{TEST_OUTPUT last 30 lines}
**Telemetry:** context_pressure={0.0-1.0 estimate}, instructions_not_followed={count}, ambiguities={count}, tool_errors_swallowed={count}

**Action required:** Fix failing tests before this plan can be marked complete. Do NOT create SUMMARY.md.
```

Do NOT proceed to `<summary_creation>`. Do NOT create SUMMARY.md when TEST_GATE_BLOCKED=true.

</post_plan_test_gate>

<summary_creation>
After all tasks complete, create `{phase}-{plan}-SUMMARY.md` at `.planning/phases/XX-name/`.

**Use template:** @~/.claude/get-shit-done/templates/summary.md

**Frontmatter:** phase, plan, subsystem, tags, dependency graph (requires/provides/affects), tech-stack (added/patterns), key-files (created/modified), decisions, metrics (duration, completed date).

**requirements-completed:** REQUIRED — Copy ALL requirement IDs from this plan's `requirements` frontmatter field. If plan has no requirements, write `[]`.

**Title:** `# Phase [X] Plan [Y]: [Name] Summary`

**One-liner must be substantive:**
- Good: "Token auth with refresh rotation using the signing library the stack profile names"
- Bad: "Authentication implemented"

**Deviation documentation:**

```markdown
## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed case-sensitive email uniqueness**
- **Found during:** Task 4
- **Issue:** [description]
- **Fix:** [what was done]
- **Files modified:** [files]
- **Commit:** [hash]
```

Or: "None - plan executed exactly as written."

**Auth gates section** (if any occurred): Document which task, what was needed, outcome.

**Test Results table (include when any task had acceptance rows):**

```markdown
| Task | Added/Updated/Merged/Deleted/Reused | Tests Passing | Tier |
|------|--------------|---------------|-----------|
```

**Routing summary (include when ROUTED_TIER is set for any task):**

```markdown
## Routing

| Task | Routed Tier | Escalated |
|------|-------------|-----------|
| 1    | haiku       | no        |
| 2    | sonnet      | no        |
| 3    | haiku       | yes → sonnet |

**Distribution:** {haiku_count} haiku / {sonnet_count} sonnet
**Escalations:** {escalation_count} (haiku → sonnet on retry)
```

Omit this section entirely if ROUTED_TIER was null for all tasks (routing not active — non-auto profile).
</summary_creation>

<state_updates>
After SUMMARY.md, update STATE.md using the atomic gsd-tools `state` mutators below — never a raw whole-file Write, since parallel executors in the same wave touch STATE.md concurrently. **See @~/.claude/get-shit-done/references/shared-file-writes.md.**

```bash
# Advance plan counter (handles edge cases automatically)
node ~/.claude/get-shit-done/bin/gsd-tools.js state advance-plan

# Recalculate progress bar from disk state
node ~/.claude/get-shit-done/bin/gsd-tools.js state update-progress

# Record execution metrics
node ~/.claude/get-shit-done/bin/gsd-tools.js state record-metric \
  --phase "${PHASE}" --plan "${PLAN}" --duration "${DURATION}" \
  --tasks "${TASK_COUNT}" --files "${FILE_COUNT}"

# Add decisions (extract from SUMMARY.md key-decisions)
for decision in "${DECISIONS[@]}"; do
  node ~/.claude/get-shit-done/bin/gsd-tools.js state add-decision \
    --phase "${PHASE}" --summary "${decision}"
done

# Update session info
node ~/.claude/get-shit-done/bin/gsd-tools.js state record-session \
  --stopped-at "Executed ${PHASE}-${PLAN}-PLAN.md, pending verification"
```

**State command behaviors:**
- `state advance-plan`: Increments Current Plan, detects last-plan edge case, sets status
- `state update-progress`: Recalculates progress bar from SUMMARY.md counts on disk
- `state record-metric`: Appends to Performance Metrics table
- `state add-decision`: Adds to Decisions section, removes placeholders
- `state record-session`: Updates Last session timestamp and Stopped At fields

**Extract decisions from SUMMARY.md:** Parse key-decisions from frontmatter or "Decisions Made" section → add each via `state add-decision`.

**For blockers found during execution:**
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js state add-blocker "Blocker description"
```
</state_updates>

<update_requirements>
After state updates, mark plan requirements as complete in REQUIREMENTS.md:

```bash
# Extract requirements from PLAN.md frontmatter
PLAN_REQS=$(node ~/.claude/get-shit-done/bin/gsd-tools.js frontmatter get "${PLAN_PATH}" --field requirements 2>/dev/null)

# If requirements exist and are non-empty, mark them complete
if [ -n "$PLAN_REQS" ] && [ "$PLAN_REQS" != "[]" ] && [ "$PLAN_REQS" != "null" ]; then
  node ~/.claude/get-shit-done/bin/gsd-tools.js requirements mark-complete "${PLAN_REQS}"
fi

# Also update ROADMAP.md progress row (status becomes "Executed", not "Complete": the tool marks Complete only after a passed {N}-VERIFICATION.md)
node ~/.claude/get-shit-done/bin/gsd-tools.js roadmap update-plan-progress "${PHASE_NUMBER}"
```

If REQUIREMENTS.md doesn't exist or requirement not found, log and continue — do not fail.
</update_requirements>

**Commit trailers:** every commit (per-task and final) carries only the attribution lines the dispatch prompt or system reminder gives; if none, none. Never write a remembered model name; the fork hard-codes none and `gsd-tools commit` appends none.

<run_stack_gates>
Spike path only (one executor per plan). Standard rigour: the coordinator runs the gates once per phase (`execute-phase.md` `mechanical_gates`). Before the final commit, run the configured gates:

```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js profile get stack.gates
```

Run every entry's `command` (they are Layer-1 gates such as the FP ratchet, migration security and dependency scan), capture each exit code, and list `gate: exit N` in SUMMARY.md under `## Verification`. A non-zero gate caused by this plan's changes is fixed now (one writer, same task set); one that predates the plan goes to `deferred-items.md` and is named in your return. When `stack.gates` is absent, run the gate scripts the repo ships; when it is present but empty, record "no gates configured". Never report a gate as passed without its exit code.
</run_stack_gates>

<final_commit>
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js commit "docs({phase}-{plan}): complete [plan-name] plan" --files .planning/phases/XX-name/{phase}-{plan}-SUMMARY.md .planning/STATE.md .planning/ROADMAP.md .planning/REQUIREMENTS.md
```

Include ROADMAP.md and REQUIREMENTS.md in the final commit — they are updated by the `update_requirements` step above. If either file doesn't exist, the commit tool will skip it gracefully.

Separate from per-task commits — captures execution results only.
</final_commit>
