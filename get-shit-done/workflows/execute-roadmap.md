<purpose>
Execute an entire ROADMAP.md with a lean orchestrator that spawns one phase coordinator per phase. The orchestrator is a loop over two deterministic commands, `gsd-tools roadmap next` and `gsd-tools roadmap record`; completion is decided on disk by the tool, never by a coordinator's claim.
</purpose>

<core_principle>
Disk is truth, the execution log is the audit trail, one writer each. The orchestrator parses nothing it can ask the tool for, tracks no DAG itself and logs no completion by hand. Each phase gets a fresh coordinator context; no state leaks between phases except `.planning/EXECUTION_LOG.md`.
</core_principle>

<required_reading>
Read STATE.md before any operation to load project context.

**Auto mode:** `auto_mode` (from init) is the one rule for "no human is answering". The rule, its classes K1-K6 and the logging command are in `@~/.claude/get-shit-done/references/auto-mode.md`. When it is true, AskUserQuestion is never called and nothing waits for a reply, except the three owner gates (OG1 composition and OG2 roadmap before any phase, OG3 the pull request at the end; `references/auto-mode.md`, Owner gates). Each other prompt below takes its class action and logs an `auto_decision` event. Put `auto: true` in every spawn prompt.
</required_reading>

<autonomous_resumption>
A long roadmap can outlive one session. A process supervisor outside this process (see `docs/host-setup.md` in the GSD fork) can relaunch `claude -p "/gsd:execute-roadmap --auto"` after a session or quota death; each relaunch has no memory and only what is on disk (`.planning/EXECUTION_LOG.md`, ROADMAP.md, STATE.md, each phase's CHECKPOINT.json). That is a different mechanism from step 4a below, which recovers a spawned sub-agent dying while this orchestrator survives (`references/resilience.md`). Nothing inside this workflow can detect the orchestrator process itself dying.

**A project without a brief or stack profile:** an unattended run exports `GSD_LEGACY=1` before the first command; the flag alone does not reach spawned agents, so every spawn prompt also carries `legacy: {legacy}` from init.

`GSD_AUTONOMOUS=1` is one of the sources of `auto_mode` (`references/auto-mode.md`); this workflow does not read it separately. In auto mode a resume always continues: "restart" discards completed-phase history and is reachable only through an interactive human answer.
</autonomous_resumption>

<process>

<step name="initialize" priority="first">
```bash
INIT_FILE=$(mktemp "${TMPDIR:-/tmp}/gsd-roadmap-init.XXXXXX")
node ~/.claude/get-shit-done/bin/gsd-tools.js init execute-roadmap $AUTO_FLAG $LEGACY_FLAG > "$INIT_FILE"
```
`$AUTO_FLAG` is `--auto` when `--auto` is in `$ARGUMENTS`; `$LEGACY_FLAG` is `--legacy` for a legacy run. If the output starts with `@file:`, read the path after it.

Parse the JSON for: `roadmap_exists` (false: error "`.planning/ROADMAP.md` not found. Initialize the project first." and exit), `auto_mode`, `legacy`, `total_phases`, `execution_order`, `next_executable`, `blocked_phases`, `has_execution_log`, `resume_state` (`{completed_phases, started_incomplete, parked}`, plus `status: waiting_owner_approval` and `blocked_by_owner_gate` while an owner gate is open), `owner_gates` (policy plus `status` of the composition, roadmap and pr gates), `blocked_by_owner_gate`, and the models `coordinator_model`, `ruling_model`, `ruling_model_fallback`, `utility_model`, `reviewer_model`, plus `milestone_version`, `milestone_slug`, `base_branch`. Every model used below comes from these fields; this file holds no model literal.

**If `blocked_by_owner_gate` is `composition` or `roadmap`:** no phase starts, no branch is created. Auto (auto_mode, references/auto-mode.md OG1/OG2): print the gate, its `gate_status` (`not_requested` means a milestone made before owner gates existed: run `owner-gate request --kind <kind> --summary "<composition or roadmap summary>"` first), the summary and the approve command, then end the run `waiting_owner_approval`. A legacy roadmap whose request is refused for a missing `**Risk domains:**` line gets that line added to the named phases first. A roadmap that changed after approval is re-requested with `--revise` (`references/rigour.md`). Interactively, tell the owner the gate is unapproved and stop.

**If `resume_state` is set:** see `<step name="resume_capability">`.
</step>

<step name="branch_guard">
Never commit roadmap work directly to the base branch.

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BRANCHING_STRATEGY=$(node ~/.claude/get-shit-done/bin/gsd-tools.js config get git.branching_strategy --raw --default none)
```

The base branch is `base_branch` from init (config `git.base_branch`, else the remote's default branch). When it is null, the protected names are `main` and `master`. If `CURRENT_BRANCH` is not the base branch, proceed silently.

The branch to create is `{milestone_version}-{milestone_slug}` from init; when either is empty or the project has no milestone heading, use `gsd/roadmap-{YYYYMMDD}`.

**If `CURRENT_BRANCH` is the base branch:**

Auto (auto_mode, references/auto-mode.md K2): create that branch (`git checkout -b "{branch}"`), log `auto_decision`, continue. Never take the override.

Otherwise (interactive) show the branch guard:
```
Branch guard: you are on {CURRENT_BRANCH}.
Roadmap execution commits many changes; running on the base branch risks polluting it with partial work.
  A) Create milestone branch now: {branch}
  B) Create custom branch: type "branch my-branch-name"
  C) Override: type "override"
