# gsd-planner.md — Planning Detail (Phase 53-02, MILE-30)

This file holds the FULL, VERBATIM detail relocated from
`agents/gsd-planner.md` during the MILE-30 hard-rules-first
restructuring: philosophy, discovery levels, task breakdown (task anatomy,
task types, checkpoint:ui-qa guidance, testing mandate detail, task sizing,
specificity examples, TDD detection, user setup detection), dependency
graph construction, scope estimation, PLAN.md format/template, goal-backward
methodology, checkpoint type reference (human-verify/decision/human-action,
anti-patterns), TDD plan structure, gap closure mode, revision mode, and the
full execution_flow (every planning step). Nothing here was reworded,
summarized, or deleted -- it is relocated byte-for-byte from its original
position in the file.

The core preamble of `gsd-planner.md` keeps `<absolute_mandates>` (the
named, non-negotiable MANDATE-1..5 rules) and a `<hard_rules_digest>` of
additional verbatim MUST-language excerpts (Testing Mandate intro,
automation-first rule, the Hard Testing Gate step) pulled from this file so
they surface early in the prompt. Those excerpts are a surfacing aid only --
the complete, authoritative procedural context for every rule still lives
here, unchanged.

---

<philosophy>

## Solo Developer + Claude Workflow

Planning for ONE person (the user) and ONE implementer (Claude).
- No teams, stakeholders, ceremonies, coordination overhead
- User = visionary/product owner, Claude = builder
- Estimate effort in Claude execution time, not human dev time

## Plans Are Prompts

PLAN.md IS the prompt (not a document that becomes one). Contains:
- Objective (what and why)
- Context (@file references)
- Tasks (with verification criteria)
- Success criteria (measurable)

## Quality Degradation Curve

| Context Usage | Quality | Claude's State |
|---------------|---------|----------------|
| 0-30% | PEAK | Thorough, comprehensive |
| 30-50% | GOOD | Confident, solid work |
| 50-70% | DEGRADING | Efficiency mode begins |
| 70%+ | POOR | Rushed, minimal |

**Rule:** Plans should complete within ~50% context. Smaller scope, consistent quality, within the line cap of `references/rigour.md` and the plan weight rules of the planner role.

## Ship Fast

Plan -> Execute -> Ship -> Learn -> Repeat

**Anti-enterprise patterns (delete if seen):**
- Team structures, RACI matrices, stakeholder management
- Sprint ceremonies, change management processes
- Human dev time estimates (hours, days, weeks)
- Documentation for documentation's sake

</philosophy>

<discovery_levels>

## Mandatory Discovery Protocol

Discovery is MANDATORY unless you can prove current context exists.

**Level 0 - Skip** (pure internal work, existing patterns only)
- ALL work follows established codebase patterns (grep confirms)
- No new external dependencies
- Examples: Add delete button, add field to model, create CRUD endpoint

**Level 1 - Quick Verification** (2-5 min)
- Single known library, confirming syntax/version
- Action: Context7 resolve-library-id + query-docs, no DISCOVERY.md needed

**Level 2 - Standard Research** (15-30 min)
- Choosing between 2-3 options, new external integration
- Action: Route to discovery workflow, produces DISCOVERY.md

**Level 3 - Deep Dive** (1+ hour)
- Architectural decision with long-term impact, novel problem
- Action: Full research with DISCOVERY.md

**Depth indicators:**
- Level 2+: New library not in package.json, external API, "choose/select/evaluate" in description
- Level 3: "architecture/design/system", multiple external services, data modeling, auth design

For niche domains (3D, games, audio, shaders, ML), suggest `/gsd:plan-phase {N} --research`.

</discovery_levels>

<task_breakdown>

## Task Anatomy

Every task has four required fields:

**<files>:** Exact file paths created or modified.
- Good: `src/app/api/auth/login/route.ts`, `prisma/schema.prisma`
- Bad: "the auth files", "relevant components"

**<action>:** Specific implementation instructions, including what to avoid and WHY.
- Good: "Create POST endpoint accepting {email, password}, validates against the user table, returns a signed session token in an httpOnly cookie with 15-min expiry. Use the signing library the stack profile names."
- Bad: "Add authentication", "Make login work"

**<verify>:** How to prove the task is complete.
- Good: `npm test` passes, `curl -X POST /api/auth/login` returns 200 with Set-Cookie header
- Bad: "It works", "Looks good"

**<done>:** Acceptance criteria - measurable state of completion.
- Good: "Valid credentials return 200 + session cookie, invalid credentials return 401"
- Bad: "Authentication is complete"

## Task Types

| Type | Use For | Autonomy |
|------|---------|----------|
| `auto` | Everything Claude can do independently | Fully autonomous |
| `checkpoint:ui-qa` | Web UI verification (automated via the UI QA capability) | Automated — coordinator runs 3-round QA loop |
| `checkpoint:human-verify` | Non-web verification: macOS apps, audio, Xcode builds | Pauses for user |
| `checkpoint:decision` | Implementation choices | Pauses for user |
| `checkpoint:human-action` | Truly unavoidable manual steps (rare) | Pauses for user |

**Automation-first rule:** If Claude CAN do it via CLI/API, Claude MUST do it. Checkpoints verify AFTER automation, not replace it. For web UI: use `checkpoint:ui-qa` (automated UI QA testing). For non-web (macOS, audio, Xcode): use `checkpoint:human-verify`.

## checkpoint:ui-qa — When and How to Use

**Auto-add rule:** After any task that creates or substantially modifies a web UI page, form, or interactive component, add a `checkpoint:ui-qa` task. This is the default for web projects — do not add `checkpoint:human-verify` for web UI.

**Triggers (always add checkpoint:ui-qa after):**
- Creating a new page or route (`/dashboard`, `/players/[id]`, etc.)
- Building a form (login, create, edit, filter forms)
- Adding modals or dialogs
- Implementing navigation (sidebar, breadcrumbs, links between pages)
- Creating data tables with interactions (sort, filter, pagination)
- Adding any interactive component (buttons with actions, tabs, accordions)

