# gsd-phase-coordinator.md — Execution Cycle Detail (Phase 53-02, MILE-30)

This file holds the FULL, VERBATIM `<execution_cycle>` block relocated from
`agents/gsd-phase-coordinator.md` during the MILE-30 hard-rules-first
restructuring. Every step (discuss, research, plan, execute, verify,
cross_phase_integration), the context-budget-monitoring logic, and the
checkpoint_ui_qa_loop / detect_web_framework / post_phase_ux_sweep /
post_phase_e2e sub-steps are relocated here byte-for-byte -- nothing was
reworded, summarized, or deleted.

Several HARD RULE / MUST / CRITICAL statements embedded within these steps
are ALSO quoted verbatim in the core preamble of `gsd-phase-coordinator.md`
(in its `<hard_rules_digest>` section) so they surface early in the prompt
instead of being buried at token position ~14k. That digest is a SURFACING
aid, not a replacement -- the authoritative, complete procedural context for
every rule still lives here, in its original place, unchanged.

---

<execution_cycle>

Initialize:
```
telegram_topic_id = {value from prompt if provided, else null}
// All mcp__telegram__send_message and mcp__telegram__send_status_update calls
// below pass thread_id: telegram_topic_id (omit parameter if null)
```

// Parent coordinator passes telegram_topic_id in the prompt:
// "telegram_topic_id: {telegram_topic_id}" or "telegram_topic_id: null"

// Helper: append_notification_log(event, data)
// After EVERY mcp__telegram__send_message call that is a lifecycle notification
// (NOT escalation calls — those already log via the escalation block):
//   Append JSON line to .planning/telegram-sessions/{YYYY-MM-DD}.jsonl
//   Format: {"type":"notification","event":"{event}","timestamp":"{ISO}","phase":{N},...extra_data}
//   Create the file if it does not exist. Use current date for filename.

**Notification 1 — Phase start** (fires immediately after initialization, before any step):

```
if telegram_topic_id is not null:
  mcp__telegram__send_message({
    text: "Phase {phase_number} started: {phase_name}",
    ...(telegram_topic_id ? { thread_id: telegram_topic_id } : {})
  })
  // JSONL: {"type":"notification","event":"phase_start","timestamp":"{ISO}","phase":{N},"phase_name":"{name}"}
  // Append above line to .planning/telegram-sessions/{YYYY-MM-DD}.jsonl
```


<context_budget_monitoring>

## Context Budget Monitoring

Monitor context window usage at the start of each major step. Initialize these state variables once:

```
COMPRESSED_MODE_THRESHOLD = 0.60   // 60% -- switch to compressed output mode
FRESH_SUBAGENT_THRESHOLD = 0.80    // 80% -- consider fresh subagent for verifier
compressed_mode_notified = false   // track whether 60% notification was sent
fresh_subagent_notified = false    // track whether 80% notification was sent
context_budget_pct = 0.0           // current estimated usage percentage
```

**How to estimate context usage:**

Claude Code reports context window usage in the environment. Check it at the start of each major step (harvest_knowledge, discuss, research, plan, execute each plan, verify). If the runtime does not expose this directly, use a conservative heuristic: estimate 5-10% per major step completed.

**Compressed mode (at >= 60% context usage):**

When context_budget_pct >= COMPRESSED_MODE_THRESHOLD:
- Switch to terse output: use bullet points only, skip verbose reasoning narration
- Omit intermediate planning commentary -- act and report results concisely
- Skip optional diagnostic log messages
- Send ONE Telegram notification (on first threshold crossing only):

```
if context_budget_pct >= COMPRESSED_MODE_THRESHOLD AND NOT compressed_mode_notified:
  if telegram_topic_id is not null:
    mcp__telegram__send_message({
      text: "Phase {phase_number}: context at {usage_pct}% -- switching to compressed mode",
      ...(telegram_topic_id ? { thread_id: telegram_topic_id } : {})
    })
  compressed_mode_notified = true
  // Log to JSONL: {"type":"context_budget","event":"compressed_mode","timestamp":"{ISO}","phase":{N},"usage_pct":{usage_pct}}
```

**Fresh-subagent consideration (at >= 80% context usage):**

When context_budget_pct >= FRESH_SUBAGENT_THRESHOLD:
- Before spawning the verifier: create a compact handoff summary containing: phase goal, key decisions made, tasks completed, files modified
- Pass this handoff summary in the verifier subagent prompt so the verifier has full context without relying on the coordinator context window
- Send ONE Telegram notification (on first threshold crossing only):

```
if context_budget_pct >= FRESH_SUBAGENT_THRESHOLD AND NOT fresh_subagent_notified:
  if telegram_topic_id is not null:
    mcp__telegram__send_message({
      text: "Phase {phase_number}: context at {usage_pct}% -- passing handoff summary to verifier",
      ...(telegram_topic_id ? { thread_id: telegram_topic_id } : {})
    })
  fresh_subagent_notified = true
  // Log to JSONL: {"type":"context_budget","event":"fresh_subagent","timestamp":"{ISO}","phase":{N},"usage_pct":{usage_pct}}
  // Build handoff_summary:
  handoff_summary = """
  Phase {phase_number}: {phase_name}
  Goal: {phase_goal}
  Steps completed: {steps_completed}
  Key decisions: {key_decisions_from_CONTEXT.md}
  Files modified: {files_modified_so_far}
  """
```

**Handoff summary injection in verifier spawn:**

When spawning the verifier subagent (verify step), if fresh_subagent_notified is true:
- Append the handoff_summary to the verifier prompt under a <context_handoff> tag
- This ensures the verifier has all required context even when spawned from a nearly-full coordinator context window

**Non-fatal for monitoring itself.** But context budget DOES affect execution policy:

**At >= 80%: Return early with structured checkpoint instead of risking overflow.**

If you reach 80% context and have NOT yet completed the verify step:
1. Write CHECKPOINT.json with `resume_from: "verify"` (or whatever step is next)
2. Set `charlotte_qa_ran: false` in CHECKPOINT.json if Charlotte was not run
3. Return to orchestrator with `status: "completed_with_deferrals"` and include in the return:
   ```json
   {
     "status": "completed_with_deferrals",
     "deferred": ["verify", "charlotte_qa"],
     "reason": "context_budget_exceeded",
     "handoff_summary": "..."
   }
   ```
4. The orchestrator will spawn fresh agents for the deferred steps

**Phase-gate authority note:** These deferred steps (`verify`, `charlotte_qa`) are picked up by a fresh subagent within this same execution — this is a handoff, not a permanent skip. If a fresh subagent also cannot complete them and the team decides to accept a genuinely missing artifact, that IS a mandatory-step skip and requires `gsd-tools.js deferred add {phase} --step <step> --reason <reason> --approver <approver>` as part of that decision, never silently accepted. Separately: the orchestrator's `verify phase-gate {phase}` call (execute-phase.md's `pre_verify_gates` step, run after this coordinator returns) is the blocking authority for artifact EXISTENCE (test files, Charlotte QA evidence, docs commit, E2E-TEST-PLAN.md, VERIFICATION.md) — this coordinator's own `charlotte_qa_ran` tracking remains a useful early self-check but is not the final word.

**Do NOT try to power through the remaining steps at 80%+.** Overflowing mid-verify or mid-Charlotte produces incomplete artifacts that the orchestrator accepts as valid. Returning early with explicit deferrals is always better than silent truncation.

If usage cannot be determined, default to 0% and proceed normally.

</context_budget_monitoring>

<step name="harvest_knowledge">
Mine recent Claude Code sessions for decisions and reasoning before planning begins.

```bash
HARVEST=$(node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js \
  mine-conversations --all-projects --max-age-days 3 --limit 5 2>/dev/null || echo '{"status":"error"}')
```

Parse HARVEST JSON. Extract `status`, `sessionsReady`, `sessions`.

**If `status === 'error'` or `sessionsReady === 0`:** Log "Knowledge harvest: no new sessions" and continue to discuss step.

**Otherwise:** For each session in `sessions` (process sequentially):

1. For each item in `session.extractionRequests` (up to 3 — decision, reasoning_pattern, meta_knowledge):

   ```
   Agent(
     subagent_type="general-purpose",
     model="haiku",
     description="Extract {item.type}",
     max_turns=15,
     prompt="{item.prompt}"
   )
   ```

   Collect Haiku output text. If Agent() throws or returns empty, skip this extraction type and continue.

2. Assemble results array from successful outputs:
   ```json
   [
     {"type": "decision", "result": "{haikuOutput1}"},
     {"type": "reasoning_pattern", "result": "{haikuOutput2}"},
     {"type": "meta_knowledge", "result": "{haikuOutput3}"}
   ]
   ```

3. Store results:
   ```bash
   node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js \
     store-conversation-result "{session.sessionId}" '{resultsJson}' \
     --content-hash "{session.contentHash}"
   ```

   Log: "Harvested {session.sessionId}: {stored} stored, {evolved} evolved, {skipped} skipped"

**Non-fatal:** If any session fails entirely, log the error and continue to the next session. If the whole step fails, log and proceed to discuss step — never block the phase lifecycle.
</step>

<step name="discuss">
Check if phase already has a CONTEXT.md (meaning discussion was already done):

```bash
ls .planning/phases/{phase_dir}/*-CONTEXT.md 2>/dev/null || echo "NO_CONTEXT"
```

<!-- SKIP PATH: CONTEXT.md exists — discussion already done -->
**If CONTEXT.md exists:** Skip discuss step. Create checkpoint with status: "skipped". Log: "Discuss step skipped — CONTEXT.md exists". Proceed directly to the research step.

```json
{
  "phase": {N},
  "step": "discuss",
  "status": "skipped",
  "timestamp": "...",
  "files_created": [],
  "context_file": null
}
```

After creating the skipped checkpoint, send context_ready notification (skip variant):

