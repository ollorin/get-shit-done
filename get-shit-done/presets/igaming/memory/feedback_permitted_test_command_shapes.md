---
name: feedback-permitted-test-command-shapes
description: Agents must run tests only in allowlisted command shapes; any other shape triggers an owner approval prompt
metadata:
  node_type: memory
  type: feedback
  originSessionId: adce7a78-b4e2-4ee6-b8fb-2143c4dfbb8a
  modified: 2026-10-07T21:28:06.828Z
---

Run tests only as `cd <project-root>/apps/api && deno task test <file>`, `deno test <file>` (optionally `timeout N`, trailing `2>&1`), `npx nx test <project>`, or `deno check|lint|fmt`. No inline env vars, no `| tail/grep`, no `;`/extra `&&`, no `$()`/heredocs/`bash -c`, no `rg`/`grep`/`find` (use `zg query`). If a command prompts, stop and report the exact string.

**Why:** the user had to hand-approve test runs during the 392 live suite; the allowlist in `.claude/settings.json` matches command shapes, not intent.

**How to apply:** include this shape list in every coordinator and executor brief. Related: [[feedback-check-settings-before-asking-permissions]].
