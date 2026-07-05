---
phase: 47-telegram-reliability
plan: 02
subsystem: infra
tags: [telegram, mcp, reliability, atomic-write, retry, node-test]

# Dependency graph
requires: ["47-01"]
provides:
  - "Atomic write-rename (temp-file + fs.renameSync) for question-state.jsonl -- no torn/partial file ever survives a crash mid-write"
  - "getStateFilePath(projectRoot?) -- SHA1-hash-scoped state file path mirroring getSocketPath(), closing the cross-project-collision gap"
  - "withRetry() bounded-backoff retry helper (default: 4 attempts, 500ms/1500ms/4000ms delays), wired into sendToGroup/sendToThread/createForumTopic"
affects: ["47-03", "48-satellite-injections"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Constructor-injectable stateFilePath on QuestionService (5th arg, defaults to getStateFilePath()) -- mirrors the existing injected createForumTopic/sendToThread/sendToGroup pattern from 47-01"
    - "withRetry<T>(fn, options) generic retry wrapper with injectable sleepFn for deterministic, near-instant tests -- reused by shared/retry.test.ts and daemon/bot/index.test.ts"
    - "find dist -name '*.test.js' | xargs node --test replaces the glob-based test script -- correctly recurses regardless of shell (sh vs bash), unlike dist/**/*.test.js which silently misses files more than one directory level deep"

key-files:
  created:
    - mcp-servers/telegram-mcp/src/shared/retry.ts
    - mcp-servers/telegram-mcp/src/shared/socket-path.test.ts
    - mcp-servers/telegram-mcp/src/shared/retry.test.ts
    - mcp-servers/telegram-mcp/src/daemon/bot/index.test.ts
  modified:
    - mcp-servers/telegram-mcp/src/daemon/question-service.ts
    - mcp-servers/telegram-mcp/src/shared/socket-path.ts
    - mcp-servers/telegram-mcp/src/daemon/index.ts
    - mcp-servers/telegram-mcp/src/daemon/bot/index.ts
    - mcp-servers/telegram-mcp/src/daemon/question-service.test.ts
    - mcp-servers/telegram-mcp/package.json

requirements-completed: [MILE-21]

key-decisions:
  - "Atomic write-rename (temp file + fs.renameSync) chosen over the vendored proper-lockfile dependency -- simpler, no lock-file lifecycle/staleness cleanup, sufficient for the single-writer-per-process/crash-safety threat model. proper-lockfile remains a listed (intentionally unused) dependency; documented in a code comment directly above saveState() so a future gap-check doesn't flag it as dead weight without context."
  - "Per-project state-file scoping implemented (was Claude's Discretion per 47-CONTEXT.md) -- cheap (~15 LOC), meaningfully shrinks the blast radius the atomic-write fix has to cover. getStateFilePath() mirrors getSocketPath()'s exact SHA1-hash scheme."
  - "Retry defaults: 4 total attempts (1 initial + 3 retries), delays 500ms/1500ms/4000ms -- matches 47-CONTEXT.md's suggested starting point exactly. reactToMessage() intentionally left unwrapped (cosmetic checkmark reaction, explicitly out of scope per 47-CONTEXT.md)."
  - "package.json's test script switched from 'node --test dist/**/*.test.js' to 'find dist -name \"*.test.js\" | xargs node --test' -- see Deviations."
  - "Production daemon's state-file path change (getStateFilePath()) only takes effect on the daemon's NEXT organic restart, per the plan's own operational_constraint -- explicitly not a regression, see Next Phase Readiness."

# Metrics
duration: ~35min
completed: 2026-07-04
---

# Phase 47 Plan 02: Telegram Escalation Reliability -- JSONL State Locking + Delivery-Failure Retry Summary

**Closed the two remaining reliability gaps in MILE-21: question-state.jsonl writes are now atomic (temp-file + rename) and project-scoped (SHA1-hash mirroring getSocketPath()), and all three outbound Telegram send functions (sendToGroup/sendToThread/createForumTopic) now retry with bounded exponential backoff before rethrowing, so a delivery failure is never silently dropped.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-04T20:59:00Z (approx, immediately following 47-01)
- **Completed:** 2026-07-04T21:17:00Z
- **Tasks:** 5 completed
- **Files modified:** 10 (4 created, 6 modified), plus corresponding dist/ build output

## Accomplishments

- `question-service.ts`'s `saveState()` no longer uses bare `fs.writeFileSync()` -- it writes to a `${stateFilePath}.tmp-${pid}-${random}` temp file, then `fs.renameSync()`s over the target. POSIX rename is atomic, so a crash mid-write (or, in the multi-process case, a race between two writers) can never leave a torn/partial JSONL line for a reader to choke on.
- `question-state.jsonl`'s path is now project-scoped: `shared/socket-path.ts` gained `getStateFilePath(projectRoot?)`, mirroring `getSocketPath()`'s exact SHA1-hash scheme (`question-state-{hash8}.jsonl` under `~/.claude/knowledge/`). `QuestionService`'s constructor accepts an optional 5th `stateFilePath` argument (defaults to `getStateFilePath()`); `daemon/index.ts` computes the path once and passes the SAME value to both the restore-on-boot read and the `QuestionService` constructor -- no drift between the two.
- New `shared/retry.ts`: `withRetry<T>(fn, options)` -- bounded exponential-backoff helper (default: 4 total attempts, delays 500ms/1500ms/4000ms). Every retry logs at WARN (loud, visible); final exhaustion logs at ERROR and rethrows the original error -- callers keep their existing "does this failure matter to me" semantics, but no failure ever goes unlogged. `sleepFn` is injectable for deterministic, near-instant tests.
- `daemon/bot/index.ts`'s `sendToGroup`, `sendToThread`, and `createForumTopic` now wrap their `bot.telegram.*` calls in `withRetry(...)`. `reactToMessage` is deliberately unchanged (cosmetic checkmark reaction, out of scope per `47-CONTEXT.md`).
- telegram-mcp's test suite grew from 16 to 35 tests: 4 new tests in `socket-path.test.ts` (per-project scoping, determinism, no-collision-with-getSocketPath), 4 new tests appended to `question-service.test.ts` (temp-dir auto-creation on `saveState()`, rapid-fire `saveState()` never tears the JSONL file, a real-disk round-trip `ask()` -> `saveState()` -> `restoreState()` regression), 5 new tests in `retry.test.ts` (pure `withRetry()` behaviors), and 6 new tests in `daemon/bot/index.test.ts` (monkey-patched Telegraf proving `withRetry` is actually wired into all three send functions, not bypassed, and that exhausted retries rethrow rather than silently swallow).

## Task Commits

Each task was committed atomically:

1. **Task 1: Atomic write-rename + per-project state-file scoping** - `e46a1e5` (feat)
2. **Task 2: Test atomic rename + per-project state-file scoping** - `6ddbddc` (test)
3. **Task 3: Delivery-failure detection + bounded-backoff retry wrapper** - `4717d73` (feat)
4. **Task 4: Test retry helper + bot send-function wiring** - `2ddb0d8` (test)
5. **Task 5: Final verification** - no commit (verification-only, no files modified)

**Plan metadata:** (this commit)

## Files Created/Modified

- `mcp-servers/telegram-mcp/src/shared/socket-path.ts` - Added `getStateFilePath(projectRoot?)`, mirroring `getSocketPath()`'s SHA1-hash scheme
- `mcp-servers/telegram-mcp/src/daemon/question-service.ts` - `stateFilePath` is now constructor-injectable (5th arg, defaults to `getStateFilePath()`); `saveState()` rewritten to write-temp-then-rename atomically; removed the now-unused `os` import (kept `path` for `path.dirname()`)
- `mcp-servers/telegram-mcp/src/daemon/index.ts` - Computes `stateFilePath` via `getStateFilePath()` once, passes the same value to both the restore-on-boot read and the `QuestionService` constructor; removed now-unused `os` import
- `mcp-servers/telegram-mcp/src/shared/retry.ts` - New: `withRetry<T>(fn, options)` bounded-backoff helper
- `mcp-servers/telegram-mcp/src/daemon/bot/index.ts` - `sendToGroup`/`sendToThread`/`createForumTopic` wrapped in `withRetry(...)`; `reactToMessage` unchanged
- `mcp-servers/telegram-mcp/src/shared/socket-path.test.ts` - New: 4 tests covering `getStateFilePath()`'s per-project scoping, determinism, naming, and non-collision with `getSocketPath()`
- `mcp-servers/telegram-mcp/src/daemon/question-service.test.ts` - Appended new describe block (4 tests): temp-dir auto-creation, rapid-fire saveState() torn-file regression guard, real-disk round-trip regression
- `mcp-servers/telegram-mcp/src/shared/retry.test.ts` - New: 5 tests covering `withRetry()`'s pure behaviors with an injected `sleepFn`
- `mcp-servers/telegram-mcp/src/daemon/bot/index.test.ts` - New: 6 tests covering `sendToGroup`/`sendToThread`/`createForumTopic`'s retry wiring via a monkey-patched Telegraf bot instance (no real network calls)
- `mcp-servers/telegram-mcp/package.json` - `test` script changed from `tsc && node --test dist/**/*.test.js` to `tsc && find dist -name '*.test.js' | xargs node --test` (see Deviations)
- `mcp-servers/telegram-mcp/dist/**` - Rebuilt output reflecting all of the above (package's existing convention commits `dist/` alongside `src/`)

## Test Results

| Task | Tests Written | Tests Passing | Categories |
|------|--------------|----------------|-----------|
| Task 2 | 8 (4 socket-path.test.ts + 4 appended to question-service.test.ts) | 8/8 | per-project scoping, determinism, temp-dir auto-creation, torn-file regression guard, real-disk round-trip |
| Task 4 | 11 (5 retry.test.ts + 6 daemon/bot/index.test.ts) | 11/11 | pure retry behaviors, custom attempts/delays overrides, bot-wiring proof, exhausted-retry rethrow |

Combined with 47-01's 16 tests: **35/35 telegram-mcp tests passing.** Root suite: **251/251 passing** (unchanged baseline).

## Decisions Made

- **Atomic write-rename over `proper-lockfile`**: simpler, no lock-file lifecycle/staleness cleanup to manage, sufficient for the single-writer-per-process / crash-safety-against-torn-reads threat model. `proper-lockfile` remains a listed dependency in `package.json`, intentionally unused; a code comment directly above `saveState()` documents why, per the plan's explicit instruction, so a future gap-check doesn't flag it as dead weight without context.
- **Per-project state-file scoping implemented** (this was Claude's Discretion per `47-CONTEXT.md`, not independently required by any MILE-21 AC bullet) -- ~15 LOC, meaningfully shrinks the blast radius the atomic-write fix has to cover by eliminating cross-project collision entirely rather than just making torn writes safe.
- **Retry defaults kept exactly as `47-CONTEXT.md` suggested**: 4 total attempts (1 initial + 3 retries), delays 500ms/1500ms/4000ms. `reactToMessage()` intentionally left unwrapped (cosmetic, not a "notification" per the AC's own examples).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `dist/**/*.test.js` glob silently missed nested test files under `sh`**
- **Found during:** Task 4 verification (running `npm test` after adding `daemon/bot/index.test.ts`)
- **Issue:** `npm test`'s script (`tsc && node --test dist/**/*.test.js`) runs under `sh` (POSIX shell, not `bash`/`zsh`), where `**` without the `globstar` shell option behaves identically to a single `*` -- it does not match paths more than one directory level deep. `dist/daemon/bot/index.test.js` is two levels deep (`daemon/bot/`), so it was silently never discovered or executed by `npm test`, even though the file compiled cleanly and passed 6/6 when run standalone (`node --test dist/daemon/bot/index.test.js`). The test run reported "29/29 passing" with zero warning that 6 tests (this plan's entire bot-wiring verification) were never executed -- a false-green result.
- **Fix:** Changed `package.json`'s `test` script to `tsc && find dist -name '*.test.js' | xargs node --test`, which recurses correctly via `find` regardless of the invoking shell's glob settings. Re-ran: 35/35 tests now discovered and passing (was 29/29 before, silently missing the new file).
- **Files modified:** `mcp-servers/telegram-mcp/package.json`
- **Verification:** `npm test` now reports 12 suites / 35 tests (was 9 suites / 29 tests); `find dist -name '*.test.js'` lists all 5 test files including the two-levels-deep one; `node --test dist/daemon/bot/index.test.js` standalone also independently confirms 6/6 passing.
- **Committed in:** `2ddb0d8`
- **Impact:** This was caught during this plan's own execution (the same session that added the nested file), not left for a future plan to discover. No prior plan's tests were silently skipped by this bug -- 47-01's two test files (`question-service.test.ts`, `adapter-reliability.test.ts`) are both one level deep under `dist/`, so they were always correctly discovered. Only this plan's new `dist/daemon/bot/index.test.js` (nested one level deeper) was affected.

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking issue, test-infrastructure glob bug). No production-code deviations -- all production source changes exactly match the plan's specification.
**Impact on plan:** The fix was necessary for Task 4's own verification step to be meaningful. No scope creep -- only the test *runner invocation* (a single line in `package.json`) required adaptation.

## Issues Encountered

- No Agent tool (subagent spawning) was available in this execution environment, same as 47-01. Per the plan's explicit fallback instruction, all four test files in this plan (`socket-path.test.ts`, the appended `question-service.test.ts` block, `retry.test.ts`, `daemon/bot/index.test.ts`) were written directly rather than via `gsd-test-writer`.
- The mandatory `gsd-docs-updater` spawn (documentation hard gate) also could not run for the same reason. Filed a formal waiver via `gsd-tools.js deferred add 47 --step docs --reason "..." --approver executor-manual-assessment --plan 02`, matching 47-01's precedent exactly -- this plan is an internal reliability fix with no user-facing API/behavior change requiring `/docs` updates.

## User Setup Required

None -- no external service configuration required. All changes are internal to `mcp-servers/telegram-mcp`.

**Operational note (explicitly not a regression):** the production Telegram daemon serving this roadmap run (PID confirmed still running, started `Thu Jul 2 00:33:24 2026`, unrestarted throughout this plan) will continue writing to its already-loaded, already-compiled state-file path (the old, non-project-scoped `question-state.jsonl`) until its next organic restart. Only on that next restart will it pick up `getStateFilePath()`'s new project-scoped path -- at which point it will find no file at the new hashed path (fresh start, zero pending questions to restore), which is equivalent to "zero orphaned questions" per 47-01's fix, not a data-loss bug. Confirmed via `stat`: the production `~/.claude/knowledge/question-state.jsonl`'s mtime (`Jul 2 00:33:24 2026`) predates this entire session and was never touched by any test (all tests used `os.tmpdir()`-scoped paths, verified via a targeted grep confirming zero test code calls `getStateFilePath()`/`getSocketPath()` with no arguments).

## Docs

**Status:** WAIVED -- no Agent tool available in this execution environment to spawn `gsd-docs-updater` (same as 47-01). Filed via `gsd-tools.js deferred add 47 --step docs --reason "..." --approver executor-manual-assessment --plan 02`. Manually assessed: this plan is an internal reliability fix (atomic state-file writes, per-project scoping, retry wrapper) with no user-facing API/behavior change requiring `/docs` updates.

## Requirements Tracking Note

MILE-21 is intentionally left as `Pending` in `.planning/REQUIREMENTS.md` after this plan (same rationale as 47-01's SUMMARY.md). All three plans in Phase 47 share the same `MILE-21` requirement ID since it spans the full phase (47-01: daemon-crash detection; 47-02: JSONL locking + delivery retry, this plan; 47-03: overnight fallback + workflow wiring, remaining). Will be marked complete after 47-03 finishes.

## Next Phase Readiness

- MILE-21's Plan 47-02 scope (JSONL state locking + delivery-failure retry) is fully complete: `saveState()` is atomic and project-scoped, all three Telegram send functions retry with bounded backoff and rethrow on exhaustion, 35/35 telegram-mcp tests passing, 251/251 root tests passing.
- Ready for 47-03 (overnight timeout fallback + workflow-layer wiring), which is independent of this plan's specific changes but builds on the same `DaemonUnavailableError` typed signal from 47-01.
- `mcp-servers/telegram-mcp`'s test infrastructure is now `tsc && find dist -name '*.test.js' | xargs node --test` (corrected from the glob-based script that silently missed nested files) -- 47-03 should reuse this as-is.
- No blockers. The production daemon (topic 3208) was never restarted or interrupted; its socket and state file were confirmed untouched (mtimes predate this session) throughout this plan's execution.

---
*Phase: 47-telegram-reliability*
*Completed: 2026-07-04*

## Self-Check: PASSED

All 10 key source/config files confirmed present on disk; all 4 task commit hashes (`e46a1e5`, `6ddbddc`, `4717d73`, `2ddb0d8`) confirmed present in `git log --all`.
