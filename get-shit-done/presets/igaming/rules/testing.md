---
paths:
  - 'apps/api/functions/__tests__/**'
  - 'apps/e2e-charlotte/**'
  - '**/*.test.ts'
  - '**/*.spec.ts'
---

# Testing Rules

## Test Types

| Type            | Location                                     | Runs In    | Notes                                  |
| ---------------- | -------------------------------------------- | ---------- | --------------------------------------- |
| Unit Tests       | `functions/*_test.ts`                        | CI         | Fast, isolated, reliable                |
| API Integration  | `functions/__tests__/*.integration.test.ts`  | CI         | Full auth flow, sessions                |
| UI E2E           | `apps/e2e-charlotte/scenarios/`              | LOCAL ONLY | Charlotte MCP browser QA — never in CI  |

**Charlotte E2E is LOCAL ONLY** — requires a running browser and local Supabase stack, must NEVER be added to CI workflows.

## Why Local Can Pass When CI Fails (and how to prevent it)

**A test's real behavior must never secretly depend on developer-local ambient state CI doesn't
have** (long-lived local Postgres volume, untracked dotfile). Such tests ship
past every local check — detail: `docs/testing/testing-reference.md` →
"Untracked/Ambient Env Var Incident".

### Rule: tests must not depend on untracked/ambient local env vars

**Never construct a Supabase/Redis client straight from `Deno.env.get(...)`** in a test — either
document + reproduce every var the CI job needs in its `env:` block, or (prefer) inject the client
via a factory/DI override seam so the test never depends on ambient env. Before adding a test that
touches `Deno.env.get(...)` for a secret, check the job's `env:` block in `pr-validation.yml` —
don't assume parity with your local `.env.test`.

### Rule: local preflight must reproduce CI's clean-room guarantees, not just "tests green"

CI replays 100% of committed migrations from an empty volume; long-lived local stacks silently
accumulate schema no migration produced. `scripts/preflight.sh` runs
`scripts/check-migration-completeness.sh` to catch this (see `.claude/rules/database.md`) — if it
fails, `supabase db reset` before trusting any other local result.

### Rule: test-env var names are declared once, in the manifest

Every test-env var NAME (never a value) lives in `apps/api/test-env-manifest.json` — add a new var
there first, in the right category, or `scripts/check-env-manifest-parity.ts` fails the next
preflight/CI run with a named diff. Fix the manifest, never the checker.

### Rule: preflight runs integration tests in a scrubbed environment

`scripts/preflight.sh` replays the suite in a scrubbed env: fresh `.env.test` every run, executed
under `env -i` forwarding ONLY the manifest's allowlisted vars — for BOTH the `deno test` client
and the `supabase functions serve` process (a server-side-only var removed from the
manifest fails the replay too). Full mechanism + the
`.env` auto-load gotcha: `docs/testing/testing-reference.md` → "Scrubbed Integration-Test
Environment".

### Rule: construct Supabase service clients via the shared factory

Never a local module-level singleton reading `Deno.env.get('SUPABASE_URL')!` directly — import
`getSupabaseServiceClient()` from `@igaming/infrastructure`. In unit tests, inject a mock via
`setSupabaseServiceClientOverride(client | null)`, always cleared in a `finally` block. Full
override-seam code sample: `docs/testing/testing-reference.md` → "Supabase Service Client Override
Seam".

### Rule: the backend dependency lockfile is committed and frozen-enforced

`apps/api/deno.lock` is committed — update `deno.json`, regenerate the lock, commit both together.
**Frozen enforcement MUST stay at the `deno task` runner level, never inside the task string** —
`deno task` re-resolves and rewrites the lockfile before an inner `--frozen` runs, silently
defeating a task-string-only flag. See `docs/development/ci-drift-proofing.md`.

## CI Environment Requirements

**WARNING:** Edge Functions in CI require ALL of these secrets passed to the serve step, or functions fail silently (500s): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `AUTH_HMAC_SECRET`, `ENCRYPTION_KEY`, `NODE_ENV=test`, `DENO_ENV=test`, `ALLOWED_ORIGINS`.

