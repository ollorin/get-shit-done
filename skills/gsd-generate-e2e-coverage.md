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

### Step 3: Fixture Strategy (MANDATORY — before generation)

Classify every planned scenario into a tier, and confirm the naming helper, the API provisioning
path, the suite reset gate, and the declaration guard exist. Retrofitting a fixture layer after
scenarios exist is a rewrite, not a fix.

Full mandate and rationale: R1–R7 in `gsd-e2e-test-generator`.

### Step 4: Generate Test Plan

Spawn gsd-e2e-test-generator agent (sonnet) with:
- Both UI inventories
- Existing scenario list with tags
- Coverage gaps identified

The agent produces:
- E2E-TEST-PLAN.md (comprehensive test plan)
- New scenario files in `apps/e2e-charlotte/scenarios/`
- Updated existing scenarios (added tags, expanded steps)

### Step 5: Review and Commit

Present the test plan to the user for review:
- Number of new tests created
- Number of existing tests updated
- Coverage improvement (before/after matrix)
- Recommended regression suite composition

After user approval, commit all changes.

### Step 6: Run Smoke Verification

Run the new tests with `--tags=smoke --parallel=2` to verify they execute.
Fix any issues found in the scenario definitions.

## Non-negotiable rules

- Tier 0 static reference data via SQL seed. Tier 1 one shared read-only account per parallel
  bucket. Tier 2 a dedicated account per scenario — required for anything that mutates money,
  limits, verification status, or session/suspension state. No reuse between mutating scenarios.
- Provision invariant-carrying state through real endpoints, never SQL. RLS defects fail silently.
- One naming helper, deterministic output, assigned to a const. No literals, no random suffixes.
- Idempotent teardown on every mutation-class scenario, or an annotated reason reviewed at PR time.
- The suite asserts it began from a freshly reset database and fails loudly if it did not. A pass
  count from a non-reset run is not evidence.
- The declaration guard must have unit tests feeding it the exact pattern the naming rule mandates —
  a guard that matches literals sees nothing once the code is written correctly, and reports PASS.
- Scope assertions to the scenario's own identifiers. No global counts, no "first row in the queue".
