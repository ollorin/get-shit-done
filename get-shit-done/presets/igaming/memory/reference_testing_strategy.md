---
name: testing-strategy-unit-integration-e2e-split
description: "Unit + API integration tests run in CI; UI E2E tests are local-only (flaky in CI, slow, better for manual QA)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 66bd0822-38d0-4737-a4dd-fbc643115868
---

## Test types

- **Unit tests**: `functions/*_test.ts` — run in CI (fast, isolated, reliable)
- **API integration tests**: `functions/__tests__/*.integration.test.ts` — run in CI (full auth flow, sessions, etc.)
- **UI E2E tests**: `apps/*-e2e/` — LOCAL ONLY (flaky in CI: timing issues, browser dependencies; slow: full browser + app + backend stack; better for manual QA — API integration tests already cover critical backend logic)

## CI commands

```bash
deno task test      # Unit + integration tests (API)
deno task test:ci   # Unit tests only (quick checks)
```

Superseded for the "run everything before a PR" step by `scripts/preflight.sh` (see
`.claude/rules/pre-pr-quality-gates.md`) — that script is now the canonical pre-PR gate, not a
manual command list.
