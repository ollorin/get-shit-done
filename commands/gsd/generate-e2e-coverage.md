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

## Step 3: Generate Test Plan

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

## Step 4: Create Scenario Files

Write new scenario files for each gap identified.
Update index.ts files to include new scenarios.
Apply tags:
- `regression` — core user flows
- `functional` — specific feature behavior
- `ux` — visual/UX quality checks
- `security` — auth boundary tests
- `accessibility` — a11y checks
- Feature-specific tags matching existing vocabulary

## Step 5: Review

Present to user:
- Number of new tests created
- Coverage improvement (before/after)
- Recommended regression suite composition
- Any pages that need manual test design (too complex for automated generation)

## Step 6: Smoke Verification

After user approves, run `deno task test:smoke --parallel=2` to verify basic scenario execution.
Fix any issues in scenario definitions.

</instructions>
