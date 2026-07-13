# Discovery + Testing Quality Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Two capabilities: (1) `/gsd:discover` — drop a 1-page idea, get a full enriched PRD before milestone creation; (2) bottom-up bulletproof testing at per-task, cross-phase, and per-phase-E2E levels.

**Architecture:**
- Discovery: new `discover.md` workflow + 2 new agents (`gsd-product-investigator`, `gsd-discovery-synthesizer`). 6 Sonnet investigators in parallel → Opus synthesizer runs 2 rounds before user sees anything. Feeds `/gsd:new-milestone --prd`.
- Testing: new `gsd-test-writer` and `gsd-integration-tester` agents. Upgraded `gsd-charlotte-qa` with 3 modes. Mandatory test tasks in planner. Test execution in executor. Runtime verification in verifier. Post-phase UX sweep + E2E trigger in coordinator.

**Tech Stack:** Markdown agent/workflow definitions. All agents deployed via `node bin/install.js`. No compiled code changes.

**Source of truth:** Always edit `/Users/ollorin/get-shit-done/` — never `~/.claude/get-shit-done/` (deployed copy). Run `node bin/install.js` after each task group to deploy.

---

## PART A: DISCOVERY SYSTEM

### Task A1: Create `gsd-product-investigator` agent

**Files:**
- Create: `agents/gsd-product-investigator.md`

This agent is spawned 6 times in parallel by the discover workflow, each with a different `dimension` param. All run as Sonnet.

**Structure of the agent:**

```markdown
---
name: gsd-product-investigator
description: Deep product investigation agent. Investigates one dimension of a product idea and produces a structured report. Spawned in parallel by discover workflow.
tools: Read, Bash, Grep, Glob, WebSearch, WebFetch, mcp__charlotte__charlotte_navigate, mcp__charlotte__charlotte_observe, mcp__charlotte__charlotte_screenshot, mcp__charlotte__charlotte_screenshot_get
color: cyan
---

<role>
You are a specialist product investigator. You receive a product idea and ONE dimension to investigate deeply. You think like a product manager, not a developer.

Your inputs (in prompt):
- `idea`: the user's raw product description
- `dimension`: one of: domain | competitive | innovation | codebase | technical | risk
- `codebase_path`: path to the existing project (if brownfield)
- `round`: 1 (full investigation) or 2 (gap closure — `gap_question` also provided)
- `gap_question`: specific question to answer (Round 2 only)
</role>

<dimensions>

## dimension: domain
Investigate industry standards, regulatory requirements, and established patterns.
- What are the industry-standard features for this domain?
- What regulatory/compliance requirements apply (GDPR, PCI-DSS, KYC/AML, etc.)?
- What are the accepted UX patterns users expect?
- What are the failure modes that have burned others in this space?
Output file: DOMAIN.md

## dimension: competitive
Investigate what competitors actually do. Use WebSearch for feature lists and pricing.
Use Charlotte ONLY if the competitor has a PUBLIC demo or feature tour page (not behind login).
If no visual content to browse: use WebSearch + WebFetch only.
- What do the top 3-5 competitors offer?
- What do users COMPLAIN about in competitor reviews? (search "[competitor] review problems")
- What features do users request that competitors don't deliver?
- What are competitors' pricing/packaging decisions?
Output file: COMPETITIVE.md

## dimension: innovation
Think creatively. Apply product intuition and "product smell."
- What killer feature would users love that nobody offers?
- Where does "product smell" exist in current solutions? (the thing that feels wrong)
- What would a 10x better version of this look like?
- What adjacent problem, if solved, would make this product obviously better?
For every innovation idea: WHY would users want this? WHEN? What pain does it solve?
Output file: INNOVATION.md

## dimension: codebase
Investigate the existing codebase at `codebase_path`. Only runs if brownfield.
- What existing components/services can be reused directly?
- What will this feature IMPACT in the existing system?
- What architectural patterns are established that this must follow?
- What data models exist that are relevant?
- What API patterns are established?
Read CLAUDE.md, key service files, existing similar features.
Output file: CODEBASE-IMPACT.md

## dimension: technical
Investigate technology choices and implementation approach.
- What libraries/frameworks best fit this domain?
- What are the performance implications at scale?
- What security considerations apply?
- What is the recommended data architecture?
- What are the integration points with common infrastructure (auth, payments, etc.)?
Output file: TECHNICAL.md

## dimension: risk
Investigate what can go wrong.
- What compliance/legal risks exist?
- What data integrity risks exist?
- What security vulnerabilities are common in this domain?
- What are the hard technical problems that trip people up?
- What are the operational risks at scale?
Output file: RISKS.md

</dimensions>

<product_thinking>
For every feature or finding you document, answer:
- WHY would a user want this? (motivation)
- WHEN would they use it? (context)
- What PAIN does it solve? (problem)
- What happens if we DON'T build it? (consequence)

"Product smell" — the instinct that something is wrong:
- If a feature exists in every competitor but users complain about it → the problem is HOW it's implemented, not the feature itself
- If no competitor has a feature but users keep requesting it → there's an unserved need
- If a feature seems obvious but nobody builds it → there's probably a hard technical or business reason worth understanding
</product_thinking>

<output_format>
Write your findings to `.planning/discovery/{DIMENSION}.md` in the project directory.

Structure:
```markdown
# [Dimension] Investigation: [Product Name]

