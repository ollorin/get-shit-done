/**
 * Unit tests for crash-multiplayer-handlers.ts (Phase 285, coverage-remediation workstream).
 *
 * This 885-line file had ZERO test coverage before this plan and contains 29
 * distinct `createErrorResponse(...)` branches across its 7 exported handlers
 * (`handleMultiplayerBet`, `handleMultiplayerCashout`, `handleMultiplayerCancelBet`,
 * `handleGetCurrentRound`, `handleGetRoundHistory`, `handleVerifyMultiplayerRound`,
 * `handleVerifyByRoundNumber`). This suite drives every one of those branches plus
 * multiple success-path variations (normal wallet debit vs. bonus split-bet, normal
 * cashout vs. split-group settlement, phase-gated crash_point reveal logic, and the
 * `??` fallback chains inside `buildVerificationResponse`).
 *
 * Mock convention: a Proxy-backed chainable mock (same pattern as
 * bonus/bonus-handlers-coverage.test.ts's `makeChainable()`/`makeBonusSupabase()`),
 * extended with `fromSequence` for tables this file queries more than once per
 * request (e.g. `crash_bets` is queried once for an existence/status check and
 * again for the insert/update; `crash_shared_rounds` and `crash_hash_chains` are
 * each queried multiple times inside `buildVerificationResponse`'s `Promise.all`).
 * `broadcastEvent`'s separate service client is mocked via
 * `setBroadcastServiceClientOverride()` following the exact `withBroadcastMock`
 * convention established in functions/crash-worker/state-machine.test.ts.
 *
 * Run: deno test --allow-all --import-map=../import_map.json crash-multiplayer-handlers.test.ts
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccessSession } from "@igaming/domain";
import { crashDurationMs } from "@igaming/domain";
import { alertingService } from "@igaming/infrastructure";
import type { TechnicalAlertPayload } from "@igaming/infrastructure";
import { withBroadcastStub } from "../../../libs/test-utils/broadcast-test.ts";
import {
  handleGetCurrentRound,
  handleGetRoundHistory,
  handleMultiplayerBet,
  handleMultiplayerCancelBet,
  handleMultiplayerCashout,
  handleVerifyByRoundNumber,
  handleVerifyMultiplayerRound,
} from "./crash-multiplayer-handlers.ts";

// ============================================================================
// Chainable Supabase mock (bonus-handlers-coverage.test.ts convention)
// ============================================================================

type ChainResult = { data?: unknown; error?: unknown } | { __reject: unknown };

// deno-lint-ignore no-explicit-any
function makeChainable(result: ChainResult): any {
  const buildPromise =
    () => ("__reject" in result
      ? Promise.reject(result.__reject)
      : Promise.resolve(result));
  return new Proxy(function chainable() {}, {
    get(_target, prop) {
      if (prop === "then") {
        // deno-lint-ignore no-explicit-any
        return (onFulfilled: any, onRejected: any) =>
          buildPromise().then(onFulfilled, onRejected);
      }
      if (prop === "catch") {
        // deno-lint-ignore no-explicit-any
        return (onRejected: any) => buildPromise().catch(onRejected);
      }
      if (prop === "finally") {
        // deno-lint-ignore no-explicit-any
        return (onFinally: any) => buildPromise().finally(onFinally);
      }
      // deno-lint-ignore no-explicit-any
      return (..._args: any[]) => makeChainable(result);
    },
  });
}

interface CrashSupabaseOpts {
  rpc?: Record<string, ChainResult>;
  from?: Record<string, ChainResult>;
  /** Per-table, per-call-order overrides — the Nth `.from(table)` call for a
   * given table name returns `fromSequence[table][N]` if present, otherwise
   * falls back to `from[table]`. */
  fromSequence?: Record<string, ChainResult[]>;
}

function makeCrashSupabase(
  opts: CrashSupabaseOpts = {},
  capture?: { rpcCalls: Record<string, unknown[]> },
  /** Optional per-table `.from()` call counter, so a test can pin read COUNTS. */
  fromCounts?: Record<string, number>,
): SupabaseClient {
  const rpcResults = opts.rpc ?? {};
  const fromResults = fromResultsWithDefaults(opts);
  const fromCallIndex: Record<string, number> = {};
  const nextFromResult = (table: string): ChainResult => {
    if (fromCounts) fromCounts[table] = (fromCounts[table] ?? 0) + 1;
    const idx = fromCallIndex[table] ?? 0;
    fromCallIndex[table] = idx + 1;
    const seq = opts.fromSequence?.[table];
    return (seq && seq[idx]) ?? fromResults[table] ??
      { data: null, error: null };
  };
  const schemaObj = {
    rpc: (fnName: string, params?: unknown) => {
      if (capture) {
        capture.rpcCalls = {
          ...capture.rpcCalls,
          [fnName]: [...(capture.rpcCalls[fnName] ?? []), params],
        };
      }
      return makeChainable(rpcResults[fnName] ?? { data: null, error: null });
    },
    from: (table: string) => makeChainable(nextFromResult(table)),
  };
  return {
    schema: () => schemaObj,
    from: (table: string) => makeChainable(nextFromResult(table)),
  } as unknown as SupabaseClient;
}

/**
 * Default per-table `from` results. `player_balances` carries a USD row by
 * default because handleMultiplayerBet derives its betting currency from the
 * player's wallet balance rows (SC-3, ADR-0011 — never a literal fallback);
 * tests that exercise the fail-closed path override it with `{ data: null }`.
 *
 * 388-06 (D9) changed the read shape: crash-bet-handlers.ts:276-281 selects every
 * row `.order('currency', { ascending: true })` and maps the array, so the fixture is an
 * ARRAY — one row per held currency, ordered — not a single object.
 */
const DEFAULT_FROM_RESULTS: Record<string, ChainResult> = {
  player_balances: { data: [{ currency: "USD" }], error: null },
  // 384-09 R4: `crash_point` is NULL all ACTIVE, so the guard resolves from `crash_hash_chains`; an
  // unseeded chain row FAILS CLOSED with a 500. 100.0 is this file's "never reached" convention. See 384-09-PLAN.md.
  crash_hash_chains: { data: { crash_point: 100.0 }, error: null },
};

function fromResultsWithDefaults(
  opts: CrashSupabaseOpts,
): Record<string, ChainResult> {
  return { ...DEFAULT_FROM_RESULTS, ...opts.from };
}

// ============================================================================
// Session, round fixture, and broadcast-mock helpers
// ============================================================================

function makeSession(id = "player-uuid-001"): AccessSession {
  return {
    playerAccountId: id,
    role: "player",
    deviceId: "device-001",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    requires2FA: false,
  } as unknown as AccessSession;
}

const CORS_HEADERS = {};

function makeRound(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "d87609d0-a636-48f4-89b2-bf738e72cc35",
    variant_id: "b1111111-1111-4111-8111-111111111111",
    round_number: 42,
    phase: "betting",
    betting_ends_at: new Date(Date.now() + 60_000).toISOString(),
    start_timestamp: null,
    crashed_at: null,
    crash_point: null,
    created_at: new Date().toISOString(),
    server_seed: "seed-abc",
    hash_chain_index: 5,
    ...overrides,
  };
}

/**
 * Configures broadcastEvent's separate service client (emit_event RPC) — same
 * `withBroadcastMock` convention as functions/crash-worker/state-machine.test.ts.
 * All 3 mutation handlers here call broadcastEvent fire-and-forget
 * (`.match(() => {}, ...)`), so the override just needs `.rpc(...)` to resolve;
 * the downstream `.channel(...)` call is itself wrapped in a non-fatal
 * ResultAsync.fromPromise(...).match(...) inside broadcastEvent(), so a mock
 * lacking `.channel()` is safe (no unhandled rejection, no timer leak).
 */
function withBroadcastMock<T>(fn: () => Promise<T>): Promise<T> {
  return withBroadcastStub({
    rpc: (_name: string, _args: Record<string, unknown>) =>
      Promise.resolve({ data: { seq: 1 }, error: null }),
    // deno-lint-ignore no-explicit-any
  } as any, fn);
}

// ============================================================================
// handleMultiplayerBet
// ============================================================================

Deno.test("handleMultiplayerBet: missing bet_amount — 400", async () => {
  const supabase = makeCrashSupabase();
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {},
    CORS_HEADERS,
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertEquals(body.error.message, "bet_amount must be a positive number");
});

Deno.test("handleMultiplayerBet: bet_amount is zero — 400", async () => {
  const supabase = makeCrashSupabase();
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 0,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 400);
});

Deno.test("handleMultiplayerBet: bet_amount is wrong type (string) — 400", async () => {
  const supabase = makeCrashSupabase();
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: "10",
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 400);
});

Deno.test("handleMultiplayerBet: auto_cashout_at below minimum — 400", async () => {
  const supabase = makeCrashSupabase();
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    { bet_amount: 10, auto_cashout_at: 1.0 },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertEquals(
    body.error.message,
    "auto_cashout_at must be between 1.01 and 99999999.99",
  );
});

Deno.test("handleMultiplayerBet: round not found — 404", async () => {
  const supabase = makeCrashSupabase({
    from: { crash_shared_rounds: { data: null, error: null } },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 404);
  const body = await resp.json();
  assertEquals(body.error.message, "Round not found");
});

Deno.test("handleMultiplayerBet: round lookup QUERY ERROR — 500 retryable, never 404", async () => {
  // A transient DB/PostgREST failure must NOT be reported as "Round not found"
  // (terminal denial) — it must surface as a retryable INTERNAL_ERROR.
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: {
        data: null,
        error: { message: "connection timeout" },
      },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 500);
  const body = await resp.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
  assertEquals(body.error.message, "Failed to place bet");
});

Deno.test("handleMultiplayerBet: round not in betting phase — 409", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: {
        data: makeRound({ phase: "active" }),
        error: null,
      },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 409);
  const body = await resp.json();
  assertEquals(body.error.message, "Round is not in betting phase");
});

Deno.test("handleMultiplayerBet: betting window has closed — 409", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: {
        data: makeRound({
          betting_ends_at: new Date(Date.now() - 10_000).toISOString(),
        }),
        error: null,
      },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 409);
  const body = await resp.json();
  assertEquals(body.error.message, "Betting window has closed");
});

Deno.test("handleMultiplayerBet: bet exceeds custom maxBet from game metadata — 422", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: { data: makeRound(), error: null },
      games: { data: { metadata: { maxBet: 50 } }, error: null },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 100,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 422);
  const body = await resp.json();
  assertEquals(body.error.message, "Bet exceeds maximum allowed bet of 50");
});

Deno.test("handleMultiplayerBet: bet exceeds default maxBet (1000) when game row missing — 422", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: { data: makeRound(), error: null },
      games: { data: null, error: null },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 1500,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 422);
  const body = await resp.json();
  assertEquals(body.error.message, "Bet exceeds maximum allowed bet of 1000");
});

Deno.test("handleMultiplayerBet: player already has a bet on this round — 409", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: { data: makeRound(), error: null },
      games: { data: null, error: null },
      crash_bets: { data: { id: "existing-bet-1" }, error: null },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 409);
  const body = await resp.json();
  assertEquals(body.error.message, "You already have a bet on this round");
});

Deno.test("handleMultiplayerBet: RG player-excluded error — 403 with friendly exclusion message", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: { data: makeRound(), error: null },
      games: { data: null, error: null },
      crash_bets: { data: null, error: null },
    },
    rpc: {
      rg_check_bet_allowed: {
        data: null,
        error: { message: "RG_PLAYER_EXCLUDED: player is self-excluded" },
      },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 403);
  const body = await resp.json();
  assertEquals(
    body.error.message,
    "You are currently self-excluded from wagering",
  );
});

Deno.test("handleMultiplayerBet: RG limit-exceeded error — 403 with friendly limit message", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: { data: makeRound(), error: null },
      games: { data: null, error: null },
      crash_bets: { data: null, error: null },
    },
    rpc: {
      rg_check_bet_allowed: {
        data: null,
        error: { message: "RG_LIMIT_EXCEEDED: daily wagering limit" },
      },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 403);
  const body = await resp.json();
  assertEquals(body.error.message, "You've reached your loss limit");
});

Deno.test("handleMultiplayerBet: RG generic/unrecognized error — 403 with fallback message", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: { data: makeRound(), error: null },
      games: { data: null, error: null },
      crash_bets: { data: null, error: null },
    },
    rpc: {
      rg_check_bet_allowed: {
        data: null,
        error: { message: "unexpected DB timeout" },
      },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 403);
  const body = await resp.json();
  assertEquals(
    body.error.message,
    "Bet not allowed by responsible gaming limits",
  );
});

Deno.test("handleMultiplayerBet: wallet_debit fails (insufficient balance, no bonus) — 402", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: { data: makeRound(), error: null },
      games: { data: null, error: null },
      crash_bets: { data: null, error: null },
    },
    rpc: {
      rg_check_bet_allowed: { data: null, error: null },
      bonus_validate_bet: {
        data: { valid: true, active_bonuses: 0 },
        error: null,
      },
      wallet_debit: {
        data: null,
        error: {
          message:
            "INSUFFICIENT_BALANCE: Available 0 < requested 10 for player p1",
        },
      },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 402);
  const body = await resp.json();
  assertEquals(body.error.message, "Insufficient balance");
});

Deno.test("[R3-C3] handleMultiplayerBet: wallet_place_split_bet transport failure (bonus active) — 503 SERVICE_UNAVAILABLE", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: { data: makeRound(), error: null },
      games: { data: null, error: null },
      crash_bets: { data: null, error: null },
      // F1 fix: hasBonusSplit now triggers a real grant-fetch — mock one active
      // grant row so the handler reaches wallet_place_split_bet instead of
      // falling back to the normal debit path (F1-T3 null-grant fallback).
      player_bonus_balances: {
        data: { bonus_grant_id: "grant-uuid-402", balance: 5 },
        error: null,
      },
    },
    rpc: {
      rg_check_bet_allowed: { data: null, error: null },
      bonus_validate_bet: {
        data: { valid: true, active_bonuses: 1 },
        error: null,
      },
      wallet_place_split_bet: {
        data: null,
        error: { message: "connection reset by peer" },
      },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 503);
  const body = await resp.json();
  assertEquals(body.error.code, "SERVICE_UNAVAILABLE");
  assertEquals(body.error.message, "Wallet temporarily unavailable");
});

