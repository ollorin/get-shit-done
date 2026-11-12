---
name: feedback-no-unapproved-stack-or-history-commands
description: "The owner did not approve agents' docker stop / git rebase prompts (2026-09-27); agents must route such commands through main for approval, never retry or script around a denial"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 302ddd75-34bc-4c85-9b2f-6a3ff94f7681
  modified: 2026-09-26T22:03:14.759Z
---

On 2026-09-27 the owner received permission prompts for `docker stop` and `git rebase` and approved neither, then asked who requested them and why. They were:
- the Phase 384 coordinator, repairing a stack it had broken itself with `supabase stop/start`;
- an Opus reviewer, running a rebase in a /tmp scratch repo.

The log is in `.planning/v0.1.33-PERMISSION-REQUESTS.md`.

**Why:** the prompts interrupt the owner. Stack stops break every other phase's shared stack. A denied command retried via a script is permission laundering.

**How to apply:** every coordinator, planner and reviewer brief includes this rule:
- no docker stop/kill/restart, `supabase stop/start`, colima/orb commands, or git rebase/history rewrite (/tmp scratch repos included);
- no scripts that do any of these;
- a genuine need goes to main with the exact command and reason, and main asks the owner.

On each status tick, scan the subagent transcripts for such commands. Related: [[feedback-dont-overspawn-subagents]].

**Operational note (2026-09-27):**
- Even with owner approval given in chat, the harness denied my `docker rm -f`. The owner ran it via `!`.
- A process backgrounded inside a `!` command dies when that shell exits. Long-running servers such as `supabase functions serve` must be started by main with Bash `run_in_background`, and agents must never pkill that process.
- A healthy edge runtime means libs bind-mount count > 0 AND `/functions/v1/games` returns 401. A green `docker ps` is not proof.

**Update 2026-10-01 (owner):** `supabase db reset` NO LONGER needs owner approval. Before a reset, confirm no other agent has a live test running (lock owner + ListAgents/peers). Now codified in CLAUDE.md under the parallelism exception. Docker/supabase stop/start/restart and git history rewrites still route through main.