```
if telegram_topic_id is not null:
  mcp__telegram__send_message({
    text: "Phase {phase_number} context ready — CONTEXT.md already exists (discuss step skipped)",
    ...(telegram_topic_id ? { thread_id: telegram_topic_id } : {})
  })
  // JSONL: {"type":"notification","event":"context_ready","timestamp":"{ISO}","phase":{N},"autonomous_count":0,"escalated_count":0,"skipped":true}
  // Append above line to .planning/telegram-sessions/{YYYY-MM-DD}.jsonl
```

<!-- RUN PATH: No CONTEXT.md — run gray-area identification -->
**If no CONTEXT.md:** Run gray-area identification (see below), then proceed to question generation (Plan 22-02 adds that step).

**Gray-area identification:**

1. Read the phase entry from ROADMAP.md to get the goal, requirements, and success criteria:
```bash
node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js roadmap get-phase {phase_number}
```

2. Analyze the phase domain using these heuristics to determine what type of phase this is:
   - **What is this phase delivering?** (capability type: agent, CLI command, workflow, schema, etc.)
   - **For agent phases** → interface contracts, behavior modes, error handling, output format matter
   - **For CLI phases** → flag design, output format, error recovery, verbosity matter
   - **For workflow phases** → step sequencing, skip conditions, state persistence, failure handling matter
   - **For schema/data phases** → field choices, relationships, migration behavior, naming conventions matter

3. Produce a list of 3-5 **phase-specific** gray areas. Each gray area must be:
   - A concrete named area (NOT generic: not "UI", "Behavior" — specific: "Answer confidence threshold", "CONTEXT.md section structure")
   - Named after the actual implementation concern it represents
   - Distinct from the others (no overlapping scope)

   Example output format:
   ```
   Gray areas identified:
   1. CONTEXT.md section structure — what sections, ordering, and field names the output file uses
   2. Confidence threshold for autonomous vs escalated answers — numeric cutoff and how it is measured
   3. Question generation scope — how many questions per gray area and how to avoid redundant questions
   ```

4. Store identified gray areas in a variable for the question generation step.

**Question generation:**

For each gray area identified above, generate 10-20 concrete, answerable questions. These questions will be used to query the knowledge DB — they must be specific enough to retrieve relevant stored decisions and context.

**Question generation strategy (Claude reasoning inline — no subagent spawn):**

For each gray area:
1. Start from the gray area name and the phase goal/requirements read in step 1 above
2. Ask internally: "What specific implementation decision within this gray area could go multiple ways?"
3. Generate questions at 3 specificity levels:
   - **high**: Pattern/approach question — "Should X run inline in the coordinator or spawn a subagent?"
   - **mid**: Specific parameters question — "What is the minimum confidence score to mark an answer as sufficient?"
   - **low**: Edge case question — "What happens when the knowledge DB has no results for a question?"
4. Target scale: simple gray areas → 10 questions, complex gray areas → 20 questions

**Question output format:**

Produce a `questions` array in this structure:
```
questions = [
  {
    gray_area: "Answer confidence threshold",
    question: "What confidence score threshold should mark a meta-answerer response as sufficient vs needs-escalation?",
    specificity: "mid"
  },
  {
    gray_area: "Answer confidence threshold",
    question: "Should the confidence threshold be a fixed value or configurable per phase type?",
    specificity: "high"
  },
  {
    gray_area: "Answer confidence threshold",
    question: "What happens when all questions for a gray area score below the confidence threshold?",
    specificity: "low"
  },
  ...
]
```

Store the full `questions` array in a variable for the meta-answerer invocation step.

**Create checkpoint after question generation:**
```json
{
  "phase": {N},
  "step": "discuss",
  "status": "questions_generated",
  "gray_areas": ["area1", "area2", "area3"],
  "question_count": 47,
  "timestamp": "..."
}
```

**Spawn meta-answerer to answer questions:**

```
Agent(
  subagent_type="gsd-meta-answerer",
  model="haiku",
  description="Answer phase {phase_number} questions",
  max_turns=15,
  prompt="
    <phase_context>
    Phase: {phase_number}
    Goal: {phase_goal}
    Requirements: {requirements_list}
    </phase_context>

    <questions>
    {questions_json_array}
    </questions>
  "
)
```

Parse the returned JSON response from the Agent() call — the `answers` array and `stats` object per the gsd-meta-answerer output format.

**Answer evaluation logic:**

Confidence threshold: `0.7` — answers at or above 0.7 are marked `sufficient`; below 0.7 are marked `needs-escalation`.

For each answer in the answers array:
- If `answer.confidence >= 0.7` AND NOT `answer.no_results`: mark as `sufficient`
- If `answer.confidence < 0.7` OR `answer.no_results`: mark as `needs-escalation`
- If `answer.error` is present: mark as `needs-escalation`

Group results:
```
sufficient_answers = answers where evaluation == "sufficient"
escalation_needed = answers where evaluation == "needs-escalation"
```

**Sensitivity check for escalation:**

Before escalating any needs-escalation item to Telegram, evaluate it against six sensitivity criteria. Only escalate if ANY criterion is true:

1. **Irreversible change** — Would implementing this answer result in a change that cannot be undone without significant effort? (e.g., deleting data, migrating schema, public API contract)
2. **>1 phase rework risk** — If wrong, would this require reworking more than one future phase?
3. **Major architectural decision** — Does this affect the overall system design, component boundaries, or data model in a non-trivial way?
4. **Money/data loss potential** — Could a wrong decision lead to loss of user data, financial charges, or security breach?
5. **Conflicting KB signals** — Do the knowledge DB results for this question directly contradict each other (different answers with similar confidence)?
6. **Always-ask topic** — Does the question involve a topic the user has previously indicated they always want to decide personally?

For each item in `escalation_needed`:
- Apply the six criteria above based on the question text, gray_area, and answer.confidence
- If NO criterion matches → move to Claude's Discretion (confidence >= 0.4 already handled by existing logic)
- If ANY criterion matches → mark as `sensitive_escalation: true`

Produce:
```
sensitive_items = escalation_needed items where sensitive_escalation == true
discretion_items = escalation_needed items where sensitive_escalation == false
```

**Escalate sensitive items via Telegram (multi-turn loop with JSONL logging):**

For each item in `sensitive_items`, run a multi-turn follow-up loop:

Read the escalation timeout from `.planning/config.json`'s `telegram.escalation_timeout_minutes` field (default: 30 if the file is missing, unparseable, or the key is absent). Use this value as `escalation_timeout_minutes` for every `ask_blocking_question` call in this loop (replacing the previously hardcoded `timeout_minutes: 30`).

Initialize loop state: `turn = 1`, `max_turns = 3`, `sufficient = false`, `question_text = item.question`.

Update session status to 'waiting' once before the loop begins:
```
mcp__telegram__update_session_status({ status: "waiting", question_title: item.question.slice(0, 50) })
```

**Loop (repeat while sufficient == false AND turn <= max_turns):**

**Step A — Send question and receive reply:**
Call ask_blocking_question — this BLOCKS until the user replies:
```
reply = mcp__telegram__ask_blocking_question({
  question: question_text,
  context: "Phase {phase_number} — {phase_name}\nGray area: {item.gray_area}\nMeta-answerer confidence: {item.confidence}\nSensitivity reason: {which criterion triggered}",
  timeout_minutes: {escalation_timeout_minutes}
})
```

Immediately after sending (before reply arrives), append a JSON line to `.planning/telegram-sessions/{YYYY-MM-DD}.jsonl` (where the date is the current date in YYYY-MM-DD format, creating the file if it does not exist):
```
{"type":"escalation_question","timestamp":"{ISO}","phase":{phase_number},"gray_area":"{item.gray_area}","question":"{question_text}","turn":{turn},"sensitivity_reason":"{which criterion triggered}"}
```