Deno.test("[R3-C4] handleMultiplayerBet: wallet_place_split_bet balance refusal (bonus active) — 402 Insufficient balance", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: { data: makeRound(), error: null },
      games: { data: null, error: null },
      crash_bets: { data: null, error: null },
      player_bonus_balances: {
        data: { bonus_grant_id: "grant-uuid-402", balance: 5 },
        error: null,
      },
    },
    rpc: {
      rg_check_bet_allowed: { data: null, error: null },
      bonus_validate_bet: {
        data: { valid: true, active_bonuses: 1 },
        error: null,
      },
      wallet_place_split_bet: {
        data: null,
        error: {
          message:
            "INSUFFICIENT_BALANCE: Available 0 < requested 10 for player p1",
        },
      },
    },
  });
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {
      bet_amount: 10,
    },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 402);
  const body = await resp.json();
  assertEquals(body.error.message, "Insufficient balance");
});

// [R4-D1] wallet_place_split_bet raises its own codes (20261018100100, latest definition) and
// re-raises bonus_validate_bet codes as '%: %' (20261018100000, which raises INVALID_CURRENCY
// directly). Each is classified by the split set, never by the wallet_debit set. Raw RAISE text
// must never reach the body.
const SPLIT_RAISE_CASES: ReadonlyArray<
  readonly [raw: string, status: number, message: string]
> = [
  [
    "INSUFFICIENT_BONUS_BALANCE: Bonus balance 1 < required 5 for grant g",
    402,
    "Insufficient balance",
  ],
  [
    'MAX_BET_EXCEEDED: {"valid": false, "max_bet": 5}',
    422,
    "Wallet debit failed",
  ],
  [
    'GAME_RESTRICTED: {"valid": false, "game_id": "crash"}',
    422,
    "Wallet debit failed",
  ],
  [
    "INVALID_BONUS_STATE: Micro-wallet m is in status expired (expected active)",
    422,
    "Wallet debit failed",
  ],
  [
    "SPLIT_AMOUNT_MISMATCH: splits sum 9 does not equal total 10",
    500,
    "Failed to place bet",
  ],
  [
    "IDEMPOTENCY_KEY_REUSED: key already used for a different split bet",
    422,
    "Wallet debit failed",
  ],
  [
    "REPLAY_OF_REVERSED: the original split bet was reversed or charged back",
    422,
    "Wallet debit failed",
  ],
  [
    "INVALID_CURRENCY: p_currency is required",
    500,
    "Failed to place bet",
  ],
];

for (const [raw, status, message] of SPLIT_RAISE_CASES) {
  Deno.test(`[R4-D1] handleMultiplayerBet: wallet_place_split_bet ${raw.split(":")[0]} (bonus active) — ${status} ${message}`, async () => {
    const supabase = makeCrashSupabase({
      from: {
        crash_shared_rounds: { data: makeRound(), error: null },
        games: { data: null, error: null },
        crash_bets: { data: null, error: null },
        player_bonus_balances: {
          data: { bonus_grant_id: "grant-uuid-d1", balance: 5 },
          error: null,
        },
      },
      rpc: {
        rg_check_bet_allowed: { data: null, error: null },
        bonus_validate_bet: {
          data: { valid: true, active_bonuses: 1 },
          error: null,
        },
        wallet_place_split_bet: { data: null, error: { message: raw } },
      },
    });
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      {
        bet_amount: 10,
      },
      CORS_HEADERS,
    );
    assertEquals(resp.status, status);
    const text = await resp.text();
    assertEquals(JSON.parse(text).error.message, message);
    assertEquals(text.includes(raw.split(":")[0]), false);
  });
}

Deno.test("handleMultiplayerBet: concurrent bet collision (duplicate status) — 422, wallet reversed", async () => {
  await withBroadcastMock(async () => {
    const supabase = makeCrashSupabase({
      from: {
        crash_shared_rounds: { data: makeRound(), error: null },
        games: { data: null, error: null },
      },
      fromSequence: {
        crash_bets: [
          { data: null, error: null }, // existence check — no prior bet
        ],
      },
      rpc: {
        rg_check_bet_allowed: { data: null, error: null },
        bonus_validate_bet: {
          data: { valid: true, active_bonuses: 0 },
          error: null,
        },
        wallet_debit: { data: { id: "tx-debit-1" }, error: null },
        wallet_create_reversal: { data: null, error: null },
        crash_place_bet_if_betting: {
          data: { status: "duplicate" },
          error: null,
        },
      },
    });
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 422);
    const body = await resp.json();
    assertEquals(
      body.error.message,
      "A bet is already in progress for this round",
    );
  });
});

Deno.test("handleMultiplayerBet: generic bet insert failure (non-23505) — 500, wallet reversed", async () => {
  await withBroadcastMock(async () => {
    const supabase = makeCrashSupabase({
      from: {
        crash_shared_rounds: { data: makeRound(), error: null },
        games: { data: null, error: null },
      },
      fromSequence: { crash_bets: [{ data: null, error: null }] },
      rpc: {
        rg_check_bet_allowed: { data: null, error: null },
        bonus_validate_bet: {
          data: { valid: true, active_bonuses: 0 },
          error: null,
        },
        wallet_debit: { data: { id: "tx-debit-1" }, error: null },
        wallet_create_reversal: { data: null, error: null },
        crash_place_bet_if_betting: {
          data: null,
          error: { code: "42P01", message: "relation missing" },
        },
      },
    });
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 500);
    const body = await resp.json();
    assertEquals(body.error.message, "Failed to place bet");
  });
});

Deno.test("handleMultiplayerBet: happy path — normal debit, no bonus — 200", async () => {
  await withBroadcastMock(async () => {
    const supabase = makeCrashSupabase({
      from: {
        crash_shared_rounds: { data: makeRound(), error: null },
        games: { data: null, error: null },
      },
      fromSequence: { crash_bets: [{ data: null, error: null }] },
      rpc: {
        rg_check_bet_allowed: { data: null, error: null },
        bonus_validate_bet: {
          data: { valid: true, active_bonuses: 0 },
          error: null,
        },
        wallet_debit: { data: { id: "tx-debit-1" }, error: null },
        crash_place_bet_if_betting: {
          data: {
            status: "inserted",
            bet: {
              id: "bet-1",
              bet_amount: 10,
              auto_cashout_at: null,
              status: "active",
              created_at: new Date().toISOString(),
            },
          },
          error: null,
        },
      },
    });
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.bet_id, "bet-1");
    assertEquals(body.round_id, "d87609d0-a636-48f4-89b2-bf738e72cc35");
    assertEquals(body.bet_amount, 10);
    assertEquals(body.status, "active");
  });
});

Deno.test("handleMultiplayerBet: happy path — bonus split bet active — 200", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: {
        crash_shared_rounds: { data: makeRound(), error: null },
        games: { data: null, error: null },
        // F1 fix: mock one active grant with a balance BELOW the bet amount so
        // the handler's p_splits construction produces a genuine mixed
        // real+bonus split (bonus capped at grant balance, real = remainder).
        player_bonus_balances: {
          data: { bonus_grant_id: "grant-uuid-happy", balance: 8 },
          error: null,
        },
      },
      fromSequence: { crash_bets: [{ data: null, error: null }] },
      rpc: {
        rg_check_bet_allowed: { data: null, error: null },
        bonus_validate_bet: {
          data: { valid: true, active_bonuses: 1 },
          error: null,
        },
        crash_place_bet_if_betting: {
          data: {
            status: "inserted",
            bet: {
              id: "bet-2",
              bet_amount: 20,
              auto_cashout_at: 2.5,
              status: "active",
              created_at: new Date().toISOString(),
            },
          },
          error: null,
        },
        wallet_place_split_bet: {
          data: { split_group_id: "split-group-1" },
          error: null,
        },
      },
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 20, auto_cashout_at: 2.5 },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.bet_id, "bet-2");
    assertEquals(body.auto_cashout_at, 2.5);

    // F1-T2 pin: wallet_place_split_bet must receive a p_splits array whose
    // amounts sum EXACTLY to betAmount, with the bonus entry carrying the
    // mocked grant's bonus_grant_id and game_category 'crash'.
    const splitCalls = capture.rpcCalls["wallet_place_split_bet"];
    assertExists(splitCalls, "wallet_place_split_bet must have been called");
    const splitArgs = splitCalls[0] as {
      p_total_amount: string;
      p_splits: Array<
        {
          balance_type: string;
          amount: string;
          bonus_grant_id?: string;
          game_category?: string;
        }
      >;
    };
    assertExists(
      splitArgs.p_splits,
      "p_splits must be present on the RPC call",
    );
    assert(
      Array.isArray(splitArgs.p_splits) && splitArgs.p_splits.length > 0,
      "p_splits must be a non-empty array",
    );
    assertEquals(splitArgs.p_total_amount, "20");
    assertEquals(
      splitArgs.p_splits.map((s) => s.amount).sort(),
      ["12", "8"],
      "p_splits decimal amounts must sum exactly to betAmount",
    );
    const bonusEntry = splitArgs.p_splits.find((s) =>
      s.balance_type === "bonus"
    );
    assertExists(bonusEntry, "p_splits must include a bonus entry");
    assertEquals(
      bonusEntry?.amount,
      "8",
      "bonus portion must be capped at the grant balance",
    );
    assertEquals(bonusEntry?.bonus_grant_id, "grant-uuid-happy");
    assertEquals(bonusEntry?.game_category, "crash");
    const realEntry = splitArgs.p_splits.find((s) => s.balance_type === "real");
    assertExists(realEntry, "p_splits must include the real remainder entry");
    assertEquals(
      realEntry?.amount,
      "12",
      "real portion must be the exact remainder (betAmount - bonusPortion)",
    );
  });
});

// SP tests: expected literals from 400-45-SUMMARY.md "Postgres probe" table (scale 8).
const runCrashBet = async (
  betAmount: number,
  bonusBalance: number | null,
): Promise<Record<string, AnyRecordCrash[]>> => {
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  await withBroadcastMock(async () => {
    const supabase = makeCrashSupabase({
      from: {
        crash_shared_rounds: { data: makeRound(), error: null },
        games: { data: null, error: null },
        ...(bonusBalance === null ? {} : {
          player_bonus_balances: {
            data: { bonus_grant_id: "grant-uuid-sp", balance: bonusBalance },
            error: null,
          },
        }),
      },
      fromSequence: { crash_bets: [{ data: null, error: null }] },
      rpc: {
        rg_check_bet_allowed: { data: null, error: null },
        bonus_validate_bet: {
          data: { valid: true, active_bonuses: bonusBalance === null ? 0 : 1 },
          error: null,
        },
        wallet_debit: { data: { id: "tx-debit-sp" }, error: null },
        crash_place_bet_if_betting: {
          data: {
            status: "inserted",
            bet: {
              id: "bet-sp",
              bet_amount: betAmount,
              auto_cashout_at: null,
              status: "active",
              created_at: new Date().toISOString(),
            },
          },
          error: null,
        },
        wallet_place_split_bet: {
          data: { split_group_id: "split-group-sp" },
          error: null,
        },
      },
    }, capture);
    await handleMultiplayerBet(
      supabase,
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: betAmount },
      CORS_HEADERS,
    );
  });
  return capture.rpcCalls as Record<string, AnyRecordCrash[]>;
};
// deno-lint-ignore no-explicit-any
type AnyRecordCrash = Record<string, any>;

Deno.test("SP1: split bet sends p_total_amount and split amounts as decimal strings (0.3 = 0.2 real + 0.1 bonus)", async () => {
  const calls = await runCrashBet(0.3, 0.1);
  const split = calls["wallet_place_split_bet"][0];
  assertEquals(split.p_total_amount, "0.3");
  const real = split.p_splits.find((s: AnyRecordCrash) =>
    s.balance_type === "real"
  );
  const bonus = split.p_splits.find((s: AnyRecordCrash) =>
    s.balance_type === "bonus"
  );
  assertEquals(real.amount, "0.2");
  assertEquals(bonus.amount, "0.1");
});

Deno.test("SP-SUM: split bet 7.81242188 with grant 5 sends 2.81242188 real + 5 bonus = 7.81242188", async () => {
  const calls = await runCrashBet(7.81242188, 5);
  const split = calls["wallet_place_split_bet"][0];
  assertEquals(split.p_total_amount, "7.81242188");
  const real = split.p_splits.find((s: AnyRecordCrash) =>
    s.balance_type === "real"
  );
  const bonus = split.p_splits.find((s: AnyRecordCrash) =>
    s.balance_type === "bonus"
  );
  assertEquals(real.amount, "2.81242188");
  assertEquals(bonus.amount, "5");
});

Deno.test("SP2: non-split crash bet sends wallet_debit p_amount as a decimal string", async () => {
  const calls = await runCrashBet(0.3, null);
  assertEquals(calls["wallet_debit"][0].p_amount, "0.3");
});

Deno.test("SP3: crash bet sends rg_check_bet_allowed and bonus_validate_bet p_amount as decimal strings", async () => {
  const calls = await runCrashBet(0.3, null);
  assertEquals(calls["rg_check_bet_allowed"][0].p_amount, "0.3");
  assertEquals(calls["bonus_validate_bet"][0].p_amount, "0.3");
});

Deno.test(
  "handleMultiplayerBet: active bonus but grant fetch races to null — falls back to normal debit (F1-T3)",
  async () => {
    await withBroadcastMock(async () => {
      const capture = { rpcCalls: {} as Record<string, unknown[]> };
      const supabase = makeCrashSupabase({
        from: {
          crash_shared_rounds: { data: makeRound(), error: null },
          games: { data: null, error: null },
          // F1-T3 race: bonus_validate_bet counted an active bonus, but the
          // grant is gone by the time the caller fetches it (e.g. expired or
          // converted in the interim) — the handler must fail-safe to the
          // plain debit path, never throw, never drop the bet.
          player_bonus_balances: { data: null, error: null },
        },
        fromSequence: {
          crash_bets: [{ data: null, error: null }],
        },
        rpc: {
          rg_check_bet_allowed: { data: null, error: null },
          bonus_validate_bet: {
            data: { valid: true, active_bonuses: 1 },
            error: null,
          },
          crash_place_bet_if_betting: {
            data: {
              status: "inserted",
              bet: {
                id: "bet-race",
                bet_amount: 10,
                auto_cashout_at: null,
                status: "active",
                created_at: new Date().toISOString(),
              },
            },
            error: null,
          },
          wallet_debit: { data: { id: "tx-debit-race" }, error: null },
        },
      }, capture);
      const resp = await handleMultiplayerBet(
        supabase,
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        { bet_amount: 10 },
        CORS_HEADERS,
      );
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.bet_id, "bet-race");
      assertExists(
        capture.rpcCalls["wallet_debit"],
        "F1-T3 fallback must use the plain wallet_debit path",
      );
      assertEquals(
        capture.rpcCalls["wallet_place_split_bet"],
        undefined,
        "must NOT call wallet_place_split_bet when the grant fetch races to null",
      );
    });
  },
);

