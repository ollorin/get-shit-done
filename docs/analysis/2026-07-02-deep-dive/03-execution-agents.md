# Execution & QA Agents — Deep Analysis

**Analysis Date:** 2026-07-02  
**Scope:** gsd-executor, gsd-verifier, gsd-test-writer, gsd-charlotte-qa, gsd-docs-updater, supporting agents  
**Focus:** How mandatory steps (tests, QA, docs) can be skipped; trigger conditions; contradictions  

---

## Inventory

| Agent | Size | Primary Role | Spawn Trigger |
|-------|------|---|---|
| gsd-executor | 36.0K | Executes plans atomically; creates commits; spawns test/QA/docs agents | execute-phase CLI / coordinator |
| gsd-verifier | 48.3K | Post-phase goal verification; confirms goal achievement; hard gates (tests, QA, docs, E2E coverage) | Implicit after execution (called by milestone auditor) |
| gsd-test-writer | 4.7K | Writes QA-focused test suites with 6+ tests covering auth, validation, errors, wiring | `tdd="true"` task in plan |
| gsd-charlotte-qa | 17.8K | Web UI/UX QA using Charlotte browser tools; 3 modes (ui-qa, ux-audit, e2e) | `checkpoint:ui-qa` in plan; coordinator loop |
| gsd-docs-updater | 12.6K | Writes proportionally-scoped documentation for API/UI/architecture/refactoring changes | Final mandatory step by executor; documentation_hard_gate in plan |
| gsd-integration-checker | 15.7K | Verifies cross-phase wiring (exports→imports, APIs→consumers, bidirectional) | Milestone auditor (not phase-level) |
| gsd-integration-tester | 4.1K | Tests contract boundaries (API, schema, component) between phases | After phase completion when depends_on detected |
| gsd-e2e-test-generator | 4.8K | Generates Charlotte e2e scenarios from UI inventory using QA methodologies | Phase context required (not auto-invoked) |
| gsd-nyquist-auditor | 5.4K | Fills Nyquist validation gaps; generates missing tests for phase requirements | (Not examined in detail; reference for completeness) |

---

## How It Works (Per Agent)

### gsd-executor (36.0K) — Core Execution Engine

**Spawn:** `/gsd:execute-phase` CLI → instantiates executor with PLAN.md path  
**Flow:**

1. **Load state** (line 54–71): Reads STATE.md for position, decisions, blockers
2. **Load plan** (line 73–89): Parse frontmatter, extract `requirements` field, detect routing context
3. **Determine pattern** (line 121–131): Scans for `checkpoint:*` tasks → **Pattern B (has checkpoints) = STOP**
4. **Execute tasks** (line 133–164):
   - `type="auto"` → execute, verify, commit
   - `type="tdd"` → **Route then spawn gsd-test-writer** (line 390–474)
   - `type="checkpoint:ui-qa"` → **STOP, return structured message** (line 159)
   - `type="checkpoint:human-verify"` / `decision` / `human-action` → check auto mode; if inactive, **STOP**

5. **Post-plan test gate** (line 518–652):
   - Detect test command from config.json or package.json
   - **CRITICAL RULE** (line 550): "If TEST_CMD is empty AND this plan contains no `tdd="true"` tasks: log and proceed"
   - **BUT** (line 551–552): "If TEST_CMD is empty BUT plan has `tdd="true"` tasks: HARD FAILURE"
   - Run test suite (5-min timeout) → fail on non-zero exit, timeout, coverage below threshold
   - **HARD RULE** (line 589): "Never treat infrastructure unavailability as 'no test command found'"

6. **Create SUMMARY.md** (line 654–711): Template, frontmatter, deviations, auth gates
7. **Self-check** (line 713–729): Verify created files exist; verify commits exist
8. **Docs update** (line 731–796):
   - **Spawn gsd-docs-updater** as last mandatory step (line 733–766)
   - "This step is not skippable" (line 734)
   - **If docs agent fails:** log error, continue to state updates (line 773–774)
9. **State updates** (line 800–839): Advance plan counter, record metrics, add decisions
10. **Update requirements** (line 841–858): Mark plan requirements complete in REQUIREMENTS.md
11. **Final commit** (line 860–868): Commits SUMMARY, STATE, ROADMAP, REQUIREMENTS
12. **Return completion format** (line 870–886)

**Test Task Handling** (line 390–474):
- Route test complexity → spawn gsd-task-router
- Spawn gsd-test-writer with detected model
- If failing tests after 2 retries: **BLOCK execution** (line 445–454)
- If 0 tests written: **BLOCK execution** (line 457–460)
- **Critical assertion:** "Every test MUST have verified pass/fail status" (gsd-test-writer line 89)

