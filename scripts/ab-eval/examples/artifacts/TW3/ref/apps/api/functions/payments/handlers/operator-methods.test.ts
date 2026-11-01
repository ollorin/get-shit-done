/**
 * Unit tests for operator method handlers — malformed-JSON-body coverage.
 *
 * Covers the 6 sites converted from throw/try to ResultAsync.fromPromise() in
 * 285-23 (Phase 285, Wave B backend FP migration). Each site must return 400
 * with message 'Invalid JSON body' when request.json() rejects, and must NOT
 * touch the supabase client before returning (early-return-on-parse-failure,
 * Variant A of the plan's conversion pattern).
 *
 * Valid-body success/error paths are already covered by
 * functions/__tests__/payments-operator.integration.test.ts.
 *
 * Run: deno test --allow-all --import-map=../../import_map.json handlers/operator-methods.test.ts
 *
 * Phase 285-23 — payments handlers batch A
 */
import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccessSession } from "@igaming/domain";
import { handleOperatorMethods } from "./operator-methods.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

/** A Request-like object whose .json() rejects, simulating malformed JSON body. */
const makeRejectingRequest = (): Request => ({
  json: () => Promise.reject(new SyntaxError("Unexpected token")),
} as unknown as Request);

/** supabase client that throws if touched — proves parse-failure sites never reach the DB. */
const untouchedSupabase = (): SupabaseClient =>
  new Proxy({}, {
    get(): never {
      throw new Error(
        "supabase client must not be touched on malformed-JSON-body parse failure",
      );
    },
  }) as unknown as SupabaseClient;

const mockSession: AccessSession = {
  playerAccountId: "00000000-0000-0000-0000-000000000001",
  role: "operator_admin",
  deviceId: "test-device",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  requires2FA: false,
};

const corsHeaders: Record<string, string> = {};

const assertInvalidJsonBody400 = async (response: Response): Promise<void> => {
  assertEquals(response.status, 400);
  const json = await response.json();
  assertEquals(json.success, false);
  assertEquals(json.error.message, "Invalid JSON body");
};

// ============================================================================
// handleCreateMethod — POST /operator/methods
// ============================================================================

Deno.test("operator-methods create: malformed JSON body returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "POST",
    "/operator/methods",
    makeRejectingRequest(),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  await assertInvalidJsonBody400(response);
});

// ============================================================================
// handleUpdateMethod — PUT /operator/methods/:id
// ============================================================================

Deno.test("operator-methods update: malformed JSON body returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/methods/00000000-0000-4000-8000-0000000000a1",
    makeRejectingRequest(),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  await assertInvalidJsonBody400(response);
});

// ============================================================================
// handleUpsertOrdering — PUT /operator/ordering/:country
// ============================================================================

Deno.test("operator-methods upsert ordering: malformed JSON body returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/ordering/US",
    makeRejectingRequest(),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  await assertInvalidJsonBody400(response);
});

// ============================================================================
// handleCreateRoutingRule — POST /operator/routing-rules
// ============================================================================

Deno.test("operator-methods create routing rule: malformed JSON body returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "POST",
    "/operator/routing-rules",
    makeRejectingRequest(),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  await assertInvalidJsonBody400(response);
});

// ============================================================================
// handleUpdateRoutingRule — PUT /operator/routing-rules/:id
// ============================================================================

Deno.test("operator-methods update routing rule: malformed JSON body returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/routing-rules/00000000-0000-4000-8000-0000000000b1",
    makeRejectingRequest(),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  await assertInvalidJsonBody400(response);
});

// ============================================================================
// handleUpsertSuggestedAmounts — PUT /operator/suggested-amounts/:country/:currency
// ============================================================================

Deno.test("operator-methods upsert suggested amounts: malformed JSON body returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/suggested-amounts/US/USD",
    makeRejectingRequest(),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  await assertInvalidJsonBody400(response);
});

// ============================================================================
// VALIDATION + SERVICE-CALL COVERAGE (285-23 — line/branch coverage for the
// newly-loaded module; these sites were never unit-tested before this plan)
// ============================================================================

const makeJsonRequest = (
  body: unknown,
): Request => ({ json: () => Promise.resolve(body) } as unknown as Request);

