# Data Integrity

Applies to every migration, schema change and data-writing path. Gated: deployed only when the profile's `stack.capabilities.backend` is an object. Rules name no platform or product; the profile names the database and its commands.

## Migrations

**WARNING:** NO DIRECT DB CHANGES - Use migrations only

- Every forward migration ships a `ROLLBACK_<ts>_<name>.sql` pair in the same directory, and both have been applied once before review.
- Never edit a migration that has been applied anywhere — add a new one. Take the next free timestamp above the newest one at commit time; two files never share a version prefix.
- **A migration-defined function counts as working only after it has EXECUTED.** Apply it via a real database reset and call each branch once against seeded rows before review or any PASSED claim. A regex or text test over SQL, including a migration self-assertion's own test, is never evidence — the procedural language compiles bodies lazily, so a function can create cleanly and raise on every call. A migration self-assertion matches comment-stripped text, scoped to its own block, and has been seen to fire.
- Migrations live in one migrations directory. Apply to the shared local stack incrementally, under the stack lock. Every write there reloads the served runtime, and ad-hoc probes need lock and statement timeouts (the testing rule's "Shared Local Stack").
- **A replacement function starts from the live body:** copy the base of a `CREATE OR REPLACE FUNCTION`, and of its `ROLLBACK_*`, from the live definition after a fresh reset, never from the last `CREATE` in source (a later migration or an apply-time block may have rewritten it).

## Migration Completeness — Clean-Room Verification (MANDATORY)

**WARNING:** If code depends on a table, RPC, or enum value, that object MUST be created by a committed migration — not a manual SQL or studio statement, a seed file, or something "already in the local database". CI replays every migration from an empty volume; a local stack does not. A local stack reuses its existing volume and drifts: hand-patched objects keep local tests green while CI fails.

**Before claiming a phase that adds or changes schema is done:**

1. Run the completeness check (wired into the pre-PR gate) — it catches an unapplied migration, not an incomplete one.
2. Run the integration tests that exercise the new object against a just-reset database, then the integration runner. A green run before a reset proves nothing.
3. Any raw DDL run locally is captured in a migration in the same session, before the next test.
4. Recreating a view or function (drop, then create) re-adds every grant in the same migration — recreation drops the access-control list.

## Data Integrity Principles

**Allowlists for enumerable inputs:** transaction types, status transitions, currencies are validated against an explicit allowlist before touching the database.

**RETURNING id for multi-step SQL:** INSERT-then-UPDATE uses `RETURNING id INTO v_row_id`. Append-only tables (any table whose trigger blocks UPDATE) reject UPDATE — compute derived columns first and include them in the INSERT.

**Lock before check (TOCTOU):** read-then-write on shared state takes `SELECT ... FOR UPDATE` before the check; an idempotent-replay lookup happens under that lock, not before it.

**Compare-and-set counts rows:** a conditional `UPDATE ... WHERE <expected state>` that gates value or a state transition checks the affected-row count; zero rows is a refusal, never success. A state change and its audit row are one statement or one transaction.

**Consistent lock ordering:** multi-row locks are taken in a deterministic order independent of caller input. Example: a two-party settlement credit locks both balance rows in ascending party id before the first leg.

**Minimize lock hold time:** merge mutations to the same row into one statement.

**Atomic one-time-use:** consume tokens or codes with `UPDATE ... WHERE consumed_at IS NULL RETURNING *`.

**NULL-safe guards:** `NOT IN`, `<>`, `IF NOT`, `->>` comparisons and CHECK conjunctions over a nullable value use `IS DISTINCT FROM` or `COALESCE`; a NULL version, role, key or JSON null is a refusal. `NULL + n` is NULL — `COALESCE` every term of a value sum.

**NaN is a number to the database:** a positivity CHECK admits NaN (NaN orders above every number), so every non-generated numeric column in the schema also carries `col <> 'NaN'::numeric`. A catalog sweep across every non-platform schema fails a column without one.

**A per-unit savepoint rolls back every leg of that unit on any leg failure; an inner per-leg handler that swallows an error inside a multi-leg unit is a defect.**

**Erasure is complete or refused:** an erasure classifies every account-keyed table (scrub or retain under a recorded decision), scrubs regardless of row status, locks before checking preconditions, refuses while any value state is non-terminal, and leaves no write path to the erased account.

**Custom authentication does not reference the platform's auth schema:** the account tables are the project's own; foreign keys point at them. A reference to the platform auth schema is a dead legacy pattern, not an example to copy.

## Migration Principles

**TTL for all append-only dedup and audit tables** (idempotency keys, processed event IDs): add a scheduled cleanup job.

**Scheduled-job calls MUST be guarded.** A bare schedule call breaks a clean reset. Three requirements: (1) an extension-existence guard; (2) a job-existence guard around the unschedule call, because unscheduling a missing job raises, and the extension is created on the reset path, so the extension guard alone is not enough; (3) a named inner dollar-quote tag — an inner `$$` closes the outer body early.

Scheduled-job callers use the signed, single-use ticket route (see the security rules); never put a service key in headers or in a configuration row.

**Set-based over row-by-row:** batch scans and scheduled jobs use set-based statements (a CTE over the eligible rows with `FOR UPDATE SKIP LOCKED`, then one UPDATE from it), not a loop that calls a function per row.

**One bad row never stops a batch:** where per-row work can fail (a value credit, an erasure), a failing row is isolated (a per-row exception block, or a failure marker) and leaves the selection so it cannot starve the batch behind it; order by a column that advances; count only work that finished.

**Procedural-language first-execution traps:**
- A multi-column `SELECT ... INTO` a row-typed variable assigns by POSITION. Allowed: `SELECT *` or `RETURNING *` from that SAME single table into its own row type, any column list into an untyped record, or one scalar variable per column. Never a named-column list, a join, or another table's `*` into a row-typed variable.
- A format placeholder needs one argument per placeholder (a doubled marker for a literal); an unmatched one fails the function's creation and breaks the reset for that branch.
- Aliases from an `UPDATE ... FROM` or an outer loop are not in scope in a later statement.

**INSERT idempotency:** `INSERT ... ON CONFLICT (key) DO NOTHING` (or `DO UPDATE`), never `IF NOT EXISTS (SELECT …) THEN INSERT`. A unique-violation handler applies the same binding checks as the main path.

**Index-friendly predicates:** never wrap an indexed column in a function in WHERE (`DATE(created_at)`, `LOWER(email)`) — use ranges or an expression index.
