# Model Profile "auto" Design Report

**Document Date:** 2026-03-09
**Status:** Research & Design Analysis
**Scope:** Complete auto-routing implementation in GSD system
**Configuration:** `model_profile: "auto"` in `.planning/config.json`

---

## Executive Summary

The GSD system implements **three model assignment modes**:

1. **"auto" mode** (current setting) — Automatic intelligent routing using task complexity analysis
2. **Other profiles** (e.g., "quality", unspecified) — Default to sonnet for all executions
3. **Hardcoded overrides** — Several support agents always use fixed tiers regardless of mode

The **"auto" profile is implemented as a two-pass system**:

- **Planning phase:** Planner spawns task-router agent to analyze each task and assign haiku/sonnet/opus
- **Execution phase:** Coordinator reads task tiers from PLAN.md and spawns executor agents with matched models

This enables **per-task model selection** while maintaining plan consistency and determinism.

---

## 1. Configuration & Activation

### Where model_profile is Defined

**File:** `/Users/ollorin/get-shit-done/.planning/config.json`

```json
{
  "model_profile": "auto",
  "coordinator_model": "sonnet"
}
```

**Lines:** Line 6 in config.json
**Default value:** If config.json missing or key absent, defaults to `"quality"`

### How It's Read

**Phase Coordinator (execute step):**

```bash
# File: agents/gsd-phase-coordinator.md, lines 562-568
CONFIG_FILE=".planning/config.json"
if [ -f "$CONFIG_FILE" ]; then
  MODEL_PROFILE=$(jq -r '.model_profile // "quality"' "$CONFIG_FILE")
else
  MODEL_PROFILE="quality"
fi
```

**Planner (routing_pass step):**

```bash
# File: agents/gsd-planner.md, lines 1169-1171
MODEL_PROFILE=$(node ~/.claude/get-shit-done/bin/gsd-tools.js config get model_profile 2>/dev/null || echo "quality")
```

---

## 2. The Auto-Routing Architecture

### Two-Phase System

#### Phase 1: Planning (Task Tier Assignment)

**Triggered by:** `gsd-planner` agent after writing all PLAN.md files
**Condition:** `MODEL_PROFILE == "auto"`
**Location:** `agents/gsd-planner.md`, lines 1166-1229 (`<step name="routing_pass">`)

**Process:**

1. **Extract all tasks** from the newly-written PLAN.md:
   - Parse `<name>` element for task title
   - Parse `<action>` element for full task description
   - Build task list with index, name, and action content

2. **Spawn task-router agents in parallel** (one per task):
   ```
   For each task:
     Task(
       subagent_type="gsd-task-router",
       prompt="Route this task: {task.name}\n\nTask action summary: {task.action}"
     )
   ```
   - Uses `Promise.all()` to parallelize requests
   - Each router agent runs independently

3. **Parse routing decisions**:
   - Extract `Model:` line from each ROUTING DECISION response
   - Parse as regex: `/^Model:\s*(haiku|sonnet|opus)/m`
   - Default to `haiku` if parse fails

4. **Inject `<model>` elements into PLAN.md**:
   - Insert after each `<name>` closing tag
   - Example: `<name>Task 3: Add config field</name>\n  <model>haiku</model>`
   - One model element per task

5. **Consistency check**:
   - Scan for structurally similar tasks (same verb + same target pattern)
   - If similar tasks got different tiers, downgrade all to lowest tier

6. **Log decisions**:
   - Write summary to EXECUTION_LOG.md (best-effort)
   - Format: `{"plan":"...","phase":{N},"decisions":[{"index":1,"name":"...","tier":"..."}...]}`

**Failure handling:**
- If a task-router call fails for one task, default that task to haiku and continue
- If MODEL_PROFILE check fails, skip routing pass entirely
- Plan commits happen AFTER routing pass completes

---

#### Phase 2: Execution (Model-Based Spawn)

