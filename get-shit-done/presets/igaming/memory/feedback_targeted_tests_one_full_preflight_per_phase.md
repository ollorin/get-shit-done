---
name: targeted-tests-one-full-preflight-per-phase
description: "Owner-approved 2026-11-04 test-cost rule: in-plan runs are targeted (affected files + one bucket, once); ONE full preflight per phase on the final tree; twice-green full suites only at phase end/PR"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 181582e5-de8c-4838-9350-b76af8b03856
  modified: 2026-11-04T12:34:14.901Z
---

Inside a plan and fix loops run only affected test files plus the single bucket containing them, once. One full `scripts/preflight.sh` per phase on the final phase tree (before Sonnet pre-verification). The "twice green" all-bucket pass runs once at phase end / before the PR; `--skip-twice` OK for intermediate checks. Cheap gates (test:ci coverage for touched libs, deno check, lint, fmt, fp-gate) run on their own and early.

**Why:** 401-13 ran preflight 5 times (r1-r5, 25+ min each) holding the shared stack lock and starved 402-11 for ~60 min; the libs/application coverage gate failure would have been caught in seconds by running test:ci alone.

**How to apply:** put the rule in every coordinator/executor/reviewer brief. A phase-final full preflight stays mandatory: it catches cross-module breakage (deno fmt vs a pin test, a contract change vs another plan's test). CLAUDE.md / .claude/rules were NOT edited; the rule lives in briefs + this memory. See [[feedback-permitted-test-command-shapes]] and [[reference-host-memory-pressure-test-concurrency]].
