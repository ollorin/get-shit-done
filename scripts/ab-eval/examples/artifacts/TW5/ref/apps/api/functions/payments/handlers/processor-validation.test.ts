import { assertEquals } from "@std/assert";
import { validateProcessorFields } from "./processor-validation.ts";

const NUL = "\u0000";
const LONE_SURROGATE = "\ud800";

Deno.test("validateProcessorFields: a storable name and lists pass (positive control)", () => {
  assertEquals(
    validateProcessorFields({
      name: "Acme Pay",
      supported_currencies: ["USD", "EUR"],
      supported_countries: ["GB"],
    }),
    null,
  );
});

Deno.test("validateProcessorFields: name with NUL or an unpaired surrogate is refused", () => {
  for (const bad of [`Acme${NUL}Pay`, `Acme${LONE_SURROGATE}`]) {
    assertEquals(
      validateProcessorFields({ name: bad }),
      "name must be a non-empty string of at most 256 characters without NUL characters",
    );
  }
});

Deno.test("validateProcessorFields: name over 256 chars or blank is still refused", () => {
  assertEquals(
    typeof validateProcessorFields({ name: "a".repeat(257) }),
    "string",
  );
  assertEquals(typeof validateProcessorFields({ name: "   " }), "string");
});

Deno.test("validateProcessorFields: NUL or surrogate inside a currency/country list item is refused, per field", () => {
  for (const field of ["supported_currencies", "supported_countries"]) {
    for (const bad of [`US${NUL}`, `U${LONE_SURROGATE}`]) {
      assertEquals(
        validateProcessorFields({ [field]: ["GB", bad] }),
        `${field} must be an array of short strings without NUL characters`,
      );
    }
  }
});

Deno.test("validateProcessorFields: webhook_ip_allowlist accepts valid IPv4 (boundary octets) and IPv6", () => {
  assertEquals(
    validateProcessorFields({
      webhook_ip_allowlist: [
        "0.0.0.0",
        "10.1.2.3",
        "255.255.255.255",
        "2001:db8::1",
        "::1",
      ],
    }),
    null,
  );
});

Deno.test("validateProcessorFields: webhook_ip_allowlist refuses an octet above 255 and malformed addresses, naming each", () => {
  for (const bad of ["256.0.0.1", "1.2.3.256", "1.2.3", "1.2.3.4.5", "nope"]) {
    assertEquals(
      validateProcessorFields({ webhook_ip_allowlist: ["10.0.0.1", bad] }),
      `Invalid IP addresses in webhook_ip_allowlist: ${bad}`,
    );
  }
});

Deno.test("validateProcessorFields: webhook_ip_allowlist must be an array of strings", () => {
  const message = "webhook_ip_allowlist must be an array of IP addresses";
  assertEquals(validateProcessorFields({ webhook_ip_allowlist: "10.0.0.1" }), message);
  assertEquals(validateProcessorFields({ webhook_ip_allowlist: [10] }), message);
});

Deno.test("validateProcessorFields: async_poll_timeout_minutes accepts 1..10080 and refuses outside or non-integers", () => {
  for (const ok of [1, 60, 10080]) {
    assertEquals(validateProcessorFields({ async_poll_timeout_minutes: ok }), null);
  }
  for (const bad of [0, -5, 10081, 1.5, "5"]) {
    assertEquals(
      validateProcessorFields({ async_poll_timeout_minutes: bad }),
      "async_poll_timeout_minutes must be an integer between 1 and 10080",
    );
  }
});

Deno.test("validateProcessorFields: webhook_secret allows null and up to 1024 characters, refuses longer or non-strings", () => {
  assertEquals(validateProcessorFields({ webhook_secret: null }), null);
  assertEquals(validateProcessorFields({ webhook_secret: "s".repeat(1024) }), null);
  const message = "webhook_secret must be a string of at most 1024 characters";
  assertEquals(validateProcessorFields({ webhook_secret: "s".repeat(1025) }), message);
  assertEquals(validateProcessorFields({ webhook_secret: 12345 }), message);
});

Deno.test("validateProcessorFields: is_active must be a boolean", () => {
  assertEquals(validateProcessorFields({ is_active: true }), null);
  assertEquals(validateProcessorFields({ is_active: false }), null);
  for (const bad of ["true", 1, null]) {
    assertEquals(validateProcessorFields({ is_active: bad }), "is_active must be a boolean");
  }
});

Deno.test("validateProcessorFields: JSON object columns must be objects", () => {
  assertEquals(validateProcessorFields({ credentials: { api_key: "k" } }), null);
  assertEquals(validateProcessorFields({ credentials: "k" }), "credentials must be an object");
  assertEquals(validateProcessorFields({ circuit_breaker_config: [] }), "circuit_breaker_config must be an object");
});
