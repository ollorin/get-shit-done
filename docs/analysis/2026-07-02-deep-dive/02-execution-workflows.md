# Execution Workflows — Deep Analysis

**Date:** 2026-07-02  
**Scope:** Execution-side workflows in `/Users/ollorin/.claude/get-shit-done/workflows/`  
**Focus:** Mandatory step enforcement, skip conditions, and gate reliability

---

## Inventory

| File | Size | Purpose |
|------|------|---------|
| execute-roadmap.md | 22.3K | Autonomous roadmap execution with phase coordination |
| execute-phase.md | 28.6K | Phase orchestration with wave-based plan execution |
| execute-plan.md | 23.8K | Individual plan execution with task commits and SUMMARY generation |
| quick.md | 17.9K | Ad-hoc task execution with optional discussion/full modes |
| verify-work.md | 15.6K | Conversational UAT testing with persistent state |
| audit-milestone.md | 13.8K | Requirements/integration/tech-debt aggregation |
| complete-milestone.md | 20.1K | Milestone archival, PROJECT.md evolution, git tagging |

**Total execution-path scope:** ~142K of workflow definitions

---

## How It Works — End-to-End Execution Flow

### Layer 1: Roadmap (execute-roadmap.md)

1. **Init** (line 15-37): Load ROADMAP.md via `gsd-tools init execute-roadmap`
   - Parse: `roadmap_exists`, `total_phases`, `execution_order`, `parallel_opportunities`, `resume_state`
   - **Failure path:** If roadmap doesn't exist → immediate error, no recovery

2. **Branch Guard** (line 39-72): Enforce main/master branch block
   - **Check:** `git rev-parse --abbrev-ref HEAD`
   - **Enforcement:** DETERMINISTIC — if on main, present blocking message, wait for user response
   - **Skip condition:** User types "override" → proceeds anyway on main (explicit acceptance logged)

3. **Confirm Execution** (line 75-101): Present plan to user
   - **Enforcement:** PROMPT-ONLY (type "yes" or "skip {N}" or "stop")
   - **Skip condition:** User types "skip {N}" → phase marked skipped in log, continues

4. **Initialize Execution Log** (line 104-171): Create `.planning/EXECUTION_LOG.md`
   - Log roadmap_start event
   - **Optional:** Try to create Telegram topic (best-effort, warnings only)

5. **Execute Phases** (line 174-339):
   - For each phase in order:
     a. Check skip list → skip if marked
     b. Check dependencies → recursive execution if unmet
     c. Log phase_start
     d. **Spawn sub-coordinator (fresh 200k context)** with FULL HARD RULES inline
     e. Handle result: completed | completed_with_deferrals | failed | blocked | gaps_found
   
   - **5a. Charlotte QA Gate (line 270-294):** BLOCKING (owned by orchestrator)
     - **Check:** `HAS_UI = find .planning/phases/{phase_dir}/ -name "*.md" -exec grep -l "\.tsx\|\.jsx\|checkpoint:ui-qa" {}`
     - **If HAS_UI and CHECKPOINT.json missing `charlotte_qa_ran: true`:**
       - Run Charlotte QA (max 3 rounds) + regression tests
       - Update `charlotte_qa_ran: true` in CHECKPOINT.json
     - **Enforcement:** DETERMINISTIC — orchestrator refuses to proceed without evidence
     - **Skip condition:** Phase has no UI work → gate doesn't apply
   
   - **5b. Cross-phase Integration Checkpoint (line 296-320):** UNCONDITIONAL
     - Run unit + integration tests
     - **Enforcement:** DETERMINISTIC — `deno task test:ci` must exit 0
     - **Skip condition:** None — runs for every completed phase
     - **Comment (line 320):** "The v0.1.9 conditional was always true but never triggered — removing condition removes failure mode."

6. **Handle Failure** (line 341-377): Log, notify, checkpoint
7. **Resume Capability** (line 379-401): Resume from EXECUTION_LOG.md on re-run
8. **Completion** (line 403-567):
   - Log roadmap_complete
   - Run analytics report (best-effort)
   - **Pre-PR Quality Gates (line 449-476):** HARD ENFORCEMENT
     - `gsd-tools gate pre-pr` returns action_required + checks array
     - Must run checks TWICE, both green
     - `gate pre-pr --mark-passed` writes marker
     - PR creation checks for marker — **NO BYPASS**
   - E2E Regression Gate (line 478-502): Charlotte regression tests, max 3 fix attempts
   - Push branch & create PR with `gh pr create`

### Layer 2: Phase (execute-phase.md)

1. **Init** (line 27-49): Load phase via `gsd-tools init execute-phase`
   - Parse plans, incomplete_count, executor_model, verifier_model
   - Sync chain flag (line 43-48): Clear ephemeral auto-chain flag if NOT `--auto`

2. **Branch Guard** (line 51-82): Same as roadmap — enforce main/master block

3. **Validate Phase** (line 84-88): Count plans, report incomplete

4. **Discover & Group Plans** (line 90-113): Load wave grouping via `phase-plan-index`
   - **Null safety note (line 99):** Frontmatter `objective` may be null — fallback always required

