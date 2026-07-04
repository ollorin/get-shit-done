<purpose>
Debug issues using scientific method with subagent isolation. This workflow is the orchestrator: gather symptoms, spawn `gsd-debugger`, handle checkpoints, spawn continuations. `gsd-debugger` does the actual investigation (fresh 200k context, scientific method, persistent `.planning/debug/{slug}.md` session state) — this workflow never investigates directly.

Supports two callers:
- **Interactive** — `/gsd:debug` (a human is present, answers questions, approves checkpoints).
- **Non-interactive (autonomous auto-spawn)** — `execute-phase.md`'s "Handle failures" step and `execute-roadmap.md`'s `handle_failure` step, after a 2nd (or later, below-ceiling) execution failure. No human is present; symptoms arrive pre-filled and checkpoints are handled without prompting.
</purpose>

<inputs>
Callers set these via the prompt/context passed into this workflow:

- **`mode.interactive`** (`true|false`, default `true`) — When `false`, a `## CHECKPOINT REACHED` of type `human-verify` is auto-approved (no user prompt, no waiting). A checkpoint of type `human-action` or `decision` genuinely requires a human and CANNOT be auto-approved — treat it as `## INVESTIGATION INCONCLUSIVE` and return immediately so the caller can escalate rather than hang.
- **`mode.symptoms_prefilled`** (`true|false`, default `false`) — When `true`, symptoms are supplied by the caller via the `symptoms` input below instead of gathered interactively.
- **`mode.goal`** (`find_and_fix|find_root_cause_only`, default `find_and_fix`) — passed straight through to `gsd-debugger`.
- **`symptoms`** — `{expected, actual, errors, reproduction, timeline}`. Required when `mode.symptoms_prefilled` is `true`.
- **`debug_file`** — caller-supplied path, e.g. `.planning/debug/{phase}-{plan}-attempt{N}.md`, used in place of a slug derived from free-text user input. Optional for interactive use (falls back to a slug generated from `issue_description`); effectively required for non-interactive auto-spawn callers so retry attempts don't collide on the same session file.
- **`issue_description`** (`$ARGUMENTS` in interactive use) — raw issue text. Used to derive a slug (when `debug_file` is not supplied) and as the investigation trigger summary.

Preserve the existing session-resume behavior (`ls .planning/debug/*.md`) for interactive use — non-interactive callers always start a fresh session at their caller-supplied `debug_file` path and never resume.
</inputs>

<process>