// ============================================================================
// handleMultiplayerBet — currency seam (SC-3, ADR-0011, defect #11)
// ============================================================================
// The betting currency is derived from the player's wallet balance row
// (wallet.player_balances) — never from a literal fallback. The default mock
// returns a USD balance row; these tests exercise the derivation and the
// fail-closed path.

Deno.test("handleMultiplayerBet: body currency NGN vs wallet USD — 422 CURRENCY_MISMATCH, no money RPC", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: {
        crash_shared_rounds: { data: makeRound(), error: null },
        games: { data: null, error: null },
      },
      fromSequence: { crash_bets: [{ data: null, error: null }] },
      rpc: {
        rg_check_bet_allowed: { data: null, error: null },
        bonus_validate_bet: {
          data: { valid: true, active_bonuses: 0 },
          error: null,
        },
        crash_place_bet_if_betting: {
          data: {
            status: "inserted",
            bet: {
              id: "bet-cur-1",
              bet_amount: 10,
              status: "active",
              created_at: new Date().toISOString(),
            },
          },
          error: null,
        },
        wallet_debit: { data: { id: "tx-debit-cur-1" }, error: null },
      },
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession("player-uuid-currency"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10, currency: "NGN" }, // a contradicting body currency is refused before any money call
      CORS_HEADERS,
    );
    assertEquals(resp.status, 422, "[CM-NGN] status");
    const body = await resp.json();
    assertEquals(body.error.code, "CURRENCY_MISMATCH", "[CM-NGN] code");
    assertNoMoneyRpc(capture, "[CM-NGN]");
  });
});

const CURRENCY_ROUND_FROM = {
  crash_shared_rounds: { data: makeRound(), error: null },
  games: { data: null, error: null },
} as const;

const CURRENCY_BET_RPC: Record<string, ChainResult> = {
  rg_check_bet_allowed: { data: null, error: null },
  bonus_validate_bet: { data: { valid: true, active_bonuses: 0 }, error: null },
  wallet_debit: { data: { id: "tx-debit-currency" }, error: null },
  crash_place_bet_if_betting: {
    data: {
      status: "inserted",
      bet: {
        id: "bet-currency",
        bet_amount: 10,
        status: "active",
        created_at: new Date().toISOString(),
      },
    },
    error: null,
  },
};

const CURRENCY_BET_INSERT: ChainResult[] = [{ data: null, error: null }];

function assertNoMoneyRpc(
  capture: { rpcCalls: Record<string, unknown[]> },
  tag: string,
): void {
  assertEquals(
    capture.rpcCalls["wallet_debit"] ?? [],
    [],
    `${tag} wallet_debit`,
  );
  assertEquals(
    capture.rpcCalls["wallet_place_split_bet"] ?? [],
    [],
    `${tag} wallet_place_split_bet`,
  );
}

Deno.test("handleMultiplayerBet: body currency USD matching wallet USD — 200 debits USD", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: { ...CURRENCY_ROUND_FROM },
      fromSequence: { crash_bets: CURRENCY_BET_INSERT },
      rpc: CURRENCY_BET_RPC,
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession("player-uuid-currency"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10, currency: "USD" },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 200, "[CM-USD] status");
    const debitArgs = capture.rpcCalls["wallet_debit"]?.[0] as {
      p_currency?: string;
    };
    assertEquals(debitArgs?.p_currency, "USD", "[CM-USD] value=debit-currency");
  });
});

Deno.test("handleMultiplayerBet: player_balances read REJECTS — 503, never 500, no money RPC", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: {
        ...CURRENCY_ROUND_FROM,
        player_balances: { __reject: new Error("socket hang up") },
      },
      fromSequence: { crash_bets: CURRENCY_BET_INSERT },
      rpc: CURRENCY_BET_RPC,
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession("player-uuid-currency"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 503, "[CM-REJECT] status");
    assertNoMoneyRpc(capture, "[CM-REJECT]");
  });
});

Deno.test("handleMultiplayerBet: no body currency — 200 debits the resolved wallet currency", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: { ...CURRENCY_ROUND_FROM },
      fromSequence: { crash_bets: CURRENCY_BET_INSERT },
      rpc: CURRENCY_BET_RPC,
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession("player-uuid-currency"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 200, "[CM-ABSENT] status");
    const debitArgs = capture.rpcCalls["wallet_debit"]?.[0] as {
      p_currency?: string;
    };
    assertEquals(
      debitArgs?.p_currency,
      "USD",
      "[CM-ABSENT] value=debit-currency",
    );
  });
});

Deno.test("handleMultiplayerBet: blank body currency — 400 BAD_REQUEST, no money RPC", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: { ...CURRENCY_ROUND_FROM },
      fromSequence: { crash_bets: CURRENCY_BET_INSERT },
      rpc: CURRENCY_BET_RPC,
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession("player-uuid-currency"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10, currency: "   " },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 400, "[CM-BLANK] status");
    const body = await resp.json();
    assertEquals(body.error.code, "BAD_REQUEST", "[CM-BLANK] code");
    assertNoMoneyRpc(capture, "[CM-BLANK]");
  });
});

Deno.test("handleMultiplayerBet: player_balances read error — 503, never 422, no money RPC", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: {
        ...CURRENCY_ROUND_FROM,
        player_balances: { data: null, error: { message: "connection reset" } },
      },
      fromSequence: { crash_bets: CURRENCY_BET_INSERT },
      rpc: CURRENCY_BET_RPC,
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession("player-uuid-currency"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 503, "[CM-BAL-ERR] status");
    const body = await resp.json();
    assertEquals(body.error.code, "SERVICE_UNAVAILABLE", "[CM-BAL-ERR] code");
    assertNoMoneyRpc(capture, "[CM-BAL-ERR]");
  });
});

Deno.test("handleMultiplayerBet: currency registry read error — 503, never 422, no money RPC", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: {
        ...CURRENCY_ROUND_FROM,
        currency_attributes: {
          data: null,
          error: { message: "connection reset" },
        },
      },
      fromSequence: { crash_bets: CURRENCY_BET_INSERT },
      rpc: CURRENCY_BET_RPC,
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession("player-uuid-currency"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 503, "[CM-REG-ERR] status");
    const body = await resp.json();
    assertEquals(body.error.code, "SERVICE_UNAVAILABLE", "[CM-REG-ERR] code");
    assertNoMoneyRpc(capture, "[CM-REG-ERR]");
  });
});

Deno.test("handleMultiplayerBet: multi-currency wallet resolves EUR, client sends the other held USD (stale snapshot) — 422 CURRENCY_MISMATCH, no money RPC", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    // Resolved EUR (first in currency order, game-currency.ts selectGamePlayCurrency); USD is the stale session snapshot.
    const supabase = makeCrashSupabase({
      from: {
        ...CURRENCY_ROUND_FROM,
        player_balances: {
          data: [{ currency: "EUR" }, { currency: "USD" }],
          error: null,
        },
      },
      fromSequence: { crash_bets: CURRENCY_BET_INSERT },
      rpc: CURRENCY_BET_RPC,
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession("player-uuid-currency"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10, currency: "USD" },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 422, "[CM-DRIFT] status");
    const body = await resp.json();
    assertEquals(body.error.code, "CURRENCY_MISMATCH", "[CM-DRIFT] code");
    assertNoMoneyRpc(capture, "[CM-DRIFT]");
  });
});

Deno.test("handleMultiplayerBet: bet insert error with no code (transport) — 503, wallet NOT reversed", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: {
        crash_shared_rounds: { data: makeRound(), error: null },
        games: { data: null, error: null },
      },
      fromSequence: { crash_bets: [{ data: null, error: null }] },
      rpc: {
        rg_check_bet_allowed: { data: null, error: null },
        bonus_validate_bet: {
          data: { valid: true, active_bonuses: 0 },
          error: null,
        },
        wallet_debit: { data: { id: "tx-debit-transport-1" }, error: null },
        wallet_create_reversal: { data: null, error: null },
        crash_place_bet_if_betting: {
          data: null,
          error: { message: "fetch failed" },
        },
      },
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession("player-uuid-transport"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(capture.rpcCalls.wallet_create_reversal ?? [], []);
    assertEquals(resp.status, 503);
    const body = await resp.json();
    assertEquals(body.error.code, "SERVICE_UNAVAILABLE");
    assertEquals(body.error.message, "Wallet temporarily unavailable");
  });
});

Deno.test("handleMultiplayerBet: bet insert error with definitive code (23514) — exactly one reversal, 500", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: {
        crash_shared_rounds: { data: makeRound(), error: null },
        games: { data: null, error: null },
      },
      fromSequence: { crash_bets: [{ data: null, error: null }] },
      rpc: {
        rg_check_bet_allowed: { data: null, error: null },
        bonus_validate_bet: {
          data: { valid: true, active_bonuses: 0 },
          error: null,
        },
        wallet_debit: { data: { id: "tx-debit-check-1" }, error: null },
        wallet_create_reversal: { data: null, error: null },
        crash_place_bet_if_betting: {
          data: null,
          error: { code: "23514", message: "check_violation" },
        },
      },
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession("player-uuid-check"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(capture.rpcCalls.wallet_create_reversal?.length, 1);
    assertEquals(resp.status, 500);
    const body = await resp.json();
    assertEquals(body.error.message, "Failed to place bet");
  });
});

Deno.test("handleMultiplayerBet: NGN wallet row → bet placed in NGN (market-generic, row-driven)", async () => {
  await withBroadcastMock(async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      from: {
        player_balances: { data: [{ currency: "NGN" }], error: null },
        crash_shared_rounds: { data: makeRound(), error: null },
        games: { data: null, error: null },
      },
      fromSequence: { crash_bets: [{ data: null, error: null }] },
      rpc: {
        rg_check_bet_allowed: { data: null, error: null },
        bonus_validate_bet: {
          data: { valid: true, active_bonuses: 0 },
          error: null,
        },
        wallet_debit: { data: { id: "tx-debit-cur-2" }, error: null },
        crash_place_bet_if_betting: {
          data: {
            status: "inserted",
            bet: {
              id: "bet-cur-2",
              bet_amount: 10,
              status: "active",
              created_at: new Date().toISOString(),
            },
          },
          error: null,
        },
      },
    }, capture);
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 200);
    const debitArgs = capture.rpcCalls["wallet_debit"]?.[0] as {
      p_currency?: string;
    };
    assertExists(debitArgs, "wallet_debit must have been called");
    assertEquals(
      debitArgs.p_currency,
      "NGN",
      "bet currency must come from the wallet balance row",
    );
  });
});

Deno.test("handleMultiplayerBet: no wallet balance row → 422 fail-closed, never a literal fallback", async () => {
  await withBroadcastMock(async () => {
    const supabase = makeCrashSupabase({
      from: {
        player_balances: { data: null, error: null },
        crash_shared_rounds: { data: makeRound(), error: null },
      },
    });
    const resp = await handleMultiplayerBet(
      supabase,
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { bet_amount: 10 },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 422);
    const body = await resp.json();
    assertEquals(
      body.error.message,
      "No wallet balance — cannot determine betting currency",
    );
  });
});

Deno.test("handleMultiplayerBet: input validation still runs BEFORE the currency fetch — 400 without DB work", async () => {
  const supabase = makeCrashSupabase();
  const resp = await handleMultiplayerBet(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    {},
    CORS_HEADERS,
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertEquals(body.error.message, "bet_amount must be a positive number");
});

Deno.test("crash-bet-handlers source: no currency literal fallback in the bet path (SC-3 canary)", () => {
  // Guard-authoring canary: the bet handler must never fall back to a
  // hardcoded currency. Comment-stripped so prose cannot mask a real literal.
  const source = Deno.readTextFileSync(
    new URL("./crash/crash-bet-handlers.ts", import.meta.url),
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert(
    !/\|\| *'NGN'|\|\| *'USD'|\?\? *'NGN'|\?\? *'USD'/.test(source),
    "bet handler must not contain currency literals",
  );
});

// ============================================================================
// handleMultiplayerCashout
// ============================================================================

Deno.test("handleMultiplayerCashout: invalid cashout_multiplier (< 1.0) — 400", async () => {
  const supabase = makeCrashSupabase();
  const resp = await handleMultiplayerCashout(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    { cashout_multiplier: 0.5 },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertEquals(body.error.message, "cashout_multiplier must be >= 1.0");
});

Deno.test("handleMultiplayerCashout: no active bet found — 404", async () => {
  const supabase = makeCrashSupabase({
    from: { crash_bets: { data: null, error: null } },
  });
  const resp = await handleMultiplayerCashout(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    { cashout_multiplier: 1.5 },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 404);
  const body = await resp.json();
  assertEquals(body.error.message, "No active bet found for this round");
});

Deno.test("handleMultiplayerCashout: bet lookup QUERY ERROR — 500 retryable, never 404", async () => {
  // Live-incident regression: a player with a genuine active bet got 404
  // "No active bet found" during a DB degradation window and was settled as a
  // loss. A query error must be a retryable 500, never a terminal 404.
  const supabase = makeCrashSupabase({
    from: { crash_bets: { data: null, error: { message: "upstream 503" } } },
  });
  const resp = await handleMultiplayerCashout(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    { cashout_multiplier: 1.5 },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 500);
  const body = await resp.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
  assertEquals(body.error.message, "Cashout failed, please retry");
});

Deno.test("handleMultiplayerCashout: round not found — 404", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_bets: {
        data: {
          id: "bet-1",
          bet_amount: 10,
          status: "active",
          split_group_id: null,
          currency: "NGN",
        },
        error: null,
      },
      crash_shared_rounds: { data: null, error: null },
    },
  });
  const resp = await handleMultiplayerCashout(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    { cashout_multiplier: 1.5 },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 404);
  const body = await resp.json();
  assertEquals(body.error.message, "Round not found");
});

Deno.test("handleMultiplayerCashout: round lookup QUERY ERROR — 500 retryable, never 404", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_bets: {
        data: {
          id: "bet-1",
          bet_amount: 10,
          status: "active",
          split_group_id: null,
          currency: "NGN",
        },
        error: null,
      },
      crash_shared_rounds: {
        data: null,
        error: { message: "connection reset" },
      },
    },
  });
  const resp = await handleMultiplayerCashout(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    { cashout_multiplier: 1.5 },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 500);
  const body = await resp.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
  assertEquals(body.error.message, "Cashout failed, please retry");
});

