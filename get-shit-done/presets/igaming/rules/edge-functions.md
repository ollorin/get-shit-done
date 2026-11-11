---
paths:
  - "apps/api/functions/**"
  - "apps/api/libs/**"
---

# Edge Functions Rules

## Workspace Imports

Use workspace imports for all shared code:
- `@igaming/domain` - Domain entities and types
- `@igaming/application` - Business logic and use cases
- `@igaming/infrastructure` - External service integration
- `@igaming/rng` - Provably fair RNG algorithms

Never use relative paths to libs. Always use `@igaming/*` bare specifiers.

## New Function Workspace Registration

**CRITICAL:** Every new edge function MUST be added to the `"workspace"` array in `apps/api/deno.json`. Without this, `supabase functions serve` in CI cannot resolve `@igaming/*` bare specifiers transitively — causing BOOT_ERROR / WORKER_ERROR on ALL functions (not just the new one).

```jsonc
// apps/api/deno.json
{
  "workspace": [
    "./libs/domain",
    "./libs/application",
    "./libs/infrastructure",
    "./libs/rng",
    // ... existing functions ...
    "./functions/your-new-function"   // ← ADD THIS
  ]
}
```

Also create `functions/your-new-function/deno.json`:
```json
{
  "importMap": "../import_map.json"
}
```

Both steps are required. Missing either causes silent CI failures.

## CI Import Map — ONE Source of Truth (generated, never hand-edited)

**CRITICAL:** `apps/api/functions/import_map.json` is a GENERATED artifact — never hand-edit it, and never hand-copy it into a workflow. There is exactly ONE source of truth for the runtime import map: `apps/api/deno.json`'s `imports` block. When you add a new `@igaming/*` workspace import, add it there and regenerate.

**How to add a new import:**

1. Add the entry to `apps/api/deno.json`'s `imports` block using a repo-root-relative `./libs/...` path (same as every other `@igaming/*` entry there).
2. Regenerate the runtime map:
   ```bash
   deno run --allow-read --allow-write scripts/gen-import-map.ts
   ```
   This reads `deno.json`'s `imports`, strips the two docs-only keys (`@std/front-matter`, `@std/yaml`), rewrites each `./libs/` prefix to `../libs/` (the map lives one directory below `deno.json`), and writes `apps/api/functions/import_map.json`.
3. Commit both files together.

**The drift gate:** `scripts/gen-import-map.ts --check` regenerates in memory and fails (exit 1) if the committed `import_map.json` is stale relative to `deno.json`. It runs in THREE places, so a stale map can never reach production:

- `.github/workflows/pr-validation.yml` (backend-unit-tests job) — "Check import-map freshness"
- `.github/workflows/deploy-staging.yml` (deploy-functions job) — "Check import-map freshness"
- `scripts/preflight.sh` (`run_backend_checks`) — before any Docker/Supabase stack starts

**No more hand-copied heredocs:** CI workflows no longer write their own `import_map.json`. The Docker edge runtime needs paths relative to `supabase/functions/` (where files are copied), and the committed `apps/api/functions/import_map.json` already has exactly those `../libs/...` paths — the workflows' `cp -r functions supabase/functions` step carries the generated file verbatim. Unit-test the transform via `scripts/gen-import-map.test.ts`.

## Middleware Pattern

Edge Functions use `security/middleware.ts` for:
- Unified session validation
- CORS hardening
- Input sanitization

See `docs/development/backend-architecture.md` for architecture details.

## Per-Function deno.json

**CRITICAL:** Never use `"imports": {}` in a function's `deno.json` — an empty imports block overrides the outer `import_map.json` and silently breaks ALL `@igaming/*` and `@supabase/*` imports at boot (BOOT_ERROR / WORKER_ERROR).

Correct pattern for any function that has its own `deno.json`:
```json
{
  "importMap": "../import_map.json",
  "tasks": {
    "test": "deno test --allow-all --import-map=../import_map.json ."
  }
}
```

If you need function-local import overrides, merge them into `functions/import_map.json` instead.

## New Function Checklist

**CRITICAL:** Every new edge function must have `verify_jwt = false` added to `apps/api/supabase/config.toml` — the platform uses custom session tokens, not Supabase JWTs, so the edge runtime must not reject requests at the gateway level.

