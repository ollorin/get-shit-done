---
name: reference_host_memory_pressure_test_concurrency
description: Full-bucket test-run instability has 4 distinct confirmed root causes on this dev machine — memory pressure (hang), colima/docker context (hang), and pg_cron job races (scattered failures, not a hang) — diagnose before assuming a code regression
metadata: 
  node_type: memory
  type: reference
  originSessionId: 5ef35522-23dc-4f3d-8bdf-39cbab3cab5d
  modified: 2026-09-09T16:46:21.104Z
---

Found during the v0.1.30 milestone close (2026-09-05): `scripts/preflight.sh --all` stalled twice,
each time for ~30-60+ minutes with the spawned `deno test` bucket workers stuck at near-zero CPU
time (not slow — genuinely not progressing), right at the moment `run-integration-tests.sh` spawned
its default 4 concurrent buckets (each bucket itself running many test files + a live
`supabase functions serve` process). `memory_pressure`/`vm_stat` showed the host at critically low
free RAM (under 150MB free of 16GB) both times.

**Fix:** `MAX_CONCURRENT_BUCKETS=2 scripts/preflight.sh --all` (or lower). This is a real, documented
tunable already in `scripts/preflight.sh`'s `run_scrubbed_integration_tests()` — the comment there
notes CI itself runs at `MAX_CONCURRENT_BUCKETS=2` for a 2vCPU/7GB-constrained GitHub runner, while
local default is 4 (assumes normal dev-machine headroom). Dropping to 2 immediately produced real
CPU progress (20+s accumulated within a minute) instead of an hour of near-zero — confirmed via
`ps aux | grep "deno test"` process count staying at exactly 2, not silently exceeding the cap.

**Important nuance (verified, not just default=4):** both stalls actually ran at the DEFAULT
`MAX_CONCURRENT_BUCKETS=4` — direct process inspection during both stalls showed exactly 4 concurrent
`deno test` processes, never more. So 4 is not unconditionally broken on this machine; it's that this
session had unusually heavy concurrent load stacked on top the whole time (Cursor, OrbStack at
2-5GB RSS, multiple Chrome renderers, an `nx` daemon that had been running since the prior Friday,
a long-lived `tsserver`) that pushed the same "normally-fine 4" over the edge. **The real lesson:
check current `memory_pressure`/free-RAM headroom before trusting the concurrency default, rather
than assuming 4 is always safe** — this machine's baseline available headroom varies a lot with
whatever else is open at the time.

**How to apply:** Before running `scripts/preflight.sh` (or any full integration-suite pass) on this
machine, check `memory_pressure` first. If free pages are low (rule of thumb: under ~500MB free),
default to `MAX_CONCURRENT_BUCKETS=2` from the start rather than discovering the stall the hard way.
If a preflight/test run is suspected hung, check CPU-time accumulation on the `deno test` child
processes (`ps aux | grep "deno test"`) rather than just wall-clock elapsed time — a healthy run
accumulates real CPU seconds continuously; a stalled one sits at ~1-2s indefinitely.

Separately: this session also found a genuinely orphaned `deno test` process surviving over an hour
past its parent shell's death (from an earlier OOM-killed background command) — always check for and
kill stale `deno`/`run-integration-tests.sh` processes before starting a fresh attempt, since they
compete for the same constrained RAM.

Related: [[project_disk_pressure_frontend_waves]] (a prior, disk-pressure-flavored version of the
same class of problem — long autonomous runs exhausting a finite host resource).

**Correction/addendum (same session, later): a THIRD stall at `MAX_CONCURRENT_BUCKETS=2` (still
near-zero CPU after 1+ hour) turned out to have a completely different root cause, not memory at
all** — see [[reference_docker_runtime_orbstack_vs_colima]]. After a session reconnect, the Docker
CLI context had silently flipped to `colima` (whose VM was also quietly running, consuming its own
~2GB RAM), so every `deno test` HTTP call to the Supabase API was hanging in TCP `SYN_SENT` against
effectively nothing. `lsof -p <deno_pid> | grep TCP` showing a stuck `SYN_SENT` connection was the
actual tell — check that BEFORE assuming memory/concurrency if CPU-time is stuck near-zero, since it
rules memory pressure in or out definitively. Colima has since been fully uninstalled, closing this
specific failure mode for good — but the general lesson stands: a "hung with near-zero CPU" test
process can mean either genuine resource starvation (this file) or a dead network dependency
(check `lsof`), and they look identical from `ps aux` alone.

**Fourth distinct root cause (Phase 369, 2026-09-09): not a hang, a scattered-failure pattern —
background `pg_cron` jobs racing test fixtures during long full-bucket runs.** A full B4-games
bucket run (60+ files, ~2.5min after `supabase db reset`) showed 15 failures scattered across 5
unrelated files (arena-write-handlers, crash-safe-recovery-sweep, mini-games,
pvp-arena-pairing-transaction, pvp-arena) with no shared code path. Confirmed NOT a real regression:
all 5 files / 15 tests passed 100% clean when re-run individually. Root cause: this local Postgres
runs 7 `pg_cron` jobs every minute plus 1 every 5 minutes (queue expiry sweep, pairing-claim reaper,
etc. — see Phase 362/368 migrations) that fire mid-bucket-run against the same shared local DB and
race live test fixtures the bucket is mid-way through asserting on. Unlike the memory/colima cases
above, CPU time looks completely normal here — the tell is specifically a **scattered, unrelated,
non-reproducible-in-isolation failure set** appearing only on a full multi-minute bucket run, never
on a targeted single-file run. **How to apply:** before treating a full-bucket test failure as a
real regression, re-run the specific failing file(s) in isolation — if they pass clean alone, it's
very likely this cron-interference pattern, not a code defect. This is a standing characteristic of
the local dev stack now that Phases 362/368 shipped recurring `pg_cron` jobs, not a one-off fluke —
expect it to recur in any future full-bucket run on this machine.