## Integration Test Conventions

**UUID format:** last group must be exactly 12 hex chars:
```typescript
`99000000-4500-0000-0000-000000000${suffix}` // 9 zeros + 3-digit = 12 ✓
`99000000-4500-0000-0000-0000000000${suffix}` // 10 zeros + 3-digit = 13 ✗
```

**Required player fields:** `account_type` is NOT NULL on `player.player_accounts` — always include `account_type: 'email_password'` when creating test players.

**Stale data:** predictable UUIDs accumulate state across runs. Run `supabase db reset` before a full suite if balances/entity states look wrong.

**Fixture helpers take NO default parameters when `undefined` is a meaningful input.** A default intercepts an explicit `undefined` and substitutes the default value, so the one call site that says exactly what it means is the one that gets silently rewritten. Declare the parameter `T | undefined` with no `=` so every call site is forced to state it. Full incident: `docs/testing/testing-reference.md` → "Fixture Helpers: A Default Parameter Silently Rewrites `undefined`".

**After your own `supabase db reset`, gate on `/rest/v1/` before a hand-launched run** — a cold PostgREST makes every file fail at 0ms with `[prepare] Supabase health check failed: … HTTP 503`, which looks like a mass failure and is not one. Preflight and the runner have their own layers for this; a hand-launched run does not. Full mechanism + the ready-made curl gate: `docs/testing/testing-reference.md` → "Post-`db reset` HTTP 503 startup race".

**Waiting for async conditions — use `waitFor`, never a blind sleep** (`functions/__tests__/helpers/wait-for.ts`): `waitFor(predicate, { label })` polls until truthy or throws a labelled timeout, instead of `await new Promise(r => setTimeout(r, N))`. A raw sleep is acceptable only with `// justified-sleep: <reason>` directly above it (clock-tick precision gaps, or negative "X did NOT happen" assertions with no queryable signal). If you're writing a new local poll-loop, use `waitFor` instead. Full code example: `docs/testing/testing-reference.md` → "`waitFor` Async-Condition Helper".

## Supabase Client Selection in Integration Tests

Three test-client categories exist; picking the wrong one can grant `anon` access to privileged operations.

| Client | Declaration | Usage | RLS |
| --- | --- | --- | --- |
| `supabase` (service_role) | `createClient(url, SERVICE_ROLE_KEY)` | Privileged DB ops, test setup | Bypassed |
| `anonClient` (anon key) | `createClient(url, ANON_KEY)` | Public endpoints, RLS isolation tests | Enforced |
| HTTP fetch + Bearer token | `fetch(url, { headers: { Authorization: 'Bearer <token>' } })` | Authenticated Edge Function endpoints | Via Edge Function auth |

Setup, seed, `set_auth_context(...)` and wallet mutation RPCs use `supabase` (anon has no EXECUTE grant); public endpoints use `anonClient`/plain fetch; authenticated endpoints use HTTP fetch + session token (RPCs skip session validation); RLS isolation uses `anonClient` + auth context (service_role bypasses RLS).

**WARNING: never "fix" a permission-denied test failure by granting the `anon` role** — always switch the test to the `supabase` (service_role) client instead. A grant to `anon` is a production vulnerability. Worked code examples for every row: `docs/testing/testing-reference.md` → "Supabase Client Selection — Worked Examples".

## Operator Auth in Integration Tests

**WARNING:** operator endpoints require operator sessions, not player sessions — a player token on an operator endpoint returns **401** (unrecognized session type), not 403. 403 is reserved for an authenticated operator with insufficient role. Use `loginAsAdmin()` (`./auth-helpers.ts`, POSTs `/auth/operator/login`, NOT `/auth/login`) to obtain an operator token. Correct-pattern code, wrong-pattern example, and the full 401-vs-403 assertions: `docs/testing/testing-reference.md` → "Operator Auth — Extended Examples".