/** Same builder shape as functions/payments/services/operator-payment-service.test.ts's
 * makeSupabaseMock — reused here for consistency, not reinvented. */
function makeSupabaseMock(
  overrides: { returnData?: unknown; returnError?: unknown } = {},
) {
  const builder = {
    select: () => builder,
    order: () => builder,
    from: () => builder,
    schema: () => builder,
    insert: () => builder,
    update: () => builder,
    upsert: () => builder,
    delete: () => builder,
    single: () => builder,
    maybeSingle: () => builder,
    eq: () => builder,
    is: () => builder,
    then: (
      onFulfilled: (result: { data: unknown; error: unknown }) => unknown,
    ) =>
      Promise.resolve({
        data: "returnData" in overrides ? overrides.returnData : [],
        error: overrides.returnError ?? null,
      }).then(onFulfilled),
  };
  const client = {
    schema: () => client,
    from: () => builder,
    rpc: () => builder,
  };
  return client as unknown as SupabaseClient;
}

/** Records every chained call so a test can pin the column and RPC names the handler sends. */
function makeRecordingSupabase() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const op of ["select", "eq", "is", "maybeSingle"]) {
    builder[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return builder;
    };
  }
  builder.then = (
    onFulfilled: (r: { data: unknown; error: unknown }) => unknown,
  ) => Promise.resolve({ data: null, error: null }).then(onFulfilled);
  const client = {
    schema: (...args: unknown[]) => {
      calls.push({ op: "schema", args });
      return client;
    },
    from: (...args: unknown[]) => {
      calls.push({ op: "from", args });
      return builder;
    },
    rpc: (...args: unknown[]) => {
      calls.push({ op: "rpc", args });
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

// --- Method CRUD ---

Deno.test("operator-methods list: empty list returns 200", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: [] }),
    mockSession,
    "GET",
    "/operator/methods",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
});

Deno.test("operator-methods get: not-found returns 404", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null }),
    mockSession,
    "GET",
    "/operator/methods/00000000-0000-4000-8000-0000000000a2",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 404);
});

Deno.test("operator-methods get: found returns 200", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: { id: "method-1" } }),
    mockSession,
    "GET",
    "/operator/methods/00000000-0000-4000-8000-0000000000a3",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
});

Deno.test("operator-methods create: missing payment_method_type returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "POST",
    "/operator/methods",
    makeJsonRequest({ display_name: "Test" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
  const json = await response.json();
  assertEquals(json.error.message, "payment_method_type is required");
});

Deno.test("operator-methods create: missing display_name returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "POST",
    "/operator/methods",
    makeJsonRequest({ payment_method_type: "card" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
  const json = await response.json();
  assertEquals(json.error.message, "display_name is required");
});

Deno.test("operator-methods create: valid body succeeds (201)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: { id: "method-new" } }),
    mockSession,
    "POST",
    "/operator/methods",
    makeJsonRequest({ payment_method_type: "card", display_name: "Card" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 201);
});

Deno.test("operator-methods update: not-found (no row, no error) returns 404", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null }),
    mockSession,
    "PUT",
    "/operator/methods/00000000-0000-4000-8000-0000000000a2",
    makeJsonRequest({ display_name: "New Name" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 404);
});

Deno.test("operator-methods update: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "PUT",
    "/operator/methods/00000000-0000-4000-8000-0000000000a3",
    makeJsonRequest({ display_name: "New Name" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods get: DB error (not not-found) returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "GET",
    "/operator/methods/00000000-0000-4000-8000-0000000000a3",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods update: valid body succeeds (200)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({
      returnData: { id: "method-1", display_name: "Renamed" },
    }),
    mockSession,
    "PUT",
    "/operator/methods/00000000-0000-4000-8000-0000000000a3",
    makeJsonRequest({ display_name: "Renamed" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
});

Deno.test("operator-methods update: a type change refused by the DB trigger returns 409 PAYMENT_METHOD_TYPE_IMMUTABLE", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "PAYMENT_METHOD_TYPE_IMMUTABLE" } }),
    mockSession,
    "PUT",
    "/operator/methods/00000000-0000-4000-8000-0000000000a4",
    makeJsonRequest({ payment_method_type: "wallet" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error.code, "PAYMENT_METHOD_TYPE_IMMUTABLE");
});

