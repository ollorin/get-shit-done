---
name: feedback-protect-tmp-gsd-v2
description: .tmp/gsd-v2 is permanently protected from host cleanup; never delete or list it as deletable
metadata:
  node_type: memory
  type: feedback
  originSessionId: 181582e5-de8c-4838-9350-b76af8b03856
  modified: 2026-10-31T15:54:58.746Z
---

`.tmp/gsd-v2` (whole directory) must never be deleted by the host-cleanup job or any agent sweeping `.tmp`.

**Why:** the owner 2026-10-31: "make sure it will not be deleted by cleanup". The 2-day `.tmp` sweep otherwise deletes any old top-level entry (it already destroyed lost mutation logs in Phase 400, see [[reference-host-cleanup-procedure]]).

**How to apply:** keep `gsd-v2` in the cleanup cron's NEVER-delete list next to `local-stack.lock`, `phase-file-claims.md`, `wt-*`, `merge-scratch`, `*evidence-hold*`, `*-evidence`, `opus-ruling`. Also add it to the cleanup rule in the GSD fork (`execute-roadmap.md` ~line 281) when that exclusion fix is made, then reinstall via `npm run install:gsd`.
