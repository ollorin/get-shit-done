---
paths:
  - "apps/api/functions/**"
  - "apps/api/libs/**"
  - "apps/player-web/**"
  - "apps/operator-web/**"
  - "**/*.test.ts"
  - "**/*.spec.ts"
---

# Functional Programming Rules

## Error Handling

- Use `Result<T, E>` / `ResultAsync<T, E>` from `@igaming/domain` — never `throw` or unhandled Promise rejections
- Chain with `.andThen()`, `.map()`, `.mapErr()` — never `.unwrap()` (except in tests)
- Wrap Promise-returning code with `ResultAsync.fromPromise()` — no try/catch boundaries
- Match on errors using `.match()` + a discriminator — no `instanceof` checks. A neverthrow `Result` is discriminated with `isOk()` / `isErr()` / `.match()`; its `Ok`/`Err` carry no `_tag`. Use a `_tag` only on the project's own error unions.
- **No fire-and-forget ResultAsync:** every `ResultAsync` created must be awaited, chained, or returned. An orphaned `ResultAsync.fromPromise(...)` with no `await` or chain silently drops errors — the operation's outcome becomes invisible to the caller, so mutations to shared state (cache entries, DB rows, external resources) succeed or fail with no signal either way.
- **Read `error` before `data`:** every supabase-js `{ data, error }` is checked for `error` first; a supabase-js builder is lazy and does nothing until awaited, so lift lazily with `fromLazy` (`@igaming/domain`) rather than `fromPromise(builder)` (a sync throw inside the builder must not escape the Result). An `Err` arm never falls through to a success side effect (marking processed, reporting sent), and no write/send result is dropped before reporting success.

## Immutability

- `const` only — never `let` for values that don't change; use ternary or IIFE for conditional assignment
- No array mutations: use `[...arr].sort()`, `.filter()`, `.map()`, `.reduce()` — never `.push()`, `.splice()`, `.sort()` in place
- No object mutations: spread `{ ...obj, key: val }` — never `obj.key = val`
- No `globalThis` — extract shared values to module-level `const`

## Route Dispatching (Backend)

- Use `match([method, pathname])` with `.with()` and `.otherwise()` — no if/else or switch chains
- Import `match`, `P` from `@igaming/domain`
- All routes must be exhaustively handled via `.otherwise()` or `.exhaustive()`

**WARNING — this rule applies to every edge function without exception.** If/else chains in `serve()` bodies are a hard violation, not a style preference. Any refactor touching a function file that still uses if/else routing must convert the router as part of that PR — do not leave it for later.

**Known worst violator:** `apps/api/functions/bonus/index.ts` contains a ~200-line if/else routing chain. Any work touching the bonus function must convert this router to `match()` — do not add more branches to the if/else chain.

**WARNING — ts-pattern terminal methods:** `.otherwise()` and `.exhaustive()` are terminal — they immediately execute the match and return the value. Never call `.run()` after them; it does not exist on the result and throws at runtime.

```typescript
// ❌ WRONG — runtime crash: "run is not a function"
match([method, pathname])
  .with(['POST', '/login'], () => handleLogin())
  .otherwise(() => notFound())
  .run();

// ✅ CORRECT — .otherwise() is the final call
match([method, pathname])
  .with(['POST', '/login'], () => handleLogin())
  .otherwise(() => notFound());
```

## Functions

- Pure functions in domain and application layers — no side effects, no external state
- Extract shared logic to module-level constants and named functions — no inline closures in handlers
- Prefer `const fn = (x: T): U => ...` over function declarations with mutable internals

## Frontend (player-web / operator-web)

- Immutable state updates only — spread operators or functional `setState` — never mutate state directly
- Pure utility functions outside components — no logic embedded in JSX
- No direct DOM mutations — let React handle rendering

## Tests

- Assert Result paths explicitly: `expectOk(result)` / `expectErr(result)` — no manual `.isOk()` booleans
- Test both success and error paths for every Result-returning function
- Use `fromThrowable` to wrap third-party code at boundaries — no try/catch in test setup

## References

- FP types: `apps/api/libs/domain/src/lib/fp/` (`@igaming/domain` re-exports neverthrow + ts-pattern)
- Migration guide: `docs/development/fp-migration-guide.md`
- Testing guide: `docs/testing/fp-testing-guide.md`
