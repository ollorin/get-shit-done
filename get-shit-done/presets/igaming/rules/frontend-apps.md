---
paths:
  - "apps/player-web/**"
  - "apps/operator-web/**"
---

# Frontend Apps Rules

## Quick Start

```bash
npx nx dev player-web    # Player app
npx nx dev operator-web  # Operator app
```

## E2E Testing

```bash
npx nx e2e player-web-e2e   # Player E2E (local only)
npx nx e2e operator-web-e2e # Operator E2E (local only)
```

**Note:** E2E tests are LOCAL ONLY - not run in CI due to flakiness.

## Shared Patterns

Both player-web and operator-web share:
- Next.js framework
- Common testing approach
- Similar directory structure
- **Money display: render through `formatMoney(value, currency, minorUnit)` with the row's currency and the API's registry minor unit; no literal currency symbol, no hard-coded decimals, never a total across currencies.**

## Runtime Boundaries

- Validate realtime and API payloads at runtime before use — a TypeScript cast is not a check.
- Every fetch has a timeout; every timer, subscription and notifier is disposed on unmount.
- Effects key on change identity, not value truthiness; form coercion (`z.coerce`) never turns an untouched field into `0`, and unparseable JSON is an error, never `{}`.
- An idempotency key is generated once per logical submit and reused on retry, never per click.
- Hidden state that changes an action's outcome (pending erasure, active hold) is shown before the action.

## Testability Contract

Every UI component that represents an **application state** (loading, success, error, pending, empty) MUST have a `data-testid` attribute on the state-bearing element before the component is considered done.

**Naming convention:** `{component}-{state}` e.g. `deposit-status-banner`, `deposit-submit-error`, `balance-card-usd`, `withdrawal-pending-banner`

**Status transitions:** Use `data-{name}={value}` attributes for Playwright assertions instead of relying on text content:
```jsx
// ❌ BAD: No testid, hard to target in E2E
<div className="error">Transaction failed</div>

// ✅ GOOD: Testid + data attribute
<div data-testid="transaction-status-error" data-status="failed">
  Transaction failed
</div>
```

Testids are mandatory before a component ships. If you need to E2E test an existing component and it lacks testids, add them first as part of the task.

## Domain Type Alignment

Status sets, enum values, and terminal/valid-state collections in the frontend MUST derive from or explicitly reference the canonical domain types in `apps/api/libs/domain/src/lib/*/`. Do not define them independently.

When the frontend type is a `Set<DomainStatusType>` or similar typed collection, the TypeScript compiler catches stale or invalid values at build time. Without this, a wrong or missing value causes silent behavioral failures — polling loops that never terminate, subscriptions that never close, UI that never transitions out of a loading state.

## Realtime Auth in Frontend

`RealtimeContext.tsx` handles two distinct auth tokens — mixing them up causes silent 401 failures:

- **Session token** (from `CustomAuthClient.getAuthHeaders()`): Used for ALL HTTP requests, including `/realtime/catchup/*` endpoints. This is the opaque UUID session token, held in memory only — never `localStorage`.
- **Realtime JWT** (from in-memory `realtimeToken`, or fetched via `/realtime/token`): Used ONLY for Supabase Realtime WebSocket channel subscriptions. Also held in memory only; see `docs/authentication.md`'s HttpOnly Session Cookies section.

**Common bug:** Passing `Bearer ${realtimeToken}` to `fetchCatchUpDomains()`. Catch-up endpoints use session-based auth middleware, not JWT verification. Always use `CustomAuthClient.getAuthHeaders()` for HTTP fetch calls inside `RealtimeContext`.

## Dependency Management

**Before writing an import, verify the package is in `package.json`.**

```bash
# Check
grep '"@dnd-kit/core"' apps/operator-web/package.json

# Add if missing (runs install automatically)
pnpm --filter @org/operator-web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

New import not in `package.json` → build silently works locally (hoisting) but **fails in CI**. Always install first, then import.

## Three UI States, Not Two

Every player-facing data component has three states: unauthenticated, authenticated-empty, and authenticated-with-data. Collapsing the first two into one "empty" state produces broken UX (frozen timers, blank sections, forms that 401 on submit). Check `!player` before checking `!data`.

## Headless UI Library Constraints

Radix UI `Select.Item` rejects empty string values. More broadly: headless component libraries enforce stricter contracts than native HTML. When using any headless `<Select>`, `<Combobox>`, or `<Radio>` component, verify the library's value constraints — never assume HTML behavior.

## Test Assertions on Growing Collections

Never assert exact `.length` on collections that grow when features are added (endpoint groups, role lists, enum sets). Assert membership (`includes`) or minimum count (`>=`). Exact counts break silently in unrelated PRs.
