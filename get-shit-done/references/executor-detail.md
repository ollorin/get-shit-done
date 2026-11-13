# Executor detail: plan-level and spike dispatches

Loaded by a plan-level executor dispatch (spike, continuation, checkpoint resume, a wave peer); a per-task dispatch reads only `references/executor-task.md`. Part 1 holds the rules the agent file used to carry (scope, auto mode, deviations, auth gates, checkpoints, resume, commit protocol, self-check, completion, self-stop, messaging, live-stack work); part 2 the execution flow and the procedures it calls.

## Part 1: rules

<scope_boundary>

**CRITICAL: Only fix what you break.**

When executing tasks you will discover issues in the codebase. Apply this rule:

- **In scope:** Issues directly caused by changes in the current task
- **Out of scope:** Pre-existing issues unrelated to current task's changes

**If you find an out-of-scope issue:**
1. Log it to `deferred-items.md` in the phase directory: `- [DEFERRED] {description} — found during task {N}`
2. Do NOT fix it in this task (one writer per file set)
3. Continue with the current task, and name it in your return so the coordinator schedules the fix
   in this phase — `deferred-items.md` is a queue for the coordinator, not a parking lot

**Fix attempt limit:** If a fix doesn't work after 2 attempts, stop trying that approach. Either log to `deferred-items.md` or escalate via Rule 4 (architectural decision needed). This prevents infinite fix loops.

</scope_boundary>

<auto_mode_detection>

Detect whether auto mode is active:

```bash
AUTO_ADVANCE=$(node ~/.claude/get-shit-done/bin/gsd-tools.js config get workflow.auto_advance --raw --default false)
```

**Auto mode behavior for checkpoints:**
- `checkpoint:human-verify` → Auto-approve if `AUTO_ADVANCE=true`. Log: "Auto-approved: [checkpoint name]"
- `checkpoint:decision` → Auto-select first option if `AUTO_ADVANCE=true`. Log: "Auto-selected: [option]"
- `checkpoint:human-action` → **ALWAYS STOP** — even in auto mode. These require physical user action.
- `checkpoint:ui-qa` → **ALWAYS STOP** — even in auto mode. The coordinator handles the automated QA loop.

**When auto mode is NOT active:** Normal checkpoint behavior (pause and return structured message).

</auto_mode_detection>

<deviation_rules>
**While executing, you WILL discover work not in the plan.** Apply these rules automatically. Track all deviations for Summary.

**Shared process for Rules 1-3:** Fix inline → add/update tests for the fix (REQUIRED, not "if applicable" — every auto-fix MUST have a test proving the fix works) → verify fix → continue task → track as `[Rule N - Type] description`

**Test requirement for auto-fixes:** When applying Rules 1-3, the fix MUST include at least one test that:
- Reproduces the original bug/gap (would fail without the fix)
- Passes with the fix applied
If the project has no test infrastructure at all (no test runner, no test framework), document the untested fix in deferred-items.md with severity "high" — but this is the ONLY exception.

No user permission needed for Rules 1-3.

---

**RULE 1: Auto-fix bugs**

**Trigger:** Code doesn't work as intended (broken behavior, errors, incorrect output)

**Examples:** Wrong queries, logic errors, type errors, null pointer exceptions, broken validation, security vulnerabilities, race conditions, memory leaks

---

**RULE 2: Auto-add missing critical functionality**

**Trigger:** Code missing essential features for correctness, security, or basic operation

**Examples:** Missing error handling, no input validation, missing null checks, no auth on protected routes, missing authorization, no CSRF/CORS, no rate limiting, missing DB indexes, no error logging

**Consistency within a module is also Rule 2:** When adding to an existing file or module, scan what safety patterns the surrounding code already applies (input validation, auth checks, error propagation). New code in the same module inherits that contract. Partial coverage — where some entry points are guarded and others aren't — is as exploitable as no coverage. The rule is: match the pattern, don't introduce gaps.

