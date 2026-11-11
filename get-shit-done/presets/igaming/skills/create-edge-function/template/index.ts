/**
 * {function-name} Edge Function (FP Pattern)
 *
 * Purpose: {purpose}
 * Auth: {auth-mode}
 * Methods: {methods}
 */
import { serve } from "@std/http";
import { err, errAsync, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

// Domain imports - errors, routing, types
import { DatabaseError, match } from "@igaming/domain";
import type { AccessSession, BaseError } from "@igaming/domain";
// FP ValidationError factory - import by relative path to avoid the name
// collision with the class-based ValidationError re-exported by @igaming/domain
import { ValidationError } from "../../libs/domain/src/lib/errors/fp/validation.ts";

// Infrastructure imports - middleware, responses, FP utilities
import {
  AuthMode,
  createErrorResponse,
  getCorsHeaders,
  handleSecureRequest,
  PLAYER_JSON_MAX_BODY_BYTES,
  parseRequestBody,
  resultAsyncToResponse,
  validateRequest,
} from "@igaming/infrastructure";

// Request schemas
const CreateSchema = z.object({
  // Define fields here
  name: z.string().min(1),
});

type CreateInput = z.infer<typeof CreateSchema>;

/**
 * Create a single-issue ValidationError (FP factory takes an issues array)
 */
const validationError = (field: string, message: string): BaseError =>
  ValidationError([{ field, message, code: "INVALID_INPUT" }]);

/**
 * Business logic - returns ResultAsync, NOT Response
 *
 * Key pattern: All business logic functions return ResultAsync<T, BaseError>
 * This enables composition with .andThen() and proper error handling.
 * DatabaseError requires { table, operation } context (cause is optional).
 */
const processCreate = (
  input: CreateInput,
  supabase: SupabaseClient,
): ResultAsync<{ id: string }, BaseError> =>
  ResultAsync.fromPromise(
    supabase.from("table").insert(input).select().single(),
    (e): BaseError =>
      DatabaseError({ table: "table", operation: "insert", cause: e as Error }),
  ).andThen((response) =>
    response.error
      ? err(
        DatabaseError({
          table: "table",
          operation: "insert",
          cause: response.error,
        }),
      )
      : ok({ id: response.data.id as string })
  );

const fetchOne = (
  supabase: SupabaseClient,
  id: string,
): ResultAsync<unknown, BaseError> =>
  ResultAsync.fromPromise(
    supabase.from("table").select("*").eq("id", id).single(),
    (e): BaseError =>
      DatabaseError({ table: "table", operation: "select", cause: e as Error }),
  ).andThen((response) =>
    response.error
      ? err(
        DatabaseError({
          table: "table",
          operation: "select",
          cause: response.error,
        }),
      )
      : ok(response.data)
  );

const fetchAll = (
  supabase: SupabaseClient,
): ResultAsync<unknown, BaseError> =>
  ResultAsync.fromPromise(
    supabase.from("table").select("*"),
    (e): BaseError =>
      DatabaseError({ table: "table", operation: "select", cause: e as Error }),
  ).andThen((response) =>
    response.error
      ? err(
        DatabaseError({
          table: "table",
          operation: "select",
          cause: response.error,
        }),
      )
      : ok(response.data)
  );

/**
 * POST handler - validates input, calls business logic
 *
 * Key pattern:
 * 1. parseRequestBody() - Parse JSON with error handling
 * 2. validateRequest(schema, data) - Validate against Zod schema (schema FIRST)
 * 3. Business logic function - Process the validated data
 * 4. resultAsyncToResponse(resultAsync, headers, options?) - Convert to Response
 */
const handlePost = (
  supabase: SupabaseClient,
  _session: AccessSession | null,
  request: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> =>
  resultAsyncToResponse(
    parseRequestBody<unknown>(request, PLAYER_JSON_MAX_BODY_BYTES)
      .andThen((body) => validateRequest(CreateSchema, body))
      .andThen((input) => processCreate(input, supabase)),
    corsHeaders,
    { successStatus: 201 },
  );

/**
 * GET handler - retrieves data
 *
 * Key pattern: Even simple operations use Result types
 */
const handleGet = (
  supabase: SupabaseClient,
  _session: AccessSession | null,
  url: URL,
  corsHeaders: Record<string, string>,
): Promise<Response> => {
  const id = url.searchParams.get("id");

  return id
    ? resultAsyncToResponse(fetchOne(supabase, id), corsHeaders)
    : resultAsyncToResponse(fetchAll(supabase), corsHeaders);
};

/**
 * PUT handler - updates existing resource
 *
 * Key pattern: Early validation failures use errAsync() so the pipeline
 * stays a ResultAsync (resultAsyncToResponse requires ResultAsync, not Result).
 */
const handlePut = (
  supabase: SupabaseClient,
  _session: AccessSession | null,
  url: URL,
  request: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> => {
  const id = url.searchParams.get("id");

  if (!id) {
    return resultAsyncToResponse(
      errAsync(validationError("id", "ID required for updates")),
      corsHeaders,
    );
  }

  return resultAsyncToResponse(
    parseRequestBody<unknown>(request, PLAYER_JSON_MAX_BODY_BYTES)
      .andThen((body) => validateRequest(CreateSchema, body))
      .andThen((input) =>
        ResultAsync.fromPromise(
          supabase.from("table").update(input).eq("id", id).select().single(),
          (e): BaseError =>
            DatabaseError({
              table: "table",
              operation: "update",
              cause: e as Error,
            }),
        )
      )
      .andThen((response) =>
        response.error
          ? err(
            DatabaseError({
              table: "table",
              operation: "update",
              cause: response.error,
            }),
          )
          : ok({ id, updated: true, data: response.data })
      ),
    corsHeaders,
  );
};

/**
 * DELETE handler - removes resource
 */
const handleDelete = (
  supabase: SupabaseClient,
  _session: AccessSession | null,
  url: URL,
  corsHeaders: Record<string, string>,
): Promise<Response> => {
  const id = url.searchParams.get("id");

  if (!id) {
    return resultAsyncToResponse(
      errAsync(validationError("id", "ID required for deletion")),
      corsHeaders,
    );
  }

  return resultAsyncToResponse(
    ResultAsync.fromPromise(
      supabase.from("table").delete().eq("id", id),
      (e): BaseError =>
        DatabaseError({
          table: "table",
          operation: "delete",
          cause: e as Error,
        }),
    ).andThen((response) =>
      response.error
        ? err(
          DatabaseError({
            table: "table",
            operation: "delete",
            cause: response.error,
          }),
        )
        : ok({ deleted: true, id })
    ),
    corsHeaders,
  );
};

/**
 * Main handler - routes requests via match([method, pathname])
 *
 * Signature must match what handleSecureRequest passes:
 * (supabaseClient, session, url, request, ipAddress, userAgent)
 */
const mainHandler = (
  supabase: SupabaseClient,
  session: AccessSession | null,
  url: URL,
  request: Request,
  _ipAddress: string,
  _userAgent: string,
): Promise<Response> => {
  // Strip the function prefix from pathname for routing
  const pathname = url.pathname.replace("/{function-name}", "") || "/";
  const method = request.method;
  const corsHeaders = getCorsHeaders(request.headers.get("origin"));

  return match([method, pathname] as [string, string])
    .with(["POST", "/"], () => handlePost(supabase, session, request, corsHeaders))
    .with(["GET", "/"], () => handleGet(supabase, session, url, corsHeaders))
    .with(["PUT", "/"], () => handlePut(supabase, session, url, request, corsHeaders))
    .with(["DELETE", "/"], () => handleDelete(supabase, session, url, corsHeaders))
    .otherwise(() =>
      Promise.resolve(
        createErrorResponse("Endpoint not found", undefined, 404, corsHeaders),
      )
    );
};

// Server entry point
// handleSecureRequest signature: (req, handler, authMode)
// AuthMode: PUBLIC_READ | PUBLIC_OPTIONAL | USER_REQUIRED | ADMIN_REQUIRED
serve((req: Request): Promise<Response> =>
  handleSecureRequest(req, mainHandler, AuthMode.USER_REQUIRED)
);