**Triggered by:** `gsd-phase-coordinator` agent in execute step
**Condition:** `MODEL_PROFILE == "auto"` AND at least one task has explicit `<model>` tag
**Location:** `agents/gsd-phase-coordinator.md`, lines 580-700+

**Detection Logic:**

```bash
# Parse all <task> elements from PLAN.md
For each task in PLAN.md:
  model_el = extract <model> element (new format)
  OR extract [tier] prefix from task name (legacy format)

If at least one task has explicit tier:
  PER_TASK_MODE = true  (use per-task routing)
Else:
  PER_TASK_MODE = false  (fall back to plan-level routing)
```

**Two routing sub-modes:**

##### 2a. Per-Task Mode (NEW FORMAT)

Triggered when: PLAN.md contains `<model>` elements in tasks

**Process:**
1. For each task (in dependency/wave order):
   - Read TASK_TIER from `<model>` element

2. **Apply lightweight quota downgrade:**
   ```bash
   QUOTA_JSON=$(node ~/.claude/get-shit-done/bin/gsd-tools.js quota status --json)
   session_percent = QUOTA_JSON.session.percent

   If session_percent > 95:
     TASK_TIER = "haiku"  # critical conservation
   Elif session_percent > 80 AND TASK_TIER == "opus":
     TASK_TIER = "sonnet"  # downgrade opus only
   Else:
     # Keep tier as-is
   ```

3. **Spawn per-task executor:**
   ```
   Task(
     subagent_type="gsd-executor",
     model="{TASK_TIER}",
     prompt="Execute task {task_index} of plan..."
   )
   ```

4. **Track tier assignments:**
   - Maintain ROUTING_STATS: `{ haiku: N, sonnet: M, opus: K }`
   - Used for final SUMMARY.md reporting

---

##### 2b. Plan-Level Routing (FALLBACK)

Triggered when: PLAN.md has NO `<model>` elements in tasks

**Process:**
1. Extract plan objective from `<objective>` tag

2. Spawn single task-router agent:
   ```
   Task(
     subagent_type="gsd-task-router",
     prompt="Route this task: {PLAN_OBJECTIVE}"
   )
   ```

3. Parse ROUTING DECISION response for model tier and context

4. Spawn single executor with that tier:
   ```
   Task(
     subagent_type="gsd-executor",
     model="{EXECUTOR_MODEL}",
     prompt="Execute plan {plan_number}..."
   )
   ```
   - Includes `<routing_context>` block with injected docs

---

### The Task Router Agent

**File:** `/Users/ollorin/get-shit-done/agents/gsd-task-router.md`

**Role:** Determines optimal model tier using LLM reasoning + quota state
**Spawned by:** Planner (per-task routing pass) or Coordinator (plan-level routing)

**Decision Process:**

#### 1. Complexity Reasoning (lines 18-70)

Applies a **complexity rubric with target distribution**:

- **~55% Haiku** (default tier) — well-specified tasks
- **~30% Sonnet** — multi-step work with judgment
- **~15% Opus** — hardest decisions only

**Haiku tier indicators:**
- Bug with clear description and location
- Add field, rename variable, update config
- Write tests for already-designed feature
- Implement with fully-specified signature
- CRUD endpoints, form fields, UI tweaks
- Update dependency, bump version
- Task where plan already answers "how"
- Mechanical search-and-replace with given strings
- SQL migrations where schema is defined
- Unit tests for specified implementations
- Integration tests for existing endpoints
- Export/re-export from index file
- Run migrations and verify

**Sonnet tier indicators:**
- Refactor where target structure not fully specified
- Debug issue where root cause unknown
- Feature touching multiple files with coherent design needed
- Integration tests requiring novel infrastructure
- Partially-specified "how" requiring non-obvious details
- Investigate and fix known failures
- Write/update documentation with clear content
- Schema design from requirements
- Verification tasks