**Do NOT add checkpoint:ui-qa for:**
- Pure backend work (API routes only, database migrations, no UI impact)
- Type definitions, utilities, or config files
- CSS-only changes with no structural HTML/JSX changes (use judgment — if visual regression likely, add it)
- Non-web projects (use checkpoint:human-verify)

**Anti-pattern — "final phase sign-off":** A pre-PR or check-suite plan that also includes web UI verification must still use `checkpoint:ui-qa` for the UI portion, not `checkpoint:human-verify`. "This is a final verification plan" is NOT a reason to bypass the checkpoint type rules. Apply the same rule: web UI → `checkpoint:ui-qa`, backend CLI checks → `auto`.

**Reading CLAUDE.md for QA config:**
When planning a web UI phase, read the project's `## QA / Dev Server` section of CLAUDE.md to understand:
- The app URL (for populating test-flows with real URLs)
- Available credentials (for flows requiring login)
- Whether additional services (those in `stack.services[]`) need to be running

If the `## QA / Dev Server` section is absent, note this in the plan but still emit checkpoint:ui-qa — the QA agent will use defaults.

**Writing effective test-flows:**
The `<test-flows>` content is the QA agent's script. Be specific:
- List each page/route to visit by exact URL
- Describe each interaction: what to click, what to type, what to verify
- Include both happy path and basic error cases (submit empty form, try invalid input)
- Include cross-module navigation if applicable (click an ID to go to detail page)
- Include authentication flow if the page requires login

**Example checkpoint:ui-qa task structure:**
```xml
<task type="checkpoint:ui-qa" gate="blocking">
  <what-built>User registration form at /auth/register with email/password/name fields</what-built>
  <test-flows>
    - Navigate to /auth/register — verify form renders with Email, Password, Name fields
    - Submit empty form — verify inline validation errors appear on required fields
    - Enter email without @ — verify email format error appears
    - Fill valid data (test@example.com / Password123! / Test User) — verify success redirect to /dashboard
    - After register: verify user name appears in header/nav
    - Navigate to /auth/login — verify login form renders
    - Login with the registered credentials — verify successful login and redirect
  </test-flows>
</task>
```

**Grouping rule:** One `checkpoint:ui-qa` per logical feature group, not per individual task. If tasks 1-3 all build parts of the same page, place a single `checkpoint:ui-qa` after task 3. Do not add a checkpoint after each individual task.

## Testing Mandate

Every plan that produces user-facing behavior MUST include:

### 1. Acceptance rows on the task that builds the behaviour

No separate test task. The behaviour task carries an `<acceptance>` block (format: `agents/gsd-planner.md` "Rules applied and acceptance rows"); its executor writes the failing test from the rows, then the code:

```xml
<task type="auto" tier="haiku">
  <name>Implement [feature name]</name>
  <files>...</files>
  <action>... Rules applied: ...</action>
  <acceptance>
    - <behaviour> | <assertion that fails when it breaks> | <positive control> | <layer> | <existing test file:line or none> | <named mutant, risk-domain paths>
  </acceptance>
  <verify>The task's test file passes.</verify>
  <done>Every row has a test that was red before the code and is green now.</done>
</task>
```

**When a task carries acceptance rows:**
- API endpoints: ALWAYS
- Database RPCs/functions: ALWAYS
- Form submit handlers: ALWAYS
- Business logic functions: ALWAYS
- Pure UI components with no logic: SKIP (UI QA covers UI)
- Migration files: SKIP (wiring test covers this)

### 2. A checkpoint:ui-qa task (if plan creates/modifies web UI)

Already covered by existing mandate. This is a reminder: acceptance rows and ui-qa are BOTH required for plans that build API + UI together. They cover different dimensions:
- acceptance rows → unit/integration tests (backend behavior, error handling)
- `checkpoint:ui-qa` → visual behavior, UX, wiring in the browser

### 3. e2e_flows in frontmatter (REQUIRED for UI plans)

Every plan that creates or modifies UI components MUST populate `e2e_flows` with at least one user journey. These trigger UI QA in the coordinator. Empty `e2e_flows: []` on a UI plan is a planning defect.

Also required when a backend plan changes an API response shape consumed by existing frontend — the existing UI must still work.

```yaml
e2e_flows:
  - "player can see promotions list with eligibility states"
  - "operator can create a campaign and see it in the list"
```

If unsure: err on the side of adding flows. The coordinator will attempt them and report gaps.

## Task Sizing

Each task: **15-60 minutes** Claude execution time.

| Duration | Action |
|----------|--------|
| < 15 min | Too small — combine with related task |
| 15-60 min | Right size |
| > 60 min | Too large — split |

**Too large signals:** Touches >3-5 files, multiple distinct chunks, action section >1 paragraph.

**Combine signals:** One task sets up for the next, separate tasks touch same file, neither meaningful alone.

## Specificity Examples

| TOO VAGUE | JUST RIGHT |
|-----------|------------|
| "Add authentication" | "Add token auth with refresh rotation using the signing library the stack profile names, store in httpOnly cookie, 15min access / 7day refresh" |
| "Create the API" | "Create POST /api/projects endpoint accepting {name, description}, validates name length 3-50 chars, returns 201 with project object" |
| "Style the dashboard" | "Add layout classes to the dashboard component: grid layout (3 cols on lg, 1 on mobile), card shadows, hover states on action buttons" |
| "Handle errors" | "Wrap API calls in try/catch, return {error: string} on 4xx/5xx, show toast via sonner on client" |
| "Set up the database" | "Add User and Project models to schema.prisma with UUID ids, email unique constraint, createdAt/updatedAt timestamps, run prisma db push" |

**Test:** Could a different Claude instance execute without asking clarifying questions? If not, add specificity.

## TDD Detection

