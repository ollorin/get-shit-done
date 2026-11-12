---
name: bug_killing_wait_shell_revives_agent
description: "Killing a background wait-loop shell (until df/stat ...) can wake the \"blocked\" agent that owns it, which then resumes stale work on the shared stack"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 58cca91c-5014-4482-b959-beca6c420713
  modified: 2026-09-29T22:05:06.831Z
---

On 2026-09-29, main killed a stale `until df ... -ge 10` shell during cleanup. The shell belonged to a plan-07 executor that had reported "blocked" 13h earlier. The shell's exit re-invoked that executor, and it resumed its old handoff: live DB mutations (M-8/M-C3 on wallet functions) and source edits, without the stack lock, while the verifier was running. Three tests went red.

**Why:** a background Bash task that exits re-invokes its owning agent, even when that agent has already "completed" or blocked.

**How to apply:** before killing a Claude-spawned wait shell, find its owning agent in the task outputs, and TaskStop that agent first. Afterwards, check `ListAgents` for any agent that has flipped back to "running". Related: [[bug_gsd_false_gate_pass_under_resume]], [[feedback_no_sendmessage_to_handed_back_coordinator]].