**Opus tier indicators:**
- Design decisions with multiple valid approaches, no clear answer
- Debug completely unknown root cause across multiple systems
- Breaking changes with system-wide tradeoffs

**Key principle:** "When in doubt, go one tier down."

---

#### 2. Quota Adjustment (lines 73-84)

```
Check quota status:
node ~/.claude/get-shit-done/bin/gsd-tools.js quota status --json

Read session.percent:
- >95%: downgrade any model to haiku (critical conservation)
- >80%: downgrade opus → sonnet only
- ≤80% or command fails: keep reasoned tier
```

---

#### 3. Context Injection (lines 86-94)

Fetches relevant docs for the task:

```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js routing context "{TASK_DESCRIPTION}" --json
```

Extracts up to 3 matching docs. Used by coordinator to inject context into executor prompt.

---

#### 4. Decision Output Format (lines 96-131)

```
ROUTING DECISION
================
Task: {task description}
Model: {haiku|sonnet|opus}
Reasoning: {one sentence — why this tier}
Quota: {session.percent}% used{, adjusted: {original}→{new} if downgraded}

Context injection:
- {doc path 1}
- {doc path 2}
- {doc path 3}
(or: No relevant context docs found)
```

Followed by optional telemetry (best-effort):

```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js log-feature-event \
  --project-path <cwd> \
  --type MODEL_SELECTED \
  --data '{"model":"<selected>","task_type":"<type>"}'
```

---

## 3. Executor Integration

### How Executor Receives Model Assignments

**File:** `/Users/ollorin/get-shit-done/agents/gsd-executor.md`

**Lines:** 34-89 (auto_mode_detection and load_plan steps)

#### Routing Context Extraction

When coordinator passes routing context in prompt:

```
<routing_context>
Auto mode active. Routed to {EXECUTOR_MODEL} (score: {ROUTING_SCORE}).
Relevant context injected by router:
{ROUTING_CONTEXT}
</routing_context>
```

Executor parses this:

```
Extract from prompt:
  ROUTED_TIER = parse tier from "This task routed to {tier}" line
  If no routing_context or parse fails: ROUTED_TIER = null
```

**Lines:** 85-89

#### Failure Signaling (Lines 140-148)

When a routed task fails with errors and all retries exhausted:

```
If ROUTED_TIER is set AND task fails AND all retries exhausted:
  Return failure with structured signal:
    "TASK FAILED: {task_name} [tier: {ROUTED_TIER}] — {error_summary}"

  This format allows coordinator to decide to re-spawn at higher tier.

If ROUTED_TIER is null (routing not active):
  Return failure using existing behavior (no structured tag)
```

#### Routing Summary in SUMMARY.md (Lines 446-461)

```markdown
## Routing

| Task | Routed Tier | Escalated |
|------|-------------|-----------|
| 1    | haiku       | no        |
| 2    | sonnet      | no        |
| 3    | haiku       | yes → sonnet |

Distribution: {haiku_count} haiku / {sonnet_count} sonnet / {opus_count} opus
Escalations: {count} (haiku → sonnet on retry)
```

Omitted entirely if ROUTED_TIER was null for all tasks (routing not active — non-auto profile).

---

## 4. Hardcoded Model Assignments (GAPS)

Several agents and flows use **fixed models regardless of mode**:

| Location | Agent/Role | Model | Condition | Lines |
|----------|-----------|-------|-----------|-------|
| **Coordinator** | Session knowledge mining | Haiku | Always | 68 |
| **Coordinator** | Meta-answerer (Q&A) | Sonnet | Always | 219 |
| **Coordinator** | Charlotte QA (web testing) | Haiku | Always | 785 |
| **Coordinator** | UI fix after QA | Haiku or Sonnet | Dynamic (severity-based) | 852 |
| **Coordinator** | Charlotte QA retry | Sonnet | Second+ attempts | 964, 1000 |
| **Coordinator** | Verifier (phase goal check) | Sonnet | Always | 1027 |
| **Coordinator** | Integration tester | Sonnet | Always | 1091 |