```
"A" or "yes": create the branch and continue. "branch {name}": create it. "override": log a warning and continue. Anything else: exit cleanly.

If `BRANCHING_STRATEGY` is `milestone` and the run is not on the base branch, say which branch is in use.
</step>

<step name="preflight_quota_estimate">
Estimate whether the quota budget plausibly covers the remaining phases. Read-only; never reads the quota file directly.

**1. Remaining phases** are the on-disk truth the init already computed: `REMAINING_PHASES = len(next_executable) + len(blocked_phases)`.

**2. Run the estimate:**
```bash
QUOTA_ESTIMATE=$(node ~/.claude/get-shit-done/bin/gsd-tools.js resilience estimate-quota --phases ${REMAINING_PHASES})
SUFFICIENT=$(node -e "console.log(JSON.parse(process.argv[1]).sufficient)" "$QUOTA_ESTIMATE")
ESTIMATED_TOKENS=$(node -e "console.log(JSON.parse(process.argv[1]).estimated_tokens)" "$QUOTA_ESTIMATE")
REMAINING_BUDGET=$(node -e "console.log(JSON.parse(process.argv[1]).remaining_budget)" "$QUOTA_ESTIMATE")
QUOTA_SOURCE=$(node -e "console.log(JSON.parse(process.argv[1]).source)" "$QUOTA_ESTIMATE")
UNMEASURED=$(node -e "console.log(JSON.parse(process.argv[1]).unmeasured === true)" "$QUOTA_ESTIMATE")
```

**3. `UNMEASURED` is `true`** (no `.planning/quota/session-usage.json`, so the figures are a conservative default and not evidence): log and proceed, whatever else the estimate says.
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type quota_preflight_unmeasured \
  --data '{"remaining_phases": '"${REMAINING_PHASES}"', "source": "'"${QUOTA_SOURCE}"'"}'
```

**4. Measured and `SUFFICIENT` is `false`:** log loudly; this is a deliberate pause point, not a hard block.
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type quota_preflight_insufficient \
  --data '{"remaining_phases": '"${REMAINING_PHASES}"', "estimated_tokens": '"${ESTIMATED_TOKENS}"', "remaining_budget": '"${REMAINING_BUDGET}"', "source": "'"${QUOTA_SOURCE}"'"}'
```
Auto (auto_mode, references/auto-mode.md K1): proceed after the log above. Interactively, add to the confirm prompt: `Quota estimate: ~{ESTIMATED_TOKENS} tokens needed for {REMAINING_PHASES} phases, ~{REMAINING_BUDGET} remain (source: {QUOTA_SOURCE}). Type "yes" to proceed anyway, "wait" to pause until quota resets, or "stop" to cancel.`

**5. Measured and `SUFFICIENT` is `true`:** proceed silently and log for the analytics trail:
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type quota_preflight_ok \
  --data '{"remaining_phases": '"${REMAINING_PHASES}"', "estimated_tokens": '"${ESTIMATED_TOKENS}"', "remaining_budget": '"${REMAINING_BUDGET}"'}'
```
</step>

<step name="preflight_skew_check">
Self-referential staleness check, meaningful only when this orchestrator runs from a GSD source checkout. Read-only and non-blocking.

```bash
IS_GSD_CHECKOUT=false
if [ -f "get-shit-done/bin/gsd-tools.js" ]; then IS_GSD_CHECKOUT=true; fi
```

