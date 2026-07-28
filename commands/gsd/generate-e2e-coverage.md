---
name: gsd:generate-e2e-coverage
description: Generate comprehensive e2e test coverage for all UI modules. Scans apps, creates test plan, generates/updates scenarios, tags them, selects regression candidates.
argument-hint: "[app-path] [--focus=module]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - Task
---
<objective>
Bootstrap or update e2e test coverage for the iGaming platform web apps.

Scans player-web and operator-web to inventory all UI surfaces, compares against existing Charlotte e2e scenarios, identifies gaps, generates new test scenarios using QA methodologies, tags them, and selects regression candidates.
</objective>

<instructions>

## Step 1: Inventory UI Surfaces

Spawn two parallel agents (haiku) to scan app source code:

**Agent 1:** Scan `apps/player-web`
**Agent 2:** Scan `apps/operator-web`

Each agent should:
1. Find all pages/routes (Next.js `app/**/page.tsx`, `app/**/layout.tsx`)
2. Find all components — forms, modals, dialogs, dropdowns, tables, cards, widgets
3. Find all interactive elements per page (`<button`, `<input`, `<select`, `onClick`, `onSubmit`)
4. Find data display patterns (`formatAmount`, `formatDate`, `toLocaleString`)
5. Find state-dependent renders (`isLoading`, `isError`, `data?.`, `?? "N/A"`, `|| 0`)

Output: structured inventory listing routes, components, interactive elements, and high-risk data displays.

## Step 2: Analyze Existing Coverage

Read all existing scenarios from `apps/e2e-charlotte/scenarios/`.
Build a coverage matrix: which pages/components have tests, which don't.
List each page with status: covered / partially covered / uncovered.

## Step 3: Determine Fixture Strategy (MANDATORY — before any scenario is generated)

This step is ordered here deliberately. A fixture layer retrofitted after scenarios exist is a
rewrite, not a fix. Do not skip ahead to Step 4 until this step's output exists.

Read the full Fixture Isolation Mandate in `gsd-e2e-test-generator` (R1–R7) — it carries the
post-mortem rationale. This step produces the project-specific decisions it needs:

1. **Locate or create the naming helper.** One function produces every test identifier, as a pure
   function of the scenario's coordinates: `{prefix}-{module}-{scenarioId}[-w{bucketIndex}]@{testDomain}`.
   Random, UUID and timestamp suffixes are REJECTED — a failing run must be replayable. If the
   project has no such helper, creating it is part of this step.
2. **Locate or create the provisioning path.** Money, limits, verification status and sessions are
   established through real application endpoints, never SQL. SQL bypasses row-level security and
   business invariants and can build states the application could never produce; authorization
   defects then fail SILENTLY by returning wrong rows instead of erroring. SQL seeds are for static
   reference data only.
3. **Classify every planned scenario into a tier** — Tier 0 static reference data, Tier 1 shared
   read-only baseline per parallel bucket, Tier 2 dedicated account for anything that mutates money,
   limits, verification status, or session/suspension state. Default to Tier 2 when unsure.
4. **Confirm the suite-level reset gate exists** — a full regression run must begin from a freshly
   reset database, asserted at runtime, failing loudly if the precondition does not hold. Reset is
   suite-level; concurrent isolation comes from namespacing, not repeated resets.
5. **Confirm the declaration guard exists AND is unit-tested against the pattern it mandates.**
   A guard that resolves declarations by matching string literals will see nothing when the naming
   rule requires a helper call assigned to a const — writing the code correctly turns the guard off,
   and it reports PASS while inspecting almost nothing. Its tests must feed it the mandated pattern
   and assert non-empty resolution.

Output: a fixture-strategy section in the test plan naming the helper, the provisioning path, the
tier table (scenario → tier → accounts used → accounts mutated → teardown), and the reset gate.

## Step 4: Generate Test Plan

Using the inventory and coverage gaps, create an E2E-TEST-PLAN.md in `apps/e2e-charlotte/`.

For each uncovered or partially covered page, generate test scenarios using QA methodologies:

**Equivalence Partitioning:** Valid inputs, invalid inputs, boundary values
**Pairwise Testing:** For forms with multiple fields, pairwise combinations of field states
**State Transition Testing:** Map UI state transitions, test each path
**Visual Verification:** Check for NaN, undefined, null, layout issues, missing elements

Each scenario must follow the existing pattern in `apps/e2e-charlotte/scenarios/`:
- Use `Scenario` interface from `runner/types.ts`
- Include `tags: string[]` for filtering
- Use existing auth helpers (`loginAsPlayer`, `loginAsOperator`)
- Use existing seeders where applicable
- Include steps that exercise ALL interactive elements (click every dropdown, open every modal, fill every form)
- Include assertions that check for data display bugs (NaN, undefined, empty strings)
- Carry the tier assigned in Step 3, plus declarations of accounts used and accounts mutated
- Scope every assertion to the scenario's own identifiers — never a global count, never "the first
  row in the queue". Two scenarios doing that concurrently can each act on the other's data and
  both still pass.

## Step 5: Create Scenario Files

Write new scenario files for each gap identified.
Update index.ts files to include new scenarios.
Apply tags:
- `regression` — core user flows
- `functional` — specific feature behavior
- `ux` — visual/UX quality checks
- `security` — auth boundary tests
- `accessibility` — a11y checks
- Feature-specific tags matching existing vocabulary

## Step 6: Review

Present to user:
- Number of new tests created
- Coverage improvement (before/after)
- Recommended regression suite composition
- Any pages that need manual test design (too complex for automated generation)

## Step 7: Smoke Verification

After user approves, run `deno task test:smoke --parallel=2` to verify basic scenario execution.
Fix any issues in scenario definitions.

## Definition of Done

This command is NOT complete until every line below holds. Each is a gate, not a preference —
report the result of each explicitly.

- [ ] Every generated scenario carries a fixture tier (Step 3)
- [ ] No two mutating scenarios share an account; multi-actor subjects are freshly provisioned
- [ ] Every identifier comes from the single naming helper, assigned to a const — zero hand-typed
      literals, zero random/UUID/timestamp suffixes
- [ ] Invariant-carrying state (money, limits, verification status, sessions) is provisioned through
      real endpoints; SQL seeds are confined to static reference data
- [ ] Every mutation-class scenario has idempotent teardown, or an explicit annotation with a
      substantive reason, flagged for PR review
- [ ] The suite asserts at runtime that it began from a freshly reset database, and fails loudly
      otherwise
- [ ] The declaration guard has unit tests that feed it the exact pattern the naming rule mandates
      and assert non-empty resolution. Where the guard trusts a hand-written declaration rather than
      inferring mutation from the scenario's code, that limitation is stated in the guard's own
      output — a declaration nobody verifies is an honour system, and must not be reported as
      coverage.
- [ ] No assertion depends on a global count or on "the first row" of a shared queue

A pass count from a run that did not satisfy the reset gate is not a weak result — it is not a
result. Do not report it.

</instructions>