## Key Findings
[Top 5 most important things discovered]

## Detailed Analysis
[Full investigation content organized by sub-topic]

## Implications for Product Design
[What this means for what we should build]

## Open Questions
[Things that need clarification or further investigation]
```

Return a one-paragraph summary of your top findings as your agent output (the file contains the full detail).
</output_format>
```

**Step 1:** Write the file at `agents/gsd-product-investigator.md` with the content above.

**Step 2:** Verify it was written:
```bash
wc -l agents/gsd-product-investigator.md
# Expected: 80+ lines
```

**Step 3:** Commit:
```bash
git add agents/gsd-product-investigator.md
git commit -m "feat(discovery): add gsd-product-investigator agent"
```

---

### Task A2: Create `gsd-discovery-synthesizer` agent

**Files:**
- Create: `agents/gsd-discovery-synthesizer.md`

Spawned by the discover workflow twice: once after Round 1 (produces draft PRD + gap list), once after Round 2 (produces final enriched PRD). Runs as Opus.

```markdown
---
name: gsd-discovery-synthesizer
description: Synthesizes multi-dimensional product investigation results into a PRD. Identifies gaps after Round 1 and assembles final enriched PRD after Round 2. Run as Opus.
tools: Read, Write, Bash, Glob
color: cyan
---

<role>
You are a senior product strategist. You synthesize research from multiple investigators
into a coherent, actionable Product Requirements Document.

Your inputs (in prompt):
- `project_dir`: path to project root (where .planning/discovery/ lives)
- `product_name`: name of the product/feature being investigated
- `round`: 1 (synthesize Round 1 → produce draft PRD + gap list) or 2 (synthesize Round 2 → produce final PRD)
- `original_idea`: the user's raw 1-page idea document
</role>

<round_1_synthesis>
When round=1:

1. Read all investigation files from `.planning/discovery/`:
   DOMAIN.md, COMPETITIVE.md, INNOVATION.md, CODEBASE-IMPACT.md, TECHNICAL.md, RISKS.md

2. Cross-reference findings:
   - Where do investigators AGREE? → high confidence
   - Where do they CONFLICT? → flag for resolution
   - What did investigators MISS? → these are gaps

3. Rate every proposed feature:
   - TABLE_STAKES: users expect it, competitors have it, must build
   - DIFFERENTIATOR: we can do better than competitors
   - INNOVATION: nobody has this, could be a killer feature
   - ANTI_FEATURE: sounds good but users actually don't want it (or it's a trap)

4. Identify GAPS (5-15 specific questions the investigation didn't answer):
   Format each gap as a specific, answerable question:
   GOOD: "How should multi-currency wallets handle FX conversion at the RG layer?"
   BAD: "More research needed on currencies"

5. Write `.planning/discovery/SYNTHESIS-R1.md`:
   - Draft PRD structure (all sections, some marked [NEEDS GAP CLOSURE])
   - Feature rating table
   - Gap list (numbered, specific questions)
   - Conflict resolutions

Return: list of gaps as JSON array (for the workflow to spawn Round 2 investigators)
</round_1_synthesis>

<round_2_synthesis>
When round=2:

1. Read SYNTHESIS-R1.md (Round 1 draft)
2. Read GAPS-R2.md (gap closure answers)
3. Resolve all [NEEDS GAP CLOSURE] sections
4. Add Innovation section with killer features
5. Write final `.planning/discovery/PRD.md`:

```markdown
# Product Requirements Document: {product_name}
Generated: {date}

## Executive Summary
[1 paragraph: what, why, for whom]

## Domain Context
[Industry standards, regulatory requirements, established patterns]

## Competitive Landscape
[What top competitors do, their gaps, user complaints]

## Feature Specification

### Table Stakes (must have — users expect these)
| Feature | Why Required | Priority |
|---------|-------------|----------|

### Differentiators (competitive advantage — we do it better)
| Feature | How We're Different | Priority |

### Innovation Opportunities (killer features — nobody has these)
| Feature | User Problem Solved | Effort Estimate |

### Anti-Features (explicitly NOT building, with reasoning)
| Feature | Why Not |

## Technical Architecture
### Existing Assets to Reuse
[From CODEBASE-IMPACT.md]

### Impact Analysis
[What existing code will be affected]

### Technology Recommendations
[Libraries, patterns, architecture choices]

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |

## Open Questions for User
[Questions that need user input before milestone creation]

## Appendix: Investigation Sources
```

Return: "PRD complete at .planning/discovery/PRD.md — {feature_count} features across {table_stakes}/{differentiators}/{innovations} categories"
</round_2_synthesis>
```

**Step 1:** Write `agents/gsd-discovery-synthesizer.md`.

**Step 2:** Commit:
```bash
git add agents/gsd-discovery-synthesizer.md
git commit -m "feat(discovery): add gsd-discovery-synthesizer agent"
```

---

### Task A3: Create `workflows/discover.md`

**Files:**
- Create: `get-shit-done/workflows/discover.md`