**Key Skip-Loophole: Test Gate Condition** (line 550):
```
if [ -z "$TEST_CMD" ]; then
  if plan has no tdd="true" tasks → log "skipping post-plan test gate" and PROCEED
```
**Implication:** Plans with no `tdd="true"` tasks that produce implementation files can skip the test gate entirely if no test command is configured. The gate only blocks if `tdd="true"` tasks exist AND test infrastructure is missing.

---

### gsd-verifier (48.3K) — Post-Phase Goal Verification

**Spawn:** Implicit call from milestone auditor after plan execution  
**Critical philosophy** (line 13–14): "Do NOT trust SUMMARY.md claims. SUMMARYs document what Claude SAID it did. You verify what ACTUALLY exists in the code."

**Core verification flow:**

1. **Check for previous verification** (line 37–55): If previous VERIFICATION.md with gaps → re-verification mode
2. **Step 1-2: Load context & establish must-haves** (line 57–103):
   - Extract from PLAN.md `must_haves` frontmatter if present
   - If absent, derive from phase goal (what must be TRUE, EXIST, WIRED)
3. **Step 3-5: Verify observable truths, artifacts, key links** (line 104–233):
   - 3-level artifact verification: exists, substantive, wired
   - Semantic verification: "wiring can be syntactically present but behaviorally inert" (line 30)
4. **Step 5b: Done-criteria achievability** (line 223–233): Trace backward from claimed outcome; flag broken chains
5. **Step 6: Requirements coverage** (line 235–260)
6. **Step 6b: PRD intent alignment** (line 262–311): **HARD RULE — mismatches → gaps_found** (line 287)
7. **Step 7: Anti-pattern scanning** (line 313–357): TODOs, empty returns, console-only implementations
8. **Step 8: Human verification needs** (line 359–373)
9. **Step 8b: Runtime test suite execution** (line 375–415):
   - Detect test command
   - Run tests (max 5 min)
   - **HARD RULE** (line 403–414): "If no tests exist AND phase produced implementation files (.ts/.tsx/.js): HARD FAIL — set STATUS = gaps_found"
   - **Only exception** (line 415): "Phase produced NO implementation files (docs-only, config-only)"

10. **Step 8c: Charlotte QA coverage check** (line 506–644):
    - **Trigger:** UI files in SUMMARY OR plan has `checkpoint:ui-qa` OR project is web framework (line 514)
    - **HARD RULE** (line 514): "If UI files were produced OR plan requires QA, Charlotte QA MUST have run. Missing QA → gaps_found (NEVER a warning)"
    - Detection: Look for `*-QA-*.md`, `*-CHARLOTTE-*.md`, or SUMMARY with execution evidence ("qa round", "screens_tested", "issue_count")
    - **Anti-spoofing** (line 622): "Mere mention of 'Charlotte' without execution evidence does NOT satisfy this check"

11. **Step 8c.5: Deferral language detection** (line 647–701):
    - **HARD RULE** (line 653): "Any deferral of tests, QA, or verification to future phase = verification failure (NEVER a warning)"
    - Scan for: "deferred", "defer to", "post-milestone testing", "future phase", "will be tested later", "qa skipped"

12. **Step 8c.6: E2E test coverage** (line 703–720):
    - **Trigger:** Phase produced .tsx/.jsx OR project has web framework
    - **HARD RULE**: "E2E-TEST-PLAN.md must exist with scenario files; missing → gaps_found (NEVER a warning)"

13. **Step 8d: Implementation file test coverage** (line 722–791):
    - **HARD RULE** (line 728): "Every implementation file must have corresponding test file (NEVER a warning for missing tests)"
    - Check: .test.ts, .spec.ts, __tests__/ locations
    - Missing test file → add gap with `failure_type: missing_test`

14. **Step 8e: Migration timestamp conflicts** (line 792–841)
15. **Step 8f: Docs coverage validation** (line 843–973):
    - Determine expected build scope from SUMMARY.md signals (api_change, ui_surface, architecture, refactoring)
    - Check if docs agent ran (look for `## Docs` section in SUMMARY)
    - For api_change/ui_surface/architecture: verify doc files exist in docs/
    - For refactoring: check CHANGELOG.md entry
    - **HARD RULE**: Missing docs for api_change/ui_surface/architecture → gaps_found (NEVER a warning)

16. **Step 9: Determine overall status** (line 429–453):
    - **CRITICAL** (line 432–440): "PARTIAL PASS IS NOT A PASS — Any deferral language, any 'pending' → status = gaps_found"
    - Status: `passed` (all truths verified) | `gaps_found` (one+ truths failed) | `human_needed` (all checks pass, needs human)
    - **Hard rule** (line 451): "`human_needed` is ONLY valid when all automated checks pass and remaining items need human"

17. **Step 10: Structure gap output** (line 455–503): YAML frontmatter with `failure_type` (required — one of 7 values)
18. **Step 11: Write anti-patterns to KB** (line 1138–1170): Persist discovered gaps as KB entries