## Complete Test Account Seeding Checklist

A "complete" `seed.sql` player account for financial-flow tests needs ALL of: (1) a
`player.player_accounts` row (`account_type`, `status = 'active'`); (2) a
`player.linked_auth_methods` row with hashed credentials; (3) a `player.player_profiles` row with
encrypted profile data; (4) `kyc_status = 'fully_verified'` on `player_accounts` AND a matching
`kyc.player_kyc_status` row; (5) a `wallet.player_wallets` row if a pre-funded balance is needed.

**Missing KYC status silently blocks all Charlotte financial-flow scenarios** — deposit/withdrawal pages show "Complete identity verification" instead of the form.

## Seed Data & Test Cleanup

Any test file with a FIXED, deterministic, cross-bucket-shared player (not a per-run random UUID) MUST call `registerTestFixture("player_account", id, ownerLabel)` at its own module load — no other file needs editing. `cleanupAllTestAccounts()` sweeps `player_accounts` rows that are neither a static seed account nor registered, and older than 10 minutes (so same-run accounts from other buckets are never touched). Full fixture-registry schema: `docs/testing.md` → "Postgres Test Isolation (Fixture Registry)".

## E2E Coverage Gate

Any frontend component integrating with an API endpoint needs a corresponding E2E smoke test before a phase is complete: the success path, plus at least one error/empty state. **Components without testids cannot be E2E tested** — add testids first. **Enum/type values in frontend code must match exact backend API response values** (never assume, e.g. `'percentage'` vs `'percent'`) — verify against a real API response during development, not inferred names.

## Test Failure Policy

**NEVER** add `--ignore`, `--skip`, or exclusion flags to make a failing test disappear — read the error, find the root cause, fix it, re-run. **Only legitimate skip:** integration/E2E tests genuinely requiring infrastructure absent from unit CI — use `// ignore: requires Supabase — runs in integration CI` with `ignore: !HAS_DB` (self-enabling). **If you catch yourself adding `--ignore`, stop — that's always the wrong move.**

## Test Falsifiability — every test must be able to fail

- **Positive control:** every denial, absence or fault assertion pairs with a control differing in exactly one condition that passes; absence is asserted only after the action has settled.
- **The fixture reaches the branch it names:** distinct owner/victim principals, the input that triggers the path, a token of the right class; assert the branch was entered. A fixture that falls back to another subject, a seeded row, or ambient state is a defect.
- **Expected values come from the contract,** never from importing the builder under test, and never a value the test wrote without reading it back from the system.
- **Mutation proof:** a claimed red counts only if the script asserts the file changed where intended (a `sed` can no-op after `deno fmt` reflow), the mutant type-checks, the log postdates the code, and the failure is the defect's assertion in the pre-fix tree (TypeError, import error or timeout is not a red). Revert the hunk, not the whole file. Mutation runs happen in a throwaway git worktree under `.tmp/wt-<name>`, never the shared working tree.
- **Unit-level mutants (TS, `deno test <file>`) run through `scripts/gsd-mutate/`, not by hand:** write one mutants JSON (each with `expect_failing_test`), run `deno run --allow-read --allow-write --allow-run=git,deno,perl,kill scripts/gsd-mutate/gsd-mutate.ts --mutants <json> --root .tmp/wt-<name> --out <path>` (`--dry-run` first), never with `--allow-dirty`. A kill counts only as `killed` with `kill_confirmed: true` in a run whose `<out>.run.json` shows `exit_code` 0 and both baselines green; `killed-typecheck`, `errored` and `timeout` are not kills. Commit the JSONL + `run.json` as the evidence. SQL/live-stack mutants stay manual for now. Usage: `scripts/gsd-mutate/README.md`.
- **Evidence is committed: every log, mutant and `results.json` that a SUMMARY or `FINDINGS.tsv` cites is copied into `<plan>-evidence/` in the commit that first cites it (an excerpt of the mutant, the runner count line, the failing assertion lines and the restore check), because `.tmp/`, `.planning/test-runs/*.log` and `apps/e2e-charlotte/results/` are gitignored scratch and `.tmp/` is purged after 2 days.**
- **Doubles behave like the real dependency:** fakes apply the filters, limits, ordering and `.select()`/to-one-embed shapes production branches on, return real wire types (Redis RESP integers and raw strings, NUMERIC as string), and model rejection and no-match. Redis Lua/encoding and PostgREST shape changes need a real-backend case.
- **A run counts only with its count:** the log shows N > 0 tests and the runner's own success line. Exit 0 from a `--filter` matching nothing, a `db reset` printing an error, or a status-only health probe is not evidence. Every test file is collected by a runner CI executes; missing credentials fail loudly, never self-skip.
- **Contract changes sweep their tests:** changing a gate, signature, error code or key name updates every caller, fixture, fake and assertion of it in the same commit and runs those suites. A contract test asserts the LAST forward definition of a migration function.
- **A new integration test is run live once,** red then green, before its phase claims it; after editing function files, confirm the edge runtime reloaded before trusting the verdict.
- **Harness helpers never discard evidence:** no `res.json().catch(() => ({}))`, no ignored insert/DELETE/cleanup result, retries bounded and only on a named transient signature, failing-attempt logs kept.
- **Sanitizer opt-outs** (`sanitizeOps`/`sanitizeResources: false`) need a cited, verified reason; close channels and broadcast stubs in teardown.

