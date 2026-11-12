---
name: claude-config-overhaul-pending
description: "July 6 2026 .claude config overhaul — two pending user actions: a credential rotation (done), decide on stale GSD local patches"
metadata: 
  node_type: memory
  type: project
  originSessionId: 55e10f8e-d6dd-4f13-9276-d3e5481134b2
  modified: 2026-11-10T21:36:31.056Z
---

On 2026-07-06 a full audit+fix of project `.claude/` and user `~/.claude/` was completed (hooks repaired incl. the previously-dead git-push preflight gate, skills templates fixed to compile, rules got `paths:` frontmatter, rtk-rewrite.sh hardened, GSD `timeout` prefix removed, routing-rules.md copied into gsd-task-router, context7 MCP added).

**Still pending (user-only actions):**
1. **DONE (owner confirmed 2026-11-10)** — Rotate the credentials exposed by the audit; details are in the private repo's tracker and are not preserved here.
2. **GSD local patches decision** — `~/.claude/gsd-local-patches/` holds 10 March-2026 patch files (incl. gsd-executor.md, gsd-phase-coordinator.md, gsd-verifier.md) that diverge heavily from the live v1.18.0 install. Running `/gsd:reapply-patches` could resurrect stale files; user must review diffs and either reapply intentionally or delete the backup dir.

Config-change backups from the overhaul: `~/.claude/backups/settings.json.20260706-233030`, `~/.claude/backups/rtk-rewrite.sh.20260706-233030`. Project-side fixes were left uncommitted on branch `v0.1.21-analytics-reporting`.
