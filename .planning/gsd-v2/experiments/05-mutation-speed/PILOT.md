# Experiment 05 - gsd-mutate pilot and review

Tool: `scripts/gsd-mutate/` in igaming-platform (c45b3c91b by a Haiku agent; reviewed and fixed in b1266b568). Pilot target: `apps/api/functions/payments/services/payment-method-limits.ts` + its test file, in throwaway worktree `.tmp/wt-gsd-mutate-pilot` at HEAD b1266b568 (removed afterwards; `git status --porcelain` was empty after every run; the shared checkout was never touched). Command: `deno run --allow-read --allow-write --allow-run=git,deno,perl,kill scripts/gsd-mutate/gsd-mutate.ts --mutants <json> --root <wt> --out <jsonl>`. Unit tests only, no Docker/Supabase. Mutants: `scripts/mutants.json` converted (file/test added; `expect` from the prototype outcome; `expect_failing_test` = prototype `first_failing` for the kills). Evidence: `pilot-evidence/` (run1 = first run, run4 = cold salted run, mutants).

## Result: 10/10 outcomes match the prototype

| mutant | prototype | tool (cold, ms) | tool (warm cache, ms) | failing test named (kills) |
|---|---|---|---|---|
| M1 | survived | survived 740 | 91 | |
| M2 | survived | survived 723 | 93 | |
| M3 | kill-test | killed 698 | 98 | 401-06 methodType: a missing, empty or non-string ... |
| M4 | kill-typechk | killed-typecheck 650 | 607 | |
| M5 | survived | survived 750 | 94 | |
| M6 | kill-typechk | killed-typecheck 594 | 569 | |
| M7 | kill-typechk | killed-typecheck 631 | 574 | |
| M8 | kill-test | killed 655 | 109 | 401-06 methodType: the loader returns the payment_method_type ... |
| M9 | kill-test | killed 644 | 127 | same |
| M10 | kill-test | killed 627 | 116 | same |

- Cold (run4: each `new` carries a unique `/* salt */` comment so deno's check cache misses, like the prototype's salt): 10 mutants in **9 s wall including a green baseline before and after** (6.7 s of mutant time, mean 0.67 s/mutant) vs prototype 6.2-6.4 s / 0.63 s. Equal within noise (a live milestone shares the host; the tool adds a perl wrapper, a process-group kill per run and an after-baseline).
- Warm (run2/run3, identical mutants re-run): test-level mutants 0.09-0.13 s, type-check kills stay ~0.6 s because failed checks are not cached. Quote the cold figure for new mutants.
- Run1 surfaced a real mismatch the prototype could not: **M6 and M7 were `invalid-snippet` (`old occurs 2 times`)** because `payment-method-limits.ts` gained `loadPaymentMethodType` (cbe980ebb, after the prototype) with identical `if (!data) {` / `if (error) {` lines. The tool refused to mutate rather than guessing; I re-anchored the two snippets to the first function (`loadPaymentMethodLimits`) with surrounding context and both are `killed-typecheck` as in the prototype. Old mutants.json files must be re-validated with `--dry-run` before reuse.
- Survivors M2 and M5 still show the same two test gaps as the prototype on the original function. The new `loadPaymentMethodType` tests do not change that (M5 removes the `is_active` filter from `loadPaymentMethodLimits`; test MPT3 pins its absence only for the new loader).
- The kills are attributed: `expect_failing_test` matched on M3, M8, M9, M10 and run4 exited 0.

## Review findings (all fixed in b1266b568 unless noted)

HIGH
- `classify` (old `gsd-mutate.ts:105-114`): any non-zero exit not containing "Type checking failed" was **killed**. A parse error (`error: The module's source code could not be parsed`) and an unresolved import were counted as kills; so were OOM/signal deaths, a missing `deno`, and permission failures that print no summary. Reproduced on deno 2.5.2. Now: `killed` needs Deno's own `N failed` summary (N > 0); rejected module graphs (type, parse, import) are `killed-typecheck`; anything else non-zero is `errored` (not a kill).
- Timeout (old `:243`) SIGKILLed only the `deno` pid; processes a test spawned outlived the run. Now `deno test` runs in its own process group (`perl setpgrp`) and the whole group is killed on timeout, signal, and after every run. Test: a mutant spawns `sleep`, timeout, `pgrep` finds none.
- No SIGINT/SIGTERM/SIGHUP handling: Deno's default signal death skips `finally`, so the restore (old `:329-331`) would not run and the source stays mutated (traced from Deno's signal default; I did not execute the old build). Now the active mutation is restored (sha-checked) and live test groups killed on all three signals, exit 130/143/129. Tests send real SIGINT/SIGTERM to a subprocess mid-mutation.

