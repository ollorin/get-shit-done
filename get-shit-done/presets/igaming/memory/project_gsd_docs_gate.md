---
name: GSD docs verification gate needed
description: Add mandatory documentation verification gate to GSD execute-plan and verify-phase workflows
type: project
---

GSD workflows need a mandatory docs update gate, similar to the pre-PR quality gates in CLAUDE.md.

**Why:** v0.1.8 shipped 10+ operator API endpoints with zero documentation. The existing `commit_docs` flag only controls whether .planning/ files are committed — it doesn't verify that user-facing docs (API references, architecture guides) are updated when features ship.

**How to apply:**
1. Add `documentation_verification_gate` step to `~/.claude/get-shit-done/workflows/execute-plan.md` (after `git_commit_metadata`, ~line 410)
2. Extend `verify-phase.md` must-haves to include documentation artifacts when phase has public APIs
3. Add `verify_docs: true` and `documentation_gate: true` defaults to `gsd-tools.js` config
4. Gate should check: SUMMARY accomplishments → grep docs/ for mentions → STOP if missing

**Key files to modify:**
- `~/.claude/get-shit-done/workflows/execute-plan.md`
- `~/.claude/get-shit-done/workflows/verify-phase.md`
- `~/.claude/get-shit-done/bin/gsd-tools.js` (config defaults)
