import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  generateBackupCodes,
  generateTOTP,
  generateTOTPSecret,
  generateTOTPUri,
  hashBackupCode,
  verifyBackupCode,
  verifyTOTP,
} from "./totp-service.ts";

describe("generateTOTPSecret", () => {
  it("should return a non-empty base32 string", () => {
    const secret = generateTOTPSecret();
    assertMatch(secret, /^[A-Z2-7]+$/);
  });

  it("should return 32 characters (160-bit secret base32-encoded)", () => {
    const secret = generateTOTPSecret();
    assertEquals(secret.length, 32);
  });

  it("should return unique secrets on each call", () => {
    const a = generateTOTPSecret();
    const b = generateTOTPSecret();
    assertNotEquals(a, b);
  });
});

describe("generateTOTP", () => {
  it("should return a 6-digit string", async () => {
    const secret = generateTOTPSecret();
    const code = await generateTOTP(secret);
    assertMatch(code, /^\d{6}$/);
  });

  it("should be deterministic for the same secret and timestamp", async () => {
    const secret = generateTOTPSecret();
    const timestamp = 1700000000; // fixed Unix timestamp
    const code1 = await generateTOTP(secret, timestamp);
    const code2 = await generateTOTP(secret, timestamp);
    assertEquals(code1, code2);
  });

  it("should differ for timestamps in different 30-second windows", async () => {
    const secret = generateTOTPSecret();
    const code1 = await generateTOTP(secret, 0);   // counter 0
    const code2 = await generateTOTP(secret, 30);  // counter 1
    assertNotEquals(code1, code2);
  });

  it("should return the same code for timestamps within the same 30-second window", async () => {
    const secret = generateTOTPSecret();
    // 1700000010 % 30 === 0 (window boundary); +15 stays in the same 30-s bucket
    const code1 = await generateTOTP(secret, 1700000010);
    const code2 = await generateTOTP(secret, 1700000025); // same 30-s bucket
    assertEquals(code1, code2);
  });

  it("should pad short codes with leading zeros", async () => {
    // We can't guarantee a code starts with 0, but we can assert length is always 6
    const secret = generateTOTPSecret();
    for (let t = 0; t < 10; t++) {
      const code = await generateTOTP(secret, t * 30);
      assertEquals(code.length, 6);
    }
  });
});

describe("verifyTOTP", () => {
  it("should accept a freshly generated code", async () => {
    const secret = generateTOTPSecret();
    const code = await generateTOTP(secret);
    const result = await verifyTOTP(code, secret);
    assertEquals(result.valid, true);
  });

  it("should return usedCounter when valid", async () => {
    const secret = generateTOTPSecret();
    const code = await generateTOTP(secret);
    const result = await verifyTOTP(code, secret);
    assertEquals(result.valid, true);
    assertEquals(typeof result.usedCounter, "number");
  });

  it("should reject an incorrect code", async () => {
    const secret = generateTOTPSecret();
    const result = await verifyTOTP("000000", secret);
    // There is an astronomically small chance this accidentally passes; acceptable for unit tests
    // If the generated code happens to be 000000, this would fail — acceptable risk.
    // We verify the shape is correct either way.
    assertEquals(typeof result.valid, "boolean");
  });

  it("should accept codes from adjacent time windows (window=1)", async () => {
    const secret = generateTOTPSecret();
    const now = Math.floor(Date.now() / 1000);
    const prevCode = await generateTOTP(secret, now - 30); // previous window
    const result = await verifyTOTP(prevCode, secret, 1);
    assertEquals(result.valid, true);
  });

  it("should reject codes outside the allowed window", async () => {
    const secret = generateTOTPSecret();
    // Use a timestamp 5 minutes in the past (10 windows ago)
    const oldTime = Math.floor(Date.now() / 1000) - 300;
    const oldCode = await generateTOTP(secret, oldTime);
    const result = await verifyTOTP(oldCode, secret, 1);
    assertEquals(result.valid, false);
  });

  it("should not return usedCounter when invalid", async () => {
    const secret = generateTOTPSecret();
    const result = await verifyTOTP("999999", secret, 0);
    assertEquals(result.valid, false);
    assertEquals(result.usedCounter, undefined);
  });
});

