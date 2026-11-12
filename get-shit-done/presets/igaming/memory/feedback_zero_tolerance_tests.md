---
name: Zero tolerance for test/lint failures
description: ALL tests and lint errors must be green — no "pre-existing" exceptions. Fix everything every time.
type: feedback
---

Every time we run unit or integration tests, we expect 100% green. If something is red (test fails, lint issues, warnings, anything) — collect all info, plan fix, send subagent(s) to implement. No "not our changes" paradigm.

**Why:** The user considers the entire codebase their responsibility. Leaving known failures unfixed creates tech debt that compounds. Every test run is a chance to clean up.

**How to apply:** When running any test suite (unit, integration, lint, type check), if ANY failure appears — regardless of when it was introduced — treat it as a blocker. Collect error details, diagnose root cause, and dispatch fix agents before proceeding.