MED
- Exit 0 with zero passing tests (all `ignore: true`) classified `survived` (old `classify`). Now needs `N passed` with N > 0; the baseline then aborts.
- Uncaught exception exited 1 = the canary-mismatch code (old `main` rethrow); a restore I/O failure (read-only file) crashed instead of exit 3. Now: `RestoreError` wraps I/O failures, run stops, JSONL record `restore-failed`, exit 3; any other exception exits 4.
- Invalid or `errored` mutants exited 0 (incomplete evidence passes silently). Now exit 1 (also for `--dry-run`).
- No detection of a concurrent edit during the run (verdict kept, and restore overwrote it). Now the post-run file sha is compared to the mutated sha; mismatch is `errored`, verdict void.
- Baseline checked only before; a flaky or drifting test could manufacture kills. Baseline re-run after the last mutant; red fails the run (exit 1).
- Evidence lacked exit code, mutated sha, counts and failing test names, so a kill by an unrelated failing test was invisible (RESULT S4 asks for these). Added `exit_code`, `mutated_sha`, `tests_passed`, `tests_failed`, `failing_tests`, and `expect_failing_test` (canary on the intended test).
- `deno test` ran with no permission/env flags, so money-path tests (`deno task test` uses `--allow-all`, `USE_MOCK_REDIS`) could not be baselined. Added `--test-flag` / `--test-env` (`--no-check`, `--no-run`, `--filter`, `--ignore` refused).

LOW (fixed)
- Overlapping occurrences (`aa` in `aaa`) passed the uniqueness check; `old == new` no-op mutants accepted; untracked target not treated as dirty; symlink out of the root and non-UTF-8/BOM files followed; `file` could be a non-source file; `apps//x`, backslash paths accepted; original bytes not kept anywhere (now `<out>.restore/` until restored, for SIGKILL of the runner); `gsd-mutate.ts` 495 lines, now split into `classify.ts` (233), `process.ts` (192), `gsd-mutate.ts` (464).

Not fixed (LOW, noted)
- The tool does not refuse to run in the primary worktree; `.claude/rules/testing.md` requires a throwaway worktree. Enforcement is by convention (README says so).
- If a test daemonizes out of the process group (`setsid`), it survives the kill. Deno 2.5.2 does not hang on its inherited pipe (checked), so the run still completes.
- `first_failing_line` is the first `error:`/`[ERROR]` line and can be console noise; use `failing_tests` for attribution.

## Test coverage of the tool

19 tests became 38 (all green, ~25-40 s): classification of survived/killed/typecheck/errored/timeout including noisy-output and no-summary cases; syntax-error and load-time-throw mutants end to end; zero-passing baseline; `expect_failing_test` pass/fail; exit 4; untracked/dirty/symlink/non-UTF-8 guards; tamper void; post-run baseline red; `restore-failed` with backup kept (stubbed restore) and a real read-only restore failure (exit 3, stops after the first mutant); process-tree kill; SIGINT and SIGTERM mid-mutation; flag/env validation. Mutation spot-checks on the tool itself: reverting the parse-error classification fails 3 tests; neutralising the group kill fails 23 (the timeout, signal and baseline tests).

# Round 2 - independent review (commit 34ded7656, on top of b1266b568)

Fresh reviewer, no part in writing the code. Tests 38 -> 60 (all green, ~35 s). Files stay <= 500 lines: `gsd-mutate.test.ts` (824) was split into `gsd-mutate.test.ts` (413, registers the other two), `classify_cases.ts` (415), `safety_cases.ts` (345), `test-helpers.ts`, `signal-fixture.ts`; new `options.ts` and `worktree.ts` keep `gsd-mutate.ts` at 432. Line refs below are at b1266b568. "Reproduced" = I ran it; "traced" = read from code, not executed.

## Findings

