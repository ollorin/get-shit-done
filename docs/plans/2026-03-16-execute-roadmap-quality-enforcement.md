# Execute-Roadmap Quality Enforcement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the execute-roadmap quality gates (integration tests, Charlotte E2E, full check suite) structurally unskippable — enforced by tooling, not by prose instructions.

**Architecture:** Three changes: (1) enrich the phase coordinator spawn prompt so test stages actually fire, (2) add cross-phase integration test checkpoints between phases, (3) replace the 113-line prose quality gate section with a programmatic `gsd-tools.js gate:pre-pr` command that hard-blocks PR creation.

**Tech Stack:** Node.js (gsd-tools.js), Markdown workflows, Bash

---

## Task 1: Enrich Phase Coordinator Spawn Prompt

**Files:**
- Modify: `/Users/ollorin/get-shit-done/get-shit-done/workflows/execute-roadmap.md:206-220`

**Why:** The current spawn prompt says `"Full cycle: research -> plan -> execute -> verify"` — this is too vague. The phase coordinator has 13 test stages, but under context pressure it skips Charlotte QA, UX sweeps, and E2E generation because the spawn prompt doesn't mention them.

**Step 1: Update the spawn prompt template**

Replace lines 206-220 with an explicit prompt that lists mandatory test stages:

```markdown
Agent(
  subagent_type="gsd-phase-coordinator",
  model="{COORDINATOR_MODEL}",
  description="Execute phase {N}",
  prompt="Execute Phase {N}: {name}

  Phase directory: .planning/phases/{phase_dir}/
  Phase goal: {goal}

  Full lifecycle — ALL steps mandatory, in order:
  1. Research (skip if not needed)
  2. Plan — MUST include tdd='true' tasks for API work, checkpoint:ui-qa for UI work.
     Planner MUST run validate_testing_gate before returning plans.
     If phase touches UI: generate E2E-TEST-PLAN.md via gsd-ui-inventory + gsd-e2e-test-generator.
  3. Execute — tdd tasks spawn gsd-test-writer (min 6 tests, 6 categories).
     checkpoint:ui-qa tasks trigger Charlotte QA loop (3 rounds) + MANDATORY ux-audit.
     Post-plan test gate: full test suite must pass before SUMMARY.md.
  4. Post-execution — If web project: run post_phase_ux_sweep (Charlotte ux-audit, unconditional).
     If e2e_flows in plan frontmatters: run Charlotte e2e mode.
     If UI built: run E2E gap closure (Step 6.5 of execute-phase).
  5. Verify — MUST spawn gsd-verifier agent. NEVER write VERIFICATION.md inline for phases with UI.
     Verifier checks QGATE-07 (Charlotte ran), QGATE-10 (test files exist), QGATE-13 (E2E plan exists).

  HARD RULES:
  - Phase with .tsx/.jsx files CANNOT have verifier: coordinator in VERIFICATION.md
  - Phase with API endpoints CANNOT skip tdd tasks
  - Charlotte QA + UX audit CANNOT be skipped for web projects

  Create checkpoint after each step.
  telegram_topic_id: {telegram_topic_id}
  Return structured completion state as JSON."
)
```

**Step 2: Commit**

```bash
git add get-shit-done/workflows/execute-roadmap.md
git commit -m "fix(execute-roadmap): enrich phase coordinator spawn prompt with explicit test stages"
```

---

## Task 2: Add Cross-Phase Integration Test Checkpoint

**Files:**
- Modify: `/Users/ollorin/get-shit-done/get-shit-done/workflows/execute-roadmap.md:223-247`

**Why:** Currently all integration tests run AFTER all phases complete. This means a migration bug in Phase 100 cascades into 52 failures discovered only at the end. Running integration tests between phases catches failures at 2, not 52.

**Step 1: Add integration test checkpoint after phase completion**

After the "5. Handle result" section (line 228) and before "6. Archive phase context" (line 230), add a new step:

```markdown
**5b. Cross-phase integration checkpoint (if phase produced DB or API changes):**

Check if the completed phase modified migrations or edge functions:
```bash
PHASE_FILES=$(git diff --name-only HEAD~1 2>/dev/null || echo "")
HAS_MIGRATIONS=$(echo "$PHASE_FILES" | grep -c "migrations/" || echo "0")
HAS_FUNCTIONS=$(echo "$PHASE_FILES" | grep -c "functions/" || echo "0")
```

If `HAS_MIGRATIONS > 0` OR `HAS_FUNCTIONS > 0`:

1. Reset local DB to apply new migrations:
```bash
cd apps/api && npx supabase db reset 2>&1 | tail -5
```
If reset fails: **STOP. Migration is broken. Fix before continuing.**

2. Run integration tests:
```bash
cd apps/api && NODE_ENV=test DENO_ENV=test deno test --allow-all --env-file=.env.test functions/__tests__/*.integration.test.ts 2>&1 | tail -10
```
If failures > 0:
- Log `integration_test_failure` event to EXECUTION_LOG.md
- Present failures to user
- **STOP. Fix failures before starting next phase.**

3. Log success:
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js execution-log event \
  --type cross_phase_integration \
  --data '{"phase": {N}, "tests_passed": true, "timestamp": "..."}'
```

**Rationale:** Catching integration failures between phases (2 failures) is dramatically cheaper than catching them after all phases (52 failures). Each phase's migrations are tested against the full chain before the next phase builds on top.
```

**Step 2: Commit**

```bash
git add get-shit-done/workflows/execute-roadmap.md
git commit -m "feat(execute-roadmap): add cross-phase integration test checkpoint between phases"
```

---

## Task 3: Add `gate:pre-pr` Command to gsd-tools.js

**Files:**
- Modify: `/Users/ollorin/get-shit-done/get-shit-done/bin/gsd-tools.js`

**Why:** The quality gates are 113 lines of prose that Claude can rationalize skipping. A single `gate:pre-pr` command that exits non-zero on failure is structurally unskippable — same enforcement pattern as `phase complete` checking VERIFICATION.md.

**Step 1: Find the switch statement and add the gate command**

The command switch is at ~line 9812. Add a new case:

```javascript
case 'gate': {
  const subCmd = args[1];
  if (subCmd === 'pre-pr') {
    cmdGatePrePr(cwd, args.slice(2), raw);
  } else {
    console.error(`Unknown gate subcommand: ${subCmd}`);
    process.exit(1);
  }
  break;
}
```

**Step 2: Implement cmdGatePrePr function**

Add before the switch statement (near other cmd* functions):

```javascript
function cmdGatePrePr(cwd, args, raw) {
  const planningDir = path.join(cwd, '.planning');
  const execLogPath = path.join(planningDir, 'EXECUTION_LOG.md');

  // Check if execution log exists
  if (!fs.existsSync(execLogPath)) {
    outputResult({ error: 'No EXECUTION_LOG.md found. Run execute-roadmap first.', gate: 'pre-pr', passed: false }, raw);
    process.exit(1);
  }

  // Check all phases are complete
  const logContent = fs.readFileSync(execLogPath, 'utf-8');
  const lines = logContent.split('\n').filter(l => l.trim().startsWith('{'));

  const phaseStarts = lines.filter(l => {
    try { return JSON.parse(l).type === 'phase_start'; } catch { return false; }
  });
  const phaseCompletes = lines.filter(l => {
    try { return JSON.parse(l).type === 'phase_complete'; } catch { return false; }
  });

  if (phaseStarts.length > phaseCompletes.length) {
    const startedPhases = phaseStarts.map(l => JSON.parse(l).data?.phase || JSON.parse(l).phase);
    const completedPhases = phaseCompletes.map(l => JSON.parse(l).data?.phase || JSON.parse(l).phase);
    const incomplete = startedPhases.filter(p => !completedPhases.includes(p));
    outputResult({
      error: `Incomplete phases: ${incomplete.join(', ')}. All phases must complete before PR.`,
      gate: 'pre-pr',
      passed: false,
      incomplete_phases: incomplete
    }, raw);
    process.exit(1);
  }

  // Check for existing gate marker
  const hasGateMarker = lines.some(l => {
    try { return JSON.parse(l).type === 'gate_pre_pr_passed'; } catch { return false; }
  });

  if (hasGateMarker) {
    outputResult({ gate: 'pre-pr', passed: true, cached: true, message: 'Gate already passed in this execution.' }, raw);
    return;
  }

  // Output instructions for the coordinator to run checks
  // The coordinator must run each check and report back
  outputResult({
    gate: 'pre-pr',
    passed: false,
    action_required: true,
    checks: [
      { id: 'db-reset', command: 'cd apps/api && npx supabase db reset', required: true },
      { id: 'integration-tests', command: 'cd apps/api && NODE_ENV=test DENO_ENV=test deno test --allow-all --env-file=.env.test functions/__tests__/*.integration.test.ts', required: true },
      { id: 'backend-unit-tests', command: 'cd apps/api && NODE_ENV=test DENO_ENV=test deno task test:ci', required: true },
      { id: 'deno-lint', command: 'cd apps/api && deno lint', required: true },
      { id: 'deno-check', command: 'cd apps/api && deno check --quiet functions/*/index.ts', required: true },
      { id: 'player-web-test', command: 'CI=true npx nx test player-web', required: true },
      { id: 'operator-web-test', command: 'CI=true npx nx test operator-web', required: true },
      { id: 'player-web-build', command: 'npx nx build player-web', required: true },
      { id: 'operator-web-build', command: 'npx nx build operator-web', required: true },
      { id: 'player-web-lint', command: 'npx nx lint player-web', required: true },
      { id: 'operator-web-lint', command: 'npx nx lint operator-web', required: true },
      { id: 'charlotte-regression', command: 'cd apps/e2e-charlotte && deno task test:regression', required: 'if_web_project' },
    ],
    instructions: 'Run each check. If ALL pass, call: gsd-tools gate pre-pr --mark-passed. If any fail, fix and re-run.',
    mark_command: 'node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr --mark-passed'
  }, raw);
}
```

**Step 3: Add the --mark-passed handler**

In the same function, at the top, handle the mark flag:

```javascript
function cmdGatePrePr(cwd, args, raw) {
  const markPassed = args.includes('--mark-passed');
  const planningDir = path.join(cwd, '.planning');
  const execLogPath = path.join(planningDir, 'EXECUTION_LOG.md');

  if (markPassed) {
    // Write gate passed marker to execution log
    const event = JSON.stringify({
      type: 'gate_pre_pr_passed',
      timestamp: new Date().toISOString(),
      checks_passed: true
    });
    fs.appendFileSync(execLogPath, event + '\n');
    outputResult({ gate: 'pre-pr', passed: true, marked: true }, raw);
    return;
  }

  // ... rest of function
}
```

**Step 4: Commit**

```bash
git add get-shit-done/bin/gsd-tools.js
git commit -m "feat(gsd-tools): add gate:pre-pr command for programmatic quality gate enforcement"
```

---

## Task 4: Update execute-roadmap.md to Use gate:pre-pr

**Files:**
- Modify: `/Users/ollorin/get-shit-done/get-shit-done/workflows/execute-roadmap.md:357-470`

**Why:** Replace the 113-line prose quality gate section with a call to the new command.

**Step 1: Replace the quality gate prose section**

Replace lines 357-470 (from "3. Pre-PR quality gates" through the E2E regression gate) with:

```markdown
3. **Pre-PR quality gates (programmatic enforcement):**

