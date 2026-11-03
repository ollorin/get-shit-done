/**
 * Unit tests for sms-provider.ts — Phase 285-27 (Wave B backend FP migration).
 *
 * Covers the 2 sites converted from IIFE-throw to `ResultAsync.fromPromise(
 * fetch(...), mapErr).andThen()` chains in 285-27: the non-400/402 HTTP-error
 * branch and the empty-recipients-list branch of `sendSms`'s real-mode path.
 * No test file existed for this module before this plan — also covers the
 * mock-mode, guard, and bounce-phone branches for regression coverage.
 *
 * Fetch-stub convention: matches
 * `libs/infrastructure/src/lib/services/email-service.test.ts` — save/restore
 * `globalThis.fetch` around each real-mode test.
 *
 * Run: deno test --allow-all --import-map=../../import_map.json services/sms-provider.test.ts
 *
 * Phase 285-27 — notifications/services cluster
 */
import { assertEquals, assert } from "@std/assert";
import { sendSms, type SmsPayload } from "./sms-provider.ts";
import { withIsolateEnv } from "../../../libs/test-utils/isolate-env.ts";

let originalFetch: typeof globalThis.fetch;

function installMockFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  originalFetch = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = handler as any;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

const basePayload: SmsPayload = {
  to: "+254700000000",
  notification_type: "deposit_confirmed",
  player_id: "player-001",
};

// Force real-mode: a non-mock API key and non-test env.
function withRealModeEnv(fn: () => Promise<void>): Promise<void> {
  return withIsolateEnv({ AT_API_KEY: "real_live_key_not_mock", DENO_ENV: undefined, NODE_ENV: undefined }, fn);
}

// ============================================================================
// Guard branches
// ============================================================================

Deno.test("sendSms: empty phone number returns bounced result without calling fetch", async () => {
  let fetchCalled = false;
  installMockFetch(() => {
    fetchCalled = true;
    return Promise.resolve(new Response("", { status: 200 }));
  });
  try {
    const result = await sendSms({ ...basePayload, to: "" });
    assert(result.isOk());
    assertEquals(result.value.status, "bounced");
    assertEquals(result.value.bounce_reason, "no_phone_number");
    assertEquals(fetchCalled, false);
  } finally {
    restoreFetch();
  }
});

// ============================================================================
// Mock-mode branches
// ============================================================================

Deno.test("sendSms: mock mode (test env) returns sent without calling fetch", async () => {
  let fetchCalled = false;
  installMockFetch(() => {
    fetchCalled = true;
    return Promise.resolve(new Response("", { status: 200 }));
  });
  try {
    const result = await sendSms(basePayload);
    assert(result.isOk());
    assertEquals(result.value.status, "sent");
    assertEquals(fetchCalled, false);
  } finally {
    restoreFetch();
  }
});

Deno.test("sendSms: mock mode bounce-phone (+000 prefix) returns bounced", async () => {
  installMockFetch(() => Promise.resolve(new Response("", { status: 200 })));
  try {
    const result = await sendSms({ ...basePayload, to: "+0001234567" });
    assert(result.isOk());
    assertEquals(result.value.status, "bounced");
    assertEquals(result.value.bounce_reason, "invalid_phone_number");
  } finally {
    restoreFetch();
  }
});

// ============================================================================
// Real-mode branches (285-27 conversion sites)
// ============================================================================

Deno.test("sendSms: real mode non-400/402 HTTP error returns Err (not throw)", () =>
  withRealModeEnv(async () => {
    installMockFetch(() =>
      Promise.resolve(new Response("server error", { status: 500 })),
    );
    try {
      const result = await sendSms(basePayload);
      assert(result.isErr());
      assert(result.error.message.includes("Africa's Talking API error: status=500"));
    } finally {
      restoreFetch();
    }
  }));

Deno.test("sendSms: real mode 400 status returns bounced (bounce, not error)", () =>
  withRealModeEnv(async () => {
    installMockFetch(() => Promise.resolve(new Response("", { status: 400 })));
    try {
      const result = await sendSms(basePayload);
      assert(result.isOk());
      assertEquals(result.value.status, "bounced");
      assertEquals(result.value.bounce_reason, "at_api_400");
    } finally {
      restoreFetch();
    }
  }));