**Key Hard-Fail Gates (All NEVER warnings, always gaps_found):**
- No test suite for code-producing phases (line 403–414)
- Missing Charlotte QA for UI-producing phases (line 514, 625–642)
- Deferral language in docs/summaries (line 681–698)
- Missing E2E test coverage for web projects (line 707–719)
- Missing test files for implementation files (line 787–788)
- Missing docs for api_change/ui_surface/architecture scopes (line 916–948)

---

### gsd-test-writer (4.7K) — Test Creation Engine

**Spawn:** By executor's `type="tdd"` task handler (line 390–474 of executor)

**Inputs:**
- `task_name`: implementation task just completed
- `files_modified`: list of modified files
- `behavior_description`: from task `<done>` criteria
- `test_framework`: auto-detected

**Test categories** (line 31–61):
1. Happy path (1–2 tests)
2. Auth/authz (2–4 tests)
3. Validation (3–6 tests)
4. Error handling (2–3 tests)
5. Edge cases (2–3 tests)
6. Wiring (1–2 tests)

**Target: 11–20 tests, minimum 6** (line 60–61)

**Critical process rule** (line 81–96):
- Write at least 6 tests
- Run tests and verify pass/fail
- **If 0 tests written: FAILURE state** — return explicit "FAILURE: 0 tests written"
- Executor blocks on 0 tests (line 457–460)

---

### gsd-charlotte-qa (17.8K) — Browser Automation QA

**Spawn:** By `checkpoint:ui-qa` tasks via coordinator checkpoint loop  
**Modes:** `ui-qa` (does it work?), `ux-audit` (is it well-designed?), `e2e` (full user journey)

**Service startup** (line 29–103):
1. Try service-health registry first (line 31–51)
2. Fallback: read CLAUDE.md for QA_LAUNCH_CMD (line 53–73)
3. Health check → launch if needed → verify (line 74–102)

**Testing protocol** (line 105–186):
- Navigation + observation + screenshot every state
- **For every interaction**: `charlotte_console` + `charlotte_requests` check
- Check functionality, cross-module wiring, UX anti-patterns

**Output format** (line 309–404):
- JSON with `mode`, `round`, `passed`, `issue_count`, `severity_counts`, `issues` array
- Report Markdown with coverage log, issues, summary, screenshots
- Re-verification mode (line 406–420): focus on previous issues, track FIXED/STILL PRESENT/REGRESSION

**Critical rule** (line 422–431): "Return structured JSON — the coordinator parses it"

---

### gsd-docs-updater (12.6K) — Documentation Generator

**Spawn:** By executor as final mandatory step (line 731–796 of executor)  
**Alternate spawn:** By `documentation_hard_gate` in execute-plan.md

**Core constraint** (line 17–18): "No padding. No invented content. Every sentence must be traceable to SUMMARY.md or actual code."

**Process:**

1. **Load build scope** (line 40–70): Classify from SUMMARY.md signals
   - api_change, ui_surface, architecture, refactoring
   - Priority: api_change > ui_surface > architecture > refactoring

2. **Detect docs conventions** (line 72–106):
   - Check if `/docs` exists
   - Sample existing .md files → extract frontmatter keys
   - Set `DOCS_STYLE` and `FRONTMATTER_KEYS`

3. **Write docs** (line 108–287):
   - **api_change**: Read actual handler file → create tables for endpoints, params, responses
   - **ui_surface**: Read component file → props documentation
   - **architecture**: Append to docs/architecture/decisions.md with decision + rationale
   - **refactoring**: Append to CHANGELOG.md with one bullet

4. **Commit docs** (line 289–312):
   - Stage only files written
   - Commit with message `docs({phase}-{plan}): {BUILD_SCOPE} documentation`
   - Return DOCS_COMMIT hash

5. **Report** (line 314–336): Structured report with build scope, files written, commit hash

**Critical rule** (line 734): "This step is not skippable."  
**Error handling** (line 773–774): "On docs agent failure: log error, continue to state updates — docs failure does NOT block state updates"

---

## Skip-Loophole Analysis

### Loophole 1: Test Gate Can Be Bypassed (Executor)

**Condition** (gsd-executor line 550):
```
if [ -z "$TEST_CMD" ]; then
  # Auto-detect test command fails
  if plan has no tdd="true" tasks:
    log "No test command found and no tdd tasks — skipping post-plan test gate"
    proceed to summary_creation
```

**Implication:**
- A plan producing implementation files (.ts/.tsx/.js) can skip the test gate entirely if:
  - No `tdd="true"` tasks are in the plan
  - No test command is configured in config.json or package.json

**Evidence from code:**
- Line 550: explicit "skip" branch when TEST_CMD empty and no tdd tasks
- Line 551–552: only blocks if tdd tasks exist AND test infrastructure missing

**Severity:** HIGH — Implementation files can be committed without any automated test coverage if test runner is not configured.

---

### Loophole 2: Charlotte QA Not Triggered If Condition Vague