### Analysis of Hardcoded Assignments

**Files:** `/Users/ollorin/get-shit-done/agents/gsd-phase-coordinator.md`

#### 1. Knowledge Mining (Line 68)
```
subagent_type="general-purpose",
model="haiku"
```
**Purpose:** Extract decisions, reasoning patterns, meta-knowledge from user sessions
**Rationale:** Simple extraction — well-scoped prompt, no judgment needed
**Assessment:** ✓ Appropriate for haiku (follows auto routing heuristics)

---

#### 2. Meta-Answerer Q&A (Line 219)
```
subagent_type="gsd-meta-answerer",
model="sonnet"
```
**Purpose:** Answer questions about phase goal, requirements, assumptions
**Rationale:** Requires reasoning about user intent and context
**Assessment:** ✓ Appropriate for sonnet (multi-step reasoning)

---

#### 3. Charlotte QA Testing (Line 785)
```
subagent_type="gsd-charlotte-qa",
model="haiku"
```
**Purpose:** Run automated web UI/UX testing
**Rationale:** Browser automation and checklist evaluation
**Assessment:** ✓ Appropriate for haiku (mechanical testing + observation)
**Note:** Tier escalates to sonnet on retry rounds if issues found (line 964)

---

#### 4. UI Fix Determination (Line 852)
```
model="{FIX_TIER}"  where:
  if severity.critical > 0 OR severity.high > 0:
    FIX_TIER = "sonnet"
  else:
    FIX_TIER = "haiku"
```
**Purpose:** Fix UI/UX issues found by QA
**Rationale:** Dynamic scaling based on issue severity
**Assessment:** ⚠️ **Partially manual** — follows auto logic but hardcodes severity thresholds
**Gap:** Not integrated into central routing decision

---

#### 5. Verifier (Line 1027)
```
subagent_type="gsd-verifier",
model="sonnet"
```
**Purpose:** Verify phase goal achievement against must_haves
**Rationale:** Requires judgment about plan success and gap analysis
**Assessment:** ✓ Appropriate for sonnet (complex verification logic)
**Gap:** Could benefit from auto routing if verification tasks vary in complexity

---

#### 6. Integration Tester (Line 1091)
```
subagent_type="gsd-integration-tester",
model="sonnet"
```
**Purpose:** Test phase integration points with dependencies
**Rationale:** Requires multi-phase traceability and API/DB testing
**Assessment:** ✓ Appropriate for sonnet (multi-system reasoning)
**Gap:** Could be haiku if integration is well-specified, but current approach is conservative

---

### Gaps Summary

1. **No dynamic routing for support agents:**
   - Charlotte QA, Verifier, Integration Tester all have fixed tiers
   - Could benefit from complexity-based scaling

2. **UI fix severity mapping is hardcoded:**
   - Uses inline logic (critical/high → sonnet) rather than routing agent
   - Threshold values (critical count > 0) not configurable

3. **No per-task routing for checkpoint/QA loops:**
   - Charlotte QA spawns multiple rounds with static tier escalation
   - Could use task-router to re-evaluate after first issues found

---

