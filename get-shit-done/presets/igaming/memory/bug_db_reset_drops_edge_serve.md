---
name: bug-edge-recycles-on-apps-api-writes
description: Edge-runtime container is recreated within ~8 s of any commit/cherry-pick touching apps/api/functions or libs; this voids live runs in other lanes
metadata:
  node_type: memory
  type: project
  originSessionId: 181582e5-de8c-4838-9350-b76af8b03856
  modified: 2026-11-06T01:26:41.295Z
---

On 2026-11-06 the edge container StartedAt matched commit times exactly (commit times are +01:00): 9dfe54fb8 at 01:17:31Z gave edge StartedAt 01:17:39Z, 29a97ce2b at 00:53:54Z gave 00:54:02Z, ca672bb09 at 00:43Z gave a hot-reload at ~00:44. Each of those commits touched apps/api/functions or apps/api/libs. So the serve file watcher recreates the container on writes to edge-served code. `--reset-db` alone did NOT drop it (401-23 resets left StartedAt unchanged). The earlier vanishing at 22:33Z/22:43Z is probably the same mechanism (not verified).

**Why:** a live run (RS, mutants, B3a, Charlotte) in one lane dies with EDGE_RUNTIME_RECYCLED_DURING_RUN or 503 when another lane commits or cherry-picks into apps/api/functions|libs.

**How to apply:** while any lane holds the stack lock for a live run, nobody else commits or cherry-picks edge-served code on the shared branch (work in `.tmp/wt-*`, land in the lane's own lock window). Tests-only paths such as `*.test.ts` under functions still trigger it. A container that disappears (not just recycles) needs a detached restart:
`nohup npx supabase functions serve --workdir <project-root>/apps/api --no-verify-jwt --env-file <project-root>/apps/api/supabase/.temp/functions-serve.env > <project-root>/.tmp/functions-serve-N.log 2>&1 &`
Cwd does not persist for agents and the repo root fails with ServeLocalDbNotRunningError. Boot takes up to ~3 min. See [[feedback-disk-threshold-5gi]] for the restart-owner rule.
