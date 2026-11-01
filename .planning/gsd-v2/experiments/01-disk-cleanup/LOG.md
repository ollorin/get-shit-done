# 01 — Disk cleanup log

Baseline 2026-10-31: 17.5 GiB free (`research/02-MACHINE-AUDIT.md`). Every removal goes to `~/.Trash/gsd-v2-cleanup-2026-10-31/` first (restorable until Trash is emptied).

| Date | Item | Size | Action | Restore |
|---|---|---|---|---|
| 2026-10-31 | `~/Library/Application Support/Claude/vm_bundles/claudevm.bundle` (Cowork VM, unused, last change 2026-03-13) | 9.7G | moved to Trash | move back |
| 2026-10-31 | `~/.android/avd/Pixel_2_API_31.avd/userdata-qemu.img.qcow2` (emulator user data, last used 2025-08-24) | 9.3G | moved to Trash (= wipe data; AVD and Android SDK kept for the mobile milestone) | move back |
| 2026-10-31 | `.tmp/wt-391`, `.tmp/wt-complete-0133` (clean, 0 commits outside main/feature) | 0.8G | `git worktree remove`; branches `wt/391-money`, `chore/complete-v0.1.33` kept | `git worktree add .tmp/<wt> <branch>` |

Worktrees still present: `wt-392`/`wt-393` (5k+ dirty paths, not inspected), `merge-scratch` (1 dirty), `wt-400-26-hl` (2 dirty) — need the owner's call.

## Not touched (and why)

| Item | Reason |
|---|---|
| Other macOS accounts  | CEO: do not touch |
| `igaming-platform/dist` (2.8G) | in use: `next start dist/apps/{player,operator}-web` on :3000/:3001 |
| `.tmp/wt-401-07-base`, `.tmp/wt-404-*` | Phase 401-07 comparison base; Phase 404 parked and may reuse |
| `.tmp/400-evidence-hold-20261029/` | hold until 2026-11-02 |
| `wt-391/392/393`, `wt-complete-0133`, `merge-scratch` | candidates; probe `git -C <wt> status --short` + unmerged commits, remove only via `git worktree remove` |
| `.planning/test-runs` (1.3G), `.planning/quota` (846M) | prune by citation in SUMMARY/VERIFICATION only, never by age |
| Docker images without a container (~3.6G) | may be needed by `supabase start`/`functions serve`; a re-pull can block unattended runs; revisit with the stack down |