```toml
[functions.your-function-name]
verify_jwt = false
```

**CRITICAL:** Every `Deno.serve` entry point must be wrapped, OUTERMOST, by `withRequestBodyDrain`
from `@igaming/infrastructure` — including inside `withSentryEntrypoint`:
`Deno.serve(withRequestBodyDrain(withSentryEntrypoint(...)))`.

Why: a `Response` returned while the request body is still unread races the runtime's proxy write
into the worker, which aborts (`user body write aborted`) and replaces the handler's correct 401/403
with a client-visible 5xx. Guard **g15** (`scripts/validation/serve-drain-guard.ts`, block mode, no
baseline) fails preflight and CI on any unwrapped site.

## Deployment

**WARNING:** Include ALL dependencies and imports in deployment files array

- Test deployment to verify no module resolution errors
- Missing imports cause silent WORKER_ERROR in production
- Verify `import_map.json` includes all workspace mappings

## Environment Variables

**WARNING:** Supabase CLI silently drops all env vars with the `SUPABASE_` prefix from edge function runtime. If your function needs a value that starts with `SUPABASE_`, alias it under a different name in `config.toml`:

```toml
[edge_runtime.secrets]
# SUPABASE_JWT_SECRET won't work — CLI strips it silently
REALTIME_JWT_<redacted:assigned_secret>"
```

This applies to local dev (`supabase functions serve`) and deployed functions. There is no error or warning — the variable is simply absent at runtime, causing silent failures (e.g., JWT verification returns invalid, middleware returns 401).

**WARNING:** NO `.env.production` in production - Configure in Supabase/Vercel dashboards

- `.env.production` is for local testing only
- Production secrets go in dashboard environment settings

**Webhook handlers must return 200 for all cases except invalid signatures** — returning 4xx for missing/stale timestamps exposes rejection criteria to callers and triggers retry storms from processors that omit optional fields.

## Non-Public Schema RPC Calls

**WARNING:** `supabase.rpc('fn_name')` always targets the `public` schema. Calling an RPC that lives in a non-public schema (e.g., `kyc`, `wallet`, `payments`) without a schema qualifier silently fails with PGRST202 or 42883.

**ALWAYS use `supabase.schema('myschema' as never).rpc(...)` for non-public schemas:**

```typescript
// ❌ WRONG — defaults to public schema, PostgREST returns 42883
await supabase.rpc('kyc_get_player_status', { p_player_id: id })

// ✅ CORRECT — sends Content-Profile: kyc header to PostgREST
await supabase.schema('kyc' as never).rpc('kyc_get_player_status', { p_player_id: id })
```

The `as never` cast is required because the Supabase TypeScript client types only include the `public` schema in their generics. It is not a type error workaround — it is the correct usage for non-public schemas.

This applies to all three call types:
- `.rpc('fn_name', params)` — RPCs in non-public schemas
- `.from('table_name').select()` — tables directly exposed in non-public schemas (rare; prefer public views)

**Cross-reference:** Before using schema-qualified calls, also ensure the schema is registered in `config.toml` and has `GRANT USAGE` — see the "New PostgreSQL Schema Checklist" in `database.md`.

## Operator Auth in Edge Functions

Operator endpoints use `handleOperatorSecureRequest()` from `middleware.ts`, NOT the player `handleSecureRequest()`.

```typescript
// ✅ CORRECT: Operator endpoint with role-based access
import { handleOperatorSecureRequest } from '@igaming/infrastructure'

// In the serve() router:
if (method === 'POST') {
  return handleOperatorSecureRequest(req, 'payment-operations', 'write', handler)
}
if (method === 'GET') {
  return handleOperatorSecureRequest(req, 'payment-operations', 'read', handler)
}

// ❌ WRONG: Using player auth for operator endpoints (returns 401 for operator tokens)
return handleSecureRequest(req, handler, AuthMode.ADMIN_REQUIRED)
```

**Endpoint groups** (must match `EndpointGroup` type in `role-permissions.ts`):
`operator-management`, `games-crud`, `configurations`, `payment-operations`, `payment-processors`, `wallet-management`, `kyc-operations`, `responsible-gaming`, `player-management`, `audit-log`, `rg-risk-alerts`

**Access levels**: `'write'` (full CRUD) or `'read'` (read-only). The `ROLE_PERMISSION_MAP` in `role-permissions.ts` is the single source of truth.

