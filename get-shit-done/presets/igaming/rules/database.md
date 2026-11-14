---
paths:
  - "apps/api/migrations/**/*.sql"
  - "apps/api/supabase/migrations/**/*.sql"
  - "apps/api/libs/**"
---

# Database Rules

## Migrations

**WARNING:** NO DIRECT DB CHANGES - Use migrations only

- Every forward migration ships a `ROLLBACK_<ts>_<name>.sql` pair in the same directory, and both have been applied once before review.
- Never edit a migration that has been applied anywhere — add a new one. Take the next free timestamp above HEAD's max at commit time; two files never share a version prefix.
- **A migration-defined function counts as working only after it has EXECUTED.** Apply it via a real `supabase db reset` and call each branch once against seeded rows before review or any PASSED claim. A regex/text test over SQL, including a migration self-assertion's own TS test, is never evidence — PL/pgSQL compiles bodies lazily, so a function can create cleanly and raise on every call. A migration self-assertion
  matches comment-stripped text, scoped to its own block, and has been seen to fire.
- Migrations live in `apps/api/migrations/`. `apps/api/supabase/migrations` is a symlink to it (git mode 120000); never replace it with a real directory.
- Apply to the shared local stack incrementally with `supabase db push --local` under `.tmp/local-stack.lock`. Every write here hot-reloads the edge runtime, and ad-hoc `psql` probes need lock/statement timeouts — see `testing.md` → "Shared Local Stack".
- **A replacement function starts from the live body:** copy the base of a `CREATE OR REPLACE FUNCTION`, and of its `ROLLBACK_*`, from `pg_get_functiondef` after a fresh `db reset`, never from the last `CREATE` in source (a later migration or an apply-time `DO` block may have rewritten it).

## Migration Completeness — Clean-Room Verification (MANDATORY)

**WARNING:** If code depends on a table, RPC, or enum value, that object MUST be created by a
committed migration in `apps/api/migrations/` — not a manual `psql`/Studio statement, a seed file,
or something "already in the local DB". CI replays every migration from an empty volume; a local
stack does not (`supabase start` reuses the existing volume and has drifted before — 333 of 356
migrations applied — while hand-patched objects kept local tests green). Incidents:
`.planning/audit/GRANTS-DIAGNOSIS.md`, `.planning/audit/CI-INTEGRATION-DIAGNOSIS.md`.

**Before claiming a phase that adds/changes schema is done:**

1. Run `scripts/check-migration-completeness.sh` (wired into preflight) — catches an unapplied
   migration, not an incomplete one.
2. Run the integration tests that exercise the new object against a just-reset DB
   (`cd apps/api && supabase db reset --yes`, then `scripts/run-integration-tests.sh`). A green
   run before a reset proves nothing.
3. Any raw `psql`/Studio DDL run locally is captured in a migration in the same session, before
   the next test.
4. Recreating a view or function (`DROP` + `CREATE`) re-adds every `GRANT` in the same migration —
   recreation drops the ACL.

## RLS (Row Level Security)

**WARNING:** RLS is MANDATORY on all user-facing tables. Never create a table without RLS
policies; test them under different user contexts.

**Service-only tables too:** tables reached only via SECURITY DEFINER RPCs still need
`ENABLE ROW LEVEL SECURITY` plus at minimum a service_role policy — a future direct path would
otherwise be wide open:

```sql
ALTER TABLE my_schema.my_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON my_schema.my_table
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**Append-only tables** (audit logs, snapshots, event logs, ledgers) get no `UPDATE`/`DELETE` grant
to any role and a `BEFORE UPDATE OR DELETE` trigger that raises. Enforce it on the base table,
never on one view over it.

Ledger and balance tables get no INSERT/UPDATE/DELETE/TRUNCATE grant to any application role and no default privilege (writers are postgres-owned SECURITY DEFINER RPCs); a status column has an allow-listed transition trigger.

## PostgreSQL Role Grant Policy (SECURITY CRITICAL)

**WARNING:** the anon key is public (embedded in frontend bundles). EXECUTE to `anon` on a sensitive
RPC is a public, unauthenticated endpoint.

| Role | When used | Trust level |
|------|-----------|-------------|
| `anon` | No session | PUBLIC — untrusted |
| `authenticated` | Valid JWT present | User-level |
| `service_role` | Service role key — Edge Functions | TRUSTED — server only |
| `authenticator`, `supabase_read_only_user`, `supabase_etl_admin` | Platform login roles | Untrusted like `anon` — no EXECUTE or write grants |

Every project schema (at minimum `wallet`, `player`, `payments`, `audit`):

- Mutation RPCs → `service_role` only. Read RPCs → `service_role` (or `authenticated` with RLS).
- Never `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA … TO anon`.
- `public.set_auth_context` → `service_role` only (anon could impersonate any player).
- Never `ALTER DEFAULT PRIVILEGES … TO anon/authenticated/PUBLIC`, and never broad default
  `SELECT ON TABLES TO authenticated` — use explicit per-object grants.
- Never "fix" a permission-denied test by granting `anon`; switch the test to the service_role
  client (`testing.md` → "Supabase Client Selection").

### Default privileges (`20260923000900`)

Objects `postgres` creates in `public` (tables, views, sequences, functions) or in `player`
(tables, sequences) get **no** anon/authenticated privileges; new functions in any schema get no
PUBLIC EXECUTE, only service_role. Never rely on default grants:
- GRANT explicitly to each role with a named caller (e.g. an RLS helper running as
  `authenticated` needs `GRANT EXECUTE … TO authenticated`).
- The `public-grant-surface` guard (`apps/api/functions/__tests__/public-grant-surface.integration.test.ts`)
  fails on any anon/authenticated/PUBLIC privilege not in its inline `ALLOWLIST`
  (`383.1-GRANT-INVENTORY.md` mirrors it).
- `bonus` and `progression` default privileges give service_role SELECT only (`20261031030000`), so a writable
  table there needs an explicit GRANT with a named caller (G-WS, `privilege-surface-g1.integration.test.ts:716`).

### SECURITY DEFINER EXECUTE

- Use SECURITY DEFINER only when the caller cannot hold the privileges directly; default INVOKER.
  Every DEFINER function pins `SET search_path`, with `pg_catalog` first (or absent) and `pg_temp` present and last;
  G-SP1 checks this on the live catalog (`apps/api/functions/__tests__/public-grant-surface.integration.test.ts:2047`; `pg_temp` predicate at `:2041`).
- Grant EXECUTE on a DEFINER function only to `service_role`. PUBLIC includes the platform login
  roles above, not just anon.
- Default privileges apply only on first creation. Before `CREATE OR REPLACE` of an existing
  function, check its grants and add an explicit `REVOKE ... FROM PUBLIC`.
- **Assert privileges on the live catalog, never by reading migrations:**
  `has_function_privilege` / `aclexplode(proacl)`, including PUBLIC and group-role paths. A NULL
  `proacl` means the default ACL (PUBLIC EXECUTE), not "no grant". A `REVOKE` issued by a role
  that no longer owns the object is a silent no-op — probe the ACL after it.
- Enforced by G4b-G4e and G9 in `public-grant-surface.integration.test.ts`. INVOKER functions and non-public relations
  are enforced by G10 and G11 (authoritative) and G12 (reach lower bound) in `privilege-surface-g1.integration.test.ts:322,414,423`.

## Schema Access Pattern

**WARNING:** PostgREST blocks non-public schemas. Real table in a domain schema
(e.g. `player.player_accounts`) → view in `public` → INSTEAD OF triggers for writes. Client code
uses `supabase.from('player_accounts')`, never `.schema('player').from(...)`. Details:
`docs/api/guides/schema-access.md`.

**`public` holds views, RPCs and INSTEAD OF triggers only — never `CREATE TABLE public.*`.** Put
the table in its domain schema (`configuration_management`, `player`, `wallet`, `bonus`, …) and add
a view.

**Before `CREATE TABLE`, search for an existing table serving the same purpose**
(`zg query "CREATE TABLE"` plus the keyword; audit/log/event/history tables are the usual
duplicate) — a duplicate `public.config_audit_log` once shadowed `configuration_management.audit_log`.

## New PostgreSQL Schema Checklist (MANDATORY — 42501 / 42883 if skipped)

All three steps are independent; any two without the third still fails.

1. **`apps/api/supabase/config.toml`:** add the schema to BOTH `[api] schemas` (else PostgREST
   refuses to route) and `extra_search_path` (else objects are invisible to the planner).
2. **A grants migration:** `GRANT USAGE ON SCHEMA <s> TO service_role;` plus EXECUTE per the grant
   rules above. Without USAGE, PostgREST returns 42501 even if the function exists. **Never grant
   USAGE on a non-public schema to `anon` or `authenticated`** — `20260923001000` revoked it on all
   10 exposed domain schemas, and the `public-grant-surface` guard (G5/G5b/G5c) fails on a
   re-grant. Tables that tests or code reach via PostgREST `.from()` need (except ledger and balance tables, see RLS above)
   `GRANT SELECT, INSERT, UPDATE ON <s>.<t> TO service_role` in the migration that creates the
   table — without it writes silently affect 0 rows. A table grant to `authenticated` in a
   non-public schema is dead ACL.
3. **Schema-qualified calls** in edge functions: `supabase.schema('<s>' as never).rpc(...)`
   (`edge-functions.md`).

## Wallet Schema RPC Routing

**WARNING:** `wallet.*` RPCs need a schema-qualified client
(`createClient(url, key, { db: { schema: 'wallet' } })`); `supabase.rpc('wallet_credit')` fails
with PGRST202.

## Seed Config Values

**WARNING:** `seed/001_configurations.sql` (staged) must use real local values for
`cache_invalidation_function_url`. No seed inserts a `service_role_key` configuration row since 404-09; the
demo key exists only as the vault secret `SUPABASE_SERVICE_ROLE_KEY` in the local-only
`seed/007_local_vault_secrets.sql`. The cache triggers swallow a missing config row (`20260325000100`).

## Deleting a `configurations` row requires `set_rollback_mode()`

A bare `DELETE FROM configuration_management.configurations` fails on every row
(`fk_audit_configuration`): the `audit_and_invalidate_cache()` trigger inserts an `audit_log` row
pointing at the already-deleted id. `set_rollback_mode()` sets an `is_local` flag, so it must run
in the SAME transaction (psql autocommits each statement):

```sql
BEGIN;
SELECT configuration_management.set_rollback_mode();
DELETE FROM configuration_management.configurations WHERE config_key IN (...);
COMMIT;
```

## `version` on a `configurations` UPDATE

The BEFORE UPDATE trigger `increment_configuration_version()` bumps `version` only when
`config_value`, `encrypted_fields`, `category`, `description` or `tags` changes — omit an explicit
`SET version = version + 1` there. A write changing none of them needs the explicit bump (as
`upsert_arena_config_with_audit`, `20261007200000`, does) or a no-op write will not invalidate a
concurrent caller's `expected_version`. A read-modify-write config RPC takes an expected-version
precondition and refuses on mismatch.

## RPC Function Parameters and Names (RECURRING BUG)

**WARNING:** wrong parameter names fail silently with generic errors (once 100% of auth in
production). Before calling an RPC, read its signature from the defining migration
(`zg query "CREATE OR REPLACE FUNCTION <name>"`; the LAST definition wins) or `\df`, and match
every `p_*` name exactly. Column, enum and function names in TS service types, queries, seeds and
fixtures are derived from migrations, never guessed — a name with no `CREATE` behind it is a
defect, and a seed/fixture insert that fails aborts the module rather than warning. Run
`deno check` before writing service code against a new table.

## Data Integrity Principles

**Allowlists for enumerable inputs:** transaction types, status transitions, currencies are
validated against an explicit allowlist before touching the DB.

**RETURNING id for multi-step SQL:** INSERT-then-UPDATE uses `RETURNING id INTO v_row_id`.
Append-only tables (any `prevent_*_mutation` trigger) block UPDATE — compute derived columns
first and include them in the INSERT (e.g. `kyc.player_substatus_log.overall_status_after` via
`kyc_evaluate_rules`).

**Lock before check (TOCTOU):** read-then-write on shared state takes `SELECT ... FOR UPDATE`
before the check; an idempotent-replay lookup happens under that lock, not before it.

**Compare-and-set counts rows:** a conditional `UPDATE ... WHERE <expected state>` that gates money
or a state transition checks the affected-row count; zero rows is a refusal, never success. A
state change and its audit row are one statement or one transaction.

**Consistent lock ordering:** multi-row locks are taken in a deterministic order independent of
caller input. Example (400-42): two-player settlement credits lock both `player_balances` rows in
ascending `player_id` before the first leg (`apps/api/supabase/migrations/20261023220000_400_pvp_settlement_lock_order_and_sweep_atomicity.sql:137-151`).

**Minimize lock hold time:** merge mutations to the same row into one statement.

**Atomic one-time-use:** consume tokens/codes with `UPDATE ... WHERE consumed_at IS NULL RETURNING *`.

**NULL-safe guards:** `NOT IN`, `<>`, `IF NOT`, `->>` comparisons and CHECK conjunctions over a
nullable value use `IS DISTINCT FROM` / `COALESCE`; a NULL version, role, key or JSON null is a
refusal. `NULL + n` is NULL — `COALESCE` every term of a money sum.

**NaN is a number to Postgres:** a positivity CHECK admits NaN (NaN orders above every number), so every non-generated NUMERIC column in a project schema also carries `col <> 'NaN'::numeric`. `[400-12:NN4b]` (`apps/api/functions/__tests__/wallet-schema.integration.test.ts`) sweeps `pg_attribute` across every non-platform schema and fails a column without one.

**A per-unit savepoint rolls back every leg of that unit on any leg failure; an inner per-leg handler that swallows an error inside a multi-leg unit is a defect.**

**Erasure is complete or refused:** an erasure classifies every player-keyed table (scrub or
ADR-0013 retain), scrubs regardless of row status, locks before checking preconditions, refuses
while any money state is non-terminal, and leaves no write path to the erased account.

## Custom Authentication — NEVER Reference `auth.users`

**WARNING:** this platform does not use Supabase Auth. Players live in `player.player_accounts`,
operators in `operator.operator_accounts`; player FKs reference `player.player_accounts(id)`,
operator FKs `operator.operator_accounts(id)`. Never `REFERENCES auth.users(id)` — the
`auth.users` references in `20260126100300_auth_foundation.sql` are dead legacy, not examples.

## Migration Principles

**TTL for all append-only dedup/audit tables** (idempotency keys, processed event IDs): add a
`pg_cron` cleanup job.

**pg_cron calls MUST be guarded — bare `SELECT cron.schedule()` breaks `supabase db reset`.**
Three requirements: (1) a `pg_extension` guard; (2) a `cron.job` existence guard around
`unschedule` — `cron.unschedule('<name>')` for a job that does not exist RAISES, and pg_cron IS
created on this repo's reset path (`20260126100400`), so the extension guard alone is not enough;
(3) a named inner dollar tag — an inner `$$` closes the `DO $$` body early.

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'my-job-name') THEN
      PERFORM cron.unschedule('my-job-name');
    END IF;
    PERFORM cron.schedule('my-job-name', '0 * * * *', $cron$SELECT my_schema.my_function()$cron$);
  END IF;
END $$;
```

