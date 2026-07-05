---
phase: 44-reliability-foundations
plan: 01
subsystem: infra
tags: [json-parse, execFileSync, execSync-hardening, node-test, gsd-tools, reliability]

# Dependency graph
requires: []
provides:
  - "safeJsonParse(content, contextLabel) shared helper in get-shit-done/bin/gsd-tools.js"
  - "14 genuinely-unguarded JSON.parse call sites now routed through safeJsonParse"
  - "All 7 previously-unsafe execSync call sites converted to execFileSync/pure-Node equivalents"
  - "expandGlobSync() and findCodeFilesSync() pure-Node helpers replacing shell glob/find pipelines"
  - "writeStdoutSync() synchronous, EAGAIN-safe stdout writer (replaces async process.stdout.write before process.exit)"
  - "16 new node:test cases covering JSON-guard and execSync-hardening behavior"
affects: [45-deterministic-phase-gate, 46-artifact-generation-and-coverage-gates, 50-final-deletions-and-verification-sweep]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "safeJsonParse(content, contextLabel) — { ok, value } / { ok: false, error } result-object pattern for guarding JSON.parse against corrupted state files, reused rather than 14 inline try/catch blocks"
    - "execFileSync(cmd, argvArray, opts) — argv-array pattern replacing shell string interpolation for all git/cat/ls/find call sites"
    - "expandGlobSync(cwd, glob) — pure-Node single-level glob matcher (fs.readdirSync + regex) replacing `ls -1 <glob>` shell interpolation"
    - "findCodeFilesSync(cwd, extensions, maxDepth, limit) — pure-Node depth-limited recursive walk replacing `find | grep | head` shell pipeline"
    - "writeStdoutSync(content) — blocking fs.writeSync(1, ...) loop with EAGAIN retry, replacing process.stdout.write() immediately before process.exit(0)"

key-files:
  created: []
  modified:
    - "get-shit-done/bin/gsd-tools.js"
    - "get-shit-done/bin/gsd-tools.test.js"

requirements-completed: [MILE-20]

key-decisions:
  - "safeJsonParse and expandGlobSync/findCodeFilesSync added as top-level functions in gsd-tools.js (not a new lib/ module) per CONTEXT.md's Claude's Discretion note — no module-split refactor in this phase"
  - "JSONL log-parsing loops (validation-log.jsonl) use per-line skip-and-warn instead of the terminal error() convention, matching the file's own established local convention (line ~2424) rather than introducing a new error shape"
  - "Cache-read sites (context-index-cache.json) treat corruption as 'rebuild/report-stale' rather than a hard error, since a corrupted cache is recoverable by design (not user-facing state)"
  - "CLI-arg and budget/progress-file JSON parse failures surface via the existing error() helper (prints to stderr, exit 1) to match each command's pre-existing error convention"

patterns-established:
  - "Result-object JSON guard ({ ok, value } / { ok: false, error }) as the standard way to guard any future JSON.parse call site in gsd-tools.js"
  - "argv-array execFileSync/spawnSync as the mandatory replacement pattern for any future shell-out needs — never re-introduce execSync with string interpolation"

# Metrics
duration: 21min
completed: 2026-07-04
---

# Phase 44 Plan 01: JSON.parse Guards & execSync Hardening Summary

**Added a shared safeJsonParse helper guarding 14 unsafe JSON.parse call sites and converted all 7 unsafe execSync shell-interpolation sites to execFileSync/pure-Node equivalents in gsd-tools.js, backed by 16 new regression/injection tests — plus fixed a real stdout-truncation bug the hardening work surfaced.**

## Performance

