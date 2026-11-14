/**
 * Integration test for {function-name} Edge Function
 *
 * Prerequisites:
 * 1. Run `supabase start` to start local Supabase
 * 2. Ensure .env.test has correct local credentials
 *
 * Run: cd apps/api && deno task test
 */

// MUST be first import - loads .env.test and validates environment
import { validateTestEnv } from "./test-setup.ts";
validateTestEnv();

// Then other imports...
import { assertEquals, assertExists, assert } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loginAsAdmin, loginAsRegularUser, createAuthHeaders } from "./auth-helpers.ts";

// Environment-based Supabase credentials
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321";
// deno-lint-ignore no-unused-vars -- template placeholder; generated tests use it for service-role clients
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Test constants
const FUNCTION_NAME = "{function-name}";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`;

// Global session tokens - initialized lazily
let adminSessionToken: string | null = null;
let userSessionToken: string | null = null;

// Helper to get or create admin session token
async function getAdminHeaders(): Promise<Record<string, string>> {
  if (!adminSessionToken) {
    adminSessionToken = await loginAsAdmin();
  }
  return createAuthHeaders(adminSessionToken);
}

// Helper to get or create user session token
// deno-lint-ignore no-unused-vars -- template helper kept for generated tests that need a regular user
async function getUserHeaders(): Promise<Record<string, string>> {
  if (!userSessionToken) {
    userSessionToken = await loginAsRegularUser();
  }
  return createAuthHeaders(userSessionToken);
}

// Track Supabase clients for cleanup
// Note: typed as SupabaseClient[] — createClient's inferred generics vary per
// call site, so ReturnType<typeof createClient> does not accept them
const supabaseClients: SupabaseClient[] = [];

// Helper to create and track Supabase client
// deno-lint-ignore no-unused-vars -- template helper kept for generated tests that create clients
function createTrackedClient(url: string, key: string): SupabaseClient {
  const client = createClient(url, key);
  supabaseClients.push(client);
  return client;
}

// Helper to cleanup all Supabase clients (stops auto-refresh intervals)
async function cleanupSupabaseClients(): Promise<void> {
  for (const client of supabaseClients) {
    try {
      await client.auth.stopAutoRefresh();
    } catch (_error) {
      // Ignore errors during cleanup
    }
  }
  supabaseClients.length = 0;
}

// =============================================================================
// POSITIVE CASES - Valid requests that should succeed
// =============================================================================

Deno.test({
  name: `${FUNCTION_NAME}: positive cases`,
  async fn(t) {
    await t.step("returns 200 for valid authenticated request", async () => {
      const response = await fetch(FUNCTION_URL, {
        method: "GET",
        headers: await getAdminHeaders(),
      });

      assertEquals(response.status, 200, "Should return 200 for authenticated request");

      const result = await response.json();
      assertEquals(result.success, true, "Should return success: true");
      assertExists(result.data, "Should return data object");
    });

    // TODO: Add more positive test cases
    // await t.step("creates resource successfully", async () => { ... });
    // await t.step("updates resource successfully", async () => { ... });
    // await t.step("returns paginated results", async () => { ... });

    // Cleanup
    await cleanupSupabaseClients();
  },
});

// =============================================================================
// NEGATIVE CASES - Invalid requests that should fail
// =============================================================================

Deno.test({
  name: `${FUNCTION_NAME}: negative cases`,
  async fn(t) {
    await t.step("returns 401 without authentication", async () => {
      const response = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ test: "data" }),
      });

      await response.text(); // Consume response body
      assertEquals(response.status, 401, "Should return 401 without authentication");
    });

    await t.step("returns 404 for non-existent resource", async () => {
      const response = await fetch(`${FUNCTION_URL}?id=00000000-0000-0000-0000-000000000000`, {
        method: "GET",
        headers: await getAdminHeaders(),
      });

      assertEquals(response.status, 404, "Should return 404 for non-existent resource");

      const result = await response.json();
      assertEquals(result.success, false, "Should return success: false");
      assertExists(result.error, "Should return error object");
    });

    // TODO: Add more negative test cases
    // await t.step("returns 400 for invalid parameters", async () => { ... });
    // await t.step("returns 403 for unauthorized access", async () => { ... });

    // Cleanup
    await cleanupSupabaseClients();
  },
});

// =============================================================================
// EDGE CASES - Boundary conditions and unusual inputs
// =============================================================================

Deno.test({
  name: `${FUNCTION_NAME}: edge cases`,
  async fn(t) {
    await t.step("handles empty body gracefully", async () => {
      const response = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: await getAdminHeaders(),
        body: JSON.stringify({}),
      });

      // Empty body should return 400 (bad request) or be handled gracefully
      assert(
        [200, 400, 422].includes(response.status),
        `Should handle empty body (got ${response.status})`
      );

      await response.json(); // Consume response body
    });

    await t.step("handles invalid JSON gracefully", async () => {
      const response = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: {
          ...(await getAdminHeaders()),
          "Content-Type": "application/json",
        },
        body: "not valid json",
      });

      assertEquals(response.status, 400, "Should return 400 for invalid JSON");
      await response.text(); // Consume response body
    });

    // TODO: Add more edge test cases
    // await t.step("handles special characters in input", async () => { ... });
    // await t.step("handles boundary values", async () => { ... });
    // await t.step("handles concurrent requests", async () => { ... });

    // Cleanup
    await cleanupSupabaseClients();
  },
});

// =============================================================================
// SECURITY TESTS - Verify security controls
// =============================================================================

Deno.test({
  name: `${FUNCTION_NAME}: security`,
  async fn(t) {
    await t.step("does not expose sensitive information in errors", async () => {
      const response = await fetch(`${FUNCTION_URL}?id=00000000-0000-0000-0000-000000000000`, {
        method: "GET",
        headers: await getAdminHeaders(),
      });

      const result = await response.json();

      // Should not expose database details, SQL errors, or stack traces
      if (result.error?.message) {
        const errorMsg = JSON.stringify(result.error);
        assert(!errorMsg.toLowerCase().includes("sql"), "Should not expose SQL errors");
        assert(!errorMsg.includes("stack"), "Should not expose stack traces");
        assert(!errorMsg.toLowerCase().includes("postgres"), "Should not expose PostgreSQL details");
      }
    });

    await t.step("includes CORS headers", async () => {
      const response = await fetch(FUNCTION_URL, {
        method: "OPTIONS",
        headers: {
          "Origin": "http://localhost:3000",
          "Access-Control-Request-Method": "GET",
        },
      });

      await response.text(); // Consume response body
      assertEquals(response.status, 200, "Should return 200 for OPTIONS");

      const corsHeader = response.headers.get("access-control-allow-origin") ||
                        response.headers.get("Access-Control-Allow-Origin");
      assert(corsHeader, "Should include CORS headers");
    });

    // Cleanup
    await cleanupSupabaseClients();
  },
});
