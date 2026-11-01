/**
 * Crash round-query handlers — 286-S11 Task 3 (move-only, byte-identical).
 *
 * Moved from crash-multiplayer-handlers.ts (885 LOC god-module, DIRECTION §2.10).
 * GROWTH_K is sourced from '@igaming/domain' (S06a extraction) — the local
 * duplicate was deleted in Task 2; this module never held a local copy.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccessSession } from "@igaming/domain";
import { GROWTH_K } from "@igaming/domain";
import { createErrorResponse } from "@igaming/infrastructure";
import { refuseNonUuid } from "../request-validation.ts";
import type { LiveCrashBetRow } from "./crash-checkpoint-consistency.ts";
import { verifyCrashResumeCheckpoint } from "./crash-checkpoint-consistency.ts";

// -- GET /crash/rounds/current ────────────────────────────────────────────────

/**
 * Get current round state for a variant. Used by clients to sync on
 * page load or reconnection. Returns the latest non-completed round.
 */
export async function handleGetCurrentRound(
  supabase: SupabaseClient,
  variantId: string,
  session: AccessSession | null,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const refusedVariant = variantId
    ? refuseNonUuid(variantId, "variant_id", corsHeaders)
    : null;
  if (refusedVariant) return refusedVariant;
  const vId = variantId || "00000000-0000-0000-0000-000000000006";

  const { data: round, error } = await supabase
    .schema("game" as never)
    .from("crash_shared_rounds")
    .select(
      "id, variant_id, round_number, phase, start_timestamp, betting_ends_at, crashed_at, crash_point, created_at",
    )
    .eq("variant_id", vId)
    .in("phase", ["betting", "active", "crashed", "cooldown"])
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return createErrorResponse({
      _tag: "InternalError",
      code: "INTERNAL_ERROR",
      message: "Failed to fetch current round",
      statusCode: 500,
    }, corsHeaders);
  }

  if (!round) {
    // terminal_hash is part of this endpoint's documented response STRUCTURE
    // (crash.integration.test.ts "current-round": both keys must exist even
    // when round is null). This branch omitted the key since Phase 162 added
    // it only to the has-round path below — an intermittent integration
    // failure whenever no round happened to be live for the variant at query
    // time (Plan 338-04 finding). null (not a chain read) keeps this branch
    // read-free and its unit doubles single-query.
    return new Response(
      JSON.stringify({
        round: null,
        message: "No active round",
        terminal_hash: null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }

  // Only reveal crash_point if round has crashed
  const safeRound = {
    id: round.id,
    variant_id: round.variant_id,
    round_number: round.round_number,
    phase: round.phase,
    start_timestamp: round.start_timestamp,
    betting_ends_at: round.betting_ends_at,
    crashed_at: round.crashed_at,
    crash_point: (round.phase === "crashed" || round.phase === "cooldown")
      ? round.crash_point
      : null,
    growth_k: GROWTH_K,
  };

  // Include player's bet if authenticated
  // deno-lint-ignore no-explicit-any
  let playerBet: Record<string, any> | null = null;
  if (session?.playerAccountId) {
    const { data: bet } = await supabase
      .schema("game" as never)
      .from("crash_bets")
      .select(
        "id, bet_amount, auto_cashout_at, cashout_multiplier, win_amount, status, session_id, cashout_source",
      )
      .eq("round_id", round.id)
      .eq("player_id", session.playerAccountId)
      .maybeSingle();

    if (bet) {
      // Split out so the client-visible player_bet keeps its exact 7-key shape; pinned by
      // crash-checkpoint-migration-diff.integration.test.ts. See 384-09-PLAN.md.
      const {
        session_id: betSessionId,
        cashout_source: betCashoutSource,
        ...publicBet
      } = bet as LiveCrashBetRow & {
        session_id: string | null;
        cashout_source: string | null;
      };
      // 384.3: `cashout_source` is the column `game.crash_claim_and_payout_bet`
      // records on the bet (migration :686-690), so provenance is a fact about
      // THIS row rather than a second wallet read that the hand-written credit
      // paths could not answer. `sweep` paid a bet too, so it reads as auto.
      const isAuto = betCashoutSource === "auto" ||
        betCashoutSource === "sweep";
      playerBet = { ...publicBet, is_auto: isAuto };

      // Read-side checkpoint consumer (v0.1.27 milestone-audit Finding 2):
      // cross-validate the canonical game.game_checkpoints row against the
      // live crash_bets row being returned. Corroboration/alerting ONLY —
      // the response is built from the live tables regardless of outcome; a
      // checkpoint can never override crash_bets (the module's documented
      // invariant, mirroring the recovery sweep's never-trust-cached-state
      // rule). Awaited (one indexed read); structurally cannot reject.
      await verifyCrashResumeCheckpoint(supabase, {
        sessionId: typeof betSessionId === "string" && betSessionId
          ? betSessionId
          : null,
        liveBet: publicBet,
        currentRoundId: round.id,
      });
    }
  }

  // Fetch terminal hash for provably fair display (Phase 162)
  const { data: terminalEntry } = await supabase
    .schema("game" as never)
    .from("crash_hash_chains")
    .select("hash")
    .eq("variant_id", vId)
    .eq("chain_index", 0)
    .maybeSingle();

  return new Response(
    JSON.stringify({
      round: safeRound,
      player_bet: playerBet,
      terminal_hash: terminalEntry?.hash ?? null,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    },
  );
}

// -- GET /crash/rounds/history ────────────────────────────────────────────────

/**
 * Get recent completed crash rounds for the round history strip.
 * Returns last N rounds with crash points and aggregate wagering stats.
 * Phase 161: Uses crash_round_history_with_stats RPC for social features tooltip.
 */
export async function handleGetRoundHistory(
  supabase: SupabaseClient,
  variantId: string,
  limit: number,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const refusedVariant = variantId
    ? refuseNonUuid(variantId, "variant_id", corsHeaders)
    : null;
  if (refusedVariant) return refusedVariant;
  const vId = variantId || "00000000-0000-0000-0000-000000000006";
  const whole = Number.isFinite(limit) ? Math.floor(limit) : 0;
  const safeLimit = Math.min(Math.max(1, whole || 20), 50);

  const { data: rounds, error } = await supabase
    .schema("game" as never)
    .rpc("crash_round_history_with_stats", {
      p_variant_id: vId,
      p_limit: safeLimit,
    });

  if (error) {
    return createErrorResponse({
      _tag: "InternalError",
      code: "INTERNAL_ERROR",
      message: "Failed to fetch round history",
      statusCode: 500,
    }, corsHeaders);
  }

  return new Response(
    JSON.stringify({ rounds: rounds ?? [] }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    },
  );
}