**Step A-fallback — daemon-down or timeout during escalation:** If the `ask_blocking_question` call in Step A throws or returns an error (IPC timeout, a `DAEMON_UNAVAILABLE`-coded error, or the daemon's own question-timeout bubbling back as an IPC error response) — covers BOTH "user didn't reply in time" and "daemon was down at escalation time," same handling for both, do not build two paths:

1. Log the failure loudly (this failure must be visible in the milestone audit):
   ```
   "Telegram escalation failed for phase {phase_number}, gray_area: {item.gray_area} — {error message}. Applying timeout-fallback: writing DEFERRED.json waiver, parking to Claude's Discretion, continuing."
   ```

2. Write a DEFERRED.json waiver via the ONLY sanctioned mechanism (do not invent a parallel one):
   ```bash
   node get-shit-done/bin/gsd-tools.js deferred add {phase_number} --step discuss --reason "Telegram escalation timed out/unavailable for: {item.question}" --approver timeout-fallback
   ```

3. Append a JSON line to `.planning/telegram-sessions/{YYYY-MM-DD}.jsonl`:
   ```
   {"type":"escalation_complete","timestamp":"{ISO}","phase":{phase_number},"gray_area":"{item.gray_area}","final_answer":null,"turns_used":{turn},"escalated_to_discretion":true,"fallback_reason":"{error message}"}
   ```

4. Push item into `discretion_items` (NOT `escalated_answers`) so CONTEXT.md's Claude's Discretion subsection still documents it:
   ```
   discretion_items.push({ gray_area: item.gray_area, question: item.question, reason: "Telegram escalation timeout/unavailable — parked via timeout-fallback" })
   ```

5. Exit this item's loop immediately (do not attempt Step B/C for this item) and continue to the next item in `sensitive_items`.

**Step B — Evaluate reply confidence:**
Read the reply text inline and assign confidence using these rules:
- If the reply contains a clear, actionable decision ("use X", "yes", "no", a specific path name, or a code identifier) → `confidence = 0.85`, `sufficient = true`
- If the reply is a general direction or preference but lacks specific actionable detail → `confidence = 0.65`, `sufficient = false`
- If the reply asks Claude to decide, defers the question, or is otherwise non-committal → `confidence = 0.5`, `sufficient = false`

Append a JSON line to `.planning/telegram-sessions/{YYYY-MM-DD}.jsonl`:
```
{"type":"escalation_reply","timestamp":"{ISO}","phase":{phase_number},"gray_area":"{item.gray_area}","reply":"{reply text}","turn":{turn},"confidence_eval":{confidence},"sufficient":{true|false}}
```

**Step C — Decide whether to loop:**
- If `sufficient == true` OR `turn >= max_turns` → exit loop, use current reply as final answer
- If `sufficient == false` AND `turn < max_turns` → increment turn, construct a follow-up question:
  ```
  question_text = "Thanks for your reply. To be more specific: {synthesize what is still unclear from the original question and the reply received so far}"
  ```
  Then loop back to Step A with the follow-up question text

**After loop exits:**

Update session status back to 'busy':
```
mcp__telegram__update_session_status({ status: "busy" })
```

Append a JSON line to `.planning/telegram-sessions/{YYYY-MM-DD}.jsonl` recording the completed exchange:
```
{"type":"escalation_complete","timestamp":"{ISO}","phase":{phase_number},"gray_area":"{item.gray_area}","final_answer":"{last reply}","turns_used":{turn},"escalated_to_discretion":false}
```

Store the final reply (last reply received regardless of confidence):
```
escalated_answers.push({
  gray_area: item.gray_area,
  question: item.question,
  answer: reply,
  source: "telegram_escalation",
  confidence: 1.0
})
```

// Write to KB immediately after each answer so the DB is updated even if later escalations fail or timeout
**Write escalated answer to knowledge DB (inside loop — non-fatal):**

```bash
GSD_KB_CONTENT="{item.question}: {item.answer}" \
GSD_KB_CONTEXT="Phase {phase_number} Telegram escalation — {item.gray_area}" \
node -e "
const { storeInsights } = require(process.env.HOME + '/.claude/get-shit-done/bin/knowledge-writer.js');
storeInsights([{
  type: 'decision',
  decision: process.env.GSD_KB_CONTENT,
  confidence: 1.0,
  context_snippet: process.env.GSD_KB_CONTEXT
}], { scope: 'global' })
.then(r => process.stderr.write('[coordinator] KB write: ' + JSON.stringify(r) + '\n'))
.catch(e => process.stderr.write('[coordinator] KB write failed: ' + e.message + '\n'));
" || true
```

After all sensitive_items processed, `escalated_answers` holds human-provided answers.

**Merge escalated answers with sufficient answers for CONTEXT.md:**

The CONTEXT.md writer below uses `sufficient_answers` to populate the Implementation Decisions section. Append `escalated_answers` to `sufficient_answers` before writing CONTEXT.md, so all answered questions (autonomous + human-escalated) appear in the decisions section.

The `discretion_items` array goes into the Claude's Discretion subsection (unchanged from Phase 22 behavior for non-sensitive items).

Log needs-escalation items to the checkpoint:
```json
{
  "phase": {N},
  "step": "discuss",
  "status": "answers_evaluated",
  "sufficient_count": N,
  "escalation_count": N,
  "avg_confidence": "X.XX",
  "timestamp": "..."
}
```

**Write CONTEXT.md from sufficient answers:**

1. Create or find phase directory (already available from init):
```bash
mkdir -p ".planning/phases/{phase_dir}"
```

2. Write CONTEXT.md at `.planning/phases/{phase_dir}/{padded_phase}-CONTEXT.md` using this template structure:

```markdown
# Phase {N}: {phase_name} - Context

**Gathered:** {current_date}
**Source:** Autonomous (gsd-meta-answerer)
**Status:** Ready for planning

<domain>
## Phase Boundary

{phase_goal from ROADMAP.md — verbatim}

</domain>

<decisions>
## Implementation Decisions

{For each gray_area with sufficient_answers:}
### {gray_area name}
{For each sufficient answer in this gray area:}
- {answer.question}: {answer.answer} (confidence: {answer.confidence})

### Claude's Discretion
{List questions from discretion_items (needs-escalation items with confidence >= 0.4 that did not trigger any sensitivity criterion). Claude decides these autonomously.}

### Escalated Decisions (Human-Answered)
{If escalated_answers.length > 0: list each item with format "- {answer.question}: {answer.answer} (answered via Telegram)". If none: omit this subsection.}

</decisions>

<specifics>
## Specific Ideas

{Extract any concrete examples, references, or specific patterns from sufficient answers. If none: "No specific requirements — open to standard approaches"}

</specifics>

<deferred>
## Deferred Ideas

{List questions from escalation_needed where confidence < 0.7 that require human input. Note: Phase 23 will escalate these via Telegram.}
{If all answers sufficient: "None — all gray areas resolved autonomously"}

</deferred>

---

*Phase: {padded_phase}-{phase_slug}*
*Context gathered: {current_date}*
*KB answers: {sufficient_count} | Claude's Discretion: {discretion_count} | Escalated: {escalated_count}*
```

3. Write the file.

4. Commit the context file:
```bash
node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js commit "docs({padded_phase}): autonomous discuss step — write phase context" --files ".planning/phases/{phase_dir}/{padded_phase}-CONTEXT.md"
```

5. Create the final discuss step checkpoint:
```json
{
  "phase": {N},
  "phase_name": "...",
  "last_step": "discuss",
  "step_status": "complete",
  "timestamp": "...",
  "files_touched": ["{phase_dir}/{padded_phase}-CONTEXT.md"],
  "key_context": "Autonomous discuss: {sufficient_count} KB answers, {discretion_count} Claude discretion, {escalated_count} Telegram-escalated",
  "resume_from": "research"
}
```

6. Log the discuss completion.

**Notification 2 — Context ready** (fires after discuss step completes — CONTEXT.md written and committed):

```
if telegram_topic_id is not null:
  mcp__telegram__send_message({
    text: "Phase {phase_number} context ready — {sufficient_count} KB answers, {discretion_count} Claude decisions, {escalated_count} Telegram-escalated",
    ...(telegram_topic_id ? { thread_id: telegram_topic_id } : {})
  })
  // JSONL: {"type":"notification","event":"context_ready","timestamp":"{ISO}","phase":{N},"kb_count":{sufficient_count},"discretion_count":{discretion_count},"escalated_count":{escalated_count}}
  // Append above line to .planning/telegram-sessions/{YYYY-MM-DD}.jsonl
```

The execution cycle then proceeds to the `research` step.
</step>

<step name="research">
Check if phase needs research:

```bash
ls .planning/phases/{phase_dir}/*-RESEARCH.md 2>/dev/null || echo "NO_RESEARCH"
```

**If RESEARCH.md exists:** Skip research, create checkpoint with status: "skipped"

**If no RESEARCH.md:**

Build the research prompt (mirrors `get-shit-done/workflows/plan-phase.md`'s "Handle Research" section):

```bash
PHASE_DESC=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" roadmap get-phase "${phase_number}" | jq -r '.section')
```

```markdown
<objective>
Research how to implement Phase {phase_number}: {phase_name}
Answer: "What do I need to know to PLAN this phase well?"
</objective>

<files_to_read>
- {context_path} (USER DECISIONS from the discuss step, if present)
- {requirements_path} (Project requirements)
- {state_path} (Project decisions and history)
</files_to_read>

<additional_context>
**Phase description:** {PHASE_DESC}
**Phase requirement IDs (MUST address):** {phase_req_ids}

**Project instructions:** Read ./CLAUDE.md if exists — follow project-specific guidelines
**Project skills:** Check .claude/skills/ or .agents/skills/ directory (if either exists) — read SKILL.md files, research should account for project skill patterns
</additional_context>

<output>
Write to: {phase_dir}/{padded_phase}-RESEARCH.md
</output>
```

Spawn `gsd-phase-researcher` directly — no shell-out to any slash command:

```
Agent(
  prompt=research_prompt,
  subagent_type="gsd-phase-researcher",
  model="{researcher_model}",
  description="Research Phase {phase_number}"
)
```

**Handle researcher return:**
- **`## RESEARCH COMPLETE`:** Verify RESEARCH.md was created on disk, then create checkpoint: `{ step: "research", status: "complete", files: [...] }`
- **`## RESEARCH BLOCKED`:** This coordinator runs autonomously — do NOT offer an interactive choice (that is plan-phase.md's interactive pattern, not this agent's). Instead, apply this file's own `<error_handling>` convention: log the blocker, write checkpoint `{ step: "research", step_status: "failed", ... }`, and return `{ status: "failed", step: "research", error: "{blocker text from RESEARCH BLOCKED}" }` — do not attempt plan/execute/verify.

**Checkpoint format:**
```json
{
  "phase": {N},
  "step": "research",
  "status": "complete" | "skipped" | "failed",
  "timestamp": "...",
  "files_created": [...],
  "key_findings": "..."
}
```

**Notification 3 — Research done** (fires only when status is "complete" — NOT when skipped):

```
if telegram_topic_id is not null AND research_status == "complete":
  mcp__telegram__send_message({
    text: "Phase {phase_number} research done",
    ...(telegram_topic_id ? { thread_id: telegram_topic_id } : {})
  })
  // JSONL: {"type":"notification","event":"research_done","timestamp":"{ISO}","phase":{N}}
  // Append above line to .planning/telegram-sessions/{YYYY-MM-DD}.jsonl
```
</step>

<step name="plan">
Check if phase needs planning:

```bash
ls .planning/phases/{phase_dir}/*-PLAN.md 2>/dev/null || echo "NO_PLANS"
```

**If PLAN.md files exist:** Skip planning, create checkpoint with status: "skipped"

**If no plans:**

Spawn gsd-planner explicitly — do NOT plan inline in context:

```
Agent(
  subagent_type="gsd-planner",
  model="{planner_model}",
  description="Plan phase {phase_number}",
  prompt="
    <planning_context>
    Phase: {phase_number}
    Phase goal: {goal from ROADMAP.md}
    <files_to_read>
    - .planning/phases/{phase_dir}/*-CONTEXT.md
    - .planning/phases/{phase_dir}/*-RESEARCH.md
    - .planning/STATE.md
    - .planning/ROADMAP.md
    </files_to_read>
    </planning_context>
    Write PLAN.md files to: .planning/phases/{phase_dir}/
    Return: ## PLANNING COMPLETE
  "
)
```

After planner returns, **hard-verify files on disk**:
```bash
PLAN_COUNT=$(ls .planning/phases/{phase_dir}/*-PLAN.md 2>/dev/null | wc -l | tr -d ' ')
echo "PLAN_COUNT=$PLAN_COUNT"
```

**If PLAN_COUNT == 0:** CRITICAL — do NOT proceed to execute. Return failure state:
```json
{ "status": "failed", "step": "plan", "reason": "gsd-planner returned success but no PLAN.md files found on disk" }
```

**Plan structure gate:** After PLAN_COUNT check passes, run structural validation on each plan before proceeding:

```bash
GATE_FAILURES=0
for plan_file in .planning/phases/{phase_dir}/*-PLAN.md; do
  VALIDATION_OUTPUT=$(node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js verify plan-structure "$plan_file" 2>/dev/null)
  VALID=$(echo "$VALIDATION_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('valid', True))" 2>/dev/null || echo "True")
  if [ "$VALID" = "False" ] || [ "$VALID" = "false" ]; then
    ERRORS=$(echo "$VALIDATION_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(', '.join(d.get('errors',[])))" 2>/dev/null || echo "unknown errors")
    echo "PLAN STRUCTURE GATE FAILED: $plan_file — $ERRORS"
    GATE_FAILURES=$((GATE_FAILURES + 1))
  fi
done
```

**If GATE_FAILURES > 0:** CRITICAL — do NOT proceed to execute. Return failure state:
```json
{ "status": "failed", "step": "plan", "reason": "Plan structure gate: {N} plan(s) failed validation — missing tdd tasks or ui-qa checkpoints. See gate output above for details." }
```

Note: The gate runs for BOTH the run path (planner just returned) AND the skip path (plans already existed). If the validation tool itself fails to parse a plan (e.g., tool error), treat as non-blocking and continue — only hard-fail on explicit valid:false responses.

Create checkpoint: `{ step: "plan", status: "complete", plan_count: N }`

**Skip rationale:** Plans may already exist from a previous partial execution. Always prefer existing plans over re-planning to preserve prior decisions.

**Notification 4 — Plans ready** (fires only when status is "complete" — NOT when skipped):

```
if telegram_topic_id is not null AND plan_status == "complete":
  mcp__telegram__send_message({
    text: "Phase {phase_number} plans ready — {plan_count} plan(s)",
    ...(telegram_topic_id ? { thread_id: telegram_topic_id } : {})
  })
  // JSONL: {"type":"notification","event":"plans_ready","timestamp":"{ISO}","phase":{N},"plan_count":{N}}
  // Append above line to .planning/telegram-sessions/{YYYY-MM-DD}.jsonl
```
</step>

<step name="execute">
Execute all plans in the phase:

**Pre-flight: verify PLAN.md files exist before spawning any executor.**
```bash
PLAN_COUNT=$(ls .planning/phases/{phase_dir}/*-PLAN.md 2>/dev/null | wc -l | tr -d ' ')
```
If PLAN_COUNT == 0: HARD STOP — return failure state. Never execute a phase without plans on disk.

**Pre-execution dependency drift check (advisory — never blocks execution):**
```bash
DRIFT_RESULT=$(node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js verify dependency-stability {phase_number} 2>/dev/null || echo '{"drift_detected":false,"error":"drift check unavailable"}')
```

Parse DRIFT_RESULT JSON:
- If `drift_detected == true`: Log WARNING: "WARNING: Dependency drift detected for phase {phase_number} — files modified by intervening phases: {list drifted_files[].file and modified_by_phase}. Review if critical before proceeding. Continuing with execution."
- If `drift_detected == false` (and no error): Log: "Dependency stability check passed — no drift detected"
- If `error` field present or JSON parse fails: Log: "Dependency stability check skipped: {error}" — continue execution

**File conflict check for parallel execution (informational — never blocks):**
```bash
FILE_CONFLICTS=$(node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js roadmap analyze --raw 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(JSON.stringify(j.file_conflicts||[]));}catch(e){console.log('[]');}})" 2>/dev/null || echo '[]')
```

Parse FILE_CONFLICTS JSON array:
- If non-empty: Log "FILE CONFLICTS DETECTED: The following files are claimed by multiple parallel-eligible phases — {for each conflict: file claimed by phases A, B}. Review before running phases in parallel."
- If empty: Log "No file conflicts detected among parallel-eligible phases"
- If parse fails: Log "File conflict check unavailable — skipping" and continue

```bash
# Check what plans exist and which have summaries
node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js phase-plan-index {phase_number}
```

Check the model profile setting to determine if auto routing is active:

```bash
CONFIG_FILE=".planning/config.json"
if [ -f "$CONFIG_FILE" ]; then
  MODEL_PROFILE=$(jq -r '.model_profile // "quality"' "$CONFIG_FILE")
else
  MODEL_PROFILE="quality"
fi
echo "Model profile: $MODEL_PROFILE"
```

If MODEL_PROFILE is "auto", auto routing is active. Otherwise use sonnet as default.

For each incomplete plan (no SUMMARY.md):

1. **Describe what this plan builds** (read objective from PLAN.md)

2. **Determine execution mode:**

   **If MODEL_PROFILE is "auto":** Parse task-level tier tags from PLAN.md.

   ```
   TASK_TIERS = {}
   ROUTING_STATS = { haiku: 0, sonnet: 0, opus: 0 }
   For each <task> element in the plan (by task_index, 1-based):
     // Prefer <model> element (new format), fall back to [tier] name prefix (legacy)
     model_el = extract <model> element text if present (haiku|sonnet|opus)
     task_name = extract <name> element text
     If model_el matches /^(haiku|sonnet|opus)$/i:
       TASK_TIERS[task_index] = model_el (lowercase)
     Else If task_name matches /^\[(haiku|sonnet|opus)\]/i:
       TASK_TIERS[task_index] = matched tier (lowercase)  // legacy compat
     Else:
       TASK_TIERS[task_index] = "sonnet"  // default — no tier specified

   If at least one task has an explicit tier (via <model> or legacy prefix):
     PER_TASK_MODE = true
   Else:
     // Fall back to plan-level routing (plan has no tier info — older plan format)
     PER_TASK_MODE = false
     Read the plan objective (first line of <objective> tag in PLAN.md) as task description:
       PLAN_OBJECTIVE=$(grep -A1 '<objective>' {plan_file} | tail -1 | tr -d '\n')
     Spawn routing agent to get model recommendation:
       Agent(
         subagent_type="gsd-task-router",
         description="Route plan",
         max_turns=5,
         prompt="Route this task: {PLAN_OBJECTIVE}"
       )
     Parse the ROUTING DECISION response to extract the Model: line.
     Set EXECUTOR_MODEL to the returned model tier (haiku/sonnet/opus).
     Also capture ROUTING_SCORE and ROUTING_CONTEXT from the response.

     After extracting the decision, log it to EXECUTION_LOG.md (best-effort):
     ```bash
     node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
       --type routing_decision \
       --data "{\"phase\":{phase_number},\"plan\":\"{plan_number}\",\"model\":\"{EXECUTOR_MODEL}\",\"task\":\"{PLAN_OBJECTIVE}\"}"
     ```
   ```

   **If MODEL_PROFILE is NOT "auto":** PER_TASK_MODE = false, EXECUTOR_MODEL = "sonnet" (unchanged default behavior).

3. **Spawn executor agent:**

   **When PER_TASK_MODE is false** (non-auto profile or no tier tags — existing behavior):
   ```
   Agent(
     subagent_type="gsd-executor",
     model="{EXECUTOR_MODEL}",
     description="Execute plan {plan_number}",
     prompt="
       <objective>
       Execute plan {plan_number} of phase {phase_number}-{phase_name}.
       Commit each task atomically. Create SUMMARY.md. Update STATE.md.
       </objective>

       <execution_context>
       @/Users/ollorin/.claude/get-shit-done/workflows/execute-plan.md
       @/Users/ollorin/.claude/get-shit-done/templates/summary.md
       @/Users/ollorin/.claude/get-shit-done/references/checkpoints.md
       @/Users/ollorin/.claude/get-shit-done/references/tdd.md
       @/Users/ollorin/.claude/get-shit-done/references/handoff-brief.md
       </execution_context>

       <handoff_brief>
       {Coordinator fills the 5 fixed sections per references/handoff-brief.md (may assemble
       brief_text deterministically via `node ~/.claude/get-shit-done/bin/gsd-tools.js handoff
       brief --json '{...}'`, Plan 01):
       PHASE GOAL: {goal from ROADMAP.md}
       KEY DECISIONS: {locked decisions from CONTEXT.md / STATE.md for this phase}
       OPEN RISKS: {known risks / watch-items}
       FILE MAP: {files this phase owns/touches}
       HARD RULES: {the non-negotiable rules the executor MUST honor}
       </handoff_brief>

       <files_to_read>
       - Plan: {phase_dir}/{plan_file}
       - State: .planning/STATE.md
       - Config: .planning/config.json (if exists)
       </files_to_read>

       {IF_AUTO_PROFILE_AND_PLAN_LEVEL_ROUTING:
       <routing_context>
       Auto mode active. Routed to {EXECUTOR_MODEL} (score: {ROUTING_SCORE}).
       Relevant context injected by router:
       {ROUTING_CONTEXT}
       </routing_context>
       }
     "
   )
   ```

   **When PER_TASK_MODE is true** (auto profile with tier tags — per-task routing):

   Spawn executors sequentially, one per task:

   ```
   For each task_index in TASK_TIERS (in dependency/wave order from PLAN.md):
     1. Read TASK_TIER = TASK_TIERS[task_index]

     2. Apply lightweight quota downgrade:
        QUOTA_JSON = run: node ~/.claude/get-shit-done/bin/gsd-tools.js quota status --json
        If quota command succeeds:
          session_percent = QUOTA_JSON.session.percent (numeric, e.g. 87.3)
          If session_percent > 95:
            TASK_TIER = "haiku"  // critical conservation
          Elif session_percent > 80 AND TASK_TIER == "opus":
            TASK_TIER = "sonnet"  // downgrade opus only
          // else: keep TASK_TIER as-is
        If quota command fails: keep TASK_TIER as-is (fail open)

     3. Track tier assignment: ROUTING_STATS[TASK_TIER] += 1

     4. Spawn per-task executor:
        Agent(
          subagent_type="gsd-executor",
          model="{TASK_TIER}",
          description="Execute task {task_index}",
          prompt="
            <objective>
            Execute task {task_index} of plan {plan_number} in phase {phase_number}-{phase_name}.
            Commit the task atomically. If this is the last task, create SUMMARY.md and update STATE.md.
            </objective>
            <execution_context>
            @/Users/ollorin/.claude/get-shit-done/workflows/execute-plan.md
            @/Users/ollorin/.claude/get-shit-done/templates/summary.md
            @/Users/ollorin/.claude/get-shit-done/references/checkpoints.md
            @/Users/ollorin/.claude/get-shit-done/references/tdd.md
            @/Users/ollorin/.claude/get-shit-done/references/handoff-brief.md
            </execution_context>
            <handoff_brief>
            {Coordinator fills the 5 fixed sections per references/handoff-brief.md (may assemble
            brief_text deterministically via `node ~/.claude/get-shit-done/bin/gsd-tools.js handoff
            brief --json '{...}'`, Plan 01):
            PHASE GOAL: {goal from ROADMAP.md}
            KEY DECISIONS: {locked decisions from CONTEXT.md / STATE.md for this phase}
            OPEN RISKS: {known risks / watch-items}
            FILE MAP: {files this phase owns/touches}
            HARD RULES: {the non-negotiable rules the executor MUST honor}
            </handoff_brief>
            <files_to_read>
            - Plan: {phase_dir}/{plan_file}
            - State: .planning/STATE.md
            - Config: .planning/config.json (if exists)
            </files_to_read>
            <routing_context>
            Per-task routing active. This task routed to {TASK_TIER}.
            Task index: {task_index}
            Quota at spawn: {session_percent}%
            </routing_context>
            <resume_from_task>{task_index}</resume_from_task>
          "
        )

     5. Log task dispatch to EXECUTION_LOG.md (best-effort, before waiting for result):
        ```bash
        node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
          --type task_dispatch \
          --data '{"phase":{phase_number},"plan":"{plan_file}","task_index":{task_index},"task_name":"{task_name}","tier":"{TASK_TIER}","quota_pct":{session_percent},"quota_adjusted":{true_if_tier_was_downgraded}}'
        ```

     6. Wait for task executor to complete before spawning next task
        (sequential within a plan — tasks may have intra-plan dependencies)

     7. On executor return, derive the task_type once (best-effort, never blocks):
        TASK_TYPE_FOR_LOGGING = run: node ~/.claude/get-shit-done/bin/gsd-tools.js routing task-type "{task_name}" --raw
        (If this command fails, use "other" as TASK_TYPE_FOR_LOGGING and continue.)

        If the executor's return output does NOT contain "TASK FAILED:" (success):
          Log ONE task_outcome event:
            node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event --type task_outcome \
              --data '{"phase":{phase_number},"plan":"{plan_file}","task_index":{task_index},"task_name":"{task_name}","task_type":"{TASK_TYPE_FOR_LOGGING}","tier":"{TASK_TIER}","outcome":"success","capability_related":true}'
          Record token usage (best-effort, never blocks -- if this command fails, log a warning and continue):
            node ~/.claude/get-shit-done/bin/gsd-tools.js token-usage record \
              --phase {phase_number} --plan "{plan_file}" --task-index {task_index} --task-name "{task_name}" --tier "{TASK_TIER}" --raw
          Continue to next task.

        If the executor's return output DOES contain "TASK FAILED:" — run the bounded escalation loop:
          CURRENT_SIGNAL_TIER = the tier parsed from the signal's "[tier: X]" tag (X = haiku/sonnet/opus;
            if absent, routing was not active for this task — record as failed, no escalation, continue
            to next task)
          ERROR_SUMMARY = the text after the final " — " in the signal
          IS_NON_CAPABILITY_TAGGED = signal contains "[non-capability]"
          ESCALATIONS_USED = 0

          LOOP:
            DECISION_JSON = run: node ~/.claude/get-shit-done/bin/gsd-tools.js routing escalation-decision \
              --current-tier "{CURRENT_SIGNAL_TIER}" --error-summary "{ERROR_SUMMARY}" \
              --escalations-used {ESCALATIONS_USED} --raw
            // The executor's own [non-capability] tag is authoritative and cheaper than a re-derived
            // classification — if present, this attempt is never escalable regardless of the CLI's
            // own re-classification of the error text:
            EFFECTIVE_ESCALATE = DECISION_JSON.escalate AND (NOT IS_NON_CAPABILITY_TAGGED)
            EFFECTIVE_REASON = IS_NON_CAPABILITY_TAGGED ? "non_capability_failure" : DECISION_JSON.reason

            Log ONE task_outcome event for this failed attempt:
              node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event --type task_outcome \
                --data '{"phase":{phase_number},"plan":"{plan_file}","task_index":{task_index},"task_name":"{task_name}","task_type":"{TASK_TYPE_FOR_LOGGING}","tier":"{CURRENT_SIGNAL_TIER}","outcome":"failure","capability_related":{true if NOT IS_NON_CAPABILITY_TAGGED else false}}'
            Record token usage for this failed attempt (best-effort, never blocks):
              node ~/.claude/get-shit-done/bin/gsd-tools.js token-usage record \
                --phase {phase_number} --plan "{plan_file}" --task-index {task_index} --task-name "{task_name}" --tier "{CURRENT_SIGNAL_TIER}" --raw

            If EFFECTIVE_ESCALATE is true AND quota allows (session_percent < 95, not in critical conservation):
              Log: "Task {task_index} failed at {CURRENT_SIGNAL_TIER} ({EFFECTIVE_REASON}) — re-spawning at {DECISION_JSON.next_tier} (coordinator escalation)"
              node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event --type tier_escalation \
                --data '{"phase":{phase_number},"plan":"{plan_file}","task_index":{task_index},"task_name":"{task_name}","task_type":"{TASK_TYPE_FOR_LOGGING}","from_tier":"{CURRENT_SIGNAL_TIER}","to_tier":"{DECISION_JSON.next_tier}","reason":"{EFFECTIVE_REASON}"}'
              ROUTING_STATS[CURRENT_SIGNAL_TIER] -= 1
              ROUTING_STATS[DECISION_JSON.next_tier] += 1
              ESCALATIONS_USED += 1
              TASK_TIER = DECISION_JSON.next_tier
              Re-spawn the same task using the same executor prompt with TASK_TIER = DECISION_JSON.next_tier
              Wait for the re-spawned executor to complete
              If the re-spawned executor's output contains "TASK FAILED:":
                Update CURRENT_SIGNAL_TIER, ERROR_SUMMARY, IS_NON_CAPABILITY_TAGGED from the new signal
                GOTO LOOP (bounded automatically — escalation-decision returns escalate:false once
                  ESCALATIONS_USED reaches the ladder's bound, or once CURRENT_SIGNAL_TIER is opus)
              Else (re-spawned executor succeeded):
                Log ONE task_outcome success event at the FINAL tier:
                  node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event --type task_outcome \
                    --data '{"phase":{phase_number},"plan":"{plan_file}","task_index":{task_index},"task_name":"{task_name}","task_type":"{TASK_TYPE_FOR_LOGGING}","tier":"{TASK_TIER}","outcome":"success","capability_related":true}'
                Record token usage at the FINAL tier (best-effort, never blocks):
                  node ~/.claude/get-shit-done/bin/gsd-tools.js token-usage record \
                    --phase {phase_number} --plan "{plan_file}" --task-index {task_index} --task-name "{task_name}" --tier "{TASK_TIER}" --raw
                Continue to next task.
            Else:
              Log: "Task {task_index} failed at {CURRENT_SIGNAL_TIER} — {EFFECTIVE_REASON}, no further escalation"
              Record task as failed, continue to next task (falls into the existing failure-handling
                path — Spot-check result below, and the human-escalation path if this blocks phase
                completion)

        Escalation ONLY EVER applies to capability-related error/exception failures signaled by the
        executor. Output quality issues never trigger this loop. A [non-capability]-tagged failure
        (missing file, environment error) is recorded as failed immediately and NEVER escalated,
        per MILE-35.
   ```

4. **Spot-check result (MANDATORY — do NOT skip):**
   - SUMMARY.md exists for this plan — if missing, the executor failed to complete. HARD FAIL.
   - Git commit present with phase-plan reference
   - No `## Self-Check: FAILED` in SUMMARY.md — if FAILED, HARD FAIL.
   - No `## PLAN FAILED` in executor output — if present, the test gate or tdd task blocked completion. HARD FAIL.
   - If the executor returned a failure message containing "Test gate blocked" or "Test task blocked": do NOT create a SUMMARY.md on the coordinator's behalf. The executor was correct to block. Return the failure to the parent.

5. **Create checkpoint after each wave:**
```json
{
  "phase": {N},
  "step": "execute",
  "wave": {W},
  "plans_complete": [...],
  "plans_remaining": [...],
  "status": "in_progress" | "complete"
}
```

**On plan failure:** Create checkpoint, return failure state to parent coordinator. Do not attempt to continue if a critical dependency plan failed.

**On classifyHandoffIfNeeded error:** Claude Code runtime bug — not a plan failure. Spot-check (SUMMARY.md + commits) to confirm success before treating as failed.

6. **Rebuild the routing ledger (after ALL plans/waves in this phase have completed):**
   ```bash
   node ~/.claude/get-shit-done/bin/gsd-tools.js routing ledger build --raw
   ```
   Best-effort — if this command fails, log a warning and continue; it never blocks phase
   completion. This folds every `task_outcome`/`tier_escalation` event this phase logged into
   `.planning/routing-ledger.json`, satisfying "escalation is ... recorded ... in the routing
   ledger" (MILE-35). The ledger is a rebuilt aggregate (not a live-appended log), so running
   `routing ledger build` here is always safe and idempotent regardless of how the phase ended.
</step>

<checkpoint_ui_qa_loop>

## UI QA Checkpoint Loop

When the executor agent returns a checkpoint message with `Type: ui-qa`, the coordinator runs an automated QA loop before continuing plan execution.

**Trigger:** Executor returns `## CHECKPOINT REACHED` with `Type: ui-qa`.

**Extract from checkpoint message:**
- `what_built`: from the `<what-built>` tag in the checkpoint task
- `test_flows`: from the `<test-flows>` tag in the checkpoint task

**Before the loop: auto-start dev servers via service-health — do NOT ask the user:**

Try the service-health registry first:
```bash
SH_RESULT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" service-health start default --raw 2>/dev/null)
SH_STATUS=$(echo "$SH_RESULT" | node -e "try{const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(r.status||'')}catch{}")
```

- If SH_STATUS is `already_running` or `started`: log "Dev server ready via service-health" and proceed to the QA loop.
- If SH_STATUS is `no_config` or empty (no registry): fall back to inline startup:
  - Check http://localhost:3000 and any other URL mentioned in `what_built`:
    ```bash
    curl -s --max-time 3 http://localhost:3000 > /dev/null 2>&1 && echo UP || echo DOWN
    ```
    If DOWN:
    - NX monorepo (nx.json present): `npx nx dev {app-name}` — app name from `<apps>` tag in checkpoint or infer from CLAUDE.md. Start each app in background.
    - Other: detect from package.json scripts.dev → run in background
    - Wait up to 30s for ready signal. If still DOWN: log warning and proceed.
- If SH_STATUS is `start_timeout`:
  - **DO NOT PROCEED.** Charlotte cannot test a dead server.
  - Read CLAUDE.md for infrastructure startup instructions. Try the startup command found there.
  - If startup still fails after 60s: return a `human-action` checkpoint:
    ```
    ## CHECKPOINT REACHED

    **Type:** human-action
    **Blocked by:** Dev server / infrastructure failed to start for Charlotte QA

    The Charlotte QA checkpoint cannot be skipped or deferred. Please start the dev server manually:
    1. Check CLAUDE.md for the startup command
    2. Verify the server is responding at the expected URL
    3. Reply "continue" once the server is running

    **IMPORTANT:** Charlotte QA CANNOT be deferred to a future phase. It must run before this phase can complete.
    ```
  - Wait for user response. Do NOT mark phase complete without Charlotte QA running.

**Loop (max 3 rounds):**

```
MAX_ROUNDS = 3
round = 1
qa_passed = false
previous_issues = null
previous_report = null

while round <= MAX_ROUNDS AND qa_passed == false:

  // --- STEP A: Run QA Agent ---
  qa_result = Agent(
    subagent_type="gsd-charlotte-qa",
    model="haiku",
    description="UI QA round {round}",
    prompt="
      mode=ui-qa
      <what_built>{what_built}</what_built>
      <test_flows>{test_flows}</test_flows>
      <round>{round}</round>
      {IF round > 1: <previous_issues>{previous_report}</previous_issues>}
    "
  )

  Parse qa_result JSON:
    qa_passed = qa_result.passed
    issue_count = qa_result.issue_count
    severity_counts = qa_result.severity_counts
    issues = qa_result.issues
    report_markdown = qa_result.report_markdown
    screenshots = qa_result.screenshots

  Log: "QA Round {round}: {issue_count} issues (Critical: {critical}, High: {high}, Medium: {medium}, Low: {low})"

  // --- STEP B: If clean, exit loop ---
  if qa_passed:
    Log: "QA passed on round {round} — continuing plan execution"
    break

  // --- STEP C: If round == MAX_ROUNDS and still failing, escalate to human ---
  if round == MAX_ROUNDS AND NOT qa_passed:
    // Build human escalation message
    Send Telegram notification (if telegram_topic_id is not null):
      mcp__telegram__send_message({
        text: "UI QA: {issue_count} issues remain after {MAX_ROUNDS} rounds. Human review needed.\n\nCritical: {critical} | High: {high} | Medium: {medium} | Low: {low}\n\nResume to continue or 'stop' to halt.",
        thread_id: telegram_topic_id (if set)
      })

    // Return human checkpoint
    Return checkpoint message to parent:
    ```
    ╔═══════════════════════════════════════════════════════╗
    ║  UI QA: Human Review Required                         ║
    ╚═══════════════════════════════════════════════════════╝

    Charlotte ran {MAX_ROUNDS} QA rounds. {issue_count} issues remain unfixed.

    Severity: Critical: {critical} | High: {high} | Medium: {medium} | Low: {low}

    Issues summary:
    {list top 5 issues by severity}

    Full QA report:
    {report_markdown}

    ────────────────────────────────────────────────────────
    → Type "continue" to proceed (Critical/High issues will be recorded as verification gaps),
      or describe what to fix
    ────────────────────────────────────────────────────────
    ```
    Wait for user response.
    If "continue":
      - If severity_counts.critical > 0 OR severity_counts.high > 0:
        Log: "WARNING: Proceeding with {critical} critical and {high} high QA issues — these WILL cause verification failure"
        Write QA issues to a file in the phase directory: `{phase_dir}/{phase}-QA-ISSUES.md` with the full report_markdown
        // The verifier will detect this file and hard-fail the phase via QGATE-07
        // This ensures "continue" does NOT silently bypass quality gates — it merely defers the block to verification
      - Proceed to next task
    Else: implement requested fix and re-run QA.
    break

  // --- STEP D: Spawn fix subagent ---
  // Determine fix subagent tier based on worst severity
  if severity_counts.critical > 0 OR severity_counts.high > 0:
    FIX_TIER = "sonnet"
  else:
    FIX_TIER = "haiku"

  // Build fix prompt from issues report
  fix_result = Agent(
    subagent_type="general-purpose",
    model="{FIX_TIER}",
    description="Fix UI issues round {round}",
    prompt="
      You are a senior engineer fixing UI/UX issues found during automated QA testing.

      ## Your task
      Fix the issues listed below. Do not refactor surrounding code. Only fix what is listed.
      Commit each logical fix atomically: `fix([scope]): [what was fixed]`

      ## Codebase context
      Read the project's CLAUDE.md to understand:
      - Project structure and file layout
      - Framework and stack (Next.js, Vite, etc.)
      - Component library (shadcn/ui, MUI, etc.)
      - Code style and patterns

      ## Issues to fix
      {report_markdown}

      ## Investigation approach
      1. Read the full issue report
      2. Group issues by root cause (multiple issues may share one fix)
      3. Prioritize: Critical → High → Medium → Low
      4. Use LSP workspaceSymbol/goToDefinition to locate components before editing
      5. Read files before editing — never edit blind

      ## Common fix patterns
      - Free-text → dropdown: replace `<Input>` with `<Select>` for predefined-value fields
      - Missing loading state: add `isPending` to disable button + show spinner
      - Missing success toast: add `toast.success()` in mutation onSuccess
      - Page crash on undefined: add optional chaining (`?.`) and null guards
      - Breadcrumbs missing: add `<Breadcrumb>` component at top of page
      - Unclickable ID: wrap in `<Link href={...}>` with underline styling
      - Table overflow: wrap in `<div className='overflow-x-auto'>`
      - Navigation broken: check if inside `<form>` element; add `type='button'` to links

      ## After each fix
      - Run type-check: `npx tsc --noEmit` (or project equivalent)
      - Run lint: `npm run lint` (or project equivalent)
      - Commit with format: `fix([scope]): [what was fixed]`

      ## Output when done
      Return a JSON summary:
      {
        'issues_fixed': ['ISSUE-001', 'ISSUE-002'],
        'issues_deferred': [{'id': 'ISSUE-003', 'reason': 'requires design decision'}],
        'commits': ['abc1234: fix(dashboard): add breadcrumb navigation'],
        'needs_restart': true | false
      }

      Set `needs_restart: true` if any fix modified server-side files (API routes, server components, config files) that require a dev server restart to take effect. Set `false` for client-side only changes.
    "
  )

  Parse fix_result JSON:
    issues_fixed = fix_result.issues_fixed
    needs_restart = fix_result.needs_restart

  Log: "Fix round {round}: {issues_fixed.length} issues fixed, needs_restart: {needs_restart}"

  // --- STEP E: Restart if needed ---
  if needs_restart:
    Log: "Restart signal received — checking service health"

    // Wait briefly for process to die
    Bash: sleep 3

    // Re-read health check command from CLAUDE.md (or use default)
    QA_HEALTH_CMD = parse from CLAUDE.md `## QA / Dev Server` or default: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
    QA_LAUNCH_CMD = parse from CLAUDE.md or default: `npm run dev`

    HTTP_CODE = Bash: eval "{QA_HEALTH_CMD}"

    if HTTP_CODE != "200":
      // Server stopped — relaunch
      Log: "Server stopped — relaunching"
      Bash: eval "{QA_LAUNCH_CMD}" &
      Bash: timeout 60 bash -c "until eval '{QA_HEALTH_CMD}' | grep -q '200'; do sleep 2; done"
      HTTP_CODE = Bash: eval "{QA_HEALTH_CMD}"
      if HTTP_CODE != "200":
        Log: "ERROR: Service failed to restart — escalating to human"
        // Fall through to human escalation
        round = MAX_ROUNDS  // Force human escalation on next iteration
    else:
      Log: "Server still healthy — hot-reload took effect"

  // --- STEP F: Prepare for next round ---
  previous_report = report_markdown
  round = round + 1

// End of loop
```

**After loop completes successfully (qa_passed == true):** Run mandatory UX audit before continuing.

**MANDATORY UX AUDIT after every ui-qa pass:**

When the ui-qa loop passes, immediately run a ux-audit on the same surface before continuing plan execution. UI testing and UX testing are inseparable — you never run one without the other.

```
// After qa_passed == true from the ui-qa loop:
ux_result = Agent(
  subagent_type="gsd-charlotte-qa",
  model="sonnet",
  description="UX audit after UI QA — {what_built}",
  prompt="
    mode=ux-audit
    <what_built>{what_built}</what_built>
    <test_flows>{test_flows}</test_flows>
    <round>1</round>
  "
)

Parse ux_result JSON:
  ux_passed = ux_result.passed
  ux_issue_count = ux_result.issue_count
  ux_severity_counts = ux_result.severity_counts
  ux_issues = ux_result.issues
  ux_report = ux_result.report_markdown

Log: "UX Audit: {ux_issue_count} issues (Critical: {ux_severity_counts.critical}, High: {ux_severity_counts.high}, Medium: {ux_severity_counts.medium}, Low: {ux_severity_counts.low})"

// If Critical or High UX issues found: spawn fix subagent (same model logic as ui-qa loop)
if ux_severity_counts.critical > 0 OR ux_severity_counts.high > 0:
  ux_fix_result = Agent(
    subagent_type="general-purpose",
    model="sonnet",
    description="Fix UX issues",
    prompt="
      Fix these UX issues found by Charlotte UX audit.

      <what_built>{what_built}</what_built>

      <issues>
      {ux_report}
      </issues>

      Fix all Critical and High severity UX issues. Medium and Low are optional. Commit your fixes.
    "
  )

  // Re-run UX audit to verify fixes
  ux_recheck = Agent(
    subagent_type="gsd-charlotte-qa",
    model="sonnet",
    description="UX re-audit after fixes",
    prompt="
      mode=ux-audit
      <what_built>{what_built}</what_built>
      <test_flows>{test_flows}</test_flows>
      <round>2</round>
      <previous_issues>{ux_report}</previous_issues>
    "
  )

  Parse ux_recheck JSON. Log results.

  // If Critical/High still present after fix: write UX-ISSUES.md so verifier catches it
  if ux_recheck.severity_counts.critical > 0 OR ux_recheck.severity_counts.high > 0:
    Write `.planning/phases/{phase_dir}/UX-ISSUES.md` with the remaining issues
    Log: "UX issues persist after fix attempt — recorded in UX-ISSUES.md for verifier"

// Write UX audit report to phase directory regardless of outcome
Write `.planning/phases/{phase_dir}/{phase}-{plan}-UX-AUDIT.md` with ux_result.report_markdown (and ux_recheck report if ran)

// Continue plan execution from the next task after the checkpoint:ui-qa task
```

**HARD RULE: The UX audit cannot be skipped when UI tests run.** It runs on the same surface, same service URL, immediately after ui-qa passes. Medium and Low UX issues are logged but do not block execution. Critical and High issues trigger a fix-and-recheck loop.

**Note on commit handling:** The fix subagent commits its own changes atomically per fix. The coordinator does not make additional commits for the QA loop — only the executor's per-task commits and the final summary commit exist.

</checkpoint_ui_qa_loop>

<detect_web_framework>

## Detect Web Framework

Before running the post-phase UX sweep, detect if this is a web project by checking package.json. This runs unconditionally — regardless of what file extensions appear in SUMMARY.md.

```bash
WEB_FRAMEWORK_DETECTED=false
WEB_FRAMEWORK_NAME=""

if [ -f "package.json" ]; then
  FRAMEWORK=$(node -e "
    try {
      const p = require('./package.json');
      const deps = Object.assign({}, p.dependencies || {}, p.devDependencies || {});
      const frameworks = ['react', 'next', 'vue', 'svelte', '@angular/core', 'nuxt', 'gatsby', 'remix', '@remix-run/react', 'solid-js', 'preact'];
      const found = frameworks.find(function(f) { return deps[f]; });
      console.log(found || '');
    } catch(e) { console.log(''); }
  " 2>/dev/null || echo "")

  if [ -n "$FRAMEWORK" ]; then
    WEB_FRAMEWORK_DETECTED=true
    WEB_FRAMEWORK_NAME="$FRAMEWORK"
    Log: "Web framework detected: ${WEB_FRAMEWORK_NAME} — Charlotte UX sweep will run unconditionally"
  fi
fi
```

If WEB_FRAMEWORK_DETECTED=true: Charlotte UX sweep runs unconditionally for this phase, regardless of whether any .tsx/.jsx files appear in SUMMARY.md. This ensures web projects always get QA coverage.

**HARD RULE: Charlotte UX sweep is MANDATORY for web projects.**

If WEB_FRAMEWORK_DETECTED=true:
- The UX sweep MUST run after all plans complete
- If the dev server fails to start: read CLAUDE.md for startup instructions, attempt startup, then run the sweep
- If after startup attempts the server still won't start: return a `human-action` checkpoint — do NOT skip the sweep
- "The UX was tested by individual checkpoint:ui-qa tasks" is NOT sufficient to skip the end-of-phase sweep
- The sweep catches cross-plan UX regressions and holistic flow issues that per-plan checkpoints miss

There is NO mechanism to skip the Charlotte UX sweep for web projects. The only way to proceed without it is a `human-action` checkpoint where the user explicitly decides.

</detect_web_framework>


<step name="post_phase_ux_sweep">

After ALL plans in this phase have completed execution:

1. Detect if this phase produced web UI. Either condition triggers the sweep:
   a. **Framework detection** (preferred): `WEB_FRAMEWORK_DETECTED=true` from the `detect_web_framework` step above — the project uses a web framework, so ALL phases get a Charlotte sweep regardless of what changed
   b. **SUMMARY.md scan** (fallback): Scan all SUMMARY.md files from this phase for `.tsx`, `.jsx`, `.vue`, `.svelte` files in key-files

2. If EITHER condition is true: proceed with Charlotte UX sweep (steps 3-5 below)

3. If web UI was produced:
   a. **Auto-start dev server via service-health** — do NOT ask user:
      ```bash
      SH_RESULT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" service-health start default --raw 2>/dev/null)
      SH_STATUS=$(echo "$SH_RESULT" | node -e "try{const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(r.status||'')}catch{}")
      ```
      If SH_STATUS is `already_running` or `started`: proceed to step b.
      If SH_STATUS is `no_config` or empty: fallback — check http://localhost:3000; if DOWN → NX monorepo → `npx nx dev {app}` in background; other → `npm run dev` in background. Wait up to 30s.
      If SH_STATUS is `start_timeout`: read CLAUDE.md for infrastructure startup instructions, attempt startup. If still failing after 60s: return a `human-action` checkpoint — do NOT skip the sweep. Charlotte cannot test a dead server.
   b. Derive test scope from phase success criteria and SUMMARY.md key-files
   c. Run the Charlotte 3-round loop — mode="ux-audit":
      ```
      Agent(
        subagent_type="gsd-charlotte-qa",
        model="sonnet",
        description="UX audit phase {phase_number}",
        prompt="
          mode=ux-audit
          what_built={phase goal + key UI files from SUMMARYs}
          test_flows={derive from phase success criteria}
          round=1
        "
      )
      ```
   d. If issues found: spawn fix subagent (same as existing ui-qa loop)
   e. Re-run ux-audit after fixes (max 2 fix rounds for UX issues; critical/high blocking)

Note: This runs IN ADDITION to any checkpoint:ui-qa tasks within individual plans.
Those test individual plan scope. This tests the full phase's UI output together.

</step>

<step name="post_phase_e2e">

After post_phase_ux_sweep and before verify_phase_goal:

1. Collect e2e_flows from ALL plan frontmatters in this phase:
   ```bash
   E2E_FLOWS=$(for plan in {phase_dir}/*-PLAN.md; do
     node ~/.claude/get-shit-done/bin/gsd-tools.js frontmatter get "$plan" --field e2e_flows 2>/dev/null
   done | jq -s 'flatten | unique')
   ```

2. If E2E_FLOWS is empty or null: skip this step.

3. If E2E_FLOWS has entries:
   a. **Auto-start dev server via service-health** — do NOT ask user. Same pattern as post_phase_ux_sweep step 3a — call `service-health start default` first, fall back to inline NX/npm startup if SH_STATUS is `no_config`.
   b. Spawn gsd-charlotte-qa (mode=e2e):
      ```
      Agent(
        subagent_type="gsd-charlotte-qa",
        model="sonnet",
        description="E2E test phase {phase_number}",
        prompt="
          mode=e2e
          e2e_flows={E2E_FLOWS}
          project_dir={project_dir}
          round=1
        "
      )
      ```
   c. Parse results:
      - All flows PASS → log "E2E: {N} flows passing" → continue to verify_phase_goal
      - Any flow FAILS with severity Critical or High → create gap entry → spawn gap closure plan (BLOCKING — do NOT proceed to verify until gaps are closed)
      - Any flow FAILS with severity Medium → create gap entry, record in phase QA report. The verifier will flag this as `gaps_found`. Do NOT silently ignore medium-severity E2E failures.
      - Any flow FAILS with severity Low → log as informational, record in phase QA report. Proceed to verify.

</step>

<step name="verify">
Verify phase goal achieved using VERIFICATION.md:

```bash
node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js init verify-work {phase_number}
```

**HARD RULE: The coordinator MUST spawn gsd-verifier to write VERIFICATION.md.**

Writing VERIFICATION.md inline (coordinator writes it directly without spawning gsd-verifier) is prohibited for phases that:
- Contain any .tsx/.jsx files in their SUMMARY.md key-files
- Have any PLAN.md with a checkpoint:ui-qa task
- Have success criteria mentioning "Charlotte", "browser QA", "UI test", or "integration test"

If the coordinator DOES write inline (e.g., timeout fallback), it MUST set `verifier: coordinator` in the frontmatter. When gsd-verifier runs in re-verification mode and sees `verifier: coordinator`, it MUST re-run all QA-related QGATEs (07, 10, 12) regardless of what the coordinator's inline report said.

Spawn verifier agent to create VERIFICATION.md:
```
// Pick verifier tier based on phase complexity
MUST_HAVES_COUNT = sum of (must_haves.truths.length + must_haves.artifacts.length) across all PLAN.md files in {phase_dir}
VERIFIER_MODEL = MUST_HAVES_COUNT >= 8 ? "opus" : "sonnet"

Agent(
  subagent_type="gsd-verifier",
  model={VERIFIER_MODEL},
  description="Verify phase {phase_number}",
  prompt="Verify phase {phase_number} goal achievement.
Phase directory: {phase_dir}
Phase goal: {goal from ROADMAP.md}
Check must_haves against actual codebase. Create VERIFICATION.md.

@/Users/ollorin/.claude/get-shit-done/references/handoff-brief.md

<handoff_brief>
{Coordinator fills the 5 fixed sections per references/handoff-brief.md (may assemble
brief_text deterministically via `node ~/.claude/get-shit-done/bin/gsd-tools.js handoff
brief --json '{...}'`, Plan 01):
PHASE GOAL: {goal from ROADMAP.md}
KEY DECISIONS: {locked decisions from CONTEXT.md / STATE.md for this phase}
OPEN RISKS: {known risks / watch-items}
FILE MAP: {files this phase owns/touches}
HARD RULES: {the non-negotiable rules the phase was verified against}
</handoff_brief>"
)
```

Read verification result:
```bash
grep "^status:" .planning/phases/{phase_dir}/*-VERIFICATION.md
```

**HARD RULE: VERIFICATION.md must exist on disk before phase can return any success state.**

```bash
VERIFICATION_EXISTS=$(ls .planning/phases/{phase_dir}/*-VERIFICATION.md 2>/dev/null | wc -l | tr -d ' ')
if [ "$VERIFICATION_EXISTS" = "0" ]; then
  # Verifier was spawned but failed to write VERIFICATION.md — HARD FAIL
  Log: "CRITICAL: gsd-verifier completed but no VERIFICATION.md found on disk"
  Return: { "status": "failed", "step": "verify", "reason": "Verifier completed but did not write VERIFICATION.md — phase cannot be marked complete without verification" }
fi
```

**Phase-gate authority note:** This coordinator's own VERIFICATION.md-must-exist check above is a legitimate early self-check (fail fast before returning, so a missing artifact is caught here rather than surfacing later at the orchestrator). It does NOT replace the orchestrator's `verify phase-gate {phase}` call, which runs after this coordinator returns and is the actual blocking authority for artifact EXISTENCE across all 5 checks (test files, Charlotte QA evidence, docs commit, E2E-TEST-PLAN.md, VERIFICATION.md itself). Do not remove this coordinator's own hard rule — the coordinator still must spawn the verifier; phase-gate only re-confirms deterministically afterward.

**Status routing:**
- `passed` → send phase_complete notification, then return success state
- `gaps_found` → return gaps_found state with details from VERIFICATION.md
- `human_needed` → return human_needed state with items requiring human testing

**Notification 5 — Phase complete** (fires when verification status is "passed"):

```
if telegram_topic_id is not null:
  duration_minutes = calculate from phase start timestamp to now (round to nearest minute)

  // Build routing stats string if per-task routing was used
  routing_stats_str = ""
  if PER_TASK_MODE and ROUTING_STATS is non-empty:
    parts = []
    if ROUTING_STATS.haiku > 0: parts.push("{ROUTING_STATS.haiku} haiku")
    if ROUTING_STATS.sonnet > 0: parts.push("{ROUTING_STATS.sonnet} sonnet")
    if ROUTING_STATS.opus > 0: parts.push("{ROUTING_STATS.opus} opus")
    routing_stats_str = " | " + parts.join(" / ")

  mcp__telegram__send_message({
    text: "Phase {phase_number} complete ({duration_minutes}m) — {phase_name}{routing_stats_str}",
    ...(telegram_topic_id ? { thread_id: telegram_topic_id } : {})
  })
  // JSONL: {"type":"notification","event":"phase_complete","timestamp":"{ISO}","phase":{N},"duration_minutes":{N}}
  // Append above line to .planning/telegram-sessions/{YYYY-MM-DD}.jsonl
```

**Create final checkpoint:**
```json
{
  "phase": {N},
  "step": "verify",
  "status": "passed" | "gaps_found" | "human_needed",
  "verification_path": "..."
}
```
</step>

<step name="cross_phase_integration">

After verify_phase_goal, check for cross-phase integration boundaries.

**Trigger conditions (ANY of these triggers integration testing — not just explicit depends_on):**

1. **Explicit dependency:** Current phase `depends_on` has entries in ROADMAP.md
2. **Shared artifact detection:** Current phase's SUMMARY.md key-files overlap with any previous phase's SUMMARY.md key-files (same API routes, same database tables, same shared components)
3. **API producer/consumer:** Current phase creates or modifies API routes that are called by components from previous phases, OR current phase creates components that call API routes from previous phases

```bash
# Check explicit depends_on
DEPENDS_ON=$(node ~/.claude/get-shit-done/bin/gsd-tools.js roadmap get-phase {phase_number} --raw 2>/dev/null | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(JSON.stringify(d.depends_on||[]))}catch{console.log('[]')}" 2>/dev/null || echo "[]")

# Check for shared files with ANY completed phase (not just depends_on)
CURRENT_FILES=$(grep -oE '[\w\-\/\.]+\.(ts|tsx|js|jsx)' .planning/phases/{phase_dir}/*-SUMMARY.md 2>/dev/null | sort -u)
SHARED_OVERLAP=false
for prev_phase_dir in .planning/phases/*/; do
  if [ "$prev_phase_dir" != ".planning/phases/{phase_dir}/" ] && ls "$prev_phase_dir"*-SUMMARY.md >/dev/null 2>&1; then
    PREV_FILES=$(grep -oE '[\w\-\/\.]+\.(ts|tsx|js|jsx)' "$prev_phase_dir"*-SUMMARY.md 2>/dev/null | sort -u)
    OVERLAP=$(comm -12 <(echo "$CURRENT_FILES") <(echo "$PREV_FILES") 2>/dev/null)
    if [ -n "$OVERLAP" ]; then
      SHARED_OVERLAP=true
      OVERLAPPING_PHASE="$prev_phase_dir"
      break
    fi
  fi
done
```

**If DEPENDS_ON is non-empty OR SHARED_OVERLAP is true:**

1. Read SUMMARY.md of each depended-on phase AND any overlapping phase — collect exported artifacts
2. Read SUMMARY.md of current phase — collect consumed artifacts
3. If overlap found (same API routes, same tables, same component names):

   Spawn gsd-integration-tester:
   ```
   Agent(
     subagent_type="gsd-integration-tester",
     model="sonnet",
     description="Integration test phase {phase_number}",
     prompt="
       current_phase={phase_slug}
       depends_on_phases={depends_on list + overlapping phases}
       integration_points={derived overlap}
       project_dir={project_dir}
     "
   )
   ```

3b. **(NEW, MILE-38, additive) If step 3 above did NOT already spawn gsd-integration-tester
    for this phase:** check the `quality.integration_tester` toggle:
    ```bash
    INTEGRATION_TESTER_ENABLED=$(node ~/.claude/get-shit-done/bin/gsd-tools.js config get integration_tester_enabled --raw 2>/dev/null || echo "false")
    ```
    If `INTEGRATION_TESTER_ENABLED` is `"true"` AND `DEPENDS_ON` (from the "Check explicit
    depends_on" bash block above) has length > 0: spawn gsd-integration-tester anyway, using
    the EXACT SAME `Agent()` call as step 3 (`depends_on_phases={DEPENDS_ON + overlapping
    phases}`, `integration_points={derived overlap, may be empty if none was found}`) -- this
    fires even when `SHARED_OVERLAP` is `false`, because a phase can legitimately depend on a
    prior phase's schema/convention with zero raw file-name overlap. If `DEPENDS_ON` is empty:
    NEVER spawn via this branch, regardless of the toggle state -- independent phases never
    trigger it.

4. If any `blocking: true` mismatch is returned by gsd-integration-tester (from EITHER the
   step 3 spawn or the new step 3b spawn): this is a HARD BLOCK — do NOT proceed to phase
   complete. For EACH blocking mismatch, propagate it into this phase's already-written
   VERIFICATION.md so it composes with the EXISTING verification-gap pipeline (no second/
   parallel gap-writing mechanism):

   ```bash
   node ~/.claude/get-shit-done/bin/gsd-tools.js verify append-gap "{phase_dir}/{verification_file}" \
     --truth "Cross-phase integration boundary '{mismatch.boundary}' matches between producer and consumer" \
     --reason "{mismatch.mismatch} (producer: {mismatch.producer_shape}, consumer: {mismatch.consumer_shape})" \
     --failure-type contract_mismatch \
     --raw
   ```

   This appends one gap entry per blocking mismatch and flips VERIFICATION.md's `status` to
   `gaps_found` — the SAME frontmatter shape `eval-candidate from-verification` (Phase 55)
   already reads, so a subsequent `eval-candidate from-verification` run picks up these gaps
   automatically, and `/gsd:plan-phase --gaps` can build gap closure plans from them exactly as
   it does for verifier-originated gaps. Do NOT build a separate gap-closure code path for
   integration mismatches.

   If gsd-integration-tester returns zero `blocking: true` mismatches: continue to phase
   complete as normal (no VERIFICATION.md change).

</step>

</execution_cycle>