**Trigger condition** (gsd-verifier line 514):
```
Trigger: ANY of the following:
1. One or more `.tsx` or `.jsx` files appear in SUMMARY.md key-files
2. Project uses web framework (check package.json)
3. Plan includes checkpoint:ui-qa
```

**BUT** (line 622):
```
Anti-spoofing: A SUMMARY.md that merely mentions "Charlotte" or "ui-qa" 
in a task description without evidence of actual QA execution 
(round numbers, screen counts, issue counts) does NOT satisfy this check.
```

**Loophole:**
- If UI files are produced but not explicitly listed in SUMMARY's `key-files` section
- If the project's package.json dependencies are not updated to include web framework
- Then the trigger may not fire, and Charlotte QA is never invoked

**Severity:** HIGH — UI-producing phases can miss automated QA if key-files are omitted or framework not declared.

---

### Loophole 3: Docs Agent Failure Doesn't Block Phase Completion

**From executor** (line 773–774):
```
On docs agent failure (Agent() throws or returns error):
- Log the error message
- Continue to state updates — docs failure does NOT block state updates or phase completion
```

**Implication:**
- Even if docs-updater fails (returns error, times out, etc.), the phase continues to completion
- SUMMARY.md is marked as having failed docs, but phase still completes
- This contradicts the initial statement (line 734) that docs update is "not skippable"

**Severity:** MEDIUM — Contradiction between "not skippable" and "failure does not block completion"

---

### Loophole 4: "Refactoring" Scope Allows Minimal Docs

**From verifier** (line 970):
```
Passing condition: DOCS_EXPECTED_SCOPE=refactoring AND CHANGELOG_ENTRY >= 1
```

**From docs-updater** (line 281–283):
```
Case: refactoring
Target: CHANGELOG.md
Append exactly one bullet point. Do not add any additional sections, context, or explanation.
```

**Implication:**
- Large refactoring phase can satisfy docs gate with a single CHANGELOG.md bullet
- No requirement for detailed documentation of what was refactored, why, or what changed

**Severity:** MEDIUM — Large refactoring phases can bypass detailed documentation requirements.

---

### Loophole 5: E2E Test Plan Required But Generation Not Mandatory

**From verifier** (line 705–719):
```
Step 8c.6: E2E Test Coverage
Trigger: Phase produced .tsx/.jsx OR project has web framework
Check:
1. E2E-TEST-PLAN.md exists
2. Scenario files exist for pages listed in E2E-TEST-PLAN.md
Status: gaps_found if any check fails
This is NEVER a warning — it is a hard verification failure.
```

**BUT** from gsd-e2e-test-generator:
- No mention of when/how this agent is auto-invoked
- Only spawned "when Phase context required (not auto-invoked)" per inventory table
- Not called by executor or verifier

**Implication:**
- Verifier demands E2E-TEST-PLAN.md exist for UI-producing phases
- But no phase agent automatically creates it
- User must manually create E2E-TEST-PLAN.md or plan will fail verification

**Severity:** MEDIUM — Gap between requirement (verifier demands E2E tests) and implementation (no agent creates them).

---

### Loophole 6: Deferral Language Detection Relies on Scanning

**From verifier** (line 647–701):
```
Deferral patterns: "deferred|defer to|deferred to|post-milestone testing|future phase|will be tested later|to be added later|qa skipped|tests skipped|skipped.*because.*not running|skipped.*infrastructure"
```

**Problem:**
- Scan is regex-based on fixed patterns
- Variations not in the pattern list won't be caught
- Examples that might slip through:
  - "postponed for next release"
  - "held for Phase X.2"
  - "pushed to v1.1"
  - "blocked by infrastructure — will complete after server starts"

**Severity:** MEDIUM — Deferral language can be hidden using non-standard phrasing.

---

### Loophole 7: Test File Coverage Check Can Misclassify

**From verifier** (line 732–735):
```
Implementation files are .ts, .tsx, or .js files that are NOT:
- Test files themselves: *.test.ts, *.spec.ts, *.test.js, *.spec.js
- Configuration files: *.config.ts, *.config.js, vite.config.*, next.config.*
- Type declaration files: *.d.ts
- Build output files: dist/, build/, .next/, .nuxt/, out/
```

**BUT** the check only verifies presence of test files, not quality:
- A `.test.ts` file that imports the implementation but doesn't call any functions passes
- A test that only exports a describe block with no test() cases passes
- A test that is all skipped tests (it.skip) passes

**Implication:**
- Implementation files can have hollow test counterparts that satisfy the file-existence check but don't actually test anything

**Severity:** MEDIUM — Test file existence check doesn't verify test quality or execution.

---

### Loophole 8: Self-Check in Executor Doesn't Verify Content

