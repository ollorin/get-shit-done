/**
 * Unit tests for validateCatalogParams / validateGameListParams
 * (285-40 — coverage-gate genuine-gap closure, discovered while chasing a
 * libs/domain BLOCK during the rules-engine SC-3 router conversion).
 *
 * Investigation: raw `deno coverage --include=libs/domain` showed
 * lib/schemas/validation.ts's branch coverage sitting at ~49% file-average,
 * dragging the whole domain's aggregate below its coverage-gate target.
 * Root cause confirmed via lcov BRDA inspection — every "optional query
 * param present" branch in validateCatalogParams (country, casino_brand,
 * player_segment, game_types, include_assets, sort_by, sort_order) and
 * validateGameListParams (game_type, game_provider, search, tags, sort_by,
 * sort_order) reads 0 hits. The only existing callers
 * (functions/games-catalog/handler-coverage.test.ts,
 * functions/games-crud/handlers/list-games.test.ts) only ever exercise
 * jurisdiction/limit/offset/status/country — never the rest of the optional
 * surface — so these branches were never reachable through the handler
 * tests. `git diff --stat aec733e5 HEAD -- libs/domain` confirms
 * validation.ts itself has not changed since the coverage baseline was
 * recorded (285-34) — this is a pre-existing gap in the *consumers'* test
 * coverage of this domain function, not something 285-40 introduced.
 * Closing it directly at the domain layer (rather than adding more
 * query-param variations to the handler tests) tests the validators where
 * they live and has zero blast radius on functions/.
 */

import { assertEquals } from "@std/assert";
import {
  isValidUUID,
  normalizeInput,
  validateCatalogParams,
  validateGameData,
  validateGameId,
  validateGameListParams,
} from "./validation.ts";
import { getValidationIssues } from "../errors/fp/validation.ts";
import {
  expectErr,
  expectOk,
} from "../../../../test-utils/fp-assertions.ts";

// ============================================================================
// validateCatalogParams
// ============================================================================

Deno.test("validateCatalogParams — required jurisdiction only, all defaults applied", () => {
  const url = new URL("http://localhost/games-catalog?jurisdiction=NG");
  const result = validateCatalogParams(url);

  expectOk(result);
  assertEquals(result.value.jurisdiction, "NG");
  assertEquals(result.value.country, "US");
  assertEquals(result.value.player_segment, "BRONZE");
  assertEquals(result.value.game_types, []);
  assertEquals(result.value.limit, 50);
  assertEquals(result.value.offset, 0);
  assertEquals(result.value.include_assets, true);
  assertEquals(result.value.sort_by, "published_at");
  assertEquals(result.value.sort_order, "desc");
});

Deno.test("validateCatalogParams — missing jurisdiction returns a REQUIRED ValidationError", () => {
  const url = new URL("http://localhost/games-catalog");
  const result = validateCatalogParams(url);

  expectErr(result);
  const issues = getValidationIssues(result.error);
  assertEquals(issues[0].field, "jurisdiction");
  assertEquals(issues[0].code, "REQUIRED");
});

Deno.test("validateCatalogParams — empty-string jurisdiction returns a REQUIRED ValidationError", () => {
  const url = new URL("http://localhost/games-catalog?jurisdiction=");
  const result = validateCatalogParams(url);

  expectErr(result);
  const issues = getValidationIssues(result.error);
  assertEquals(issues[0].field, "jurisdiction");
});

Deno.test("validateCatalogParams — every optional param present is parsed through to the schema output", () => {
  const url = new URL(
    "http://localhost/games-catalog?jurisdiction=NG&country=NG&casino_brand=egypt_riches" +
      "&player_segment=GOLD&game_types=SLOT,BLACKJACK&limit=25&offset=10" +
      "&include_assets=false&sort_by=title&sort_order=asc",
  );
  const result = validateCatalogParams(url);

  expectOk(result);
  assertEquals(result.value.country, "NG");
  assertEquals(result.value.casino_brand, "egypt_riches");
  assertEquals(result.value.player_segment, "GOLD");
  assertEquals(result.value.game_types, ["SLOT", "BLACKJACK"]);
  assertEquals(result.value.limit, 25);
  assertEquals(result.value.offset, 10);
  assertEquals(result.value.include_assets, false);
  assertEquals(result.value.sort_by, "title");
  assertEquals(result.value.sort_order, "asc");
});

