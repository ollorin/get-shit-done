# Host operations: cleanup, runtime restart, process audit

These rules run on the development host during long autonomous runs. The thresholds are named parameters, not literals in the steps. The values below were measured on a 16 GiB host with a local stack; a project changes them here, in its copy of this file, and records the change. They are not profile keys yet.

| Parameter | Value | Meaning |
|---|---|---|
| `RESTART_DISK_BELOW_GIB` | 3 | Free disk below which the runtime may be restarted |
| `PRE_RUN_MIN_FREE_GIB` | 8 | Free disk required before a long exclusive run starts |
| `PRE_RUN_MAX_SWAP_GB` | 10 | Swap ceiling before a long exclusive run starts |
| `CACHE_CLEAR_BELOW_GIB` | 15 | Free disk below which regenerable caches are cleared (only when no build runs) |
| `ORPHAN_AGE_HOURS` | 2 | Age after which an orphan process or a wait shell counts as leaked |
| `TMP_MAX_AGE_DAYS` | 2 | Age after which a top-level `.tmp/` entry is a cleanup candidate |

## Threshold conflicts, resolved by date

Three dated rules disagreed about the restart threshold. The newest dated rule decides, and no other figure stands:

- Restart trigger: below `RESTART_DISK_BELOW_GIB` free disk, or a stalled container or test bucket. This is the rule of 2026-10-31. It supersedes the 15 GiB free-disk and 8 GiB resident-size triggers of 2026-10-07, and the swap trigger in both (swap alone is never a reason).
- Pre-run gate: the rule of 2026-11-07 applies. Before a long exclusive run, free disk must be at least `PRE_RUN_MIN_FREE_GIB` and swap below `PRE_RUN_MAX_SWAP_GB`. This gate is checked before a run starts; it never restarts anything during a run.
- Cache clearing keeps the 2026-10-07 trigger (`CACHE_CLEAR_BELOW_GIB`). No later rule changed it.

## Recurring jobs

- Status tick, every 30 minutes: the last commits, the lock owner, the verification state of the running phase. One to two lines of report. No commit for 45 minutes: stop the owning agent and re-dispatch a fresh one from on-disk state.
- Cleanup, every 2 hours: the steps under "Cleanup". Report free disk, RAM and swap in one line.
- Runtime check, every 3 hours: measure the runtime and host swap. The restart rule below decides whether to restart.

## Cleanup

1. Stop the owning agent before killing its process. Killing a wait shell revives its agent, which then resumes stale stack mutations.
2. Kill orphan `sleep` processes, test fixtures and wait shells older than `ORPHAN_AGE_HOURS`.
3. Delete top-level `.tmp/` entries older than `TMP_MAX_AGE_DAYS`, except the names matching `.planning/cleanup-keep.txt`. With no keep list, delete nothing.
4. Prune the container runtime's build cache and unused images. Never prune all images, never remove volumes.
5. When free disk is below `CACHE_CLEAR_BELOW_GIB`, clear regenerable caches (dependency and build caches) only when no build runs.
6. For a merged worktree, delete only its dependency and build folders, and only when its branch is an ancestor of HEAD, its status is clean and no process uses it. Never remove the worktree itself while an agent may be live.

## Runtime restart

- Restart only when free disk is below `RESTART_DISK_BELOW_GIB`, or a container or a test bucket has stalled. Swap is not a reason.
- One owner restarts, in one dispatch, at a plan boundary, with the stack lock free and no executor running. Ask the coordinator to restart at its next gap if an executor is running.
- Never restart during a run. A restart mid-run voids the run: the served runtime is gone and the run reports a recycled runtime.
- Order: stop the dev servers; stop the served functions; stop the services with their normal stop command; quit the container runtime with its own quit command and start it again; start the services; serve the functions from the source tree with the project's env-file recipe; check that the database counts match the last good state and that one endpoint answers; release the lock.
- Never use the stop option that deletes the local database volume.
- Restarting the runtime clears its swap only when stale processes no longer hold pages. Clear the leaked processes first (cleanup step 2).

## Before a long exclusive run

1. Kill leaked processes older than `ORPHAN_AGE_HOURS`, after stopping their owners.
2. Remove the worktrees of closed lanes. Keep their branches; confirm each one landed or is clean.
3. Clear regenerable caches.
4. Restart the runtime (order above) so that swap is cleared.
5. Require at least `PRE_RUN_MIN_FREE_GIB` free and swap below `PRE_RUN_MAX_SWAP_GB`. Then start the run.

## Process audit

- Report first. A process audit lists candidates; it kills nothing.
- Kill only with an explicit live flag, and only a process that a second audit, run later, still lists with the same identifier.
- A process owned by a live agent is never a candidate.

## What eats the disk

Swap lives on the system disk and shares free space with the data volume, so swap growth reduces free disk. The runtime's own resident size does not show that growth: measure swap at host level. Heavy applications outside the project can cause the same pressure; the owner closes them, the agents do not kill them.

## Deployed scripts

- `scripts/memory-guard.sh [--dry-run] [--live]`: host memory report (macOS and Linux; any other platform prints `UNSUPPORTED PLATFORM`), then the stale-orphan scan. A process is listed only when its command matches `stack.host.worker_patterns` and no entry of `stack.host.protected_patterns`. Report-first: `--live` needs an interactive terminal and two confirmations.
- `scripts/container-disk-guard.sh [--dry-run] [--live] [--force]`: host free space and the container runtime's reclaimable space (CLI from `CONTAINER_CLI`). Default is a report; `--live` removes dangling images, unused build cache and zero-container image tags only, never volumes.
- `scripts/reap-stale.sh [--dry-run] [--live]`: the stale test-process reaper (task 9.9). Report-only by default (`--dry-run` is the explicit form): it prints a `would_kill` line per candidate and signals nothing; `--live` signals them. Worker, headless-agent and browser processes count only when their cwd is under the project root or the command matches `stack.host.project_pattern`; not a gate, so it is not in `stack.gates[]`.