5. **Execute Waves** (line 116-301):
   - For each wave:
     a. Describe what's being built (text before spawning)
     b. **Spawn executor agents** (Pattern A/B/C routing based on checkpoints)
        - Wave 1 (line 146-182): No prior context
        - Wave 2+ (line 185-227): Inject completed_plans_context from SUMMARY.md frontmatter extractions
     c. **Spot-check claims** (line 232-252):
        - Verify first 2 files from `key-files.created` exist
        - Check `git log --grep="{phase}-{plan}"` returns ≥1 commit
        - Check for `## Self-Check: FAILED` marker
        - **If any spot-check fails:** Report failure, ask "Retry?" or "Continue?"
     d. **Known bug (line 294):** `classifyHandoffIfNeeded` runtime error — agent reports failed but error fires AFTER tools finish
        - Run spot-checks; if they PASS → treat as successful
        - If they FAIL → treat as real failure
     e. **Assemble completed_plans_context** (line 257-290): Extract from SUMMARY.md frontmatter
        - If any extraction fails: fallback message "Prior wave plans completed but SUMMARY.md context unavailable"
     f. **Handle failures** (line 292-296): Offer continue or stop
     g. **Execute checkpoint plans** (line 298): Between-wave checkpoints
     h. **Proceed to next wave**

6. **Checkpoint Handling** (line 303-395):
   - Parse `AUTO_CHAIN` and `AUTO_CFG` (line 310-311)
   - **Human-verify checkpoints:** Auto-spawn continuation if `AUTO_CHAIN=true` OR `AUTO_CFG=true`
   - **UI QA checkpoints:** Always auto-run Charlotte (line 319-367)
     - Auto-start dev servers (detect NX/Next.js/Vite)
     - Max 3 rounds of Charlotte QA
     - Max 3 rounds of issue fixing (spawn fix agent tier by severity)
     - Only after pass: spawn continuation
   - **Standard flow:** Present checkpoint, wait for user, spawn fresh continuation agent (NOT resume)
     - **Why fresh agent (line 392):** "Resume relies on internal serialization that breaks with parallel tool calls"

7. **Aggregate Results** (line 397-417): Output completion markdown

8. **Phase Completion Gate (line 421-444):**
   - **PHGATE-01** (blocking): All plans have SUMMARY.md
   - **PHGATE-02** (blocking): No SUMMARY.md contains `Self-Check: FAILED`
   - **PHGATE-03** (blocking): Audit log file exists at `.planning/audit/phase-{N}-audit.jsonl`

9. **Pre-Verification Gates (line 446-473):**
   - **Gate 1 — Charlotte QA (UI phases only):** CHECKPOINT.json must have `charlotte_qa_ran: true` OR `false`
     - **Enforcement:** DETERMINISTIC — orchestrator runs Charlotte if gate fails
     - Comment (line 294): "Coordinators that overflow context drop Charlotte as late step, missing 5 real bugs in v0.1.9"
   - **Gate 2 — Integration tests green:** `deno task test:ci` must pass
     - **Enforcement:** DETERMINISTIC — blocks verification
     - **Skip condition:** None
   - **Gate 3 — Cross-layer consistency:** If phase added enums/types, verify in ALL layers
     - **Enforcement:** PROMPT-ONLY ("Verify it exists...") — no programmatic check
     - **Skip condition:** Agent decides whether to verify manually

10. **E2E Coverage Closure (line 475-503):**
    - **Trigger:** Web project with UI changes (same as planning-phase Step 5.6)
    - **Process:**
      1. Read SUMMARY.md, identify what was built
      2. Spawn gsd-ui-inventory (haiku) on changed modules
      3. Compare against E2E-TEST-PLAN.md from planning phase
      4. If gaps found: spawn gsd-e2e-test-generator (sonnet), run scenarios with Charlotte
      5. Update scenario indexes, tag tests
    - **Hard rule (line 495):** "Phase execution is NOT complete until every UI page has at least one e2e scenario"
    - **Enforcement:** DETERMINISTIC — verification fails if gaps remain
    - **Skip condition:** Non-web project → skip entirely

11. **Close Parent Artifacts (line 506-554):**
    - For decimal phases (4.1, 03.1): Close parent UAT and debug sessions
    - **Skip if:** Phase number has no decimal (e.g., 3, 04)

12. **Verify Phase Goal (line 556-618):**
    - Spawn gsd-verifier agent
    - Read status: `passed` | `human_needed` | `gaps_found`
    - **Enforcement:** DETERMINISTIC — agent must create VERIFICATION.md
    - **If gaps_found:** Suggest `/gsd:plan-phase {X} --gaps` for gap closure cycle

13. **Update Roadmap (line 620-638):**
    - Run `gsd-tools phase complete`
    - CLI handles checkbox, progress table, STATE.md advancement

14. **Auto-advance Detection (line 641-693):**
    - Parse `--no-transition` flag
    - If present: return completion to parent (spawned by plan-phase auto-advance), STOP
    - If NOT present:
      - Check `--auto` flag and both chain flag + user preference
      - If `--auto` OR `AUTO_CHAIN` OR `AUTO_CFG` (and verification passed with no gaps):
        - Execute transition.md inline with fresh coordinator context
        - Pass `--auto` flag to next phase

### Layer 3: Plan (execute-plan.md)

1. **Init Context** (line 14-25): Load via `gsd-tools init execute-phase`
   - Parse: executor_model, commit_docs, phase_dir, incomplete_plans

