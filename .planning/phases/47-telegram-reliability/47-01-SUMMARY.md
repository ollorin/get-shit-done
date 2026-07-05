---
phase: 47-telegram-reliability
plan: 01
subsystem: infra
tags: [telegram, mcp, ipc, daemon, reliability, node-test]

# Dependency graph
requires: []
provides:
  - "Deterministic orphan-handling in QuestionService.restoreState() -- every restored pending question is dropped and notified, never a silent zombie"
  - "DaemonUnavailableError (code: DAEMON_UNAVAILABLE) as the typed signal surfaced through the MCP tool error JSON at every client-side daemon-unavailability detection point"
  - "Pure, independently-testable reconnect-policy.ts (shouldGiveUpReconnecting/computeReconnectDelayMs)"
  - "Documented + test-proven single-timer ownership between question-service.ts's ask() timeout and ipc-client.ts's methodTimeout() backstop"
  - "telegram-mcp package's first test suite (node:test via tsc build + node --test dist/**/*.test.js), 16 tests"
affects: [47-02, 47-03, 48-satellite-injections]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "node:test + node:assert/strict for telegram-mcp package tests, run via `tsc && node --test dist/**/*.test.js` (package build, not the no-compile-step approach originally assumed in 47-CONTEXT.md)"
    - "mock.timers (node:test) to fake internal setTimeout without real wall-clock waits or dangling timers"
    - "Object-property indirection (`{ release: fn | null }`) instead of a bare `let` closure variable to sidestep a TS control-flow-narrowing quirk with nested-closure reassignment"

key-files:
  created:
    - mcp-servers/telegram-mcp/src/shared/errors.ts
    - mcp-servers/telegram-mcp/src/adapter/reconnect-policy.ts
    - mcp-servers/telegram-mcp/src/daemon/question-service.test.ts
    - mcp-servers/telegram-mcp/src/adapter/adapter-reliability.test.ts
    - mcp-servers/telegram-mcp/.gitignore
  modified:
    - mcp-servers/telegram-mcp/src/daemon/question-service.ts
    - mcp-servers/telegram-mcp/src/adapter/index.ts
    - mcp-servers/telegram-mcp/src/adapter/ipc-client.ts
    - mcp-servers/telegram-mcp/package.json

requirements-completed: [MILE-21]

key-decisions:
  - "Test runner: switched package.json's test script to `tsc && node --test dist/**/*.test.js` instead of 47-CONTEXT.md's no-compile-step `node --experimental-strip-types --test` approach -- the installed Node 22.17.0 cannot parse TS constructor parameter properties in strip-only mode and cannot resolve .js specifiers to sibling .ts files without a compile step. Uses the plan's own documented fallback ('or the package build'), adds no new dependency."
  - "Added mcp-servers/telegram-mcp/.gitignore scoped to dist/**/*.test.js and *.test.d.ts only -- keeps compiled test artifacts out of version control while leaving the rest of dist/ tracked, matching this package's existing (pre-existing, unusual but established) convention of committing built output alongside source."
  - "restoreState() collapses to ONE deterministic path: every restored pending (unanswered) question is dropped from live state and notified, regardless of whether its timeoutMinutes deadline had technically elapsed -- wording differs (stale vs orphaned) but the drop-and-notify behavior is identical."
  - "reconnect-policy.ts has zero imports from adapter/index.ts, verified by grep, so it can be imported directly in tests without triggering adapter/index.ts's top-level main().catch(...) side effect."

# Metrics
duration: 47min
completed: 2026-07-04
---

# Phase 47 Plan 01: Telegram Escalation Reliability -- Daemon-Crash Detection + Double-Timer Fix Summary

**Collapsed restoreState()'s zombie-question bug into one deterministic orphan-handling path, added a typed DaemonUnavailableError surfaced through the MCP tool error JSON, extracted reconnect give-up/backoff into pure testable functions, and proved single-timer ownership with a live socket-close test -- 16 new node:test tests, telegram-mcp's first test suite.**

## Performance

- **Duration:** 47 min
- **Started:** 2026-07-04T20:11:00Z
- **Completed:** 2026-07-04T20:58:39Z
- **Tasks:** 5 completed
- **Files modified:** 9 source files (4 created, 4 modified, 1 gitignore created), plus corresponding dist/ build output

