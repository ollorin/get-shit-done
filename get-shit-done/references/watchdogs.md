# Watchdogs for a long unattended roadmap run

Long runs fail silently: a child stalls mid-tool-call, a coordinator ends its turn early, a host disk fills. The orchestrator arms recurring jobs before the first phase and disarms them in `completion`. They are session-only and expire after 7 days: re-arm on resume and on expiry.

## Probe first

The jobs need the runtime's cron tools (`CronCreate`, `CronList`, `CronDelete`) and the agent tools (`ListAgents`, `TaskStop`). Not every runtime has them. If any is missing from the session's tool list, log `watchdogs_unavailable` (`execution-log event --type watchdogs_unavailable --data '{"missing":[...]}'`) and rely on the per-phase staleness check in `execute-roadmap.md` step 4a plus a liveness check (`git log -1`, agent liveness) between phases. Never fail the run on a missing tool. `CronList` first; never duplicate a job.

## The generic status tick

Every 45 minutes, off the round marks (for example `6,51 * * * *`). Prompt:

> Roadmap status tick ({milestone}). In one batched turn: `git log --format='%h %cr %s' -3`, ListAgents, `df -h .`. If an agent has had no commit or file change for more than 45 minutes, or loops on the same failure: TaskStop it, then dispatch a fresh agent of the matching `subagent_type` from on-disk state (the spawner's parallelism ceiling and one-writer rules apply); never SendMessage a handed-back coordinator. TaskStop any "completed" agent that still has background tasks (they wake it into stale work). If a plan or phase closed, verify on disk (SUMMARY Self-Check, VERIFICATION) before the next one is launched. Send ONE report of one or two lines: phase, progress, blocker, free disk.

The tick is the orchestrator's only liveness signal. Never disable it to save tokens; keep the report short instead.

## Project watchdogs

Further jobs come from `stack.watchdogs[]` in `.planning/config.json` (read with `gsd-tools config get stack.watchdogs --raw --default "[]"`): a list of `{name, cron, prompt}`. Arm each one as given, replacing `{milestone}` and the model placeholders (`{utility_model}`, `{reviewer_model}`) from the roadmap init output. A project's preset ships its own entries (delivery reports, host cleanup, swap and container checks); the generic run ships none beyond the status tick. A project with no entries runs on the tick alone.

## Outside the session

A weekly metrics row or a host-level supervisor that relaunches a dead process belongs to the host, not to a session cron: see `docs/host-setup.md` in the GSD fork. Nothing inside this workflow can detect the top-level orchestrator process itself dying.