**Both GET and mutation routes** on operator endpoints must use `handleOperatorSecureRequest`. Using `handleSecureRequest` for GET routes causes operator tokens to be rejected as unknown.

## Realtime Endpoint Auth Contract

The realtime system has two distinct token types. Using the wrong one returns 401 silently.

| Endpoint pattern | Auth token | Purpose |
| --- | --- | --- |
| `/realtime/token` | Session token (`Authorization: Bearer <sessionToken>`) | Issues a scoped realtime JWT |
| `/realtime/catchup/*` | Session token (`Authorization: Bearer <sessionToken>`) | Fetch missed events on reconnect |
| WebSocket subscribe | Realtime JWT (from `/realtime/token`, held in memory only on player-web/operator-web — never `localStorage`) | Authenticate Supabase Realtime channel |
| `/realtime/velocity-notify` | Service role key | Internal server-to-server call |

**Common mistake:** Using the realtime JWT for catch-up HTTP endpoints. Catch-up endpoints validate the session token (opaque UUID) via middleware, not the realtime JWT. The realtime JWT is ONLY for WebSocket channel authentication.

Frontend `RealtimeContext` must use `CustomAuthClient.getAuthHeaders()` (which returns the session token) for all HTTP fetch calls, and only use the realtime JWT for Supabase channel subscriptions.

## Handler Correctness Principles

**Security completeness:** A handler with partial security gates is effectively unsecured — a missing gate bypasses all subsequent ones. Every verification mechanism (auth, signature, field validation, rate limit) must be present before any handler ships, and every new route ships a no-token refusal test.

**Gates fail closed:** every security- or money-gating read treats a returned `error`, an absent value, NULL, an unknown status or a literal default as DENY. Status gates are allow-lists, never deny-lists (a new status must not pass by default). A config whose absence changes a security property refuses at boot outside an explicit test-env set.

**Outage is not an answer:** a dependency fault or timeout and a domain refusal are distinct typed outcomes. An outage maps to 503 — never to "expired", "not configured", "no 2FA", `allowed: true`, or a zeroed 200.

**Outcome-unknown is possibly-committed:** every network call has a deadline. After a timeout or ambiguous write/dispatch, no refund, reserve release, fallback processor, or auto-expiry runs until a definitive outcome is recorded; a retry reuses the persisted idempotency key.

**One auth gate, every path:** account-status and second-factor checks live in one shared module called by every session-minting path (password, 2FA, phone, social, magic link, refresh). Credential proof precedes any account-state disclosure; send and verify share one account-level attempt cap; a status that forbids login revokes live sessions. Unauthenticated routes throttle per source resolved from trusted proxy hops — never a client-writable header or one global bucket.

**One owner per primitive:** an allowlist, predicate, codec, cache-key builder, or pinned constant has one module; other layers import it, and a TS/SQL twin shares a parity test. Validators, service types, and client unions derive from the DB enum.

**Cache never decides safety or money:** safety-gate and money reads bypass cache tiers; an invalidation deletes the key built by the reader's own key function (asserted in a test); no `SCAN`/`KEYS` in request or warmer paths.

**Money values:** amounts cross TS↔SQL as decimal strings at the storing column's precision, never JS numbers; currency is resolved, never a literal or default; rounding direction is chosen per ledger side; a bound is computed at the same precision as the value it caps; rounding never loosens a protective limit; reuse the existing quantisation check and test 9 dp and 16 significant digits.

**Third-party shapes are traced, not invented:** a webhook/vendor payload parser and its fixtures are built from the vendor's documented example; every `rpc()` name resolves to a migration `CREATE`.

**Every money event has a consumer:** a durable money-state event names its consumer; a critical alert goes through the alert transport and a test asserts it leaves the process (`console.error` is not an alert).

**Manual money movement is four-eyes:** an operator credit or debit is filed by one operator and applied by another (`SELF_APPROVAL_FORBIDDEN`), authority is re-derived at apply time, and the policy that bounds it is a money-config key (`is_money_config_key` and its TS mirror), never a plain RBAC write flag.

**Test seams stay out of production:** test doubles and seams are never exported from production barrels; a bypass flag keys on an explicit test env name.