Not a source checkout: log "skew check skipped" and continue. Otherwise:
```bash
DOCTOR_RESULT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js doctor --raw)
REASON=$(node -e "console.log(JSON.parse(process.argv[1]).reason || '')" "$DOCTOR_RESULT")
CLEAN=$(node -e "console.log(JSON.parse(process.argv[1]).clean)" "$DOCTOR_RESULT")
```
`REASON` of `no_manifest` means GSD is not installed here: skipped, not drift. Otherwise:
```bash
if [ "$CLEAN" != "true" ] && [ "$REASON" != "no_manifest" ]; then
  node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
    --type skew_detected \
    --data "$DOCTOR_RESULT"
  echo "Installed GSD copy has drifted from this source checkout; see the execution log. This does not block the current run."
fi
```
Auto (auto_mode, references/auto-mode.md K1): warn and log, never stop.
</step>

<step name="confirm_execution">
Show the plan from the init data: total phases, execution order, one row per phase (`#`, name, on-disk status, dependencies).

Auto (auto_mode, references/auto-mode.md K1): invoking `/gsd:execute-roadmap` in auto mode is the authorisation; print the plan, log `auto_decision` (`{"prompt":"confirm_execution","class":"K1","chosen":"proceed"}`) and go to `initialize_execution_log`. A resume needs no new decision either.

Otherwise (interactive): ask `Confirm execution? This runs every incomplete phase in dependency order. Type "yes" to begin or "stop" to cancel.` "stop" exits; "yes" continues. (There is no skip option: `roadmap next` has no notion of a skipped phase, and a skipped dependency would only park its dependents.)
</step>

<step name="initialize_execution_log">
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type roadmap_start \
  --data '{"total_phases": {N}, "execution_order": [...], "timestamp": "..."}'
