---
name: reference_docker_runtime_orbstack_vs_colima
description: This project standardizes on OrbStack for local Docker (Supabase stack); colima is a documented but structurally degraded emergency fallback. Evidence and hardening items from the 2026-08-14 dual-runtime incident.
metadata: 
  node_type: memory
  type: reference
  originSessionId: 1355c853-bee3-4c65-938a-e0d027c5891f
  modified: 2026-09-05T20:45:15.024Z
---

**OrbStack is this project's established Docker runtime** (used for months prior to 2026-08-14).
Do not introduce colima as a parallel/default runtime — it can't run this stack's full container
shape (see below). Before trusting any E2E or local-dev result, confirm `docker context ls` shows
`orbstack *` as active — a stale/wrong context is a silent failure mode (everything "looks
running" while hitting the wrong backend).

## What happened 2026-08-14 (Phase 315 milestone work)

A host disk-full event (ENOSPC, driven partly by a then-undiscovered Puppeteer temp-profile leak —
see [[project_disk_pressure_frontend_waves]]) killed both OrbStack and, later, an emergency colima
VM stood up as a substitute. **Both runtimes failed, differently:**

- **OrbStack failed silently.** Its helper hung since the prior Tuesday, burning 1,224 CPU-minutes,
  with a docker socket that **hangs clients instead of erroring** — `docker --context orbstack ps`
  blocked indefinitely. It kept squatting ports 54321-54324/8079 the whole time. This is the worst
  failure mode for automated agents: nothing errors, so nothing flags it as broken. It DID survive
  with all 14 containers/volumes intact once force-quit and relaunched.
- **Colima failed loudly.** Guest filesystem corrupted (I/O errors on a plain `df -h` inside the
  VM) after being killed abruptly during the disk-full episode. Unambiguous to diagnose, cheap to
  rebuild (~30s VM boot). But `colima delete -f` has a real bug: it fails to remove its own 50GB
  datadisk due to broken profile metadata ("error retrieving current runtime: empty value") —
  happened twice in this incident. Manual `limactl disk delete colima` was needed both times.

**The Keychain credential-helper issue (`credsStore: "osxkeychain"` in `~/.docker/config.json`,
error `-25320`) affects BOTH runtimes equally** — it's a host-level Docker CLI config problem, not
runtime-specific. Plain `docker pull` degrades gracefully; `docker compose pull` does not (hangs on
a Keychain prompt in non-interactive sessions). Still unfixed as of this writing — removing that
config line (auths is empty, nothing lost) would permanently fix it, but no session has had
permission to edit `~/.docker/config.json` directly.

## Why colima can't be a full substitute (structural, not incidental)

The Supabase CLI bind-mounts the docker socket into the `vector` container using the **host-side
docker-context endpoint path**. Under OrbStack this resolves fine. Under colima that path is
`~/.colima/default/docker.sock`, which virtiofs cannot materialize as a socket inside the guest VM
(`mkdir ... operation not supported`) — a structural limitation of colima's mount type, not a
one-off bug. Consequence: `vector` and `logflare` (Studio's log/analytics backend) cannot start
under colima at all; any colima session must run with `--exclude edge-runtime,vector,logflare`.
Confirmed by direct A/B: `vector` healthy under OrbStack, hard failure under colima, same compose
file, same session.

## Update 2026-09-05: colima fully uninstalled — this pitfall class is now closed

The exact failure this memory warns about happened again during the v0.1.30 milestone close: after
a session interruption/reconnect, `docker context ls` had silently flipped to `colima` (its VM was
also found still *running*, quietly consuming ~2GB RAM the whole session). Every `deno test`
integration-suite call was connecting to nothing (TCP `SYN_SENT`, never `SYN-ACK`), which looked
identical to a resource-exhaustion stall and cost real time to misdiagnose as memory pressure before
`docker context ls` revealed the real cause. Fix was `docker context use orbstack`, which
immediately restored connectivity (all 14 containers had been fine the whole time, just unreachable
via the wrong context).

Given this is the second real incident from having colima installed as a "fallback," and it has
never actually been needed as one, colima was fully removed this session: `colima stop`,
`colima delete -f`, `docker context rm colima`, `brew uninstall colima` (+ its now-unused `lima`
dependency). **There is no colima installed anymore** — the "before any E2E work, verify
`docker context ls` shows orbstack" check below is now a non-issue by construction (nothing else can
silently be selected), not something to keep re-checking indefinitely. If OrbStack ever needs an
emergency substitute again in the future, colima would need to be reinstalled from scratch — do not
assume it's still available.

## Standing guidance

- **Default:** OrbStack. It's the only runtime that runs this project's full container shape
  (including vector/logflare) and matches established team usage.
- **If OrbStack breaks:** colima is a documented, working, but *degraded* fallback — use
  `--exclude edge-runtime,vector,logflare` explicitly, and know Studio's log viewer won't work.
  Expect the `colima delete -f` datadisk-cleanup bug; follow up with `limactl disk delete colima`
  and check `docker context ls` no longer lists colima before assuming full cleanup.
- **The actual root cause neither runtime choice fixes:** host disk exhaustion. See
  [[project_disk_pressure_frontend_waves]] for the disk-pressure playbook (now includes the
  Puppeteer profile leak found the same day).
- **Before any E2E/dev-server work after a gap:** verify `docker context ls | grep 'orbstack \*'`
  is the active context. Don't assume a previously-healthy stack is still the one answering
  requests — launching a second runtime (or anything else that grabs the same ports) can silently
  redirect `localhost` traffic to a stale/wrong backend with no error at all.
- **Docs are stale**: `docs/testing/player-web-testing.md:72` still says "Docker Desktop" — neither
  runtime in actual use. Worth a docs fix, not yet done as of this memory.