Deno.test("handleMultiplayerCashout: round not in active phase — 409", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_bets: {
        data: {
          id: "bet-1",
          bet_amount: 10,
          status: "active",
          split_group_id: null,
          currency: "NGN",
        },
        error: null,
      },
      crash_shared_rounds: {
        data: makeRound({ phase: "betting" }),
        error: null,
      },
    },
  });
  const resp = await handleMultiplayerCashout(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    { cashout_multiplier: 1.5 },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 409);
  const body = await resp.json();
  assertEquals(body.error.message, "Round is not in active phase");
});

Deno.test("handleMultiplayerCashout: round already crashed (server-authoritative crash_point) — 409", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_bets: {
        data: {
          id: "bet-1",
          bet_amount: 10,
          status: "active",
          split_group_id: null,
          currency: "NGN",
        },
        error: null,
      },
      crash_shared_rounds: {
        data: makeRound({
          phase: "active",
          start_timestamp: new Date(Date.now() - 600_000).toISOString(), // 10 min ago -> huge multiplier
          crash_point: 2.0,
        }),
        error: null,
      },
    },
  });
  const resp = await handleMultiplayerCashout(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    { cashout_multiplier: 1.5 },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 409);
  const body = await resp.json();
  assertEquals(body.error.message, "Round has already crashed");
});

Deno.test("handleMultiplayerCashout: cashout multiplier exceeds current server multiplier — 409", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_bets: {
        data: {
          id: "bet-1",
          bet_amount: 10,
          status: "active",
          split_group_id: null,
          currency: "NGN",
        },
        error: null,
      },
      crash_shared_rounds: {
        data: makeRound({
          phase: "active",
          start_timestamp: new Date().toISOString(),
          crash_point: null,
        }),
        error: null,
      },
    },
  });
  const resp = await handleMultiplayerCashout(
    supabase,
    makeSession(),
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    { cashout_multiplier: 10.0 },
    CORS_HEADERS,
  );
  assertEquals(resp.status, 409);
  const body = await resp.json();
  assertEquals(
    body.error.message,
    "Cashout multiplier exceeds current round multiplier",
  );
});

// 384.3: the manual cashout makes exactly ONE `game.crash_claim_and_payout_bet`
// call. Everything below that used to pin a wallet RPC name, an optimistic lock,
// a heal or a pager pins the RPC's outcome mapping instead — those states no
// longer exist on this surface.
const CREDITED_ROW = {
  outcome: "credited",
  bet_id: "bet-1",
  status: "cashed_out",
  cashout_multiplier: 1.24,
  win_amount: 12.4,
  cashout_source: "manual",
  is_auto: false,
} as const;
const CREDITED = { data: CREDITED_ROW, error: null } as const;

Deno.test("handleMultiplayerCashout: an RPC error is 500 with one critical page and NO broadcasts", async () => {
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  const alerts = spyOnCrashAlerts();
  try {
    const { result, broadcasts } = await withBroadcastCapture(() =>
      handleMultiplayerCashout(
        makeCrashSupabase(
          {
            from: {
              crash_bets: { data: { ...CASHOUT_BET }, error: null },
              crash_shared_rounds: {
                data: makeRound({
                  phase: "active",
                  start_timestamp: new Date().toISOString(),
                  crash_point: null,
                }),
                error: null,
              },
            },
            rpc: {
              crash_claim_and_payout_bet: {
                data: null,
                error: { message: "deadlock detected" },
              },
            },
          },
          capture,
        ),
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        { cashout_multiplier: 1.0 },
        CORS_HEADERS,
      )
    );

    assertEquals(result.status, 500);
    assertEquals(
      (await result.json()).error.message,
      "Cashout failed, please retry",
    );
    assertEquals(
      broadcasts.length,
      0,
      "an aborted transaction must announce nothing",
    );
    const paged = alerts.calls.filter((c) =>
      c.error_type === "crash_payout_rpc_failed"
    );
    assertEquals(paged.length, 1, "exactly one page per incident");
    assertEquals(paged[0].severity_tier, "critical");
  } finally {
    alerts.restore();
  }
});

Deno.test("handleMultiplayerCashout: a non-finite multiplier is 400 and calls NO RPC", async () => {
  for (
    const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]
  ) {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const resp = await handleMultiplayerCashout(
      makeCrashSupabase({}, capture),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: bad },
      CORS_HEADERS,
    );
    assertEquals(resp.status, 400, `multiplier=${bad}`);
    assertEquals(
      (await resp.json()).error.message,
      "cashout_multiplier must be >= 1.0",
      `multiplier=${bad}`,
    );
    assertEquals(
      capture.rpcCalls,
      {},
      `multiplier=${bad}: a non-finite figure must move no money`,
    );
  }
});

Deno.test("handleMultiplayerCashout: the RPC is called ONCE with the session player, and no wallet RPC at all", async () => {
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  const session = makeSession("3f7a1c2d-9e4b-4a11-b8c0-111122223333");
  await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      makeCashoutSupabase(
        { crash_claim_and_payout_bet: CREDITED },
        2.5,
        capture,
      ),
      session,
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.0 },
      CORS_HEADERS,
    )
  );

  const calls = capture.rpcCalls.crash_claim_and_payout_bet ?? [];
  assertEquals(calls.length, 1);
  const args = calls[0] as Record<string, unknown>;
  assertEquals(args.p_bet_id, "bet-1");
  assertEquals(args.p_round_id, "d87609d0-a636-48f4-89b2-bf738e72cc35");
  assertEquals(args.p_source, "manual");
  assertEquals(args.p_player_id, session.playerAccountId);
  assertEquals(
    typeof args.p_multiplier,
    "string",
    "the multiplier travels as an exact decimal string",
  );
  assertEquals(capture.rpcCalls.wallet_credit ?? [], []);
  assertEquals(capture.rpcCalls.wallet_settle_split_win ?? [], []);
  assertEquals(capture.rpcCalls.wallet_create_reversal ?? [], []);
});

Deno.test("W7 (class 4): p_player_id is the SESSION id even when the body names another player", async () => {
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  const session = makeSession("aaaaaaaa-1111-4111-8111-111111111111");
  await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      makeCashoutSupabase(
        { crash_claim_and_payout_bet: CREDITED },
        2.5,
        capture,
      ),
      session,
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      // Both a body-level player_id and an RPC-shaped p_player_id, both wrong.
      {
        cashout_multiplier: 1.0,
        player_id: "bbbbbbbb-2222-4222-8222-222222222222",
        p_player_id: "bbbbbbbb-2222-4222-8222-222222222222",
      },
      CORS_HEADERS,
    )
  );

  const args = capture.rpcCalls.crash_claim_and_payout_bet[0] as Record<
    string,
    unknown
  >;
  assertEquals(args.p_player_id, session.playerAccountId);
});

Deno.test("W7 (class 4): the cancel RPC carries the session player too", async () => {
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  const session = makeSession("aaaaaaaa-1111-4111-8111-111111111111");
  await withBroadcastCapture(() =>
    handleMultiplayerCancelBet(
      cancelSupabase({
        crash_claim_and_payout_bet: {
          data: {
            outcome: "credited",
            status: "cancelled",
            refunded_amount: 10,
          },
          error: null,
        },
      }, capture),
      session,
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      CORS_HEADERS,
    )
  );

  const args = capture.rpcCalls.crash_claim_and_payout_bet[0] as Record<
    string,
    unknown
  >;
  assertEquals(args.p_source, "cancel");
  assertEquals(args.p_player_id, session.playerAccountId);
  // A cancel names no multiplier — the RPC rejects one for any non-payout source.
  assertEquals("p_multiplier" in args, false);
});

Deno.test('B2: requested 1.2399 at server 1.30 sends the exact 2dp string "1.24"', async () => {
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      makeCashoutSupabase(
        {
          crash_claim_and_payout_bet: {
            data: {
              ...CREDITED_ROW,
              cashout_multiplier: 1.24,
              win_amount: 12.4,
            },
            error: null,
          },
        },
        1.3,
        capture,
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.2399 },
      CORS_HEADERS,
    )
  );

  // The button showed 1.24; the old floor formula sent "1.23", paying a player
  // less than the figure they clicked.
  assertEquals(
    (capture.rpcCalls.crash_claim_and_payout_bet[0] as Record<string, unknown>)
      .p_multiplier,
    "1.24",
  );
});

