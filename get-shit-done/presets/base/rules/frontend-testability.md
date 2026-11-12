# Frontend Testability

Applies to every user-interface component. Gated: deployed only when the profile's `stack.capabilities.web_ui` is an object. The frontend directories are `stack.paths.frontends`.

## Runtime Boundaries

- Validate realtime and API payloads at runtime before use — a TypeScript cast is not a check.
- Every fetch has a timeout; every timer, subscription and notifier is disposed on unmount.
- Effects key on change identity, not value truthiness; form coercion never turns an untouched field into `0`, and unparseable JSON is an error, never `{}`.
- An idempotency key is generated once per logical submit and reused on retry, never per click.
- Hidden state that changes an action's outcome (pending erasure, active hold) is shown before the action.

## Testability Contract

Every UI component that represents an **application state** (loading, success, error, pending, empty) MUST have a `data-testid` attribute on the state-bearing element before the component is considered done.

**Naming convention:** `{component}-{state}` e.g. `transfer-status-banner`, `transfer-submit-error`, `balance-card-usd`, `pending-banner`

**Status transitions:** Use `data-{name}={value}` attributes for browser-driver assertions instead of relying on text content:
```jsx
// ❌ BAD: No testid, hard to target in E2E
<div className="error">Transaction failed</div>

// ✅ GOOD: Testid + data attribute
<div data-testid="transaction-status-error" data-status="failed">
  Transaction failed
</div>
```

Testids are mandatory before a component ships. If you need to E2E test an existing component and it lacks testids, add them first as part of the task.

## Three UI States, Not Two

Every user-facing data component has three states: unauthenticated, authenticated-empty, and authenticated-with-data. Collapsing the first two into one "empty" state produces broken UX (frozen timers, blank sections, forms that 401 on submit). Check `!player` before checking `!data`.

## Headless UI Library Constraints

Some headless select libraries reject an empty string as an item value. More broadly: headless component libraries enforce stricter contracts than native HTML. When using any headless select, combobox or radio component, verify the library's value constraints — never assume HTML behavior.

## Test Assertions on Growing Collections

Never assert exact `.length` on collections that grow when features are added (endpoint groups, role lists, enum sets). Assert membership (`includes`) or minimum count (`>=`). Exact counts break silently in unrelated PRs.
