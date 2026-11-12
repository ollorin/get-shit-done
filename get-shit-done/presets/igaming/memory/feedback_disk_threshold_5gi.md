---
name: feedback-disk-threshold-5gi
description: "Restart rule for roadmap runs: OrbStack restart only when free disk < ~3Gi or docker/a bucket stalls; swap is never a trigger"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 181582e5-de8c-4838-9350-b76af8b03856
  modified: 2026-10-31T09:25:42.621Z
---

During autonomous roadmap runs, restart OrbStack/serve ONLY when free disk is below ~3Gi, or when docker or a bucket run is stalled. Swap used (any amount, any %) is never a restart reason. Do not interrupt running executors for disk above 3Gi.

**Why:** the owner 2026-10-31: "Too many restarts. We can survive until 3gb of free space left." Earlier: "12 gb is okay, 5 maybe worth worrying about" (2026-10-21); "we can do less restarts" (2026-10-28). Each restart earlier this run (disk 6-8Gi, swap 10-17 GB, swap files eat the disk) cost an hour of stack work, and overlapping restart agents twice left the stack half-built.

**How to apply:** one restart owner (the coordinator of the oldest running phase), at a plan boundary unless disk < ~3Gi (then immediately, but never mid-Charlotte), one Haiku dispatch, serve always with the apps/api/project.json:33-44 `--env-file` recipe, probes /games /payments /auth = 401, migration completeness after. Supersedes the earlier 10Gi/10 GB/5Gi thresholds. See [[reference-host-cleanup-procedure]] and [[reference-orbstack-restart-docker-machine]] for the steps.
