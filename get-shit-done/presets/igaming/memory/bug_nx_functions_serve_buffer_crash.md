---
name: bug-nx-functions-serve-buffer-crash
description: "`nx start:functions api` dies after ~21h (nx terminalOutput RangeError) and takes the edge runtime down → /functions/v1 503; run serve directly instead"
metadata:
  node_type: memory
  type: reference
  originSessionId: 58cca91c-5014-4482-b959-beca6c420713
  modified: 2026-10-02T03:04:11.741Z
---

`npx nx start:functions api` buffers all child output in nx's `terminalOutput` string. After ~21h of edge logs it throws `RangeError: Invalid string length` and the edge runtime container disappears; Kong stays healthy but `/functions/v1/*` returns 503, silently voiding any live integration run.

**How to apply:** launch serve without the nx wrapper (from `apps/api`): write `supabase/.temp/functions-serve.env` via the sed in `apps/api/project.json` `start:functions`, then `npx supabase functions serve --no-verify-jwt --env-file supabase/.temp/functions-serve.env > /tmp/functions-serve.log 2>&1`. Probe health with `curl http://127.0.0.1:54321/functions/v1/health` (404 = up, 503/000 = down). After an outage, tell lock holders their run is void (see [[feedback-check-roadmap-before-reassigning]] on outages voiding results).
