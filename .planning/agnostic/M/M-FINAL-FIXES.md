# M-FINAL fixes (Fable review at 70ac80e)

| Finding | Commit | Test |
|---|---|---|
| H1 gate stdin swallow | 0fab69b | preset-base-scripts.test.js G-e2 (mutant: drop `</dev/null` -> red); script also fails if gates run != configured |
| H2 igaming text back in core | 6dcd25b | agnostic-lint.test.js H2 (real repo check exits 0; denied-term fixture exits 1) |
| M1 unregistered reaper-scope test | 60b4e2b | agnostic-lint.test.js M1 (every tracked *.test.js outside tests/ is in package.json) |
| M2 legacy risk keywords | d686cf1 | agnostic-lint.test.js M2 (count + SHA-256 per list; empty list fails at load; mutant removing the check -> red) |

## Notes
- Pilot before() spawns have no timeout; P-a's 60 s assertion can flake on a loaded runner (not changed).
- `project diff` reports unchanged for a locally edited deployed file (frozen engine, cutover review).
- Rule-set JSONs, canary-gate, guard-registry, canaries are guarded:false (decision 6c).
- Dependency gate has no scanner timeout.
- .planning/agnostic/M docs carry ~ paths (internal planning docs; scrub in the clean branch).
- H1 count check is defensive: with stdin detached it is not independently killable by a stdin-based mutant.

## Leaked child fix

- Tool is not defective: process.mjs spawns the test command with `detached: true` and SIGKILLs the group on timeout/exit; restore.mjs:63 handles SIGINT/SIGTERM/SIGHUP by killing live groups (the existing SIGTERM CLI test asserts the test pid is gone).
- Leak was the test: `slow.check.js` (setInterval forever) survived when an assertion failed before the cleanup, or when the SIGKILLed-CLI test could not find the group. Fix in preset-base-mutate.test.js: every spawned child is tracked, every recorded test pid has its pgid looked up and the group SIGKILLed in the global `afterEach` (`reapAll`).
- Regression test "reapAll kills a recorded slow test process and its group...": leader + `sleep 300` child, then reapAll, polls `process.kill(pid,0)` for both. Mutant (`reapAll` body = return): the test hangs/fails (leaked children keep node --test alive; killed manually), restored: green.
- Sibling sweep: `git grep -n -E "spawn\(|detached|slow\.|sleep [0-9]{2,}|setInterval" -- 'get-shit-done/bin/*.test.js'`. Reviewed: decisions.test.js:236, project-registry*.test.js (short-lived, exit on their own), gsd-tools.test.js:4427 (exits), preset-base-mutate.test.js:158 (now tracked), :269/:279 (runTest sweeps group, asserted), preset-base-reaper-scope.test.js:27/46 (kids killed in afterEach), preset-base.test.js:1281/2108 (sleep 12/14 bounded), preset-base-scripts.test.js:50/136 (live + SIGKILL), :1397 and agentSentinel (leak: `sleep 299.x` child orphaned when only the shell pid was killed) -> fixed with killTree (pkill -P + kill).

## Round 2 fixes

- F1 (c1ab572): freeze rule now names `stack.paths.backend` and `stack.paths.migrations`; lock rule names `stack.isolation.lock_dir` (agents/gsd-phase-coordinator.md, workflows/execute-phase.md); test F1 in scripts/agnostic-lint.test.js greps both files.
- F2 (c1ab572): entry gate reads "every gate in `stack.gates[]` and `test_all` that needs no running stack"; same test pins it.
- F3: M1 exempts only `tests/fixtures/`, skips outside a git checkout. Registered tests/phase-37/prd-trace.test.js (8 pass) and wave-context.test.js (9 pass) in package.json. tests/phase-38/kb-feedback.test.js fails 3 of 11 singly with NODE_PATH: exempted by name in the test with the reason; not fixed here.

## kb-feedback

tests/phase-38/kb-feedback.test.js failed 3 of 11 (tests 7, 8, 10) singly. Not environmental: no test touches ~/.gsd or the network. Stale expectation: commit e597708 (MILE-30 restructure) moved the verifier's `<kb_feedback>` section from agents/gsd-verifier.md to get-shit-done/references/verifier-detail.md, so:
- test 7 (`kb_feedback` section present): string absent from the core agent.
- test 8 (`anti_pattern`, `knowledge add`): same move.
- test 10 (`[Phase ... anti-pattern]`, `root cause`): same move.
Fix: the test now reads core agent + verifier-detail.md. Tests 6, 9, 11 passed because their strings remain in core. File registered in package.json test list; M1 name exemption removed.