Deno.test("handleMultiplayerCashout: credited — 200 from the RPC figures, both broadcasts, one checkpoint", async () => {
  let calls: ChainCall[] = [];
  let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      makeCapturingCashoutSupabase(
        { ...CASHOUT_BET, bet_amount: 10 },
        { crash_claim_and_payout_bet: CREDITED },
        (c) => {
          calls = [...calls, c];
        },
        {
          start_timestamp: new Date(Date.now() - crashDurationMs(1.3))
            .toISOString(),
        },
        { data: { crash_point: 100.0 }, error: null },
        (c) => {
          rpcCalls = [...rpcCalls, c];
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      {
        cashout_multiplier: 1.24,
        session_id: "3672701e-8c37-4bee-87cc-b05cbd4af325",
      },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  const body = await result.json();
  assertEquals(body.bet_id, "bet-1");
  assertEquals(body.status, "cashed_out");
  // The RPC's figures are echoed verbatim — no client-side recomputation, which
  // is what recorded and announced a win the player was never paid on a replay.
  assertEquals(body.win_amount, 12.4);
  assertEquals(body.cashout_multiplier, 1.24);
  assertEquals(
    broadcasts.filter((b) => b.eventType === "crash.cashout").length,
    1,
  );
  assertEquals(
    broadcasts.filter((b) => b.eventType === "wallet_balance_updated").length,
    1,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertExists(
    crashCheckpointInsert(calls),
    "the cashout checkpoint must be written on the paid path",
  );
  assertEquals(
    crashBetUpdate(calls),
    undefined,
    "the handler writes no crash_bets.status — the RPC does",
  );
  assertEquals(
    rpcCalls.filter((c) => c.name === "crash_claim_and_payout_bet").length,
    1,
  );
});

Deno.test("handleMultiplayerCashout: replayed — 200 with the RPCs own amounts, not the requests", async () => {
  // The worker or the sweep paid this bet first; the ledger's figures stand.
  let calls: ChainCall[] = [];
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      makeCapturingCashoutSupabase(
        { ...CASHOUT_BET, bet_amount: 10 },
        {
          crash_claim_and_payout_bet: {
            data: {
              ...CREDITED_ROW,
              outcome: "replayed",
              win_amount: 15,
              cashout_multiplier: 1.5,
              cashout_source: "auto",
              is_auto: true,
            },
            error: null,
          },
        },
        (c) => {
          calls = [...calls, c];
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      {
        cashout_multiplier: 1.0,
        session_id: "3672701e-8c37-4bee-87cc-b05cbd4af325",
      },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  const body = await result.json();
  assertEquals(body.win_amount, 15);
  assertEquals(body.cashout_multiplier, 1.5);
  assertEquals(
    body.is_auto,
    true,
    "a replay of a worker credit keeps the [auto] provenance",
  );
  const cashout = broadcasts.find((b) => b.eventType === "crash.cashout");
  assertEquals(cashout?.payload.win_amount, 15);
  assertEquals(cashout?.payload.multiplier, 1.5);
  assertEquals(cashout?.payload.is_auto, true);
});

Deno.test("H3: not_claimed against an already-cashed_out bet is 200 from the recorded values and broadcasts NOTHING", async () => {
  let calls: ChainCall[] = [];
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      makeCapturingCashoutSupabase(
        { ...CASHOUT_BET },
        {
          crash_claim_and_payout_bet: {
            data: {
              outcome: "not_claimed",
              status: "cashed_out",
              bet_id: "bet-1",
              cashout_multiplier: 1.4,
              win_amount: 14,
              is_auto: false,
            },
            error: null,
          },
        },
        (c) => {
          calls = [...calls, c];
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      {
        cashout_multiplier: 1.0,
        session_id: "3672701e-8c37-4bee-87cc-b05cbd4af325",
      },
      CORS_HEADERS,
    )
  );

  // A double click or client retry: the money is paid and recorded, this request
  // just lost the race. A second crash.cashout is a duplicate win-feed entry.
  assertEquals(result.status, 200);
  const body = await result.json();
  assertEquals(body.win_amount, 14);
  assertEquals(body.cashout_multiplier, 1.4);
  assertEquals(
    broadcasts.length,
    0,
    "exactly one win is announced exactly once",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertEquals(crashCheckpointInsert(calls), undefined);
});

Deno.test("handleMultiplayerCashout: every refusal outcome maps to its own status", async () => {
  const cases: readonly [string, Record<string, unknown>, number][] = [
    [
      "not_claimed on a lost bet",
      { outcome: "not_claimed", status: "lost" },
      409,
    ],
    ["not_owed", { outcome: "not_owed" }, 409],
    ["phase_mismatch", { outcome: "phase_mismatch", phase: "betting" }, 409],
    // A wrong-owner caller and a missing bet are byte-identical: no status, no amount.
    ["not_found", { outcome: "not_found" }, 404],
    ["round_not_found", { outcome: "round_not_found" }, 404],
    ["crash_point_unresolved", { outcome: "crash_point_unresolved" }, 500],
  ];
  for (const [label, data, want] of cases) {
    const { result, broadcasts } = await withBroadcastCapture(() =>
      handleMultiplayerCashout(
        makeCashoutSupabase({
          crash_claim_and_payout_bet: { data, error: null },
        }, 2.5),
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        { cashout_multiplier: 1.0 },
        CORS_HEADERS,
      )
    );
    assertEquals(result.status, want, label);
    assertEquals(broadcasts.length, 0, `${label}: a refusal announces nothing`);
  }
});

Deno.test("handleMultiplayerCashout: a credited outcome carrying no confirmable figures is 500 and pages", async () => {
  const alerts = spyOnCrashAlerts();
  try {
    const resp = await handleMultiplayerCashout(
      makeCashoutSupabase(
        {
          crash_claim_and_payout_bet: {
            data: {
              outcome: "credited",
              status: "cashed_out",
              win_amount: null,
              cashout_multiplier: null,
            },
            error: null,
          },
        },
        2.5,
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.0 },
      CORS_HEADERS,
    );
    assertEquals(
      resp.status,
      500,
      "never render a figure the RPC cannot confirm",
    );
    assertEquals(
      alerts.calls.filter((c) => c.error_type === "crash_payout_rpc_failed")
        .length,
      1,
    );
  } finally {
    alerts.restore();
  }
});

Deno.test("handleMultiplayerCashout: crash.cashout is_auto is the RPCs verdict, never the request", async () => {
  for (const isAuto of [true, false, null]) {
    const { result, broadcasts } = await withBroadcastCapture(() =>
      handleMultiplayerCashout(
        makeCashoutSupabase(
          {
            crash_claim_and_payout_bet: {
              data: { ...CREDITED_ROW, is_auto: isAuto },
              error: null,
            },
          },
          2.5,
        ),
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        { cashout_multiplier: 1.0, is_auto: true },
        CORS_HEADERS,
      )
    );
    assertEquals(result.status, 200);
    // `is_auto` is JSON null on a replayed split win, so a strict `=== true`
    // read is the only one that renders it as a boolean.
    assertEquals(
      (await result.json()).is_auto,
      isAuto === true,
      `rpc is_auto=${String(isAuto)}`,
    );
    const cashout = broadcasts.find((b) => b.eventType === "crash.cashout");
    assertEquals(
      cashout?.payload.is_auto,
      isAuto === true,
      `rpc is_auto=${String(isAuto)}`,
    );
  }
});

Deno.test("handleMultiplayerCashout: regression — every pre-check refuses BEFORE the RPC and moves no money", async () => {
  const rpcNames = (c: Record<string, unknown[]>): string[] => Object.keys(c);
  const cases: readonly [
    string,
    Record<string, ChainResult>,
    Record<string, ChainResult>,
    Record<string, unknown>,
    number,
  ][] = [
    // no active bet
    ["no active bet", { crash_bets: { data: null, error: null } }, {}, {
      cashout_multiplier: 1.5,
    }, 404],
    // bet lookup fault
    [
      "bet lookup error",
      { crash_bets: { data: null, error: { message: "upstream 503" } } },
      {},
      { cashout_multiplier: 1.5 },
      500,
    ],
    // round missing / fault
    [
      "round missing",
      { crash_bets: { data: { ...CASHOUT_BET }, error: null } },
      { crash_shared_rounds: { data: null, error: null } },
      { cashout_multiplier: 1.5 },
      404,
    ],
    // wrong phase
    [
      "round not active",
      { crash_bets: { data: { ...CASHOUT_BET }, error: null } },
      {
        crash_shared_rounds: {
          data: makeRound({ phase: "betting" }),
          error: null,
        },
      },
      { cashout_multiplier: 1.5 },
      409,
    ],
    // R1: the frame showing the crash value IS the crash
    [
      "round already crashed",
      { crash_bets: { data: { ...CASHOUT_BET }, error: null } },
      {
        crash_shared_rounds: {
          data: makeRound({
            phase: "active",
            start_timestamp: new Date(Date.now() - 600_000).toISOString(),
            crash_point: 2.0,
          }),
          error: null,
        },
      },
      { cashout_multiplier: 1.5 },
      409,
    ],
    // latency tolerance
    [
      "beyond tolerance",
      { crash_bets: { data: { ...CASHOUT_BET }, error: null } },
      {
        crash_shared_rounds: {
          data: makeRound({
            phase: "active",
            start_timestamp: new Date().toISOString(),
            crash_point: null,
          }),
          error: null,
        },
      },
      { cashout_multiplier: 10.0 },
      409,
    ],
    // guard unresolved fails CLOSED
    [
      "guard unresolved",
      { crash_bets: { data: { ...CASHOUT_BET }, error: null } },
      {
        crash_hash_chains: {
          data: null,
          error: { message: "chain store unreachable" },
        },
      },
      { cashout_multiplier: 1.0 },
      500,
    ],
  ];
  for (const [label, from, overrides, body, want] of cases) {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };

    const resp = await handleMultiplayerCashout(
      makeCrashSupabase(
        {
          from: {
            ...from,
            ...overrides,
            crash_shared_rounds: overrides.crash_shared_rounds ??
              {
                data: makeRound({
                  phase: "active",
                  start_timestamp: new Date().toISOString(),
                  crash_point: null,
                }),
                error: null,
              },
          },
        },
        capture,
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      body,
      CORS_HEADERS,
    );
    assertEquals(resp.status, want, label);
    assertEquals(
      rpcNames(capture.rpcCalls),
      [],
      `${label}: a fast-fail must not reach the payout RPC`,
    );
  }
});
// 384.3: a cancel is ONE `crash_claim_and_payout_bet` call with source
// 'cancel'. There is no split-specific branch left to test — the RPC reverses
// each live leg by balance type — so the arms below are the RPC's outcomes.
const cancelSupabase = (
  rpc: Record<string, ChainResult>,
  capture?: { rpcCalls: Record<string, unknown[]> },
  bet: Record<string, unknown> = {
    id: "bet-1",
    bet_amount: 15,
    status: "active",
    currency: "NGN",
    split_group_id: null,
  },
) =>
  makeCrashSupabase(
    {
      from: {
        crash_bets: { data: bet, error: null },
        crash_shared_rounds: {
          data: makeRound({ phase: "betting" }),
          error: null,
        },
      },
      rpc,
    },
    capture,
  );

Deno.test("handleMultiplayerCancelBet: refund claim fails — 500, no broadcast", async () => {
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCancelBet(
      cancelSupabase({
        crash_claim_and_payout_bet: {
          data: null,
          error: { message: "refund rejected" },
        },
      }),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 500);
  assertEquals((await result.json()).error.message, "Refund failed");
  assertEquals(
    broadcasts.length,
    0,
    "a failed refund must not tell the client its balance moved",
  );
});

Deno.test("handleMultiplayerCancelBet: happy path — the RPCs refund is reported verbatim — 200", async () => {
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCancelBet(
      cancelSupabase({
        crash_claim_and_payout_bet: {
          data: {
            outcome: "credited",
            status: "cancelled",
            refunded_amount: 15,
          },
          error: null,
        },
      }, capture),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  const body = await result.json();
  assertEquals(body.bet_id, "bet-1");
  assertEquals(body.refunded_amount, 15);
  assertEquals(body.status, "cancelled");
  assertEquals(Object.keys(body).sort(), [
    "bet_id",
    "refunded_amount",
    "round_id",
    "status",
  ]);
  assertEquals(
    broadcasts.filter((b) => b.eventType === "wallet_balance_updated").length,
    1,
  );
  assertEquals(
    capture.rpcCalls.wallet_credit ?? [],
    [],
    "the refund is the RPCs, not a wallet call here",
  );
});

Deno.test("handleMultiplayerCancelBet: a SPLIT bet cancels through the same single claim and SUCCEEDS", async () => {
  // The old handler refused a split cancel outright (`split_cancel_unsupported`).
  // A split bet's real-and-bonus legs are two debits; the claim RPC reverses
  // each by balance type, so the bonus leg returns to its grant rather than to
  // the withdrawable wallet. No such path may exist.
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCancelBet(
      cancelSupabase(
        {
          crash_claim_and_payout_bet: {
            data: {
              outcome: "credited",
              status: "cancelled",
              refunded_amount: 25,
              refunded_real: 15,
              refunded_bonus: 10,
            },
            error: null,
          },
        },
        capture,
        {
          id: "bet-2",
          bet_amount: 25,
          status: "active",
          currency: "NGN",
          split_group_id: "split-9",
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  assertEquals((await result.json()).refunded_amount, 25);
  const args = capture.rpcCalls.crash_claim_and_payout_bet[0] as Record<
    string,
    unknown
  >;
  assertEquals(args.p_bet_id, "bet-2");
  assertEquals(args.p_source, "cancel");
  assertEquals(broadcasts.length, 1);
});

Deno.test("handleMultiplayerCancelBet: refund_blocked — 409, and the client learns nothing about amounts", async () => {
  // A leg that can never be reversed (dead grant, chargebacked). The round is
  // still running, so the bet stays in play and settles normally; a 4xx with no
  // amount lets the client say exactly that and change nothing.
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCancelBet(
      cancelSupabase(
        {
          crash_claim_and_payout_bet: {
            data: { outcome: "refund_blocked", unrefunded_amount: 25 },
            error: null,
          },
        },
        capture,
        {
          id: "bet-2",
          bet_amount: 25,
          status: "active",
          currency: "NGN",
          split_group_id: "split-9",
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 409);
  const body = await result.json();
  assertEquals(body.error.message, "This bet can no longer be cancelled");
  assertEquals(
    "refunded_amount" in body,
    false,
    "nothing was refunded, so no amount is reported",
  );
  assertEquals(
    broadcasts.length,
    0,
    "the bet stays in play — the client must not refresh to a phantom balance",
  );
  assertEquals(
    capture.rpcCalls.crash_claim_and_payout_bet.length,
    1,
    "blocked, not retried",
  );
});

Deno.test("handleMultiplayerCancelBet: every other outcome maps to its own status", async () => {
  const cases: readonly [string, Record<string, unknown>, number, string][] = [
    ["replayed", { outcome: "replayed", refunded_amount: 15 }, 200, ""],
    [
      "not_claimed",
      { outcome: "not_claimed" },
      404,
      "No active bet found for this round",
    ],
    [
      "not_found",
      { outcome: "not_found" },
      404,
      "No active bet found for this round",
    ],
    [
      "round_not_found",
      { outcome: "round_not_found" },
      404,
      "No active bet found for this round",
    ],
    // A round that flipped to active between the read and the claim: the
    // handler's own phase check said betting, the RPC's says otherwise. The
    // RPC is the authority — 409, not a 500.
    [
      "phase_mismatch",
      { outcome: "phase_mismatch", phase: "active" },
      409,
      "Cannot cancel bet -- round is already active",
    ],
    // Unreachable for cancel, and fail-CLOSED rather than paid.
    ["not_owed", { outcome: "not_owed" }, 500, "Refund failed"],
    [
      "crash_point_unresolved",
      { outcome: "crash_point_unresolved" },
      500,
      "Refund failed",
    ],
    [
      "an unrecognised outcome",
      { outcome: "something_new" },
      500,
      "Refund failed",
    ],
    ["a null outcome", {}, 500, "Refund failed"],
  ];
  for (const [label, data, want, message] of cases) {
    const { result, broadcasts } = await withBroadcastCapture(() =>
      handleMultiplayerCancelBet(
        cancelSupabase({ crash_claim_and_payout_bet: { data, error: null } }),
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        CORS_HEADERS,
      )
    );
    assertEquals(result.status, want, label);
    if (message !== "") {
      assertEquals((await result.json()).error.message, message, label);
    }
    assertEquals(
      broadcasts.length,
      want === 200 ? 1 : 0,
      `${label}: only a completed refund announces a balance change`,
    );
  }
});

Deno.test("handleMultiplayerCancelBet: regression — every pre-check refuses BEFORE the claim and moves no money", async () => {
  const cases: readonly [
    string,
    Record<string, ChainResult>,
    Record<string, ChainResult>,
    number,
  ][] = [
    ["no active bet", { crash_bets: { data: null, error: null } }, {}, 404],
    [
      "bet lookup error",
      { crash_bets: { data: null, error: { message: "upstream 503" } } },
      {},
      500,
    ],
    [
      "round missing",
      {
        crash_bets: {
          data: {
            id: "bet-1",
            bet_amount: 15,
            status: "active",
            currency: "NGN",
            split_group_id: null,
          },
          error: null,
        },
      },
      { crash_shared_rounds: { data: null, error: null } },
      404,
    ],
    ["round lookup error", {
      crash_bets: {
        data: {
          id: "bet-1",
          bet_amount: 15,
          status: "active",
          currency: "NGN",
          split_group_id: null,
        },
        error: null,
      },
    }, {
      crash_shared_rounds: { data: null, error: { message: "read timeout" } },
    }, 500],
    ["round already active", {
      crash_bets: {
        data: {
          id: "bet-1",
          bet_amount: 15,
          status: "active",
          currency: "NGN",
          split_group_id: null,
        },
        error: null,
      },
    }, {
      crash_shared_rounds: {
        data: makeRound({ phase: "active" }),
        error: null,
      },
    }, 409],
  ];
  for (const [label, from, overrides, want] of cases) {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const resp = await handleMultiplayerCancelBet(
      makeCrashSupabase({
        from: {
          crash_shared_rounds: {
            data: makeRound({ phase: "betting" }),
            error: null,
          },
          ...from,
          ...overrides,
        },
      }, capture),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      CORS_HEADERS,
    );
    assertEquals(resp.status, want, label);
    assertEquals(
      capture.rpcCalls,
      {},
      `${label}: a fast-fail must not reach the claim RPC`,
    );
  }
});

// ============================================================================
// handleGetCurrentRound
// ============================================================================

Deno.test("handleGetCurrentRound: DB error fetching round — 500", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: { data: null, error: { message: "db down" } },
    },
  });
  const resp = await handleGetCurrentRound(
    supabase,
    "b1111111-1111-4111-8111-111111111111",
    null,
    CORS_HEADERS,
  );
  assertEquals(resp.status, 500);
  const body = await resp.json();
  assertEquals(body.error.message, "Failed to fetch current round");
});

Deno.test("handleGetCurrentRound: no active round — 200 with null round and message", async () => {
  const supabase = makeCrashSupabase({
    from: { crash_shared_rounds: { data: null, error: null } },
  });
  const resp = await handleGetCurrentRound(
    supabase,
    "b1111111-1111-4111-8111-111111111111",
    null,
    CORS_HEADERS,
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.round, null);
  assertEquals(body.message, "No active round");
});

Deno.test("handleGetCurrentRound: betting phase, no session — crash_point hidden, player_bet null", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: {
        data: makeRound({ phase: "betting" }),
        error: null,
      },
      crash_hash_chains: { data: { hash: "terminal-hash-abc" }, error: null },
    },
  });
  const resp = await handleGetCurrentRound(
    supabase,
    "b1111111-1111-4111-8111-111111111111",
    null,
    CORS_HEADERS,
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.round.crash_point, null);
  assertEquals(body.player_bet, null);
  assertEquals(body.terminal_hash, "terminal-hash-abc");
});

Deno.test("handleGetCurrentRound: crashed phase with session — crash_point revealed, player_bet returned", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: {
        data: makeRound({ phase: "crashed", crash_point: 3.45 }),
        error: null,
      },
      crash_bets: {
        data: {
          id: "bet-1",
          bet_amount: 10,
          auto_cashout_at: null,
          cashout_multiplier: null,
          win_amount: null,
          status: "active",
        },
        error: null,
      },
      crash_hash_chains: { data: { hash: "terminal-hash-xyz" }, error: null },
    },
  });
  const resp = await handleGetCurrentRound(
    supabase,
    "b1111111-1111-4111-8111-111111111111",
    makeSession(),
    CORS_HEADERS,
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.round.crash_point, 3.45);
  assertExists(body.player_bet);
  assertEquals(body.player_bet.id, "bet-1");
});