**From executor** (line 713–729):
```
After writing SUMMARY.md, verify claims before proceeding.

1. Check created files exist: [ -f "path/to/file" ] && echo "FOUND" || echo "MISSING"
2. Check commits exist: git log --oneline --all | grep -q "{hash}"
3. Append result: SUMMARY.md ## Self-Check: PASSED or FAILED
Do NOT skip. Do NOT proceed to state updates if self-check fails.
```

**Problem:**
- Self-check only verifies file existence and commit presence
- Does NOT verify:
  - File contents (could be empty or placeholder)
  - Commit content matches description
  - Tasks were actually completed

**Implication:**
- SUMMARY.md can claim files were created when they're actually empty stubs
- Self-check passes as long as placeholder files exist

**Severity:** MEDIUM — Self-check is a box-ticking exercise, not verification of content.

---

### Loophole 9: Architecture Decisions Can Be Single-Sentence

**From docs-updater** (line 260–267):
```
Append following block to docs/architecture/decisions.md:
## Phase {phase_number}: {One-sentence decision title}
Date: {current_date}
{One paragraph. Must be derived directly from SUMMARY.md decisions section.}
```

**From verifier** (line 859):
```
Build scope classified:
api_change, ui_surface, architecture, refactoring
```

**Problem:**
- An "architecture" scope phase can satisfy docs requirement with one paragraph explaining the decision
- No requirement for: implementation details, alternatives considered, trade-offs, migration path

**Implication:**
- Large architectural changes (schema migration, new service layer) can be documented in minimal detail

**Severity:** LOW — Architecture documentation is minimal but at least something is required.

---

## Issues Found

### Issue 1: Contradiction Between "Not Skippable" and "Failure Doesn't Block"

**Severity:** HIGH

**Evidence:**
- **Executor line 734:** "This step is not skippable."
- **Executor line 773–774:** "On docs agent failure: log error, continue to state updates — docs failure does NOT block state updates or phase completion"

**Failure Scenario:**
- Docs agent spawned
- Docs agent encounters error (e.g., invalid code example, file system error)
- Returns error message
- Executor logs error but continues
- Phase completes successfully despite docs agent failure
- Verifier later checks docs coverage (step 8f) and finds missing docs → hard-fail

**Root Cause:** Executor treats docs failure as non-blocking but verifier treats missing docs as hard-fail. No reconciliation between these positions.

**Implication:** A phase can be marked "complete" by executor, then fail verification because docs were never written, yet executor claims docs step is "not skippable."

---

### Issue 2: Test Gate Skipped When Test Runner Not Configured

**Severity:** HIGH

**Evidence:**
- **Executor line 550:** `if [ -z "$TEST_CMD" ]; then` + `if plan has no tdd="true"` → skip test gate
- **Comment:** "No test command found and no tdd tasks — skipping post-plan test gate"
- But no corresponding verifier gate to catch this

**Failure Scenario:**
1. Project has no test runner configured in config.json or package.json
2. Plan produces implementation files (.ts/.tsx/.js) but has no `tdd="true"` tasks
3. Executor skips test gate silently
4. SUMMARY.md is created with no test results
5. Phase completes
6. Verifier checks for tests: "If no tests exist AND phase produced implementation files: HARD FAIL" (line 403–414)
7. Verification fails with gap: "missing_test"

**Evidence of contradiction:**
- **Executor:** "No test infrastructure, no tdd tasks → proceed" (line 550)
- **Verifier:** "No tests for code-producing phase → hard fail" (line 403–414)

**Root Cause:** Executor's test gate is conditional on test runner configuration; verifier's test gate is conditional on code being produced. Executor can skip, verifier cannot accept the skip.

---

### Issue 3: Charlotte QA Trigger Is Self-Assessed

**Severity:** HIGH

**Evidence:**
- **Verifier line 514:** "Trigger: ANY of the following: 1. UI files in SUMMARY.md 2. Web framework detected 3. Plan includes checkpoint:ui-qa"
- **Verifier line 622:** "Anti-spoofing: mere mention of Charlotte without execution evidence does NOT satisfy"
- **Charlotte-qa line 29–103:** Service startup is self-contained; no external validation

**Failure Scenario:**
1. Plan produces UI files but doesn't list them in SUMMARY's `key-files` section
2. Trigger condition 1 not met
3. Project is a web app but package.json never updated (missing web framework dependency)
4. Trigger condition 2 not met
5. Plan doesn't include `checkpoint:ui-qa` task
6. Trigger condition 3 not met
7. Charlotte QA never invoked
8. Executor completes without QA
9. Verifier checks: "UI files produced but no Charlotte QA executed" → hard-fail
10. Phase fails verification

**Root Cause:** Trigger conditions rely on metadata (SUMMARY.md key-files, package.json) that can be incomplete or not updated. No automatic UI file detection — only manual declarations.

---

### Issue 4: E2E Test Plan Required But Not Auto-Generated

**Severity:** HIGH

