---
name: ci-integration-test-setup-edge-functions-secrets-env-vars-workspace-imports
description: "Edge Functions in CI need every secret passed explicitly and an import_map.json for @igaming/* workspace imports to resolve; use `supabase start`'s built-in functions, not `supabase functions serve`"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 66bd0822-38d0-4737-a4dd-fbc643115868
---

## Edge Functions in CI require ALL secrets passed explicitly

Environment variables are NOT inherited automatically — any secret an Edge Function reads must be
passed to whatever step starts the functions server, or the function fails silently (500 errors,
no debug logs) because it crashes during module load/env-read before `serve()` runs.

Required GitHub Secrets for integration tests:
- `AUTH_HMAC_SECRET` — session token hashing (32+ chars)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — Redis connection
- `ENCRYPTION_KEY` — field-level encryption

Required env vars (set in BOTH the functions-server step and the test-runner step):
- `NODE_ENV=test` — functions check this for environment detection
- `DENO_ENV=test` — Deno tooling configuration
- `ALLOWED_ORIGINS` — CORS middleware configuration

## Workspace imports (@igaming/*) need an import_map.json

The Edge Runtime does NOT use `deno.json` imports automatically — workspace bare specifiers
(`@igaming/domain`, `@igaming/application`, `@igaming/infrastructure`, etc.) only resolve via
`apps/api/functions/import_map.json`. A missing entry crashes the function during the import
phase (WORKER_ERROR, no logs) before any handler code runs. See also the separate
[CI import map THREE places](feedback_ci_import_map_three_places.md) rule — the same import map
must also be kept in sync in both CI workflow files.

## Use `supabase start`'s built-in functions, not `supabase functions serve`

`supabase functions serve` in CI is unreliable (requires bundled .js, runs as a separate
crash-prone process, hides error logs). `supabase start` already exposes Edge Functions at
`/functions/v1` in the same stack as the DB — point integration tests at that instead of spawning
a separate serve process.

## GitHub Actions artifact storage

500MB total limit (free tier) — use unique artifact names per job rather than `merge-multiple`.

## GOTCHA: TWO `run-integration-tests.sh` scripts — the REAL one is at repo root

There are two same-named scripts in different dirs (verified 2026-07-23, Phase 288.1):
- **`scripts/run-integration-tests.sh` (repo ROOT) = the REAL runner** — ~700 lines, a **13-bucket
  domain-partitioned CONCURRENT runner** (buckets B1a/B1b/B1c/B2-rg/B3a/B3b/B4/B5/B6/B7/B8a1/B8a2/B8b;
  `MAX_CONCURRENT_BUCKETS` cap, FLUSHDB pre-step, per-bucket logs at `.planning/test-runs/`,
  `--bucket`/`--dry-run` flags, a `cross-bucket-contamination-guard` test). Built Phase 235/236,
  B3→B3a/B3b split in 280-03. This is what `scripts/preflight.sh` (does `cd $REPO_ROOT`) and CI
  (`.github/workflows/reusable-integration-tests.yml`) actually invoke.
- **`apps/api/scripts/run-integration-tests.sh` = a thin 3-line DELEGATOR** to the root script (as of
  Phase 288.1). It USED to be a stale hand-maintained single-glob SEQUENTIAL fork — analyzing it and
  concluding "there's no bucketing" is a real trap (it bit an analysis pass this session). The fork
  divergence had silently left ~9 integration files out of the root bucket arrays for several phases
  (coverage gap, fixed in 288.1). **When reasoning about integration-test execution, read the ROOT
  script, not the apps/api one.** Bucket arrays are hand-maintained — a completeness guard now asserts
  every `*.integration.test.ts` (151: 150 in `functions/__tests__` + 1 in `libs/infrastructure/.../cache`)
  is assigned to exactly one bucket. Note: 151 is INTEGRATION tests only; the full `test:ci` suite is
  ~2893 (unit + integration). This repo also has documented coverage-measurement jitter (~±0.3pp) and
  a low-frequency resource-leak flake in `test:ci` — distinguish jitter from real regression by
  re-running before treating a small coverage drop as a source defect.
