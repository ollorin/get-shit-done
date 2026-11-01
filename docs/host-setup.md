# Dev host setup and maintenance

Host: 16 GiB RAM, 228 GiB disk, OrbStack + local Supabase. Project procedure lives in the project's own docs (igaming: `docs/development/supabase-local-stack.md`, "Restart steps"). This page holds the rules GSD applies on top.

## Recurring jobs

| Job | Where it is defined | Runs in |
|---|---|---|
| Status tick (45 min), delivery report (4 h), cleanup (12 h) | `get-shit-done/workflows/execute-roadmap.md`, step `arm_watchdogs` | roadmap session, session-only crons with 7-day expiry; re-armed on resume |
| Weekly KPI row | `scripts/gsd-metrics/weekly_kpi.sh` | manual, or an OS scheduler the owner enables |

Cleanup deletes nothing unless the project has `.planning/cleanup-keep.txt` (one name or glob per line, compared to `.tmp/` top-level entries).

## OrbStack restart rule

Restart only when free disk is below ~3 GiB, or docker or a test bucket stalls. Swap alone is never a reason. Only at a plan boundary, with the stack lock free and no executor running, through one owner (a single Haiku dispatch by a phase coordinator). Full `orbctl stop` then `orbctl start`; `orbctl restart docker` does not free swap, and `supabase stop --no-backup` is never used.

## What eats the disk

Swap sits in `/System/Volumes/VM` and shares free space with Data. See `.planning/gsd-v2/experiments/08-orbstack-memory/` for the measured breakdown.

Already off in igaming `apps/api/supabase/config.toml`: Studio, analytics (logflare, vector).