Repo examples: `20260611001000_cron_guards_and_sql_fixes.sql:106`, `20260320000100:573-584`.

pg_cron/pg_net callers use `monitoring.cron_service_post` / `cron_signed_post` (single-use ticket); never put a service key in headers or a `configurations` row (G13i, `privilege-surface-g1.integration.test.ts:1011`).

**Set-based over row-by-row:** batch scans and cron jobs use set-based CTEs
(`WITH eligible AS (SELECT id ... FOR UPDATE SKIP LOCKED) UPDATE ... FROM eligible`), not `FOR`
loops calling an RPC per row.

**One bad row never stops a batch:** where per-row work can fail (a money credit, an erasure), a
failing row is isolated (`BEGIN … EXCEPTION` per row, or a failure marker) and leaves the selection
so it cannot starve the batch behind it; order by a column that advances; count only work that
finished.

**PL/pgSQL first-execution traps:**
- A multi-column `SELECT … INTO` a `%ROWTYPE`/table-typed variable assigns by POSITION. Allowed:
  `SELECT *` / `RETURNING *` from that SAME single table into its own row type, or any column list
  into an untyped `RECORD`, or one scalar variable per column. Never a named-column list, a join, or
  another table's `*` into a row-typed variable.
- `RAISE ... '%'` needs one argument per placeholder (`%%` for a literal); an unmatched `%` fails
  `CREATE FUNCTION` and breaks `db reset` for the branch.
