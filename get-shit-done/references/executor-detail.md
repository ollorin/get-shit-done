# gsd-executor.md — Execution Procedure Detail (Phase 53-02, MILE-30)

This file holds the FULL, VERBATIM procedural detail relocated from
`agents/gsd-executor.md` during the MILE-30 hard-rules-first
restructuring: the complete execution_flow (load_project_state, load_plan,
load_user_reasoning_context, record_start_time, determine_execution_pattern,
execute_tasks), the inter-task syntax check procedure, the tdd="true" test
task handling procedure, the post-plan test suite gate procedure, the
SUMMARY.md creation procedure, the mandatory docs update procedure, the
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
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init execute-phase "${PHASE}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

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
  ROUTED_TIER = parse the tier from "This task routed to {tier}" line (haiku|sonnet|opus)
  If no routing_context or parse fails: ROUTED_TIER = null
</step>

<step name="load_user_reasoning_context">
Query the knowledge DB for user preferences and decisions relevant to this plan.

Use the phase goal from the plan's frontmatter or objective section as the query term:

```bash
USER_CONTEXT=$(node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js \
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
   - Check for `tdd="true"` → follow TDD execution flow
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
   - **Post-task quality test-writer spawn** (only when the `quality.test_writer` config toggle is on and the task touches source code — see post_task_quality_spawn block below)

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

<post_task_quality_spawn>

## Post-Task Quality Test-Writer Spawn (Phase 59-02, MILE-37)

**Purpose:** For projects that enable `quality.test_writer` (default OFF -- zero behavior change
when off), spawn gsd-test-writer after EVERY `type="auto"` implementation task that touches
source code, not just tasks the planner marked `tdd="true"`. This is ADDITIVE to (never a
replacement of) the existing `tdd="true"` hard-block contract in `<test_task_handling>` above,
which is completely UNCHANGED by this block.

**Runs immediately after the current task's commit (`task_commit_protocol`) AND after the
inter-task syntax check -- only for `type="auto"` tasks that are NOT themselves a `tdd="true"`
test task.** (A `tdd="true"` task is already handled exclusively by `<test_task_handling>` --
never spawn gsd-test-writer twice for the same task.)

**Step 1 -- check the toggle (fails closed/off by default):**
```bash
TEST_WRITER_ENABLED=$(node ~/.claude/get-shit-done/bin/gsd-tools.js config get test_writer_enabled --raw 2>/dev/null || echo "false")
```
If `TEST_WRITER_ENABLED` is not exactly `"true"`: skip this entire block, continue to the next
task. (Toggle off -- zero behavior change from pre-Phase-59 execution.)

**Step 2 -- check whether the task touched source code:**
```bash
TASK_CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || true)
TOUCHES_SOURCE=$(node ~/.claude/get-shit-done/bin/gsd-tools.js quality touches-source --files "$(echo "$TASK_CHANGED_FILES" | tr '\n' ',')" --raw 2>/dev/null | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.touches_source_code)}catch{console.log('false')}")
```
If `TOUCHES_SOURCE` is not `true` (the task only touched docs/config/tests): skip this block,
continue to the next task.

**Step 3 -- spawn gsd-test-writer (same inputs/routing as the existing `tdd="true"` spawn in
`<test_task_handling>` above):**
```
route_result = Agent(
  subagent_type="gsd-task-router",
  description="Route quality test-writer spawn",
  max_turns=5,
  prompt="Route this task: Write tests for {task_name}

Task action:
Write and run tests covering the behavior just implemented: {task's <done> criteria text}

Plan context: complexity=medium, depends_on=0 prior plans, must_haves=1 criteria"
)
test_writer_model = parse "Model:" line from route_result // default "sonnet" if parse fails

Agent(
  subagent_type="gsd-test-writer",
  description="Write tests for {task_name} (quality toggle)",
  model={test_writer_model},
  prompt="
    task_name={task_name}
    files_modified={TASK_CHANGED_FILES}
    behavior_description={task's <done> criteria text}
    project_dir={project_dir}
    test_framework={detected from package.json / deno.json}
  "
)
```

**Step 4 -- handle the result as a LOUD DEVIATION, never a block (this is the key contrast
with the `tdd="true"` contract above):**

If gsd-test-writer reports 0 tests written OR returns no identifiable test-file output:
  Append to the plan's SUMMARY.md `## Deviations from Plan` section:
  ```
  **[Rule Quality-TW] gsd-test-writer produced no test output for task {task_name}**
  - Found during: Task {task_index} ({task_name})
  - Issue: quality.test_writer toggle is on, task touched source code, but gsd-test-writer
    reported 0 tests written / no test-file output
  - Impact: this task's new code has no automatically-generated companion test coverage
  - Committed in: N/A (no commit — this is a logged deviation, not a fix)
  ```
  Do NOT block. Do NOT retry. Continue immediately to the next task.

If gsd-test-writer reports >=1 tests written (whether passing or failing):
  Commit the new test file(s) (stage individually, per `task_commit_protocol`):
  ```bash
  git add {test_file_1} {test_file_2}
  git commit -m "test({phase}-{plan}): quality test-writer coverage for {task_name}"
  ```
  If any tests are FAILING: this spawn point is best-effort/additive, unlike `tdd="true"`'s hard
  block -- append a `[Rule Quality-TW]` deviation line noting the failing count and reason, then
  continue to the next task (do NOT retry, do NOT block).
  If all tests pass: continue to the next task, no deviation entry needed.

</post_task_quality_spawn>

<test_task_handling>

## Handling tdd="true" Tasks

**Phase-gate authority note:** Individual `tdd="true"` task completion (this section) and the post-plan test gate below establish plan-level test correctness. Phase-level artifact EXISTENCE (that a test file, Charlotte QA evidence, docs commit, E2E-TEST-PLAN.md, and VERIFICATION.md exist somewhere in the phase) is enforced deterministically by `gsd-tools.js verify phase-gate {phase}` at the orchestrator level (execute-phase.md's `pre_verify_gates` step), run after this plan and its sibling plans in the phase complete — this executor is not responsible for that phase-wide check. If a mandatory step in this plan is genuinely skipped (not "not applicable," a real skip of something otherwise required), that skip requires `gsd-tools.js deferred add {phase} --step <step> --reason <reason> --approver <approver>` as part of the skip, not logged-and-forgotten afterward.

When encountering a task with `tdd="true"`:

DO NOT execute the task inline. Instead:

1. Collect context from the PREVIOUS implementation task:
   - `task_name`: name of the implementation task just completed
   - `files_modified`: files created/modified in the previous task
   - `behavior_description`: the previous task's `<done>` criteria text
   - `project_dir`: current working directory

2. Route then spawn gsd-test-writer:
   ```
   // Route first — test complexity varies by what's being tested
   route_result = Agent(
     subagent_type="gsd-task-router",
     description="Route test task",
     max_turns=5,
     prompt="Route this task: Test {task_name}

Task action:
Write and run comprehensive tests covering: {behavior_description}

Done criteria:
All tests pass. gsd-test-writer reports 0 failing tests across all categories (auth, validation, error handling, edge cases, wiring).

Verification:
Run test suite and confirm 0 failing tests.

Plan context: complexity=medium, depends_on=0 prior plans, must_haves=1 criteria"
   )
   test_writer_model = parse "Model:" line from route_result // default "sonnet" if parse fails

   Agent(
     subagent_type="gsd-test-writer",
     description="Write tests for {task_name}",
     model={test_writer_model},
     prompt="
       task_name={task_name}
       files_modified={files_modified}
       behavior_description={behavior_description}
       project_dir={project_dir}
       test_framework={detected from package.json / deno.json}
     "
   )
   ```

3. Wait for gsd-test-writer to complete.

4. If gsd-test-writer reports failing tests:
   - Apply Deviation Rule 1 (auto-fix bugs): fix the implementation
   - Re-spawn gsd-test-writer to verify
   - If still failing after 2 retries: BLOCK — do NOT proceed to the next task. Return:
     ```
     ## PLAN FAILED: Test task blocked execution

     **Task:** {task_name} (tdd="true")
     **Failing tests:** {count}
     **Retries exhausted:** 2
     **Telemetry:** context_pressure={0.0-1.0 estimate}, instructions_not_followed={count}, ambiguities={count}, tool_errors_swallowed={count}

     Tests MUST pass before this plan can continue. Do NOT create SUMMARY.md.
     ```
     Do NOT log as a "gap" and continue. Do NOT create SUMMARY.md. Failing tests on a tdd="true" task are a hard blocker.

5. If gsd-test-writer returns 0 tests written:
   - BLOCK — this is a failure, not a skip. A tdd="true" task that produces no tests has not been completed.
   - Re-spawn gsd-test-writer once with explicit instruction: "You MUST write at least 6 tests. 0 tests is not acceptable."
   - If second attempt also returns 0 tests: BLOCK execution. Return failure as above.

6. Record in SUMMARY.md:
   ```
   Tests (Task N+1): {passed} passing, {failed} failing
   Categories covered: {list}
   ```

6. Commit (stage test files individually, per task_commit_protocol):
   ```bash
   git add {test_file_1} {test_file_2} {test_file_N}
   git commit -m "test({scope}): add {feature} tests"
   ```

</test_task_handling>

<post_plan_test_gate>

## Post-Plan Test Suite Gate

After ALL tasks in the plan complete (including all `tdd="true"` test tasks), run the full project test suite as a final quality gate before creating SUMMARY.md.

**SUMMARY.md creation is BLOCKED if:**
- Test suite fails (non-zero exit code)
- Test suite times out (5-minute limit, exit code 124)
- Measured coverage falls below `testing.coverage_threshold` (when set in config.json)

**Step 1: Detect test command**

```bash
# Try config.json first
TEST_CMD=$(node ~/.claude/get-shit-done/bin/gsd-tools.js config get testing.test_command 2>/dev/null || echo "")

if [ -z "$TEST_CMD" ]; then
  # Auto-detect from package.json
  if [ -f "package.json" ]; then
    TEST_CMD=$(node -e "try{const p=require('./package.json');console.log(p.scripts&&p.scripts['test:ci']||p.scripts&&p.scripts.test||'')}catch(e){console.log('')}" 2>/dev/null || echo "")
  fi
fi

if [ -z "$TEST_CMD" ]; then
  # Try deno.json
  if [ -f "deno.json" ]; then
    TEST_CMD=$(node -e "try{const d=require('./deno.json');console.log(d.tasks&&d.tasks['test:ci']||d.tasks&&d.tasks.test||'')}catch(e){console.log('')}" 2>/dev/null || echo "")
  fi
fi
```

If TEST_CMD is empty after all detection attempts AND this plan contains no `tdd="true"` tasks: log "No test command found and no tdd tasks — skipping post-plan test gate" and proceed to `<summary_creation>`.

**However:** If TEST_CMD is empty BUT this plan contains `tdd="true"` tasks, this is a HARD FAILURE. The tdd tasks should have created tests and a test runner. Log: "CRITICAL: Plan has tdd='true' tasks but no test command found — test infrastructure was not properly set up." Set TEST_GATE_BLOCKED=true, TEST_GATE_REASON="missing_test_infrastructure". Do NOT create SUMMARY.md.

**CRITICAL: Infrastructure unavailability is NOT the same as "no test command found".** If TEST_CMD exists but tests fail because services are down, you MUST attempt infrastructure startup (Step 1.5 below). Only when TEST_CMD truly cannot be detected from any config file should this gate be skipped.

**Step 1.5: Infrastructure startup (if TEST_CMD found)**

If TEST_CMD is non-empty, do a quick pre-flight run to detect infrastructure errors BEFORE the full 5-minute run:

```bash
# Quick pre-flight to detect infrastructure errors
PRE_FLIGHT_FILE="/tmp/gsd-preflight-$$.txt"
timeout 30 bash -c "${TEST_CMD}" > "${PRE_FLIGHT_FILE}" 2>&1
PRE_FLIGHT_EXIT=$?
PRE_FLIGHT_OUTPUT=$(cat "${PRE_FLIGHT_FILE}" 2>/dev/null || echo "")
rm -f "${PRE_FLIGHT_FILE}"

# Detect infrastructure unavailability
INFRA_ERROR=false
if echo "$PRE_FLIGHT_OUTPUT" | grep -qiE "ECONNREFUSED|connection refused|not running|supabase.*not|database.*unavailable|connect.*failed|supabase not started|service.*unavailable"; then
  INFRA_ERROR=true
fi
```

If INFRA_ERROR=true AND PRE_FLIGHT_EXIT != 0:

1. Log: "Infrastructure appears to be down — reading CLAUDE.md for startup commands..."

2. Read the project's CLAUDE.md (same approach as gsd-charlotte-qa: `find . -maxdepth 2 -name "CLAUDE.md" | head -1`). Look for a `## Dev / Infrastructure` or `## Supabase` or `## QA / Dev Server` section — extract the infrastructure startup command.

3. If CLAUDE.md has a startup command: run it. Example: if CLAUDE.md mentions `supabase start` → run `supabase start 2>&1 | tail -10`. Wait up to 60s for it to complete.

4. If no CLAUDE.md startup command found, try common fallbacks in order:
   - If `supabase/config.toml` or `supabase/` directory exists: `supabase start`
   - If `docker-compose.yml` or `docker-compose.yaml` exists: `docker-compose up -d`

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
- Look for `Coverage: N.N%` in Jest output
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
- Good: "JWT auth with refresh rotation using jose library"
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

**Test Results table (include when any tdd="true" tasks were executed):**

```markdown
| Task | Tests Written | Tests Passing | Categories |
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

**Distribution:** {haiku_count} haiku / {sonnet_count} sonnet / {opus_count} opus
**Escalations:** {escalation_count} (haiku → sonnet on retry)
```

Omit this section entirely if ROUTED_TIER was null for all tasks (routing not active — non-auto profile).
</summary_creation>

<docs_update>

## Mandatory Docs Update

After self-check passes (SUMMARY.md verified), spawn the docs updater agent as the last mandatory step before state updates.

**This step is not skippable.** Fire it regardless of what was built. If self-check failed (SUMMARY.md says FAILED), skip this step — state updates are also skipped in that case.

Determine the absolute path of the SUMMARY.md just written:

```bash
SUMMARY_PATH="$(pwd)/.planning/phases/${PHASE_DIR}/${PHASE}-${PLAN}-SUMMARY.md"
PROJECT_ROOT="$(pwd)"
```

Spawn gsd-docs-updater:

```
Agent(
  subagent_type="gsd-docs-updater",
  model="{executor_model}",
  prompt="
    <context>
    Phase: {PHASE}
    Plan: {PLAN}
    Project root: {PROJECT_ROOT}
    </context>

    <summary_path>
    {SUMMARY_PATH}
    </summary_path>

    Read the SUMMARY.md at the path above. Classify build scope. Detect /docs conventions. Write proportionally-scoped docs. Commit. Report.
  "
)
```

Wait for gsd-docs-updater to complete. Parse the returned structured contract (see gsd-docs-updater.md's `<report>` step):
- `written_files` — array of absolute paths written (empty array if none)
- `commit` — short commit hash, or the literal `"none"`
- `errors` — array of error strings (empty array if none)

**On docs agent failure — HARD BLOCK. Do NOT proceed to state_updates.** Failure means any of:
- `Agent()` throws an exception, or the call times out
- The returned report's `errors` array is non-empty
- The returned report has `written_files: []` (empty) AND `errors: []` (empty) — per gsd-docs-updater.md's own contract, this combination should never occur legitimately; if it does, treat it as a failure, not a silent pass

On any of the above:
1. Append to SUMMARY.md:
   ```markdown
   ## Docs

   **Status:** BLOCKED — {error message or "docs-updater returned no written files and no error, treated as failure per contract"}
   ```
2. STOP. Present two options to the operator/coordinator, matching the pattern already established for Gate 1 in `execute-phase.md`:
   (a) Fix the underlying issue (missing SUMMARY.md path, docs convention detection bug, etc.) and re-spawn `gsd-docs-updater`, or
   (b) For a legitimate, documented exception, run `node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" deferred add "${PHASE}" --step docs --reason <reason> --approver <approver> --plan "${PLAN}"`, then proceed to state_updates with the waiver noted in SUMMARY.md's `## Docs` section.
3. Do not allow silent continuation past a docs failure. This step remains "not skippable" (see above — unchanged) — the fix is that failure now actually blocks, instead of being logged and ignored.

**On docs agent success** (parse the structured contract — `written_files` non-empty OR a valid `commit` other than `"none"`, and `errors` empty): append to SUMMARY.md:

```markdown
## Docs

**Scope:** {DOCS_BUILD_SCOPE}
**Files written:**
{for each file in written_files: - {file path}}
**Commit:** {commit}
```

</docs_update>



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
  --stopped-at "Completed ${PHASE}-${PLAN}-PLAN.md"
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

# Also update ROADMAP.md progress row for this phase
node ~/.claude/get-shit-done/bin/gsd-tools.js roadmap update-plan-progress "${PHASE_NUMBER}"
```

If REQUIREMENTS.md doesn't exist or requirement not found, log and continue — do not fail.
</update_requirements>

<final_commit>
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js commit "docs({phase}-{plan}): complete [plan-name] plan" --files .planning/phases/XX-name/{phase}-{plan}-SUMMARY.md .planning/STATE.md .planning/ROADMAP.md .planning/REQUIREMENTS.md
```

Include ROADMAP.md and REQUIREMENTS.md in the final commit — they are updated by the `update_requirements` step above. If either file doesn't exist, the commit tool will skip it gracefully.

Separate from per-task commits — captures execution results only.
</final_commit>
