---
name: create-edge-function
description: Use when user requests new API endpoint, backend function, or HTTP handler - automatically scaffold Edge Function with middleware, types, and integration tests before writing implementation
disable-model-invocation: false
allowed-tools: Read, Write, Bash(deno *), Bash(supabase *), Glob, Grep
---

# Edge Function Scaffolding Skill

## When to Use

Trigger on tasks involving:
- Creating an API endpoint
- Adding a new Edge Function
- Scaffolding a backend handler
- Building backend business logic

## Files Created

For a function named `{name}`:

| File | Purpose |
|------|---------|
| `apps/api/functions/{name}/index.ts` | Main function handler |
| `apps/api/functions/{name}/deno.json` | Workspace imports config |
| `apps/api/functions/__tests__/{name}.integration.test.ts` | Integration tests |

## Scaffolding Steps

### 1. Create Function Directory

```bash
mkdir -p apps/api/functions/{name}
```

### 2. Apply index.ts Template

Copy template from `template/index.ts` and customize:
- Replace `{function-name}` with actual name
- Set appropriate `AuthMode` (`USER_REQUIRED`, `ADMIN_REQUIRED`, `PUBLIC_READ`, or `PUBLIC_OPTIONAL`)
- Define routes in the `match([method, pathname])` router
- Implement business logic

### 3. Create deno.json

Copy template from `template/deno.json` (no modification needed).

### 4. Create Integration Test

Use `create-integration-test` skill to generate test file with:
- Positive cases (valid requests)
- Negative cases (auth failures, validation errors)
- Edge cases (empty input, boundary values)

## Required Patterns

### Middleware Usage

All functions MUST use the middleware stack from `@igaming/infrastructure`:

```typescript
import {
  handleSecureRequest,
  createSuccessResponse,
  createErrorResponse,
  AuthMode,
} from "@igaming/infrastructure";
```

### Auth Modes

The real enum lives in `apps/api/libs/infrastructure/src/lib/security/middleware.ts`:

| Mode | When to Use |
|------|-------------|
| `AuthMode.PUBLIC_READ` | No authentication required (register, login, etc.) |
| `AuthMode.PUBLIC_OPTIONAL` | Optional auth — try to authenticate but don't fail if missing |
| `AuthMode.USER_REQUIRED` | Regular authenticated users (default) |
| `AuthMode.ADMIN_REQUIRED` | Admin-only operations |

Usage: `handleSecureRequest(req, handler, AuthMode.USER_REQUIRED)` — the handler
receives `(supabaseClient, session, url, request, ipAddress, userAgent)`.

Note: operator endpoints use `handleOperatorSecureRequest(req, endpointGroup, accessLevel, handler)`
instead — see `.claude/rules/edge-functions.md`.

### Response Helpers

Always use standardized response helpers:
- `createSuccessResponse(data, status, corsHeaders, meta)` for success
- `createErrorResponse(message, details, status, corsHeaders)` for errors

### FP Error Handling (v0.1.2+)

All functions MUST use Result types instead of try/catch:

```typescript
import { ok, err, errAsync, ResultAsync } from "neverthrow"
import { DatabaseError } from "@igaming/domain"
// FP ValidationError factory — import by RELATIVE path; the name exported from
// @igaming/domain is the legacy class, not the FP factory
import { ValidationError } from "../../libs/domain/src/lib/errors/fp/validation.ts"
import { resultAsyncToResponse, parseRequestBody, PLAYER_JSON_MAX_BODY_BYTES, validateRequest } from "@igaming/infrastructure"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AccessSession } from "@igaming/domain"

// Handler returns Promise<Response> via translation layer
const handlePost = (
  supabase: SupabaseClient,
  session: AccessSession | null,
  request: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> =>
  resultAsyncToResponse(
    parseRequestBody<unknown>(request, PLAYER_JSON_MAX_BODY_BYTES)
      .andThen(body => validateRequest(CreateSchema, body)) // schema FIRST, then data
      .andThen(data => processCreate(data, supabase)),
    corsHeaders,
    { successStatus: 201 }
  )
```

**Key Patterns:**
- Use `parseRequestBody()` for JSON parsing with error handling
- Use `validateRequest(schema, data)` for Zod schema validation — signature is `(schema, data)`, NOT `(data, schema)`
- Use `ResultAsync.fromPromise()` for database operations
- Use `resultAsyncToResponse(resultAsync, headers, options?)` for final Response conversion (2-3 args; the first MUST be a `ResultAsync` — use `errAsync(...)` for early failures, never a plain `err(...)`)
- Return domain errors via `err(ErrorFactory({...}))`, never throw
- `DatabaseError` requires `{ table, operation }` context (`cause` optional) — see `apps/api/libs/domain/src/lib/errors/fp/infrastructure.ts`
- FP `ValidationError` takes an issues array: `ValidationError([{ field, message, code }])`
- Route with `match([method, pathname])` from `@igaming/domain` — no if/else chains (see `.claude/rules/fp.md`)

### Legacy Error Handling (deprecated)

For legacy functions not yet migrated, use try/catch with `captureError`:

```typescript
try {
  // Handler logic
} catch (error) {
  const errorId = await captureError(error, {
    functionName: '{name}',
    operation: 'main_handler',
    request,
    session,
  });
  return createErrorResponse('Internal error', undefined, 500, { 'X-Error-ID': errorId });
}
```

**Note:** New functions should use FP patterns above. Legacy pattern only for unmigrated code.

## Post-Scaffold Validation

Run these checks after scaffolding. All commands run from the `apps/api` directory
(the Deno workspace root — running from the repo root will not resolve imports):

```bash
cd apps/api

# Type check
deno check functions/{name}/index.ts

# Verify imports resolve
deno info functions/{name}/index.ts

# Lint check
deno lint functions/{name}/
```

Also register the new function (see `.claude/rules/edge-functions.md`):
- Add `./functions/{name}` to the `"workspace"` array in `apps/api/deno.json`
- Add `[functions.{name}] verify_jwt = false` to `apps/api/supabase/config.toml`

## $ARGUMENTS

| Argument | Description | Example |
|----------|-------------|---------|
| `name` | Function name (kebab-case) | `player-profile` |
| `purpose` | Brief description | `Manage player profile data` |
| `authMode` | Authentication requirement | `USER_REQUIRED`, `ADMIN_REQUIRED`, `PUBLIC_READ`, `PUBLIC_OPTIONAL` |
| `methods` | Allowed HTTP methods | `GET`, `POST`, `PUT`, `DELETE` |

## Example Usage

Create a player profile endpoint:

```
Scaffold edge function:
- name: player-profile
- purpose: Get and update player profile
- authMode: USER_REQUIRED
- methods: GET, PUT
```