Deno.test("validateCatalogParams — include_assets=true (any non-'false' string) parses to true", () => {
  const url = new URL(
    "http://localhost/games-catalog?jurisdiction=NG&include_assets=true",
  );
  const result = validateCatalogParams(url);

  expectOk(result);
  assertEquals(result.value.include_assets, true);
});

Deno.test("validateCatalogParams — empty-string optional params are treated as absent (defaults retained)", () => {
  const url = new URL(
    "http://localhost/games-catalog?jurisdiction=NG&country=&casino_brand=" +
      "&player_segment=&game_types=&limit=&offset=&include_assets=&sort_by=&sort_order=",
  );
  const result = validateCatalogParams(url);

  expectOk(result);
  assertEquals(result.value.country, "US");
  assertEquals(result.value.casino_brand, undefined);
  assertEquals(result.value.player_segment, "BRONZE");
  assertEquals(result.value.game_types, []);
  assertEquals(result.value.limit, 50);
  assertEquals(result.value.offset, 0);
  assertEquals(result.value.include_assets, true);
  assertEquals(result.value.sort_by, "published_at");
  assertEquals(result.value.sort_order, "desc");
});

Deno.test("validateCatalogParams — game_types present but filters to an empty array (all-blank entries) falls through to the default", () => {
  const url = new URL(
    "http://localhost/games-catalog?jurisdiction=NG&game_types=,,",
  );
  const result = validateCatalogParams(url);

  expectOk(result);
  assertEquals(result.value.game_types, []);
});

Deno.test("validateCatalogParams — non-numeric limit/offset are ignored (defaults retained, no NaN leaks through)", () => {
  const url = new URL(
    "http://localhost/games-catalog?jurisdiction=NG&limit=not-a-number&offset=also-not-a-number",
  );
  const result = validateCatalogParams(url);

  expectOk(result);
  assertEquals(result.value.limit, 50);
  assertEquals(result.value.offset, 0);
});

// ============================================================================
// validateGameListParams
// ============================================================================

Deno.test("validateGameListParams — no params, all defaults applied", () => {
  const url = new URL("http://localhost/games-crud");
  const result = validateGameListParams(url);

  expectOk(result);
  assertEquals(result.value.limit, 50);
  assertEquals(result.value.offset, 0);
  assertEquals(result.value.game_type, undefined);
  assertEquals(result.value.game_provider, undefined);
  assertEquals(result.value.status, undefined);
  assertEquals(result.value.search, undefined);
  assertEquals(result.value.tags, undefined);
  assertEquals(result.value.sort_by, "published_at");
  assertEquals(result.value.sort_order, "desc");
});

Deno.test("validateGameListParams — every optional param present is parsed through to the schema output", () => {
  const url = new URL(
    "http://localhost/games-crud?limit=20&offset=5&game_type=SLOT" +
      "&game_provider=pragmatic&status=ACTIVE&search=egypt&tags=hot,new" +
      "&sort_by=title&sort_order=asc",
  );
  const result = validateGameListParams(url);

  expectOk(result);
  assertEquals(result.value.limit, 20);
  assertEquals(result.value.offset, 5);
  assertEquals(result.value.game_type, "SLOT");
  assertEquals(result.value.game_provider, "pragmatic");
  assertEquals(result.value.status, "ACTIVE");
  assertEquals(result.value.search, "egypt");
  assertEquals(result.value.tags, ["hot", "new"]);
  assertEquals(result.value.sort_by, "title");
  assertEquals(result.value.sort_order, "asc");
});

Deno.test("validateGameListParams — empty-string optional params are treated as absent (defaults retained)", () => {
  const url = new URL(
    "http://localhost/games-crud?limit=&offset=&game_type=&game_provider=" +
      "&status=&search=&tags=&sort_by=&sort_order=",
  );
  const result = validateGameListParams(url);

  expectOk(result);
  assertEquals(result.value.limit, 50);
  assertEquals(result.value.offset, 0);
  assertEquals(result.value.game_type, undefined);
  assertEquals(result.value.game_provider, undefined);
  assertEquals(result.value.search, undefined);
  assertEquals(result.value.tags, undefined);
  assertEquals(result.value.sort_by, "published_at");
  assertEquals(result.value.sort_order, "desc");
});