## 5. Complete Model Assignment Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ User Configuration: .planning/config.json               │
│ model_profile: "auto"                                   │
└───────────────────┬─────────────────────────────────────┘
                    │
        ┌───────────▼─────────────┐
        │ PLANNER Agent Starts    │
        │ (model_profile check)   │
        └───────────┬─────────────┘
                    │
        ┌───────────▼──────────────────────────┐
        │ IF model_profile == "auto":          │
        │   → Routing Pass (lines 1166-1229)   │
        │ ELSE:                                │
        │   → Skip routing (use default)       │
        └───────────┬──────────────────────────┘
                    │
        ┌───────────▼──────────────────────────────────────┐
        │ Routing Pass: Spawn task-router per task        │
        │                                                  │
        │ For each task in PLAN.md:                       │
        │   - Extract <name> and <action>                │
        │   - Spawn: Task(gsd-task-router)               │
        │   - Collect: Model decision (haiku/sonnet/opus) │
        │   - Inject: <model>{tier}</model>              │
        │   - Check: Consistency (similar tasks)          │
        │                                                  │
        │ Result: PLAN.md with <model> elements          │
        └───────────┬──────────────────────────────────────┘
                    │
        ┌───────────▼─────────────────────────┐
        │ Plans written to disk                │
        │ Ready for execution                  │
        └───────────┬─────────────────────────┘
                    │
        ┌───────────▼─────────────────────────────────────┐
        │ COORDINATOR Agent Starts execute step          │
        │ (reads .planning/config.json again)            │
        │                                                  │
        │ IF model_profile == "auto":                    │
        │   → Parse PLAN.md for <model> tags             │
        │   → Determine routing mode                      │
        │ ELSE:                                          │
        │   → Use fixed executor_model (default sonnet)   │
        └───────────┬─────────────────────────────────────┘
                    │
        ┌───────────▼──────────────────────────────┐
        │ Route Detection                          │
        │                                          │
        │ IF PLAN.md has <model> elements:        │
        │   PER_TASK_MODE = true                   │
        │   → Spawn executor per task             │
        │   → Each gets its own tier              │
        │                                          │
        │ ELSE:                                    │
        │   PER_TASK_MODE = false                  │
        │   → Spawn plan-level task-router        │
        │   → Get single executor model           │
        │   → Spawn executor with that model      │
        └───────────┬──────────────────────────────┘
                    │
        ┌───────────▼──────────────────────────────────────┐
        │ Per-Task Mode Execution                         │
        │                                                  │
        │ For each task (in dependency order):            │
        │   1. Read TASK_TIER from <model> element       │
        │   2. Check quota (>95%→haiku, >80%+opus→sonnet) │
        │   3. Spawn executor: Task(model=TASK_TIER)     │
        │   4. Track: ROUTING_STATS[TASK_TIER] += 1      │
        │   5. Executor runs, commits                    │
        │   6. If fails + routed: signal tier for retry   │
        └───────────┬──────────────────────────────────────┘
                    │
        ┌───────────▼──────────────────────────────┐
        │ Plan-Level Mode Execution (Fallback)     │
        │                                          │
        │ 1. Extract plan objective                │
        │ 2. Spawn task-router for plan objective  │
        │ 3. Parse routing decision                │
        │ 4. Spawn single executor: Task(model=...) │
        │ 5. Executor processes all tasks          │
        │ 6. Executor creates SUMMARY.md           │
        └───────────┬──────────────────────────────┘
                    │
        ┌───────────▼───────────────────────────┐
        │ Post-Execution                        │
        │                                       │
        │ SUMMARY.md created with:              │
        │   - Routing section (if routed)      │
        │   - Distribution stats                │
        │   - Escalation log                    │
        │                                       │
        │ EXECUTION_LOG.md updated with routing │
        │ decisions                             │
        └───────────────────────────────────────┘

