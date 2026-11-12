---
name: reference-zg-index-refresh
description: "zg (zvec-grep) index is never auto-refreshed; run `zg index` (incremental ~10s) before relying on zg query during long runs"
metadata:
  node_type: memory
  type: reference
  originSessionId: adce7a78-b4e2-4ee6-b8fb-2143c4dfbb8a
  modified: 2026-10-07T21:49:04.748Z
---

`zg query` searches a snapshot. The `zg` server is stopped and no hook or watcher refreshes it, so results go stale while agents commit. `zg index` is incremental (measured 2026-10-07: 5073 files scanned, 2 modified re-processed, ~8s tool time / ~18s wall); never use `--rebuild`/`--drop` for routine refresh. `zg status` can keep saying "needs an update" for 1-2 files edited concurrently — expected; `zg index --debug` lists skipped files.

**Why:** hours-long autonomous runs make `zg query` answers silently outdated.

**How to apply:** the 30-min status tick runs `zg index`, and main runs it before dispatching each phase coordinator; tell agents to run `zg index` first if a query misses recently added code.
