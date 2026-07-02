# Planning & Coordination Agents — Deep Analysis

## Inventory (agent + size + role)

| Agent | Size | Role |
|-------|------|------|
| gsd-phase-coordinator.md | 68.5K | Orchestrates full phase lifecycle: discuss→research→plan→execute→verify |
| gsd-planner.md | 56.6K | Creates executable plans with task breakdown and dependency analysis |
| gsd-verifier.md | 48.3K | Goal-backward verification: verifies codebase achieves phase goal |
| gsd-executor.md | 36.0K | Executes PLAN.md tasks atomically, creates SUMMARY.md |
| gsd-debugger.md | 36.8K | Scientific debugging with checkpoints and session management |
| gsd-plan-checker.md | 24.9K | Pre-execution verification: ensures plans WILL achieve goal |
| gsd-phase-researcher.md | 17.9K | Domain research for phase implementation |
| gsd-roadmapper.md | 18.8K | Creates project roadmaps with phase breakdown |
| gsd-integration-checker.md | 15.7K | Verifies cross-phase integration boundaries |
| gsd-codebase-mapper.md | 15.7K | Explores and documents codebase structure |
| gsd-project-researcher.md | 15.4K | Ecosystem research for new projects |
| gsd-charlotte-qa.md | 17.8K | Automated UI/UX testing (Charlotte browser agent) |
| gsd-meta-answerer.md | 7.9K | Answers phase questions from knowledge DB |
| gsd-task-router.md | 8.2K | Determines optimal model tier (haiku/sonnet/opus) |
| gsd-discovery-synthesizer.md | 3.5K | Synthesizes product investigation results into PRD |
| gsd-docs-updater.md | 12.6K | Writes proportionally-scoped documentation |
| gsd-research-synthesizer.md | 6.6K | Synthesizes researcher outputs into SUMMARY.md |
| gsd-product-investigator.md | 4.7K | One-dimensional product investigation |
| gsd-e2e-test-generator.md | 4.8K | Generates E2E test scenarios from UI inventory |
| gsd-integration-tester.md | 4.1K | Tests cross-phase integration contracts |
| gsd-nyquist-auditor.md | 5.4K | Fills Nyquist validation gaps |
| gsd-test-writer.md | 4.7K | QA-focused test writing (not happy-path only) |
| gsd-ui-inventory.md | 2.6K | Scans web app for pages, components, modals |

**Total: ~400K characters (~12.5K lines)**

---

## How It Works (per agent: core flow, with file:line references)

### gsd-phase-coordinator.md — Full Phase Lifecycle

**Entry:** Spawned by execute-roadmap.md coordinator (line 11-15)

**Execution Cycle (lines 18-1500):**

1. **Initialization (lines 19-25):** Load telegram_topic_id for notifications; establish context budget monitoring thresholds (60% = compressed mode, 80% = fresh subagent)

2. **harvest_knowledge (lines 143-190):** Mine recent Claude Code sessions for decisions using `mine-conversations` command. Run parallel Haiku extractions for decision/reasoning/meta-knowledge on up to 5 sessions. Non-fatal if no sessions found.

3. **discuss (lines 192-549):**
   - Check for existing CONTEXT.md (line 196) — skip if present
   - Gray-area identification from phase goal and type heuristics (lines 228-254)
   - Generate 10-20 questions per gray area at 3 specificity levels (lines 257-296)
   - **Spawn gsd-meta-answerer (lines 310-330)** with Haiku tier to answer questions
   - **Confidence threshold: 0.7** — answers ≥0.7 marked sufficient, <0.7 need escalation (line 336)
   - **Six-criterion sensitivity check (lines 350-358):** Only escalate if irreversible/multi-phase-impact/architectural/data-loss-risk/conflicting-KB/always-ask
   - **Multi-turn Telegram escalation loop (lines 373-439)** for sensitive items (max 3 turns, JSONL logging)
   - **Merge escalated answers into CONTEXT.md (lines 462-464)**
   - **Write CONTEXT.md (lines 481-540)** with Implementation Decisions, Claude's Discretion, Escalated Decisions sections
   - Commit context file via gsd-tools `commit` command (line 546)

4. **research (lines 551-618):**
   - Check for RESEARCH.md — skip if present (line 553)
   - **Spawn gsd-phase-researcher (lines 567-573)** with Sonnet tier
   - Verify RESEARCH.md files created on disk (lines 576-578)
   - Commit research file (line 587)
   - Send "research done" Telegram notification (lines 607-617)

5. **plan (lines 620-703):**
   - Check for existing PLAN.md files — skip if present (lines 623-627)
   - **Spawn gsd-planner (lines 634-652)** with configurable model tier based on profile
   - **Hard-verify PLAN.md files exist on disk** (line 657) — CRITICAL fail if count==0
   - **Plan structure gate: run `gsd-tools.js verify plan-structure` (lines 666-678)** — validates tdd tasks + ui-qa checkpoints
   - **FAIL phase if gate_failures > 0** (lines 681-684)
   - Create checkpoint and Telegram notification (lines 692-701)