```
The log is JSONL under a markdown header, so appends stream. `roadmap_name` is the first heading of ROADMAP.md with a leading "Roadmap: " stripped (fallback "Roadmap"). There is no external notification channel: the orchestrator prints status and any owner question (the owner's title is `owner_title` in init) to the chat, and nothing blocks on a reply. Print "Roadmap execution started" with the phase list.
</step>

<step name="arm_watchdogs">
Arm the recurring jobs of `@~/.claude/get-shit-done/references/watchdogs.md` (probe the cron tools first; log `watchdogs_unavailable` and go on when they are absent; never duplicate a job). Re-arm on resume and on expiry; disarm in `completion`.
</step>

<step name="execute_phases">
The loop. Repeat until `roadmap next` returns `done`:

```bash
NEXT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js roadmap next $LEGACY_FLAG $RETRY_PARKED_FLAG)
```
`$RETRY_PARKED_FLAG` is `--retry-parked` when it is in `$ARGUMENTS`: use it once the owner has answered what parked a phase itself; without it that phase stays parked. Dependents need no flag: `roadmap next` recomputes dependency parking from disk on every call, so a dependent runs as soon as its blocker is complete. `roadmap next` reads the log and disk truth, appends its own events and returns one action; dependencies, parking and the one-gap-cycle ceiling are its job, not yours. No action ever asks the owner anything; the only stop is `waiting_owner_approval`. A resume starts at `init execute-roadmap`: `blocked_by_owner_gate` non-null with `resume_state.status` `waiting_owner_approval` means print the same stop and end; after approval the next `roadmap next` continues.

| `action` | Do |
|---|---|
| `spawn_coordinator` | steps 1a-5 below for `phase`, using `args` and `model` |
| `gap_cycle` | the same spawn with the returned `args` (`{N} --gaps --auto`): the coordinator runs one gap-closure cycle |
| `integration_gate` | `<step name="completion">`, part A |
| `waiting_owner_approval` | end the run now: print `blocked_by_owner_gate` and `gate_status`, the owner summary from `owner-gate status`, and the command that approves it; no phase starts, nothing is logged, nothing is retried. Auto (auto_mode, references/auto-mode.md OG1/OG2/OG3): the run ends here whatever the gate (composition, roadmap or pr) |
| `pr` | `<step name="completion">`, part B |
| `done` | `<step name="completion">`, part C; `complete: false` means phases are parked (`parked`) |

**1a. Decision queue sweep (never waits; contract `@~/.claude/get-shit-done/references/decisions-protocol.md`).** Before spawning a phase:
```bash
DEC="$HOME/.claude/get-shit-done/bin/decisions.js"
test -f .planning/DECISIONS.jsonl
```
If the file exists, run each as its own command (never chained with `&&`) and read each exit code:
```bash
node "$DEC" gate --phase {phase_number}
node "$DEC" digest
node "$DEC" digest --mark-only
```
- `gate` exit 0: proceed. Exit 2 (an open irreversible assumption feeds this phase): park this phase and its dependents, every other phase continues. Log `phase_parked` with the ids and print each parked question (`decisions list --open`) to the chat; it never ends the run or blocks on a reply. A phase still parked when every other phase is done is reported in `completion` as waiting for the owner.
- `gate` exit 3 or any other non-zero code (corrupt or unreadable ledger): fail closed exactly like exit 2, with `phase_parked` reason `ledger_error` and the printed errors. `node "$HOME/.claude/get-shit-done/bin/decisions.js" validate` prints the offending lines; `decisions.js repair` fixes duplicate ids and conflict markers; re-run `gate` after.
- `digest` non-empty: print it to the chat, never wait, then run `digest --mark-only` (a run that dies in between re-sends rather than loses the questions). A non-zero `digest` exit is handled like `gate` exit 3.
- Rework tickets (`node "$DEC" reworks` prints the open `R-NN`): insert the decimal rework phase the protocol describes after its last built consumer, before continuing; `node "$DEC" close R-NN --status done` when it verifies.

**4. Spawn the coordinator (fresh context window):**

```
Agent(
  subagent_type="gsd-phase-coordinator",
  model="{coordinator_model}",
  description="Execute phase {N}",
  prompt="Execute Phase {N}: {name}
auto: true
legacy: {legacy}
Phase directory: .planning/phases/{phase_dir}/
Phase goal: {goal}
Arguments for the workflows you follow: {args}
Run discuss, plan, execute and verify as your agent file says. When context runs low, return a checkpoint with resume_from instead of finishing.
Return the structured completion JSON as the last content."
)
```
When `resumed` is true in the `next` output, prepend the resume brief from `resilience resume-brief {N}` (`brief_text`, verbatim) under a "RESUMING" preamble. Plan-shape, test and review rules are not repeated here: the planner, the plan-checker, the project's rules and execute-phase own them.

**4a. Detect coordinator death (runs before step 5's status branches):**

A genuine coordinator death differs from a normal `status: "failed"`: either the `Agent()` call itself threw, or the returned text does not parse as the status JSON (for example it IS the raw death message, such as "You've hit your session limit, resets 12:30am").

1. If the `Agent()` call threw, OR the returned text fails to parse as the status JSON contract, run:
```bash
DEATH_CHECK=$(node ~/.claude/get-shit-done/bin/gsd-tools.js resilience parse-death --text "{raw returned text or error message}")
IS_DEATH=$(node -e "console.log(JSON.parse(process.argv[1]).is_death)" "$DEATH_CHECK")
RESET_TIME_ISO=$(node -e "console.log(JSON.parse(process.argv[1]).reset_time_iso || '')" "$DEATH_CHECK")
```

2. Separately, check staleness of the phase's own CHECKPOINT.json (the threshold comes from config `resilience.staleness_threshold_minutes`):
```bash
STALENESS_CHECK=$(node ~/.claude/get-shit-done/bin/gsd-tools.js resilience check-staleness .planning/phases/{phase_dir}/CHECKPOINT.json)
IS_STALE=$(node -e "console.log(JSON.parse(process.argv[1]).stale)" "$STALENESS_CHECK")
```

3. **The coordinator is presumed dead if `IS_DEATH` is `true` OR `IS_STALE` is `true`.**

4. **If presumed dead:**
   - Log loudly:
     ```bash
     REASON=$([ "$IS_DEATH" = "true" ] && echo "death_signature" || echo "staleness")
     node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
       --type coordinator_death_detected \
       --data '{"phase": {N}, "reason": "'"${REASON}"'", "reset_time_iso": "'"${RESET_TIME_ISO}"'"}'
     ```
   - Get the resume brief before anything else:
     ```bash
     RESUME_BRIEF=$(node ~/.claude/get-shit-done/bin/gsd-tools.js resilience resume-brief {N})
     BRIEF_TEXT=$(node -e "console.log(JSON.parse(process.argv[1]).brief_text)" "$RESUME_BRIEF")
     RESUME_FROM=$(node -e "console.log(JSON.parse(process.argv[1]).resume_from)" "$RESUME_BRIEF")
     ```
     A missing CHECKPOINT.json means the coordinator died before its first checkpoint: `resume-brief` already reports `resume_from: "discuss"`; nothing special is needed beyond the loud logging.
   - **Wait-until-reset:** if `RESET_TIME_ISO` is non-empty, compute the wait and cap it at 6 hours; an implausible reset time is escalated, not slept on:
     ```bash
     NOW_EPOCH=$(date -u +%s)
     RESET_EPOCH=$(date -u -d "${RESET_TIME_ISO}" +%s 2>/dev/null || date -u -jf "%Y-%m-%dT%H:%M:%S" "${RESET_TIME_ISO%%.*}" +%s 2>/dev/null || echo "")
     MAX_WAIT_SECONDS=$((6 * 3600))
     WAIT_SECONDS=$([ -n "$RESET_EPOCH" ] && echo $((RESET_EPOCH - NOW_EPOCH)) || echo -1)
     ```
     - `WAIT_SECONDS` negative or above `MAX_WAIT_SECONDS`: log and escalate instead of hanging:
       ```bash
       node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
         --type death_reset_time_implausible \
         --data '{"phase": {N}, "reset_time_iso": "'"${RESET_TIME_ISO}"'", "wait_seconds": '"${WAIT_SECONDS}"', "cap_seconds": '"${MAX_WAIT_SECONDS}"'}'
       ```
       Print the implausible reset time to the chat and do not respawn: this phase goes to `handle_failure`.
     - Otherwise poll until the reset, then respawn:
       ```bash
       while [ "$(date -u +%s)" -lt "${RESET_EPOCH}" ]; do
         sleep 60
       done
       ```
   - **Respawn** with a fresh `Agent()` call, not a retry of the dead one: the spawn block of step 4 with `BRIEF_TEXT` prepended under a "RESUMING FROM DEATH" preamble, verbatim:
     ```
     Agent(
       subagent_type="gsd-phase-coordinator",
       model="{coordinator_model}",
       description="Execute phase {N} (auto-resume)",
       prompt="{BRIEF_TEXT}

       RESUMING FROM DEATH. {the rest of step 4's prompt body}"
     )
     ```
   - Log `auto_resume_spawned`:
     ```bash
     node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
       --type auto_resume_spawned \
       --data '{"phase": {N}, "resume_from": "'"${RESUME_FROM}"'"}'
     ```
   - After the respawn, fall through to step 5 on the NEW return value; 4a never decides a status.
   - **No human input required for this path.** Print one chat line (`Phase {N}: coordinator death detected ({REASON}), auto-resuming from {RESUME_FROM}`) and respawn.

5. **If NOT presumed dead:** go to step 5.

**5. Handle result:**

Branch on the coordinator's `status`:
- `completed`: run **5a** then **5b** first, and only after both pass hand the result to `roadmap record`.
- `completed_with_deferrals` (context limit): spawn a fresh agent for each item of `deferred`. `"execute"`: a fresh coordinator that resumes at execute (same spawn with the resume brief). `"verify"`: a fresh coordinator that resumes at `verify` (same spawn with the resume brief), so the record file, pass 2, rule 12 and the checkpoint all run. `"ui_qa"`: caught by 5a. Then 5a, 5b.
- every other status (`failed`, `blocked`, `gaps_found`, `human_needed`, or unparseable text): straight to `roadmap record`. A coordinator reports `completed` after `phase complete --form-debt` (`references/rigour.md` rule 1); `roadmap record` derives form versus product from disk and never trusts a reported `gap_kind` or `reason`. `blocked` with `reason: budget_exceeded` carries its owner report: print it.

The recording command is the only writer of a phase's completion:
```bash
REC=$(node ~/.claude/get-shit-done/bin/gsd-tools.js roadmap record --phase {N} --result '<coordinator JSON, or the raw text>')
```
It runs the on-disk truth for the phase (every plan has a SUMMARY with Self-Check passed and a tagged commit, `VERIFICATION.md` is `passed`, the ROADMAP checkbox is set by `phase complete`) and only then appends the completion event; a coordinator that says `completed` over a failed or missing verification is recorded as incomplete. Never append that event yourself with `execution-log event`: a logged claim without disk truth fails `gate pre-pr`. Branch on the returned `action`:

| `action` | Do |
|---|---|
| `complete` | print the phase report (step 6) and continue the loop |
| `gap_cycle` | continue the loop: `roadmap next` returns `gap_cycle` for this phase, once |
| `ruling` | a spike phase still has an open CRITICAL/HIGH and its one ruling dispatch was never logged: re-enter that phase's coordinator (resume brief) so it spawns the ONE ruling dispatch and logs `spike_ruling` (`references/rigour.md`, Gap closure row), then `roadmap record` again with the same result; never park before this |
| `park` | the phase and its dependents stay parked (K4): Auto (auto_mode, references/auto-mode.md K4): park, print the reason (human items, product gaps after the closure cycle, or a budget breach) to the chat, continue with independent phases; it ends the run with no PR, loudly, in `completion` |
| `complete_form_debt` | disk shows only form errors, no missing work: run the returned `command` (`phase complete {N} --form-debt`, which records the debt in VERIFICATION frontmatter), then `roadmap record` again with `{"status":"completed"}`; nothing is parked, no gap cycle runs. `gate pre-pr` and the `done` summary list every phase's recorded `form_debt` from disk |
| `spawn_deferred` | the deferrals above |
| `respawn_death` | step 4a |
| `retry` with `reason: verifier_omission` | a spike VERIFICATION lacks `criteria_decided` (or `headline`), fields only the verifier writes: a gap cycle cannot fix them, so re-enter that phase's coordinator at `verify` (`resume_step`) to re-spawn the verifier ONCE, then `roadmap record` again; a second omission in the same window goes to the gap path |
| `retry`, `debug` | `<step name="handle_failure">` |
| `fail` | `<step name="handle_failure">` (escalated: dependents are skipped, the run goes on with independent phases) |

Also read `deferred-items.md` in the phase directory if present and print it. Auto (auto_mode, references/auto-mode.md K5): a deferred item is fixed in this phase through the gap cycle, else it parks the phase (K4); never wave it through.

**5a. UI QA gate (BLOCKING, owned by the orchestrator, not the coordinator):**

Use the deterministic, git-diff-derived phase gate, never a markdown self-report scan:
```bash
PHASE_GATE_RESULT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js verify phase-gate {N})
NEEDS_QA=$(node -e "console.log(JSON.parse(process.argv[1]).ui_qa_required === true ? 'true' : '')" "$PHASE_GATE_RESULT")
```
`ui_qa_required` is `has_ui` (a phase without UI never requires it) and the UI-QA mode is not `none`. Mode `none` means `stack.capabilities` is an object whose keys are all known and that has no `ui_qa` key; any other case (no capabilities object, a `ui_qa` key, an unknown key) is required, and `ui_qa_mode: legacy` (no `stack.capabilities`) resolves the project's configured QA agent. It is computed from the files the phase touched (UI by extension and route path; tests and docs excluded; `has_api` is reported but never gates QA), independent of what any PLAN or SUMMARY self-reports.

**If `NEEDS_QA` is non-empty** and the phase-gate `failures` contain `missing_charlotte_qa`: the evidence `ui_qa_ran: true` is missing from `{N}-VERIFICATION.md` frontmatter. Run UI QA now:
1. Start the services (`gsd-tools service-health start default`; the startup recipe is in the project's CLAUDE.md or `stack.services`) and the project's suite-start reset, before the UI QA agent spawns.
2. Spawn the UI QA agent (`stack.capabilities.ui_qa.agent`; legacy: the project's configured QA agent) with `mode=ui-qa` on the phase's pages.
3. Critical or high issues: a fix agent, then re-run (at most 3 rounds). All regression-tagged scenarios must pass.
4. Re-spawn `gsd-verifier` so it re-issues `{N}-VERIFICATION.md` with `ui_qa_ran: true` (never hand-edit the frontmatter), re-run `verify phase-gate`, then 5b.

If the services will not start after the project's startup recipe: Auto (auto_mode, references/auto-mode.md K4): this is a human-only blocker; record the phase as `human_needed` through `roadmap record` and park it. If UI QA genuinely cannot run and proceeding is a deliberate decision, `gsd-tools deferred add {N} --step ui_qa --reason <reason> --approver <approver>` records the waiver; never set `ui_qa_ran: true` for QA that did not happen.

**Why the orchestrator owns this gate:** a coordinator that overflows context drops UI QA as a late step. This runs after it returns, so overflow cannot bypass it.

**5b. Cross-phase integration checkpoint (every phase, no condition):**

1. Run the unit and integration tests through the profile's commands (`stack_commands.test_all`, `stack_commands.test_file` on each integration test file the phase touched).
2. If the phase touched frontend files: `stack_commands.frontend_test` and `stack_commands.build`.
3. Every entry of `stack.gates[]` that needs no extra running stack.

Run only the commands the profile defines; a missing command is skipped, not an error. Any failure: log `integration_test_failure`, then record it as a failed phase so the ladder decides (`roadmap record --phase {N} --result '{"status":"failed","error":"integration_test_failure","step":"integration"}'`); never move to the next phase on a red gate. On green:
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type cross_phase_integration \
  --data '{"phase": {N}, "tests_passed": true, "timestamp": "..."}'
```