│ Support Agents (ALWAYS HARDCODED):
│   - Knowledge mining (haiku)
│   - Meta-answerer (sonnet)
│   - Charlotte QA (haiku, sonnet on retry)
│   - UI fixer (dynamic: severity-based)
│   - Verifier (sonnet)
│   - Integration tester (sonnet)
```

---

## 6. Decision Points & Logic

### When Auto Routing Is Active

1. **PLANNING PHASE:**
   - Model profile checked: `config get model_profile`
   - If "auto" → spawn task-router per task
   - Each router uses complexity + quota to decide tier
   - Decisions injected into PLAN.md as `<model>` elements

2. **EXECUTION PHASE:**
   - Model profile checked again: `config get model_profile`
   - If "auto" → check for `<model>` elements in PLAN.md
   - If found → per-task mode (sequential execution per tier)
   - If not found → plan-level routing (single task-router call)

3. **QUOTA DOWNGRADE (execution only):**
   - Applied per-task after routing decision
   - Only caps opus→sonnet at 80%+, or all→haiku at 95%+
   - Planning phase does not check quota

4. **FAILURE ESCALATION:**
   - Executor can signal routed task failures with tier info
   - Coordinator receives: `TASK FAILED: {name} [tier: {ROUTED_TIER}] — {error}`
   - Coordinator (not implemented in current code) could re-spawn at higher tier

---

### When Auto Routing Is NOT Active

1. Model profile is "quality", "speed", or unset
2. Coordinator skips all routing detection
3. Uses hardcoded `coordinator_model` from config (default: sonnet)
4. All executors spawn with that fixed model
5. No `<model>` elements injected into PLAN.md
6. No routing decisions logged

---

## 7. Supporting Infrastructure

### The Task Router Skill

**File:** `/Users/ollorin/get-shit-done/skills/task-context/SKILL.md`

Alternative interface to routing without spawning full agent:

```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js routing full "<task description>"
```

**Output:** JSON with:
- `model`: Recommended tier
- `context`: Array of matched docs
- `claude_md`: Relevant keywords

**Purpose:** Fast task context + model recommendation without agent spawn
**Usage:** Optional — coordinator uses direct task-router agent spawns

---

### Routing Commands (gsd-tools.js)

Referenced in agents but implementation not fully read:

```bash
# Check if auto mode is active
node ~/.claude/get-shit-done/bin/gsd-tools.js config get model_profile

# Get routing context docs
node ~/.claude/get-shit-done/bin/gsd-tools.js routing context "<task>" --json

# Log routing decision
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type routing_decision \
  --data '...'