2. **Identify Plan** (line 27-48): Find first PLAN without SUMMARY
   - Auto-approve (YOLO mode): proceed to parse_segments
   - Interactive/custom: present for confirmation

3. **Record Start Time** (line 50-55): Timestamp for duration calculation

4. **Parse Segments** (line 57-76): Classify checkpoint pattern (A/B/C)
   - **Pattern A (autonomous):** Spawn single subagent, full plan + SUMMARY + commit
   - **Pattern B (segmented):** Execute segment-by-segment, autonomous segments spawn subagent, checkpoints in main
   - **Pattern C (main):** Execute entirely in main context

5. **Init Agent Tracking** (line 79-95): Create agent-history.json, track current-agent-id.txt
   - Check for interrupted agent; offer resume or start fresh

6. **Segment Execution (line 98-115):** Pattern B only
   - Per segment: spawn gsd-executor for assigned tasks only (NO SUMMARY/commit)
   - After ALL segments: aggregate files/deviations → create SUMMARY → commit
   - Self-check: verify key-files.created exist, git log has commits
   - Append `## Self-Check: PASSED` or `## Self-Check: FAILED`

7. **Load Prompt** (line 117-124): Read PLAN.md as execution instructions
   - If plan has `<interfaces>` block: use directly, don't re-read source files

8. **Previous Phase Check** (line 126-131): Check prior SUMMARY for unresolved issues
   - Ask: "Proceed anyway" | "Address first" | "Review previous"

9. **Execute** (line 134-144): Per task, apply deviation rules + auth gates

10. **Deviation Rules (line 169-200):**
    - **Rule 1 (Bug):** Auto-fix, track
    - **Rule 2 (Missing Critical):** Auto-add, track
    - **Rule 3 (Blocking):** Auto-fix, track
    - **Rule 4 (Architectural):** STOP, present decision, wait for user
    - **Priority:** Rule 4 (STOP) > Rules 1-3 (auto)

11. **Task Commit (line 229-270):** After each task
    - Check git status
    - **Pre-commit correctness scan** (line 236-242): Silent audit (column names, operation ordering, security gates, migration privileges, concurrency safety, set-based SQL)
    - Stage individually (NEVER `git add .` or `-A`)
    - Commit with type prefix

12. **Checkpoint Protocol (line 273-295):**
    - Display checkpoint box
    - **Types:** human-verify (90%) | decision (9%) | human-action (1%)
    - Wait for user — DO NOT hallucinate completion
    - If spawned via Task: return structured state, don't interact directly with user

13. **Verification Failure Gate (line 297-299):**
    - If verification fails: STOP, present options (Retry | Skip | Stop)

14. **Post-Execution Audit Gate (line 301-334):**
    - **CPGATE-01 (blocking):** All plan tasks have git commits
      - Enforcement: DETERMINISTIC — spot-check commits before SUMMARY
    - **CPGATE-02 (blocking):** All output files exist on disk
      - Enforcement: DETERMINISTIC — verify before SUMMARY
    - **CPGATE-03 (advisory):** FP lint passes on TypeScript files
      - Enforcement: PROMPT-ONLY — document in deviations, fix before PR
    - **CPGATE-04 (blocking):** Audit log entry written to `.planning/audit/phase-{N}-audit.jsonl`
      - Enforcement: DETERMINISTIC — must be valid JSON, must exist before continuing

15. **Record Completion Time** (line 338-354): Calculate duration for SUMMARY

16. **Generate User Setup** (line 356-362): If `user_setup` in PLAN frontmatter
    - Create `{phase}-USER-SETUP.md` using template
    - Status "Incomplete"

17. **Create Summary** (line 364-376):
    - Create `{phase}-{plan}-SUMMARY.md` at phase directory
    - **Frontmatter MUST include:** phase, plan, requires/provides/affects, **requirements** (copy verbatim from PLAN), key-files, key-decisions, duration, completed timestamp
    - One-liner substantive (not generic)

18. **Update Current Position** (line 378-392):
    - Run `gsd-tools state advance-plan`
    - Run `gsd-tools state update-progress`
    - Run `gsd-tools state record-metric` with duration/tasks/files

19. **Extract Decisions** (line 395-406):
    - Add each decision from SUMMARY to STATE.md via `gsd-tools state add-decision`
    - Add blockers via `gsd-tools state add-blocker`

20. **Update Session Continuity** (line 409-418):
    - Run `gsd-tools state record-session` (stopped-at, resume-file)
    - Keep STATE.md under 150 lines

21. **Issues Review Gate** (line 421-422):
    - If SUMMARY "Issues Encountered" ≠ "None":
      - YOLO: log and continue
      - Interactive: present, wait for acknowledgment

22. **Documentation Hard Gate (line 450-513):** NOT CONFIGURABLE, NOT SKIPPABLE
    - **Check:** Classify what was built by reading SUMMARY + git diff
    - **Signals matched:**
      - New/changed API endpoints | New UI routes/pages | New DB schema | New service | New auth/payment/onboarding flow
    - **Exclusions (gate passes):**
      - Pure refactoring with no new surface
      - Test-only changes
      - CI/config-only changes
      - Internal utility/helper with no public API
    - **If documentation-worthy:**
      - Spawn gsd-docs-updater subagent
      - Wait for result
      - **If subagent returns "no-changes" but signals matched: GATE FAILS — STOP**
      - If subagent fails or errors: GATE FAILS — STOP
      - If subagent returns written files with valid commit: gate passes
    - **Enforcement:** DETERMINISTIC — phase cannot complete without docs
    - **Skip condition:** No documentation-worthy signals matched

