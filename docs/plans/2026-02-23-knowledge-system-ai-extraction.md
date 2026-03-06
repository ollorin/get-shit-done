# Knowledge System: AI Extraction + GSD Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken regex-based knowledge extraction with Haiku-powered AI extraction, and wire the knowledge DB into GSD planning and execution so agents automatically consult your reasoning context before making decisions.

**Architecture:** Two bugs fixed together. Bug 1 — strip the broken regex pipeline from the Stop hook entirely; extraction now happens at phase start via `mine-conversations` (already uses Haiku, already captures non-technical decisions). Bug 2 — phase coordinator harvests recent sessions with Haiku at phase start; planner and executor both query the knowledge DB before making decisions.

**Tech Stack:** Node.js (session-end-standalone.js), Markdown agent prompts (gsd-phase-coordinator.md, gsd-planner.md, gsd-executor.md), existing `mine-conversations` / `store-conversation-result` / `query-knowledge` CLI commands in gsd-tools.js.

---

## Task 1: Strip regex extraction from session-end-standalone.js

**Files:**
- Modify: `bin/hooks/session-end-standalone.js` (installed at `~/.claude/get-shit-done/bin/hooks/session-end-standalone.js`)

**Context:** The Stop hook currently does regex extraction via `knowledge-extraction.js`, which requires a "technical signal" (code, paths, programming keywords) before storing anything. This kills all non-technical reasoning — business decisions, priorities, UX preferences, project strategy. The fix is to delete all extraction logic. Haiku-based extraction at phase start (Task 2) replaces it.

The hook must still:
1. Read stdin (Claude Code protocol — the hook receives JSON on stdin)
2. Exit 0 always (never block Claude from stopping)
3. Clean up old `/tmp/gsd-session-*.txt` and `.done` files left by the old implementation

---

**Step 1: Read the current file to confirm state**

Read: `~/.claude/get-shit-done/bin/hooks/session-end-standalone.js`

Expected: 177-line file with `knowledge-extraction.js` require, temp file accumulation, regex extraction pipeline.

---

**Step 2: Write the new simplified hook**

Replace the entire file content with:

```js
#!/usr/bin/env node

/**
 * session-end-standalone.js
 * Claude Code Stop hook — lightweight session-end handler.
 *
 * Knowledge extraction now happens at phase start via mine-conversations
 * (Haiku-based, captures all reasoning types — not just technical).
 *
 * This hook:
 * - Reads stdin (Claude Code protocol requirement)
 * - Cleans up /tmp/gsd-session-* temp files from previous implementation
 * - Always exits 0 — never blocks Claude from stopping
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEMP_PREFIX = path.join(os.tmpdir(), 'gsd-session-');
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function main() {
  // Consume stdin — required by Claude Code hook protocol
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
  } catch (_) {}

  // Clean up old temp files left by previous regex-extraction implementation
  cleanupOldTempFiles();

  process.exit(0);
}

function cleanupOldTempFiles() {
  try {
    const files = fs.readdirSync(os.tmpdir());
    const now = Date.now();
    for (const f of files) {
      if (!f.startsWith('gsd-session-')) continue;
      if (!f.endsWith('.txt') && !f.endsWith('.done')) continue;
      const fp = path.join(os.tmpdir(), f);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > MAX_AGE_MS) fs.unlinkSync(fp);
      } catch (_) {}
    }
  } catch (_) {}
}

main().catch(() => process.exit(0));
```

---

**Step 3: Verify the hook exits cleanly**

```bash
echo '{"session_id":"test-123","last_assistant_message":"hello","stop_hook_active":false}' \
  | node ~/.claude/get-shit-done/bin/hooks/session-end-standalone.js
echo "Exit code: $?"
```

Expected output: nothing printed, exit code `0`.

---

**Step 4: Also update the source file in the project**

The installed copy at `~/.claude/get-shit-done/` is the deployed version. The source lives in this repo. Update the source too so the change survives reinstalls.

Read: `bin/hooks/session-end-standalone.js` (in the project root — this is `bin/hooks/` under `/Users/ollorin/get-shit-done/`)

If the file exists there, replace it with the same content from Step 2. If not, note that installation deploys from `~/.claude/get-shit-done/` directly and the installed file is the source of truth — skip this step.

---

**Step 5: Commit**

```bash
git add ~/.claude/get-shit-done/bin/hooks/session-end-standalone.js
# Also add source if updated:
# git add bin/hooks/session-end-standalone.js
git commit -m "fix(knowledge): replace regex extraction hook with lightweight no-op

Knowledge extraction now happens via mine-conversations (Haiku-based)
at phase start. The regex approach required technical signals and missed
all non-technical decisions, business reasoning, and preferences.

The Stop hook now just reads stdin and exits 0."
```

