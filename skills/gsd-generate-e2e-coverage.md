---
name: gsd:generate-e2e-coverage
description: Generate comprehensive e2e test coverage for all UI modules. Scans apps, creates test plan, generates/updates scenarios, tags them, selects regression candidates.
---

# Generate E2E Coverage

Bootstrap or update e2e test coverage for the iGaming platform.

## Process

### Step 1: Inventory UI Surfaces

Spawn two parallel gsd-ui-inventory agents:

```
Agent 1 (haiku): app_path = apps/player-web
Agent 2 (haiku): app_path = apps/operator-web
```

Wait for both to complete. Collect UI-INVENTORY.md from each.

### Step 2: Analyze Existing Coverage

Read all existing scenarios from `apps/e2e-charlotte/scenarios/`.
Build a coverage matrix: which pages/components have tests, which don't.

### Step 3: Generate Test Plan

Spawn gsd-e2e-test-generator agent (sonnet) with:
- Both UI inventories
- Existing scenario list with tags
- Coverage gaps identified

The agent produces:
- E2E-TEST-PLAN.md (comprehensive test plan)
- New scenario files in `apps/e2e-charlotte/scenarios/`
- Updated existing scenarios (added tags, expanded steps)

### Step 4: Review and Commit

Present the test plan to the user for review:
- Number of new tests created
- Number of existing tests updated
- Coverage improvement (before/after matrix)
- Recommended regression suite composition

After user approval, commit all changes.

### Step 5: Run Smoke Verification

Run the new tests with `--tags=smoke --parallel=2` to verify they execute.
Fix any issues found in the scenario definitions.