23. **Update Codebase Map** (line 515-527):
    - If `.planning/codebase/` exists: update structural changes only
    - Skip code-only/bugfix/content changes

24. **Offer Next** (line 530-545):
    - If `USER_SETUP_CREATED=true`: display at TOP with setup tasks
    - Route: "More plans" | "Phase done" | "Milestone done"

---

## Enforcement Table

| Step | Where Defined | Enforcement Type | Skip Conditions | Evidence of Bypass Risk |
|------|---------------|------------------|-----------------|------------------------|
| **Roadmap: Branch Guard** | execute-roadmap:39-72 | (b) Prompt-only | User types "override" | Explicit override accepted, logged |
| **Roadmap: Execution Confirmation** | execute-roadmap:75-101 | (b) Prompt-only | User types "skip {N}" | User can skip individual phases |
| **Roadmap: Charlotte QA Gate** | execute-roadmap:270-294 | (a) Deterministic | No UI work detected | Orchestrator checks CHECKPOINT.json; spawns Charlotte if missing |
| **Roadmap: Integration Tests** | execute-roadmap:296-320 | (a) Deterministic | None | Runs unconditionally; v0.1.9 bug: optional gate was always true but never triggered |
| **Roadmap: Pre-PR Quality Gates** | execute-roadmap:449-476 | (a) Deterministic | None | `gate pre-pr --mark-passed` marker required; PR creation checks for it; no bypass |
| **Roadmap: E2E Regression** | execute-roadmap:478-502 | (a) Deterministic | Non-web projects | Max 3 fix attempts before escalation; NON-NEGOTIABLE for web |
| **Phase: Plan Spot-Checks** | execute-phase:232-252 | (a) Deterministic | None | Verifies SUMMARY.md exists, git commits present, self-check PASSED |
| **Phase: Checkpoint Auto-Approval** | execute-phase:303-395 | (b) Prompt + conditional auto | `AUTO_CHAIN` or `AUTO_CFG` true | For human-verify: auto-spawns continuation if flags set |
| **Phase: UI QA Checkpoints** | execute-phase:319-367 | (a) Deterministic | None | Always auto-runs Charlotte; never skipped, even in auto-mode |
| **Phase: Charlotte QA Gate (6.4)** | execute-phase:446-473 | (a) Deterministic | No UI work OR `charlotte_qa_ran: true` | Gate 1: orchestrator spawns Charlotte if missing |
| **Phase: Integration Tests** | execute-phase:459-465 | (a) Deterministic | None | Must pass before SUMMARY considered complete; blocking |
| **Phase: Cross-Layer Consistency** | execute-phase:467-472 | (b) Prompt-only | Agent decides manually | No programmatic check; relies on agent to verify |
| **Phase: E2E Coverage Closure** | execute-phase:475-503 | (a) Deterministic | Non-web projects | Hard rule: phase cannot complete without E2E coverage for all UI pages |
| **Phase: Verification Spawn** | execute-phase:556-572 | (a) Deterministic | None | Agent must create VERIFICATION.md; orchestrator checks status |
| **Plan: Auth Gates** | execute-plan:146-167 | (b) Prompt-only + special protocol | Expected interaction point | Not a failure; create dynamic checkpoint, wait for user |
| **Plan: Deviation Rules** | execute-plan:169-200 | (a) Deterministic (Rules 1-3) + (b) Prompt-only (Rule 4) | Rules 1-3 auto-fixed | Rule 4 (Architectural) STOPS, waits for user decision |
| **Plan: Task Commits** | execute-plan:229-270 | (a) Deterministic | None | Each task committed immediately; pre-commit scan is silent but foundational |
| **Plan: Verification Failure** | execute-plan:297-299 | (a) Deterministic | None | STOP on failure; present options |
| **Plan: CPGATE-01 (task commits)** | execute-plan:305-309 | (a) Deterministic | None | Spot-check before writing SUMMARY |
| **Plan: CPGATE-02 (output files)** | execute-plan:311-315 | (a) Deterministic | None | Verify on disk before SUMMARY |
| **Plan: CPGATE-03 (FP lint)** | execute-plan:317-322 | (c) Advisory | None | Document in deviations; no block |
| **Plan: CPGATE-04 (audit log)** | execute-plan:324-332 | (a) Deterministic | None | Entry must be valid JSON in `.planning/audit/phase-{N}-audit.jsonl` |
| **Plan: Documentation Gate** | execute-plan:450-513 | (a) Deterministic | No documentation-worthy signals | Gate FAILS if signals matched but no docs written; phase blocked |
| **Milestone: Requirements Audit** | audit-milestone:89-130 | (a) Deterministic | None | 3-source cross-reference (VERIFICATION, SUMMARY, REQUIREMENTS); orphans flagged as unsatisfied |
| **Milestone: Integration Check** | audit-milestone:57-80 | (a) Deterministic | None | Spawns gsd-integration-checker; must verify cross-phase wiring |
| **Milestone: Nyquist Compliance** | audit-milestone:167-189 | (c) Advisory (discovery only) | Explicit `workflow.nyquist_validation: false` | Never auto-calls validate-phase; discovery only |
| **Quick: Discussion Phase** | quick:110-223 | (b) Prompt-only | `--discuss` flag absent | User decisions locked in CONTEXT.md |
| **Quick: Plan Checking** | quick:282-385 | (b) Prompt-only loop | `--full` flag absent | Max 2 iterations before forcing proceed or abort |
| **Quick: Verification** | quick:430-472 | (b) Prompt-only | `--full` flag absent | Status: passed | gaps_found | human_needed |