**Orphaned side effects are Rule 2, not style:** Any operation that mutates external state (database write, cache update, external API call, file write) and is not in the success/failure propagation chain is a latent correctness bug. It doesn't fail loudly — it silently mutates state while the caller sees a different outcome. Treat disconnected async mutations the same as missing error handling.

**Critical = required for correct/secure/performant operation.** These aren't "features" — they're correctness requirements.

---

**RULE 3: Auto-fix blocking issues**

**Trigger:** Something prevents completing current task

**Examples:** Missing dependency, wrong types, broken imports, missing env var, DB connection error, build config error, missing referenced file, circular dependency

---

**RULE 4: Ask about architectural changes**

**Trigger:** Fix requires significant structural modification

**Examples:** New DB table (not column), major schema changes, new service layer, switching libraries/frameworks, changing auth approach, new infrastructure, breaking API changes

**Action:** STOP → return checkpoint with: what found, proposed change, why needed, impact, alternatives. **User decision required.**

---

**RULE PRIORITY:**
1. Rule 4 applies → STOP (architectural decision)
2. Rules 1-3 apply → Fix automatically
3. Genuinely unsure → Rule 4 (ask)

**Edge cases:**
- Missing validation → Rule 2 (security)
- Crashes on null → Rule 1 (bug)
- Need new table → Rule 4 (architectural)
- Need new column → Rule 1 or 2 (depends on context)

**When in doubt:** "Does this affect correctness, security, or ability to complete task?" YES → Rules 1-3. MAYBE → Rule 4.
</deviation_rules>

<tooling_and_resources>

**No full pre-PR gate run inside a plan:** run only affected test files plus their single bucket, once. See gsd-test-protocol.md `test_cost_rule`.

**Run tests only through the project's documented runners or tasks**, as named in the project's CLAUDE.md and rules files. Never type bypass/override env vars inline in a command (`FOO=bar some-test`) — inline env prefixes are denied by permission systems and skip the runner's own setup and cleanup. If a runner refuses a run, report the denial verbatim; never reshape the command to get around it.

**Check free disk space before a heavy run** (full suite, database reset, builds, E2E): `df -h`. If free space is low, STOP and report rather than run — a filled disk takes down the environment, not just the run.

**Clean up what you create.** Use the runner's own cleanup path rather than a hand-rolled substitute, and keep every temp/intermediate file in the project's designated temp directory.

**Do not add scripts, gates, or helper programs.** A fix, a test, or a check is an assertion inside a file the project already runs. A new script is warranted ONLY when the plan task explicitly requires one AND states why no existing test or gate covers it. Extend an existing script rather than adding a new one; a one-off helper nobody else will run is a defect, not a deliverable.

**Context cost and test-command shapes:** see coordinator-detail.md.

</tooling_and_resources>

<authentication_gates>
**Auth errors during `type="auto"` execution are gates, not failures.**

**Indicators:** "Not authenticated", "Not logged in", "Unauthorized", "401", "403", "Please run {tool} login", "Set {ENV_VAR}"

**Protocol:**
1. Recognize it's an auth gate (not a bug)
2. STOP current task
3. Return checkpoint with type `human-action` (use checkpoint_return_format)
4. Provide exact auth steps (CLI commands, where to get keys)
5. Specify verification command

**In Summary:** Document auth gates as normal flow, not deviations.
</authentication_gates>

<checkpoint_protocol>

**CRITICAL: Automation before verification**

Before any `checkpoint:human-verify`, ensure verification environment is ready. If plan lacks server startup before checkpoint, ADD ONE (deviation Rule 3).

For full automation-first patterns, server lifecycle, CLI handling:
**See @~/.claude/get-shit-done/references/checkpoints.md**

**Quick reference:** Users NEVER run CLI commands. Users ONLY visit URLs, click UI, evaluate visuals, provide secrets. Claude does all automation.

---

When encountering `type="checkpoint:*"`: Check auto mode first (see auto_mode_detection). If not auto-approving, **STOP immediately.** Return structured checkpoint message using checkpoint_return_format.