# Check quota for downgrade decision
node ~/.claude/get-shit-done/bin/gsd-tools.js quota status --json
```

---

## 8. Current Execution Statistics

### Distribution Targets (Task Router Rubric)

Designed for:
- **55% Haiku** — well-specified work
- **30% Sonnet** — judgment required
- **15% Opus** — hard decisions only

### Memory (MEMORY.md Context)

- Phase 1 status: Complete (4/5 verified, AUTO-10 accepted as-is)
- Baseline: All-Opus kept for reference
- Config: `.planning/config.json` model_profile set to "auto"

---

## 9. GAPS & Design Issues

### Gap 1: Support Agent Tiers Are Hardcoded

**Problem:**
- Meta-answerer, Verifier, Integration Tester always spawn at sonnet
- Charlotte QA always starts at haiku, escalates to sonnet on retry
- No central routing decision for these agents

**Impact:**
- Sub-optimal for simple verification (could use haiku)
- Conservative for complex integration testing (sonnet always)
- Token waste on simple verification tasks

**Recommendation:**
- Extend task-router to evaluate support agent prompts
- Make Meta-answerer, Verifier tier choices dynamic based on question/phase complexity
- Keep Integration Tester at sonnet (multi-system reasoning justified)

---

### Gap 2: No Failure-Based Escalation

**Problem:**
- Executor can signal routed task failures with tier info (line 143-148)
- Format includes: `[tier: {ROUTED_TIER}]` for coordinator to detect
- **But:** No code shown for coordinator actually re-spawning at higher tier

**Impact:**
- Haiku task failures don't automatically retry at sonnet
- Coordinator would need new logic block to:
  1. Parse failure signal
  2. Extract tier
  3. Decide whether to re-spawn (at sonnet or opus)
  4. Track escalation in SUMMARY.md

**Status:** Signaling structure exists, escalation logic not implemented

**Recommendation:**
- Implement coordinator escalation handler:
  ```
  If failure signal [tier: haiku]:
    Re-spawn at sonnet (1 retry)
  If failure signal [tier: sonnet]:
    Re-spawn at opus (1 retry)
  If failure signal [tier: opus]:
    Escalate to human (architecture block)
  ```

---

### Gap 3: Quota Check Only in Execution

**Problem:**
- Planner spawns task-routers WITHOUT checking quota
- Task-router itself checks quota (in check_quota step)
- But planner doesn't pre-filter based on available quota

**Impact:**
- If quota >95% during planning, tasks still routed to sonnet/opus
- Executor later downgrades them to haiku
- Inconsistency between PLAN.md tier and actual spawn tier

**Status:** Minor — executor downgrade happens, but PLAN.md doesn't match execution

**Recommendation:**
- Planner could pre-downgrade tiers if quota >80% before routing pass
- Or: Task-router's quota-aware decision already handles this (acceptable)

---

### Gap 4: Consistency Check Logic Underdefined

**Problem:**
- Planner performs consistency check: "scan for structurally similar tasks"
- "If similar tasks got different tiers, downgrade all to lowest tier"
- Definition of "structurally similar" unclear:
  - Same verb + same target pattern?
  - Regex matching on task names?
  - Semantic similarity?

**Impact:**
- Unclear when consistency override triggers
- Could silently downgrade tasks without clear reason

**Status:** Documented but vague (lines 1208)

**Recommendation:**
- Define similarity criteria precisely:
  ```
  Tasks match if:
  - First verb is identical (Extract, Add, Fix, Refactor, etc.)
  - Last noun is identical (config, field, table, etc.)
  Example: "Add config field" and "Add config validation" → match
  ```

---

### Gap 5: Legacy [tier] Name Prefix Support

**Problem:**
- Coordinator supports TWO formats for task tiers:
  1. NEW: `<model>haiku</model>` element (recommended)
  2. LEGACY: `[haiku] Task name` prefix in name element
- Both formats detected, but PLAN.md routing pass ONLY injects new format
- Could lead to mixed formats in plans

**Impact:**
- Legacy format supported at execution, but not created by planner
- Backwards compat works, but encourages format divergence

**Status:** Acceptable (both formats handled), but path forward should deprecate legacy

**Recommendation:**
- Mark legacy format as deprecated in agent documentation
- Add note: "Only `<model>` elements will be created by new routing pass"
- Executor continues supporting both for now

---

### Gap 6: Plan-Level Routing is Underspecified

**Problem:**
- Fallback to plan-level routing IF no tasks have `<model>` elements
- This covers "older plan format" (legacy plans)
- But current planner ALWAYS injects `<model>` elements when auto mode active
- Plan-level routing will rarely trigger

**Impact:**
- Edge case that works but is rarely exercised
- Could hide bugs if plan structure changes

**Status:** Defensive code (acceptable fallback)

**Recommendation:**
- Simplify: Assume all new plans have `<model>` elements
- Plan-level routing kept for backwards compat only
- Document: "Plan-level routing only used for legacy plans written before routing pass"

---

### Gap 7: No Routing Decision Persistence Across Sessions

**Problem:**
- Routing decisions written to EXECUTION_LOG.md (best-effort)
- But PLAN.md is the source of truth for tiers
- If user re-runs coordinator, reads same PLAN.md, gets same tiers
- No history of why tiers were chosen (quota state, reasoning, etc.)

**Impact:**
- Can't analyze routing decisions without re-reading execution log
- No way to replay routing decisions or understand tier evolution

**Status:** Acceptable (PLAN.md + execution log sufficient)

**Recommendation:**
- Optional: Create `.planning/routing-history.jsonl` per plan
- Each entry: `{"phase":1,"plan":1,"timestamp":"...","decisions":[...]}`
- Enables analysis of how tiers change as quota fluctuates

---

## 10. Command Reference

### User Configuration

```bash
# View current model profile
jq '.model_profile' .planning/config.json

# Set to auto mode (per-task routing)
jq '.model_profile = "auto"' .planning/config.json > temp.json && mv temp.json .planning/config.json