**Evidence:**
- **Verifier line 705–719:** "E2E-TEST-PLAN.md must exist with scenario files → hard fail if missing"
- **E2E-test-generator description:** "Generates comprehensive e2e test scenarios"
- **E2E-test-generator:** "Phase context required (not auto-invoked)"
- **Executor:** No invocation of gsd-e2e-test-generator

**Failure Scenario:**
1. Phase produces UI files (.tsx/.jsx)
2. No one manually creates E2E-TEST-PLAN.md
3. Executor completes without running e2e-test-generator
4. Verifier checks: "E2E-TEST-PLAN.md missing for UI-producing phase" → hard-fail
5. Phase cannot complete verification

**Root Cause:** Verifier demands E2E-TEST-PLAN.md but executor doesn't generate it. Gap between requirement and automation.

---

### Issue 5: Deferral Language Detection Incomplete

**Severity:** MEDIUM

**Evidence:**
- **Verifier line 658–678:** Fixed regex pattern for deferral detection
- Patterns: "deferred|defer to|future phase|will be tested later|qa skipped|tests skipped|skipped.*because.*not running"

**Failure Scenario:**
1. Executor writes SUMMARY.md with deferral statement: "QA will be performed in Phase 2.1 after infrastructure stabilizes"
2. String matches `future phase` pattern → detected
3. But if phrasing is: "QA postponed until database is stable (targeting milestone v1.1)"
4. No pattern match → not detected
5. Verifier deferral check passes silently
6. Phase completes with deferred QA

**Root Cause:** Regex-based pattern matching has false negatives for non-standard phrasing.

---

### Issue 6: Docs Updater Can Create Empty Documentation

**Severity:** MEDIUM

**Evidence:**
- **Docs-updater line 114–122:** "No padding. No invented content. Every sentence must be traceable."
- **But:** No minimum content length requirement
- **Docs-updater line 260–267:** Architecture scope = one paragraph
- **Docs-updater line 281–283:** Refactoring scope = one bullet in CHANGELOG

**Failure Scenario:**
1. Phase makes architecture decision: "Switch from PostgreSQL to MongoDB"
2. Docs-updater writes: "Phase 15: Switched database. Decided to use MongoDB for scalability."
3. CHANGELOG.md gets one-liner: "Phase 15: Database migration (internal refactoring)"
4. Docs check passes (CHANGELOG entry found)
5. But no details about migration path, schema changes, or rollback strategy

**Root Cause:** Docs quality gate only checks presence, not depth. A single sentence satisfies the gate.

---

### Issue 7: Self-Check Doesn't Validate Content

**Severity:** MEDIUM

**Evidence:**
- **Executor line 713–729:** Self-check script
- Only verifies: file existence (`[ -f "path" ]`) and commit presence (`git log | grep`)
- Does NOT: verify file size, content, or commit message accuracy

**Failure Scenario:**
1. Executor creates SUMMARY.md (empty file or with only frontmatter)
2. File exists: check passes ✓
3. Commit exists with hash: check passes ✓
4. Self-check logs "PASSED"
5. Executor continues to docs/state updates
6. Phase marked complete with empty SUMMARY.md
7. Verifier reads empty SUMMARY → no content to verify against

**Root Cause:** Self-check is file-presence only, not content validation.

---

### Issue 8: Test File Coverage Check Doesn't Verify Test Quality

**Severity:** MEDIUM

**Evidence:**
- **Verifier line 759–790:** Test file coverage check
- Only verifies: test file exists (using Glob/Read to check candidate paths)
- Does NOT: run tests, check for passing tests, or verify test body

**Failure Scenario:**
1. Implementation: `src/utils/calculateTax.ts` (50 lines of real logic)
2. Test file exists: `src/utils/calculateTax.test.ts` (stub with empty describe block)
3. Glob finds candidate test file → exists check passes ✓
4. Verifier logs: "All implementation files have test counterparts"
5. Verification passes
6. But test is empty and was never run

**Root Cause:** File existence != test quality. Verifier doesn't run tests or check coverage in this gate (test execution is separate — Step 8b).

---

### Issue 9: Integration Tester Not Invoked Automatically

**Severity:** MEDIUM

**Evidence:**
- **Integration-tester description:** "Tests cross-phase integration boundaries"
- **Executor:** No invocation of gsd-integration-tester
- **Verifier:** No invocation of gsd-integration-checker (only integration-checker is for milestone auditor)
- **Inventory table:** Integration-tester spawned "after phase completion when depends_on detected" (vague — by whom?)

**Failure Scenario:**
1. Phase 72 (Dashboard) depends on Phase 70 (Auth API)
2. Phase 72 calls `/api/auth/user` endpoint
3. Phase 70 refactored endpoint to `/api/me`
4. No one created integration test to verify contract
5. Executor completes Phase 72 without integration testing
6. Verifier passes Phase 72
7. At runtime: Dashboard crashes because endpoint doesn't exist

