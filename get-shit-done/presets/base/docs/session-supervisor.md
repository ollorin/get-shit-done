# Session Supervisor — unattended runs that survive Claude session limits

`scripts/session-supervisor.sh` keeps a long job going across a Claude account
session/usage limit. It waits for the reset and resumes, without you sitting there.

## Why this exists

When a Claude account hits its session limit, **everything running inside Claude stops —
including Claude itself**. Recovery logic cannot live inside the thing that dies.

GSD's `workflows/execute-roadmap.md` (step 4a) *describes* death detection, reset-time
parsing and a polling wait loop. That description is prose instructing an LLM orchestrator
to sleep. Verified 2026-07-25: every consumer of `gsd-tools.js resilience parse-death` is a
markdown file — **no executable code in GSD waits for a reset**, and foreground `sleep` is
blocked inside the Claude Code harness anyway. So when the limit hits, there is nobody left
to run the loop.

This supervisor is an ordinary OS process. It survives what kills everything inside the
session. That is the entire point.

## Quick start

**A suite whose task bakes in a state reset:** do NOT add a `--resume-flag` that the suite
refuses in combination with that reset, or the resume exits non-zero and never actually resumes.
Wrap each batch of the suite in this supervisor WITHOUT `--resume-flag` (each batch's own flags are
already correct for a plain re-invocation resume), and keep the batch wrapper in your own script.

**GSD roadmap execution** (unattended overnight):

```bash
nohup scripts/session-supervisor.sh --max-resumes 8 -- \
  env GSD_AUTONOMOUS=1 claude -p "/gsd:execute-roadmap" \
      --permission-mode bypassPermissions \
  > .tmp/gsd-run.out 2>&1 < /dev/null &
disown
```

`nohup ... & disown` detaches it, so it keeps running after you close the terminal.

## How it works

1. Runs your command, streaming output live to the terminal **and** capturing it.
2. When the child exits, scans the captured output for a session/usage-limit signature.
3. If found, shells out to `gsd-tools.js resilience parse-death` for the **authoritative**
   reset timestamp. The supervisor's own pattern match is fast detection only — it never
   parses the time itself.
4. Polls the wall clock in 60s ticks until the reset passes, re-checking each tick so a
   laptop sleep or clock jump cannot overshoot.
5. Re-runs the command with `--resume-flag` appended (if given).

Repeats until the command succeeds, fails for an ordinary reason, or the resume cap is hit.

## Options

| Flag | Meaning |
| --- | --- |
| `--resume-flag <flag>` | Appended on every resume, **not** the first run. Omit for a plain re-run. |
| `--max-resumes <N>` | Give up after N resume attempts. Default 5. |
| `--log <path>` | JSONL audit log. Default `.tmp/session-supervisor-<ts>-<pid>.jsonl`. Never point this at `.planning/`. |
| `--gsd-tools <path>` | The `gsd-tools.js` used for `resilience parse-death`. Default `$GSD_TOOLS`, else the installed GSD path. |
| `--cleanup-cmd <cmd>` | Shell command run before every attempt and once on exit (leaked-process or temp-profile cleanup). Its failure is ignored. |
| `--dry-run-wait` | Detect and compute the wait, log it, but do **not** sleep. For verifying behaviour. |
| `-h`, `--help` | Usage. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Child eventually exited 0 |
| 1 | Usage or setup error (bad args, missing `jq`/`node`/`gsd-tools.js`) |
| 2 | Child failed for an ordinary, non-limit reason |
| 3 | Limit detected, but the reset time was missing, unparseable, in the past, or beyond the 6h cap — refused to sleep |
| 4 | Resume cap reached without success |

Exit 3 is deliberate. A garbled reset time could otherwise mean sleeping for months while you
believe work is happening. A clear failure beats a silent forever-nap.

## Logs

Two artefacts per run, both under `.tmp/` (gitignored):

- `session-supervisor-<ts>-<pid>.jsonl` — append-only audit trail: `start`,
  `limit_detected`, `wait_start`, `wait_end`, `resume`, `final`.
- `...attempt-N.output.log` — raw child output, one file per attempt.

## Before you rely on it

**Check `ANTHROPIC_API_KEY` is not set.** If it is, Claude Code prefers API-key billing over
your claude.ai subscription, which disables claude.ai connectors and can fail headless `-p`
runs outright with `Credit balance is too low`. That breaks unattended runs before the
supervisor can help. Verify in a fresh terminal:

```bash
echo $ANTHROPIC_API_KEY   # expect empty
```

**Understand `GSD_AUTONOMOUS=1`.** It auto-answers GSD's human gates **only on a
resumption**:

- `resume_capability` auto-selects `resume`. It can **never** auto-select `restart` —
  restart discards completed-phase history, which unattended would silently destroy a
  night's work.
- `confirm_execution` auto-proceeds only when a prior incomplete execution exists.
- A **fresh** roadmap run still requires a human `yes`. Start it yourself; the machine
  continues it.

Every auto-answered gate writes an execution-log event
(`autonomous_resume_auto_selected`, `autonomous_confirm_auto_proceeded`) so you can audit
exactly what proceeded without you.

**Understand `--permission-mode bypassPermissions`.** Nothing prompts. An agent can run any
command on the repo overnight with no human veto. What still protects you: work stays on a
feature branch, the secret scan runs pre-commit, the pre-PR gate (`stack.commands.pre_pr_gate`) gates the PR, and the
supervisor logs every attempt. What it will not catch is a well-formed but wrong decision
made at 3am. `acceptEdits` is the safer middle setting if you want to dial this back.

## What it does not do

**It does not reduce cost.** If a run exhausts the budget at scenario 21 of 63, the
supervisor waits and resumes at scenario 21. It spends the same tokens — it just removes the
need for you to be awake at the reset time.

Budget discipline comes from elsewhere: a runner that aborts on limit detection
instead of burning the remaining queue on doomed work, a skip-passed option avoids re-running
what already passed, and `.claude/hooks/check-test-command.sh` blocks the heavy suite tasks so
they cannot be launched casually.

## Troubleshooting

**Exit 3 immediately.** The limit message had no usable reset time. Check the `.jsonl` for
`limit_detected` and read the `attempt-N.output.log` — the raw message is there.

**Exit 2 when you expected a limit pause.** The child failed for an ordinary reason. This is
correct: an ordinary failure must never be mistaken for a limit and silently retried.

**It resumed but immediately died again.** Check the reset actually passed. If the account is
capped for longer than 6h, the supervisor refuses to wait and exits 3 by design.

**Nothing in the terminal.** In a detached run, output goes to the redirect target
(`.tmp/gsd-run.out` in the examples), not your terminal. `tail -f` it.

## Related

- `scripts/session-supervisor.sh` — the script; header comment carries the full rationale.
- `.claude/rules/pre-pr-gates.md` — the gates that still apply to anything a
  supervised run produces.