---

## Issues Found

### Issue 1: Documentation Gate Ambiguity in Execute-Plan (HIGH)

**File:** execute-plan.md, line 450-513  
**Severity:** HIGH  
**Evidence:**

```
"If subagent returns `DOCS_COMMIT = "no-changes"` but documentation-worthy signals were found: **GATE FAILS**"
```

**Problem:** The gate relies on `gsd-docs-updater` subagent to return a specific signal variable (`DOCS_COMMIT`). However:
- The subagent is spawned with a prompt but no structured return contract
- What if the subagent doesn't exist or fails to create a return value?
- What if the subagent succeeds but the orchestrator never captures the return value cleanly?
- **Line 506:** "If subagent returns one or more written files with a valid commit: gate passes" — but how is "valid commit" determined? Is it a `git log` check? Implicit?

**Why it's a problem:** The gate CAN fail if the subagent response is ambiguous, but the orchestrator may not know how to interpret it. This creates a race condition where docs are written but the return value is malformed, causing the gate to fail and phase to block unnecessarily.

**Impact:** Phases can get stuck if gsd-docs-updater returns unexpected output format.

---

### Issue 2: Charlotte QA Gate Deferral in Execute-Roadmap (HIGH)

**File:** execute-roadmap.md, line 270-294  
**Severity:** HIGH  
**Evidence:**

```
"Why the orchestrator owns this gate: Coordinators that overflow context drop Charlotte as a late step
and write 'code-level verification' — which missed 5 real UI bugs in v0.1.9."
```

**Problem:** The gate is meant to prevent coordinators from skipping Charlotte QA when they hit context limits. However:
- The coordinator is spawned with a prompt that STATES the rules (line 218-246), but there is NO MECHANISM to prevent the coordinator from ignoring them
- The coordinator receives `telegram_topic_id` but is NOT told "you cannot skip Charlotte"
- **Line 251:** "status: 'completed_with_deferrals'" — the coordinator can report deferrals, and the orchestrator tries to spawn fresh agents for deferred steps, but:
  - The orchestrator only checks for `"verify"` and `"charlotte_qa"` in deferrals
  - If the coordinator reports deferred steps in ANY OTHER form, they fall through
  - **Line 261:** "Also check for deferred-items.md in phase directory" — but what if the phase coordinator created a deferred list that the orchestrator doesn't parse?

**Why it's a problem:** A poorly implemented coordinator can still skip Charlotte QA by:
1. Not reporting it as a deferral
2. Writing "code-level verification" instead of spawning Charlotte
3. Returning `status: "completed"` without setting `charlotte_qa_ran: true` in CHECKPOINT.json

The gate at 5a catches the CHECKPOINT.json miss, but only AFTER the coordinator returns. If the coordinator never touches CHECKPOINT.json, the orchestrator will spawn Charlotte, but by then, crucial execution time is wasted and the phase is already marked "complete" in logs.

**Impact:** UI bugs slip through because Charlotte QA is deferred and forgotten.

---

### Issue 3: Spot-Check Logic Assumes SUMMARY.md Frontmatter Quality (MEDIUM)

**File:** execute-phase.md, line 234-241  
**Severity:** MEDIUM  
**Evidence:**

```
"For each SUMMARY.md:
- Verify first 2 files from `key-files.created` exist on disk
- Check `git log --oneline --all --grep="{phase}-{plan}"` returns ≥1 commit
- Check for `## Self-Check: FAILED` marker"
```

**Problem:**
- **Spot-check assumes `key-files.created` frontmatter is populated correctly** — if the executor forgets to populate it, the spot-check can't verify the files
- **Spot-check assumes git commits were tagged with phase-plan strings** — if commits use a different message format, the grep fails silently
- **Self-Check: FAILED marker check assumes the executor wrote it** — if the executor crashed before writing SUMMARY.md, the marker won't exist, and the spot-check reports "SUMMARY.md not found" (which is correct) but this is cascaded into a failure rather than a retry prompt

**Why it's a problem:** The spot-check is DEFENSIVE but not FOOLPROOF. Executors can accidentally populate frontmatter with the wrong filenames, wrong commit messages, or missing markers, and the orchestrator will treat these as failures even though the work was done correctly.

---

### Issue 4: Known Bug Bypass (classifyHandoffIfNeeded) — Silent Success Conversion (MEDIUM)

**File:** execute-phase.md, line 294; execute-plan.md, line 110  
**Severity:** MEDIUM  
**Evidence:**

```
"Known Claude Code bug (classifyHandoffIfNeeded): If an agent reports 'failed' with error containing
`classifyHandoffIfNeeded is not defined`, this is a Claude Code runtime bug — not a GSD or agent issue.
The error fires in the completion handler AFTER all tool calls finish. In this case: run the same spot-checks
as step 4 (SUMMARY.md exists, git commits present, no Self-Check: FAILED). If spot-checks PASS → treat as **successful**."
```

**Problem:**
- The workflow acknowledges that Claude Code has a runtime bug that causes agent reports to say "failed" even though the work was done
- The workaround is to run spot-checks and treat spot-check pass as success
- **BUT:** This is a heuristic, not a guarantee. Spot-checks can pass even if the work was PARTIALLY done (e.g., commits exist but one critical file is missing)
- **Impact:** Partial/broken work is marked as successful if it passes spot-checks, and broken state is propagated to the next phase

**Why it's a problem:** This converts a hard failure into a soft success based on incomplete verification. The "classifyHandoffIfNeeded" bug should be fixed in Claude Code, not worked around in the workflow.

---

### Issue 5: Completed Plans Context Extraction — Fallback on Silent Failure (MEDIUM)

**File:** execute-phase.md, line 268-290  
**Severity:** MEDIUM  
**Evidence:**

```
"For each plan that has completed in waves 1..current_wave (all completed plans so far):
    SUMMARY_PATH = "{phase_dir}/{plan_id}-SUMMARY.md"
    If SUMMARY_PATH does not exist: skip this plan with warning "Skipping {plan_id} — SUMMARY.md not found"
    
    Extract from SUMMARY.md frontmatter:
      node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" summary-extract "$SUMMARY_PATH" --fields key-files,key-decisions,provides 2>/dev/null