**Root Cause:** Integration testing is required by ROADMAP.md `depends_on` field but not auto-triggered by executor or verifier.

---

### Issue 10: Test Writer Can Return 0 Tests Only Once Before Blocking

**Severity:** LOW

**Evidence:**
- **Executor line 457–460:** If gsd-test-writer returns 0 tests
- "Re-spawn gsd-test-writer once with explicit instruction: 'You MUST write at least 6 tests. 0 tests is not acceptable.'"
- "If second attempt also returns 0 tests: BLOCK execution"

**Problem:**
- First 0-test result is handled with re-spawn
- But no documentation of what "0 tests written" means operationally
- If test framework is missing, gsd-test-writer returns error (not 0 tests) — different code path
- Ambiguity in error handling

**Severity:** LOW — This is more of an implementation question than a skip-loophole, but worth noting.

---

## Improvement Candidates

### 1. Add Pre-Execution Test Infrastructure Check

**Priority:** HIGH

**Proposal:**
Add a step before task execution in executor to detect test infrastructure (test runner, framework).
- If missing AND plan will produce implementation files (type="auto" + expected to create .ts/.tsx/.js): warn and require user confirmation
- If confirmed: document in SUMMARY as "tests deferred due to missing infrastructure"
- If not confirmed: add `tdd="true"` task creation to plan or block execution

**File:** gsd-executor.md line 54–71 (load_project_state)

---

### 2. Auto-Invoke E2E Test Generator for UI Phases

**Priority:** HIGH

**Proposal:**
Add step after task execution in executor:
- Detect if any .tsx/.jsx files were created in this plan
- If yes: spawn gsd-e2e-test-generator automatically
- Generate E2E-TEST-PLAN.md and scenario files
- Add generated file paths to SUMMARY.md

**File:** gsd-executor.md line 654–711 (summary_creation)

---

### 3. Make Docs Failure Blocking at Verification

**Priority:** HIGH