**Constant-time secret comparison:** Any comparison involving secrets, signatures, or tokens must not short-circuit on length. Length difference must fold into the accumulator; the loop must always run to `maxLen`.

**Required fields over synthetic fallbacks:** Never generate IDs, timestamps, or correlation keys from server state when the caller should supply them. Synthesized values defeat replay protection and deduplication.

**Encrypt-at-rest consistently:** Any column named `*_encrypted` must store ciphertext via the established AES-GCM pattern — never raw bytes — and a test proves a written row is not the plaintext. Secrets and keys are validated before first use (non-empty, length floor measured in bytes, not UTF-16 units); a credential never sits in a public-prefixed env name (`NEXT_PUBLIC_*`).

**Acquire local state before external calls:** In multi-step flows with external side effects, acquire all local locks and reservations before any irreversible external call. An external call that succeeds but finds local state not yet reserved creates an unrecoverable inconsistency.

**Idempotency is a cross-cutting concern:** Every mutation path needs idempotency handling, not just the primary/happy path. A replay lookup binds the authenticated principal and every request field that identifies the operation, reads the ledger under the row lock (never a fail-open cache), and a key alone never selects a row.

**Surface all partial failures:** In a multi-step operation, if step N succeeds but step N+1 fails, return an error — never swallow it as non-fatal. Swallowed failures in financial flows corrupt ledger state silently.

**Independent operations in parallel:** Use `Promise.all` for independent DB queries or adapter calls. Sequential `await` in a loop is a latency multiplier with no correctness benefit.

**Shared resources as singletons:** Expensive-to-create clients (DB connections, HTTP clients) must be module-level singletons, not per-request instances.

**Multi-step side-effect atomicity:** When a handler produces side effects in two systems (external storage + database, charge + ledger record, send + mark-sent), both must commit or neither should be visible. If the second write fails, undo or clean up the first before returning an error. A handler that reports success after only one side of a two-phase write has committed leaves the systems in permanently inconsistent state.

**Handler boundary validation completeness:** Every entry point in a handler file must validate its inputs — path params, query params, body fields — for type, length and the storing column's range, before any database or external call; invalid input is a 400, never a 500; a NUL/surrogate/length/scale check added at one site goes to every sibling handler and service (record the sweep query). The unit of enforcement is the file, not the function: one unvalidated entry point in a file where every other entry point validates is effectively ungated. Apply whatever validation pattern already exists in the file; don't introduce a gap.

**Data export sanitization:** Any serialization path that produces user-ingestible data formats (CSV, TSV, spreadsheet) must neutralize formula-injection characters before writing cell values. A raw database value in a spreadsheet cell is a potential code-execution vector for whoever opens the file. Adapters HTML-escape interpolated values.

**Cache/key component sanitization:** Cache keys, queue keys, or namespace keys that incorporate external or user-controlled values must use the same sanitized form used for logging and auditing — never the raw value. Unsanitized separators or special characters in key components create namespace collisions and cross-tenant leakage.

**Error message hygiene:** Error messages returned to callers and written to logs must not include internal metrics or system details — sizes, lengths, counts, internal IDs, stack traces, credentials. Use fixed descriptive strings and stable codes; classify errors on codes/prefixes, never substring `includes`. Caller faults are 4xx, server faults 5xx; a deterministic webhook failure is terminal, only a transient one is retryable.

**Allow-list projections:** a response, broadcast or log of secret-bearing state is built from named fields, never a spread or deny-list; a value from which a secret can be derived (an RNG seed) is itself secret.

**DB/RPC error messages must never reach response bodies:**

`error.message` from a Supabase/PostgREST call often contains raw SQL, table names, constraint names, or internal state. These must be logged server-side and replaced with a generic string before returning to the caller:

```typescript
// ❌ WRONG — leaks SQL internals to caller
return createErrorResponse(500, error.message);

// ✅ CORRECT — log real error, return generic string
console.error('[my-function] DB error:', error);
return createErrorResponse(500, 'An internal error occurred');
```

Auth error responses may use user-friendly messages (`"Invalid credentials"`, `"Session expired"`) but must never echo raw DB errors. The rule is: if the string came from `error.message` on a DB/RPC call, it must not go into the response.

**OPTIONS preflight responses MUST include CORS headers:**

