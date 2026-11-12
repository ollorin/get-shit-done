---
name: project_disk_pressure_frontend_waves
description: Long autonomous frontend build/test waves (Wave D+) can fill the host disk to ENOSPC — clear caches / check df before build-heavy phases. Also covers the Puppeteer temp-profile leak found 2026-08-14.
metadata: 
  node_type: memory
  type: project
  originSessionId: 57b0729a-6d9b-434e-9d90-dbd122a25489
  modified: 2026-08-14T15:35:52.424Z
---

On 2026-07-22, a ~9-hour autonomous Phase 287 (Wave D — Frontend FP) coordinator run filled the
host root disk to 100% (ENOSPC) mid-plan. The APFS container has only ~20Gi headroom after cleanup,
and a long frontend wave churns it fast: `.nx/cache`, both apps' `.next` build dirs, the Deno test
cache, `node_modules/.cache`, plus large per-agent JSONL transcripts under
`/private/tmp/claude-502/.../tasks/` (each 200k-token agent ≈ big). It filled to true zero.

**The ENOSPC deadlock is nasty:** at 0 bytes free, EVERY write-capable tool (Bash, Write) fails
because the harness can't create the command's own output-capture file — so you cannot `rm` your way
out from inside the sandbox (the `rm` never starts). Only `Read` keeps working. Breaking it needs
space freed from OUTSIDE the sandbox (user runs `rm` in a real terminal) OR a fluctuation window a
freshly-spawned agent happens to catch (that's how a Haiku agent broke it here).

**Safe-to-clear, regenerable (freed ~4Gi):** `<project-root>/.nx/cache`, `~/Library/Caches/deno`,
`apps/*/.next`, `<project-root>/.tmp`, `node_modules/.cache`, `~/Library/Caches/pnpm` (~1.3G),
`~/.npm/_cacache`, updater caches (claude-devtools/designinthebrowser). Larger
candidates left alone: ToDesktop ShipIt (2.4G), colima/Docker VM (347M), Homebrew cache.

**CORRECTED 2026-07-28 — browser caches are NOT free to clear.** This file previously listed
"ms-playwright caches" as safe-to-clear/regenerable. That advice broke Charlotte on 2026-07-28: the
cleanup removed `~/.cache/puppeteer` (Charlotte drives **puppeteer**, not playwright — `^24.0.0` in
`~/charlotte/package.json` and `~/.claude-mcp-servers/charlotte/package.json`), so the MCP server
died at "Launching Chromium" with an empty `Fatal error`. The Charlotte MCP tools then showed as
disconnected, and an SC1 regression run reported **infrastructure failure as scenario failure** —
the exact defect class that made 16 of the original 36 "failures" fake. Caught 50s in only because
the monitor grep matched failure signatures, not just `PASS`.

**Regenerable ≠ free.** Before clearing a browser cache, know what depends on it. Recovery:
`cd ~/.claude-mcp-servers/charlotte && npx puppeteer browsers install chrome` (~150MB, few minutes),
then confirm startup logs reach "Chromium launched" + "Opened tab" before trusting any E2E result.
If a Charlotte run reports scenarios failing with "MCP tools not available" or "still connecting",
suspect a missing browser FIRST — do not record those as scenario failures.

**NEVER during ENOSPC recovery:** `git reset/clean/checkout/stash` — Wave-D plans leave verified-green
but UNCOMMITTED work in the working tree (287-04's player-web auth vertical was uncommitted when the
disk filled); a destructive git op would lose it permanently.

**RECURRED 2026-07-25** (Phase 291, 5 concurrent agents): host hit 1.5Gi free / 100%. Biggest
repo-local reclaim was **`apps/e2e-charlotte/results/`** — 565M of per-run `recordings/*.mp4` +
screenshots across ~88 dated run dirs, and it is fully gitignored (`results/.gitignore` = `*`).
Deleting ~30 old dated dirs took it 1.5Gi -> 4.1Gi free (APFS released far more than the dirs'
own size — purgeable space). **Keep the newest ~3 dated dirs and NEVER delete
`results/_progress.jsonl`** — that file is the `--skip-passed` resume record; losing it forces a
full 4-hour re-run. Note `.nx` (13M) and the Deno cache (72M) were negligible this time — go
for the Charlotte results dir first. A bulk `rm -rf` in a shell loop is refused by the safety
classifier; delete explicitly-named dirs in batches instead. Verify no 0-byte `.ts`/`.tsx`
appeared afterwards (`find ... -size 0`) — that is the corruption signature.

**FOUND 2026-08-14 (Phase 315, long Charlotte E2E stretch): a real, previously-undocumented leak
— Puppeteer never cleans up its per-launch temp Chrome profiles.** Every Charlotte scenario
invocation spawns a fresh profile at
`/private/var/folders/<hash>/T/puppeteer_dev_chrome_profile-*` and none are ever removed. After
one extended session running hundreds of scenario invocations: **443 leaked directories, 15GB
total**, disk headroom down to ~3.0Gi free. This is very plausibly a major contributor to (or the
root cause of) a colima/Docker VM corruption that happened the same session (host hit ~122MB free
at the worst point, killing the VM mid-write). Safe to bulk-delete — these are dead browser
profiles from completed processes, not anything the repo/git/project needs; just confirm no live
Puppeteer/Chrome process is using a specific directory before removing it. This leak is NOT covered
by any of the cleanup targets listed above (`.nx/cache`, Charlotte `results/`, etc.) — check
`/private/var/folders/*/T/puppeteer_dev_chrome_profile-*` explicitly as its own step during any
disk-pressure recovery in this project, not just as a side effect of clearing the other caches.

**How to apply:** Before launching a build-heavy autonomous phase (Wave D/E, any full
`preflight.sh` twice-green with dual `nx build`+`nx test`), check `df -h /` and pre-clear `.nx/cache`
+ `.next` if headroom is under ~25Gi. Instruct build agents to `df` before each `nx build` and STOP
(return `status: blocked` + df) rather than re-trigger ENOSPC. Prefer committing verified work
promptly so a disk event can't strand it uncommitted. Relevant to Phases 287–290. See
[[reference_testing_strategy]].
