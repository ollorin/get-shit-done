# Handler Correctness

Applies to every request handler, background worker and webhook receiver. Gated: deployed only when the profile's `stack.capabilities.backend` is an object. Rules name no platform; the profile names the stack.

## Handler Correctness Principles

**Security completeness:** A handler with partial security gates is effectively unsecured — a missing gate bypasses all subsequent ones. Every verification mechanism (auth, signature, field validation, rate limit) must be present before any handler ships, and every new route ships a no-token refusal test.

**Gates fail closed:** every security- or value-gating read treats a returned `error`, an absent value, NULL, an unknown status or a literal default as DENY. Status gates are allow-lists, never deny-lists (a new status must not pass by default). A config whose absence changes a security property refuses at boot outside an explicit test-env set.

**Outage is not an answer:** a dependency fault or timeout and a domain refusal are distinct typed outcomes. An outage maps to 503 — never to "expired", "not configured", "no second factor", `allowed: true`, or a zeroed 200.

**Outcome-unknown is possibly-committed:** every network call has a deadline. After a timeout or ambiguous write or dispatch, no refund, reserve release, fallback provider or auto-expiry runs until a definitive outcome is recorded; a retry reuses the persisted idempotency key.

**One auth gate, every path:** account-status and second-factor checks live in one shared module called by every session-minting path (password, second factor, phone, social, magic link, refresh). Credential proof precedes any account-state disclosure; send and verify share one account-level attempt cap; a status that forbids login revokes live sessions. Unauthenticated routes throttle per source resolved from trusted proxy hops — never a client-writable header or one global bucket.

**One owner per primitive:** an allow-list, predicate, codec, cache-key builder, or pinned constant has one module; other layers import it, and a server and client twin shares a parity test. Validators, service types, and client unions derive from the database enum.

**Cache never decides safety or value:** safety-gate and value reads bypass cache tiers; an invalidation deletes the key built by the reader's own key function (asserted in a test); no key-scanning command in request or warmer paths.

**Monetary values:** amounts cross the application and database boundary as decimal strings at the storing column's precision, never JS numbers; currency is resolved, never a literal or default; rounding direction is chosen per ledger side; a bound is computed at the same precision as the value it caps; rounding never loosens a protective limit; reuse the existing quantisation check and test 9 decimal places and 16 significant digits.

**Third-party shapes are traced, not invented:** a webhook or vendor payload parser and its fixtures are built from the vendor's documented example; every remote procedure name resolves to a migration that creates it.

**Every value event has a consumer:** a durable value-state event names its consumer; a critical alert goes through the alert transport and a test asserts it leaves the process (`console.error` is not an alert).

**Manual value movement is four-eyes:** an operator credit or debit is filed by one operator and applied by another (`SELF_APPROVAL_FORBIDDEN`), authority is re-derived at apply time, and the policy that bounds it is a config key held in the database and its code mirror, never a plain role flag.

**Test seams stay out of production:** test doubles and seams are never exported from production barrels; a bypass flag keys on an explicit test env name.

**Constant-time secret comparison:** Any comparison involving secrets, signatures, or tokens must not short-circuit on length. Length difference must fold into the accumulator; the loop must always run to `maxLen`.

**Required fields over synthetic fallbacks:** Never generate IDs, timestamps, or correlation keys from server state when the caller should supply them. Synthesized values defeat replay protection and deduplication.

**Encrypt-at-rest consistently:** Any column named `*_encrypted` must store ciphertext via the established AES-GCM pattern — never raw bytes — and a test proves a written row is not the plaintext. Secrets and keys are validated before first use (non-empty, length floor measured in bytes, not UTF-16 units); a credential never sits in a public-prefixed env name (a prefix the frontend build inlines).

**Acquire local state before external calls:** In multi-step flows with external side effects, acquire all local locks and reservations before any irreversible external call. An external call that succeeds but finds local state not yet reserved creates an unrecoverable inconsistency.

**Idempotency is a cross-cutting concern:** Every mutation path needs idempotency handling, not just the primary/happy path. A replay lookup binds the authenticated principal and every request field that identifies the operation, reads the ledger under the row lock (never a fail-open cache), and a key alone never selects a row.

**Surface all partial failures:** In a multi-step operation, if step N succeeds but step N+1 fails, return an error — never swallow it as non-fatal. Swallowed failures in value flows corrupt ledger state silently.

**Independent operations in parallel:** Use `Promise.all` for independent database queries or adapter calls. Sequential `await` in a loop is a latency multiplier with no correctness benefit.