## Test Economy — reuse first, lowest layer, fewest tests

- **Reuse before add:** `zg query` the behaviour's RPC/route/error code across `*.test.*` first; choose REUSE / UPDATE / MERGE / ADD and record it in the SUMMARY `## Test Delta`. No test-count minimums or per-category quotas.
- **Lowest layer that can fail for the real reason:** DB/RLS/grants/RPC signatures/idempotency/concurrency/rounding → real-DB integration; pure logic → unit; Charlotte only for what needs a browser. No unit tests on a file of only `export ... from` re-exports or on handlers whose logic lives elsewhere; never assert one contract at two layers unless the second covers wire shape (HTTP status mapping).
- **Risk tiers:** T0 money/auth/RNG/KYC/payment/ledger/settlement = real DB, one test per threat, mutation-proven (one mutant per guarded condition), real concurrency (`Promise.all` + barrier) for race claims, positive control. T1 = default. T2 low-risk = parametrize literal-only variants.
- **Hollow tests fail review:** no assertion; only `assertExists`/`assert(true)`/`toBeDefined`/status-only; a refusal check matching any error code (assert code AND message); a "concurrency" test that is sequential; a "view/table exists" test; a cron/schedule test that never reads the schedule (`cron.job`); a literal self-comparison.
- **Merging and deleting are first-class:** a DELETE/MERGE row needs a cited covering `*.test.*` path:line or mutant id; sensitive paths (wallet|auth|rng|kyc|payment|ledger|settle|balance|stake|payout|deposit|withdraw|session|totp|bet) need a MERGE with a verified mutant.
- **Size and time:** test files target ≤1,500 lines (larger ones may only shrink; `crash-bet-wallet.integration.test.ts` is the known offender). Report bucket seconds before/after in Test Delta; a plan raising a bucket >10% justifies or fixes it.

## New coverage lives in an existing wired suite, not a new runner

A check (guard canary corpus, demonstrated-failure mutation proof, shell-helper case) must be a case inside a test file an EXISTING task runs — for repo tooling that is `deno task test:repo-scripts` (`apps/api/deno.json`, run by `scripts/preflight.sh` and by the `canary-gate` job in `pr-validation.yml`). Never a standalone script nobody runs, never a new CI job. Cover helper logic by adding test cases. Details: `.claude/rules/guard-authoring.md` §5.

## Charlotte E2E Runner Gotchas (MUST)