**6. Phase report:** print `Phase {N} complete: {name}` with the plans executed, the duration and the first non-blank, non-heading line of the phase SUMMARY; name the next phase if any. Remove ephemeral checkpoint files; keep the SUMMARYs and the log.
</step>

<step name="handle_failure">
**Scope note:** `handle_failure` is entered ONLY for genuine `status: "failed"` task-logic failures. A detected coordinator death (session or quota limit, or CHECKPOINT.json staleness) is handled entirely by step 4a and never reaches this ladder: a death retried immediately here would die again before the reset. The one exception is an implausible reset time, which 4a sends here for visibility.

`roadmap record` already logged the failure (`phase_retry` or `phase_failed`) and applied the deterministic ladder, which is `gsd-tools execution-state record-failure --phase {N} --error "{error}" --step "{step}" --files "{files}" --raw` at phase granularity (no `--plan`). Auto (auto_mode, references/auto-mode.md K5): follow the returned `action`; there is no retry/skip/stop choice for a human:

- **"retry"** (first failure): re-run the phase fresh; `roadmap next` returns it again. No prompt.
- **"debug"** (second failure only, below the ceiling): spawn `@~/.claude/get-shit-done/workflows/debug.md` non-interactively (`symptoms_prefilled: true, interactive: false, goal: find_and_fix`) with the phase-level context from `FAILURE.md` (error, last completed step, files touched) and `debug_file: .planning/debug/phase-{N}-attempt{attempts}.md`, then let `roadmap next` return the phase again.
- **"escalate"** (a failure after the one debug, or the ceiling; NEVER another debug attempt; `roadmap record` returns it as `fail`): hard stop for this phase. Append the debugger's findings (the latest `.planning/debug/phase-{N}-attempt*.md`) to the chat and to `FAILURE.md`. The phase is failed, its dependents are skipped, the roadmap continues with independent phases. Never block on a reply.