6. **execute (lines 705-941):**
   - Pre-flight: verify PLAN.md files exist (lines 708-712)
   - **Optional advisory checks (lines 715-732):** dependency drift and file conflicts (non-blocking)
   - **Model profile detection (lines 739-751):** Check config.json for `model_profile` setting
   - **Auto-mode task routing (lines 759-799):**
     - If auto profile: parse task-level `<model>` tags or legacy `[tier]` prefix
     - Per-task routing: spawn executor for each task sequentially with quota downgrade
     - Plan-level routing: spawn single routing agent (gsd-task-router) if no per-task tags
   - **Per-task executor spawning (lines 841-918)** with:
     - Quota downgrade at >95% (critical) and >80% (opus→sonnet only)
     - Haiku failure escalation: re-spawn at Sonnet if haiku task fails AND quota <95% (lines 902-917)
   - **Spot-check results (lines 920-924):** Verify SUMMARY.md + commits + no FAILED marker

7. **checkpoint_ui_qa_loop (lines 944-1257):**
   - Triggered by executor returning `## CHECKPOINT REACHED` with `Type: ui-qa`
   - **Auto-start dev server (lines 956-974):** Try service-health first, fall back to NX/npm, fail with human checkpoint if dead
   - **3-round QA loop (lines 993-1151):**
     - Round N: Spawn gsd-charlotte-qa (Haiku tier) in mode=ui-qa
     - If passed: continue
     - If round==3 and failing: escalate to Telegram + human checkpoint
     - Else: spawn fix subagent (Sonnet for critical/high, Haiku otherwise) with fix prompt
     - Retry up to 3 rounds
   - **UX audit after QA passes (lines 1157-1257):** Unconditional Charlotte UX sweep, fix critical/high issues
   - Commit fixes atomically per fix (no additional coordinator commits)

8. **post_phase_ux_sweep (lines 1304-1344):**
   - Detect web framework from package.json (lines 1269-1286)
   - **HARD RULE: UX sweep is MANDATORY for web projects** (line 1290)
   - If WEB_FRAMEWORK_DETECTED: run Charlotte UX audit unconditionally after all plans complete
   - No mechanism to skip — only option is user human-action checkpoint

9. **post_phase_e2e (lines 1346-1381):**
   - Collect e2e_flows from all plan frontmatters (lines 1352-1355)
   - If flows present: spawn gsd-charlotte-qa (mode=e2e)
   - Critical/High E2E failures create gap closure plans (BLOCKING)
   - Medium failures recorded in QA report; Low logged informational

10. **verify (lines 1383-1467):**
    - Initialize verification with `gsd-tools.js init verify-work {phase_number}` (line 1387)
    - **HARD RULE: Must spawn gsd-verifier** (line 1390) — coordinator writing VERIFICATION.md inline only allowed for timeouts
    - Model selection: Opus if must_haves ≥8, else Sonnet (lines 1402-1403)
    - **Verify VERIFICATION.md exists on disk** (lines 1424-1430) — CRITICAL fail if missing
    - Route by status: `passed` → send completion notification; `gaps_found` or `human_needed` → return respective state
    - Send phase_complete Telegram notification with duration + routing stats (lines 1437-1453)

**Context Budget Management (lines 50-141):**
- Estimate at each step: initialize 0%, increment ~5-10% per step
- At ≥60%: switch to compressed mode (terse output, skip diagnostics) — notify once
- At ≥80%: prepare handoff summary for verifier, return early with deferred steps rather than risk overflow

**Notification Logging (lines 23-47, 394-428, 425-428):**
- Append JSON lines to `.planning/telegram-sessions/{YYYY-MM-DD}.jsonl`
- Log types: `notification` (lifecycle), `escalation_question`, `escalation_reply`, `escalation_complete`, `context_budget`

### gsd-planner.md — Plan Creation

**Entry:** Spawned by `/gsd:plan-phase` orchestrator (line 12)

**Core Responsibilities (lines 8-26):**
- Parse and honor user decisions from CONTEXT.md (LOCKED decisions are non-negotiable)
- Decompose phase into parallel-optimized plans (2-3 tasks each)
- Build dependency graphs and assign execution waves
- Derive must-haves using goal-backward methodology