- `loginAsPlayer()` (`runner/auth.ts`) MUST extract and return `realtimeToken`, or `RealtimeContext` falls back to a network call that races page navigation. Adding a new auth-response field means updating all four: `PlayerSession` interface, the return statement, `ScenarioData.auth` type (`runner/types.ts`), and the localStorage injection template (`runner/prompt.ts`).
- `ANTHROPIC_API_KEY` MUST be stripped (destructured out) from the Charlotte subprocess env — the runner uses `clearEnv: true` but still spreads remaining vars, and an inherited key silently switches billing from Claude Code OAuth to pay-per-use.
- **Never verify auth via the home page** — it renders identically for logged-in and anonymous users. Navigate directly to the protected page after token injection.

Rationale + code samples: `docs/testing.md` → "Charlotte E2E Tests" (Auth Strategy, Runner Subprocess Environment).

## Cross-Layer Consistency

A value existing in more than one layer (DB constraint, RPC, edge function, frontend type, UI display map) must be identical everywhere — **when you add a new value to ANY layer, grep all other layers and update in the same commit.** Silent failure modes: RPC param name mismatch → NULL passed silently; PostgREST `.from()` without GRANT → 0 rows, no error; frontend type union missing a DB status → TypeScript won't catch it until a `Record<Status,string>` map is incomplete.

## Integration Test Isolation

Tests creating shared mutable state (campaigns, configs, events) must clean up non-seeded records at module load, before any `Deno.test()` body runs — accumulated data causes cascading timeouts in processing loops.

A test that mutates a shared config/seed row must **snapshot the real row and restore exactly that snapshot** in `finally`, then read it back — never a hard-coded "default". Assert only on rows the test created, never on global counts or counters it does not own. A leak that dirties a shared row is a test defect fixed in the phase that finds it, never left for a db reset.