A bare `new Response(null, { status: 204 })` on an OPTIONS handler breaks browser preflight for all cross-origin callers. Always use `getCorsHeaders(req)`:

```typescript
// ❌ WRONG — browser preflight fails, all cross-origin calls blocked
if (req.method === 'OPTIONS') {
  return new Response(null, { status: 204 });
}

// ✅ CORRECT
if (req.method === 'OPTIONS') {
  return new Response(null, { status: 204, headers: getCorsHeaders(req) });
}
```

**Service-role-only endpoints MUST validate the service role key before any business logic:**

Internal endpoints (e.g., cron workers, crash-recovery jobs) that should only be callable by the server must authenticate the caller before doing any work:

**Never hand-roll a constant-time comparison.** Import the ONE shared helper — this is the
defect class's propagation mechanism, so a second inline copy re-creates the bug:

```typescript
import { constantTimeEquals } from '@igaming/infrastructure';
```

Source of truth: `apps/api/libs/infrastructure/src/lib/security/constant-time.ts`. It refuses on an EMPTY side, seeds the accumulator with the
LENGTH DIFFERENCE, and folds to `maxLen` reading out-of-range as `0` — three properties a
paraphrase will drop. It accepts `string | Uint8Array` so a caller with pre-encoded bytes
(2FA codes) passes them directly.

**The routed set is not the whole repo.** `constant-time-routed-sites.test.ts` (same directory)
fails any module in its `ROUTED` list that defines its own fold or compares two non-literal
values with `===`/`!==`/`==`/`!=` — a shape check, so renaming or aliasing an operand does not
evade it; its false-positive budget and limits are enumerated in that file's header.
`functions/payments/handlers/handle-webhook.ts` still carries a local `timingSafeEqual` fold and
is NOT in `ROUTED`; `bonus/index.ts` cannot be (its routing holds legitimate
`pathname === CONST` compares). A new inline fold anywhere is a defect.

`maxLen` vs `minLen` is provable only by the byte-read COUNT in `constant-time.test.ts` — never
"simplify" it to equal-length operands. The helper is constant-time conditional on neither operand
being empty (its empty-side refusal leaks one bit); no wall-clock timing is claimed.

```typescript
// ✅ CORRECT — the key is refused BEFORE the compare, so a misconfigured deployment
// can never be reached through a side-effect of the comparison.
export function authorize(req: Request) {
  const expectedKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (expectedKey === undefined || expectedKey === '') {
    // Log the variable NAME, never its value.
    console.error('[my-function] FATAL — refusing every request: key is unset or empty');
    return { authorized: false, status: 503, code: 'SERVICE_ROLE_KEY_UNAVAILABLE' };
  }
  const providedKey = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  return constantTimeEquals(providedKey, expectedKey)
    ? { authorized: true }
    : { authorized: false, status: 401, code: 'Unauthorized' };
}

// ❌ WRONG — no auth check, any caller can trigger internal jobs
// ... business logic directly ...

// ❌ WRONG — `?? ''` on the expected key with no guard above. Empty-vs-empty matches.
const expectedKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
```

**Both guards are load-bearing; each alone closes the exploit.** The empty-side check inside
`constantTimeEquals` means no future caller reaches `0 ^ 0` even if it forgets the environment
check; the call-site check means a misconfigured deployment is refused before any comparison
happens. Keep both.

**Status codes — the two failures are different and must not share one:**

| Condition | Status | Why |
| --- | --- | --- |
| Expected key unset or empty | **503** | The caller is not the problem. The process cannot authenticate *anyone*, including the legitimate internal caller, so `401 Unauthorized` misattributes a server misconfiguration to the caller and invites a retry storm against a deployment that can never succeed. Matches the `[TRUSTED PROXY GATE] FATAL` pattern at `libs/infrastructure/src/lib/security/trusted-proxy-source.ts:103-117`. |
| Expected key set, presented key wrong or absent | **401** | This really is an unauthenticated caller. |

Both refusals happen before any database access or state mutation.

**Note on the presented key:** `fetch` `Headers` strips trailing whitespace, so
`Authorization: 'Bearer '` arrives as the 6-char string `"Bearer"`, not as an empty bearer.
The vectors that actually produce an empty side are a **missing header** and an **empty header
value**. Test both — see `apps/api/functions/sandbox/auth-empty-bearer.test.ts`.