If COMPLETED_CONTEXT_BLOCK is empty (all extractions failed):
    COMPLETED_CONTEXT_BLOCK = 'Prior wave plans completed but SUMMARY.md context unavailable — proceed based on plan files.'"
```

**Problem:**
- The extraction command includes `2>/dev/null` (stderr redirect), silently swallowing errors
- If `summary-extract` fails (file missing, malformed JSON, tool not found), the extraction is skipped with NO WARNING in the orchestrator output
- The fallback message is written, but the orchestrator does NOT log what went wrong
- Next wave executor receives a DEGRADED context: "proceed based on plan files" instead of concrete accomplishments from prior waves
- **Impact:** Later waves build on INCOMPLETE information, increasing risk of architectural misalignment

**Why it's a problem:** Silent failures hide integration problems until they manifest as bugs.

---

### Issue 6: Verify-Phase Can Be Deferred, But Recovery Path Is Unclear (MEDIUM)

**File:** execute-roadmap.md, line 248-254  
**Severity:** MEDIUM  
**Evidence:**

```
"- `status: "completed_with_deferrals"`: coordinator hit context limits. Spawn fresh agents for deferred steps:
  - If `"verify"` in deferred: spawn `gsd-verifier` with handoff_summary from return
  - If `"charlotte_qa"` in deferred: will be caught by 5a gate
  - After all deferrals resolved: proceed to 5a → 5b"
```

**Problem:**
- The orchestrator EXPECTS the coordinator to report deferred verification explicitly
- But how does the coordinator know to report `"verify"` as a deferral vs. just not running it?
- **execute-phase.md does NOT define what causes the coordinator to defer verification** — it just says verification must happen
- If the coordinator context-overflows BEFORE reaching verification (line 556), what happens?
  - Coordinator returns `status: "completed"` without `"verify"` in deferred list?
  - Or does it implicitly return failed?
- **No explicit check** in execute-roadmap for verification completion status before proceeding to 5a

**Why it's a problem:** Verification can be silently skipped if the coordinator runs out of context and doesn't explicitly report it as deferred. The orchestrator has NO WAY to detect this.

---

### Issue 7: Pre-Commit Correctness Scan Is Silent (LOW)

**File:** execute-plan.md, line 236-242  
**Severity:** LOW  
**Evidence:**

```
"1b. Pre-commit correctness scan (silent bugs often pass tests):
- [ ] **Column/field names:** Do INSERT/UPDATE column names match the actual DB schema or migration?
- [ ] **Operation ordering:** For multi-step flows (reserve-then-dispatch, validate-then-write), is the sequence correct?
- [ ] **Security gates:** Does new handler/endpoint code include required auth checks, input validation, rate limiting?
...
```

**Problem:**
- This is a CHECKLIST presented to the executor, but there's NO ENFORCEMENT
- The executor can skip any or all of these checks
- The checklist is NOT followed programmatically; it's advisory only
- **Impact:** Silent security/correctness bugs slip through if the executor doesn't diligently check each item

**Why it's a problem:** Critical security and correctness checks rely on executor diligence, not tooling. One careless executor can compromise the codebase.

---

### Issue 8: UI QA Checkpoint Auto-Approval Doesn't Check Result Status (MEDIUM)

**File:** execute-phase.md, line 319-367  
**Severity:** MEDIUM  
**Evidence:**

```
"when executor returns `Type: ui-qa` — regardless of AUTO_CHAIN or AUTO_CFG:
1. Log: `⚡ UI QA: Starting Charlotte automated testing...`
2. **Auto-start dev servers** — do NOT ask user to start servers
...
4. Spawn continuation agent with `{user_response}` = 'Charlotte QA passed' (or issue summary if not passed)."
```

**Problem:**
- If Charlotte QA finds issues, the workflow says "Spawn continuation agent with `{user_response}` = issue summary"
- But continuation agent doesn't get explicit instructions to FIX the issues
- **Line 365:** "Spawn continuation agent with `{user_response}` = 'Charlotte QA passed' (or issue summary if not passed)" — but what if Charlotte found issues AND user doesn't respond with a fix?
- The continuation agent is expected to interpret the issue summary and FIX the problems, but there's no explicit "your job is to fix these issues" prompt

**Why it's a problem:** If Charlotte finds issues, the phase proceeds without explicit resolution. Issues are logged but not guaranteed to be fixed before the phase completes.

---

### Issue 9: Milestone Audit Orphan Detection — Only Discovers, Doesn't Block (LOW)

**File:** audit-milestone.md, line 127-130  
**Severity:** LOW  
**Evidence:**

```
"**Orphan detection:** Requirements present in REQUIREMENTS.md traceability table but absent from ALL phase VERIFICATION.md files
MUST be flagged as orphaned. Orphaned requirements are treated as `unsatisfied` — they were assigned but never verified by any phase."
```

**Problem:**
- Orphaned requirements are flagged in the audit report
- **But line 128:** They are "treated as unsatisfied" — meaning the audit status becomes `gaps_found`
- **Line 289:** `/gsd:plan-milestone-gaps` is offered to fix gaps
- However, if a requirement is assigned to a phase in ROADMAP.md but the phase was never executed, it will be flagged as orphaned
- **There's no mechanism to prevent moving to next milestone if orphaned requirements exist** — the user can run `/gsd:complete-milestone` anyway (line 83-84 in complete-milestone.md offers option to "Proceed anyway")

**Why it's a problem:** Orphaned requirements are warnings, not blockers. A user can complete a milestone while knowing requirements are missing.

---

### Issue 10: Roadmap Resume State Can Become Stale (LOW)

**File:** execute-roadmap.md, line 379-401  
**Severity:** LOW  
**Evidence:**

```
"If previous execution incomplete (resume_state set):
```
## Resume Previous Execution

A previous roadmap execution was interrupted:
- **Last phase started:** {resume_state.phase} ({resume_state.phase_name})
- **Status:** {resume_state.status}
- **Execution log:** .planning/EXECUTION_LOG.md

### Resume Options
- 'resume' — continue from {next_phase_after_last}
- 'restart' — start fresh from beginning (overwrites log)
- 'stop' — exit without resuming"
```