**A per-site restore handle is not a cross-process guarantee — `withMoneyConfigLock` is.** Snapshot/restore inside one process still loses a race against a *concurrent* scope in another process (14 parallel buckets, and a peer's `db reset`-free run on the same shared stack): two scopes both read the pristine row, each restores it at its own exit, and the first to exit silently reverts the second's mutation — or the second's snapshot captures the first's dirty value and makes it permanent. Every write to a money-config key (`arena.*`, `market.*`, region-gate, etc.) therefore goes through `withMoneyConfigLock` (`functions/__tests__/helpers/money-config-admin.ts`), which holds a Postgres **advisory lock spanning the whole body** and restores every key it saw written. Writers outside a scope are **refused**, so an unwrapped write fails loudly at the call site instead of leaking — **use that refusal as the discovery mechanism**: run the file, read the named key, wrap it, re-run. Preferred shapes, in order: **(a)** wrap a bracket helper (`withWageringMode`, `withActiveMarket`) internally so every call site is covered at once; **(b)** wrap the whole `Deno.test` body; **(c)** `noteMoneyConfigWrite(key)` before the fetch, **inside the helper that performs it**. Shape (c) is not about one function called `patchConfig` — it is EVERY write that leaves the process, HTTP fetch, an RPC call, or a service-role client write, and the declaration belongs at the single chokepoint so all its call sites are covered by construction. The failure it prevents is specific and silent: an undeclared write is invisible to the guard, so if the scope's first touch of that key is the test's own guarded `finally` restore, the scope snapshots the ALREADY-MUTATED row and puts it back on exit — undoing the restore and leaving the row polluted for every later run. Nesting is **explicit** — the scope passes a `MoneyConfigLockScope` token and a nested call uses `scope.run(...)`; it is never inferred from ambient state. Declare any per-site `patch` handle inside the `try` that releases it, never above it.

## Shared Local Stack: Live Runs and Probes

- `supabase functions serve` hot-reloads on ANY write under `apps/api/` (source, tests, migrations), wiping the in-process MockRedis — integration results during a write are void. With parallel phases, write `apps/api/` only while YOUR phase holds `.tmp/local-stack.lock` — the write itself voids a peer's live run, even if you only run unit tests; for mutation proofs wait for `Serving functions on` in `/tmp/functions-serve.log` after each apply AND each revert.
- `deno task test` forces `USE_MOCK_REDIS=true` (`apps/api/deno.json:57`) while the edge runtime uses real Redis — any test that reads state the edge runtime wrote must run via `scripts/run-integration-tests.sh`.
- Ad-hoc `psql` probes against the shared DB start with `SET lock_timeout='5s'; SET statement_timeout='60s';` and end in `ROLLBACK` unless a write is intended — an unbounded probe can hang on a lock and kill the executor.

## Flake Prevention Gate

`apps/api/scripts/flake-gate.ts` statically flags hardcoded literals in `*.integration.test.ts` prone to cross-run collisions (full detail: `docs/testing/testing-reference.md` → "Flake Prevention Gate"). Enforced at three layers: a `Write`/`Edit` PreToolUse hook (partial-context nudge), the git pre-commit hook (authoritative, blocks the commit), and a whole-suite CI step.

Categories: `hardcoded-round-number` and `hardcoded-id` (bare integer literal upserted into a `/shared/i`-named table; exempt with `23505` within ±40 lines), `absolute-time-window` (literal `start_hour`/`end_hour` pair; exempt with `getUTCHours` within ±40 lines).

**Suppress with `// flake-gate-ignore: <justification>`** on or above the flagged line — a bare `// flake-gate-ignore` with no justification does NOT suppress.

## PVP Arena RNG-dependent assertions

Any `match_over`, round-advance, `hp`, `status`, or post-resolve wallet assertion after a live PVP resolve is RNG-dependent unless the tier's damage bound proves otherwise. Exactly two acceptable forms: **(A) cited bound** — the comment names the tier, its live `starting_hp` / `strike_*` / `damage_shape` / `rtp`, and `max_damage = bet × ((shape+1)/2) × rtp × crit_multiplier` summed over the asserted rounds `< HP`; expectation arguments ("E[damage] = …") are not bounds. **(B) seed pin** — `pinServerSeedForOutcome` (`__tests__/helpers/pvp-seed-pin.ts`) after join, plus an exact `round_outcome.damage1/2` assertion against the returned oracle so a silent pin failure fails loudly.

## Parallel Test Execution

Integration tests run **concurrently across 14 named domain buckets** via `scripts/run-integration-tests.sh` (repo root) — **no `supabase db reset` between buckets**; isolation comes from domain partitioning, per-test isolated identifiers, and the fixture-registry sweep. Full bucket table, isolation mechanism, coverage-completeness self-check, `@domain` tagging, and timing history: `docs/testing/testing-reference.md` → "Parallel Test Execution".

**Do not move a test file across a documented bucket boundary without reading why** (inline comments above each `*_FILES` array explain the incident behind each boundary). **A new integration test file MUST be added to the correct bucket array** — the runner's coverage-completeness self-check fails the run (exit 1, names the file) if it's assigned to zero or more than one bucket.

Each test file must include a `prepare()` gate before the first `Deno.test()` call — it deactivates
accumulated non-seeded test data BEFORE any test runs, so stale campaigns/state don't cause
event-loop timeouts. Full code sample: `docs/testing/testing-reference.md` → "Test File Preparation
Requirements".

**Flaky-test quarantine (`.planning/flaky-tests.json`) is WHOLE-FILE only, matched against the bare filename** — a `file::step` or path-qualified entry silently matches nothing:
```json
{ "quarantined": ["bonus.integration.test.ts", "wallet.integration.test.ts"] }
```
Diagnose and fix the real root cause quickly — do not rely on quarantine long-term. **Do not restate a fixed "%-faster" figure for the parallel runner**; historical numbers aren't apples-to-apples (`docs/testing/testing-reference.md` → "Timing Expectations"). Full local run-command reference (single domain, single bucket, sequential debug, concurrency tuning): `docs/testing/testing-reference.md` → "Running Tests Locally".