Deno.test("validateGameListParams — tags present but filters to an empty array (all-blank entries) falls through to the default", () => {
  const url = new URL("http://localhost/games-crud?tags=,,");
  const result = validateGameListParams(url);

  expectOk(result);
  assertEquals(result.value.tags, undefined);
});

Deno.test("validateGameListParams — non-numeric limit/offset are ignored (defaults retained, no NaN leaks through)", () => {
  const url = new URL(
    "http://localhost/games-crud?limit=nope&offset=nope",
  );
  const result = validateGameListParams(url);

  expectOk(result);
  assertEquals(result.value.limit, 50);
  assertEquals(result.value.offset, 0);
});

Deno.test("validateGameListParams — invalid enum status is rejected by the schema", () => {
  const url = new URL(
    "http://localhost/games-crud?status=NOT_A_REAL_STATUS",
  );
  const result = validateGameListParams(url);

  expectErr(result);
});

// ============================================================================
// normalizeInput / isValidUUID / validateGameId / validateGameData / catalog limit
// ============================================================================

Deno.test("normalizeInput — keeps the first character, trims, strips control characters", () => {
  const result = normalizeInput("  Hello\u0000 World\u0007  ");
  expectOk(result);
  assertEquals(result.value, "Hello World");
});

Deno.test("normalizeInput — truncates to 200 characters by default and to an explicit maximum", () => {
  const long = "a".repeat(250);
  const byDefault = normalizeInput(long);
  expectOk(byDefault);
  assertEquals(byDefault.value.length, 200);
  const explicit = normalizeInput("abcdefgh", 3);
  expectOk(explicit);
  assertEquals(explicit.value, "abc");
});

Deno.test("normalizeInput — a non-string input is an INVALID_TYPE error", () => {
  const result = normalizeInput(42 as unknown as string);
  expectErr(result);
  assertEquals(getValidationIssues(result.error)[0].code, "INVALID_TYPE");
});

Deno.test("isValidUUID — accepts versions 1 to 5, refuses wrong variant, length and non-hex", () => {
  for (const v of ["1", "2", "3", "4", "5"]) {
    assertEquals(isValidUUID(`123e4567-e89b-${v}2d3-a456-426614174000`), true);
  }
  assertEquals(isValidUUID("123e4567-e89b-12d3-c456-426614174000"), false);
  assertEquals(isValidUUID("123e4567-e89b-62d3-a456-426614174000"), false);
  assertEquals(isValidUUID("123e4567-e89b-12d3-a456-42661417400"), false);
  assertEquals(isValidUUID("123e4567-e89b-12d3-a456-42661417400g"), false);
  assertEquals(isValidUUID("not-a-uuid"), false);
});

Deno.test("validateGameId — null/empty is REQUIRED, a malformed id is INVALID_UUID, a valid id passes through", () => {
  for (const missing of [null, ""]) {
    const result = validateGameId(missing);
    expectErr(result);
    assertEquals(getValidationIssues(result.error)[0].code, "REQUIRED");
  }
  const bad = validateGameId("not-a-uuid");
  expectErr(bad);
  assertEquals(getValidationIssues(bad.error)[0].code, "INVALID_UUID");
  const good = validateGameId("123e4567-e89b-42d3-a456-426614174000");
  expectOk(good);
  assertEquals(good.value, "123e4567-e89b-42d3-a456-426614174000");
});

Deno.test("validateGameData — create requires the full body, update accepts a partial body", () => {
  const partial = { status: "ACTIVE" };
  expectErr(validateGameData(partial));
  expectOk(validateGameData(partial, true));
  expectOk(validateGameData({
    name: "Rocket",
    display_name: "Rocket Crash",
    game_type: "CRASH",
    game_provider: "Acme",
    provider_game_id: "rocket-1",
  }));
});

Deno.test("validateGameData — update still refuses an invalid status", () => {
  expectErr(validateGameData({ status: "NOPE" }, true));
});

Deno.test("validateCatalogParams — limit is accepted from 1 to 100 and refused outside", () => {
  for (const ok of [1, 100]) {
    const result = validateCatalogParams(
      new URL(`http://localhost/games-catalog?jurisdiction=NG&limit=${ok}`),
    );
    expectOk(result);
    assertEquals(result.value.limit, ok);
  }
  for (const bad of [0, 101]) {
    expectErr(validateCatalogParams(
      new URL(`http://localhost/games-catalog?jurisdiction=NG&limit=${bad}`),
    ));
  }
});