**Problem:**
- The resume logic reads from EXECUTION_LOG.md
- **But there's no validation that phases completed between last execution and resume attempt are still valid**
- If a user manually edited the codebase, deleted plans, or changed requirements BETWEEN the incomplete execution and the resume, the resume state is STALE
- The orchestrator will blithely continue from the old state without re-validating

**Why it's a problem:** Resume state can drift from reality if user manually edits `.planning/` between runs.

---

## Improvement Candidates

### 1. Formalize gsd-docs-updater Return Contract

**Status:** execute-plan.md, line 450-513  
**What:** Define explicit return fields for gsd-docs-updater subagent
- `{ docs_written: boolean, files: [string], commit_hash: string, errors: [string] }`
- Orchestrator checks for presence of these fields; fails with clear error if missing

**Why:** Prevent ambiguous gate results when subagent crashes or returns malformed output.

---

### 2. Add Context Overflow Detection to Coordinator Spawns

**Status:** execute-roadmap.md, line 205-246  
**What:** Pass a token-budget hint to the coordinator in the prompt. Coordinator must checkpoint frequently:
- After each phase step (research, plan, execute, verify), coordinator writes `.planning/phases/{phase_dir}/CHECKPOINT.{step}.json`
- Orchestrator checks for checkpoint presence before proceeding to next phase
- If step checkpoint missing → orchestrator assumes context overflow and spawns recovery agent

**Why:** Prevent silent skips of Charlotte QA and verification when coordinator runs out of context.

---

### 3. Integrate Pre-Commit Correctness Scan Into Tooling

**Status:** execute-plan.md, line 236-242  
**What:** Create a `gsd-tools pre-commit-scan` command that validates:
- Column/field name consistency (query git diff, parse schema, cross-check INSERT/UPDATE statements)
- Operation ordering (detect SELECT-then-UPDATE without FOR UPDATE, etc.)
- Security gates (grep for auth checks, validation, rate limiting in new handlers)
- Return EXIT_CODE 0 if all pass, non-zero if violations found

**Why:** Codify the silent checklist into deterministic enforcement.

---

### 4. Explicit Documentation-Worthy Signal Checklist

**Status:** execute-plan.md, line 462-477  
**What:** Create `gsd-tools classify-changes` command that:
- Reads git diff for the plan's commit range
- Matches against signal patterns
- Returns JSON: `{ signals: [string], needs_docs: boolean, excluded_reason: string }`
- Execution uses this return to decide whether to spawn gsd-docs-updater

**Why:** Move documentation-worthy detection out of prose and into deterministic logic.

---

### 5. Add Explicit "No Deferral" Assertion to Coordinator

**Status:** execute-roadmap.md, line 248-254  
**What:** After coordinator returns, orchestrator checks:
- `deferral_list` field must be explicitly present (even if empty array)
- `charlotte_qa_ran` must be explicitly present in CHECKPOINT.json (with boolean value, not missing)
- `verification_status` must be present (passed | gaps_found | deferred | failed)
- If any field missing → orchestrator treats as incomplete, spawns recovery agent

