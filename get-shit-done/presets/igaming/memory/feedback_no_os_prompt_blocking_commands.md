---
name: feedback-no-os-prompt-blocking-commands
description: "Agents must not run commands that can raise an OS/keychain prompt unattended; explain and ask first, and design the stack start so it never pulls"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 181582e5-de8c-4838-9350-b76af8b03856
  modified: 2026-10-21T21:05:50.669Z
---

Unattended roadmap runs must never block on a macOS dialog (keychain unlock, sudo, Gatekeeper). Before running any command that can raise one (`docker pull`, `supabase start`/`db reset` after an OrbStack restart when images may be missing, anything touching `docker-credential-osxkeychain`), the agent explains the command and why, and asks the owner first.

**Why:** 2026-10-21 `supabase start` hung ~15 min on `docker pull supabase/storage-api:v1.77.0` blocked on the keychain helper (CLI 2.118.0 hardcodes that tag; `.temp/storage-version` pins v1.37.7). Owner: "I dont want to sit near the laptop and wait for the prompt that block the execution... agent should explain and ask permissions before running such commands". The owner declined the prompt several times; the start still came up on the local v1.37.7 images.

**How to apply:** Check `docker images` for the needed tags before any start; if a pull would be needed, ask instead of running. Prefer a fix that removes the pull (pending owner approval: local pre-tag or `[storage] image` in apps/api/supabase/config.toml). Related: [[reference-orbstack-restart-docker-machine]].