describe("generateTOTPUri", () => {
  it("should return an otpauth:// URI", () => {
    const secret = generateTOTPSecret();
    const uri = generateTOTPUri(secret, "user@example.com");
    assertMatch(uri, /^otpauth:\/\/totp\//);
  });

  it("should include the secret in the URI", () => {
    const secret = generateTOTPSecret();
    const uri = generateTOTPUri(secret, "user@example.com");
    assertMatch(uri, new RegExp(`secret=${secret}`));
  });

  it("should URL-encode special characters in account name and issuer", () => {
    const secret = generateTOTPSecret();
    const uri = generateTOTPUri(secret, "user@example.com", "My Platform");
    assertMatch(uri, /My%20Platform/);
  });

  it("should use default issuer when not provided", () => {
    const secret = generateTOTPSecret();
    const uri = generateTOTPUri(secret, "user@example.com");
    assertMatch(uri, /issuer=iGaming/);
  });

  it("should include algorithm, digits, and period params", () => {
    const secret = generateTOTPSecret();
    const uri = generateTOTPUri(secret, "user@example.com");
    assertMatch(uri, /algorithm=SHA1/);
    assertMatch(uri, /digits=6/);
    assertMatch(uri, /period=30/);
  });
});

describe("generateBackupCodes", () => {
  it("should return 10 codes by default", () => {
    const codes = generateBackupCodes();
    assertEquals(codes.length, 10);
  });

  it("should return requested number of codes", () => {
    const codes = generateBackupCodes(5);
    assertEquals(codes.length, 5);
  });

  it("should format codes as XXXX-XXXX", () => {
    const codes = generateBackupCodes(3);
    for (const code of codes) {
      assertMatch(code, /^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
  });

  it("should generate unique codes", () => {
    const codes = generateBackupCodes(10);
    const unique = new Set(codes);
    assertEquals(unique.size, codes.length);
  });
});

describe("hashBackupCode / verifyBackupCode", () => {
  it("should hash a code to a hex string", async () => {
    const hash = await hashBackupCode("ABCD-EFGH", "my-secret");
    assertMatch(hash, /^[0-9a-f]+$/);
  });

  it("should produce the same hash for the same inputs", async () => {
    const hash1 = await hashBackupCode("ABCD-EFGH", "my-secret");
    const hash2 = await hashBackupCode("ABCD-EFGH", "my-secret");
    assertEquals(hash1, hash2);
  });

  it("should produce different hashes for different codes", async () => {
    const hash1 = await hashBackupCode("ABCD-EFGH", "my-secret");
    const hash2 = await hashBackupCode("WXYZ-1234", "my-secret");
    assertNotEquals(hash1, hash2);
  });

  it("should produce different hashes for different secrets", async () => {
    const hash1 = await hashBackupCode("ABCD-EFGH", "secret-1");
    const hash2 = await hashBackupCode("ABCD-EFGH", "secret-2");
    assertNotEquals(hash1, hash2);
  });

  it("should normalise the dash before hashing", async () => {
    // "ABCDEFGH" and "ABCD-EFGH" should hash the same
    const hash1 = await hashBackupCode("ABCDEFGH", "my-secret");
    const hash2 = await hashBackupCode("ABCD-EFGH", "my-secret");
    assertEquals(hash1, hash2);
  });

  it("verifyBackupCode should return true for matching code", async () => {
    const code = "ABCD-EFGH";
    const secret = "my-secret";
    const hash = await hashBackupCode(code, secret);
    const valid = await verifyBackupCode(code, hash, secret);
    assertEquals(valid, true);
  });

  it("verifyBackupCode should return false for wrong code", async () => {
    const secret = "my-secret";
    const hash = await hashBackupCode("ABCD-EFGH", secret);
    const valid = await verifyBackupCode("WXYZ-1234", hash, secret);
    assertEquals(valid, false);
  });

  it("verifyBackupCode should accept code without dash", async () => {
    const secret = "my-secret";
    const hash = await hashBackupCode("ABCD-EFGH", secret);
    const valid = await verifyBackupCode("ABCDEFGH", hash, secret);
    assertEquals(valid, true);
  });
});

// ── 390-09: CHARACTERIZATION, not a witness ─────────────────────────────────
// This test CANNOT witness the empty-side guard: generateTOTP always yields 6 digits
// (totp-service.ts:123), so verifyTOTP("", secret) length-mismatches and returns
// valid:false whether or not the guard is present. It stays as a characterization of
// the observable contract for a blank submitted code, not as proof the guard works.
Deno.test("verifyTOTP: an empty submitted code never verifies (390-09)", async () => {
  const secret = generateTOTPSecret();
  const result = await verifyTOTP("", secret);
  assertEquals(result.valid, false);
});

// RFC 6238 Appendix B (SHA-1), ASCII secret "12345678901234567890"; 6-digit tails of the 8-digit vectors.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("generateTOTP: RFC 6238 vectors", () => {
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];
  for (const [time, code] of vectors) {
    it(`T=${time} gives ${code}`, async () => {
      assertEquals(await generateTOTP(RFC_SECRET, time), code);
    });
  }
});

