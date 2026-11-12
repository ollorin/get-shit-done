# Shared stack, file claims and parallel lanes

Applies when two lanes (agents, phases or worktrees) could use the same local stack at once: a database, a served runtime, a dev server or a live test bucket. A project without a shared stack keeps the file-claim and one-writer rules.

## Stack lock

- One holder at a time. Take the lock with the wrapper: `scripts/stack-lock.sh --label <lane> -- <command>`. The wrapper waits, runs the command under the lock, and releases it on exit and on SIGINT or SIGTERM.
- Always call the `.sh` wrapper. The command-check hook recognises a locked command as wrapped only when its command word is `stack-lock.sh` or `stack-lock.ts`. A direct call such as `node scripts/stack-lock.mjs -- <cmd>` is not recognised as the wrapper: the locked command is denied as unwrapped.
- The commands that need the lock are the list `stack.locked_commands` in `.planning/config.json`. The hook reads the list at run time, so an edit applies without a sync.
- Take the lock before any command that resets, starts or stops shared services, runs the full pre-PR gate, or runs a live test bucket.
- Never delete the lock file by hand while a holder may still run. A holder whose process is gone is taken over by the next waiter through the liveness check; the stated limits (six) are in the header of `scripts/stack-lock.mjs`: (1) a recycled pid looks alive, so a waiter times out with exit 75 (the safe direction); (2) an empty or non-JSON lock file counts as held for 10 s after creation, so a holder paused for more than 10 s between create and write can be judged dead and a second holder can run beside it; (3) liveness is a local `kill(pid, 0)`: one machine and one pid namespace, not containers or a network filesystem; (4) takeover is not a kernel lock: a waiter paused for more than 10 s between re-reading the lock file and unlinking it can unlink a live holder's newer lock file; (5) the lock file records the wrapper pid and the command pid and counts the holder alive while either lives, so a SIGKILLed wrapper keeps the lock until its command exits, but not for grandchildren the command leaves behind; (6) a killed wrapper that is a zombie keeps the lock until its parent reaps it, and a SIGKILL between spawn and the `childPid` rewrite leaves a window in which only the wrapper pid is recorded. HUP, INT, QUIT and TERM to the wrapper are forwarded to the command.
- A reset of the shared database is allowed under the lock. First confirm that no other lane has a test running, through the lock owner and a message to the peer lanes.

## Parallel lanes (worktrees)

- While one phase holds the stack, the other phases run code-only in their own worktree: `git worktree add -b wt/<phase> .tmp/wt-<phase> HEAD`. A lane writes code, migrations, unit tests and reviews there and does not use the stack.
- Give each worktree lane its own range of migration timestamps, so two lanes never create the same file name.
- Fix loops run only the affected test files, once. The full gate runs once, on the final tree.
- A lane whose migrations exist asks for a lock turn for a real-database pass then, not at the end. A phase that leaves all SQL to the final joint run finds its defects late; text and contract tests do not prove a database decision.
- Before a database reset from a worktree, copy the git-ignored local-stack version pins from the main checkout. Never copy a remote project link into a worktree. Run every stack command from the project directory that owns the stack, not from the worktree root.
- A worktree lane runs only the real-stack tests that do not depend on a runtime served from the main checkout.
- Merge the lane branches and run one joint train at the end.
- Writes under the served source tree restart the served runtime and void the live runs of other lanes. Make such writes only while holding the lock.

## File claims

- Before a lane edits a file, it appends its rows to `.tmp/phase-file-claims.md` (template: `docs/gsd/file-claims-template.md`). A row is CLAIMED while its edit window is open.
- A lane that needs a CLAIMED file messages the owning lane and waits. It never edits that file silently.
- Release removes only your own rows. Never rewrite another lane's rows.
- Commit only your own paths (`git commit -- <paths>`) when another lane may commit on the same branch.
- Never run `git stash`, `reset`, `rebase` or `clean` on a shared branch. For a base comparison, use `git worktree add .tmp/<name> <sha>`.

## One writer per file set

- Two agents never edit the same file set at once. Before a replacement is dispatched for a dead or stalled agent, stop the original.
- Never run two executors in parallel within one phase: their phase-scoped resume state collides. Parallel work is separate phases with disjoint file claims.
- A spawner runs at most two of its own child agents at once.
- Never send a message to a coordinator that has handed back or completed. It resumes and runs beside its replacement. Stop it, then brief a fresh agent.
- An agent that hits a permission prompt while unattended stops and reports the exact command. It never waits on the prompt.

## Keep list

Cleanup deletes nothing unless `.planning/cleanup-keep.txt` exists; with it, every top-level `.tmp/` entry matching a line of the list is kept. The default list keeps the lock files, the claims file and the lane worktrees. Thresholds and the restart procedure are in `docs/gsd/host-ops.md`.