Deno.test("handleGetCurrentRound: cooldown phase with session but no matching bet — reveals crash_point, player_bet null, terminal_hash null", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: {
        data: makeRound({ phase: "cooldown", crash_point: 1.87 }),
        error: null,
      },
      crash_bets: { data: null, error: null },
      crash_hash_chains: { data: null, error: null },
    },
  });
  const resp = await handleGetCurrentRound(
    supabase,
    "b1111111-1111-4111-8111-111111111111",
    makeSession(),
    CORS_HEADERS,
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.round.crash_point, 1.87);
  assertEquals(body.player_bet, null);
  assertEquals(body.terminal_hash, null);
});

// ============================================================================
// handleGetRoundHistory
// ============================================================================

Deno.test("handleGetRoundHistory: RPC error — 500", async () => {
  const supabase = makeCrashSupabase({
    rpc: {
      crash_round_history_with_stats: {
        data: null,
        error: { message: "rpc failed" },
      },
    },
  });
  const resp = await handleGetRoundHistory(
    supabase,
    "b1111111-1111-4111-8111-111111111111",
    20,
    CORS_HEADERS,
  );
  assertEquals(resp.status, 500);
  const body = await resp.json();
  assertEquals(body.error.message, "Failed to fetch round history");
});

Deno.test("handleGetRoundHistory: success — returns rounds array", async () => {
  const rounds = [{ round_number: 1, crash_point: 2.5 }, {
    round_number: 2,
    crash_point: 1.2,
  }];
  const supabase = makeCrashSupabase({
    rpc: { crash_round_history_with_stats: { data: rounds, error: null } },
  });
  const resp = await handleGetRoundHistory(
    supabase,
    "b1111111-1111-4111-8111-111111111111",
    20,
    CORS_HEADERS,
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.rounds.length, 2);
});

Deno.test("handleGetRoundHistory: RPC returns null data — falls back to empty array", async () => {
  const supabase = makeCrashSupabase({
    rpc: { crash_round_history_with_stats: { data: null, error: null } },
  });
  const resp = await handleGetRoundHistory(
    supabase,
    "b1111111-1111-4111-8111-111111111111",
    20,
    CORS_HEADERS,
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.rounds, []);
});

for (
  const [limit, expected] of [
    [0, 20],
    [999, 50],
    [-5, 1],
    [2.7, 2],
    [Infinity, 20],
  ]
) {
  Deno.test(`handleGetRoundHistory: limit ${limit} reaches the RPC as ${expected}`, async () => {
    const capture = { rpcCalls: {} as Record<string, unknown[]> };
    const supabase = makeCrashSupabase({
      rpc: { crash_round_history_with_stats: { data: [], error: null } },
    }, capture);
    await handleGetRoundHistory(
      supabase,
      "b1111111-1111-4111-8111-111111111111",
      limit,
      CORS_HEADERS,
    );
    const params = capture.rpcCalls["crash_round_history_with_stats"][0] as {
      p_limit: number;
    };
    assertEquals(params.p_limit, expected);
  });
}

// ============================================================================
// handleVerifyMultiplayerRound
// ============================================================================

Deno.test("handleVerifyMultiplayerRound: round not found — 404", async () => {
  const supabase = makeCrashSupabase({
    from: { crash_shared_rounds: { data: null, error: null } },
  });
  const resp = await handleVerifyMultiplayerRound(
    supabase,
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    CORS_HEADERS,
  );
  assertEquals(resp.status, 404);
  const body = await resp.json();
  assertEquals(body.error.message, "Round not found");
});

Deno.test("handleVerifyMultiplayerRound: round not yet completed — 409", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: {
        data: makeRound({ phase: "betting" }),
        error: null,
      },
    },
  });
  const resp = await handleVerifyMultiplayerRound(
    supabase,
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    CORS_HEADERS,
  );
  assertEquals(resp.status, 409);
  const body = await resp.json();
  assertEquals(body.error.message, "Round is not yet completed");
});

Deno.test("handleVerifyMultiplayerRound: happy path — full verification payload with prev/next round", async () => {
  const round = makeRound({
    phase: "crashed",
    crash_point: 4.2,
    round_number: 10,
    hash_chain_index: 3,
  });
  const supabase = makeCrashSupabase({
    fromSequence: {
      crash_shared_rounds: [
        { data: round, error: null }, // initial fetch
        { data: { round_number: 9 }, error: null }, // prevRoundResult
        { data: { round_number: 11 }, error: null }, // nextRoundResult
      ],
      crash_hash_chains: [
        {
          data: { hash: "chain-hash-3", chain_index: 3, crash_point: 4.2 },
          error: null,
        }, // chainResult
        { data: { hash: "chain-hash-2" }, error: null }, // prevResult
        { data: { hash: "chain-hash-4" }, error: null }, // nextResult
        { data: { hash: "terminal-hash-0" }, error: null }, // terminalResult
      ],
    },
  });
  const resp = await handleVerifyMultiplayerRound(
    supabase,
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    CORS_HEADERS,
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.round_id, "d87609d0-a636-48f4-89b2-bf738e72cc35");
  assertEquals(body.round_number, 10);
  assertEquals(body.hash, "chain-hash-3");
  assertEquals(body.crash_point, 4.2);
  assertEquals(body.previous_hash, "chain-hash-2");
  assertEquals(body.terminal_hash, "terminal-hash-0");
  assertEquals(body.chain_index, 3);
  assertEquals(body.next_round_number, 11);
  assertEquals(body.prev_round_number, 9);
});

Deno.test("handleVerifyMultiplayerRound: fallback chain — missing hash-chain/prev-next round rows falls back to round fields and nulls", async () => {
  const round = makeRound({
    phase: "cooldown",
    crash_point: null,
    round_number: 1,
    hash_chain_index: 7,
    server_seed: "raw-seed-fallback",
  });
  const supabase = makeCrashSupabase({
    fromSequence: {
      crash_shared_rounds: [
        { data: round, error: null },
        { data: null, error: null }, // no prev round (round_number 0 doesn't exist)
        { data: null, error: null }, // no next round yet
      ],
      crash_hash_chains: [
        { data: null, error: null }, // chainResult missing
        { data: null, error: null }, // prevResult missing
        { data: null, error: null }, // nextResult missing
        { data: null, error: null }, // terminalResult missing
      ],
    },
  });
  const resp = await handleVerifyMultiplayerRound(
    supabase,
    "d87609d0-a636-48f4-89b2-bf738e72cc35",
    CORS_HEADERS,
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.hash, "raw-seed-fallback");
  assertEquals(body.crash_point, 0);
  assertEquals(body.previous_hash, null);
  assertEquals(body.terminal_hash, "");
  assertEquals(body.chain_index, 7);
  assertEquals(body.next_round_number, null);
  assertEquals(body.prev_round_number, null);
});

// ============================================================================
// handleVerifyByRoundNumber
// ============================================================================

Deno.test("handleVerifyByRoundNumber: round_number is zero — 400", async () => {
  const supabase = makeCrashSupabase();
  const resp = await handleVerifyByRoundNumber(
    supabase,
    "0",
    "b1111111-1111-4111-8111-111111111111",
    CORS_HEADERS,
  );
  assertEquals(resp.status, 400);
  const body = await resp.json();
  assertEquals(body.error.message, "round_number must be a positive integer");
});

Deno.test("handleVerifyByRoundNumber [400-20 pass10 U1]: absent, lenient, exponent and out-of-range round_number — 400 and no DB call", async () => {
  for (
    const raw of [
      null,
      "",
      "abc",
      "1e3",
      "5abc",
      "1.5",
      "-1",
      "2147483648",
      "99999999999999999999",
    ]
  ) {
    let dbCalls = 0;
    const supabase = new Proxy({}, {
      get: () => {
        dbCalls += 1;
        throw new Error("DB must not be touched");
      },
    }) as unknown as SupabaseClient;
    const resp = await handleVerifyByRoundNumber(
      supabase,
      raw,
      "b1111111-1111-4111-8111-111111111111",
      CORS_HEADERS,
    );
    assertEquals(resp.status, 400, String(raw));
    assertEquals(dbCalls, 0, String(raw));
    await resp.body?.cancel();
  }
});

Deno.test("handleVerifyByRoundNumber: round not found — 404", async () => {
  const supabase = makeCrashSupabase({
    from: { crash_shared_rounds: { data: null, error: null } },
  });
  const resp = await handleVerifyByRoundNumber(
    supabase,
    "5",
    "b1111111-1111-4111-8111-111111111111",
    CORS_HEADERS,
  );
  assertEquals(resp.status, 404);
  const body = await resp.json();
  assertEquals(body.error.message, "Round not found");
});

Deno.test("handleVerifyByRoundNumber: round not yet completed — 409", async () => {
  const supabase = makeCrashSupabase({
    from: {
      crash_shared_rounds: {
        data: makeRound({ phase: "active" }),
        error: null,
      },
    },
  });
  const resp = await handleVerifyByRoundNumber(
    supabase,
    "5",
    "b1111111-1111-4111-8111-111111111111",
    CORS_HEADERS,
  );
  assertEquals(resp.status, 409);
  const body = await resp.json();
  assertEquals(body.error.message, "Round is not yet completed");
});

Deno.test("handleVerifyByRoundNumber: happy path — default variant fallback, full payload", async () => {
  const round = makeRound({
    phase: "crashed",
    crash_point: 1.99,
    round_number: 7,
    hash_chain_index: 2,
  });
  const supabase = makeCrashSupabase({
    fromSequence: {
      crash_shared_rounds: [
        { data: round, error: null },
        { data: { round_number: 6 }, error: null },
        { data: null, error: null },
      ],
      crash_hash_chains: [
        {
          data: { hash: "chain-hash-2", chain_index: 2, crash_point: 1.99 },
          error: null,
        },
        { data: { hash: "chain-hash-1" }, error: null },
        { data: null, error: null },
        { data: { hash: "terminal-hash-final" }, error: null },
      ],
    },
  });
  // Empty variantId exercises the `variantId || default` fallback branch.
  const resp = await handleVerifyByRoundNumber(supabase, "7", "", CORS_HEADERS);
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.round_number, 7);
  assertEquals(body.hash, "chain-hash-2");
  assertEquals(body.next_round_number, null);
  assertEquals(body.prev_round_number, 6);
  assertEquals(body.terminal_hash, "terminal-hash-final");
});

// ============================================================================
// handleMultiplayerCashout — 384-08 broadcast payload, fire-gate, RPC pin
// ============================================================================

interface CapturedBroadcast {
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * Captures every broadcastEvent() payload via the same
 * setBroadcastServiceClientOverride() seam as withBroadcastMock above, but keeps
 * the emit_event RPC args so the crash.cashout payload can be asserted field by
 * field. The `wallet_balance_updated` broadcast on the `player:` channel is
 * filtered out by the test bodies (eventType === 'crash.cashout').
 */
async function withBroadcastCapture<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; broadcasts: ReadonlyArray<CapturedBroadcast> }> {
  let broadcasts: ReadonlyArray<CapturedBroadcast> = [];
  const result = await withBroadcastStub({
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "emit_event") {
        broadcasts = [
          ...broadcasts,
          {
            eventType: args.p_event_type as string,
            payload: args.p_payload as Record<string, unknown>,
          },
        ];
      }
      return Promise.resolve({ data: { seq: 1 }, error: null });
    },
    // deno-lint-ignore no-explicit-any
  } as any, fn);
  return { result, broadcasts };
}

const CASHOUT_BET = {
  id: "bet-1",
  bet_amount: 10,
  status: "active",
  split_group_id: null,
  currency: "NGN",
} as const;

/**
 * A cashout mock whose round has already reached `level`, so a request at that
 * level clears the handler's latency-tolerance guard. Default 0 means "starts
 * now" — server multiplier 1.00 — which is what the 400/500/404 arms want.
 */
function makeCashoutSupabase(
  rpc: Record<string, ChainResult>,
  level = 0,
  capture?: { rpcCalls: Record<string, unknown[]> },
  bet: Record<string, unknown> = { ...CASHOUT_BET },
): SupabaseClient {
  return makeCrashSupabase(
    {
      from: {
        crash_bets: { data: bet, error: null },
        crash_shared_rounds: {
          data: makeRound({
            phase: "active",
            start_timestamp: new Date(Date.now() - crashDurationMs(level))
              .toISOString(),
            crash_point: null,
          }),
          error: null,
        },
      },
      rpc,
    },
    capture,
  );
}

interface ChainCall {
  method: "update" | "insert";
  table: string;
  args: unknown[];
}

/**
 * A cashout Supabase mock that records every `.update(...)` / `.insert(...)`
 * payload and every `.rpc(name, args)`, so the checkpoint write, the bet-row
 * write and the claim RPC's arguments can be asserted field by field. The
 * 384.3 handler makes ONE `.from('crash_bets')` read (the bet lookup) and no
 * bet-row write at all — the claim RPC owns that row — so there is no
 * optimistic-lock sequence and no status re-read to script.
 */
function makeCapturingCashoutSupabase(
  bet: Record<string, unknown>,
  rpc: Record<string, ChainResult>,
  onCall: (call: ChainCall) => void,
  /** Extra `crash_shared_rounds` overrides — e.g. a back-dated `start_timestamp`. */
  roundOverrides: Record<string, unknown> = {},
  /**
   * 384-09 T-384-09-3: the `crash_hash_chains` row the R4 guard reads. 100.0 =
   * never reached; a guard case passes a REACHABLE point and names the boundary.
   */
  chainResult: ChainResult = { data: { crash_point: 100.0 }, error: null },
  /** Captures every `.rpc(name, args)`. */
  onRpc?: (call: { name: string; args: Record<string, unknown> }) => void,
): SupabaseClient {
  const chainFor = (result: ChainResult, table: string) => {
    // deno-lint-ignore no-explicit-any
    const chain: any = new Proxy(function chainable() {}, {
      get(_target, prop) {
        const settle = () => ("__reject" in result
          ? Promise.reject(result.__reject)
          : Promise.resolve(result));
        if (prop === "then") {
          // deno-lint-ignore no-explicit-any
          return (a: any, b: any) =>
            settle().then(a, b);
        }
        // deno-lint-ignore no-explicit-any
        if (prop === "catch") return (a: any) => settle().catch(a);
        // deno-lint-ignore no-explicit-any
        if (prop === "finally") return (a: any) => settle().finally(a);
        if (prop === "update" || prop === "insert") {
          return (...args: unknown[]) => {
            onCall({ method: prop as "update" | "insert", table, args });
            return chainFor(result, table);
          };
        }
        return (..._args: unknown[]) => chainFor(result, table);
      },
    });
    return chain;
  };
  const nextFromResult = (table: string): ChainResult => {
    if (table === "crash_bets") return { data: bet, error: null };
    if (table === "crash_shared_rounds") {
      return {
        data: makeRound({
          phase: "active",
          start_timestamp: new Date().toISOString(),
          crash_point: null,
          ...roundOverrides,
        }),
        error: null,
      };
    }
    if (table === "crash_hash_chains") return chainResult;
    return { data: null, error: null };
  };
  const schemaObj = {
    rpc: (fnName: string, args?: Record<string, unknown>) => {
      onRpc?.({ name: fnName, args: args ?? {} });
      return chainFor(rpc[fnName] ?? { data: null, error: null }, "");
    },
    from: (table: string) => chainFor(nextFromResult(table), table),
  };
  return {
    schema: () => schemaObj,
    from: (table: string) => chainFor(nextFromResult(table), table),
  } as unknown as SupabaseClient;
}