Deno.test("sendSms: real mode 402 status returns bounced (bounce, not error)", () =>
  withRealModeEnv(async () => {
    installMockFetch(() => Promise.resolve(new Response("", { status: 402 })));
    try {
      const result = await sendSms(basePayload);
      assert(result.isOk());
      assertEquals(result.value.status, "bounced");
      assertEquals(result.value.bounce_reason, "at_api_402");
    } finally {
      restoreFetch();
    }
  }));

Deno.test("sendSms: real mode empty recipients list returns Err (not throw)", () =>
  withRealModeEnv(async () => {
    installMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ SMSMessageData: { Recipients: [] } }), {
          status: 200,
        }),
      ),
    );
    try {
      const result = await sendSms(basePayload);
      assert(result.isErr());
      assertEquals(result.error.message, "Africa's Talking returned empty recipients list");
    } finally {
      restoreFetch();
    }
  }));

Deno.test("sendSms: real mode success status code returns sent", () =>
  withRealModeEnv(async () => {
    installMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            SMSMessageData: {
              Recipients: [{ messageId: "msg-1", statusCode: 101 }],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    try {
      const result = await sendSms(basePayload);
      assert(result.isOk());
      assertEquals(result.value.status, "sent");
      assertEquals(result.value.message_id, "msg-1");
    } finally {
      restoreFetch();
    }
  }));

Deno.test("sendSms: real mode non-success status code returns bounced", () =>
  withRealModeEnv(async () => {
    installMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            SMSMessageData: {
              Recipients: [{ statusCode: 406 }],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    try {
      const result = await sendSms(basePayload);
      assert(result.isOk());
      assertEquals(result.value.status, "bounced");
      assertEquals(result.value.bounce_reason, "at_status_406");
    } finally {
      restoreFetch();
    }
  }));

// ============================================================================
// Mock-mode configured bounce phone, status-code boundaries, request body
// ============================================================================

Deno.test("sendSms: mock mode bounces exactly the configured BOUNCE_PHONE", () =>
  withIsolateEnv({ AT_API_KEY: "test_at_mock_key", BOUNCE_PHONE: "+254711111111" }, async () => {
    const bounced = await sendSms({ ...basePayload, to: "+254711111111" });
    assert(bounced.isOk());
    assertEquals(bounced.value.status, "bounced");
    assertEquals(bounced.value.bounce_reason, "invalid_phone_number");
    const sent = await sendSms({ ...basePayload, to: "+254722222222" });
    assert(sent.isOk());
    assertEquals(sent.value.status, "sent");
  }));

function recipientsResponse(statusCode: number): Response {
  return new Response(
    JSON.stringify({ SMSMessageData: { Recipients: [{ messageId: "msg-x", statusCode }] } }),
    { status: 200 },
  );
}

for (const [code, status] of [[99, "bounced"], [100, "sent"], [101, "sent"], [102, "sent"], [103, "bounced"]] as const) {
  Deno.test(`sendSms: real mode AT statusCode ${code} is ${status}`, () =>
    withRealModeEnv(async () => {
      installMockFetch(() => Promise.resolve(recipientsResponse(code)));
      try {
        const result = await sendSms(basePayload);
        assert(result.isOk());
        assertEquals(result.value.status, status);
        if (status === "bounced") assertEquals(result.value.bounce_reason, `at_status_${code}`);
      } finally {
        restoreFetch();
      }
    }));
}

Deno.test("sendSms: real mode posts recipient, sender id, username and message as form fields", () =>
  withIsolateEnv(
    { AT_API_KEY: "real_live_key_not_mock", DENO_ENV: undefined, NODE_ENV: undefined, AT_USERNAME: "acme", AT_SENDER_ID: "ACMEBET" },
    async () => {
      let seen: { url: string; init?: RequestInit } | undefined;
      installMockFetch((input, init) => {
        seen = { url: String(input), init };
        return Promise.resolve(recipientsResponse(101));
      });
      try {
        await sendSms(basePayload);
        assert(seen);
        assertEquals(seen.url, "https://api.africastalking.com/version1/messaging");
        assertEquals(seen.init?.method, "POST");
        const form = new URLSearchParams(String(seen.init?.body));
        assertEquals(form.get("to"), basePayload.to);
        assertEquals(form.get("from"), "ACMEBET");
        assertEquals(form.get("username"), "acme");
        assert((form.get("message") ?? "").length > 0);
      } finally {
        restoreFetch();
      }
    },
  ));
