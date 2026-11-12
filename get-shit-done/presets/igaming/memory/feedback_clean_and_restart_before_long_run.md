---
name: feedback-clean-and-restart-before-long-run
description: "Before any long exclusive run (full preflight, Charlotte batch) free disk, kill leaked processes and restart OrbStack to clear swap FIRST, never mid-run"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 181582e5-de8c-4838-9350-b76af8b03856
  modified: 2026-11-07T09:08:23.224Z
---

The owner 2026-11-07: cleanups and the OrbStack restart (swap clear) belong BEFORE the main run, not during it. On 401-22 run 3 the disk fell 16Gi to 0.6Gi in ~40 min (swap 13 to 19 GB) and the preflight had to be SIGSTOPped; a leaked 15 h `nx test player-web` (parent = old harness shell) was part of the cause.

**Why:** a mid-run restart voids the run (edge container gone, `EDGE_RUNTIME_RECYCLED_DURING_RUN`) and swap growth eats the disk; a restart alone did not shrink swap while stale processes still held pages.

**How to apply:** before granting a long exclusive window: (1) `ps` for leaked nx/vitest/wait shells older than 2 h and kill them (owning agent already stopped); (2) remove closed-phase `wt-*` worktrees (branch kept; verify landed or clean); (3) clear regenerable caches (`~/Library/Caches/Google`, whisper, `.nx/cache`); (4) full OrbStack restart via `nx stop:dev api`, `orbctl stop`, `orbctl start`, `npx nx run api:start:minimal`, serve with the nohup --workdir recipe; (5) require >= 8Gi free and swap well under 10 GB, then send "go". See [[bug-edge-recycles-on-apps-api-writes]] and [[feedback-disk-threshold-5gi]].