---

## Task 2: Add harvest_knowledge step to gsd-phase-coordinator.md

**Files:**
- Modify: `agents/gsd-phase-coordinator.md`

**Context:** The phase coordinator runs at the start of every GSD phase lifecycle. It has the `Task` tool — meaning it can spawn Haiku subagents. Adding a `harvest_knowledge` step here means: every time you start working on a phase, the system automatically mines your recent Claude Code conversations with Haiku and stores the extracted decisions/reasoning/preferences in the knowledge DB before planning begins.

The harvest step reuses the exact same pattern as `workflows/mine-conversations.md`. It calls:
1. `gsd-tools.js mine-conversations --all-projects --max-age-days 3 --limit 5` to discover sessions
2. `Task(model="haiku")` for each extraction request
3. `gsd-tools.js store-conversation-result` to store results

The step is **non-fatal** — if it fails for any reason, the phase lifecycle continues normally. The goal is best-effort knowledge capture, not a hard dependency.

---

**Step 1: Read the phase coordinator to find the insertion point**

Read: `agents/gsd-phase-coordinator.md`, lines 1–55

Locate the `<execution_cycle>` block and the `<step name="discuss">` opening. The `harvest_knowledge` step inserts immediately before `<step name="discuss">` (after the phase-start Telegram notification block, before the discuss step header).

---

**Step 2: Insert the harvest_knowledge step**

Find this exact text in `agents/gsd-phase-coordinator.md`:

```
<step name="discuss">
Check if phase already has a CONTEXT.md (meaning discussion was already done):
```

Insert the following block **immediately before** that line (with one blank line of separation):

```markdown
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
   Task(
     subagent_type="general-purpose",
     model="haiku",
     prompt="{item.prompt}"
   )
   ```

   Collect Haiku output text. If Task() throws or returns empty, skip this extraction type and continue.

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

```

---

**Step 3: Verify the step was inserted correctly**

```bash
grep -n "harvest_knowledge\|mine-conversations\|<step name=\"discuss\">" \
  agents/gsd-phase-coordinator.md | head -10
```

Expected: `harvest_knowledge` appears on a line number that is lower than the line with `<step name="discuss">`.

---

**Step 4: Commit**

```bash
git add agents/gsd-phase-coordinator.md
git commit -m "feat(knowledge): harvest recent sessions via Haiku at phase start

Phase coordinator now mines Claude Code conversations from the last 3
days using Haiku at the start of every phase lifecycle. Extracts
decisions, reasoning patterns, and meta-knowledge (including
non-technical: business reasoning, preferences, priorities).

Non-fatal: harvest failure never blocks phase execution."
```

---

## Task 3: Add knowledge query to gsd-planner.md

**Files:**
- Modify: `agents/gsd-planner.md`

**Context:** The planner creates PLAN.md files that executors implement. Before creating any plan, the planner should consult the knowledge DB to understand your preferences, past decisions, and reasoning patterns relevant to the current phase. This prevents the planner from making decisions that contradict your established approach.

The step inserts after `load_codebase_context` (which runs around line 881) and before `identify_phase` (around line 902). It is called `load_user_reasoning_context`.

The planner queries the knowledge DB with the phase goal and domain keywords, then holds the top results in a `USER_CONTEXT` variable that it references throughout planning (like a "what would the user want here?" guide).

---

**Step 1: Read the planner around the insertion point**

Read: `agents/gsd-planner.md`, lines 881–915

Locate `</step>` closing the `load_codebase_context` step, and the opening `<step name="identify_phase">` immediately after it.

---

**Step 2: Insert load_user_reasoning_context step**

Find this exact text:

```
</step>

<step name="identify_phase">
```

Insert the following block between those two steps:

```markdown
<step name="load_user_reasoning_context">
Query the knowledge DB for user reasoning context relevant to this phase.

Extract 2-3 keywords from the phase goal (e.g. for "implement sportsbook betting module" → "sportsbook", "betting"). Then run:

```bash
USER_CONTEXT=$(node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js \
  query-knowledge "{phase_goal_first_3_words}" 2>/dev/null || echo "[]")
```

If `USER_CONTEXT` is empty or returns an error: log "No relevant user context found" and continue — this step is non-fatal.