## Accomplishments

- Fixed the real, source-verified bug: `QuestionService.restoreState()` used to silently re-arm not-yet-expired restored questions into live maps with no timer/listener (a permanent zombie -- any later reply was silently swallowed). Now every restored pending question is deterministically dropped and notified, whether already expired or not.
- `deliverAnswer()` now distinguishes "reply landed on a question orphaned by a crash" (warn-logged, returns false) from "reply on a genuinely unknown thread" (debug-logged, returns false) -- previously indistinguishable.
- Added `DaemonUnavailableError` (`code: 'DAEMON_UNAVAILABLE'`) and wired it through both client-side daemon-unavailability detection points (`IPCClient.request()`'s not-connected throw, the socket `'close'` handler) and `adapter/index.ts`'s `proxyTool()`. The MCP tool error JSON now includes `code` whenever the caught error carries one.
- Extracted the reconnect give-up/backoff decision out of `attemptReconnect`'s fire-and-forget closure into `reconnect-policy.ts` -- two pure, directly-importable functions with zero circular-import risk.
- Documented single-timer ownership with matching code comments at both call sites (`question-service.ts`'s `ask()` timer, `ipc-client.ts`'s `methodTimeout()`) and proved it with a live `IPCServer`/`IPCClient` test: a server-side socket close rejects a pending request with `DaemonUnavailableError` in single-digit milliseconds (not the 30-second backstop), and a normal response correctly clears the backstop timer with no late rejection.
- Stood up telegram-mcp's first test suite: 16 tests across two files (`question-service.test.ts`, `adapter-reliability.test.ts`), all using fake/injected `createForumTopic`/`sendToThread`/`sendToGroup` -- never a real Telegraf bot, never the production socket or state file.

## Documentation Updates

No documentation-worthy changes in this phase (internal reliability fix + tests, no user-facing API/behavior change to document beyond what SUMMARY.md and code comments already capture). gsd-docs-updater could not be spawned -- no Agent/Task tool available in this execution environment (see Issues Encountered). Filed a formal waiver via `gsd-tools.js deferred add 47-telegram-reliability --step docs --reason "..." --approver executor-manual-assessment --plan 01` rather than silently skipping the mandatory docs_update gate. This exclusion-path assessment was made manually per the same reasoning gsd-docs-updater would have applied.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix restoreState() zombie-question determinism** - `6ab1a54` (feat)
2. **Task 2: Test restoreState() orphan-handling fix** - `4cfae6d` (test)
3. **Task 3: Typed DAEMON_UNAVAILABLE error + reconnect-policy extraction + single-timer-ownership comments** - `004a4d4` (feat)
4. **Task 4: Test typed error propagation, reconnect policy, and single-timer ownership** - `72c1b6c` (test)
5. **Task 5: Final verification** - no commit (verification-only, no files modified)

**Plan metadata:** (this commit)

## Files Created/Modified

- `mcp-servers/telegram-mcp/src/daemon/question-service.ts` - Collapsed restoreState() to one deterministic orphan-handling path; added orphanedThreadIds set; deliverAnswer() logs distinctly for orphaned-thread replies; ownership comment above ask()'s setTimeout
- `mcp-servers/telegram-mcp/src/shared/errors.ts` - New: DaemonUnavailableError class (code: 'DAEMON_UNAVAILABLE')
- `mcp-servers/telegram-mcp/src/adapter/reconnect-policy.ts` - New: shouldGiveUpReconnecting()/computeReconnectDelayMs() pure functions
- `mcp-servers/telegram-mcp/src/adapter/ipc-client.ts` - DaemonUnavailableError at both throw sites; ownership comment above methodTimeout()
- `mcp-servers/telegram-mcp/src/adapter/index.ts` - DaemonUnavailableError in proxyTool(); reconnect-policy.ts wired into attemptReconnect; error JSON payload includes `code` when present
- `mcp-servers/telegram-mcp/src/daemon/question-service.test.ts` - New: 6 tests covering restoreState() orphan-handling (stale, fresh-orphan regression case, orphaned-reply, answered-skip, empty-restore, realistic crash-simulation via ask()+restoreState())
- `mcp-servers/telegram-mcp/src/adapter/adapter-reliability.test.ts` - New: 10 tests covering reconnect-policy boundaries, DaemonUnavailableError shape, and two live IPCServer/IPCClient crash-simulation tests proving single-timer ownership
- `mcp-servers/telegram-mcp/package.json` - Added `"test": "tsc && node --test dist/**/*.test.js"` script
- `mcp-servers/telegram-mcp/.gitignore` - New: excludes compiled test artifacts (dist/**/*.test.js, *.test.d.ts) from version control
- `mcp-servers/telegram-mcp/dist/**` - Rebuilt output reflecting all of the above (this package's existing convention commits dist/ alongside src/)

## Decisions Made

- **Test runner switched from the no-compile-step approach to `tsc && node --test dist/**/*.test.js`.** 47-CONTEXT.md's test infrastructure decision assumed `node --experimental-strip-types --test <path>` would work directly against `.ts` source with `.js`-style NodeNext import specifiers. In practice, on the installed Node 22.17.0: (a) strip-only mode cannot parse TypeScript constructor parameter properties (used throughout `QuestionService`'s constructor and elsewhere), and (b) even with `--experimental-transform-types` (which does handle parameter properties), Node's resolver does not fall back from a `.js` specifier to a sibling `.ts` file without a compile step -- both are genuine environment discrepancies from what was verified during planning, empirically reproduced with minimal repros before switching. The plan itself names "or the package build" as an accepted fallback; that path was taken. No new dependency was added (`tsc` was already a devDependency).
- **Added a package-local `.gitignore`** so the new compiled `*.test.js`/`*.test.d.ts` files never get committed, while leaving the rest of `dist/` tracked -- matching this package's pre-existing (if unusual) convention of committing build output alongside source, confirmed via `git log` on prior commits touching `dist/`.
- **`restoreState()`'s single deterministic path**: rather than special-casing "not-yet-expired" questions differently from "already-expired" ones, both are dropped and notified -- the only difference is notification wording. This matches 47-CONTEXT.md's `<predecessor_state>` analysis precisely: a daemon crash destroys the owning Promise/listener regardless of remaining time on the clock, so there is no safe way to "resume" either case.
- **`deliverAnswer()`'s orphaned-thread check runs before the generic threadId lookup** so replies to crash-orphaned threads are logged distinctly (warn) from replies to genuinely unrelated/unknown threads (debug) -- this was the specific behavior 47-CONTEXT.md called out as needed to avoid a false "delivered" report.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Node 22.17.0 cannot run the plan's specified no-compile-step test approach**
- **Found during:** Task 2 (writing question-service.test.ts)
- **Issue:** `node --experimental-strip-types --test src/**/*.test.ts` fails to parse TypeScript constructor parameter properties (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`); `--experimental-transform-types` handles that but then cannot resolve `.js` import specifiers to sibling `.ts` files (`ERR_MODULE_NOT_FOUND`), since production source uses NodeNext-convention `.js` specifiers that must not change (would break the real tsc build). Confirmed via minimal reproductions isolating each failure mode.
- **Fix:** Changed `package.json`'s `"test"` script to `"tsc && node --test dist/**/*.test.js"` -- the plan's own documented fallback ("or the package build"). Test files keep `.js` import specifiers matching the existing NodeNext convention; tsc compiles them normally alongside production code.
- **Files modified:** `mcp-servers/telegram-mcp/package.json`, `mcp-servers/telegram-mcp/.gitignore` (new, to keep compiled test artifacts out of git)
- **Verification:** `npm test` in the package exits 0, all 16 tests pass; `npx tsc --noEmit` is clean.
- **Committed in:** `4cfae6d` (package.json + .gitignore), `72c1b6c` (second test file)

**2. [Rule 1 - Bug in test cleanup, found and fixed during authoring] afterEach hung on already-crashed sockets**
- **Found during:** Task 4 (writing adapter-reliability.test.ts, crash-simulation test)
- **Issue:** The shared `afterEach` hook unconditionally called `client.disconnect()` on every tracked `IPCClient`. `IPCClient.disconnect()` waits for a `'close'` event via `.once('close', resolve)` -- but a client whose socket was already destroyed by a crash-simulation test will never emit `'close'` again (it already fired once), so this hung forever. `node:test`'s async-leak detector correctly flagged this as "Promise resolution is still pending but the event loop has already resolved" -- extensive isolation testing (minimal reproductions with raw net sockets and instrumented logging) confirmed the actual production behavior (fast DaemonUnavailableError rejection) was already correct; the hang was purely in test cleanup code, not production code.
- **Fix:** `afterEach` now checks `client.isConnected()` before calling `disconnect()`.
- **Files modified:** `mcp-servers/telegram-mcp/src/adapter/adapter-reliability.test.ts`
- **Verification:** All 16 tests pass with no hangs, no leftover `/tmp/telegram-mcp-test-*.sock` files after the run.
- **Committed in:** `72c1b6c`

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking-issue, 1 Rule 1 bug-in-test-code). No production-code deviations beyond what the plan specified.
**Impact on plan:** Both fixes were necessary to make the plan's own test-writing tasks (2 and 4) actually completable in this environment. No scope creep -- the production source changes exactly match the plan's specification; only the test *tooling* (test runner invocation) and test *cleanup logic* required adaptation.

## Issues Encountered

- No Agent tool (subagent spawning) was available in this execution environment. Per the plan's explicit fallback instruction ("If the Agent tool is NOT available... write the test file directly instead -- this is an accepted fallback, not a shortcut"), both `question-service.test.ts` and `adapter-reliability.test.ts` were written directly rather than via `gsd-test-writer`. Same precedent as Phase 46-04. The mandatory `gsd-docs-updater` spawn (documentation_hard_gate) also could not run for the same reason; manually assessed this plan as an exclusion-path pass (internal reliability fix + tests only, no user-facing API/behavior surface requiring documentation).
- A TypeScript control-flow-narrowing quirk (`Type 'never' has no call signatures`) occurred when a `let`-declared closure variable was reassigned only inside a nested `Promise` executor and later called via optional chaining in a `finally` block. Root-caused via isolated minimal repros and worked around by using an object-property (`{ release: fn | null }`) instead of a bare `let` variable -- object property access does not trigger the same narrowing behavior.

## User Setup Required

None - no external service configuration required. All changes are internal to `mcp-servers/telegram-mcp`; the live production daemon (PID confirmed still running, unrestarted) will pick up the daemon-side changes on its next natural restart, and the adapter-side changes on the next MCP adapter respawn (new Claude Code session), per the plan's operational constraint.

## Requirements Tracking Note

MILE-21 is intentionally left as `Pending` in `.planning/REQUIREMENTS.md` after this plan, even though this plan's frontmatter lists `requirements: [MILE-21]`. All three plans in Phase 47 (47-01, 47-02, 47-03) share the same MILE-21 requirement ID in their frontmatter, since MILE-21 spans the full phase (daemon-crash detection done here; JSONL locking + delivery retry in 47-02; overnight fallback + workflow wiring in 47-03). Running `requirements mark-complete MILE-21` now would incorrectly flip its checkbox/table status to Complete after only 1 of 3 contributing plans. It will be marked complete after 47-03 finishes. `roadmap update-plan-progress 47` was run and correctly reports `1/3` plans complete for Phase 47.

## Next Phase Readiness

- MILE-21's Plan 47-01 scope (daemon-crash detection + double-timer race fix) is fully complete: `restoreState()` is deterministic, `DaemonUnavailableError` is typed and wired end-to-end, reconnect-policy is pure and tested, single-timer ownership is documented and proven.
- Ready for 47-02 (JSONL state locking + delivery-failure retry) and 47-03 (overnight timeout fallback + workflow-layer wiring) -- both build on this plan's `DaemonUnavailableError` as the typed signal for daemon-unavailability detection.
- `mcp-servers/telegram-mcp`'s test infrastructure (`tsc && node --test dist/**/*.test.js`) is now established and should be reused as-is by 47-02/47-03 rather than re-attempting the no-compile-step approach.
- No blockers. The production daemon (topic 3208) was never restarted or interrupted; its socket and state file were confirmed untouched (mtimes predate this session) throughout this plan's execution.

---
*Phase: 47-telegram-reliability*
*Completed: 2026-07-04*

## Self-Check: PASSED

All 6 key files confirmed present on disk; all 4 task commit hashes (`6ab1a54`, `4cfae6d`, `004a4d4`, `72c1b6c`) confirmed present in `git log --all`.