**Why:** Prevent silent deferrals by requiring explicit field presence.

---

### 6. Verify Integration Test Success Before Advancing Wave

**Status:** execute-phase.md, line 296-320  
**What:** Move integration tests from "unconditional check after phase" to "between-wave gate"
- After each wave completes AND spot-checks pass, run integration tests before proceeding to next wave
- If integration tests fail, offer: Fix now | Skip wave | Stop execution
- This prevents broken state from being injected into downstream waves

**Why:** Catch integration bugs BETWEEN waves, not after all waves complete.

---

### 7. Formalize Spot-Check Frontmatter Requirements

**Status:** execute-phase.md, line 234-241  
**What:** Require executor to populate SUMMARY.md frontmatter with explicit sections:
- `key-files: { created: [string], modified: [string] }`
- `git-commits: [string]` (list of commit hashes or message patterns)
- `self-check: "passed" | "failed"`
- Spot-check validates presence and format before accepting SUMMARY

**Why:** Prevent spot-checks from failing due to missing/malformed frontmatter.

---

### 8. Add Explicit Continuation Agent Prompt for UI QA Issues

**Status:** execute-phase.md, line 365  
**What:** When Charlotte QA finds issues, the continuation agent prompt should explicitly state:
```
"Charlotte QA found the following issues:
{issue_list}

Your job is to fix these issues:
1. For each issue:
   a. Reproduce the issue
   b. Root-cause analysis
   c. Fix implementation
   d. Re-run Charlotte QA to verify fix
2. If after 3 fix attempts the issue persists, document it and proceed
3. Do NOT proceed without attempting to fix all reported issues"
```

**Why:** Ensure continuation agent understands it must FIX issues, not just proceed.

---

### 9. Add Milestone Gap Closure Blocker

**Status:** complete-milestone.md, line 83-86  
**What:** If audit shows `gaps_found`, require user to run `/gsd:plan-milestone-gaps` BEFORE completing milestone
- Check: Does `.planning/milestones/v{version}-MILESTONE-AUDIT.md` exist and show `status: gaps_found`?
- If yes: Block `/gsd:complete-milestone`, suggest gap closure first
- User can override with explicit flag `--accept-gaps` (logged as explicit acceptance)

**Why:** Prevent accidental milestone completion with critical gaps.

---

### 10. Formalize Resume State Validation

**Status:** execute-roadmap.md, line 379-401  
**What:** Before offering resume option, validate:
- EXECUTION_LOG.md is well-formed (valid JSONL)
- All completed phases in log still exist on disk (`.planning/phases/{phase_dir}` exists)
- All completed phases have VERIFICATION.md files
- ROADMAP.md phase list matches what's in execution log
- If any validation fails → offer "restart" only, not resume

**Why:** Prevent stale resume state from corrupting current execution.

---

## Open Questions

1. **What is the intended behavior if a coordinator reports `status: "completed"` but never sets `charlotte_qa_ran` in CHECKPOINT.json?**
   - Does the orchestrator assume `charlotte_qa_ran: false` and spawn Charlotte?
   - Or does it treat the missing field as a coordinator error?

2. **How does gsd-executor know when to write SUMMARY.md?**
   - execute-plan.md lines 364-376 describe the SUMMARY creation, but there's no explicit "when to write" rule
   - Can executor write SUMMARY before all tasks complete?
   - Can executor write SUMMARY without writing git commits for all tasks?

3. **What happens if a phase has NO UI work but the coordinator sets `charlotte_qa_ran: true` anyway?**
   - Does the orchestrator validate that CHECKPOINT.json value matches actual UI presence?
   - Or does it trust the coordinator's claim?

4. **How are nested/decimal phases (4.1, 03.1) expected to connect to parent phases for UAT closure?**
   - execute-phase.md line 506-554 describes closing parent artifacts, but parent phase may have multiple decimal children
   - How are UAT gaps mapped back to parent when multiple gap-closure phases execute?

5. **Can execute-phase's `completed_plans_context` be used by a later wave to SKIP work?**
   - If Wave 1 plan provides a module, can Wave 2 plan rely on it without re-reading source code?
   - What if Wave 1's claim is wrong?

6. **What is the recovery path if gsd-docs-updater crashes AFTER writing some docs but BEFORE committing?**
   - Does the orchestrator detect partial doc writes?
   - Can the phase proceed with uncommitted docs?

---

## Summary of Critical Findings

1. **Charlotte QA can be deferred indefinitely** by coordinators that overflow context without explicitly reporting deferrals
2. **Documentation gate relies on subagent return format that is not formally defined**, risking gate failures on ambiguous returns
3. **Spot-checks assume executor populated frontmatter correctly**, creating false-pass risk
4. **UI QA issue continuation doesn't explicitly mandate fixing the issues** — issues can be logged and ignored
5. **Completed plans context extraction swallows errors** — later waves build on degraded information
6. **Milestone gaps are warnings, not blockers** — users can complete milestones with known missing requirements

The framework has strong DETERMINISTIC gates for high-stakes items (integration tests, pre-PR gates, audit logging) but relies on PROMPT-ONLY enforcement for deferred work, architectural decisions, and cross-layer consistency verification. The result is that execution can proceed correctly IF agents follow instructions, but there's NO TOOLING to prevent deliberate or accidental skips.