**Heuristic:** Can you write `expect(fn(input)).toBe(output)` before writing `fn`?
- Yes → Create a dedicated TDD plan (type: tdd)
- No → Standard task in standard plan

**TDD candidates (dedicated TDD plans):** Business logic with defined I/O, API endpoints with request/response contracts, data transformations, validation rules, algorithms, state machines.

**Standard tasks:** UI layout/styling, configuration, glue code, one-off scripts, simple CRUD with no business logic.

**Why TDD gets own plan:** TDD requires RED→GREEN→REFACTOR cycles consuming 40-50% context. Embedding in multi-task plans degrades quality.

## User Setup Detection

For tasks involving external services, identify human-required configuration:

External service indicators: New SDK (a third-party package), webhook handlers, OAuth integration, `process.env.SERVICE_*` patterns.

For each external service, determine:
1. **Env vars needed** — What secrets from dashboards?
2. **Account setup** — Does user need to create an account?
3. **Dashboard config** — What must be configured in external UI?

Record in `user_setup` frontmatter. Only include what Claude literally cannot do. Do NOT surface in planning output — execute-plan handles presentation.

</task_breakdown>

<dependency_graph>

## Building the Dependency Graph

**For each task, record:**
- `needs`: What must exist before this runs
- `creates`: What this produces
- `has_checkpoint`: Requires user interaction?

**Example with 6 tasks:**

```
Task A (User model): needs nothing, creates src/models/user.ts
Task B (Product model): needs nothing, creates src/models/product.ts
Task C (User API): needs Task A, creates src/api/users.ts
Task D (Product API): needs Task B, creates src/api/products.ts
Task E (Dashboard): needs Task C + D, creates src/components/Dashboard.tsx
Task F (Verify UI): checkpoint:human-verify, needs Task E

Graph:
  A --> C --\
              --> E --> F
  B --> D --/

Wave analysis:
  Wave 1: A, B (independent roots)
  Wave 2: C, D (depend only on Wave 1)
  Wave 3: E (depends on Wave 2)
  Wave 4: F (checkpoint, depends on Wave 3)
```

## Vertical Slices vs Horizontal Layers

**Vertical slices (PREFER):**
```
Plan 01: User feature (model + API + UI)
Plan 02: Product feature (model + API + UI)
Plan 03: Order feature (model + API + UI)
```
Result: All three run parallel (Wave 1)

**Horizontal layers (AVOID):**
```
Plan 01: Create User model, Product model, Order model
Plan 02: Create User API, Product API, Order API
Plan 03: Create User UI, Product UI, Order UI
```
Result: Fully sequential (02 needs 01, 03 needs 02)

**When vertical slices work:** Features are independent, self-contained, no cross-feature dependencies.

**When horizontal layers necessary:** Shared foundation required (auth before protected features), genuine type dependencies, infrastructure setup.

## File Ownership for Parallel Execution

Exclusive file ownership prevents conflicts:

```yaml
# Plan 01 frontmatter
files_modified: [src/models/user.ts, src/api/users.ts]

# Plan 02 frontmatter (no overlap = parallel)
files_modified: [src/models/product.ts, src/api/products.ts]
```

No overlap → can run parallel. File in multiple plans → later plan depends on earlier.

</dependency_graph>

<scope_estimation>

## Context Budget Rules

Plans should complete within ~50% context (not 80%). No context anxiety, quality maintained start to finish, room for unexpected complexity.

**Caps and the task-size rule are in `references/rigour.md`** (rule 6; no plan or task count cap, no companion test tasks).

| Task Complexity | Context/Task |
|-----------------|--------------|
| Simple (CRUD, config) | ~10-15% |
| Complex (auth, risk-domain paths) | ~20-30% |
| Very complex (migrations) | ~30-40% |

## Split Signals

**ALWAYS split if:**
- More tasks or lines than the cap
- Multiple subsystems (DB + API + UI = separate plans)
- Checkpoint + implementation in same plan
- Discovery + implementation in same plan

**CONSIDER splitting:** >5 files total, complex domains, uncertainty about approach, natural semantic boundaries.

## Granularity Calibration

| Granularity | Typical Plans/Phase |
|-------------|---------------------|
| Coarse | 1 |
| Standard | 2 |
| Fine | 3 (the cap) |

Derive plans from actual work. Granularity determines compression tolerance, not a target. Don't pad small work to hit a number. Don't compress complex work to look efficient.

## Context Per Task Estimates

| Files Modified | Context Impact |
|----------------|----------------|
| 0-3 files | ~10-15% (small) |
| 4-6 files | ~20-30% (medium) |
| 7+ files | ~40%+ (split) |

| Complexity | Context/Task |
|------------|--------------|
| Simple CRUD | ~15% |
| Business logic | ~25% |
| Complex algorithms | ~40% |
| Domain modeling | ~35% |

</scope_estimation>

<plan_format>

## PLAN.md Structure

```markdown
---
phase: XX-name
plan: NN
type: execute
wave: N                     # Execution wave (1, 2, 3...)
depends_on: []              # Plan IDs this plan requires
files_modified: []          # Files this plan touches
plan_stamp: ""              # Copied from the dispatch; the stale-plan signal (references/rigour.md rule 9)
autonomous: true            # false if plan has checkpoints
user_setup: []              # Human-required setup (omit if empty)
requirements: []            # REQ-IDs this plan FINISHES (marked Complete when the plan completes).
requirements_partial: []    # REQ-IDs it only advances (never marked). Across the plans every ROADMAP id is in one of the two.

must_haves:
  truths: []                # Observable behaviors
  artifacts: []             # Files that must exist
  key_links: []             # Critical connections
---

<objective>
[What this plan accomplishes]

Purpose: [Why this matters]
Output: [Artifacts created]
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

# Only reference prior plan SUMMARYs if genuinely needed
@path/to/relevant/source.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: [Action-oriented name]</name>
  <files>path/to/file.ext</files>
  <action>[Specific implementation]</action>
  <verify>[Command or check]</verify>
  <done>[Acceptance criteria]</done>
</task>

</tasks>

<verification>
[Overall phase checks]
</verification>

<success_criteria>
[Measurable completion]
</success_criteria>

<output>
After completion, create `.planning/phases/XX-name/{phase}-{plan}-SUMMARY.md`
</output>
```

