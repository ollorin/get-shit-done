---
name: reference-host-cleanup-procedure
description: "Proper periodic cleanup + OrbStack restart procedure for long autonomous roadmap runs (2h cleanup, 3h OrbStack check, 30min status tick) and its safety rules"
metadata:
  node_type: memory
  type: reference
  originSessionId: adce7a78-b4e2-4ee6-b8fb-2143c4dfbb8a
  modified: 2026-10-07T11:12:58.591Z
---

Armed as session-only crons by execute-roadmap (`arm_watchdogs`); re-arm on resume, they expire after 7 days. Always run the work as a **Haiku subagent** — never shell it yourself.

**Every 30 min (status tick, `6,36 * * * *`):** `git log -5`, `.tmp/local-stack.lock/owner.txt`, phase VERIFICATION status, ListAgents. No commit for >45 min → TaskStop + fresh agent from on-disk state. One 1–2 line report.

**Every 2 h (cleanup, `36 */2 * * *`):** kill ppid-1 orphan `sleep` / deno-test fixtures / `zsh -c until` wait shells >2h (TaskStop the owning agent FIRST — killing a wait shell revives it); delete `.tmp/` entries >2 days, keeping `local-stack.lock`, `phase-file-claims.md`, `train`, `merge-scratch`, active `wt-*`; `docker builder prune -f` + `docker image prune -f` (never `-a`, never volumes); report free disk + RAM + swap in one line. If disk <15 GiB: clear `.nx/.next`/deno caches only when no build runs; for merged worktrees delete only their node_modules/.nx/.next/dist (verify branch is ancestor of HEAD, clean status, no process using it), never the worktree itself while an agent may be live.

**Every 3 h (OrbStack check, `17 */3 * * *`):** measure OrbStack RSS, swap, free RAM, disk. Restart only if RSS >8 GiB OR swap >4 GiB OR disk <15 GiB.
- **Never restart while the lock is held OR any executor/coordinator runs** — the lock file looks free between steps (a restart mid-run left the stack down, 2026-10-07). Instead SendMessage the phase coordinator to restart at its next gap.
- Proper restart per `docs/development/supabase-local-stack.md`: prune docker builder/image; `pkill -f "supabase functions serve"`; `supabase stop --project-id igaming-platform` (**NEVER `--no-backup`** — deletes the DB volume); `docker rm` orphaned project containers holding port 54322 (never `-v`, never volume rm); restart OrbStack until `docker ps` answers with orbstack context; `npx nx start:minimal api`; `supabase functions serve --no-verify-jwt` directly (not `nx start:functions`, dies ~21h). Verify DB intact (migration + player_profiles counts), an edge endpoint ACTUALLY answers, take/release `.tmp/local-stack.lock`.

**Gotchas learned:** swap lives on the system disk, so swap growth = free-disk loss (13 GiB → 32 GiB after a swap-clearing restart). It rebuilt to ~4.7 GiB within ~1h even after restart and process sweeps found no repo culprit — host-level pressure (other apps / extra Claude sessions); ask the user to close heavy apps or reboot. OrbStack itself was only 1–3 GiB RSS, not the cause. IDE "Cannot find name 'Deno'" diagnostics are noise; use `deno check`. Related: [[reference-docker-runtime-orbstack-vs-colima]], [[reference-host-memory-pressure-test-concurrency]], [[bug-killing-wait-shell-revives-agent]], [[project-disk-pressure-frontend-waves]].

**Correction (owner 2026-10-07):** the swap growth is OrbStack's own, which host-side RSS (1-3 GiB) does not show — so restart OrbStack every ~3h regardless of RSS. `docker rm:*` is in the settings DENY list (not just unallowlisted); use `docker restart <name>`, `pkill`, `supabase stop` (allowed) and `orbctl restart` (not allowlisted → owner approval prompt; scripts/memory-guard.sh:130 documents it). The earlier "never restart while an executor runs, ask the coordinator to restart at a gap" rule still holds.

**Unverified (2026-10-08):** bare `orbctl restart` fails with "no machines specified"; the Docker-engine target is probably `orbctl restart docker` — confirm with `orbctl restart --help` before relying on it. The owner restarted OrbStack by hand once (swap 27→0.9 GiB, disk 11→36 GiB free).