/** Alert spy — same monkeypatch technique as libs/application/src/lib/game/engine_test.ts's spyOnAlerts(). */
function spyOnCrashAlerts(): {
  readonly calls: ReadonlyArray<TechnicalAlertPayload>;
  restore: () => void;
} {
  let calls: ReadonlyArray<TechnicalAlertPayload> = [];
  const original = alertingService.sendTechnicalAlert.bind(alertingService);
  alertingService.sendTechnicalAlert = (
    payload: TechnicalAlertPayload,
  ): void => {
    calls = [...calls, payload];
  };
  return {
    get calls() {
      return calls;
    },
    restore: () => {
      alertingService.sendTechnicalAlert = original;
    },
  };
}

const crashBetUpdate = (
  calls: ChainCall[],
): Record<string, unknown> | undefined =>
  calls.find((c) => c.method === "update" && c.table === "crash_bets")
    ?.args[0] as Record<string, unknown> | undefined;

const crashCheckpointInsert = (
  calls: ChainCall[],
): Record<string, unknown> | undefined =>
  calls.find((c) => c.method === "insert" && c.table === "game_checkpoints")
    ?.args[0] as Record<string, unknown> | undefined;

// The 384.08 writer-path pins. The claim RPC replaced the wallet call, the
// optimistic lock and the two-path split branch; what these tests now pin is
// that the handler reaches the claim RPC at all, and that the values it echoes
// come from the RPC's returned row rather than from the request.
Deno.test("handleMultiplayerCashout: 384-08 — crash.cashout payload carries the claim RPCs is_auto and no player_id", async () => {
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      makeCashoutSupabase({ crash_claim_and_payout_bet: CREDITED }, 2.5),
      makeSession("3f7a1c2d-9e4b-4a11-b8c0-111122223333"),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.0 },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  const cashouts = broadcasts.filter((b) => b.eventType === "crash.cashout");
  assertEquals(cashouts.length, 1);
  const payload = cashouts[0].payload;
  assertEquals(payload.is_auto, false);
  assertEquals(payload.round_id, "d87609d0-a636-48f4-89b2-bf738e72cc35");
  assertEquals(payload.player_display_name, "Player_3333");
  assertEquals(payload.multiplier, 1.24);
  assertEquals(payload.win_amount, 12.4);
  assertEquals("player_id" in payload, false);
});

Deno.test("handleMultiplayerCashout: D6 — the claim is keyed to the round and the SESSION player, once", async () => {
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  const session = makeSession("3f7a1c2d-9e4b-4a11-b8c0-111122223333");
  await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      makeCashoutSupabase(
        { crash_claim_and_payout_bet: CREDITED },
        2.5,
        capture,
      ),
      session,
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.0 },
      CORS_HEADERS,
    )
  );

  const calls = capture.rpcCalls.crash_claim_and_payout_bet ?? [];
  assertEquals(
    calls.length,
    1,
    "a retry is the RPCs own business; the handler must not claim twice",
  );
  const args = calls[0] as Record<string, unknown>;
  // The old `crash:win:{roundId}:{playerId}` string key is now the claim itself:
  // the RPC keys its ledger write off (round, bet, source) under its own lock.
  assertEquals(args.p_round_id, "d87609d0-a636-48f4-89b2-bf738e72cc35");
  assertEquals(args.p_player_id, session.playerAccountId);
  assertEquals(args.p_source, "manual");
  assertEquals(capture.rpcCalls.wallet_credit ?? [], []);
});

Deno.test("handleMultiplayerCashout: D6 — a split bet takes the SAME single claim path", async () => {
  // There is no longer a split branch. A split leg is a crash_bets row with a
  // split_group_id; the claim RPC settles every leg of the group itself and
  // returns the summed win_amount, so the handler has nothing to branch on.
  const capture = { rpcCalls: {} as Record<string, unknown[]> };
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      makeCrashSupabase(
        {
          fromSequence: {
            crash_bets: [{
              data: {
                ...CASHOUT_BET,
                bet_amount: 20,
                split_group_id: "split-9",
              },
              error: null,
            }],
          },
          from: {
            crash_shared_rounds: {
              data: makeRound({
                phase: "active",
                start_timestamp: new Date().toISOString(),
                crash_point: null,
              }),
              error: null,
            },
          },
          rpc: {
            crash_claim_and_payout_bet: {
              data: {
                ...CREDITED_ROW,
                win_amount: 29.8,
                cashout_multiplier: 1.49,
              },
              error: null,
            },
          },
        },
        capture,
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.0 },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  const args = capture.rpcCalls.crash_claim_and_payout_bet[0] as Record<
    string,
    unknown
  >;
  assertEquals(
    args.p_bet_id,
    "bet-1",
    "the leg, not the group, is what the claim names",
  );
  assertEquals(capture.rpcCalls.wallet_settle_split_win ?? [], []);
  const body = await result.json();
  assertEquals(
    body.win_amount,
    29.8,
    "the summed leg total is the RPCs to report",
  );
  assertEquals(
    broadcasts.find((b) => b.eventType === "crash.cashout")?.payload.win_amount,
    29.8,
  );
});

Deno.test("handleMultiplayerCashout: D6 — the response win_amount and the announced win_amount are the same figure", async () => {
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      makeCrashoutSupabase20(),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.0 },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  const announced = broadcasts.find((b) => b.eventType === "crash.cashout")
    ?.payload.win_amount;
  assertEquals(
    (await result.json()).win_amount,
    announced,
    "the feed and the caller can never disagree about what was won",
  );
});

const makeCrashoutSupabase20 = (): SupabaseClient =>
  makeCashoutSupabase(
    {
      crash_claim_and_payout_bet: {
        data: { ...CREDITED_ROW, win_amount: 20, cashout_multiplier: 2 },
        error: null,
      },
    },
    2.5,
  );

// ============================================================================
// 384.3 — the recorded amount is the CLAIM RPC's, not a recomputation.
//
// The old F1/R5-B1/R7-N1 family all derived the reported level from a wallet
// transaction row and reconciled it against the request. Under the claim RPC
// that reconciliation is gone by construction: the RPC returns the pair it
// actually paid, and the handler has no other pair to compute. The tests below
// pin the four surfaces that pair reaches, and pin that the handler NEVER
// derives one.
// ============================================================================

const claimSupabase = (
  rpc: Record<string, ChainResult>,
  onCall: (call: ChainCall) => void,
  bet: Record<string, unknown> = { ...CASHOUT_BET, bet_amount: 10 },
  /** The level the round's curve has already reached — must cover the request. */
  level = 2.5,
): SupabaseClient =>
  makeCapturingCashoutSupabase(
    bet,
    rpc,
    onCall,
    {
      start_timestamp: new Date(Date.now() - crashDurationMs(level))
        .toISOString(),
    },
  );

