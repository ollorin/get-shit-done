---
name: create-integration-test
description: Use AFTER creating Edge Function - automatically scaffold integration test file with Supabase test setup, authentication helpers, and API endpoint tests
disable-model-invocation: false
allowed-tools: Read, Write, Bash(deno *), Glob, Grep
---

# Integration Test Scaffolding Skill

## When to Use

Trigger on tasks involving:
- Creating an integration test
- Testing an API endpoint
- Testing a function against Supabase
- Creating end-to-end API tests
- Writing function tests

## File Created

For a function named `{name}`:

```
apps/api/functions/__tests__/{name}.integration.test.ts
```

## Test Structure

Per project convention, all integration tests MUST include:

| Category | Purpose | Example |
|----------|---------|---------|
| **Positive cases** | Valid requests succeed | Authenticated GET returns 200 |
| **Negative cases** | Invalid requests fail correctly | Missing auth returns 401 |
| **Edge cases** | Boundary conditions handled | Empty body returns 400 |

## Required Patterns

### 1. Environment Validation First

ALWAYS start with validateTestEnv():

```typescript
// MUST be first import - loads .env.test and validates environment
import { validateTestEnv } from "./test-setup.ts";
validateTestEnv();
```

### 2. Auth Helpers for Authentication

Use auth-helpers.ts for real authentication flow:

```typescript
import { loginAsAdmin, loginAsRegularUser, createAuthHeaders } from "./auth-helpers.ts";

// Get admin session
const adminToken = await loginAsAdmin();
const headers = createAuthHeaders(adminToken);

// Get regular user session
const userToken = await loginAsRegularUser();
const headers = createAuthHeaders(userToken);
```

### 3. Deno Test with Steps

Use `Deno.test` with nested `t.step`:

```typescript
Deno.test({
  name: `{function-name}: positive cases`,
  async fn(t) {
    await t.step("returns 200 for valid request", async () => {
      // Test implementation
    });
  },
});
```

### 4. Supabase Client Cleanup

Track and cleanup Supabase clients to prevent interval leaks:

```typescript
const supabaseClients: ReturnType<typeof createClient>[] = [];

function createTrackedClient(url: string, key: string) {
  const client = createClient(url, key);
  supabaseClients.push(client);
  return client;
}

async function cleanupSupabaseClients() {
  for (const client of supabaseClients) {
    await client.auth.stopAutoRefresh();
  }
  supabaseClients.length = 0;
}
```

### 5. Response Body Consumption

ALWAYS consume response body to avoid resource leaks:

```typescript
const response = await fetch(url, options);
const data = await response.json(); // or response.text()
```

### Testing FP Error Responses (v0.1.2+)

Edge functions return structured error responses. Test the full error format:

```typescript
describe("error responses", () => {
  it("should return structured validation error", async () => {
    const response = await client.post('/endpoint', { invalid: 'data' });

    assertEquals(response.status, 400);
    const body = await response.json();

    assertEquals(body.success, false);
    assertEquals(body.error.type, "ValidationError");
    assertExists(body.error.code);
    assertExists(body.error.message);
  });

  it("should return rate limit error with retryAfter", async () => {
    // Trigger rate limit
    for (let i = 0; i < 10; i++) {
      await client.post('/endpoint', validData);
    }

    const response = await client.post('/endpoint', validData);

    assertEquals(response.status, 429);
    const body = await response.json();

    assertEquals(body.error.type, "RateLimitError");
    assertExists(body.error.retryAfter);
  });
});
```

**Key Patterns:**
- Always test `body.success === false` for error responses
- Verify `body.error.type` matches expected error type
- Check `body.error.code` format (e.g., "AUTH_001")
- Test `body.error.retryAfter` for 429 responses

## Test Categories

### Positive Cases (Happy Path)

Test that valid requests succeed:

- Authenticated request returns expected data
- Valid parameters produce correct results
- CRUD operations work as expected
- Pagination works correctly

### Negative Cases (Error Handling)

Test that invalid requests fail properly:

- Missing authentication returns 401
- Invalid credentials returns 401
- Missing required parameters returns 400
- Non-existent resource returns 404
- Unauthorized access returns 403

### Structured Error Response Testing (FP)

Test FP error response format:

- Verify `body.success === false` for all error responses
- Check `body.error.type` matches error factory tag
- Test `body.error.code` follows convention (e.g., "AUTH_001", "VAL_002")
- Verify `body.error.message` contains useful description
- For 429 responses, test `body.error.retryAfter` is present
- For 5xx responses, test `body.error.type` is "InternalError"

### Edge Cases (Boundary Conditions)

Test boundary and unusual conditions:

- Empty request body
- Maximum/minimum values
- Special characters in input
- Concurrent requests
- Rate limiting behavior

## Post-Scaffold Validation

Run these checks after scaffolding:

```bash
# Syntax check
deno check apps/api/functions/__tests__/{name}.integration.test.ts

# Run tests (requires supabase start)
cd apps/api && deno task test
```

## $ARGUMENTS

| Argument | Description | Example |
|----------|-------------|---------|
| `name` | Function name being tested | `player-profile` |
| `scenarios` | Key test scenarios | `auth, crud, validation` |
| `authMode` | Auth requirements | `Session`, `Admin`, `Public` |

## Example Usage

Create integration tests for player-profile:

```
Scaffold integration test:
- name: player-profile
- scenarios: get profile, update profile, invalid auth
- authMode: Session
```