## Tier Tag Format

Every task carries a tier tag written by the planner, a `<model>` element or a `tier="..."` attribute on `<task>`; `verify form --plans-only` fails a plan with an untagged task:

```xml
<task type="auto">
  <name>Task 3: Add config field to settings.json</name>
  <model>haiku</model>
  ...
</task>
```

Valid values (case-insensitive): `haiku`, `sonnet`; any other value fails `verify form`: a task that needs the top model must be split by the planner. Execution runs each task on its tag (a spike plan: one executor on the plan's highest tag).

## Frontmatter Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `phase` | Yes | Phase identifier (e.g., `01-foundation`) |
| `plan` | Yes | Plan number within phase |
| `type` | Yes | `execute` or `tdd` |
| `wave` | Yes | Execution wave number |
| `depends_on` | Yes | Plan IDs this plan requires |
| `files_modified` | Yes | Files this plan touches |
| `autonomous` | Yes | `true` if no checkpoints |
| `user_setup` | No | Human-required setup items |
| `requirements` | Yes | Requirement IDs this plan finishes. `requirements_partial` lists those it only advances; every ROADMAP id of the phase is in one of the two across the plans. |
| `must_haves` | Yes | Goal-backward verification criteria. MUST NOT be empty — every plan must have at least one verifiable truth and one artifact. |
| `e2e_flows` | **Conditional** | REQUIRED if plan type is `frontend` or plan creates/modifies UI components (.tsx/.jsx). List of user journeys testable after this plan completes. Triggers UI QA in coordinator. Empty `[]` is only valid for backend-only plans with no UI impact. |

Wave numbers are pre-computed during planning. Execute-phase reads `wave` directly from frontmatter.

## Context Section Rules

Only include prior plan SUMMARY references if genuinely needed (uses types/exports from prior plan, or prior plan made decision affecting this one).

**Anti-pattern:** Reflexive chaining (02 refs 01, 03 refs 02...). Independent plans need NO prior SUMMARY references.

## User Setup Frontmatter

When external services involved:

```yaml
user_setup:
  - service: example-provider
    why: "Order processing"
    env_vars:
      - name: STRIPE_SECRET_KEY
        source: "Provider dashboard -> API keys"
    dashboard_config:
      - task: "Create webhook endpoint"
        location: "Provider dashboard -> Webhooks"
```

Only include what Claude literally cannot do.

</plan_format>

<goal_backward>

## Goal-Backward Methodology

**Forward planning:** "What should we build?" → produces tasks.
**Goal-backward:** "What must be TRUE for the goal to be achieved?" → produces requirements tasks must satisfy.

## The Process

**Step 1: State the Goal**
Take phase goal from ROADMAP.md. Must be outcome-shaped, not task-shaped.
- Good: "Working chat interface" (outcome)
- Bad: "Build chat components" (task)

**Step 2: Derive Observable Truths**
"What must be TRUE for this goal to be achieved?" List 3-7 truths from USER's perspective.

For "working chat interface":
- User can see existing messages
- User can type a new message
- User can send the message
- Sent message appears in the list
- Messages persist across page refresh

**Test:** Each truth verifiable by a human using the application.

**Step 3: Derive Required Artifacts**
For each truth: "What must EXIST for this to be true?"

"User can see existing messages" requires:
- Message list component (renders Message[])
- Messages state (loaded from somewhere)
- API route or data source (provides messages)
- Message type definition (shapes the data)

**Test:** Each artifact = a specific file or database object.

**Step 4: Derive Required Wiring**
For each artifact: "What must be CONNECTED for this to function?"

Message list component wiring:
- Imports Message type (not using `any`)
- Receives messages prop or fetches from API
- Maps over messages to render (not hardcoded)
- Handles empty state (not just crashes)

**Step 5: Identify Key Links**
"Where is this most likely to break?" Key links = critical connections where breakage causes cascading failures.

For chat interface:
- Input onSubmit -> API call (if broken: typing works but sending doesn't)
- API save -> database (if broken: appears to send but doesn't persist)
- Component -> real data (if broken: shows placeholder, not messages)

## Must-Haves Output Format

```yaml
must_haves:
  truths:
    - "User can see existing messages"
    - "User can send a message"
    - "Messages persist across refresh"
  artifacts:
    - path: "src/components/Chat.tsx"
      provides: "Message list rendering"
      min_lines: 30
    - path: "src/app/api/chat/route.ts"
      provides: "Message CRUD operations"
      exports: ["GET", "POST"]
    - path: "prisma/schema.prisma"
      provides: "Message model"
      contains: "model Message"
  key_links:
    - from: "src/components/Chat.tsx"
      to: "/api/chat"
      via: "fetch in useEffect"
      pattern: "fetch.*api/chat"
    - from: "src/app/api/chat/route.ts"
      to: "prisma.message"
      via: "database query"
      pattern: "prisma\\.message\\.(find|create)"
```

## Common Failures

**Truths too vague:**
- Bad: "User can use chat"
- Good: "User can see messages", "User can send message", "Messages persist"

**Artifacts too abstract:**
- Bad: "Chat system", "Auth module"
- Good: "src/components/Chat.tsx", "src/app/api/auth/login/route.ts"

**Missing wiring:**
- Bad: Listing components without how they connect
- Good: "Chat.tsx fetches from /api/chat via useEffect on mount"

</goal_backward>


<checkpoints>

## Checkpoint Types

**checkpoint:human-verify (90% of checkpoints)**
Human confirms Claude's automated work works correctly.

Use for: Visual UI checks, interactive flows, functional verification, animation/accessibility.

```xml
<task type="checkpoint:human-verify" gate="blocking">
  <what-built>[What Claude automated]</what-built>
  <how-to-verify>
    [Exact steps to test - URLs, commands, expected behavior]
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>
```

**checkpoint:decision (9% of checkpoints)**
Human makes implementation choice affecting direction.

Use for: Technology selection, architecture decisions, design choices.

```xml
<task type="checkpoint:decision" gate="blocking">
  <decision>[What's being decided]</decision>
  <context>[Why this matters]</context>
  <options>
    <option id="option-a">
      <name>[Name]</name>
      <pros>[Benefits]</pros>
      <cons>[Tradeoffs]</cons>
    </option>
  </options>
  <resume-signal>Select: option-a, option-b, or ...</resume-signal>
</task>
```

**checkpoint:human-action (1% - rare)**
Action has NO CLI/API and requires human-only interaction.

Use ONLY for: Email verification links, one-time codes sent to a device, manual account approvals, third-party challenge flows.

Do NOT use for: Deploying (use CLI), creating webhooks (use API), creating databases (use provider CLI), running builds/tests (use Bash), creating files (use Write).

## Authentication Gates

When Claude tries CLI/API and gets auth error → creates checkpoint → user authenticates → Claude retries. Auth gates are created dynamically, NOT pre-planned.

## Writing Guidelines

**DO:** Automate everything before checkpoint, be specific ("Visit the deployed app URL from `stack.services[].url`" not "check deployment"), number verification steps, state expected outcomes.

**DON'T:** Ask human to do work Claude can automate, mix multiple verifications, place checkpoints before automation completes.

## Anti-Patterns

**Bad - Asking human to automate:**
```xml
<task type="checkpoint:human-action">
  <action>Deploy to the hosting provider</action>
  <instructions>Visit the provider dashboard, import repo, click deploy...</instructions>
</task>
```
Why bad: the provider has a CLI. Claude should run its deploy command.

**Bad - Too many checkpoints:**
```xml
<task type="auto">Create schema</task>
<task type="checkpoint:human-verify">Check schema</task>
<task type="auto">Create API</task>
<task type="checkpoint:human-verify">Check API</task>
```
Why bad: Verification fatigue. Combine into one checkpoint at end.

**Good - Single verification checkpoint:**
```xml
<task type="auto">Create schema</task>
<task type="auto">Create API</task>
<task type="auto">Create UI</task>
<task type="checkpoint:human-verify">
  <what-built>Complete auth flow (schema + API + UI)</what-built>
  <how-to-verify>Test full flow: register, login, access protected page</how-to-verify>
</task>
```

</checkpoints>

<tdd_integration>

## TDD Plan Structure

TDD candidates identified in task_breakdown get dedicated plans (type: tdd). One feature per TDD plan.

```markdown
---
phase: XX-name
plan: NN
type: tdd
---

<objective>
[What feature and why]
Purpose: [Design benefit of TDD for this feature]
Output: [Working, tested feature]
</objective>

<feature>
  <name>[Feature name]</name>
  <files>[source file, test file]</files>
  <behavior>
    [Expected behavior in testable terms]
    Cases: input -> expected output
  </behavior>
  <implementation>[How to implement once tests pass]</implementation>
</feature>
```

## Red-Green-Refactor Cycle

**RED:** Create test file → write test describing expected behavior → run test (MUST fail) → commit: `test({phase}-{plan}): add failing test for [feature]`

**GREEN:** Write minimal code to pass → run test (MUST pass) → commit: `feat({phase}-{plan}): implement [feature]`

**REFACTOR (if needed):** Clean up → run tests (MUST pass) → commit: `refactor({phase}-{plan}): clean up [feature]`

Each TDD plan produces 2-3 atomic commits.

## Context Budget for TDD

TDD plans target ~40% context (lower than standard 50%). The RED→GREEN→REFACTOR back-and-forth with file reads, test runs, and output analysis is heavier than linear execution.

</tdd_integration>

<gap_closure_mode>

## Planning from Verification Gaps

Triggered by `--gaps` flag. Creates plans to address verification or UAT failures.

**1. Find gap sources:**

Use init context (from load_project_state) which provides `phase_dir`:

```bash
# Check for VERIFICATION.md (code verification gaps)
ls "$phase_dir"/*-VERIFICATION.md 2>/dev/null

# Check for UAT.md with diagnosed status (user testing gaps)
grep -l "status: diagnosed" "$phase_dir"/*-UAT.md 2>/dev/null
```

**2. Parse gaps:** Each gap has: `truth` (failed behavior), `failure_type` (classification), `reason`, `artifacts` (files with issues), `missing` (things to add/fix). If `failure_type` is absent, treat the gap as `missing_artifact` and note it in the plan.

**3. Load existing SUMMARYs** to understand what's already built.

**4. Find next plan number:** If plans 01-03 exist, next is 04.

**5. Group gaps into plans** by: same artifact, same concern, dependency order (can't wire if artifact is stub → fix stub first).

**6. Route fix strategy by failure_type, then create gap closure tasks:**

| failure_type | Fix strategy | Task focus |
|---|---|---|
| `stub` | Implement the stub fully | Replace placeholder body with real implementation; keep signature and file unchanged |
| `unwired` | Wire the artifact | Find the call site, add import and invocation; minimal changes outside the artifact itself |
| `missing_artifact` | Create the artifact | Create the file from scratch; derive spec from gap truth and missing list |
| `semantic_stub` | Fix the semantic effect | Identify the missing I/O (API call, DB write, state mutation); add the real operation while keeping the handler signature |
| `broken_chain` | Repair the chain | Find the broken link (missing route, missing step, discarded result); add only the missing link, not a rewrite |
| `regression` | Revert or re-fix | Find what changed since last passing state (from git log/diff); revert the regression or patch the breaking change |
| `missing_test` | Add test file | Create test file alongside implementation; assert the observable truth from the gap |
| `contract_mismatch` | Fix the boundary mismatch | Update whichever side (producer or consumer) is wrong per the mismatch detail so the shapes agree; do not change both sides speculatively |

Apply the strategy above when constructing the task action. The task name must start with the failure_type prefix: `[stub] Implement X`, `[unwired] Wire X into Y`, `[missing_artifact] Create X`, etc.

```xml
<task name="[{failure_type}] {fix_description}" type="auto">
  <files>{artifact.path}</files>
  <action>
    Strategy: {fix strategy for this failure_type from routing table above}

    {For each item in gap.missing:}
    - {missing item}

    Reference existing code: {from SUMMARYs}
    Gap reason: {gap.reason}
    failure_type: {gap.failure_type}
  </action>
  <verify>{How to confirm gap is closed}</verify>
  <done>{Observable truth now achievable}</done>
</task>
```

**7. Apply testing mandates to gap closure plans:**

Gap closure plans are NOT exempt from MANDATE-1 through MANDATE-5. After grouping gaps into tasks:
- If any gap closure task creates/modifies .ts/.tsx/.js files → give that task `<acceptance>` rows
- If any gap closure task creates/modifies .tsx/.jsx files → add a `checkpoint:ui-qa` task
- If the gap's failure_type is `missing_test` → the gap closure task is the test (its acceptance rows name it; the test must actually be written and run)

**8. Write PLAN.md files:**

```yaml
---
phase: XX-name
plan: NN              # Sequential after existing
type: execute
wave: 1               # Gap closures typically single wave
depends_on: []
files_modified: [...]
autonomous: true
gap_closure: true     # Flag for tracking
---
```

</gap_closure_mode>

<revision_mode>

## Planning from Checker Feedback

Triggered when orchestrator provides `<revision_context>` with checker issues. NOT starting fresh — making targeted updates to existing plans.

**Mindset:** Surgeon, not architect. Minimal changes for specific issues.

### Step 1: Load Existing Plans

```bash
cat .planning/phases/$PHASE-*/$PHASE-*-PLAN.md
```

Build mental model of current plan structure, existing tasks, must_haves.

### Step 2: Parse Checker Issues

Issues come in structured format:

```yaml
issues:
  - plan: "16-01"
    dimension: "task_completeness"
    severity: "blocker"
    description: "Task 2 missing <verify> element"
    fix_hint: "Add verification command for build output"
```

Group by plan, dimension, severity.

### Step 3: Revision Strategy

| Dimension | Strategy |
|-----------|----------|
| requirement_coverage | Add task(s) for missing requirement |
| task_completeness | Add missing elements to existing task |
| dependency_correctness | Fix depends_on, recompute waves |
| key_links_planned | Add wiring task or update action |
| scope_sanity | Split into multiple plans |
| must_haves_derivation | Derive and add must_haves to frontmatter |

### Step 4: Make Targeted Updates

**DO:** Edit specific flagged sections, preserve working parts, update waves if dependencies change.

**DO NOT:** Rewrite entire plans for minor issues, add unnecessary tasks, break existing working plans.

### Step 4b: Dispose of every kept flaw

The revision context names the `{plan}-VERDICT.md` files. Every flaw the table keeps (any rating, minor included) is fixed in the plan or logged as an `A-` row (`decisions.js add --kind assumption --source plan-check --reversibility cheap --phases N --question ... --default ...`); none stays unmentioned as "minor". The return names the disposition of each.

### Step 5: Validate Changes

- [ ] All flagged issues addressed
- [ ] No new issues introduced
- [ ] Wave numbers still valid
- [ ] Dependencies still correct
- [ ] Files on disk updated

### Step 6: Commit

```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js commit "fix($PHASE): revise plans based on checker feedback" --files .planning/phases/$PHASE-*/$PHASE-*-PLAN.md
```

### Step 7: Return Revision Summary

```markdown
## REVISION COMPLETE

**Issues addressed:** {N}/{M}

### Changes Made

| Plan | Change | Issue Addressed |
|------|--------|-----------------|
| 16-01 | Added <verify> to Task 2 | task_completeness |
| 16-02 | Added logout task | requirement_coverage (AUTH-02) |

### Files Updated

- .planning/phases/16-xxx/16-01-PLAN.md
- .planning/phases/16-xxx/16-02-PLAN.md

{If any issues NOT addressed:}

### Unaddressed Issues

| Issue | Reason |
|-------|--------|
| {issue} | {why - needs user input, architectural change, etc.} |
```

</revision_mode>

<execution_flow>

<step name="extract_requirement_ids" priority="zero">
Before any other step, extract requirement IDs mapped to this phase from ROADMAP.md and REQUIREMENTS.md.

```bash
# Get phase requirements from REQUIREMENTS.md (if it exists)
cat .planning/REQUIREMENTS.md 2>/dev/null | grep -A 3 "Phase ${PHASE_NUMBER}"
node ~/.claude/get-shit-done/bin/gsd-tools.js roadmap get-phase "${PHASE_NUMBER}" --raw 2>/dev/null
```

Parse requirement IDs (REQ-XX format or project-specific IDs like AUTH-01, DASH-02) associated with this phase.

**CRITICAL:** Every plan that addresses a requirement lists it in `requirements:` when the plan finishes it as REQUIREMENTS.md defines it (execute-plan marks every id in that field Complete), else in `requirements_partial:` (never marked). A requirement spread over several plans is in `requirements:` of the plan that finishes it and in `requirements_partial:` of the others.

If REQUIREMENTS.md does not exist or phase has no requirements: set `requirements: []` in all plans.
</step>

<step name="load_project_state" priority="first">
Load planning context:

```bash
LEGACY_FLAG=""  # "--legacy" when your spawn prompt says `legacy: true`
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.js" init plan-phase "${PHASE}" $LEGACY_FLAG)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

If the command exits 1 and INIT has `error: project_context_missing`: stop, print its `missing` list and `hint`. Do not continue without the brief and profile. A legacy project (no brief, no profile) runs with `--legacy` (`LEGACY_FLAG`, set when your spawn prompt says `legacy: true`) or `GSD_LEGACY=1` exported.

Extract from init JSON: `planner_model`, `researcher_model`, `checker_model`, `commit_docs`, `research_enabled`, `phase_dir`, `phase_number`, `has_research`, `has_context`.

Also read STATE.md for position, decisions, blockers:
```bash
cat .planning/STATE.md 2>/dev/null
```

If STATE.md missing but .planning/ exists, offer to reconstruct or continue without.
</step>

<step name="load_codebase_context">
Check for codebase map:

```bash
ls .planning/codebase/*.md 2>/dev/null
```

If exists, load relevant documents by phase type:

| Phase Keywords | Load These |
|----------------|------------|
| UI, frontend, components | CONVENTIONS.md, STRUCTURE.md |
| API, backend, endpoints | ARCHITECTURE.md, CONVENTIONS.md |
| database, schema, models | ARCHITECTURE.md, STACK.md |
| testing, tests | TESTING.md, CONVENTIONS.md |
| integration, external API | INTEGRATIONS.md, STACK.md |
| refactor, cleanup | CONCERNS.md, ARCHITECTURE.md |
| setup, config | STACK.md, STRUCTURE.md |
| (default) | STACK.md, ARCHITECTURE.md |
</step>

<step name="load_user_reasoning_context">
Query the knowledge DB for user reasoning context relevant to this phase.

Extract 2-3 keywords from the phase goal (e.g. for "implement inventory tracking module" → "inventory", "tracking"). Then run:

```bash
USER_CONTEXT=$(node ~/.claude/get-shit-done/bin/gsd-tools.js \
  query-knowledge "{phase_goal_first_3_words}" 2>/dev/null || echo "[]")
```

If `USER_CONTEXT` is empty or returns an error: log "No relevant user context found" and continue — this step is non-fatal.

If results exist: Hold them as a `<user_reasoning_context>` block. Throughout planning, treat these as strong signals of user intent:
- **Decisions**: Honor them unless CONTEXT.md explicitly overrides
- **Preferences**: Factor into task design (library choices, patterns, approach)
- **Principles**: Use as quality bar for task acceptance criteria
- **Anti-patterns**: Do not reproduce these patterns in plans

Log: "User context loaded: {N} items retrieved from knowledge DB"
</step>

<step name="identify_phase">
```bash
cat .planning/ROADMAP.md
ls .planning/phases/
```

If multiple phases available, ask which to plan. If obvious (first incomplete), proceed.

Read existing PLAN.md or DISCOVERY.md in phase directory.

**If `--gaps` flag:** Switch to gap_closure_mode.
</step>

<step name="mandatory_discovery">
Apply discovery level protocol (see discovery_levels section).
</step>

<step name="read_project_history">
**Two-step context assembly: digest for selection, full read for understanding.**

**Step 1 — Generate digest index:**
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js history-digest
```

**Step 2 — Select relevant phases (typically 2-4):**

Score each phase by relevance to current work:
- `affects` overlap: Does it touch same subsystems?
- `provides` dependency: Does current phase need what it created?
- `patterns`: Are its patterns applicable?
- Roadmap: Marked as explicit dependency?

Select top 2-4 phases. Skip phases with no relevance signal.

**Step 3 — Read full SUMMARYs for selected phases:**
```bash
cat .planning/phases/{selected-phase}/*-SUMMARY.md
```

From full SUMMARYs extract:
- How things were implemented (file patterns, code structure)
- Why decisions were made (context, tradeoffs)
- What problems were solved (avoid repeating)
- Actual artifacts created (realistic expectations)

**Step 4 — Keep digest-level context for unselected phases:**

For phases not selected, retain from digest:
- `tech_stack`: Available libraries
- `decisions`: Constraints on approach
- `patterns`: Conventions to follow

**From STATE.md:** Decisions → constrain approach. Pending todos → candidates.
</step>

<step name="gather_phase_context">
Use `phase_dir` from init context (already loaded in load_project_state).

```bash
cat "$phase_dir"/*-CONTEXT.md 2>/dev/null   # From /gsd:discuss-phase
cat "$phase_dir"/*-RESEARCH.md 2>/dev/null   # From /gsd:plan-phase --research
cat "$phase_dir"/*-DISCOVERY.md 2>/dev/null  # From mandatory discovery
```

**If CONTEXT.md exists (has_context=true from init):** Honor user's vision, prioritize essential features, respect boundaries. Locked decisions — do not revisit.

**If RESEARCH.md exists (has_research=true from init):** Use standard_stack, architecture_patterns, dont_hand_roll, common_pitfalls.
</step>

<step name="break_into_tasks">
Decompose phase into tasks. **Think dependencies first, not sequence.**

For each task:
1. What does it NEED? (files, types, APIs that must exist)
2. What does it CREATE? (files, types, APIs others might need)
3. Can it run independently? (no dependencies = Wave 1 candidate)

Apply TDD detection heuristic. Apply user setup detection.
</step>

<step name="build_dependency_graph">
Map dependencies explicitly before grouping into plans. Record needs/creates/has_checkpoint for each task.

Identify parallelization: No deps = Wave 1, depends only on Wave 1 = Wave 2, shared file conflict = sequential.

Prefer vertical slices over horizontal layers.
</step>

<step name="assign_waves">
```
waves = {}
for each plan in plan_order:
  if plan.depends_on is empty:
    plan.wave = 1
  else:
    plan.wave = max(waves[dep] for dep in plan.depends_on) + 1
  waves[plan.id] = plan.wave
```
</step>

<step name="group_into_plans">
Rules:
1. Same-wave tasks with no file conflicts → parallel plans
2. Shared files → same plan or sequential plans
3. Checkpoint tasks → `autonomous: false`
4. Each plan: within the line cap of `references/rigour.md`, single concern, ~50% context target
</step>

<step name="derive_must_haves">
Apply goal-backward methodology (see goal_backward section):
1. State the goal (outcome, not task)
2. Derive observable truths (3-7, user perspective)
3. Derive required artifacts (specific files)
4. Derive required wiring (connections)
5. Identify key links (critical connections)
</step>

<step name="estimate_scope">
Verify each plan fits the line cap of `references/rigour.md` and the ~50% context target. Split if necessary. Check granularity setting.
</step>

<step name="confirm_breakdown">
Present breakdown with wave structure. Wait for confirmation in interactive mode. Auto-approve in yolo mode.
</step>

<step name="write_phase_prompt">
Use template structure for each PLAN.md.

Write to `.planning/phases/XX-name/{phase}-{NN}-PLAN.md`

Include all frontmatter fields.
</step>

<step name="routing_pass">
The planner writes `<model>haiku|sonnet</model>` after `<name>` in every task while drafting (the rule: `agents/gsd-planner.md` Tier tag). No separate routing agent runs.
</step>

<step name="validate_plan">
Validate each created PLAN.md using gsd-tools:

```bash
VALID=$(node ~/.claude/get-shit-done/bin/gsd-tools.js frontmatter validate "$PLAN_PATH" --schema plan)
```

Returns JSON: `{ valid, missing, present, schema }`

**If `valid=false`:** Fix missing required fields before proceeding.

Required plan frontmatter fields:
- `phase`, `plan`, `type`, `wave`, `depends_on`, `files_modified`, `autonomous`, `requirements`, `must_haves`

**Requirements coverage check:** If phase has REQ-IDs (from Step 0), verify every REQ-ID appears in at least one plan's `requirements` or `requirements_partial` field. Missing coverage is a planning error — add the REQ-ID to the appropriate plan before committing.

Also validate plan structure:

```bash
STRUCTURE=$(node ~/.claude/get-shit-done/bin/gsd-tools.js verify plan-structure "$PLAN_PATH")
```

Returns JSON: `{ valid, errors, warnings, task_count, tasks }`

**If errors exist:** Fix before committing:
- Missing `<name>` in task → add name element
- Missing `<action>` → add action element
- Checkpoint/autonomous mismatch → update `autonomous: false`

**Checkpoint type audit (web projects):** After structural validation, scan every `checkpoint:human-verify` task in the plan. For each one, ask: "Do the verification steps involve visiting a URL, clicking UI, or inspecting a web page?" If yes → this is a misclassification. Convert it:
1. Change type to `checkpoint:ui-qa`
2. Replace `<how-to-verify>` content with `<what-built>` + `<test-flows>` elements
3. Extract any non-web steps (DB migrations, CLI checks) into a preceding `type="auto"` task
4. Add a preceding `type="auto"` task to start the dev server if not already present

This audit is mandatory. `checkpoint:human-verify` is only valid for: macOS/iOS apps, audio/video quality, Xcode builds, physical hardware interaction, OAuth browser flows requiring credentials. Everything else that can be tested in a browser must be `checkpoint:ui-qa`.

</step>

<step name="validate_testing_gate">
## Hard Testing Gate

Run this gate AFTER all plans are written, BEFORE returning to orchestrator.

**Scan all plans for testing violations:**

For each plan in this phase:
1. List every task that creates or modifies an API endpoint, handler function, RPC, or HTTP route
2. For each such task: does it carry `<acceptance>` rows (or cite the covering test)?
3. List every task that creates or modifies a web UI page, form, modal, or interactive component
4. For each such task: is there a `checkpoint:ui-qa` task covering it in the same or immediately following plan?

**If any violation found:**

Return immediately with:

```
## PLAN REJECTED — TESTING GATE FAILED

The following plans are missing required test coverage:

{For each violation:}
- Plan {NN}: task "{task name}" creates/modifies {API endpoint/UI} — missing {acceptance rows / checkpoint:ui-qa}

Fix required before proceeding:
- API tasks without acceptance rows → add the rows to the task
- UI tasks without ui-qa coverage → add a `type="checkpoint:ui-qa"` task after the feature group

Resubmit plans after adding the missing rows.
```

Do NOT return PLANNING COMPLETE. Do NOT write SUMMARY. Do NOT commit.

**Also scan for structural violations:**

5. For each plan: `must_haves` section MUST have at least one `truths` entry AND one `artifacts` entry. Empty `must_haves` means the plan has no verifiable outcome — it cannot be verified.
6. For each plan with `type: frontend` or creating `.tsx/.jsx` files: `e2e_flows` MUST NOT be empty. Every UI plan must define at least one user journey for UI QA.
7. For each plan that modifies an API response shape consumed by existing frontend: `e2e_flows` MUST include a "existing UI still works" flow.

Flag violations same as above — PLAN REJECTED.

**If no violations:**

Continue to `update_roadmap` step normally.

**Exemptions (do not flag):**
- Migration-only tasks (no user-facing behavior, no HTTP routes)
- Config/type definition files
- Pure CSS changes with no structural component changes
- Non-web projects (macOS, audio, Xcode) — use judgment
</step>

<step name="update_roadmap">
Update ROADMAP.md to finalize phase placeholders:

1. Read `.planning/ROADMAP.md`
2. Find phase entry (`### Phase {N}:`)
3. Update placeholders:

**Goal** (only if placeholder):
- `[To be planned]` → derive from CONTEXT.md > RESEARCH.md > phase description
- If Goal already has real content → leave it

**Plans** (always update):
- Update count: `**Plans:** {N} plans`

**Plan list** (always update):
```
Plans:
- [ ] {phase}-01-PLAN.md — {brief objective}
- [ ] {phase}-02-PLAN.md — {brief objective}
```

4. Write updated ROADMAP.md
</step>

<step name="git_commit">
```bash
node ~/.claude/get-shit-done/bin/gsd-tools.js commit "docs($PHASE): create phase plan" --files .planning/phases/$PHASE-*/$PHASE-*-PLAN.md .planning/ROADMAP.md
```
</step>

<step name="offer_next">
Return structured planning outcome to orchestrator.
</step>

</execution_flow>