Deno.test("handleMultiplayerCashout: F1 — a REPLAYED claim reports the pair the ledger holds, on all four surfaces", async () => {
  // bet 10, request 1.0 — this handler would compute ~10. The claim was already
  // taken by a worker tick at 1.5x, so the ledger holds 15.
  let calls: ChainCall[] = [];
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      claimSupabase(
        {
          crash_claim_and_payout_bet: {
            data: {
              ...CREDITED_ROW,
              outcome: "replayed",
              cashout_multiplier: 1.5,
              win_amount: 15,
            },
            error: null,
          },
        },
        (c) => {
          calls = [...calls, c];
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      {
        cashout_multiplier: 1.0,
        session_id: "3672701e-8c37-4bee-87cc-b05cbd4af325",
      },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  const body = await result.json();
  // 1. the HTTP response the player is shown
  assertEquals(body.win_amount, 15);
  assertEquals(body.cashout_multiplier, 1.5);
  // 2. the social-feed broadcast
  const cashout = broadcasts.find((b) => b.eventType === "crash.cashout");
  assertEquals(cashout?.payload.win_amount, 15);
  assertEquals(cashout?.payload.multiplier, 1.5);
  // 3. the resume checkpoint
  await new Promise((resolve) => setTimeout(resolve, 50));
  const checkpoint = crashCheckpointInsert(calls);
  assertExists(
    checkpoint,
    "the paid path MUST checkpoint, or a crash here loses the round to every other player",
  );
  assertEquals(
    (checkpoint?.wallet_state as Record<string, unknown>).win_amount,
    15,
  );
  assertEquals(
    (checkpoint?.game_state as Record<string, unknown>).cashout_multiplier,
    1.5,
  );
  // 4. the bet row is the RPC's to write — this handler must not also write it,
  //    or a divergent pair could reach the row the reconcile reads.
  assertEquals(crashBetUpdate(calls), undefined);
});

Deno.test("handleMultiplayerCashout: F1 — a claim with a SHORT pair is reported as-is, not corrected toward the request", async () => {
  // A bonus leg that was not granted: the real leg credited 7 on a 10 bet. The
  // old code "corrected" the stored level to 0.7 from the amount. The RPC now
  // returns the pair it paid, so a mismatch is the RPCs to own.
  let calls: ChainCall[] = [];
  const { result } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      claimSupabase(
        {
          crash_claim_and_payout_bet: {
            data: { ...CREDITED_ROW, cashout_multiplier: 1.4, win_amount: 7 },
            error: null,
          },
        },
        (c) => {
          calls = [...calls, c];
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.0 },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  const body = await result.json();
  assertEquals(body.win_amount, 7, "the ledgers figure, not the requests");
  assertEquals(
    body.cashout_multiplier,
    1.4,
    "the ledgers level, verbatim — the handler does not re-derive it",
  );
});

Deno.test("handleMultiplayerCashout: R5-B1 — the paid pair is the RPCs on every shortfall and over-credit shape", async () => {
  // The property sweep the old formula broke: whatever pair the claim paid, that
  // exact pair is what the player is shown and what the feed announces.
  for (
    const [multiplier, credited] of [[0.7, 7], [1.5, 15], [2.0, 20], [
      1.64,
      16.4,
    ]] as const
  ) {
    let calls: ChainCall[] = [];
    const { result, broadcasts } = await withBroadcastCapture(() =>
      handleMultiplayerCashout(
        claimSupabase(
          {
            crash_claim_and_payout_bet: {
              data: {
                ...CREDITED_ROW,
                cashout_multiplier: multiplier,
                win_amount: credited,
              },
              error: null,
            },
          },
          (c) => {
            calls = [...calls, c];
          },
        ),
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        { cashout_multiplier: 2.0 },
        CORS_HEADERS,
      )
    );

    assertEquals(result.status, 200, `credited=${credited}`);
    const body = await result.json();
    assertEquals(body.win_amount, credited, `credited=${credited}`);
    assertEquals(body.cashout_multiplier, multiplier, `credited=${credited}`);
    assertEquals(
      broadcasts.find((b) => b.eventType === "crash.cashout")?.payload
        .win_amount,
      credited,
      `credited=${credited}`,
    );
  }
});

Deno.test("handleMultiplayerCashout: R5-B1 — a zero-credited split claim is reported as 0, not as no row", async () => {
  // Every leg bonus-only: the claim paid nothing. `win_amount: 0` is a REAL
  // outcome; a falsy check that treats it as "no row" would page for a settled
  // bet and refuse a legitimate cashout.
  let calls: ChainCall[] = [];
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      claimSupabase(
        {
          crash_claim_and_payout_bet: {
            data: { ...CREDITED_ROW, cashout_multiplier: 1.5, win_amount: 0 },
            error: null,
          },
        },
        (c) => {
          calls = [...calls, c];
        },
        { ...CASHOUT_BET, bet_amount: 10, split_group_id: "split-9" },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      {
        cashout_multiplier: 1.0,
        session_id: "3672701e-8c37-4bee-87cc-b05cbd4af325",
      },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  assertEquals((await result.json()).win_amount, 0);
  assertEquals(
    broadcasts.filter((b) => b.eventType === "crash.cashout").length,
    1,
    "a settled bet is still a settled bet",
  );
});

Deno.test("handleMultiplayerCashout: R7-N1 — an unconfirmed (non-finite) figure is refused, never rounded to a playable one", async () => {
  // Defence in depth: an honest claim RPC returns a NUMERIC, so this cannot
  // arise. A tampered or drifted row returning NaN must never reach
  // toFixed, which would render "NaN" into the feed and the checkpoint.
  let calls: ChainCall[] = [];
  const alerts = spyOnCrashAlerts();
  try {
    const { result, broadcasts } = await withBroadcastCapture(() =>
      handleMultiplayerCashout(
        claimSupabase(
          {
            crash_claim_and_payout_bet: {
              data: {
                ...CREDITED_ROW,
                cashout_multiplier: "x",
                win_amount: 14.8,
              },
              error: null,
            },
          },
          (c) => {
            calls = [...calls, c];
          },
        ),
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        {
          cashout_multiplier: 1.0,
          session_id: "3672701e-8c37-4bee-87cc-b05cbd4af325",
        },
        CORS_HEADERS,
      )
    );

    assertEquals(result.status, 500);
    assertEquals(broadcasts.length, 0);
    assertEquals(crashCheckpointInsert(calls), undefined);
    assertEquals(
      alerts.calls.filter((c) => c.error_type === "crash_payout_rpc_failed")
        .length,
      1,
    );
  } finally {
    alerts.restore();
  }
});

Deno.test("handleMultiplayerCashout: R8-B1 — is_auto is the claims provenance, whatever the level is", async () => {
  // The old rule derived the tag by comparing the paid level to `auto_cashout_at`,
  // so a click one hundredth inside the armed level was announced [auto] to
  // every player's feed. The claim RPC records the SOURCE, and the handler reads
  // it. These four cases are the discriminator set that the level comparison got
  // wrong: only `cashout_source` separates them.
  const cases: readonly [string, string | null, boolean][] = [
    ["a click one hundredth inside the armed 1.50", "manual", false],
    ["a click at exactly the armed 1.50", "manual", false],
    ["a worker credit at 1.64, far from the armed 1.50", "auto", true],
    ["a split leg settled by hand", "manual", false],
  ];
  for (const [label, source, wantAuto] of cases) {
    let calls: ChainCall[] = [];
    const { result, broadcasts } = await withBroadcastCapture(() =>
      handleMultiplayerCashout(
        claimSupabase(
          {
            crash_claim_and_payout_bet: {
              data: {
                ...CREDITED_ROW,
                cashout_source: source,
                is_auto: wantAuto,
              },
              error: null,
            },
          },
          (c) => {
            calls = [...calls, c];
          },
          {
            ...CASHOUT_BET,
            auto_cashout_at: 1.5,
            split_group_id: source === "manual" ? "split-1" : null,
          },
        ),
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        {
          cashout_multiplier: 1.0,
          session_id: "3672701e-8c37-4bee-87cc-b05cbd4af325",
        },
        CORS_HEADERS,
      )
    );

    assertEquals(result.status, 200, label);
    assertEquals((await result.json()).is_auto, wantAuto, label);
    assertEquals(
      broadcasts.find((b) => b.eventType === "crash.cashout")?.payload.is_auto,
      wantAuto,
      label,
    );
  }
});

Deno.test("handleMultiplayerCashout: R8-B1 — a body claiming is_auto:true cannot tag a click automatic", async () => {
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      claimSupabase({ crash_claim_and_payout_bet: CREDITED }, () => {}),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.49, is_auto: true },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  assertEquals((await result.json()).is_auto, false);
  assertEquals(
    broadcasts.find((b) => b.eventType === "crash.cashout")?.payload.is_auto,
    false,
  );
});

Deno.test("handleMultiplayerCashout: F1 — a NULL win_amount is an unconfirmed claim, not a zero win", async () => {
  // `Number(null) === 0` and 0 is finite, so a truthiness/finiteness check on the
  // raw value would render a 0.00 win the player never received.
  const alerts = spyOnCrashAlerts();
  try {
    const { result, broadcasts } = await withBroadcastCapture(() =>
      handleMultiplayerCashout(
        claimSupabase({
          crash_claim_and_payout_bet: {
            data: { ...CREDITED_ROW, win_amount: null },
            error: null,
          },
        }, () => {}),
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        {
          cashout_multiplier: 1.0,
          session_id: "3672701e-8c37-4bee-87cc-b05cbd4af325",
        },
        CORS_HEADERS,
      )
    );
    assertEquals(result.status, 500);
    assertEquals(broadcasts.length, 0);
    assertEquals(
      alerts.calls.filter((c) => c.error_type === "crash_payout_rpc_failed")
        .length,
      1,
    );
  } finally {
    alerts.restore();
  }
});

Deno.test("handleMultiplayerCashout: F1 — a NULL cashout_multiplier is an unconfirmed claim, never the requests level", async () => {
  // The old code fell back to the request-bound level, which on a replay
  // reported a level the money was never paid at.
  let calls: ChainCall[] = [];
  const { result, broadcasts } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      claimSupabase({
        crash_claim_and_payout_bet: {
          data: { ...CREDITED_ROW, cashout_multiplier: null, win_amount: 15 },
          error: null,
        },
      }, (c) => {
        calls = [...calls, c];
      }),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      {
        cashout_multiplier: 1.0,
        session_id: "3672701e-8c37-4bee-87cc-b05cbd4af325",
      },
      CORS_HEADERS,
    )
  );

  assertEquals(
    result.status,
    500,
    "a level the RPC cannot confirm is not filled in from the request",
  );
  assertEquals(broadcasts.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertEquals(crashCheckpointInsert(calls), undefined);
});

// 384-09 Task 5 / T-384-09-3 -- the manual cashout's server-resolved crash guard
// ============================================================================
// Production-shaped: `crash_point` is NULL all ACTIVE, so the guard resolves from `crash_hash_chains`; every case is a hand click.

/** The boundary: the round CRASHED at 1.50. */
const CHAIN_CRASH = 1.5;

/** A round whose curve has already reached `level` (see makeCapturingCashoutSupabase). */
const reachedLevel = (level: number): Record<string, unknown> => ({
  start_timestamp: new Date(Date.now() - crashDurationMs(level)).toISOString(),
  hash_chain_index: 5,
});

/** A hand click the claim RPC pays at `level` on a 10 bet. */
const claimAt = (
  level: number,
  data: Record<string, unknown> = {},
): Record<string, ChainResult> => ({
  crash_claim_and_payout_bet: {
    data: {
      ...CREDITED_ROW,
      cashout_multiplier: level,
      win_amount: 10 * level,
      ...data,
    },
    error: null,
  },
});

/** The guard mock for a hand-click cashout at `level`, with the chain's own crash point. */
const guardSupabase = (
  level: number,
  chainResult: ChainResult,
  onCall: (call: ChainCall) => void = () => {},
  onRpc?: (call: { name: string; args: Record<string, unknown> }) => void,
) =>
  makeCapturingCashoutSupabase(
    { ...CASHOUT_BET, bet_amount: 10 },
    claimAt(level),
    onCall,
    reachedLevel(level),
    chainResult,
    onRpc,
  );

Deno.test("384-09 T-384-09-3: server multiplier 1.60 ABOVE the 1.50 crash point — 409, zero claim calls", async () => {
  let calls: ChainCall[] = [];
  let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const { result } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      guardSupabase(
        1.6,
        { data: { crash_point: CHAIN_CRASH }, error: null },
        (c) => {
          calls = [...calls, c];
        },
        (c) => {
          rpcCalls = [...rpcCalls, c];
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.6 },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 409);
  assertEquals(
    (await result.json()).error.message,
    "Round has already crashed",
  );
  assertEquals(rpcCalls, [], "a refused cashout must move no money");
  assertEquals(crashBetUpdate(calls), undefined);
});

Deno.test("384-09 T-384-09-3: server multiplier 1.49 BELOW the 1.50 crash point — 200, paid at 1.49", async () => {
  let calls: ChainCall[] = [];
  const { result } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      guardSupabase(
        1.49,
        { data: { crash_point: CHAIN_CRASH }, error: null },
        (c) => {
          calls = [...calls, c];
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: 1.49 },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  const body = await result.json();
  assertEquals(body.cashout_multiplier, 1.49);
  assertEquals(body.win_amount, 10 * 1.49);
});

Deno.test("384-09 T-384-09-3: server multiplier EXACTLY 1.50 — 409 (R1: the frame showing the crash value IS the crash)", async () => {
  let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let calls: ChainCall[] = [];
  const { result } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      guardSupabase(
        CHAIN_CRASH,
        { data: { crash_point: CHAIN_CRASH }, error: null },
        (c) => {
          calls = [...calls, c];
        },
        (c) => {
          rpcCalls = [...rpcCalls, c];
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35",
      { cashout_multiplier: CHAIN_CRASH },
      CORS_HEADERS,
    )
  );

  assertEquals(
    result.status,
    409,
    "the crash boundary is CLOSED on the manual path: armed == crash must not pay",
  );
  assertEquals(rpcCalls, []);
  assertEquals(crashBetUpdate(calls), undefined);
});

Deno.test("384-09 T-384-09-3: an unresolvable chain read — 500, a critical alert, zero claim calls", async () => {
  let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let calls: ChainCall[] = [];
  const alerts = spyOnCrashAlerts();
  try {
    const { result } = await withBroadcastCapture(() =>
      handleMultiplayerCashout(
        guardSupabase(
          1.49,
          { data: null, error: { message: "chain store unreachable" } },
          (c) => {
            calls = [...calls, c];
          },
          (c) => {
            rpcCalls = [...rpcCalls, c];
          },
        ),
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        { cashout_multiplier: 1.49 },
        CORS_HEADERS,
      )
    );

    assertEquals(
      result.status,
      500,
      'the guard fails CLOSED: unresolvable must never mean "allowed"',
    );
    assertEquals(
      (await result.json()).error.message,
      "Cashout failed, please retry",
    );
    assertEquals(rpcCalls, []);
    assertEquals(crashBetUpdate(calls), undefined);
    assertEquals(
      alerts.calls.filter((c) =>
        c.error_type === "crash_cashout_guard_unresolved"
      ).map((c) => c.severity_tier),
      ["critical"],
    );
  } finally {
    alerts.restore();
  }
});

// --- Leak pins: the resolved 1.50 must reach NONE of these three sinks (R4) ---

Deno.test("384-09 T-384-09-3 LEAK: the guard-resolved crash point never reaches the checkpoint or the response", async () => {
  let calls: ChainCall[] = [];
  let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const { result } = await withBroadcastCapture(() =>
    handleMultiplayerCashout(
      guardSupabase(
        1.49,
        { data: { crash_point: CHAIN_CRASH }, error: null },
        (c) => {
          calls = [...calls, c];
        },
        (c) => {
          rpcCalls = [...rpcCalls, c];
        },
      ),
      makeSession(),
      "d87609d0-a636-48f4-89b2-bf738e72cc35", // session_id REQUIRED: `writeCrashCheckpoint` returns early without it, so any checkpoint-content assertion passes vacuously.
      {
        cashout_multiplier: 1.49,
        session_id: "e25c3f55-5ad2-4e81-8be3-23fc79b1b4c8",
      },
      CORS_HEADERS,
    )
  );

  assertEquals(result.status, 200);
  // The checkpoint write is fire-and-forget, so let its microtask chain land before reading.
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Assert EXISTENCE before contents: `undefined ?? null` would otherwise satisfy any
  // "is it null" assertion without the insert ever happening (a vacuous pass).
  const checkpoint = crashCheckpointInsert(calls);
  assertExists(
    checkpoint,
    "the checkpoint insert MUST be present — otherwise this test proves nothing",
  );
  assertEquals(
    (checkpoint.game_state as Record<string, unknown>).crash_point,
    null,
    "the checkpoint nests crash_point under game_state; it must never gain the guard-resolved point",
  );
  const body = await result.json();
  assertEquals(
    Object.keys(body).includes("crash_point"),
    false,
    "the response body is the last sink — T-384-09-4",
  );
  assertEquals(body.is_auto, false);
});

// --- is_auto on both response paths ---

Deno.test("384-09 is_auto: a PLAYERs own claim is is_auto=false and a WORKERs claim is is_auto=true", async () => {
  // The 1-row and 0-row response paths collapsed into one: the handler makes no
  // bet-row write, so there is no lock that can be won or lost. Both figures
  // come from the same claim RPC row.
  for (
    const [label, data] of [["player", {
      cashout_source: "manual",
      is_auto: false,
    }], ["worker", { cashout_source: "auto", is_auto: true }]] as const
  ) {
    const { result } = await withBroadcastCapture(() =>
      handleMultiplayerCashout(
        claimSupabase({
          crash_claim_and_payout_bet: {
            data: { ...CREDITED_ROW, ...data },
            error: null,
          },
        }, () => {}),
        makeSession(),
        "d87609d0-a636-48f4-89b2-bf738e72cc35",
        { cashout_multiplier: 1.49 },
        CORS_HEADERS,
      )
    );
    assertEquals(result.status, 200, label);
    assertEquals((await result.json()).is_auto, data.is_auto, label);
  }
});

// ============================================================================
// 384-09 Task 9 / item 5 — server-derived is_auto on the current round
// ============================================================================

/** A crashed round holding a settled bet, so the provenance read actually runs. */
const SETTLED_ROUND = {
  crash_shared_rounds: {
    data: makeRound({ phase: "crashed", crash_point: 3.45 }),
    error: null,
  },
};
const SETTLED_BET = {
  id: "bet-1",
  bet_amount: 10,
  auto_cashout_at: 2,
  cashout_multiplier: 2,
  win_amount: 20,
  status: "cashed_out",
  cashout_source: "manual",
};

/** Reads player_bet off a real response. The provenance now comes from the bet
 * row's own `cashout_source` column, so NO wallet read happens at all. */
const currentRoundPlayerBet = async (
  bet: Record<string, unknown> = SETTLED_BET,
): Promise<Record<string, unknown>> => {
  const counts: Record<string, number> = {};
  const supabase = makeCrashSupabase(
    {
      from: {
        ...SETTLED_ROUND,
        crash_bets: { data: bet, error: null },
        crash_hash_chains: { data: { hash: "terminal" }, error: null },
      },
    },
    undefined,
    counts,
  );
  const body = await (await handleGetCurrentRound(
    supabase,
    "b1111111-1111-4111-8111-111111111111",
    makeSession(),
    CORS_HEADERS,
  )).json();
  // A provenance lookup that reads a different table is a bug: `cashout_source`
  // was written on the same claim that set the bet's status.
  assertEquals(
    counts.wallet_transactions ?? 0,
    0,
    "provenance is a column on the bet row, not a wallet read",
  );
  return body.player_bet;
};

Deno.test("384-09 is_auto: a bet the WORKER paid carries is_auto true", async () => {
  const playerBet = await currentRoundPlayerBet({
    ...SETTLED_BET,
    cashout_source: "auto",
  });
  assertEquals(playerBet.is_auto, true);
});

Deno.test("384-09 is_auto: a SWEEP payout also carries is_auto true", async () => {
  const playerBet = await currentRoundPlayerBet({
    ...SETTLED_BET,
    cashout_source: "sweep",
  });
  assertEquals(playerBet.is_auto, true);
});

Deno.test("384-09 is_auto: a bet the PLAYER cashed out carries is_auto false", async () => {
  const playerBet = await currentRoundPlayerBet({
    ...SETTLED_BET,
    cashout_source: "manual",
  });
  assertEquals(playerBet.is_auto, false);
});

Deno.test("384-09 is_auto: a bet that is NOT cashed out is is_auto false whatever its source column holds", async () => {
  const playerBet = await currentRoundPlayerBet({
    ...SETTLED_BET,
    status: "active",
    win_amount: null,
    cashout_source: null,
  });
  assertEquals(playerBet.is_auto, false);
});

Deno.test("384-09 is_auto: the 7-key player_bet never carries session_id, split_group_id or cashout_source", async () => {
  // The two columns the handler reads and strips: `session_id` must not leak to
  // another player's client, and `cashout_source` is an internal provenance
  // label, not part of the response contract.
  const playerBet = await currentRoundPlayerBet({
    ...SETTLED_BET,
    session_id: "24e19d56-814f-4516-8ceb-2a8def471a68",
  });
  assertEquals(
    Object.keys(playerBet).sort(),
    [
      "auto_cashout_at",
      "bet_amount",
      "cashout_multiplier",
      "id",
      "is_auto",
      "status",
      "win_amount",
    ],
  );
});