- Aliases from an `UPDATE ... FROM` or an outer loop are not in scope in a later statement.

**INSERT idempotency:** `INSERT ... ON CONFLICT (key) DO NOTHING` (or `DO UPDATE`), never
`IF NOT EXISTS (SELECT …) THEN INSERT`. A `unique_violation` handler applies the same binding checks
as the main path.

**Index-friendly predicates:** never wrap an indexed column in a function in WHERE
(`DATE(created_at)`, `LOWER(email)`) — use ranges or an expression index.

**No `CONCURRENTLY` in migrations:** every migration runs inside a transaction, so
`CREATE INDEX CONCURRENTLY` fails. Use `CREATE INDEX IF NOT EXISTS`.

## Column/Function Removal Migrations

**WARNING:** a DROP with dependents fails silently if done naively.

**Before writing it:** find every dependent (views, functions, RLS policies, triggers, indexes) via
`pg_depend` — join `pg_rewrite`/`pg_class` for views, `refobjid` = the function's `pg_proc.oid` for
functions — and confirm the object exists in the current schema.

**Order:**
1. `DROP VIEW IF EXISTS` the dependent views.
2. `REVOKE` on the function inside `DO … EXCEPTION WHEN undefined_function THEN NULL`.
3. `DROP FUNCTION IF EXISTS … CASCADE`.
4. Drop the index/column.
5. Recreate the views without the column (`DROP` + `CREATE`, never `CREATE OR REPLACE VIEW` —
   Postgres refuses to drop view columns).
6. Recreate the INSTEAD OF triggers.
7. Restore exactly the grants the view had before, per the grant policy above —
   no anon/authenticated grant the guard's `ALLOWLIST` lacks.

**Also sweep application code:** RPC signatures, seed INSERTs, TS types and SELECTs, INSTEAD OF
trigger bodies, and view definitions. One missed reference cascades across the whole
auth/registration flow.