On success at any branch, `roadmap record` calls `execution-state record-success --phase {N}` itself.

Report the failure in the chat: phase, error, last step and, if escalated, the debugger findings. Write `.planning/phases/{phase_dir}/FAILURE.md` with the error, last step, files touched, suggested fixes and (when escalated) the findings.
</step>

<step name="resume_capability">
If `resume_state` is set (a previous run was interrupted): `{completed_phases, started_incomplete, parked}`, computed from the log intersected with on-disk truth.

Auto (auto_mode, references/auto-mode.md K2): resume. Never restart; restart overwrites EXECUTION_LOG.md and discards completed-phase history. Log it:
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type autonomous_resume_auto_selected \
  --data '{"phase": "{resume_state.phase}", "phase_name": "{resume_state.phase_name}", "status": "{resume_state.status}", "reason": "auto_mode: resumed, never restarted"}'
```

Otherwise (interactive) show the interrupted run (last phase started, status, `.planning/EXECUTION_LOG.md`) and ask `Type "resume", "restart" (overwrites the log) or "stop".`

**Resume flow:** nothing is replayed from the log by hand. `roadmap next` skips every phase whose on-disk truth is complete, re-enters each started-but-incomplete phase through its own CHECKPOINT.json `resume_from` (the spawn carries the resume brief), and keeps a phase that was itself parked parked unless `--retry-parked` was passed.
</step>

<step name="completion">
Reached when `roadmap next` returns `integration_gate`, `pr` or `done`.

**A. Pre-PR quality gates** (`integration_gate`). Skip when `CURRENT_BRANCH` is the base branch (no PR from it; record `pr` as skipped in part B).
```bash
GATE_RESULT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr)
```
Parse the JSON. If `action_required` is true: run EVERY check listed in `checks`; each must exit 0; run the full suite TWICE and both runs must be green (PR-time only; within phases one full run of every gate in `stack.gates[]` and `stack.commands.pre_pr_gate` per phase on the final tree; see gsd-test-protocol.md `test_cost_rule`). Then mark the gate:
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr --mark-passed
```
`EXECUTION_LOG.md` and the phase `CHECKPOINT.json` / `TASK-CHECKPOINT.json` are run state: `git-status-clean` ignores them and nothing commits them for the gate. Any check failing: stop, fix the failure, re-run from the beginning. There is no bypass; `--mark-passed` writes the marker to EXECUTION_LOG.md that the `pr` action requires, and `gate pre-pr` run again afterwards prints `"passed": true`.