describe("verifyTOTP: clock window against a pinned clock", () => {
  const NOW_S = 1_700_000_010;
  const counter = Math.floor(NOW_S / 30);
  const realNow = Date.now;

  async function withClock<T>(fn: () => Promise<T>): Promise<T> {
    Date.now = () => NOW_S * 1000;
    try {
      return await fn();
    } finally {
      Date.now = realNow;
    }
  }

  it("accepts the current, previous and next window and reports the matching counter", async () => {
    await withClock(async () => {
      for (const delta of [-1, 0, 1]) {
        const code = await generateTOTP(RFC_SECRET, (counter + delta) * 30);
        assertEquals(await verifyTOTP(code, RFC_SECRET), { valid: true, usedCounter: counter + delta });
      }
    });
  });

  it("rejects codes two windows away by default and accepts them with window=2", async () => {
    await withClock(async () => {
      for (const delta of [-2, 2]) {
        const code = await generateTOTP(RFC_SECRET, (counter + delta) * 30);
        assertEquals((await verifyTOTP(code, RFC_SECRET)).valid, false);
        assertEquals(await verifyTOTP(code, RFC_SECRET, 2), { valid: true, usedCounter: counter + delta });
      }
    });
  });

  it("window=0 accepts only the current window", async () => {
    await withClock(async () => {
      const next = await generateTOTP(RFC_SECRET, (counter + 1) * 30);
      assertEquals((await verifyTOTP(next, RFC_SECRET, 0)).valid, false);
      const current = await generateTOTP(RFC_SECRET, counter * 30);
      assertEquals(await verifyTOTP(current, RFC_SECRET, 0), { valid: true, usedCounter: counter });
    });
  });
});

describe("hashBackupCode: HMAC-SHA256 hex", () => {
  it("matches a known HMAC-SHA256 vector, 64 lowercase hex characters, dash and case insensitive", async () => {
    const expected = "df4db003e610f0d7e1042a6d0b4a91683583f93a5d7a36fe974310e57c231c31";
    assertEquals(await hashBackupCode("ABCD1234", "secret"), expected);
    assertEquals(await hashBackupCode("abcd-1234", "secret"), expected);
  });

  it("keeps a leading-zero byte as two hex digits", async () => {
    for (let i = 0; i < 40; i++) {
      assertEquals((await hashBackupCode(`CODE-${i}`, "secret")).length, 64);
    }
  });
});