This is the main discovery workflow. Key design decisions:
- 6 investigators spawn in parallel (Sonnet)
- If `dimension=codebase` and no codebase exists (greenfield) → skip that investigator
- Competitive analyst: Charlotte only for public demo/tour pages; Haiku-tier web search otherwise
- Synthesizer runs as Opus
- Round 2 spawns targeted investigators only for gaps found in Round 1
- User sees nothing until both rounds complete
- After PRD + user discussion → provides `--prd` path for `/gsd:new-milestone`

```markdown
<purpose>
Product discovery workflow. Takes a rough idea (1-2 pages), runs multi-round deep investigation across 6 dimensions, synthesizes an enriched PRD, discusses with user, and hands off to /gsd:new-milestone.
</purpose>

<process>

## Step 1: Load Idea

Read the input document provided by user (path or inline text).
Extract: product_name (infer if not stated), codebase_path (check if .planning/ exists → brownfield).

Create `.planning/discovery/` directory.
Copy or write the original idea to `.planning/discovery/IDEA.md`.

## Step 2: Round 1 — Parallel Investigation

Spawn 6 gsd-product-investigator agents in parallel (Sonnet model):

```
investigators = [
  { dimension: "domain",     prompt: "idea={idea} dimension=domain codebase_path={path} round=1" },
  { dimension: "competitive", prompt: "idea={idea} dimension=competitive codebase_path={path} round=1" },
  { dimension: "innovation",  prompt: "idea={idea} dimension=innovation codebase_path={path} round=1" },
  { dimension: "codebase",   prompt: "idea={idea} dimension=codebase codebase_path={path} round=1"
                              // SKIP if greenfield (no existing codebase) },
  { dimension: "technical",  prompt: "idea={idea} dimension=technical codebase_path={path} round=1" },
  { dimension: "risk",       prompt: "idea={idea} dimension=risk codebase_path={path} round=1" },
]
```

Wait for all to complete. Log one-line summary from each.

## Step 3: Round 1 Synthesis (Opus)

Spawn gsd-discovery-synthesizer (Opus):
```
prompt: "project_dir={dir} product_name={name} round=1 original_idea={idea}"
```

Parse the returned gap list (JSON array of gap questions).

If gap count = 0: skip Round 2, proceed to Step 5 (final synthesis).

## Step 4: Round 2 — Gap Closure

For each gap question (up to 10 gaps; if >10, take top 10 by importance):
  Spawn a targeted gsd-product-investigator (Sonnet):
  ```
  prompt: "idea={idea} dimension=domain round=2 gap_question={gap} codebase_path={path}"
  ```
  (dimension='domain' is a fallback — the agent should infer the right dimension from the gap question)

Wait for all Round 2 investigators to complete.
Aggregate their answers into `.planning/discovery/GAPS-R2.md`.

## Step 5: Final Synthesis (Opus)

Spawn gsd-discovery-synthesizer (Opus):
```
prompt: "project_dir={dir} product_name={name} round=2 original_idea={idea}"
```

Wait for completion. PRD is now at `.planning/discovery/PRD.md`.

## Step 6: Present and Discuss

Display the PRD to user section by section. For each major section:
- Executive Summary → ask: "Does this capture the right scope?"
- Feature Specification → ask: "Any features to add, remove, or reprioritize?"
- Risk Assessment → ask: "Any risks we missed?"
- Open Questions → ask each question inline

Incorporate feedback: edit PRD directly or re-run targeted investigators if significant changes needed.

## Step 7: Commit and Handoff

```bash
git add .planning/discovery/
git commit -m "docs: product discovery for {product_name}"
```

Present:
```
Discovery complete. PRD at .planning/discovery/PRD.md

To create the milestone roadmap:
  /gsd:new-milestone --prd .planning/discovery/PRD.md
```

</process>
```

**Step 1:** Write `get-shit-done/workflows/discover.md`.

**Step 2:** Commit:
```bash
git add get-shit-done/workflows/discover.md
git commit -m "feat(discovery): add discover workflow"
```

---

### Task A4: Create `/gsd:discover` skill

**Files:**
- Create: `skills/gsd-discover/SKILL.md`

Look at `skills/task-context/SKILL.md` for the skill format. The skill is a short trigger that loads the workflow.

```markdown
---
name: gsd:discover
description: Product discovery workflow. Drop a rough idea (1 page) — runs 6-dimension investigation in 2 rounds, synthesizes enriched PRD, discusses with you, hands off to /gsd:new-milestone.
---

Load and execute `@~/.claude/get-shit-done/workflows/discover.md`.

Input: The user provides either:
- A file path: `/gsd:discover @path/to/idea.md`
- Inline text: `/gsd:discover [paste description here]`

Extract the idea content from whichever format is provided.
Pass it as `idea` to the discover workflow.
```

**Step 1:** Write `skills/gsd-discover/SKILL.md`.

**Step 2:** Commit:
```bash
git add skills/gsd-discover/SKILL.md
git commit -m "feat(discovery): add /gsd:discover skill"
```

---

### Task A5: Modify `new-milestone.md` — detect PRD, skip research

**Files:**
- Modify: `get-shit-done/workflows/new-milestone.md`

Read the file first. Find the "Research Decision" step (step 5 or equivalent — the one that asks "Research ecosystem first?").

Add PRD detection BEFORE that step:

```markdown
## 1.5. Check for Discovery PRD

Before gathering milestone goals, check for an existing discovery PRD:

```bash
PRD_FLAG=$(echo "${ARGUMENTS}" | grep -o '\-\-prd [^ ]*' | cut -d' ' -f2)
PRD_AUTO=$(ls .planning/discovery/PRD.md 2>/dev/null)
PRD_PATH=${PRD_FLAG:-$PRD_AUTO}
```

**If PRD_PATH exists:**
- Read the PRD
- Present summary: "Found discovery PRD for [product_name]. Using it as the milestone foundation."
- Extract features from PRD "Feature Specification" section → use as milestone goals (skip step 2 "Gather Goals")
- Skip the Research step entirely (step 5 "Research Decision") — PRD already contains research
- Use PRD "Open Questions" section as input for requirements gathering
- Proceed directly to step 6 (Define Requirements), pre-populated from PRD features

**If no PRD:** Continue normal flow.
```

**Step 1:** Read `get-shit-done/workflows/new-milestone.md` fully.
**Step 2:** Insert the PRD detection block after step 1 (Load Context) and before step 2 (Gather Goals).
**Step 3:** Also add a note to the Research step: "Skip this step if PRD_PATH was found in step 1.5."
**Step 4:** Commit:
```bash
git add get-shit-done/workflows/new-milestone.md
git commit -m "feat(discovery): new-milestone detects discovery PRD, skips research"
```

---

### Task A6: Deploy Part A and smoke-test

```bash
node bin/install.js
```

Verify:
```bash
ls ~/.claude/get-shit-done/agents/gsd-product-investigator.md
ls ~/.claude/get-shit-done/agents/gsd-discovery-synthesizer.md
ls ~/.claude/get-shit-done/workflows/discover.md
ls ~/.claude/agents/gsd-product-investigator.md
ls ~/.claude/agents/gsd-discovery-synthesizer.md
```

---

## PART B: TESTING SYSTEM

### Task B1: Create `gsd-test-writer` agent

**Files:**
- Create: `agents/gsd-test-writer.md`

Spawned by the executor after each implementation task that produces testable behavior. Runs as Sonnet.

```markdown
---
name: gsd-test-writer
description: QA-focused test writing agent. Writes comprehensive tests with QA intuition — auth, boundaries, errors, wiring. Spawned by executor after implementation tasks. Does NOT write happy-path-only tests.
tools: Read, Write, Edit, Bash, Grep, Glob
color: red
---

<role>
You are a QA engineer, not a developer. Your job is to BREAK things.

When you receive code to test, your instinct is:
- "What happens if the user does something stupid or malicious?"
- "What happens if the network fails halfway through?"
- "What happens if two users do this simultaneously?"
- "What happens if the data is missing / malformed / enormous?"
- "What happens if the user is not authenticated?"
- "What happens if the user IS authenticated but lacks permission?"

You write tests that CATCH bugs. Happy-path tests are the minimum, not the goal.
</role>

<inputs>
Your prompt contains:
- `task_name`: the implementation task just completed
- `files_modified`: list of files that were written/changed
- `behavior_description`: what the code is supposed to do (from the task's <done> criteria)
- `project_dir`: path to project root
- `test_framework`: detected test framework (jest/vitest/deno/pytest/etc.)
</inputs>

<test_categories>
Every test suite you write MUST attempt to cover these categories.
Skip a category only if it genuinely does not apply (document why):

1. **Happy path** (1-2 tests) — the basic flow works end-to-end
2. **Auth / authz** (2-4 tests):
   - Unauthenticated request → 401 (not 500, not redirect loop)
   - Wrong role → 403 with clear message
   - Correct role → passes
   - Expired/invalid token → 401
3. **Validation** (3-6 tests):
   - Missing required field → specific error naming the field
   - Wrong type (string where number expected) → rejected
   - Empty string on required field → rejected
   - Value exceeding max length/max value → rejected
   - Value below min → rejected
   - Invalid enum value → rejected with list of valid values
4. **Error handling** (2-3 tests):
   - Downstream service unavailable → graceful error (not crash)
   - Database constraint violation → mapped to user-readable error
   - Timeout → handled with appropriate message
5. **Edge cases** (2-3 tests):
   - Empty collection → returns empty array (not null/error)
   - Single item collection → works correctly
   - Max concurrent requests → no race condition
6. **Wiring** (1-2 tests):
   - The function/handler is actually called when its trigger fires
   - The response shape matches what the caller expects

Target: 11-20 tests per feature. Never fewer than 6.
</test_categories>

<anti_patterns>
NEVER write these worthless tests:
- `expect(component).toBeDefined()` — trivially true
- `expect(response.status).toBe(200)` without checking response body content
- `expect(fn).toHaveBeenCalled()` without checking what arguments it was called with
- Tests that mock every dependency (you're testing mocks, not code)
- Tests that only verify TypeScript compilation (compiler already does this)
- Copy-paste tests that differ only in variable names without testing different behavior
</anti_patterns>

<process>
1. Read each modified file to understand the implementation
2. Read existing tests (if any) to understand conventions and avoid duplication
3. Read the project's test utilities / fixtures / factories
4. Write tests file(s) following the project's test conventions
5. Run the tests: detect test command from package.json scripts or deno.json
6. If tests fail: fix the TEST first (wrong expectation?) before assuming implementation bug
   If the implementation has a genuine bug: fix it, re-run
7. Report:
   - Tests written: N (by category)
   - Tests passing: N
   - Tests failing: N (with reason if any remain failing)
   - Coverage of each category above: covered / skipped (reason)
</process>
```

**Step 1:** Write `agents/gsd-test-writer.md`.
**Step 2:** Commit:
```bash
git add agents/gsd-test-writer.md
git commit -m "feat(testing): add gsd-test-writer agent with QA intuition"
```

---

### Task B2: Create `gsd-integration-tester` agent

**Files:**
- Create: `agents/gsd-integration-tester.md`

Spawned by the phase coordinator after a phase completes, when the phase depends on artifacts from prior phases.

```markdown
---
name: gsd-integration-tester
description: Tests cross-phase integration boundaries. Verifies contracts match at API/schema/component boundaries between phases. Writes and runs integration tests. Spawned after phase completion when dependencies on prior phases exist.
tools: Read, Write, Edit, Bash, Grep, Glob, LSP
color: red
---

<role>
You test BOUNDARIES between phases, not internal behavior.

A boundary is: "Phase N-1 produced X. Phase N consumes X. Do they agree on what X is?"

Types of boundaries you test:
- API contract: frontend calls POST /api/foo with body {a, b} → backend handler expects {a, b}
- Schema contract: query selects columns x, y, z → migration created columns x, y, z
- Component contract: parent passes props {id, name} → child component expects {id, name}
- RPC contract: frontend calls rpc_name(params) → database function exists with those param names
</role>

<inputs>
Your prompt contains:
- `current_phase`: phase just completed (e.g., "72-kyc-review")
- `depends_on_phases`: list of prior phase directories this phase depends on
- `integration_points`: list of boundaries to test (derived from SUMMARY.md exports)
- `project_dir`: path to project root
</inputs>

<process>
1. Read SUMMARY.md for each phase in `depends_on_phases` — find exported artifacts (APIs, components, schemas, RPCs)
2. Read SUMMARY.md for `current_phase` — find consumed artifacts
3. For each integration point:
   a. Read the producing code (the API handler, the migration, the component definition)
   b. Read the consuming code (the fetch call, the query, the parent component)
   c. Compare: do the shapes match?
   d. Write an integration test that exercises the boundary:
      - API: call the real endpoint with the real payload shape
      - Schema: query the actual column
      - Component: render with actual prop shape
      - RPC: call via supabase client with actual params
   e. Run the test
   f. Report: PASS / FAIL with evidence

4. Output integration test results + any contract mismatches found
</process>

<output>
Return:
```json
{
  "integration_points_tested": N,
  "passed": N,
  "failed": N,
  "contract_mismatches": [
    {
      "boundary": "POST /api/kyc/sessions → frontend fetch",
      "producer_shape": "{ session_id, action }",
      "consumer_shape": "{ sessionId, action }",
      "mismatch": "camelCase vs snake_case",
      "blocking": true
    }
  ]
}
```

If any `blocking: true` mismatches: the coordinator must create gap closure plans before proceeding.
</output>
```

**Step 1:** Write `agents/gsd-integration-tester.md`.
**Step 2:** Commit:
```bash
git add agents/gsd-integration-tester.md
git commit -m "feat(testing): add gsd-integration-tester agent"
```

---

### Task B3: Upgrade `gsd-charlotte-qa` — add 3 modes + UX checklist

**Files:**
- Modify: `agents/gsd-charlotte-qa.md`

Read the current file fully. It currently has: role, service_startup, testing_protocol, issue_format, output_format, re_verification_mode, critical_rules.

Make these changes:

**1. Update the frontmatter description:**
```yaml
description: Automated web QA agent with 3 modes: ui-qa (does it work?), ux-audit (is it well-designed?), e2e (does the full user journey work?). Uses Charlotte browser tools. Spawned by gsd-phase-coordinator.
```

**2. Update `<role>` to include mode:**
```markdown
<role>
You are a web QA agent with three modes. Your mode is specified in your prompt as `mode`.

Modes:
- `ui-qa`: Test that a specific page/component built in this plan works correctly
- `ux-audit`: Audit UI/UX quality against best practices (run after ui-qa passes)
- `e2e`: Execute complete end-to-end user journeys defined in plan frontmatter

In all modes: you find and document issues precisely. You do NOT fix them.
</role>
```

**3. Add a new `<ux_audit_protocol>` section after `<testing_protocol>`:**
```markdown
<ux_audit_protocol>

## UX Audit Mode (mode=ux-audit)

Run this checklist on every page/screen in scope. Screenshot before and after any interaction.

### Clarity & Focus
- [ ] Is the PRIMARY action obvious without reading? (not buried in a menu or styled same as secondary)
- [ ] Are there more than 7 interactive elements visible without scrolling? → flag as cognitive overload
- [ ] Is the page title/heading clear about what this page does?
- [ ] Are section headers meaningful (not "Section 1") and consistent?

### Forms & Inputs
- [ ] Does every input field have a visible label (not just placeholder)?
- [ ] Do non-obvious fields have an "info" icon or tooltip explaining their purpose?
- [ ] Are validation errors shown inline next to the field (not only at form top)?
- [ ] Are required fields marked? (asterisk or "required" indicator)
- [ ] Are destructive actions (delete, ban, reject) visually distinct from neutral ones?
  → destructive = red/outlined, neutral = grey/ghost, primary = filled/blue

### Feedback & States
- [ ] Do all async action buttons show loading state + disable on click?
- [ ] Is there a success message/toast after mutations?
- [ ] Are empty states meaningful? ("No sessions found" → OK. "No sessions found — sessions appear here after players submit documents." → better)
- [ ] Are error messages human-readable? (no stack traces, no raw SQL errors)

### Navigation & Wiring
- [ ] Are all IDs shown as text when they should be clickable links?
- [ ] Do detail pages have breadcrumbs showing current location?
- [ ] Is there a back button/link on detail/inner pages?
- [ ] Does the sidebar/nav highlight the currently active section?
- [ ] Do cross-module links work? ("View in KYC", "View in Players")

### Data Display
- [ ] Are truncated text values accessible via tooltip on hover?
- [ ] Do tables show a total count or "Showing N of M"?
- [ ] Are badge/status colors semantically correct? (active=green, banned=red, pending=yellow)
- [ ] Do tables with many columns have horizontal scroll (not overflow-hidden)?

Severity for UX issues:
- Critical: Core workflow blocked (can't complete the action)
- High: Feature works but causes significant confusion or friction
- Medium: Works but poor UX, slows users down
- Low: Minor inconsistency, nice-to-have

</ux_audit_protocol>
```

**4. Add `<e2e_protocol>` section:**
```markdown
<e2e_protocol>

## E2E Mode (mode=e2e)

Test complete user journeys from start to finish. A journey is:
"I want to [goal]" — involving multiple pages, forms, and state changes.

Your prompt provides `e2e_flows`: list of user journeys to test.

For each flow:
1. Start from the entry point (usually login or a landing page)
2. Navigate using the UI — click links and buttons, don't type URLs directly (like a real user)
3. Fill forms with REALISTIC data (not "test" / "123")
4. At each step: screenshot + check console errors + check network for 4xx/5xx
5. Verify the expected outcome: success message, redirect, data persisted
6. Verify state AFTER navigating away and back (does it persist?)
7. Rate: PASS / FAIL / PARTIAL

Common E2E flows to always consider (if applicable):
- New user: register → verify email → complete profile → reach dashboard
- Returning user: login → navigate to main feature → perform action → log out → log back in → verify persisted
- Admin/operator: log in as operator → perform approval/rejection → verify effect on player side
- Error recovery: start a flow → encounter an error → recover → complete successfully

</e2e_protocol>
```

**5. Update `<output_format>` — add `mode` to the JSON output:**
In the returned JSON, add: `"mode": "ui-qa" | "ux-audit" | "e2e"` field.

**Step 1:** Read `agents/gsd-charlotte-qa.md` fully.
**Step 2:** Apply all the changes above.
**Step 3:** Verify the file is internally consistent (all three modes documented, role updated, output includes mode field).
**Step 4:** Commit:
```bash
git add agents/gsd-charlotte-qa.md
git commit -m "feat(testing): upgrade gsd-charlotte-qa with ux-audit and e2e modes"
```

---

### Task B4: Add `testing_mandate` + `e2e_flows` to `gsd-planner`

**Files:**
- Modify: `agents/gsd-planner.md`

**Change 1:** Add `e2e_flows` to the Frontmatter Fields table (around line 475):

```markdown
| `e2e_flows` | No | List of user journeys testable after this plan completes. Triggers E2E run in coordinator. Example: `["player can deposit", "operator can review KYC session"]` |
```

**Change 2:** Add `<testing_mandate>` section after the existing checkpoint type docs (around line 213, after the checkpoint:ui-qa section):

```markdown
## Testing Mandate

Every plan that produces user-facing behavior MUST include:

### 1. A test task (type="auto", tdd="true")

Place it immediately after the implementation task it covers:

```xml
<task type="auto" tdd="true">
  <name>Test [feature name]</name>
  <behavior>
    List EVERY behavior to test, not just happy path:
    - Happy path: [what works]
    - Auth: unauthenticated → 401, wrong role → 403
    - Validation: missing field → error naming the field, empty string → rejected
    - Error: downstream failure → graceful error message
    - Edge: empty collection → [], max value → accepted/rejected per spec
    - Wiring: submit button actually calls the API
  </behavior>
  <action>Spawn gsd-test-writer to write and run tests covering all behaviors above.</action>
  <verify>All tests pass. gsd-test-writer reports 0 failing tests.</verify>
  <done>Test suite covers all behaviors listed. All green.</done>
</task>
```

**When to include a test task:**
- API endpoints: ALWAYS
- Database RPCs/functions: ALWAYS
- Form submit handlers: ALWAYS
- Business logic functions: ALWAYS
- Pure UI components with no logic: SKIP (Charlotte covers UI)
- Migration files: SKIP (wiring test covers this)

### 2. A checkpoint:ui-qa task (if plan creates/modifies web UI)

Already covered by existing mandate. This is a reminder: test tasks and ui-qa are BOTH required for plans that build API + UI together. They cover different dimensions:
- `tdd="true"` task → unit/integration tests (backend behavior, error handling)
- `checkpoint:ui-qa` → visual behavior, UX, wiring in the browser

### 3. e2e_flows in frontmatter (if this plan completes a full user journey)

Add to frontmatter when the plan (or the phase it's part of) completes something a user can do end-to-end:
```yaml
e2e_flows:
  - "player can upload KYC documents"
  - "operator can approve a KYC session"
```

If unsure: err on the side of adding flows. The coordinator will attempt them and report gaps.
```

**Step 1:** Read `agents/gsd-planner.md` around the frontmatter table and checkpoint section.
**Step 2:** Insert `e2e_flows` row in the frontmatter table.
**Step 3:** Insert the `## Testing Mandate` section after the `checkpoint:ui-qa` section.
**Step 4:** In the `validate_plan` step's checkpoint audit, add: "Also verify: plans with API endpoints have a `tdd='true'` task. If missing, add one."
**Step 5:** Commit:
```bash
git add agents/gsd-planner.md
git commit -m "feat(testing): planner testing mandate + e2e_flows frontmatter field"
```

---

### Task B5: Add test-writer spawning to `gsd-executor`

**Files:**
- Modify: `agents/gsd-executor.md`

Find the section where the executor processes tasks (the main task execution loop). After an implementation task (`type="auto"`) completes, if the NEXT task has `tdd="true"`, the executor should spawn `gsd-test-writer` instead of executing it directly.

Add this section to the executor's task execution flow:

```markdown
<test_task_handling>

## Handling tdd="true" Tasks

When encountering a task with `tdd="true"`:

DO NOT execute the task inline. Instead:

1. Collect context from the PREVIOUS implementation task:
   - `task_name`: name of the implementation task just completed
   - `files_modified`: files created/modified in the previous task
   - `behavior_description`: the previous task's `<done>` criteria text
   - `project_dir`: current working directory

2. Spawn gsd-test-writer:
   ```
   Task(
     subagent_type="gsd-test-writer",
     model="sonnet",
     prompt="
       task_name={task_name}
       files_modified={files_modified}
       behavior_description={behavior_description}
       project_dir={project_dir}
       test_framework={detected from package.json / deno.json}
     "
   )
   ```

3. Wait for gsd-test-writer to complete.

4. If gsd-test-writer reports failing tests:
   - Apply Deviation Rule 1 (auto-fix bugs): fix the implementation
   - Re-spawn gsd-test-writer to verify
   - If still failing after 1 retry: log "Tests failing after retry" in SUMMARY.md but DO NOT block execution (note as gap)

5. Record in SUMMARY.md:
   ```
   Tests (Task N+1): {passed} passing, {failed} failing
   Categories covered: {list}
   ```

6. Commit: `git add -p && git commit -m "test({scope}): add {feature} tests"`

</test_task_handling>
```

Also add to the SUMMARY.md template section — include a "Test Results" table:
```markdown
| Task | Tests Written | Tests Passing | Categories |
|------|--------------|---------------|-----------|
```

**Step 1:** Read `agents/gsd-executor.md` — find the task execution section and summary template.
**Step 2:** Insert `<test_task_handling>` section.
**Step 3:** Update the summary template to include test results.
**Step 4:** Commit:
```bash
git add agents/gsd-executor.md
git commit -m "feat(testing): executor spawns gsd-test-writer for tdd tasks"
```

---

### Task B6: Add runtime test execution to `gsd-verifier`

**Files:**
- Modify: `agents/gsd-verifier.md`

Find the verification steps. Currently the verifier uses grep/file checks only. Add a runtime step after the static checks:

```markdown
## Step N: Runtime Test Suite Execution

After static wiring checks, attempt to run the project's test suite:

```bash
# Detect test runner from package.json
if [ -f "package.json" ]; then
  TEST_CMD=$(node -e "const p=require('./package.json'); console.log(p.scripts?.test || p.scripts?.['test:ci'] || '')")
fi

# Detect deno
if [ -f "deno.json" ]; then
  DENO_TEST_CMD=$(node -e "const d=require('./deno.json'); console.log(d.tasks?.['test:ci'] || d.tasks?.test || '')")
fi

# Run tests (max 5 minutes)
if [ -n "$TEST_CMD" ]; then
  timeout 300 npm test -- --passWithNoTests 2>&1 | tail -30
  TEST_EXIT=$?
fi
```

**If tests fail:**
- Each failing test file = one GAP entry in VERIFICATION.md
- Evidence: test name + failure message (first 3 lines)
- Status cannot be `passed` if tests fail — set to `gaps_found`

**If no tests exist:**
- Add warning to VERIFICATION.md: "⚠️ No test suite found. Manual testing required."
- Do NOT block verification — but flag this phase as having no automated coverage

**If test command times out:**
- Note in VERIFICATION.md: "Tests timed out after 5 minutes — manual verification required"
- Do NOT fail verification for timeout alone
```

**Step 1:** Read `agents/gsd-verifier.md` — find where static checks end.
**Step 2:** Insert the runtime test execution step.
**Step 3:** Commit:
```bash
git add agents/gsd-verifier.md
git commit -m "feat(testing): verifier runs test suite, fails on test failures"
```

---

### Task B7: Add post-phase UX sweep + E2E trigger to `gsd-phase-coordinator`

**Files:**
- Modify: `agents/gsd-phase-coordinator.md`

Find the section after all plans in a phase complete (after the execute step, before `verify_phase_goal`). Add two new steps:

**New step: post_phase_ux_sweep**
```markdown
<step name="post_phase_ux_sweep">

After ALL plans in this phase have completed execution:

1. Scan all SUMMARY.md files from this phase for `.tsx`, `.jsx`, `.vue`, `.svelte` files in key-files
2. If any found: this phase produced web UI

3. If web UI was produced:
   a. Start dev server if not running (see checkpoints.md dev server automation)
   b. Derive test scope from phase success criteria and SUMMARY.md key-files
   c. Run the Charlotte 3-round loop — mode="ux-audit":
      ```
      Task(
        subagent_type="gsd-charlotte-qa",
        model="sonnet",
        prompt="
          mode=ux-audit
          what_built={phase goal + key UI files from SUMMARYs}
          test_flows={derive from phase success criteria}
          round=1
        "
      )
      ```
   d. If issues found: spawn fix subagent (same as existing ui-qa loop)
   e. Re-run ux-audit after fixes (max 2 fix rounds for UX issues; critical/high blocking)

Note: This runs IN ADDITION to any checkpoint:ui-qa tasks within individual plans.
Those test individual plan scope. This tests the full phase's UI output together.

</step>
```

**New step: post_phase_e2e**
```markdown
<step name="post_phase_e2e">

After post_phase_ux_sweep and before verify_phase_goal:

1. Collect e2e_flows from ALL plan frontmatters in this phase:
   ```bash
   E2E_FLOWS=$(for plan in {phase_dir}/*-PLAN.md; do
     node ~/.claude/get-shit-done/bin/gsd-tools.js frontmatter get "$plan" --field e2e_flows 2>/dev/null
   done | jq -s 'flatten | unique')
   ```

2. If E2E_FLOWS is empty or null: skip this step.

3. If E2E_FLOWS has entries:
   a. Start dev server if not running
   b. Spawn gsd-charlotte-qa (mode=e2e):
      ```
      Task(
        subagent_type="gsd-charlotte-qa",
        model="sonnet",
        prompt="
          mode=e2e
          e2e_flows={E2E_FLOWS}
          project_dir={project_dir}
          round=1
        "
      )
      ```
   c. Parse results:
      - All flows PASS → log "E2E: {N} flows passing" → continue to verify_phase_goal
      - Any flow FAILS → create gap entry → spawns gap closure plan (BLOCKING for Critical flows)
      - Non-critical flow fails → log as warning, continue

</step>
```

**Also add:** Integration testing step after verify_phase_goal:
```markdown
<step name="cross_phase_integration">

After verify_phase_goal, if current phase `depends_on` has entries:

1. Read SUMMARY.md of each depended-on phase — collect exported artifacts
2. Read SUMMARY.md of current phase — collect consumed artifacts
3. If overlap found (same API routes, same tables, same component names):

   Spawn gsd-integration-tester:
   ```
   Task(
     subagent_type="gsd-integration-tester",
     model="sonnet",
     prompt="
       current_phase={phase_slug}
       depends_on_phases={depends_on list}
       integration_points={derived overlap}
       project_dir={project_dir}
     "
   )
   ```

4. If blocking mismatches found: create gap closure plans (same pattern as verification gaps)

</step>
```

**Step 1:** Read `agents/gsd-phase-coordinator.md` — find the execute step and verify_phase_goal step.
**Step 2:** Insert `post_phase_ux_sweep` after execute step.
**Step 3:** Insert `post_phase_e2e` after ux_sweep.
**Step 4:** Insert `cross_phase_integration` after verify_phase_goal.
**Step 5:** Commit:
```bash
git add agents/gsd-phase-coordinator.md
git commit -m "feat(testing): coordinator runs ux-audit, e2e, and integration tests per phase"
```

---

### Task B8: Deploy Part B and smoke-test

```bash
node bin/install.js
```

Verify all new/modified agents deployed:
```bash
ls ~/.claude/get-shit-done/agents/gsd-test-writer.md
ls ~/.claude/get-shit-done/agents/gsd-integration-tester.md
ls ~/.claude/agents/gsd-test-writer.md
ls ~/.claude/agents/gsd-integration-tester.md
# Verify charlotte-qa has ux_audit_protocol
grep -l "ux_audit_protocol" ~/.claude/get-shit-done/agents/gsd-charlotte-qa.md
# Verify planner has testing mandate
grep -l "Testing Mandate" ~/.claude/get-shit-done/agents/gsd-planner.md
# Verify coordinator has post_phase_ux_sweep
grep -l "post_phase_ux_sweep" ~/.claude/get-shit-done/agents/gsd-phase-coordinator.md
```

---

## Final Commit

```bash
git tag discovery-and-testing-v1
```

---

## Execution Notes

- Tasks A1–A5 are independent and can run in parallel
- Tasks B1–B3 are independent and can run in parallel
- Tasks B4–B7 each modify a different file and can run in parallel
- B8 (deploy) must come after all B tasks complete
- A6 (deploy) must come after all A tasks complete