# Set to quality mode (default sonnet)
jq '.model_profile = "quality"' .planning/config.json > temp.json && mv temp.json .planning/config.json
```

### Planner Routing Pass

Automatically runs when:
```
MODEL_PROFILE == "auto" (from config)
After: PLAN.md files written to disk
Before: validate_plan step
```

Triggered by:
- `/gsd:plan-phase` workflow
- Manual planner agent spawn with routing_pass step

### Coordinator Routing Detection

Automatically runs when:
```
In execute step:
  Check config.json model_profile
  IF "auto":
    Parse PLAN.md for <model> elements
    Determine per-task vs plan-level routing
```

Triggered by:
- `execute-roadmap` coordinator (per phase)
- Direct executor spawn with routing context

### Manual Testing

```bash
# Test task-router on a sample task
Task(
  subagent_type="gsd-task-router",
  prompt="Route this task: Implement user authentication with JWT"
)

# Check routing decisions in execution log
grep "routing_decision\|routing_decisions" .planning/EXECUTION_LOG.md

# View SUMMARY.md routing section
grep -A 10 "^## Routing" .planning/phases/*/01-PLAN-SUMMARY.md
```

---

## 11. Recommended Reading Order

For a complete understanding:

1. **Config & Architecture:** This document, Section 2-5
2. **Task Router Agent:** `/Users/ollorin/get-shit-done/agents/gsd-task-router.md`
3. **Planner Routing Pass:** `/Users/ollorin/get-shit-done/agents/gsd-planner.md` lines 1166-1229
4. **Coordinator Execute Step:** `/Users/ollorin/get-shit-done/agents/gsd-phase-coordinator.md` lines 552-700+
5. **Executor Integration:** `/Users/ollorin/get-shit-done/agents/gsd-executor.md` lines 34-89, 140-148, 446-461

---

## 12. Summary Table

| Component | Location | Mode Check | Inputs | Output | Status |
|-----------|----------|-----------|--------|--------|--------|
| **Config** | `.planning/config.json` line 6 | N/A | User-set | model_profile value | ✓ Active |
| **Planner Routing** | `gsd-planner.md` 1166-1229 | `config get model_profile` | PLAN.md + tasks | `<model>` injected | ✓ Active |
| **Task Router** | `gsd-task-router.md` | N/A (spawned by planner/coordinator) | Task description | Model: haiku/sonnet/opus | ✓ Active |
| **Coordinator Routing** | `gsd-phase-coordinator.md` 560-700 | `config.json` model_profile | PLAN.md `<model>` tags | EXECUTOR_MODEL or per-task | ✓ Active |
| **Executor Integration** | `gsd-executor.md` 34-89, 140-148 | Prompt `<routing_context>` | ROUTED_TIER from coordinator | Commit, signal failures | ✓ Active |
| **Failure Escalation** | `gsd-coordinator.md` + `gsd-executor.md` | Structured failure signal | `[tier: {tier}]` | Re-spawn logic | ⚠️ Partial (signaling works, escalation not shown) |
| **Support Agents** | `gsd-phase-coordinator.md` 68, 219, 785, 852, 1027, 1091 | N/A (hardcoded) | Agent-specific | Fixed model (or severity-based) | ⚠️ Hardcoded, not auto-routed |

---

## Conclusion

The `model_profile: "auto"` system is **fully implemented and active** with:

✓ **Working components:**
- Config-driven activation
- Planner routing pass with per-task task-router spawns
- Coordinator per-task routing with dynamic quota adjustments
- Executor integration with failure signaling
- Comprehensive logging and SUMMARY.md reporting

⚠️ **Known gaps & optimization opportunities:**
- Support agent tiers hardcoded (could be dynamic)
- Failure escalation signaling ready but escalation logic not shown
- Quota check only in execution, not planning
- Legacy format support adds complexity
- Plan-level routing rarely triggered

The system is production-ready for its designed use case: optimizing token spend across phases by matching model tier to task complexity while respecting quota constraints.