**E2E regression gate:** runs only when `stack.capabilities.ui_qa` and at least one `stack.services[].launch` command exist. Start the services, run the UI QA regression command; every regression-tagged test must pass; on failure spawn a debug agent, fix, re-run (at most 3 attempts), and a red gate parks the run with the failure in the report. Demos follow `@~/.claude/get-shit-done/workflows/demo.md` section 2 for each phase of this run whose `*-DEMO.md` says `demo_recorded: false` (skip when `demo.mode` is `off`); a demo that cannot be recorded is reported, not blocking.

**B. Pull request** (`pr`). `roadmap next` returns `base_branch` and `has_remote`.
   - No remote, no `gh`, or `base_branch` null: skip it, not a failure. `roadmap record --kind pr --result '{"status":"skipped","reason":"no_remote"}'` (or `no_gh`, `no_base_branch`), and report the reason.
   - Otherwise:
     ```bash
     git push -u origin "{CURRENT_BRANCH}"
     gh pr create --base "{base_branch}" --title "feat: {roadmap_name}" --body "{summary of completed phases, one line each from the SUMMARYs; the phases parked, if any}"
     ```
     Auto (auto_mode, references/auto-mode.md OG3): open it as a draft (`gh pr create --draft`) when the host allows, and never merge it, never enable auto-merge, never approve it. On success record `roadmap record --kind pr_requested --result '{"status":"created","url":"{PR_URL}"}'` (this writes the `pr` owner gate), print `PR opened: {PR_URL}`, and end the run `waiting_owner_approval`. The owner approves with `gsd-tools owner-gate approve --kind pr` and re-runs; `roadmap next` then returns `done` and part C records completion. Interactive runs record `--kind pr --result '{"status":"created"}'` as before.
     A failed `gh pr create` (auth, remote) is logged visibly and recorded as `{"status":"skipped","reason":"pr_create_failed"}`; the summary is not aborted.