If results exist: Hold them as a `<user_reasoning_context>` block. Throughout planning, treat these as strong signals of user intent:
- **Decisions**: Honor them unless CONTEXT.md explicitly overrides
- **Preferences**: Factor into task design (library choices, patterns, approach)
- **Principles**: Use as quality bar for task acceptance criteria
- **Anti-patterns**: Do not reproduce these patterns in plans

Log: "User context loaded: {N} items retrieved from knowledge DB"
</step>

```

---

**Step 3: Verify insertion**

```bash
grep -n "load_user_reasoning_context\|load_codebase_context\|identify_phase" \
  agents/gsd-planner.md | head -10
```

Expected: `load_codebase_context` line number < `load_user_reasoning_context` line number < `identify_phase` line number.

---

**Step 4: Commit**

```bash
git add agents/gsd-planner.md
git commit -m "feat(knowledge): query user reasoning context in planner before planning

Planner now queries the knowledge DB with phase goal keywords before
creating plans. Retrieved decisions, preferences, principles, and
anti-patterns are used as strong signals of user intent throughout
plan creation — honors user's established way of thinking."
```

---

## Task 4: Add knowledge query to gsd-executor.md

**Files:**
- Modify: `agents/gsd-executor.md`

**Context:** The executor implements plans task-by-task. Before executing, it should know your preferences and decisions so it makes implementation choices aligned with your thinking — not generic defaults. For example: if the knowledge DB says "always use TypeScript strict mode", the executor should apply that when writing new files without needing to be told each time.

The step inserts after `load_plan` (around line 71) and before `record_start_time` (line 89). It queries the knowledge DB using the phase goal from the plan's frontmatter.

---

**Step 1: Read the executor around the insertion point**

Read: `agents/gsd-executor.md`, lines 71–95

Locate the `</step>` closing `load_plan`, and the opening `<step name="record_start_time">`.

---

**Step 2: Insert load_user_reasoning_context step**

Find this exact text in `agents/gsd-executor.md`:

```
</step>

<step name="record_start_time">
```

Insert the following block between those two steps:

```markdown
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

```

---

**Step 3: Verify insertion**

```bash
grep -n "load_user_reasoning_context\|load_plan\|record_start_time" \
  agents/gsd-executor.md | head -10
```

Expected: `load_plan` line < `load_user_reasoning_context` line < `record_start_time` line.

---

**Step 4: Install updated agents**

The agents in `/Users/ollorin/get-shit-done/agents/` are the source. After editing, deploy:

```bash
node /Users/ollorin/get-shit-done/bin/install.js 2>/dev/null || \
  echo "Check install script — agents may need manual copy to ~/.claude/agents/"
```

Verify installed:
```bash
grep -l "load_user_reasoning_context" ~/.claude/agents/*.md
```

Expected: both `gsd-planner.md` and `gsd-executor.md` listed.

---

**Step 5: Commit**

```bash
git add agents/gsd-executor.md
git commit -m "feat(knowledge): query user reasoning context in executor before tasks

Executor now queries the knowledge DB before executing tasks.
Retrieved preferences, decisions, and anti-patterns are applied as
implicit constraints throughout implementation — e.g. library choices,
code patterns, architectural principles from past sessions."
```

---

## Smoke Test: Verify end-to-end

After all 4 tasks are committed:

**1. Verify Stop hook does nothing harmful:**
```bash
echo '{"session_id":"smoke-test","last_assistant_message":"test","stop_hook_active":false}' \
  | node ~/.claude/get-shit-done/bin/hooks/session-end-standalone.js && echo "OK"
```
Expected: `OK`, exit 0.

**2. Verify mine-conversations can find sessions to harvest:**
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js \
  mine-conversations --all-projects --max-age-days 3 --limit 1 2>/dev/null
```
Expected: JSON with `status`, `sessionsReady` (number ≥ 0). No error.

**3. Verify query-knowledge works:**
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js query-knowledge "igaming sportsbook" 2>/dev/null
```
Expected: JSON array (may be empty if no relevant entries yet). No error.

**4. Verify agents have the new step:**
```bash
grep -c "load_user_reasoning_context" ~/.claude/agents/gsd-planner.md
grep -c "load_user_reasoning_context" ~/.claude/agents/gsd-executor.md
grep -c "harvest_knowledge" ~/.claude/agents/gsd-phase-coordinator.md
```
Expected: each prints `1`.

---

## After This — Backfill Last 30 Days

Once the system is wired, populate the knowledge DB from your igaming-platform work:

```
/gsd:mine-conversations --all-projects --max-age-days 30 --limit 50
```

Run multiple times (with dedup it's safe to repeat) until all conversations are processed. The more conversations processed, the richer the context agents will have.