**Shared resources as singletons:** Expensive-to-create clients (database connections, HTTP clients) must be module-level singletons, not per-request instances.

**Multi-step side-effect atomicity:** When a handler produces side effects in two systems (external storage + database, charge + ledger record, send + mark-sent), both must commit or neither should be visible. If the second write fails, undo or clean up the first before returning an error. A handler that reports success after only one side of a two-phase write has committed leaves the systems in permanently inconsistent state.

**Handler boundary validation completeness:** Every entry point in a handler file must validate its inputs — path params, query params, body fields — for type, length and the storing column's range, before any database or external call; invalid input is a 400, never a 500; a NUL, surrogate, length or scale check added at one site goes to every sibling handler and service (record the sweep query). The unit of enforcement is the file, not the function: one unvalidated entry point in a file where every other entry point validates is effectively ungated. Apply whatever validation pattern already exists in the file; don't introduce a gap.

**Data export sanitization:** Any serialization path that produces user-ingestible data formats (CSV, TSV, spreadsheet) must neutralize formula-injection characters before writing cell values. A raw database value in a spreadsheet cell is a potential code-execution vector for whoever opens the file. Adapters HTML-escape interpolated values.

**Cache/key component sanitization:** Cache keys, queue keys, or namespace keys that incorporate external or user-controlled values must use the same sanitized form used for logging and auditing — never the raw value. Unsanitized separators or special characters in key components create namespace collisions and cross-tenant leakage.

**Error message hygiene:** Error messages returned to callers and written to logs must not include internal metrics or system details — sizes, lengths, counts, internal IDs, stack traces, credentials. Use fixed descriptive strings and stable codes; classify errors on codes or prefixes, never substring `includes`. Caller faults are 4xx, server faults 5xx; a deterministic webhook failure is terminal, only a transient one is retryable.

**Allow-list projections:** a response, broadcast or log of secret-bearing state is built from named fields, never a spread or deny-list; a value from which a secret can be derived (a random-number seed) is itself secret.

**Database and RPC error messages must never reach response bodies:**

`error.message` from a database client call often contains raw SQL, table names, constraint names, or internal state. These must be logged server-side and replaced with a generic string before returning to the caller:

```typescript
// ❌ WRONG — leaks SQL internals to caller
return createErrorResponse(500, error.message);

// ✅ CORRECT — log real error, return generic string
console.error('[my-function] DB error:', error);
return createErrorResponse(500, 'An internal error occurred');
```

Auth error responses may use user-friendly messages (`"Invalid credentials"`, `"Session expired"`) but must never echo raw database errors. The rule is: if the string came from `error.message` on a database or RPC call, it must not go into the response.

**OPTIONS pre-flight responses MUST include CORS headers:**

A bare `new Response(null, { status: 204 })` on an OPTIONS handler breaks browser pre-flight for all cross-origin callers. Always use the project's CORS-header helper, given the request:

```typescript
// ❌ WRONG — browser pre-flight fails, all cross-origin calls blocked
if (req.method === 'OPTIONS') {
  return new Response(null, { status: 204 });
}

// ✅ CORRECT
if (req.method === 'OPTIONS') {
  return new Response(null, { status: 204, headers: getCorsHeaders(req) });
}
```

**Realtime and notification fan-out is never awaited on the request path:** the commit happens first; the broadcast after it is a non-critical notification. A realtime subscription can hang in test environments, so a request that awaits it can hang with it.
## Status codes: the two failures are different and must not share one

| Condition | Status | Why |
| --- | --- | --- |
| Expected key unset or empty | **503** | The caller is not the problem. The process cannot authenticate *anyone*, including the legitimate internal caller, so `401 Unauthorized` misattributes a server misconfiguration to the caller and invites a retry storm against a deployment that can never succeed. The proxy-trust gate refuses the same way at boot. |
| Expected key set, presented key wrong or absent | **401** | This really is an unauthenticated caller. |

Both refusals happen before any database access or state mutation. `constantTimeEquals` means no future caller reaches `0 ^ 0` even if it forgets the environment check; the call-site check means a misconfigured deployment is refused before any comparison happens. Keep both.

**Note on the presented key:** the Fetch `Headers` type strips trailing whitespace, so `Authorization: 'Bearer '` arrives as the 6-character string `"Bearer"`, not as an empty bearer.

**No fire-and-forget async result:** every async result created must be awaited, chained, or returned. An orphaned call with no `await` or chain silently drops errors — the operation's outcome becomes invisible to the caller, so mutations to shared state (cache entries, database rows, external resources) succeed or fail with no signal either way.
