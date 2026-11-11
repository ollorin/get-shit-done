---
paths:
  - "apps/e2e-charlotte/**"
---

# E2E Testing Rules — Charlotte Scenarios

Applies to: `apps/e2e-charlotte/scenarios/**`

---

## The Golden Rule

Every E2E test must verify the **user-visible outcome**, not just that code ran. A test that passes
when the feature is broken is worse than no test.

## Assertion Levels (L0-L4; unrelated to risk tiers T0-T2)

| Level | What it checks | Example |
|------|---------------|---------|
| L0 — Useless | Page loaded, no crash | "heading is visible" |
| L1 — Structural | Elements exist | "submit button is in DOM" |
| L2 — State | Correct data rendered, correct enabled state | "remaining amount is not NaN" |
| L3 — Behaviour | Action changes state correctly | "after save, new value re-renders" |
| L4 — Round-trip | Save → reload → data persists | "value visible after page reload" |

L0/L1 assertions are only **preconditions** for L2+. Every scenario has at least one L3 or L4
assertion. Charlotte covers only what needs a browser; a contract an API integration test already
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

Every scenario guarantees its required UI state through deterministic seeding in `prepare()` /
`runner/seeder.ts` — a test checking a deposit-limit widget seeds a deposit limit; a history test
seeds a change or performs one; a table test seeds N rows and asserts ≥ N. Never rely on
pre-existing data. Each `charlotte-*.test.local` user has a documented baseline in
`runner/seeder.ts` comments or `supabase/seed.sql`.

## Round-Trip Validation

For any mutation: (1) note the pre-mutation value; (2) submit and verify feedback; (3) assert the
new value on the same page — never skippable; (4) navigate away and back and assert persistence —
skippable only with a stated justification.

## Data Integrity Assertions

- Amounts match a numeric pattern; dates parse; no `NaN`, `undefined` or `Invalid Date`.
- Enums: human-readable label (`Per Session`), never the raw key (`per_session`).
- `—` only where data is genuinely absent; a just-saved field never shows `—`.

## Charlotte-Specific Guidance

Charlotte is an LLM reading screenshots/DOM: vague assertions ("a formatted value is visible") are
satisfied by any text. Write every assertion as a specific positive or negative criterion
("matches `/^[£$€₦]\s*\d/`", "does NOT contain NaN").

---

## Fixture Architecture

Full rationale: `docs/testing/e2e-fixture-architecture.md`. This section is the enforceable rule set.

### The three fixture tiers

| Tier | What | How | Who can use it |
|------|------|-----|-----------------|
| 0 — Static reference data | Currency configs, RG limit tiers, KYC tiers, game catalog | SQL seed | Any scenario — never mutated |
| 1 — Bucket-scoped baseline | One funded, KYC-verified account per parallel bucket | Real signup/deposit API once, session cached | Read-only scenarios ONLY |
| 2 — Per-scenario dedicated account | Fresh account owned by one scenario | `provisionAccount()`, API only | Any scenario mutating money, RG limits, KYC, or session/suspension state |

**Any scenario that mutates money, RG limits, KYC status, or session/suspension state gets its own
Tier 2 account; no reuse of a mutated account between mutating scenarios.**

#### Wallet credits: decide by what the scenario READS

`wallet_credit` mutates a balance row (and lifetime/daily stats), so it is not "append-only"; only
`seedCompletedDeposit` (`runner/seeder.ts`) is.

| Scenario asserts | Account requirement |
|---|---|
| Balance is numeric / not `NaN` / ≥ N rows (value-insensitive) | May share a wallet-written account |
| A balance VALUE, a DELTA, or a specific balance-change push | Own `provisionAccount()` account, declared in `mutatesAccountState` |

On a shared account a sibling's credit makes "balance changed" true even when the bet was never
debited — the suite goes green over the money bug it exists to catch. Do not migrate format-only
readers; serializing them buys nothing.

### API-not-SQL for money, limits, KYC, session state

Provision and mutate money, RG limits, KYC status and session/suspension state through the real API
(signup, deposit, limit-set, KYC-submit), never direct SQL. SQL bypasses RLS and business
invariants, can build states production cannot reach, and hides RLS defects (a broken policy
returns zero rows, not an error). SQL is correct for Tier 0 only.

### Deterministic naming — no hand-typed literals

Every account identifier comes from `provisionAccount()` (`runner/fixtures.ts`):
`charlotte-{module}-{scenarioId}[-w{bucketIndex}]@test.local`. Hand-typed account emails are
forbidden; `crypto.randomUUID()`, `Date.now()` or any random suffix is banned — a failing run must
be replayable against the same identifier. `provisionAccount()` may append a deterministic re-attempt ordinal `-r{n}` when the base account holds a retained wallet footprint; scenarios read `account.email`, never re-derive it.

### teardown() is mandatory