**Proposal:**
Reconcile executor and verifier on docs failure handling:
- **Option A:** Make docs failure blocking in executor (don't continue to state updates)
- **Option B:** Make verifier skip docs check if executor logged docs failure (acknowledge docs-not-available status)
- **Recommended:** Option A — docs are "not skippable" so failures should block

**Files:** gsd-executor.md line 773–774; gsd-verifier.md line 843–973

---

### 4. Auto-Detect UI Files and Trigger Charlotte QA

**Priority:** HIGH

**Proposal:**
In executor, after tasks complete:
- Glob for newly created .tsx/.jsx files (not just rely on SUMMARY.md key-files)
- If found: automatically add a `checkpoint:ui-qa` task or spawn charlotte-qa directly
- Update SUMMARY.md with actual files found (not just claimed files)

**File:** gsd-executor.md line 133–164 (execute_tasks)

---

### 5. Require Integration Tests for Phase Dependencies

**Priority:** MEDIUM

**Proposal:**
In executor, read ROADMAP.md for current phase's `depends_on` field:
- If dependencies exist: after all auto tasks complete, spawn gsd-integration-tester
- Pass depends_on_phases list and integration_points extracted from modified files
- Require integration tests to pass before proceeding to SUMMARY.md

**File:** gsd-executor.md line 133–164 (execute_tasks)

---

### 6. Enhance Deferral Detection Patterns

**Priority:** MEDIUM

**Proposal:**
Expand deferral detection in verifier to catch more variations:
- Add patterns: "postponed", "held for", "pushed to", "v[0-9]\.[0-9]", "future release", "next sprint", "TBD"
- Consider context: "QA" or "tests" or "verification" near deferral keyword
- Log all detected deferrals with confidence score; report high-confidence ones as failures

**File:** gsd-verifier.md line 658–678 (check_deferral_language)

---

### 7. Add Content Validation to Self-Check

**Priority:** MEDIUM

**Proposal:**
Expand self-check in executor to verify content, not just file existence:
- Check SUMMARY.md file size > 500 bytes (has substantive content)
- Check SUMMARY.md frontmatter has required fields (phase, plan, status, duration, files, commits)
- Check each claimed commit message matches pattern
- Check each claimed file exists AND is not empty

**File:** gsd-executor.md line 713–729 (self_check)

---

### 8. Require Test Execution Evidence in Verifier

**Priority:** MEDIUM

**Proposal:**
In verifier Step 8b (test suite execution), require evidence in SUMMARY.md:
- SUMMARY.md must include `## Test Results` section with pass/fail counts
- If section missing but tests were supposed to run: treat as gap (failed to report results)
- If section present but no corresponding artifact (.test.ts files): treat as gap (tests weren't real)

**File:** gsd-verifier.md line 375–415 (check for documentation of test results)

---

### 9. Add Charlotte QA Evidence Check to SUMMARY

**Priority:** MEDIUM

**Proposal:**
Executor should require Charlotte QA result in SUMMARY.md (if checkpoint:ui-qa was in plan):
- Parse returned JSON from charlotte-qa (issue_count, passed status)
- Add to SUMMARY.md: `## Charlotte QA Results | Round 1 | Issues: N | Status: [passed/failed]`
- If charlotte-qa was triggered but result not documented: treat as gap in verifier

**File:** gsd-executor.md line 731–796 (docs_update) — add charlotte QA result capture

---

### 10. Strengthen Test File Coverage Check

**Priority:** LOW

**Proposal:**
In verifier Step 8d, enhance test file coverage check:
- Check test file exists (current)
- Also check: test file size > 200 bytes (has content)
- Also check: test file contains at least one `describe()` or `test()` block
- Report: test file exists but is empty as a gap (hollow_test)

**File:** gsd-verifier.md line 722–791 (check_test_file_coverage)

---

## Open Questions

1. **Who is responsible for invoking integration-tester when depends_on phases exist?**
   - Current: unclear — docs say "spawned after phase completion when dependencies detected" but no agent code shows this
   - Should executor detect and spawn it? Or is it phase-coordinator's job?

2. **How does the system ensure E2E-TEST-PLAN.md is created before verification?**
   - Verifier requires it (hard-fail if missing)
   - But no phase agent auto-creates it
   - Is it user responsibility? Phase-level task? Separate agent?

3. **Does the test gate in executor run the same test suite that verifier runs in Step 8b?**
   - Executor: runs test command (page 518–652)
   - Verifier: also runs test command (page 375–415)
   - Are these two independent runs? Or should verifier skip if executor already tested?

4. **When docs-updater fails, should it re-spawn?**
   - Current: executor logs error and continues (line 773–774)
   - Verifier later fails on missing docs
   - Should executor retry docs-updater once, like it retries test-writer?

5. **What defines "phase produced implementation files"?**
   - Verifier checks for .ts/.tsx/.js in SUMMARY key-files
   - But SUMMARY is created after execution — if key-files incomplete, check may not trigger
   - Should there be a separate mechanism (Glob of actual changed files) to detect?

6. **How is the post-plan test gate affected by infrastructure unavailability?**
   - Executor Step 1.5 attempts to start infrastructure (line 556–589)
   - But if startup fails: TEST_GATE_BLOCKED=true and phase fails
   - Is this correct behavior? Should infra failures be escalated differently?

7. **What happens if a plan has multiple tdd="true" tasks and one fails?**
   - Executor retries implementation + re-runs test-writer (up to 2 retries)
   - But does it retry subsequent tdd tasks, or does phase fail immediately?
   - Line 445–454 says "fail on retries exhausted — do NOT create SUMMARY"

8. **Can verifier re-check a phase that failed verification?**
   - Verifier has re-verification mode (Step 0, line 37–55)
   - But only if previous VERIFICATION.md with gaps exists
   - What if there's no previous verification (first run)? Can coordinator re-run verifier after fixes?

9. **Is Charlotte QA actually required, or just recommended?**
   - Verifier treats missing Charlotte QA as hard-fail for UI phases (line 514, 625–642)
   - But executor has no mechanism to require or enforce Charlotte QA before SUMMARY.md
   - A phase can complete without running Charlotte QA, then fail verification

10. **Why does verifier have separate checks for test files (Step 8d) and test execution (Step 8b)?**
    - Step 8b: runs test suite, checks for failures
    - Step 8d: checks that .test.ts files exist for each .ts/.tsx file
    - A phase could pass Step 8d (files exist) but fail Step 8b (tests don't pass)
    - Should these be unified?

---

## Summary of Most Critical Gaps

| # | Issue | Severity | Why Critical |
|---|-------|----------|---|
| 1 | Test gate skipped when test runner missing | HIGH | Implementation files shipped without test infrastructure |
| 2 | Charlotte QA trigger unreliable | HIGH | UI bugs can reach production without automated QA |
| 3 | E2E tests required but not generated | HIGH | Web phases can fail verification or miss integration testing |
| 4 | Docs failure doesn't block phase | HIGH | Contradicts "not skippable" — phases complete without docs |
| 5 | Integration testing not auto-triggered | MEDIUM | Cross-phase contract violations not caught |
| 6 | Deferral language incomplete detection | MEDIUM | QA/tests can be deferred undetected with non-standard phrasing |
| 7 | Self-check doesn't validate content | MEDIUM | SUMMARY.md can be empty but pass self-check |
| 8 | Test file check doesn't verify quality | MEDIUM | Hollow test files satisfy coverage requirement |
| 9 | Docs depth minimal for architecture changes | MEDIUM | Large architectural changes documented in one paragraph |
| 10 | UI file detection unreliable | MEDIUM | Real UI files can exist in codebase but not trigger QA |

---

**Analysis completed:** 2026-07-02  
**Audit by:** Claude Haiku (gsd-executor audit agent)