Deno.test("operator-methods update: an unchanged payment_method_type is not refused (200)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: { id: "method-1", payment_method_type: "card" } }),
    mockSession,
    "PUT",
    "/operator/methods/00000000-0000-4000-8000-0000000000a4",
    makeJsonRequest({ payment_method_type: "card" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
});

Deno.test("operator-methods delete: succeeds (200)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null }),
    mockSession,
    "DELETE",
    "/operator/methods/00000000-0000-4000-8000-0000000000a3",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
  const json = await response.json();
  assertEquals(json.data.deleted, true);
});

Deno.test("operator-methods: logo upload stub returns 501", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "POST",
    "/operator/methods/00000000-0000-4000-8000-0000000000a3/logo",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 501);
});

// --- Ordering ---

Deno.test("operator-methods ordering: missing country returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "GET",
    "/operator/ordering",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods get ordering: succeeds (200)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: [] }),
    mockSession,
    "GET",
    "/operator/ordering/US",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
});

Deno.test("operator-methods upsert ordering: invalid country returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/ordering/USA",
    makeJsonRequest({
      items: [{
        methodId: "00000000-0000-4000-8000-0000000000c1",
        sortOrder: 1,
      }],
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods upsert ordering: empty items returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/ordering/US",
    makeJsonRequest({ items: [] }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods upsert ordering: valid body succeeds (200)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: [] }),
    mockSession,
    "PUT",
    "/operator/ordering/US",
    makeJsonRequest({
      items: [{
        methodId: "00000000-0000-4000-8000-0000000000c1",
        sortOrder: 1,
      }],
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
});

// --- Routing rules ---

Deno.test("operator-methods list routing rules: succeeds (200)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: [] }),
    mockSession,
    "GET",
    "/operator/routing-rules",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
});

Deno.test("operator-methods create routing rule: missing payment_method_id returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "POST",
    "/operator/routing-rules",
    makeJsonRequest({ country: "US", currency: "USD", processors: [] }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
  const json = await response.json();
  assertEquals(json.error.message, "payment_method_id is required");
});

Deno.test("operator-methods create routing rule: missing country returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "POST",
    "/operator/routing-rules",
    makeJsonRequest({
      payment_method_id: "00000000-0000-4000-8000-0000000000c1",
      currency: "USD",
      processors: [],
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods create routing rule: missing currency returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "POST",
    "/operator/routing-rules",
    makeJsonRequest({
      payment_method_id: "00000000-0000-4000-8000-0000000000c1",
      country: "US",
      processors: [],
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods create routing rule: processors not array returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "POST",
    "/operator/routing-rules",
    makeJsonRequest({
      payment_method_id: "00000000-0000-4000-8000-0000000000c1",
      country: "US",
      currency: "USD",
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods create routing rule: valid body succeeds (201)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: { id: "rule-1" } }),
    mockSession,
    "POST",
    "/operator/routing-rules",
    makeJsonRequest({
      payment_method_id: "00000000-0000-4000-8000-0000000000c1",
      country: "US",
      currency: "USD",
      processors: [],
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 201);
});

Deno.test("operator-methods update routing rule: not-found (no row, no error) returns 404", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null }),
    mockSession,
    "PUT",
    "/operator/routing-rules/00000000-0000-4000-8000-0000000000b2",
    makeJsonRequest({ country: "US" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 404);
});

Deno.test("operator-methods update routing rule: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "PUT",
    "/operator/routing-rules/00000000-0000-4000-8000-0000000000b3",
    makeJsonRequest({ country: "US" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods create routing rule: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "POST",
    "/operator/routing-rules",
    makeJsonRequest({
      payment_method_id: "00000000-0000-4000-8000-0000000000c1",
      country: "US",
      currency: "USD",
      processors: [],
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods upsert suggested amounts: invalid country returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/suggested-amounts/USA/USD",
    makeJsonRequest({ amounts: [10] }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods upsert suggested amounts: invalid currency returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/suggested-amounts/US/DOLLAR",
    makeJsonRequest({ amounts: [10] }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods update routing rule: valid body succeeds (200)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: { id: "rule-1", country: "US" } }),
    mockSession,
    "PUT",
    "/operator/routing-rules/00000000-0000-4000-8000-0000000000b3",
    makeJsonRequest({ country: "US" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
});

Deno.test("operator-methods delete routing rule: succeeds (200)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null }),
    mockSession,
    "DELETE",
    "/operator/routing-rules/00000000-0000-4000-8000-0000000000b3",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
});

// --- Suggested amounts ---

Deno.test("operator-methods suggested amounts: missing country/currency returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "GET",
    "/operator/suggested-amounts",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods get suggested amounts: invalid country returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "GET",
    "/operator/suggested-amounts/USA/USD",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods get suggested amounts: invalid currency returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "GET",
    "/operator/suggested-amounts/US/DOLLAR",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods get suggested amounts: succeeds (200) with no stored row", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null }),
    mockSession,
    "GET",
    "/operator/suggested-amounts/US/USD",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
  const json = await response.json();
  assertEquals(json.data.amounts, []);
});

Deno.test("operator-methods upsert suggested amounts: amounts not array returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/suggested-amounts/US/USD",
    makeJsonRequest({ amounts: "not-an-array" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods upsert suggested amounts: empty amounts returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/suggested-amounts/US/USD",
    makeJsonRequest({ amounts: [] }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods upsert suggested amounts: non-positive amount returns 400", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "PUT",
    "/operator/suggested-amounts/US/USD",
    makeJsonRequest({ amounts: [10, -5] }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 400);
});

Deno.test("operator-methods upsert suggested amounts: valid body succeeds (200)", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null }),
    mockSession,
    "PUT",
    "/operator/suggested-amounts/US/USD",
    makeJsonRequest({ amounts: [10, 20, 50] }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
});

Deno.test("operator-methods: unknown route returns 404", async () => {
  const response = await handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    "GET",
    "/operator/unknown-resource",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 404);
});

// --- DB-error branches (the `err` side of each handler's `.match()`) ---

Deno.test("operator-methods list: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "GET",
    "/operator/methods",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods create: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "POST",
    "/operator/methods",
    makeJsonRequest({ payment_method_type: "card", display_name: "Card" }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods delete: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "DELETE",
    "/operator/methods/00000000-0000-4000-8000-0000000000a3",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods get ordering: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "GET",
    "/operator/ordering/US",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods upsert ordering: DB error on upsert returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "PUT",
    "/operator/ordering/US",
    makeJsonRequest({
      items: [{
        methodId: "00000000-0000-4000-8000-0000000000c1",
        sortOrder: 1,
      }],
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods list routing rules: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "GET",
    "/operator/routing-rules",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods delete routing rule: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "DELETE",
    "/operator/routing-rules/00000000-0000-4000-8000-0000000000b3",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods get suggested amounts: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "GET",
    "/operator/suggested-amounts/US/USD",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

Deno.test("operator-methods upsert suggested amounts: DB error returns 500", async () => {
  const response = await handleOperatorMethods(
    makeSupabaseMock({ returnData: null, returnError: { message: "db down" } }),
    mockSession,
    "PUT",
    "/operator/suggested-amounts/US/USD",
    makeJsonRequest({ amounts: [10, 20] }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 500);
});

// --- Method-not-allowed (405) branches on each sub-route ---

for (
  const path of [
    "/operator/methods",
    "/operator/methods/00000000-0000-4000-8000-0000000000a3",
    "/operator/ordering/US",
    "/operator/routing-rules",
    "/operator/routing-rules/00000000-0000-4000-8000-0000000000b3",
    "/operator/suggested-amounts/US/USD",
  ]
) {
  Deno.test(`operator-methods: PATCH on ${path} returns 405`, async () => {
    const response = await handleOperatorMethods(
      untouchedSupabase(),
      mockSession,
      "PATCH",
      path,
      makeJsonRequest(null),
      new URL("http://localhost"),
      corsHeaders,
      "super_admin",
    );
    assertEquals(response.status, 405);
  });
}

// --- 392-12: suggested amounts name only real configurations columns / the real RPC ---

Deno.test("operator-methods get suggested amounts: reads the GLOBAL-scope config_key row, no namespace/key/value columns", async () => {
  const { client, calls } = makeRecordingSupabase();
  await handleOperatorMethods(
    client,
    mockSession,
    "GET",
    "/operator/suggested-amounts/us/usd",
    makeJsonRequest(null),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(calls.filter((c) => c.op === "from").map((c) => c.args[0]), [
    "configurations",
  ]);
  assertEquals(calls.find((c) => c.op === "select")?.args, ["config_value"]);
  const filters = calls.filter((c) => c.op === "eq" || c.op === "is").map((
    c,
  ) => [c.op, ...c.args]);
  assertEquals(filters, [
    ["eq", "config_key", "payments.suggested_amounts.US.USD"],
    ["eq", "is_active", true],
    ["is", "jurisdiction_id", null],
    ["is", "country_code", null],
    ["is", "customer_id", null],
    ["is", "player_segment", null],
  ]);
});

Deno.test("operator-methods upsert suggested amounts: one atomic payments.upsert_suggested_amounts RPC, no table write", async () => {
  const { client, calls } = makeRecordingSupabase();
  const response = await handleOperatorMethods(
    client,
    mockSession,
    "PUT",
    "/operator/suggested-amounts/us/usd",
    makeJsonRequest({ amounts: [10, 20] }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(response.status, 200);
  assertEquals(calls.map((c) => c.op), ["schema", "rpc"]);
  assertEquals(calls[0].args, ["payments"]);
  assertEquals(calls[1].args, ["upsert_suggested_amounts", {
    p_country: "US",
    p_currency: "USD",
    p_amounts: [10, 20],
    p_actor: "00000000-0000-0000-0000-000000000001",
  }]);
});

// ============================================================================
// 400-20 pass 7 - request-param validation (400; untouchedSupabase throws on ANY DB access)
// ============================================================================

const P7_UUID = "00000000-0000-4000-8000-0000000000d1";

const p7Call = (method: string, path: string, body: unknown, query = "") =>
  handleOperatorMethods(
    untouchedSupabase(),
    mockSession,
    method,
    path,
    makeJsonRequest(body),
    new URL("http://localhost" + path + query),
    corsHeaders,
    "super_admin",
  );

/** 5000-deep (≈30 KB serialised) object; the shared recursive jsonHasNul overflows the stack at ~3000. */
const deepJson = (leaf: string): unknown =>
  Array.from({ length: 5000 }).reduce<unknown>((acc) => ({ n: acc }), leaf);

const P7_METHOD_FIELDS: ReadonlyArray<
  readonly [string, Record<string, unknown>]
> = [
  ["payment_method_type number", { payment_method_type: 123 }],
  ["payment_method_type over 256", { payment_method_type: "x".repeat(257) }],
  ["display_name number", { display_name: 123 }],
  ["description number", { description: 5 }],
  ["description over 4096", { description: "d".repeat(4097) }],
  ["logo_url array", { logo_url: ["x"] }],
  ["is_active string", { is_active: "maybe" }],
  ["is_active null", { is_active: null }],
  ["supported_currencies scalar", { supported_currencies: "USD" }],
  ["supported_countries numeric element", { supported_countries: [1] }],
  ["min_amount string", { min_amount: "abc" }],
  ["max_amount negative", { max_amount: -1 }],
  ["daily_limit NaN-like (Infinity)", { daily_limit: Infinity }],
  ["monthly_limit over range", { monthly_limit: 1e12 }],
  ["max_amount at DECIMAL(18,8) ceiling 1e10", { max_amount: 1e10 }],
  ["daily_limit at DECIMAL(18,8) ceiling 1e10", { daily_limit: 1e10 }],
  ["fee_value at DECIMAL(18,8) ceiling 1e10", { fee_value: 1e10 }],
  ["metadata unpaired surrogate value", { metadata: { n: "a\ud800" } }],
  ["form_schema 33 levels deep (cap 32), clean leaf", {
    form_schema: Array.from({ length: 32 }).reduce<unknown>(
      (acc) => ({ n: acc }),
      {},
    ),
  }],
  ["form_schema 5000-deep, clean leaf", { form_schema: deepJson("leaf") }],
  ["fee_value string", { fee_value: "1" }],
  ["fee_value null", { fee_value: null }],
  ["min above max", { min_amount: 10, max_amount: 5 }],
  ["fee_type outside CHECK", { fee_type: "bogus" }],
  ["fee_bearer outside CHECK", { fee_bearer: "bogus" }],
  ["suggested_amounts non-integer", { suggested_amounts: [1.5] }],
  ["suggested_amounts over int4", { suggested_amounts: [3000000000] }],
  ["suggested_amounts over 20", {
    suggested_amounts: Array.from({ length: 21 }, (_, i) => i + 1),
  }],
  ["form_schema array", { form_schema: [] }],
  ["metadata null", { metadata: null }],
  ["payment_method_type NUL", { payment_method_type: "ca\u0000rd" }],
  ["display_name NUL", { display_name: "Ca\u0000rd" }],
  ["description NUL", { description: "d\u0000" }],
  ["logo_url NUL", { logo_url: "https://x/\u0000" }],
  ["supported_currencies NUL item", { supported_currencies: ["US\u0000"] }],
  ["supported_countries NUL item", {
    supported_countries: ["US", "\u0000"],
  }],
  ["form_schema nested NUL value", { form_schema: { a: [{ b: "x\u0000" }] } }],
  ["decline_messages NUL key", { decline_messages: { "k\u0000": "m" } }],
  ["metadata NUL value", { metadata: { note: "\u0000" } }],
  ["form_schema over 64 KiB", { form_schema: { blob: "x".repeat(65_536) } }],
  ["metadata over 64 KiB", { metadata: { blob: "x".repeat(65_537) } }],
  ["form_schema 5000-deep with NUL leaf (no stack overflow)", {
    form_schema: deepJson("\u0000"),
  }],
  ["decline_messages key NUL escaped after a literal backslash", {
    decline_messages: { "a\\\u0000": "m" },
  }],
];

Deno.test("[400-20 p7] methods create: invalid body/fields are 400 with zero DB access", async () => {
  const base = { payment_method_type: "card", display_name: "Card" };
  const bodies: ReadonlyArray<readonly [string, unknown]> = [
    ["JSON null", null],
    ["array", []],
    ["payment_method_type number (required gate)", {
      payment_method_type: 123,
      display_name: "Card",
    }],
    ["display_name number (required gate)", {
      payment_method_type: "card",
      display_name: 5,
    }],
    ...P7_METHOD_FIELDS.map(([l, extra]) =>
      [l, { ...base, ...extra }] as const
    ),
  ];
  for (const [label, body] of bodies) {
    const res = await p7Call("POST", "/operator/methods", body);
    assertEquals(res.status, 400, label);
    await res.body?.cancel();
  }
});

Deno.test("[400-20 p7] methods update: invalid body/fields/id are 400 with zero DB access", async () => {
  const bodies: ReadonlyArray<readonly [string, unknown]> = [
    ["JSON null", null],
    ["array", []],
    ...P7_METHOD_FIELDS.map(([l, extra]) => [l, extra] as const),
  ];
  for (const [label, body] of bodies) {
    const res = await p7Call("PUT", `/operator/methods/${P7_UUID}`, body);
    assertEquals(res.status, 400, label);
    await res.body?.cancel();
  }
  for (const method of ["GET", "PUT", "DELETE"]) {
    const res = await p7Call(method, "/operator/methods/not-a-uuid", {
      display_name: "x",
    });
    assertEquals(res.status, 400, method);
    await res.body?.cancel();
  }
});

Deno.test("[400-20 p7] methods update: a valid typed body is forwarded (200)", async () => {
  const res = await handleOperatorMethods(
    makeSupabaseMock({ returnData: { id: P7_UUID } }),
    mockSession,
    "PUT",
    `/operator/methods/${P7_UUID}`,
    makeJsonRequest({
      display_name: "Card",
      is_active: true,
      supported_currencies: ["USD"],
      min_amount: 1,
      max_amount: 9_999_999_999,
      daily_limit: 5_000_000_000,
      monthly_limit: 9_999_999_999,
      fee_type: "percent",
      fee_bearer: "split",
      fee_value: 2.5,
      suggested_amounts: [10, 20],
      form_schema: Array.from({ length: 31 }).reduce<unknown>(
        (acc) => ({ n: acc }),
        {},
      ),
      metadata: { note: "ok 😀" },
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(res.status, 200);
  await res.body?.cancel();
});

Deno.test("[400-20 p7] ordering: invalid items are 400 with zero DB access", async () => {
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ["JSON null body", null],
    ["items scalar", { items: "x" }],
    ["null element", { items: [null] }],
    ["non-uuid methodId", { items: [{ methodId: "m1", sortOrder: 1 }] }],
    ["string sortOrder", { items: [{ methodId: P7_UUID, sortOrder: "1" }] }],
    ["fractional sortOrder", {
      items: [{ methodId: P7_UUID, sortOrder: 1.5 }],
    }],
    ["sortOrder over int4", {
      items: [{ methodId: P7_UUID, sortOrder: 3000000000 }],
    }],
    ["duplicate methodId", {
      items: [{ methodId: P7_UUID, sortOrder: 1 }, {
        methodId: P7_UUID,
        sortOrder: 2,
      }],
    }],
    ["over 500 items", {
      items: Array.from(
        { length: 501 },
        (_, i) => ({
          methodId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          sortOrder: i,
        }),
      ),
    }],
  ];
  for (const [label, body] of cases) {
    const res = await p7Call("PUT", "/operator/ordering/US", body);
    assertEquals(res.status, 400, label);
    await res.body?.cancel();
  }
});

Deno.test("[400-20 p7] routing rules: invalid body/fields/ids/filter are 400 with zero DB access", async () => {
  const rule = {
    payment_method_id: P7_UUID,
    country: "US",
    currency: "USD",
    processors: [{ processor_id: P7_UUID, priority: 1 }],
  };
  const bad: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["processors non-uuid processor_id", {
      processors: [{ processor_id: "p1", priority: 1 }],
    }],
    ["processors null element", { processors: [null] }],
    ["processors string priority", {
      processors: [{ processor_id: P7_UUID, priority: "1" }],
    }],
    ["processors over 50", {
      processors: Array.from(
        { length: 51 },
        () => ({ processor_id: P7_UUID, priority: 1 }),
      ),
    }],
    ["country number", { country: 5 }],
    ["currency over 16", { currency: "x".repeat(17) }],
  ];
  for (const [label, extra] of bad) {
    const create = await p7Call("POST", "/operator/routing-rules", {
      ...rule,
      ...extra,
    });
    assertEquals(create.status, 400, `create ${label}`);
    await create.body?.cancel();
    const update = await p7Call(
      "PUT",
      `/operator/routing-rules/${P7_UUID}`,
      extra,
    );
    assertEquals(update.status, 400, `update ${label}`);
    await update.body?.cancel();
  }
  for (const [label, body] of [["JSON null", null], ["array", []]] as const) {
    for (
      const [method, path] of [["POST", "/operator/routing-rules"], [
        "PUT",
        `/operator/routing-rules/${P7_UUID}`,
      ]] as const
    ) {
      const res = await p7Call(method, path, body);
      assertEquals(res.status, 400, `${method} ${label}`);
      await res.body?.cancel();
    }
  }
  const nonUuidPm = await p7Call("POST", "/operator/routing-rules", {
    ...rule,
    payment_method_id: "m1",
  });
  assertEquals(nonUuidPm.status, 400);
  await nonUuidPm.body?.cancel();
  for (const method of ["PUT", "DELETE"]) {
    const res = await p7Call(
      method,
      "/operator/routing-rules/not-a-uuid",
      rule,
    );
    assertEquals(res.status, 400, method);
    await res.body?.cancel();
  }
  const filter = await p7Call(
    "GET",
    "/operator/routing-rules",
    null,
    "?method_id=not-a-uuid",
  );
  assertEquals(filter.status, 400);
  await filter.body?.cancel();
});

Deno.test("[400-20 p7] routing rules: a valid rule is forwarded (201) and a valid method_id filter reaches the DB (200)", async () => {
  const created = await handleOperatorMethods(
    makeSupabaseMock({ returnData: { id: P7_UUID } }),
    mockSession,
    "POST",
    "/operator/routing-rules",
    makeJsonRequest({
      payment_method_id: P7_UUID,
      country: "US",
      currency: "USD",
      processors: [{ processor_id: P7_UUID, priority: 1 }],
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(created.status, 201);
  await created.body?.cancel();
  const listed = await handleOperatorMethods(
    makeSupabaseMock({ returnData: [] }),
    mockSession,
    "GET",
    "/operator/routing-rules",
    makeJsonRequest(null),
    new URL(`http://localhost/operator/routing-rules?method_id=${P7_UUID}`),
    corsHeaders,
    "super_admin",
  );
  assertEquals(listed.status, 200);
  await listed.body?.cancel();
});

/** Chainable client recording every call (any method name); resolves to empty data. */
function makeChainRecordingSupabase() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const make = (): unknown =>
    new Proxy(() => undefined, {
      get: (_t, op) =>
        op === "then"
          ? (f: (r: { data: unknown; error: unknown }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(f)
          : (...args: unknown[]) => {
            calls.push({ op: String(op), args });
            return make();
          },
    });
  return { client: make() as unknown as SupabaseClient, calls };
}

Deno.test("[400-20 p7-g2] routing list: NUL / over-16 country and currency filters are 400 with zero DB access", async () => {
  for (
    const query of [
      "?country=U%00S",
      "?currency=US%00D",
      `?country=${"x".repeat(17)}`,
      `?currency=${"x".repeat(17)}`,
    ]
  ) {
    const res = await p7Call("GET", "/operator/routing-rules", null, query);
    assertEquals(res.status, 400, query);
    await res.body?.cancel();
  }
});

Deno.test("[400-20 p7-g2] routing list: clean country and currency filters reach the DB with the exact values", async () => {
  const { client, calls } = makeChainRecordingSupabase();
  const res = await handleOperatorMethods(
    client,
    mockSession,
    "GET",
    "/operator/routing-rules",
    makeJsonRequest(null),
    new URL(
      "http://localhost/operator/routing-rules?country=US&currency=" +
        "x".repeat(16),
    ),
    corsHeaders,
    "super_admin",
  );
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(calls.some((c) => c.op === "from"), true);
  const eqs = calls.filter((c) => c.op === "eq").map((c) => c.args);
  assertEquals(eqs.some((a) => a[1] === "US"), true);
  assertEquals(eqs.some((a) => a[1] === "x".repeat(16)), true);
});

Deno.test("[400-20 p7-g2] routing create/update: NUL country or currency is 400 with zero DB access", async () => {
  const rule = {
    payment_method_id: P7_UUID,
    country: "US",
    currency: "USD",
    processors: [{ processor_id: P7_UUID, priority: 1 }],
  };
  for (const extra of [{ country: "U\u0000" }, { currency: "\u0000USD" }]) {
    const create = await p7Call("POST", "/operator/routing-rules", {
      ...rule,
      ...extra,
    });
    assertEquals(create.status, 400, `create ${JSON.stringify(extra)}`);
    await create.body?.cancel();
    const update = await p7Call(
      "PUT",
      `/operator/routing-rules/${P7_UUID}`,
      extra,
    );
    assertEquals(update.status, 400, `update ${JSON.stringify(extra)}`);
    await update.body?.cancel();
  }
});

Deno.test("[400-20 p7-g2] methods: clean text, lists and jsonb at the 64 KiB boundary reach the DB (control)", async () => {
  const { client, calls } = makeChainRecordingSupabase();
  const res = await handleOperatorMethods(
    client,
    mockSession,
    "PUT",
    `/operator/methods/${P7_UUID}`,
    makeJsonRequest({
      display_name: "Card",
      description: "plain",
      logo_url: "https://x/y.png",
      supported_currencies: ["USD"],
      supported_countries: ["US"],
      form_schema: { a: "x".repeat(65_536 - 8) },
      decline_messages: { k: "m" },
      metadata: {
        n: 1,
        lit: "\\u0000",
        deep: Array.from({ length: 30 }).reduce<unknown>(
          (acc) => ({ n: acc }),
          "x",
        ),
      },
    }),
    new URL("http://localhost"),
    corsHeaders,
    "super_admin",
  );
  assertEquals(res.status !== 400, true);
  await res.body?.cancel();
  assertEquals(calls.some((c) => c.op === "from"), true);
});

Deno.test("[400-20 p7] suggested-amounts: JSON null / array body is 400 with zero DB access", async () => {
  for (const body of [null, []]) {
    const res = await p7Call("PUT", "/operator/suggested-amounts/US/USD", body);
    assertEquals(res.status, 400);
    await res.body?.cancel();
  }
});