- **Duration:** ~21 min
- **Started:** 2026-07-04T10:36:56Z
- **Completed:** 2026-07-04T10:57:43Z
- **Tasks:** 3 (all `type="auto"`, Task 3 spec'd as `tdd="true"`)
- **Files modified:** 2 (`get-shit-done/bin/gsd-tools.js`, `get-shit-done/bin/gsd-tools.test.js`)

## Accomplishments

- Added `safeJsonParse(content, contextLabel)` helper co-located with `safeReadFile`/`loadConfig`; converted every genuinely-unguarded `JSON.parse` call site (14 of 55 total occurrences — the rest were already try/catch-wrapped or `JSON.parse(JSON.stringify(...))` deep-clone idioms, left untouched)
- Converted all 7 previously-unsafe `execSync` sites: `isGitIgnored`/`execGit` (git check-ignore, git argv commands), the dependency-drift `git log` call, the large-output `cat` replacement, two `task analyze`/`task chunk --files` glob-expansion sites, and the `find`-based codebase-detection scan — no site still builds a shell command string from unsanitized input
- Added `expandGlobSync()` and `findCodeFilesSync()` pure-Node helpers, eliminating shell-outs to `ls`/`find`/`grep`/`head` entirely for those two call sites
- Discovered and fixed a real regression during Task 3 test-writing: `process.stdout.write()` is asynchronous on pipes, so `process.exit(0)` immediately after could truncate large output — replaced with a synchronous, EAGAIN-retrying `fs.writeSync` loop (`writeStdoutSync`)
- Wrote 16 new `node:test` cases (120 → 136 passing) covering JSON-guard typed-error behavior, JSONL-loop resilience to one bad line, and execSync-hardening injection resistance (shell metacharacters in `--files` globs and commit messages do not execute)

## Documentation Updates

No documentation-worthy changes in this phase (internal reliability hardening of gsd-tools.js — no new public command, API, or user-facing surface). Deferred to the mandatory docs-updater step for final scope classification.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add safeJsonParse helper and guard all unguarded JSON.parse call sites** - `65ef2ca` (feat)
2. **Task 2: Replace unsafe execSync call sites with execFileSync/spawnSync or pure-Node equivalents** - `344ece0` (feat)
3. **Task 3: Test JSON guard and execSync hardening behavior** - `60861af` (test + fix, combined — see Deviations)

**Plan metadata:** committed as part of this SUMMARY.md's final commit.

_Note: Task 3 (tdd="true") produced both new tests and a fix to a bug the tests surfaced; committed together since the fix was discovered mid-test-authoring and immediately verified by the same test._

## Files Created/Modified

- `get-shit-done/bin/gsd-tools.js` - safeJsonParse helper + 14 guarded JSON.parse sites; execFileSync/pure-Node replacements for all 7 execSync sites; new expandGlobSync/findCodeFilesSync/writeStdoutSync helpers
- `get-shit-done/bin/gsd-tools.test.js` - 16 new tests across 6 new `describe` blocks covering JSON-guard and execSync-hardening behavior

## Decisions Made

- Kept `safeJsonParse`/`expandGlobSync`/`findCodeFilesSync` as top-level functions in `gsd-tools.js` rather than extracting a new module, per the phase CONTEXT.md's explicit discretion note (no module-split refactor scoped to this phase)
- For the two context-index-cache read sites, chose "fall through and rebuild" / "report stale: true, reason: corrupted" over a hard `error()` exit — a corrupted cache is a recoverable, non-user-facing artifact, and crashing the CLI over it would be a worse failure mode than silently rebuilding
- For the JSONL per-line parse sites, followed the file's own pre-existing local convention (skip-and-warn on a bad line inside a `.map()`/loop) rather than the terminal `error()` convention used by CLI-command-handler sites, since aborting an entire log read over one bad line would be a regression, not a hardening improvement

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed async stdout write truncation on large piped output**
- **Found during:** Task 3 (writing the `output()` large-payload/cat-replacement test)
- **Issue:** My own Task 2 conversion of the `cat "${tempFile}"` execSync call to `process.stdout.write(fs.readFileSync(tempFile, 'utf-8'))` introduced a genuine regression: `process.stdout.write()` is asynchronous when stdout is a pipe (non-TTY), and the `process.exit(0)` call immediately following it in `output()` could terminate the process before the write flushed — silently truncating large (>100KB) JSON output. The original `execSync('cat ...', { stdio: 'inherit' })` avoided this because it blocked synchronously on a child process. A first fix attempt (plain `fs.writeSync` loop) surfaced a second issue: `fs.writeSync` throws `EAGAIN` when stdout is a non-blocking pipe with a full buffer, rather than blocking.
- **Fix:** Added `writeStdoutSync(content)` — a blocking `fs.writeSync(1, buffer, offset, length)` loop that retries with a brief `Atomics.wait` pause on `EAGAIN` instead of throwing or truncating. Replaced all three `process.stdout.write(...)` call sites inside `output()` (large-output success path, large-output fallback path, and the normal/terminal path) with `writeStdoutSync(...)`.
- **Files modified:** `get-shit-done/bin/gsd-tools.js`
- **Test added:** `output() large-payload path — fs.readFileSync replacement for 'cat'` (Phase 44-01) in `get-shit-done/bin/gsd-tools.test.js` — generates a >100KB `history-digest` fixture and asserts the full output is valid, complete JSON with all 40 phases present.
- **Verification:** Test failed against the initial `process.stdout.write()`-only fix (truncated at exactly 65536 bytes), then failed again with a raw `EAGAIN` crash after the first `fs.writeSync` attempt, then passed cleanly after adding the EAGAIN retry loop. Full suite re-run: 136/136 passing.
- **Committed in:** `60861af` (Task 3 commit — fix included alongside the test that surfaced it, per the shared fix-then-test-then-commit deviation process)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** The fix was strictly corrective of a regression introduced earlier in this same plan's Task 2 (not scope creep) — it was required to make Task 2's `cat`-replacement hardening actually behavior-preserving, per the plan's own must_haves bar ("preserves its prior observable behavior").

## Issues Encountered

None beyond the deviation above — plan's line-number leads for JSON.parse (55 occurrences) and execSync (7 sites) matched the fresh-grep counts exactly at execution time (no drift since the 2026-07-02 planning session).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `safeJsonParse` and the argv-array `execFileSync` pattern are now the established conventions in `gsd-tools.js` for Phase 44-02 (atomic writes) and Phase 44-04 (dead-code deletions) to build on without reintroducing the same crash/injection risk
- `npm test` is green at 136/136 with no coverage regression; the post-plan test gate passed cleanly
- No blockers for 44-02 (atomic write-rename for STATE.md/ROADMAP.md/config.json), which touches the same file but different call sites (write paths, not the read/parse paths hardened here)

---
*Phase: 44-reliability-foundations*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: get-shit-done/bin/gsd-tools.js
- FOUND: get-shit-done/bin/gsd-tools.test.js
- FOUND: .planning/phases/44-reliability-foundations/44-01-SUMMARY.md
- FOUND commit: 65ef2ca
- FOUND commit: 344ece0
- FOUND commit: 60861af

## Docs

**Status:** Failed — no Agent-spawning tool available in this executor session to invoke gsd-docs-updater. Per this plan's own assessment (see Documentation Updates section above), this is internal reliability hardening of gsd-tools.js with no new public command/API/user-facing surface, so the expected docs-updater outcome would likely have been "No documentation-worthy changes" regardless. Flagging for manual/future docs-updater run rather than silently skipping.