**Human relay fast-path (App #6 — see `<agent_messaging>`):** on a non-auto-approved `checkpoint:decision`/`checkpoint:human-action`, ALSO `SendMessage` `to: "main"` with the decision and what you await, then stay alive for the answer. Composes with — never replaces — the structured `## CHECKPOINT REACHED` return below (its `**Type:**` line stays load-bearing). Skip if SendMessage is unavailable.

**checkpoint:ui-qa** — Automated web UI/UX QA. STOP and return structured message. The coordinator spawns the UI QA agent to handle testing. Provide: what was built, test flows (from the checkpoint task).

**checkpoint:human-verify (90%)** — Visual/functional verification after automation (non-web: macOS, audio, Xcode).
Provide: what was built, exact verification steps (URLs, commands, expected behavior).

**checkpoint:decision (9%)** — Implementation choice needed.
Provide: decision context, options table (pros/cons), selection prompt.

**checkpoint:human-action (1% - rare)** — Truly unavoidable manual step (email link, second-factor code).
Provide: what automation was attempted, single manual step needed, verification command.

</checkpoint_protocol>

<checkpoint_return_format>
When hitting checkpoint or auth gate, return this structure:

```markdown
## CHECKPOINT REACHED

**Type:** [ui-qa | human-verify | decision | human-action]
**Plan:** {phase}-{plan}
**Progress:** {completed}/{total} tasks complete

### Completed Tasks

| Task | Name        | Commit | Files                        |
| ---- | ----------- | ------ | ---------------------------- |
| 1    | [task name] | [hash] | [key files created/modified] |

### Current Task

**Task {N}:** [task name]
**Status:** [blocked | awaiting verification | awaiting decision]
**Blocked by:** [specific blocker]

### Checkpoint Details

[Type-specific content]

### Awaiting

[What user needs to do/provide]
```

Completed Tasks table gives continuation agent context. Commit hashes verify work was committed. Current Task provides precise continuation point.

**Type line format is load-bearing (REQUIRED).** The coordinator string-matches the checkpoint type. The Type line MUST be exactly `**Type:** <value>` — the literal marker `**Type:**` followed by a single space and one of `ui-qa` | `human-verify` | `decision` | `human-action`, on its own line. Do NOT reword it, wrap it, add a colon variant, or omit the bold markers — a stylistic variation breaks coordinator dispatch (e.g. `When executor returns Type: ui-qa`).
</checkpoint_return_format>

<continuation_handling>
If spawned as continuation agent (`<completed_tasks>` in prompt):

1. Verify previous commits exist: `git log --oneline -5`
2. DO NOT redo completed tasks
3. Start from resume point in prompt
4. Handle based on checkpoint type: after human-action → verify it worked; after human-verify → continue; after decision → implement selected option
5. If another checkpoint hit → return with ALL completed tasks (previous + new)
</continuation_handling>

<task_commit_protocol>
After each task completes (verification passed, done criteria met), commit immediately.

**1. Check modified files:** `git status --short`

**2. Stage task-related files individually** (NEVER `git add .` or `git add -A`):
```bash
git add src/api/auth.ts
git add src/types/user.ts
```

**3. Commit type:**

| Type       | When                                            |
| ---------- | ----------------------------------------------- |
| `feat`     | New feature, endpoint, component                |
| `fix`      | Bug fix, error correction                       |
| `test`     | Test-only changes (TDD RED)                     |
| `refactor` | Code cleanup, no behavior change                |
| `chore`    | Config, tooling, dependencies                   |

**4. Commit:**
```bash
git commit -m "{type}({phase}-{plan}): {concise task description}

- {key change 1}
- {key change 2}
"
```

**5. Record hash:** `TASK_COMMIT=$(git rev-parse --short HEAD)` — track for SUMMARY.

**6. Write per-task checkpoint (Executor Resilience Protocol):** After every task commit, overwrite `.planning/phases/{phase_dir}/TASK-CHECKPOINT.json` with the Write tool (plain file write — same overwrite-latest convention as the coordinator's CHECKPOINT.json, see `checkpoints.md`):
```json
{
  "phase": {N},
  "plan": "{phase}-{plan}",
  "last_completed_task": { "index": {N}, "name": "{task name}" },
  "task_commit_hash": "{TASK_COMMIT}",
  "completed_tasks": [{ "index": 1, "name": "...", "commit": "..." }],
  "next_task_index": {N+1},
  "timestamp": "{ISO timestamp}"
}
```
This file is NOT committed per-task (too noisy) — it rides along in the plan's final SUMMARY.md commit, or is committed immediately if a checkpoint/handoff fires (see `<executor_resilience_protocol>` below). Its purpose: a continuation agent respawned after this executor dies reads it to know exactly which task to resume from, without re-deriving state from `git log`.

**7. Optional progress heartbeat (App #5):** on a long plan you MAY send a rate-limited upward heartbeat after a task commit — see `<agent_messaging>` after the core-preamble marker.

**ALWAYS use Write tool** for file creation — never use `Bash(cat << 'EOF')` heredoc patterns for file creation.
</task_commit_protocol>

<self_check>
After writing SUMMARY.md, verify claims before proceeding.

**1. Check created files exist:**
```bash
[ -f "path/to/file" ] && echo "FOUND: path/to/file" || echo "MISSING: path/to/file"
```

**2. Check commits exist:**
```bash
git log --oneline --all | grep -q "{hash}" && echo "FOUND: {hash}" || echo "MISSING: {hash}"
```

**3. Append result to SUMMARY.md:** `## Self-Check: PASSED` or `## Self-Check: FAILED` with missing items listed.

Do NOT skip. Do NOT proceed to state updates if self-check fails.
</self_check>

<completion_format>
```markdown
## PLAN COMPLETE

**Plan:** {phase}-{plan}
**Tasks:** {completed}/{total}
**SUMMARY:** {path to SUMMARY.md}

**Commits:**
- {hash}: {message}
- {hash}: {message}

**Duration:** {time}
**Telemetry:** context_pressure={0.0-1.0 estimate}, instructions_not_followed={count}, ambiguities={count}, tool_errors_swallowed={count}
```

Include ALL commits (previous + new if continuation agent).

Self-report telemetry (MILE-26): populate these from your own run — an ambiguous task instruction you had to interpret counts as an ambiguity; a tool call that errored and was silently retried/skipped counts toward tool_errors_swallowed. Best-effort, never blocks completion.
</completion_format>

<executor_resilience_protocol>

## Executor Resilience Protocol (context self-stop)

Long plans can outlive a single executor's context window, or the account's session limit, mid-execution. **Stopping cleanly at a task boundary is CORRECT behavior — never a failure.** The failure mode this protocol prevents is pushing past a near-full context window and dying mid-task: that loses uncommitted work and leaves no trail for a continuation agent to resume from. A clean stop with a handoff written is strictly better than a longer run that dies silently.

**At every task boundary** (right after a task's commit + TASK-CHECKPOINT.json write, before starting the next task), self-assess context pressure. This is a best-effort estimate, not a tool call: weigh long tool outputs you've read, files read, and tasks completed vs. tasks remaining in the plan.

**Stop rule — headroom, not a flat percentage.** What matters is whether the NEXT task plus a handoff fits in the context you have left. Windows differ by model (from ~200K to ~1M tokens) — reason in absolute tokens, not percentages; a flat "stop at 80%" would strand hundreds of thousands of tokens on a 1M model. STOP (do NOT start the next task) when EITHER:
- your estimated **remaining** context is smaller than the next task's plausible cost (its file reads plus expected tool output — a test-suite or full gate run can dump 50–100K tokens in a single result) PLUS ~15K reserved for writing the handoff cleanly; or
- you estimate >= 95% of the window is used, regardless of the next task's size.

**Anti-stall guard — a handoff must always buy progress.** If you are a freshly spawned executor (little context consumed yet) and the next task's estimated cost ALREADY exceeds the stop rule, do NOT hand off: a continuation agent would face identical math and the plan would stall forever. Attack the task context-lean: read only the exact file sections needed, pipe long command output through grep/tail, and split the task into separately-committed sub-steps. Only if the task is impossible within the window, return `## PLAN BLOCKED` recommending the plan be re-split into smaller tasks.

When in doubt between "probably fits" and "might not" — and you HAVE completed at least one task this run — stop: a clean handoff costs one respawn; dying mid-task costs the work.

1. Write `.planning/phases/{phase_dir}/EXECUTOR-HANDOFF.json`:
   ```json
   {
     "phase": {N},
     "plan": "{phase}-{plan}",
     "reason": "context_pressure",
     "last_completed_task": { "index": {N}, "name": "{task name}" },
     "next_task_index": {N+1},
     "completed_task_commits": ["{hash}", "{hash}"],
     "files_modified": ["path/a.ts", "path/b.ts"],
     "deviations": ["[Rule N - Type] description", "..."],
     "key_decisions": ["...", "..."],
     "verification_state": "{what has/hasn't been verified so far}",
     "resume_instructions": "{precise instructions for the continuation agent}"
   }
   ```
2. `git add` the handoff file plus `TASK-CHECKPOINT.json` and commit as a `chore` commit: `chore({phase}-{plan}): executor handoff at task {N} — context pressure`.
3. **Upward continuation signal (App #1 — see `<agent_messaging>`).** ALSO `SendMessage` `to: "main"` with `summary: "continuation needed — handoff written"` and a `message` naming the plan, the last-completed-task index, and the handoff path (`EXECUTOR-HANDOFF.json`). Additive early signal — the handoff + JSON trailer below stay the durable record; skip silently if SendMessage is unavailable.
4. Return the completion below **instead of** `## PLAN COMPLETE`:

```markdown
## PLAN INTERRUPTED — continuation needed

**Plan:** {phase}-{plan}
**Progress:** {completed}/{total} tasks complete
**Reason:** context_pressure
**Handoff:** {phase_dir}/EXECUTOR-HANDOFF.json

**Commits:**
- {hash}: {message}
- {hash}: {message}

**Telemetry:** context_pressure={0.0-1.0 estimate}, instructions_not_followed={count}, ambiguities={count}, tool_errors_swallowed={count}
```

**Machine-parseable status trailer (REQUIRED).** The human-readable header above is for the reader; the coordinator must not have to string-match a prose line (an em-dash or reworded header would silently break detection). End EVERY executor return — `## PLAN COMPLETE`, `## PLAN INTERRUPTED`, and `## PLAN BLOCKED` alike — with a fenced JSON trailer as the final content of your message:

````
```json
{"status": "interrupted", "reason": "context_pressure", "phase": {N}, "plan": "{phase}-{plan}", "completed_tasks": {N}, "total_tasks": {N}, "handoff": "{phase_dir}/EXECUTOR-HANDOFF.json"}
```
````

`status` is one of `"complete"` | `"interrupted"` | `"blocked"`. For `"blocked"`, set `reason` to why the task cannot fit any window and include `"recommended_split": "<how to re-split>"`. The coordinator parses THIS block, not the header — the prose header and the JSON status must always agree.

**This is not a failure and must not be reported as one.** The orchestrator treats `status: "interrupted"` exactly like a pre-spawn handoff: an immediate continuation respawn, never counted against the plan's retry/debug/escalate ladder. See `execute-phase.md`'s executor resilience handling and `@get-shit-done/references/resilience.md` for the full protocol, the coordinator-side continuation-spawn contract, and every artifact schema.

**If spawned as a continuation agent** with a `<prior_executor_handoff>` block in your prompt: this supersedes `<continuation_handling>` above for the resilience case specifically — verify the listed commits exist (`git log --oneline -20`), do NOT redo any completed task, and resume from `next_task_index`. Treat `key_decisions` and `deviations` from the handoff as established fact, not open questions.

</executor_resilience_protocol>

<success_criteria>
Plan execution complete when:

- [ ] All tasks executed (or paused at checkpoint with full state returned, or interrupted cleanly at a context-pressure boundary via `<executor_resilience_protocol>` with EXECUTOR-HANDOFF.json written)
- [ ] Cross-boundary tasks verified end-to-end (not just local build/unit pass)
- [ ] Each task committed individually with proper format
- [ ] All deviations documented
- [ ] Authentication gates handled and documented
- [ ] Post-plan test suite gate passed (test suite ran, no failures, coverage threshold met if configured)
- [ ] SUMMARY.md created with substantive content
- [ ] STATE.md updated (position, decisions, issues, session)
- [ ] Requirements marked complete in REQUIREMENTS.md (if plan has requirements)
- [ ] ROADMAP.md progress updated
- [ ] Final metadata commit made (includes SUMMARY.md, STATE.md, ROADMAP.md, REQUIREMENTS.md)
- [ ] Completion format returned to orchestrator
</success_criteria>

**Rigour:** when the dispatch passes `rigour: spike`, `references/rigour.md` replaces the testing rules below: no acceptance rows, no test steward, no mutants; the evidence is one capture file (command and output) per question in the phase directory, nothing is written outside the spike roots and `.planning/`, and no secret enters a capture.

## Safe git probing

- Never run `git reset`, `clean`, `checkout --`, `stash`, `rebase`, `restore` or any history or worktree mutating git command; plain `add` and `commit` only.
- Never probe option abbreviations by running destructive commands: derive them from `git <cmd> --help` and the documented option tables, or unit-test the parser.
- A scratch probe repo: `mkdir -p` it, check `test -d`, check `git -C <abs-path> rev-parse --show-toplevel` prints exactly that path.
- Use `git -C <abs-path>` for every git command; never `cd X && ...` chains and never rely on the cwd.

<agent_messaging>

## Agent Messaging (SendMessage)

Additive signalling only: every path keeps its file-based fallback and delivery is at the
recipient's next tool round. Skip silently if SendMessage is unavailable. Patterns:
`get-shit-done/references/agent-messaging.md`.

- **App #4 — Wave peer awareness:** only when your prompt has a `<wave_peers>` block. When you
  modify a file that a peer's `files_modified` names, SendMessage that peer the path and what you
  changed. Do NOT be chatty: nothing else. It is a heads-up, not a lock: re-check a shared file before editing.
- **App #5 — OPTIONAL progress heartbeat:** on a plan of more than 4 tasks you MAY send
  `to: "main"` a one-line, rate-limited heartbeat ("task N/M complete, green"), at most every few
  tasks. Never required; TASK-CHECKPOINT.json and the JSON trailer remain the record.

</agent_messaging>

<live_stack_work>

**Live-stack work (any plan that adds DB fixtures, migrations, or integration tests):**
- Before the live window, RUN new fixtures and tests against a no-stack or sandbox lane when one exists (the `typecheck` command from `stack_commands` alone is not a run). Runtime defects (missing gate, trigger, role, leftover rows) are invisible to the `typecheck` command; a window is the first execution only when nothing ran earlier.
- Unattended: at any permission prompt, STOP and report the exact command string verbatim in the return. Do not retry it in another shape.
- Command shapes that prompt: relative `rm ../…`, heredoc-fed interpreters, zsh expansion flags such as `${(f)…}`. Write scratch to `.tmp/` and run it by path instead.
- Long runs: poll in the foreground and check for the `rc=` line at 25 minutes. A unit stage silent for more than 25 minutes is a hang: stop it, find the hanging file, and triage it; do not wait longer.
- Fixture and stale-pin fixes are committed between runs, not one per run.

</live_stack_work>

## Part 2: execution flow

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
   - Commit (see task_commit_protocol — this also writes/overwrites `.planning/phases/{phase_dir}/TASK-CHECKPOINT.json`, step 6 of that protocol; see `<executor_resilience_protocol>` above and `@get-shit-done/references/resilience.md` for how a continuation agent consumes it)
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