**User Decision Fidelity (lines 28-55):**
- Locked Decisions (from ## Decisions): MUST be implemented exactly
- Deferred Ideas (from ## Deferred Ideas): MUST NOT appear in plans
- Claude's Discretion (from ## Claude's Discretion): Planner's judgment

**Task Breakdown (lines 128-321):**
- Every task requires: `<files>`, `<action>`, `<verify>`, `<done>`
- Task types: `auto` (autonomous), `checkpoint:ui-qa` (web UI), `checkpoint:human-verify` (non-web), `checkpoint:decision`, `checkpoint:human-action`
- **Auto-add rule (line 164):** After any task creating/modifying web UI → add `checkpoint:ui-qa`
- **Testing Mandate (lines 216-261):**
  - Every implementation task → paired `tdd="true"` test task
  - Every UI plan → must have checkpoint:ui-qa
  - Every UI plan → must have `e2e_flows` in frontmatter (REQUIRED, not optional)
- Task sizing: 15-60 min execution time (line 272)

**Dependency Graph (lines 323-350):**
- Build DAG: for each task record `needs`, `creates`, `has_checkpoint`
- Assign waves: Wave 1 = no dependencies, Wave N = max(dependencies) + 1
- Identify parallel execution windows

**Discovery Protocol (lines 97-126):**
- Level 0 - Skip: pure internal, existing patterns only
- Level 1 - Quick: confirm single known library
- Level 2 - Standard: 15-30 min research for new external dependency
- Level 3 - Deep: 1+ hour for architectural decisions

### gsd-plan-checker.md — Pre-Execution Verification

**Entry:** Spawned by `/gsd:plan-phase` orchestrator after planner completes (line 14)

**Core Principle (lines 61-81):**
- Plan completeness ≠ Goal achievement
- Goal-backward verification: what must be true → artifacts → wiring → semantic correctness

**9 Verification Dimensions (lines 83-480):**

1. **Requirement Coverage (lines 85-111):** Every requirement ID from ROADMAP has task(s) addressing it
   - Extract requirements from roadmap (line 92)
   - Verify each in at least one plan's `requirements` frontmatter (line 93)
   - **FAIL if requirement has zero coverage**

2. **Task Completeness (lines 113-144):** Files + Action + Verify + Done per task type
   - Required fields by type: auto/tdd need all 4; checkpoints are N/A
   - Flag missing `<verify>` or vague `<action>`

3. **Dependency Correctness (lines 146-174):** Acyclic DAG, valid references
   - Parse `depends_on` from each plan frontmatter (line 151)
   - Check for cycles, missing refs, future refs
   - Wave assignment must match dependencies

4. **Key Links Planned (lines 176-208):** Artifacts wired together, not isolated
   - Verify component→API wiring exists
   - Verify API→Database wiring exists
   - Verify form submit handlers exist

5. **Scope Sanity (lines 210-243):** Tasks/plan = 2-3 (warn at 4, block at 5+); files/plan = 5-8 (warn at 10, block at 15+)

6. **Verification Derivation (lines 245-272):** must_haves trace back to goal
   - Truths must be user-observable, not implementation-focused
   - Artifacts must support truths

7. **Context Compliance (lines 274-315):** Plans honor CONTEXT.md decisions
   - Locked decisions have implementing tasks
   - No tasks implement Deferred Ideas
   - Task actions don't contradict locked decisions

8. **Testing Mandate Compliance (lines 317-371):**
   - **Check 8-T1:** Every implementation task has adjacent `tdd="true"` task → **BLOCKING FAIL if missing**
   - **Check 8-T2:** Every plan with .tsx/.jsx has `checkpoint:ui-qa` → **BLOCKING FAIL if missing**
   - **Check 8-T3:** No deferral language ("tests later", "QA deferred") → **BLOCKING FAIL if present**

9. **Nyquist Compliance (lines 373-471):** Skip if disabled in config.json or no RESEARCH.md
   - Check 9e: Verify VALIDATION.md exists → **BLOCKING FAIL if missing**
   - Checks 9a-9d: Automated verify presence, feedback latency, etc.

### gsd-task-router.md — Model Tier Selection

**Entry:** Spawned by gsd-phase-coordinator (lines 783-789) when plan has no per-task tier tags

**Reasoning Rubric (lines 32-84):**
- **Target distribution: ~55% Haiku, ~30% Sonnet, ~15% Opus**
- Default to Haiku unless specific escalation reason
- **Haiku (~55%):** Mechanical execution with clear spec (fix bug, add field, write tests for known feature, run tests, commit)
- **Sonnet (~30%):** Multi-step judgment work (refactor with design decisions, debug unknown root cause, write novel integration tests, write/update docs)
- **Opus (~15%):** Hardest decisions only (architecture with multiple valid approaches, debug across multiple systems, breaking changes with tradeoffs)

**Process (lines 30-145):**
1. Reason about complexity based on task signals (lines 32-84)
2. Check quota (lines 87-98): downgrade any→haiku at >95%, opus→sonnet at >80%
3. Fetch context docs (lines 100-108): optional context injection
4. Return decision in structured format (lines 110-145)

### gsd-verifier.md — Goal-Backward Verification

**Entry:** Spawned by gsd-phase-coordinator (lines 1405-1413)

**Core Principle (lines 16-33):**
- Task completion ≠ Goal achievement
- Goal-backward: what must be TRUE → artifacts → wiring → semantic correctness
- Semantic verification: wiring can be syntactically present but behaviorally inert

**Verification Process (lines 35-150):**

**Step 0:** Check for previous VERIFICATION.md with gaps → RE-VERIFICATION MODE (optimize on failed items only)

**Step 1:** Load context (PLAN + SUMMARY + ROADMAP + REQUIREMENTS)

**Step 2:** Establish must-haves:
- Option A: From PLAN frontmatter (line 72)
- Option B: Derive from phase goal (lines 95-103)
  - What must be TRUE? (observable behaviors)
  - What must EXIST? (artifact paths)
  - What must be CONNECTED? (wiring)

**Step 3:** Verify observable truths (status: VERIFIED/FAILED/UNCERTAIN)

**Step 4:** Verify artifacts at 3 levels:
- Level 1: exists (grep the file)
- Level 2: substantive (>50 lines, has expected patterns, not stub)
- Level 3: wired (imports/usage in other modules)

**Step 5:** Verify wiring — trace signal through entire chain, not just local compilation

---

## Redundancy Map (duplicated sections across agents, estimated wasted tokens)

### High-Redundancy Areas

#### 1. Project Context Discovery (appears in 8+ agents)
- **Files:** gsd-phase-coordinator.md, gsd-planner.md, gsd-plan-checker.md, gsd-phase-researcher.md, gsd-executor.md, gsd-verifier.md, gsd-debugger.md, gsd-codebase-mapper.md
- **Duplicated pattern (lines vary):**
  ```
  **Project instructions:** Read `./CLAUDE.md` if exists
  **Project skills:** Check `.claude/skills/` or `.agents/skills/`
  1. List available skills
  2. Read SKILL.md for each (~130 lines)
  3. Load specific `rules/*.md` as needed
  4. Do NOT load full AGENTS.md (100KB+ context cost)
  ```
- **Estimated redundancy:** ~800-1000 tokens per agent × 8 agents = **~6400-8000 tokens wasted**
- **Fix:** Extract to single reference document or shared preamble

#### 2. Frontmatter Parsing & Validation (appears in 6+ agents)
- **Files:** gsd-executor.md, gsd-plan-checker.md, gsd-verifier.md, gsd-planner.md, gsd-phase-researcher.md, gsd-debugger.md
- **Duplicated pattern:**
  ```bash
  frontmatter get {file} --field {key}
  frontmatter validate {file} --schema {type}
  ```
  With near-identical error handling and fallback logic
- **Estimated redundancy:** ~600-800 tokens per agent × 6 = **~3600-4800 tokens wasted**

#### 3. Context Budget Monitoring & Notification Patterns
- **Files:** gsd-phase-coordinator.md (lines 50-141), gsd-executor.md, gsd-verifier.md
- **Duplicated sections:**
  - Threshold definitions (60% compressed, 80% fresh subagent)
  - Heuristic estimation logic
  - JSONL logging format
  - Telegram notification construction
- **Estimated redundancy:** ~700 tokens per agent × 3 = **~2100 tokens wasted**

#### 4. Goal-Backward Verification Principle (appears in 3+ agents)
- **Files:** gsd-plan-checker.md (line 61-81), gsd-verifier.md (line 16-33), gsd-planner.md (referenced implicitly)
- **Identical teaching pattern:** Task completion ≠ goal achievement
- **Estimated redundancy:** ~300 tokens × 3 = **~900 tokens wasted**

#### 5. Dependency Graph Building (appears in 3 agents)
- **Files:** gsd-phase-coordinator.md, gsd-planner.md (lines 323-350), gsd-plan-checker.md (lines 146-174)
- **Duplicated logic:** Wave assignment = max(dependencies) + 1, cycle detection
- **Estimated redundancy:** ~400 tokens × 3 = **~1200 tokens wasted**

#### 6. Model Routing Decision Format (appears in coordinator + executor + others)
- **Files:** gsd-phase-coordinator.md (lines 759-799), gsd-executor.md (lines 87-147), gsd-task-router.md (lines 110-145)
- **Duplicated:** Per-task tier parsing, quota downgrade logic, failure signaling format
- **Estimated redundancy:** ~500 tokens × 3 = **~1500 tokens wasted**

#### 7. Checkpoint:ui-qa Rules (appears in 4 agents)
- **Files:** gsd-planner.md (lines 162-214), gsd-phase-coordinator.md (lines 944-1257), gsd-executor.md, gsd-charlotte-qa.md
- **Duplicated:** When to add checkpoint:ui-qa, test-flows structure, loop logic, fix prompt pattern
- **Estimated redundancy:** ~600 tokens × 4 = **~2400 tokens wasted**

#### 8. Telegram Escalation Loop Pattern (appears in coordinator + others)
- **Files:** gsd-phase-coordinator.md (lines 373-439), gsd-executor.md, gsd-executor-ui-qa loop
- **Duplicated:** Multi-turn ask_blocking_question, JSONL logging, confidence evaluation, reply synthesis
- **Estimated redundancy:** ~700 tokens × 2 = **~1400 tokens wasted**

### Medium-Redundancy Areas (individual patterns repeated)

- **File/path verification patterns** (grep/ls checks) — appears in ~10 places with slight variations
- **Git commit wrapper logic** (via gsd-tools.js commit) — appears in 7 places
- **Error handling for missing SUMMARY.md/PLAN.md** — appears in 5+ places

### Summary

**Total Estimated Redundancy: 19,000-22,000 tokens** across ~300K of agent content

**Redundancy ratio:** ~7-8% of all agent tokens are pure duplication with no material difference in logic

---

## Issues Found (numbered; severity High/Med/Low, evidence with file:line + quotes)

### ISSUE #1: Plan Structure Gate Uses Non-Existent Command

**Severity:** HIGH

**Evidence:** gsd-phase-coordinator.md line 671
```bash
VALIDATION_OUTPUT=$(node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js verify plan-structure "$plan_file" 2>/dev/null)
```

**Problem:** This command is referenced but the gsd-tools.js documentation (lines 80-83) shows:
```
verify plan-structure <file>       Check PLAN.md structure + tasks (tdd/ui-qa gates; exits 1 on error)
```

The command IS defined in gsd-tools.js header comments, but **the phase-coordinator expects JSON output (line 672)** yet the gsd-tools documentation does not specify JSON format:
```bash
VALID=$(echo "$VALIDATION_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('valid', True))" 2>/dev/null || echo "True")
```

**Risk:** If the tool returns non-JSON or missing JSON, the fallback is `echo "True"` which silently passes invalid plans.

**Fix:** Either (a) verify gsd-tools.js returns JSON from verify plan-structure, or (b) change coordinator to parse text output instead of JSON.

---

### ISSUE #2: Silent Plan Failure — No Check for Plan Completion Before Verification

**Severity:** HIGH

**Evidence:** gsd-phase-coordinator.md lines 705-941 (execute step)

**Problem:** The execute step has no guarantee that ALL plans complete before moving to verify. The code structure is:
```
for each incomplete plan:
  spawn executor
  wait for result
  spot-check SUMMARY.md existence
```

But if an executor:
1. Crashes before writing SUMMARY.md
2. Returns a partial checkpoint (e.g., ui-qa) that the coordinator doesn't handle fully
3. Returns early due to checkpoint:human-action

Then proceed to verification with incomplete execution. Lines 1424-1430 (verify step) check VERIFICATION.md exists but NOT that all plans had SUMMARY.md committed.

**Risk:** Phase can report "verified" when only 80% of plans executed.

**Fix:** Add hard gate after all plan execution loops: verify SUMMARY.md exists for every plan in the phase directory, before proceeding to verify step.

---

### ISSUE #3: Context Budget Estimation Heuristic Never Implemented

**Severity:** MEDIUM

**Evidence:** gsd-phase-coordinator.md lines 50-141 (context_budget_monitoring section)

**Problem:** The section defines:
```
**How to estimate context usage:**
Claude Code reports context window usage in the environment. Check it at the start of each major step. 
If the runtime does not expose this directly, use a conservative heuristic: estimate 5-10% per major step completed.
```

But there is **no implementation** of either approach:
- No code to read Claude Code's context window environment variable
- No code to track completed steps and increment 5-10% per step
- No code to set `context_budget_pct` variable before it's checked at line 70

**Risk:** Context budget monitoring is completely non-functional. The coordinator never switches to compressed mode or defers verifier, regardless of actual context usage.

**Fix:** Implement one of:
1. Environment variable read: `CLAUDE_CONTEXT_USAGE` or similar
2. Step counter: initialize at 0%, add 8% per major step completed
3. Use token monitoring from gsd-tools.js TokenBudgetMonitor if available

---

### ISSUE #4: Post-Phase UX Sweep Has No Dev Server Recovery Path

**Severity:** HIGH

**Evidence:** gsd-phase-coordinator.md lines 1304-1344 (post_phase_ux_sweep step)

**Problem:** The code defines HARD RULE "UX sweep is MANDATORY for web projects" (line 1290) but the fallback for dev server startup failure (line 1322) says:
```
If SH_STATUS is `start_timeout`: read CLAUDE.md for infrastructure startup instructions, attempt startup. 
If still failing after 60s: return a `human-action` checkpoint — do NOT skip the sweep.
```

But there is **no implementation** of:
1. Reading CLAUDE.md for startup command
2. Attempting startup with that command
3. Waiting and retrying after 60s

The logic is described but not coded.

**Risk:** If service-health fails and dev server is not running, the phase blocks forever waiting for a human to manually start it, rather than attempting recovery.

**Fix:** Implement the recovery path described in lines 1322-1323.

---

### ISSUE #5: Transcript Contradiction — "dependency-stability" Command Undocumented

**Severity:** MEDIUM

**Evidence:** gsd-phase-coordinator.md line 716
```bash
DRIFT_RESULT=$(node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js verify dependency-stability {phase_number} 2>/dev/null || echo '{"drift_detected":false,"error":"drift check unavailable"}')
```

**Problem:** This command is NOT listed in gsd-tools.js header documentation (lines 1-173). The header documents:
```
verify plan-structure <file>
verify phase-completeness <phase>
verify references <file>
verify commits <h1> [h2] ...
verify artifacts <plan-file>
verify key-links <plan-file>
verify migration-timestamps
```

But NO `verify dependency-stability`. This suggests:
1. Command may not exist → fallback to always return `false`
2. Or command exists but undocumented → maintenance risk

**Risk:** Dependency drift never gets detected because the command fails silently.

**Fix:** Either (a) add command to gsd-tools.js, or (b) remove the check and skip this step entirely.

---

### ISSUE #6: Planner Testing Mandate Too Strict for Non-API Work

**Severity:** MEDIUM

**Evidence:** gsd-planner.md lines 220-240 (Testing Mandate)

**Problem:** The rule states:
```
Every plan that produces user-facing behavior MUST include:
1. A test task (type="auto", tdd="true")
```

Then line 243 lists mandatory test triggers:
```
When to include a test task:
- API endpoints: ALWAYS
- Database RPCs: ALWAYS
- Form submit handlers: ALWAYS
- Business logic functions: ALWAYS
- Pure UI components with no logic: SKIP
```

Contradiction: "Every plan producing user-facing behavior" includes CSS/styling-only changes that are user-facing but not testable (e.g., grid layout changes). Plan-checker's dimension 8-T1 (line 329) will BLOCK any plan with .ts/.tsx files that lacks a `tdd="true"` task, even for pure styling or config.

**Risk:** Planner must add dummy test tasks for non-testable work (style-only changes), or plans fail plan-checker validation.

**Fix:** Clarify: "Every plan with .ts/.jsx/.tsx business logic" not just "user-facing behavior". Or add exemption list for configuration/styling-only changes.

---

### ISSUE #7: E2E Flows Requirement Conflicts with Small Features

**Severity:** MEDIUM

**Evidence:** gsd-planner.md lines 256-268

**Problem:** The rule states:
```
## e2e_flows in frontmatter (REQUIRED for UI plans)
Every plan that creates or modifies UI components MUST populate `e2e_flows` with at least one user journey.
Empty `e2e_flows: []` on a UI plan is a planning defect.
```

But line 260 also says:
```
Also required when a backend plan changes an API response shape consumed by existing frontend
```

This creates a requirement for ALL UI plans. But then the coordinator's post_phase_e2e step (line 1357) says:
```
If E2E_FLOWS is empty or null: skip this step.
```

So empty e2e_flows is:
1. A planning defect (planner shouldn't create plans with empty flows)
2. But also handled gracefully by coordinator (skipped)

**Risk:** Plan-checker doesn't validate e2e_flows is non-empty. Plans with empty e2e_flows pass plan-checker but are marked as defects in the planner prompt. Contradictory signals.

**Fix:** Either (a) add plan-checker dimension to validate non-empty e2e_flows for UI plans, or (b) remove the "MUST populate" language from planner and only recommend flows.

---

### ISSUE #8: No Validation That CONTEXT.md Questions Were Actually Answered

**Severity:** MEDIUM

**Evidence:** gsd-phase-coordinator.md lines 462-464

**Problem:** After discuss step, the coordinator merges escalated answers into CONTEXT.md:
```
Merge escalated answers with sufficient answers for CONTEXT.md:
The CONTEXT.md writer below uses `sufficient_answers` to populate the Implementation Decisions section. 
Append `escalated_answers` to `sufficient_answers` before writing CONTEXT.md
```

But there is NO verification that:
1. All escalated_answers are real (could be empty if no sensitive items existed)
2. All escalated_answers have actual responses (not just placeholders)
3. The CONTEXT.md actually contains them (write succeeds)

If write fails (permission error, disk full), CONTEXT.md may be incomplete, but execution continues to research step assuming context is solid.

**Risk:** CONTEXT.md created but missing some decisions, misleading planner later.

**Fix:** After CONTEXT.md write (line 542), verify the file contains expected sections and all decision items appear.

---

### ISSUE #9: Checkpoint:ui-qa vs checkpoint:human-verify Enforcement Unclear

**Severity:** MEDIUM

**Evidence:** gsd-planner.md lines 160-180

**Problem:** The rule (line 164) says:
```
**Auto-add rule:** After any task that creates or substantially modifies a web UI page, form, or interactive component, 
add a `checkpoint:ui-qa` task. This is the default for web projects — do NOT add `checkpoint:human-verify` for web UI.
```

But plan-checker's dimension 8-T2 (line 341-356) only checks:
```
if ANY task creates or modifies .tsx or .jsx files:
  Does the plan contain at least one `checkpoint:ui-qa` task?
```

This allows:
- A plan with .tsx task but checkpoint:human-verify (not ui-qa) → plan-checker FAILS (correct)
- A plan with .tsx task and no checkpoints → plan-checker FAILS (correct)
- A plan with .tsx task and ONE checkpoint:ui-qa at the end → plan-checker PASSES (correct)

But there's NO enforcement that checkpoint:ui-qa is AFTER each UI task, only that AT LEAST ONE exists. So a plan could have:
- Task 1: Create Component A (.tsx)
- Task 2: Create Component B (.tsx)
- Task 3: checkpoint:ui-qa

Plan-checker passes, but Component A is never tested before B depends on it.

**Risk:** UI task ordering defects pass plan-checker if only final checkpoint:ui-qa exists.

**Fix:** Enhanced dimension 8-T2: for each .tsx/.jsx task, verify the next non-auto task is checkpoint:ui-qa (or previous task's checkpoint:ui-qa covered it via grouping).

---

### ISSUE #10: Task-Router Defaults to Haiku Without Fallback

**Severity:** LOW

**Evidence:** gsd-task-router.md lines 128-136

**Problem:** If all commands fail (quota status, routing context), the agent returns:
```
Task: {task description}
Model: haiku
Reasoning: fallback — commands unavailable, defaulting to haiku
Quota: unknown
```

This is a safe default but contradicts the gsd-phase-coordinator logic (line 851) which expects quota status to be available:
```
QUOTA_JSON = run: node ~/.claude/get-shit-done/bin/gsd-tools.js quota status --json
If quota command succeeds:
  session_percent = QUOTA_JSON.session.percent
```

If quota status fails, the coordinator continues with per-task routing anyway, but applies downgrade logic to `session_percent` which is undefined.

**Risk:** Silent logic error if quota command fails — coordinator proceeds with undefined variable.

**Fix:** In coordinator, check `if QUOTA_JSON failed` before accessing `session_percent`.

---

### ISSUE #11: Verifier Re-Verification Mode Has No Update Mechanism

**Severity:** MEDIUM

**Evidence:** gsd-verifier.md lines 37-55

**Problem:** Re-verification mode (triggered when gaps found in previous VERIFICATION.md) optimizes by:
```
- Failed items: Full 3-level verification
- Passed items: Quick regression check only
```

But there's no code to:
1. Remove fixed items from `gaps` before re-running
2. Update the VERIFICATION.md after re-verification completes
3. Signal back to coordinator whether all gaps were fixed or some persist

If a plan executor fixes an issue, the next verify run detects it as fixed, but the frontmatter `gaps` field is not updated. The verifier could report "status: passed" but the VERIFICATION.md still lists the old gap.

**Risk:** Verification reports success but artifact still contains old failure records, confusing users and breaking downstream automation.

**Fix:** After re-verification passes, update VERIFICATION.md frontmatter to clear `gaps` field.

---

### ISSUE #12: Executor Doesn't Validate User Decisions Actually Followed in Code

**Severity:** MEDIUM

**Evidence:** gsd-executor.md lines 106-110

**Problem:** The executor loads user context from knowledge DB:
```
USER_CONTEXT=$(node /Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js query-knowledge ...2>/dev/null || echo "[]")
Throughout task execution, apply these as implicit constraints
```

But there is NO verification that:
1. Code changes actually follow the decisions
2. Contradictions are detected (e.g., user said "use library X" but task used library Y)
3. Violations are reported

If a task action said "use React Hooks" but the executor used class components, there's no mechanism to detect or flag this violation. Only spot-checks are SUMMARY.md existence and git commits.

**Risk:** Executor can silently violate user decisions, discovered only by human code review.

**Fix:** Add cross-check in executor: after each task, scan modified files for patterns that contradict locked decisions (e.g., grep for `extends React.Component` if decision said "use hooks").

---

## Improvement Candidates (numbered, concrete)

### IMPROVEMENT #1: Extract Shared Context Discovery Pattern

**Scope:** Remove 6400-8000 redundant tokens

**Action:**
1. Create a new reference file: `.claude/references/project-context-discovery.md`
2. Document the pattern once with all variants (CLAUDE.md, skills/, agent patterns)
3. Replace 8 agent instances with: `@references/project-context-discovery.md`
4. Update each agent's role section to say "Read references/project-context-discovery.md first"

**Benefit:** Single source of truth; easier to update pattern; saves ~1K tokens per run

---

### IMPROVEMENT #2: Implement Context Budget Estimation in Phase Coordinator

**Scope:** Fix non-functional monitoring (ISSUE #3)

**Action:**
1. Initialize `context_budget_pct = 0`
2. Define major steps: harvest_knowledge, discuss, research, plan, execute, verify
3. After each step: `context_budget_pct += 8` (per 6-step phase = ~48% before verify)
4. Check at start of each step: if ≥60%, log compressed mode; if ≥80%, prepare handoff
5. Test: run phase-coordinator, verify thresholds trigger at expected points

**Benefit:** Enable actual context management instead of inert code

---

### IMPROVEMENT #3: Implement Dev Server Recovery in Post-Phase UX Sweep

**Scope:** Fix incomplete fallback (ISSUE #4)

**Action:**
1. Read CLAUDE.md for `## Infrastructure / Dev Server` section
2. Extract startup command from instructions
3. If service-health fails AND dev server not running:
   - Try the startup command from CLAUDE.md
   - Wait 30s for health check
   - Retry health check up to 3 times
   - Only escalate to human-action checkpoint if still dead after all retries
4. Log each recovery attempt

**Benefit:** Reduce manual intervention for infrastructure issues

---

### IMPROVEMENT #4: Add Document `verify dependency-stability` Command or Remove

**Scope:** Fix undocumented command (ISSUE #5)

**Action:**
1. Check if `/Users/ollorin/.claude/get-shit-done/bin/gsd-tools.js` implements `verify dependency-stability`
2. If it does:
   - Document it in gsd-tools.js header (lines 79-87)
   - Add example usage
3. If it doesn't:
   - Remove the check from phase-coordinator (lines 716-722)
   - Remove advisory check from coordinator output

**Benefit:** Clarity on what dependency tracking is actually available

---

### IMPROVEMENT #5: Clarify Testing Mandate — List Non-Testable Work Exemptions

**Scope:** Fix contradiction (ISSUE #6)

**Action:**
1. In gsd-planner.md, expand "When to include a test task" (line 243) with explicit exemptions:
   - Pure CSS/styling changes (no logic, no wiring)
   - Type definitions and interfaces only
   - Configuration files (*.config.*)
   - Build scripts and scaffolding
2. Revise dimension 8-T1 in plan-checker to match exemptions
3. Add rule: "If a .tsx file has no exported functions (only styled components), no test task required"

**Benefit:** Plans for design-only work won't fail validation

---

### IMPROVEMENT #6: Add Plan-Checker Validation for Non-Empty E2E Flows

**Scope:** Fix contradictory signals (ISSUE #7)

**Action:**
1. Add new plan-checker dimension 10: "E2E Flow Presence"
2. For UI plans (any with .tsx/.jsx files):
   - Check frontmatter `e2e_flows` field
   - If empty or missing: **BLOCKING FAIL** with message "UI plans must include at least one e2e_flows entry"
3. If accepted, coordinator will attempt E2E testing; if empty, coordinator skips safely

**Benefit:** Enforce quality signal consistently across planner and checker

---

### IMPROVEMENT #7: Add Post-CONTEXT.md Verification Gate

**Scope:** Fix incomplete write verification (ISSUE #8)

**Action:**
1. After CONTEXT.md write (line 542), add gate:
   ```bash
   # Verify CONTEXT.md contains expected sections
   grep -c "## Implementation Decisions" ".planning/phases/{phase_dir}/{padded_phase}-CONTEXT.md" || FAIL
   grep -c "## Claude's Discretion" ... || FAIL
   # Count decision entries
   DECISION_COUNT=$(grep -c "^- " ... )
   if [ $DECISION_COUNT -lt 1 ]; then FAIL; fi
   ```
2. If verification fails: log error and re-write CONTEXT.md, or escalate

**Benefit:** Catch incomplete context writes before proceeding to plan

---

### IMPROVEMENT #8: Implement Checkpoint:ui-qa Ordering Validation

**Scope:** Fix grouping rule enforcement (ISSUE #9)

**Action:**
1. In plan-checker dimension 8-T2, enhance validation:
   ```
   For each .tsx/.jsx task at index N:
     If next task is not checkpoint:ui-qa:
       Check if any following tasks (before next checkpoint:ui-qa or plan end) are .tsx/.jsx
       If yes: WARNING — "Multiple UI tasks without grouping. Group related tasks with single checkpoint."
       If no: OK (this UI task's changes can be tested together with prior)
   ```
2. This allows grouping but prevents testing gaps between unrelated UI changes

**Benefit:** Prevent testing gaps in multi-task UI work

---

### IMPROVEMENT #9: Add Cross-Boundary Wiring Verification in Plan-Checker

**Scope:** Enhance dimension 4 (Key Links Planned) to catch semantic issues

**Action:**
1. For each task with frontend handler (checkbox for form submit, button click, API call):
   - Verify the backend route/API exists or is created in same plan
   - Verify response shape matches frontend's expected structure
2. For each task creating API route:
   - Verify at least one frontend or integration test task will call it
3. Report: "Frontend task X assumes API /foo — not found in plan. Add API task or verify external."

**Benefit:** Catch incomplete cross-boundary wiring before execution

---

### IMPROVEMENT #10: Document Expected gsd-tools.js Command Output Formats

**Scope:** Prevent silent failures (ISSUE #1)

**Action:**
1. Create reference: `.claude/references/gsd-tools-output-formats.md`
2. For each command used by agents, document:
   - Normal output format (text, JSON, bash vars)
   - Error output format
   - Non-zero exit code meaning
3. Update phase-coordinator to match expected formats (e.g., verify plan-structure JSON vs text)
4. Add error handling for format mismatches

**Benefit:** Prevent silent failures when gsd-tools output format changes

---

## Open Questions

1. **Why is context budget monitoring not implemented?** Was it planned but deferred? Is there environment-level context reporting we should use instead of estimation?

2. **What is the actual behavior of `gsd-tools.js verify plan-structure`?** Does it return JSON or text? What does valid:false look like vs. valid:true?

3. **How should verifier re-verification update VERIFICATION.md?** Should it overwrite gaps array, or create a new "re-verification" section?

4. **Is there an actual `verify dependency-stability` command or was it planned but not implemented?** If not, should we remove this check?

5. **How does the executor validate that user decisions were actually followed in code?** Or is this expected to be caught only in human code review?

6. **For the post-phase UX sweep dev server recovery:** What should happen if the startup command from CLAUDE.md also fails? Should there be a timeout or max retry count before escalating?

7. **Why doesn't plan-checker validate that e2e_flows is non-empty?** Was this intentionally left to planner enforcement only, or an oversight?

8. **How should phase completeness be defined when using per-task routing?** Should all tasks succeed, or can some tasks fail with human checkpoint and phase still mark as "gaps_found"?