| # | sev | finding (file:line at b1266b568) | evidence | fix |
|---|---|---|---|---|
| 1 | MED | Signal handler raced the main flow (`process.ts:168-184`, `gsd-mutate.ts:337-349`): after the group kill the runner resumed, could start the NEXT mutant, and the handler's restore snapshot could run concurrently with an in-flight `Deno.writeFile(mutated)` (write may land after the restore: source left mutated); a test group spawned after the handler's snapshot was never killed; main could `Deno.exit(2/4)` before the handler's 130. | traced; window is milliseconds, not reproduced | `stopping` flag: no new mutation or test run starts, the main flow parks; mutation `apply` is tracked and awaited by the handler before restoring; live-kill also targets the leader; backup removed after a verified signal restore. Fixture-driven tests (`signal-fixture.ts`, real SIGINT/SIGTERM) mutation-checked: dropping the guards or the wait fails them. |
| 2 | MED | `parseArgs` ignored unknown flags (`gsd-mutate.ts:249-254`): `--dryrun` ran a REAL mutation; `--test-flag --allow-all` (space form) became `test-flag: ""` and dropped `--allow-all`. | reproduced with parseArgs probe | unknown args and empty `--test-flag` abort exit 2 (`options.ts`) |
| 3 | MED | Deno summary taken from the FIRST matching line (`classify.ts:64-65,118`): a test printing `ok \| 9 passed \| 0 failed` hid the real `1 passed \| 2 failed`; verdict became errored instead of killed. | reproduced on deno 2.5.2 output | last match wins (summary and FAILURES section) |
| 4 | MED | gitignored target treated as clean (`gsd-mutate.ts:68`, no `--ignored`): README promised untracked targets abort; an ignored file has no git recovery. | test fails without the flag | `git status --porcelain --ignored` |
| 5 | LOW | Mutant `id` used raw in the backup path (`gsd-mutate.ts:168`): `a/b` crashed exit 4; `../x` wrote and deleted outside `<out>.restore/`. | mutation-checked test | id sanitised |
| 6 | LOW | Timeout before perl ran `setpgrp` made `kill -- -pgid` a no-op (`process.ts:116-119`); a hung test was never killed and `child.output()` waited forever. | test with `timeoutMs=0` hangs 60 s without the fix | `killLive` also targets the leader (pid reuse excluded from the post-run sweep) |
| 7 | LOW | perl `exec` failure exits 0 (`process.ts:102`), so a missing `deno` recorded `exit_code: 0` (classify still said errored). | reproduced `perl -e 'exec "nonexistent"'` -> 0 | `exec @ARGV; exit 127`, tested |
| 8 | LOW | `--timeout 1e10` / `Infinity` accepted (`gsd-mutate.ts:259`); Deno clamps huge timers (unverified here), so every run would time out at once. | unverified, bound is harmless | bound (0, 2147483] s |
| 9 | LOW | `--test-flag` accepted bare paths and `--` (`process.ts:80-85`): extra test files could add or hide kills. | traced | only `-`-prefixed flags, `--` refused |
| 10 | LOW | `expect` could not express `killed-typecheck` (`classify.ts:17`; pilot M4/M6/M7 are such); `expect: survived` + `expect_failing_test` accepted though contradictory (`classify.ts:177-185`). | traced | `killed-typecheck` added; contradiction rejected at parse |
| 11 | LOW | README vs behaviour: "invalid-snippet: equals new" (it is exit 2 at parse, `classify.ts:176`); "backup kept until restore succeeds" (signal path left it); timeout exit code, `--out` truncation, deno.lock side effects undocumented. | traced | README rewritten |
| 12 | LOW (tests) | `gsd-mutate.test.ts` 824 lines; SIGHUP (exit 129) untested; post-run-baseline test asserted only exit 1 (not that the mutant itself survived); `renderMarkdown`, `flagError`, `killed` vs `killed-typecheck` canary, step-failure output, multi-mutant sequencing, post-run orphan sweep untested. | read | split + 21 new cases; each new guard mutation-checked (killed: primary check, unknown-flag push, `--ignored`, id sanitise, last-match, exec 127, leader kill, both parked guards, apply wait, stopping flag, orphan sweep) |
| 13a | LOW (known) | Primary worktree not refused. | | refused unless linked worktree or repo under the OS temp dir or /tmp, or `--allow-primary`; `--dry-run` exempt; tests for refuse, allow, linked worktree, dry-run |
| 13b | LOW (known) | Test that daemonizes out of the group. | reproduced: `setsid` daemon holding the stdout pipe, run returns in 0.27 s, daemon survives | documented as a limitation (README Safety); test pins "does not hang or fail the run" |

Not fixed, documented: a flaky test can yield a `killed` (use `expect_failing_test`); a LONE lookalike `FAILED` line from a test that then crashes the runner before Deno prints its own summary is still read as a kill (needs a crash AND a lookalike); a `timeout` alone exits 0; `setsid`/double-fork escapes survive; `deno test` may rewrite `deno.lock`. `ps`-environment tracking of daemons was tried and rejected: macOS `ps eww` showed no environment for same-user processes.

## Sign-off

Sign off for T0 evidence with conditions: run in a linked worktree, pin proof mutants with `expect_failing_test`, treat `timeout`/`errored` rows as unproven, and cite the JSONL. No open false-kill path that needs an adversarial test, and no path that leaves the source mutated except SIGKILL of the runner (backup in `<out>.restore/`, `git checkout` recovers).