Check current branch:
```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
```

If `CURRENT_BRANCH` is `main` or `master`: skip steps 3 and 4.

Otherwise:

```bash
GATE_RESULT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr)
```

Parse the JSON output. If `action_required` is true:
- Run EVERY check listed in `checks` array
- Each check must exit 0
- Run the full suite TWICE — both runs must be green
- After both runs pass, mark the gate:
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr --mark-passed
```

If any check fails: **STOP. Fix the failure. Re-run from the beginning.**

There is NO bypass. The `gate pre-pr --mark-passed` command writes a marker to EXECUTION_LOG.md.
The PR creation step below checks for this marker.

### E2E Regression Gate (Web Projects)

**Before marking the gate as passed:**

1. Start frontend dev servers (required for Charlotte):
```bash
npx nx dev player-web &
npx nx dev operator-web &
# Wait for both to be ready
```

2. Run Charlotte regression tests:
```bash
cd apps/e2e-charlotte && deno task test:regression
```

3. ALL regression-tagged tests must PASS
4. If any fail:
   - Show failure report
   - Spawn debug agent to diagnose
   - Create fix plan
   - Execute fixes
   - Re-run regression
   - Max 3 attempts before escalating to user
5. This gate is NON-NEGOTIABLE for web projects — no PR without green regression
```

**Step 2: Update PR creation to check gate marker**

In the PR creation section (step 4), add a guard:

```markdown
4. **Push branch and open PR (requires gate marker):**

```bash
# Verify gate was passed
GATE_CHECK=$(node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr)
if echo "$GATE_CHECK" | grep -q '"passed":true'; then
  git push -u origin {CURRENT_BRANCH}
  gh pr create ...
else
  echo "ERROR: Quality gates not passed. Run all checks first."
  echo "$GATE_CHECK"
  exit 1
fi
```
```

**Step 3: Commit**

```bash
git add get-shit-done/workflows/execute-roadmap.md
git commit -m "refactor(execute-roadmap): replace prose quality gates with programmatic gate:pre-pr enforcement"
```

---

## Task 5: Run Tests and Verify

**Step 1: Run existing gsd-tools tests**

```bash
cd ~/get-shit-done && npm test
```

Expected: All existing tests pass.

**Step 2: Test gate:pre-pr manually**

```bash
cd ~/igaming-platform
node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr
```

Expected: Returns JSON with `action_required: true` and list of checks.

```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr --mark-passed
```

Expected: Returns `{gate: "pre-pr", passed: true, marked: true}`.

**Step 3: Commit test verification**

```bash
git add -A
git commit -m "test: verify gate:pre-pr command works end-to-end"
```

---

## Task 6: Run Local Install Script

**Step 1: Run the install orchestrator**

```bash
cd ~/get-shit-done && npm run install:gsd
```

This copies the updated files to `~/.claude/get-shit-done/`.

**Step 2: Verify installation**

```bash
# Check the updated workflow was installed
grep "validate_testing_gate" ~/.claude/get-shit-done/workflows/execute-roadmap.md
# Check the gate command is available
node ~/.claude/get-shit-done/bin/gsd-tools.js gate pre-pr --help 2>&1 || echo "Command registered"
```

**Step 3: Commit any install artifacts if needed**

---

## Summary

| Task | What | Why |
|------|------|-----|
| 1 | Enrich spawn prompt with 13 test stages | Coordinators skip what they don't know about |
| 2 | Cross-phase integration checkpoints | Catch 2 failures per phase, not 52 at the end |
| 3 | `gate:pre-pr` command in gsd-tools.js | Programmatic enforcement > prose instructions |
| 4 | Wire gate into execute-roadmap.md | PR creation blocked without gate marker |
| 5 | Run tests | Verify nothing broke |
| 6 | Local install | Update working copy in ~/.claude |