Interactive: the loop then asks `roadmap next` again and gets `done`. Auto: the run ended at the `pr` owner gate above; the resumed run gets `done` only after approval.

**C. On `done`**

1. Log the end of the run (the orchestrator is the only writer of this event):
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type roadmap_complete \
  --data '{"completed_phases": [...], "parked_phases": [...], "complete": true|false, "timestamp": "..."}'
```
`complete: false` means phases are parked or failed; there is then no PR and no milestone audit. A later run picks them up with `/gsd:execute-roadmap --auto --retry-parked` once the blocker is answered.

2. **Milestone audit (MANDATORY when `complete` is true):**
```
Agent(
  subagent_type="general-purpose",
  model="{ruling_model}",
  description="Milestone audit",
  prompt="Execute the audit-milestone workflow from @~/.claude/get-shit-done/workflows/audit-milestone.md end-to-end for the current milestone. Return its status and gap list."
)
```
A rejected spawn retries once on `{ruling_model_fallback}`. Include the audit status and gaps in the summary: `gaps_found` leads to `/gsd:plan-milestone-gaps`, not `/gsd:complete-milestone`.

3. **Analytics report** (best-effort):
```bash
ANALYTICS_REPORT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js analytics report 2>/dev/null || echo "Analytics report unavailable")
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event --type analytics_report --data '{"auto_generated": true}' 2>/dev/null || true
echo "=== Analytics Report ==="; echo "$ANALYTICS_REPORT"
```

4. **Completion summary** (print to the chat):
```
## Roadmap Execution {Complete | Stopped with parked phases}

**Phases completed:** {N}/{total}
**Parked or failed:** {list, each with its reason and what the owner must answer}
**PR:** {url | skipped: reason}

### What was built
{one line per completed phase from its SUMMARY}

### Next steps
- PR: wait for CI, then /gsd:complete-milestone
- Parked: answer the listed questions, then /gsd:execute-roadmap --auto --retry-parked
```
A run that ends parked is the intended unattended outcome and must be loud here.

5. **Disarm watchdogs:** `CronDelete` the jobs armed in `arm_watchdogs` (keep them until release finishes if the milestone close runs in this session). Skip when they were never armed.

6. **Clean up:** remove ephemeral checkpoint files; keep EXECUTION_LOG.md.
</step>

</process>

<context_efficiency>
Orchestrator: about 10-15% context. Each phase coordinator gets a fresh window. The execution log is the only shared state, JSONL for streaming append without full-file reads.
</context_efficiency>

<failure_handling>
- **ROADMAP.md missing:** error immediately, no execution.
- **Coordinator fails:** the deterministic ladder of `handle_failure`; partial state is preserved on disk.
- **Dependency chain breaks:** a failed or parked phase blocks only its dependents; independent phases continue.
- **Interrupted run:** re-run `/gsd:execute-roadmap`; `roadmap next` resumes from disk truth and the log.
- **All phases fail:** a systemic issue: stop, report, suggest investigation.
- **classifyHandoffIfNeeded false failure:** an agent reports failed but the error is a runtime bug: spot-check SUMMARY.md and the commits; if they pass, treat it as success.
</failure_handling>

<parallel_execution>
`roadmap next` returns one phase at a time and `parallel_opportunities` is always empty: the run is sequential. Parallelism between independent phases is the project's decision (its CLAUDE.md or rules set the ceiling and the file-claim protocol); never run two coordinators in one phase.
</parallel_execution>
