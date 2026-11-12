---
name: reference-orbstack-restart-docker-machine
description: "Researched (unrun) OrbStack Docker-engine restart: `orbctl restart docker`; supabase project id is `api`; full sequence in .tmp/orbstack-restart-procedure.md"
metadata:
  node_type: memory
  type: reference
  originSessionId: adce7a78-b4e2-4ee6-b8fb-2143c4dfbb8a
  modified: 2026-10-08T13:07:46.959Z
---

Research 2026-10-08 (not yet executed): the Docker engine is OrbStack's built-in machine `docker`, so `orbctl restart docker` (allowlisted via `orbctl restart:*`) is the candidate restart; fallback `orbctl stop`/`orbctl start` needs owner approval. Memory cap `memory_mib` is already 8192 and swap still hit 17 GiB, so a cap alone is unverified as a fix. Volumes (incl. `supabase_db_api`) survive a restart; never `orbctl reset`, `orbctl stop -f`, `supabase stop --no-backup`.

Supabase project id is `api` (`apps/api/supabase/config.toml:5`), NOT `igaming-platform` — earlier briefs/docs using `--project-id igaming-platform` were wrong. `docs/development/supabase-local-stack.md:262` still lists the denied `docker rm` step.

**Why:** swap grows ~3 GiB/h into free system disk during long runs. **How to apply:** full command sequence + verification in `.tmp/orbstack-restart-procedure.md` (gitignored; may be deleted). Record the real working form after the first run. Related: [[reference-host-cleanup-procedure]].

**Measured 2026-10-09:** the "swap" that eats disk is 30 x 1 GiB swapfiles in /System/Volumes/VM (shares the APFS container free space with Data; /private/var/vm shows only sleepimage). `orbctl restart docker` + nx stop/start did NOT shrink it (30.05->30.08 GB); the owner's manual full OrbStack quit/relaunch did (to 0.9 GiB). So a Docker-engine restart is not enough — full OrbStack restart (`orbctl stop` + `orbctl start`, not allowlisted, needs owner approval) or a Mac reboot. Data volume 171-184 GB used; OrbStack data.img only 8 GiB real.

**VERIFIED 2026-10-09 (supersedes "unrun"):** the FULL restart fixes swap (30.2 GB -> 3.8 GB, free disk 7.6 -> 33 GiB). Order: `npx nx stop:dev api`; `orbctl stop` (never `-f`); `orbctl status`; `orbctl start` (prints "timed out waiting for VM to start", exit 1, but VM runs and docker answers in seconds; `open -a OrbStack` not needed); `docker ps`; start `functions serve` directly (nx start:dev's serve exited ~40s in): `cd apps/api && npx supabase functions serve --no-verify-jwt --env-file supabase/.temp/functions-serve.env` (503 ~1 min, then 400). 570 migrations / 2 auth.users survive. `orbctl stop|start|status` allowlisted in .claude/settings.json (567916f98). `orbctl restart docker` alone does NOT shrink swap.
