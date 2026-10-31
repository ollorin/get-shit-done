# 03 — Polling: why it exists, what broke before

Source: v0.1.34 orchestrator session (igaming-platform-6e), 2026-10-31, plus memory notes it cites. Cost side: `01-SESSION-ANALYSIS.md` finding 2 (coordinators 91% of active time in sleep/until loops; ~$767 cache re-writes).

## Failure modes any replacement must survive

| # | Failure | Record |
|---|---|---|
| F1 | Child ends its turn with a placeholder ("I'll wait for the notification"); harness reports `completed` with no result while its background work keeps running | Phase 370; memory `bug_gsd_false_gate_pass_under_resume.md` |
| F2 | Killing a background wait shell re-invokes its owning agent even if it completed; it resumed stale live-DB mutations without the stack lock (3 tests red, 2026-09-29) | memory `bug_killing_wait_shell_revives_agent.md` |
| F3 | Session-limit death kills all agents at once; not resumable via SendMessage; only an OS process (`scripts/session-supervisor.sh`) survives | memory `reference_session_limit_supervisor.md` |
| F4 | Interim "waiting on own background work" notifications arrive as `completed`; stale wait timers held for ~28 min | v0.1.34 events (no file) |
| F5 | Executor stalled 57 min on `sleep 2400` lock placeholder; `until ! pgrep -f <pat>` inside `zsh -c` containing `<pat>` never exits; a 4h-stale restart agent kept restarting the stack | v0.1.34 events (no file) |

## Invariants to keep

1. `completed` is never trusted alone — verify on disk (commit, SUMMARY Self-Check, VERIFICATION, test log).
2. Silent child → stall check by mtime/commit (45 min no change = TaskStop + fresh re-dispatch).
3. TaskStop the owner before killing its wait shell.
4. A coordinator never ends its turn with a placeholder while children run.

## Design notes (hypotheses, not decisions)

- Cost comes from model turns separated by > cache TTL. A poll loop pays one full context re-write per poll; a blocking foreground wait pays one per child completion. Same safety (turn does not end), far fewer re-writes.
- Smaller coordinator context makes every re-write cheaper.
- Deterministic orchestration (code, not an LLM looping) removes F1/F4 by construction: candidates are Claude Code Workflow scripts or an OS-level runner like `session-supervisor.sh`. To be evaluated in S3.
- Check whether a 1-hour prompt-cache TTL is available to this setup (unverified).
