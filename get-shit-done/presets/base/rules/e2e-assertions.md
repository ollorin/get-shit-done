# E2E Assertions

Applies to every browser-level test of a user interface. Gated: deployed only when the profile's `stack.capabilities.web_ui` is an object. The UI QA driver is the project's (the profile's `stack.capabilities.ui_qa`); the frontend directories are `stack.paths.frontends`.

## The Golden Rule

Every E2E test must verify the **user-visible outcome**, not just that code ran. A test that passes when the feature is broken is worse than no test.

## Assertion Levels (L0-L4)

| Level | What it checks | Example |
|------|---------------|---------|
| L0 — Useless | Page loaded, no crash | "heading is visible" |
| L1 — Structural | Elements exist | "submit button is in DOM" |
| L2 — State | Correct data rendered, correct enabled state | "remaining amount is not NaN" |
| L3 — Behaviour | Action changes state correctly | "after save, new value re-renders" |
| L4 — Round-trip | Save → reload → data persists | "value visible after page reload" |

L0/L1 assertions are only **preconditions** for L2+. Every scenario has at least one L3 or L4
assertion. The UI QA driver covers only what needs a browser; a contract an API integration test already
asserts is not re-asserted here.

## Required Assertions by Test Type

| Type | Required | Forbidden |
|---|---|---|
| Page render | Heading (L1) + at least one dynamic value that is non-empty and not broken (e.g. balance is numeric, not `NaN`/`undefined`/`$0.00`) (L2) | Heading or "renders without error" as the only assertion |
| Form submission | Pre-submit values correct (L2); success state (L3); saved value re-renders (L3); reload persists (L4, strongly recommended) | Clicking Cancel and calling the form tested; checking Save is enabled without submitting; not checking the API-returned value re-appears |
| Data display | At least one row/card has real values — not `—`, `N/A`, `undefined`, `0`, `NaN`, empty; dates carry `:` when time is expected; currency matches `/[\d,]+/`; row count ≥ expected after an action | "table renders without error" only; not asserting the column the test just modified |
| Navigation | Destination URL/heading (L1); content beyond the heading (L2); auth maintained on protected routes (L2) | URL changed without checking usable content |
| Error state | Specific user-readable text (L2); no stack traces/SQL; happy path works after the condition is resolved | "no error message visible" as the only criterion |

## Anti-Patterns

1. **Conditional bypass** — `IF widget present: verify, IF NOT: expected`. Seed the state so the
   element always renders and assert unconditionally. Conditional assertions are only for genuinely
   non-deterministic UI (a live push that may not have arrived).
2. **Status-only checks** — "limits page loaded". Assert counts and values ("≥ 2 limit cards, each
   amount numeric and > 0").
3. **Submit-and-skip** — submit, then assert specific success text, the new value in the table/card,
   and that it differs from the noted previous value.
4. **Existence without value** — assert `textContent` against a pattern and against `NaN` /
   `undefined`, not mere presence.
5. **Renders-without-error** — replace with a concrete post-action row/value assertion.

## Seeding Requirements

Every scenario guarantees its required UI state through deterministic seeding in its `prepare()` step and the
project's seeder — a test checking a limit widget seeds a limit; a history test
seeds a change or performs one; a table test seeds N rows and asserts ≥ N. Never rely on
pre-existing data. Each test user has a documented baseline in the seeder's comments or the seed file.

## Round-Trip Validation

For any mutation: (1) note the pre-mutation value; (2) submit and verify feedback; (3) assert the
new value on the same page — never skippable; (4) navigate away and back and assert persistence —
skippable only with a stated justification.

## API-not-SQL for value, limits, identity, session state

Provision and mutate value, player limits, identity-verification status and session or suspension state through the real API
(sign-up, a value transfer, limit-set, identity submit), never direct SQL. SQL bypasses row-level policies and business
invariants, can build states production cannot reach, and hides policy defects (a broken policy
returns zero rows, not an error). SQL is correct for the most critical tier only.

### Deterministic naming — no hand-typed literals

Every account identifier comes from the account provisioning helper:
`ui-{module}-{scenarioId}[-w{bucketIndex}]@test.local`. Hand-typed account emails are
forbidden; a random UUID, the clock or any random suffix is banned — a failing run must
be replayable against the same identifier. The provisioning helper may append a deterministic re-attempt ordinal `-r{n}` when the base account holds a retained ledger footprint; scenarios read `account.email`, never re-derive it.

### teardown() is mandatory

Every scenario in a mutating group implements `teardown()`, called in `finally`. The only
exception is a justified annotation directly above the export:
`// @no-teardown-reason: <why nothing needs cleaning>` — a bare annotation still fails the guard. A test account holding any ledger, balance or gap row is retained untouched (the ledger is append-only); only a database reset removes it.

### Two-actor scenarios

When a second actor acts on the subject (an operator suspends a player, forced logout, admin
approval), the **subject** is provisioned fresh by the provisioning helper. A never-mutated **actor**
(typically a seeded admin login) belongs in the accounts list but NOT in the mutating group — declaring it there serializes every scenario using that login for no
safety gain.

### Anti-patterns — fixture and isolation

| Anti-pattern | Why it's forbidden |
|---|---|
| Order-dependent scenarios | Break under `--bucket=`, `--parallel=N`, a single re-run, or a reset |
| Exact global/table row counts | Meaningless under concurrency — count only rows the scenario created |
| Sharing a mutable fixture between mutating scenarios | The collision class this section closes |
| Missing `teardown()` on a mutation-class scenario | Leaks state; runtime-created prefixes accumulate forever |
| Fixed `sleep()` | Races or wastes time — wait for a condition (the testing rule's `waitFor`) |
| Hard-coded emails/IDs | Bypass the provisioning helper's naming contract and the guards |
| Wall-clock / "today" assumptions | A run at 23:58 and 00:02 UTC must agree |
| SQL-seeded value, limits, identity or session state | See "API-not-SQL" |

**Reference scenario:** a scenario that seeds a limit in its `prepare()` step, provisions its account with the helper, is declared as mutating, and has a `teardown()` that calls the account's own idempotent cleanup. The provisioning helper registers AND logs in (it returns a live session token; there is no password), so never log in again after it.

### Timer-based clearing of state-bearing UI is a product defect

A `data-testid`'d status element that auto-dismisses on a timer (a promo banner, a cooling-off
notice) is a product bug: it races E2E assertions and hides restriction state from real users.
Never add a wait or retry workaround in the scenario; fix the component so the element reflects the
state for as long as it is true (`frontend-testability.md`, Testability Contract).

## Enforcement

`node scripts/validation/check-assertion-quality.mjs` lints the scenario sources under `stack.paths.e2e_scenarios` for the five anti-patterns above and for the behaviour floor (it is in `stack.gates[]` as `assertion-quality`). It checks phrasing only: a clean run proves the assertions are not one of the known-cheap shapes, not that they verify the right thing.
