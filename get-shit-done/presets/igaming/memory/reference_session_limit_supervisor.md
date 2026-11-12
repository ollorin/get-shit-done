---
name: reference_session_limit_supervisor
description: "Unattended runs survive Claude session limits ONLY via scripts/session-supervisor.sh + GSD_AUTONOMOUS=1 — GSD's own documented wait-loop is prose, not code"
metadata: 
  node_type: memory
  type: reference
  originSessionId: a0d56b94-9ca9-4036-8ca7-6bf10bb606da
  modified: 2026-07-25T10:18:24.889Z
---

**GSD's documented session-limit recovery does not exist as code.** `execute-roadmap.md` step 4a
describes death detection, reset-time parsing and a polling sleep loop — but verified 2026-07-25,
every consumer of `gsd-tools.js resilience parse-death` is a MARKDOWN file. The parser is real (it
turns "resets 11:10am" into an ISO timestamp and rolls forward correctly); nothing executable waits
on it. The sleep loop is prose instructing the LLM orchestrator to sleep, and when a session limit
hits, that orchestrator is exactly what dies. Foreground `sleep` is also blocked in the Claude Code
harness. Do not re-trust that doc — it over-claims. (Corrected in the fork's `references/resilience.md`.)

**What actually works — an OS process outside the session:**
`scripts/session-supervisor.sh` (committed 68260273). Runs a child, tees output live, scans for a
limit signature, asks `parse-death` for the reset ISO, polls the wall clock, relaunches with a
resume flag. Caps: 6h single wait, 5 resumes, refuses to sleep on missing/past/implausible reset.
Exit codes: 0 ok / 1 setup / 2 ordinary child failure / 3 unusable reset time / 4 resume cap.

**Unattended GSD roadmap launch (owner-chosen posture, 2026-07-25):**
```bash
nohup scripts/session-supervisor.sh --max-resumes 8 -- \
  env GSD_AUTONOMOUS=1 claude -p "/gsd:execute-roadmap" \
      --permission-mode bypassPermissions \
  > .tmp/gsd-run.out 2>&1 < /dev/null & disown
```
`GSD_AUTONOMOUS=1` (patched into the fork, rolled out via `npm run install:gsd` — see
[[reference_gsd_fork_rollout]]) auto-answers ONLY on resumption: `resume_capability` auto-selects
"resume" (NEVER "restart" — it discards completed-phase history), and `confirm_execution`
auto-proceeds only when `resume_state` is set. A FRESH roadmap still requires a human "yes".
Every auto-answered gate logs `autonomous_resume_auto_selected` / `autonomous_confirm_auto_proceeded`.

Charlotte variant: `--resume-flag --skip-passed -- deno task test:regression`.

**Gotcha:** `/gsd:execute-phase` standalone still has two unguarded blocking prompts (branch guard,
Charlotte MAX_ROUNDS). It is NOT on the execute-roadmap path (that spawns gsd-phase-coordinator,
already autonomous-only), so it only matters if you supervise `/gsd:execute-phase` directly.