<step name="initialize" priority="first">
```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" state load)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Extract `commit_docs` from init JSON. Resolve debugger model:
```bash
debugger_model=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" resolve-model gsd-debugger --raw)
```
</step>

<step name="check_active_sessions">
**Only when `mode.interactive` is `true`.** Non-interactive callers skip this step entirely — they always start fresh at their supplied `debug_file` path.

```bash
ls .planning/debug/*.md 2>/dev/null | grep -v resolved | head -5
```

If active sessions exist AND no `issue_description`:
- List sessions with status, hypothesis, next action
- User picks a number to resume OR describes a new issue

If `issue_description` is provided OR user describes a new issue:
- Continue to `gather_symptoms`
</step>

<step name="gather_symptoms">
**Skip entirely when `mode.symptoms_prefilled` is `true`** — go directly to `spawn_debugger` using the caller-supplied `symptoms` input.

Interactive gathering (via `AskUserQuestion`), one question per field:

1. **Expected behavior** — What should happen?
2. **Actual behavior** — What happens instead?
3. **Error messages** — Any errors? (paste or describe)
4. **Timeline** — When did this start? Ever worked?
5. **Reproduction** — How do you trigger it?

After all gathered, confirm ready to investigate.
</step>

<step name="spawn_debugger">
Compute the debug session path:
- If `debug_file` was supplied by the caller, use it verbatim.
- Otherwise, derive a slug from `issue_description` (lowercase, hyphens, max 30 chars) and use `.planning/debug/{slug}.md`.

Fill the prompt and spawn:

```markdown
<objective>
Investigate issue: {slug_or_debug_file}

**Summary:** {issue_description or symptoms.expected/actual summary}
</objective>

<symptoms>
expected: {symptoms.expected}
actual: {symptoms.actual}
errors: {symptoms.errors}
reproduction: {symptoms.reproduction}
timeline: {symptoms.timeline}
</symptoms>

<mode>
symptoms_prefilled: {mode.symptoms_prefilled}
goal: {mode.goal}
</mode>

<debug_file>
Create: {debug_file_path}
</debug_file>
```

```
Task(
  prompt=filled_prompt,
  subagent_type="gsd-debugger",
  model="{debugger_model}",
  description="Debug {slug_or_debug_file}"
)
```
</step>

<step name="handle_return">
Branch on the agent's structured return.

**If `## ROOT CAUSE FOUND`:**
- **Interactive:** Display root cause and evidence summary. Offer options: "Fix now" (spawn fix subagent), "Plan fix" (suggest `/gsd:plan-phase --gaps`), "Manual fix" (done).
- **Non-interactive:** Return the root cause + evidence summary verbatim to the caller. The caller (execute-phase.md/execute-roadmap.md) decides what happens next (re-spawn the plan/phase executor).

**If `## CHECKPOINT REACHED`:**
- **Interactive (`mode.interactive: true`):** Present checkpoint details to the user. Get a response. If type is `human-verify`: user confirms fixed → continue so the agent can finalize/resolve/archive; user reports issues → continue so the agent returns to investigation/fixing. Spawn a continuation agent (see `spawn_continuation`) with the user's response.
- **Non-interactive (`mode.interactive: false`):**
  - **Type `human-verify`:** Auto-approve — do NOT prompt anyone. Log: `"auto-approved checkpoint during autonomous debug"`. Immediately spawn a continuation agent (see `spawn_continuation`) with `user_response: "approved"`.
  - **Type `human-action` or `decision`:** Cannot be auto-approved (genuinely requires a human — e.g. OAuth, an ambiguous investigation-direction choice). Do NOT wait/hang. Treat this exactly as `## INVESTIGATION INCONCLUSIVE` and return immediately, so the caller can escalate through its own path (debugger findings are still attached — surface the checkpoint's investigation state and details as the "what was checked"/"recommendation" content).

**If `## INVESTIGATION INCONCLUSIVE`:**
- **Interactive:** Show what was checked and eliminated. Offer options: "Continue investigating" (spawn new agent with additional context), "Manual investigation" (done), "Add more context" (gather more symptoms, spawn again).
- **Non-interactive:** Return the full "what was checked" / "hypotheses eliminated" / "remaining possibilities" content verbatim to the caller — this is the "debugger's findings" the caller's escalation path attaches to its own user-facing message.
</step>

<step name="spawn_continuation">
When a response to a checkpoint is available (user-provided in interactive mode, or auto-approved in non-interactive mode), spawn a fresh agent — never resume:

```markdown
<objective>
Continue debugging {slug_or_debug_file}. Evidence is in the debug file.
</objective>

<prior_state>
<files_to_read>
- {debug_file_path} (Debug session state)
</files_to_read>
</prior_state>

<checkpoint_response>
**Type:** {checkpoint_type}
**Response:** {user_response}
</checkpoint_response>

<mode>
goal: {mode.goal}
</mode>
```

```
Task(
  prompt=continuation_prompt,
  subagent_type="gsd-debugger",
  model="{debugger_model}",
  description="Continue debug {slug_or_debug_file}"
)
```

After the continuation agent returns, go back to `handle_return` with its new structured return.
</step>

</process>

<success_criteria>
- [ ] Active sessions checked (interactive mode only)
- [ ] Symptoms gathered (interactive, new issue) or consumed from caller input (`symptoms_prefilled: true`)
- [ ] `gsd-debugger` spawned with full context (symptoms, mode, debug_file)
- [ ] Checkpoints handled correctly for both interactive and non-interactive callers — non-interactive `human-action`/`decision` checkpoints never hang, they return as `INVESTIGATION INCONCLUSIVE` immediately
- [ ] Root cause confirmed (or investigation inconclusive) before reporting back to the caller
</success_criteria>
