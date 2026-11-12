---
name: feedback-check-settings-before-asking-permissions
description: "Before asking the owner for a new permission rule, read .claude/settings.json — classifier denials are about command shape (inline bypass env vars), not missing allow rules"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 302ddd75-34bc-4c85-9b2f-6a3ff94f7681
  modified: 2026-09-27T12:39:49.469Z
---

Never ask the owner to add a permission rule without first reading `.claude/settings.json`. On 2026-09-27 I asked repeatedly for `Bash(deno test:*)` rules that already existed (settings.json:42, :57, :61); the owner pushed back.

**Why:** The denials were from the auto-mode classifier ("[Safety Bypass Flag]"), which judges command shape independently of allow rules — e.g. `RATE_LIMIT_BYPASS=true deno test …` typed inline reads as disabling a security control.

**How to apply:** Agents run tests only via `deno task test <file>` (apps/api/deno.json sets the bypass vars in-repo) or `scripts/run-integration-tests.sh` — never inline bypass env vars. On a denial, diagnose the command shape and check settings before escalating a rule request. Related: [[feedback-no-unapproved-stack-or-history-commands]].
