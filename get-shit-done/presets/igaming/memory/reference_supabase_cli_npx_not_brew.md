---
name: reference-supabase-cli-npx-not-brew
description: "Run `npx supabase` (2.118.0, pinned in package.json) for functions serve/start; the brew supabase 2.78.1 rejects config.toml local_smtp"
metadata:
  node_type: memory
  type: reference
  originSessionId: 181582e5-de8c-4838-9350-b76af8b03856
  modified: 2026-10-22T15:58:39.654Z
---

Use the repo-pinned CLI (`npx supabase`, 2.118.0, package.json:75) for `supabase start` and `functions serve`. The brew binary (2.78.1) rejects `config.toml` `local_smtp` and the serve fails to come up.

**Why:** 2026-10-22 a serve restart used the brew CLI and failed until switched to npx. The earlier "crash-worker cron kills serve (exit 144)" theory did NOT reproduce (serve stayed up >3 min with the cron active); the cause of the earlier serve deaths is unverified. Register row `X1-C12-R400-1` (owner Phase 411).

**How to apply:** Check the process is `@supabase/cli-darwin-arm64@2.118.0` before trusting a serve. Related: [[bug-nx-functions-serve-buffer-crash]], [[reference-orbstack-restart-docker-machine]].