Every scenario in `mutatesAccountState` implements `teardown()`, called in `finally`. The only
exception is a justified annotation directly above the export:
`// @no-teardown-reason: <why nothing needs cleaning>` — a bare annotation still fails the guard. A Tier-2 account holding any wallet ledger, balance or gap row is retained untouched (the ledger is append-only); only `--reset-db` removes it.

### Scenario declaration requirements

Every `Scenario` (`runner/types.ts`) declares:

- **`sourceId`** — REQUIRED (`deno check` fails otherwise): the `scenarios/`-relative path without
  `.ts`, `/`-separated (e.g. `"player-web/rg/06-rg-statements"`). It is the key
  `scripts/validation/e2e-coverage-check.ts` derives from disk and `coverage-registry.json` uses;
  `name` is free text and never a key. Resolved by exact match only (`runner/source-id.ts`).
- **`accounts`** — every account the scenario logs into or reads/mutates.
- **`mutatesAccountState`** — the subset of `accounts` it WRITES persistent state on (never a
  scenario-wide boolean).
- **A `module` tag** (`"module:wallet"`): `auth`, `wallet`, `deposits`, `withdrawals`, `rg-limits`,
  `rg-exclusion`, `kyc`, `bonuses`, `games`, `fairness`, `operator-rbac`, `payments-config`,
  `reconciliation`, `analytics`, `communications`.
- **A `tier` tag**: `smoke` (PR feedback), `regression` (pre-milestone), `full`.

A scenario missing `accounts` is refused under `--parallel=N` (`validateScenarioAccounts()` in
`runner/bucketing.ts`) — never omit it to "fix" scheduling.

### Two-actor scenarios

When a second actor acts on the subject (operator suspends a player, forced logout, admin
approval), the **subject** is provisioned fresh via `provisionAccount()`. A never-mutated **actor**
(typically the seeded `charlotte-admin@test.local`) belongs in `accounts` but NOT in
`mutatesAccountState` — declaring it there serializes every scenario using that login for no
safety gain. Reference pattern: `operator-web/11`, `/20`, `/21`; `cross-system/03`, `/07`, `/08`;
rationale in `docs/testing/e2e-fixture-architecture.md` → "Two-actor scenarios".

### Anti-patterns — fixture and isolation

| Anti-pattern | Why it's forbidden |
|---|---|
| Order-dependent scenarios | Break under `--bucket=`, `--parallel=N`, a single re-run, or a reset |
| Exact global/table row counts | Meaningless under concurrency — count only rows the scenario created |
| Sharing a mutable fixture between mutating scenarios | The collision class this section closes |
| Missing `teardown()` on a mutation-class scenario | Leaks state; runtime-created prefixes (`charlotte-reg-`, `-viewer-`, `-op-`, `-suspend-target-`, `-role-target-`) accumulate forever |
| Fixed `sleep()` | Races or wastes time — wait for a condition (`testing.md` → `waitFor`) |
| Hard-coded emails/IDs | Bypass `provisionAccount()`'s naming contract and the guards |
| Wall-clock / "today" assumptions | A run at 23:58 and 00:02 UTC must agree |
| SQL-seeded money/limits/KYC/session state | See "API-not-SQL" |

**Reference scenario:** `scenarios/player-web/rg/07-rg-deposit-limit-widget.ts` — `sourceId`,
`provisionAccount()` with a seeded `depositLimit` in `prepare()`, `mutatesAccountState`, and
`teardown()` calling the account's own idempotent cleanup. `provisionAccount()` registers AND logs
in (it returns a live `sessionToken`; there is no `password`), so never call `loginAsPlayer()` again.

## Production-Build Serving Is Required For Regression Runs

A `tier:regression` run is served from production builds via `scripts/e2e-serve-prod.sh`, never
`next dev` — `next dev` compiles each route on first hit, so which scenario pays a 15 s compile
depends on scheduling order, and a dev-server timeout is not a product defect. The script builds
both apps, starts them with `next start` on :3000 (player) / :3001 (operator), waits until both
answer, and warms every regression `startUrl`:

```bash
scripts/e2e-serve-prod.sh
cd apps/e2e-charlotte && deno task test:regression
```

**Stale builds do not hot-reload.** Re-run `scripts/e2e-serve-prod.sh` before a regression run
after touching either app, and record the build's `git rev-parse HEAD` with any quoted result — a
result without a SHA cannot be trusted. `next dev` stays correct for interactive and ad-hoc runs.

### Timer-based clearing of state-bearing UI is a product defect

A `data-testid`'d status element that auto-dismisses on a timer (promo banner, RG cooling-off
notice) is a product bug: it races E2E assertions and hides restriction state from real players.
Never add a wait/retry workaround in the scenario; fix the component so the element reflects the
state for as long as it is true (`frontend-apps.md` → Testability Contract).
