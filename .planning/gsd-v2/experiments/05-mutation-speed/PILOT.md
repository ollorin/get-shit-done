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

# Round 3 - independent review (on top of 34ded7656)

Fresh reviewer, no part in writing the code. Tests 60 -> 79 (all green, ~36 s). Files <= 500 lines: new `guards.ts` (run-level guards moved out of `gsd-mutate.ts`, now 447), new `parse_cases.ts` and `run_cases.ts` (round-3 tests; `classify_cases.ts` 444, `gsd-mutate.test.ts` 426). "Reproduced" = I ran it on deno 2.5.2; "traced" = read from code.

## Residual risks judged

| round-2 residual | verdict |
|---|---|
| `timeout` alone exits 0 | FIXED (#1): exit 0 on an unproven mutant undermines evidence |
| lone lookalike `FAILED` line then a crash | FIXED to "needs a crash AND the lookalike as the very last stdout bytes" (#2); remaining case accepted: only deliberate adversarial test code can produce it |
| flaky test yields `killed` | FIXED (#3): a kill must reproduce on a second run |
| `setsid` daemon survives, runner SIGKILL leaves the mutation, `deno.lock` rewrite | accepted (documented; SIGKILL leaves a modified target, so the next run's dirty check refuses it, and `<out>.restore/` holds the bytes) |

## Findings

| # | sev | finding | evidence | fix |
|---|---|---|---|---|
| 1 | MED | `timeout` was not inconclusive: a run of only timed-out mutants exited 0 (`inconclusive()` omitted it) | traced; old tests pinned `code 0` | `timeout` joins `invalid-snippet`/`errored` (exit 1) |
| 2 | MED | Summary read from `stdout + stderr` and the last match anywhere; a lookalike line followed by a crash, or on stderr, could decide the verdict | traced (reproduced that Deno captures test stdout/stderr, even from inherited subprocess fds, into stdout, so a stderr lookalike is hard to produce) | summary from stdout only and only when nothing follows it; `TestRun.stdout` added |
| 3 | MED | A flaky test red on one run produced `killed` (baseline runs only before/after the whole batch) | traced | a `killed` is re-run in the same mutation; must be a kill failing a common test (`killReproduced`) else `errored`, `kill_confirmed: false` |
| 4 | MED | Only the target was tamper-checked: a mutant (or a concurrent agent) rewriting the TEST file produced a `killed` from a changed test; the record carried no test hash | traced; the old "post-run baseline" test relied on exactly this (mutant rewrote the test) and still asserted `survived` | `test_sha` recorded, verdict `errored` if the test file changed during the run; a test path must be a readable source file (dir/glob refused) |
| 5 | MED | JSONL from a voided run (post-run baseline red, restore failed) looked citable; nothing in the evidence said so | traced | `<out>.run.json` {exit_code, mutants, baseline_before, baseline_after}; absent = cut short; `--out` and the stale summary cleared once guards pass (before: only after baseline, so a red-baseline abort left the previous run's JSONL in place) |
| 6 | LOW | `--out` could be the mutants file, a target or a test file and was truncated (erasing source) | traced | refused, exit 2 |
| 7 | LOW (tests) | untested: mutants-file missing/invalid/empty/non-array, non-git root, `--mutants` required, `exit 0` with a failed count, empty id/old, backup removal on success, survivor `first_failing_line` null, stale summary removal | mutation spot-checks (below) showed survivors only for stale-summary removal (now tested) | cases added |
| 8 | LOW | README: timeout exit code, `--out` truncation timing, concurrent runs, watched files | read | rewritten |

Spot-check method: scratch copy under the OS temp dir, one guard reverted per copy, `--filter`ed run. Killed by a test: anchoring, stdout-only wiring (2 sites), timeout-inconclusive, `killReproduced`, confirm run, flaky-void, test-tamper, source-tamper, backup removal, truncation, stale `run.json`, `failed === 0`, `passed > 0`, test source path, empty old, restore-failed break, `--ignored`, id sanitising, post-run baseline, survivor line, timeout bound, `isUnder`, canary clause 2, `notFlag`, symlink guard, dirty detection, classify order, `--out` guard. One survivor found and fixed: removing the stale `run.json` deletion (no test); a first attempt at the post-run-baseline mutation did not compile and was redone.

## Sign-off

Sign off for T0 evidence with the round-2 conditions plus: cite `<out>.jsonl` together with `<out>.run.json` (exit_code 0, both baselines green); kills cost two runs. Not covered: files other than target and test that the test imports are not watched (use a linked worktree no one else edits); `--allow-dirty` with two concurrent runs.

# Opus final review (on top of 09e078ba1, fixes in af9633bc1)

Question: can a documented run report a false `killed`/passing run, or leave source mutated silently? Traced: `classify` (classify.ts:149-168, summary anchored last-on-stdout :123-143), kill confirmation (gsd-mutate.ts runMutant, `killReproduced` classify.ts:254), source/test sha voiding, baselines (guards.ts `baselineError`), restore + sha check (process.ts:28-52), signal path (process.ts:183-245: `stopping` checked synchronously before apply, handler awaits in-flight apply then restores), guards (primary worktree, dirty, `--out`, forbidden flags). No CRIT/HIGH: every false-kill path needs adversarial test code or a flaky test; every source-left-mutated path except runner SIGKILL ends in exit 3 or is restored.

| # | sev | finding | fix |
|---|---|---|---|
| 1 | MED | `expect_failing_test` was matched against the FIRST run's failing tests, while confirmation needed only ANY common test: pinned test failing once + an unrelated test failing twice passed the pin | fixed: on a confirmed kill `failing_tests` = tests failing in both runs; test reproduced red (pin passed, exit 0) then green |
| 2 | MED | A leftover `<out>.restore/` (SIGKILL / failed restore) was reused: rerun with the same `--out` + `--allow-dirty` overwrote the only original-bytes backup with the still-mutated file, then "restored" to it, silently | fixed: non-empty `<out>.restore/` refused, exit 2 (with or without `--allow-dirty`); test red then green |
| 3 | MED (accepted, condition) | A flaky test can still yield `killed`: green before, red twice mutated, green after (p=0.3 flake: ~9% per survivor) | condition of use below |
| 4 | LOW (accepted) | `killed-typecheck` is single-run and REJECTED includes resolution errors (`Could not resolve`, `Unable to load`) that can be environmental, so a survivor can hide as `killed-typecheck` in an exit-0 run | condition: `killed-typecheck` is neither a kill nor proof of no survivor |
| 5 | LOW (accepted) | `--allow-dirty` is not recorded in `<out>.run.json`; evidence against an uncommitted base looks the same | condition: never cite an `--allow-dirty` run |

Tests 79 -> 81, green (~37 s); check/lint/fmt clean; max file 461 lines.

## Verdict

APPROVED for T0 evidence, conditions: linked worktree, no `--allow-dirty`; cite `<out>.jsonl` with `<out>.run.json` showing `exit_code: 0` and both baselines green; proof mutants carry `expect_failing_test` naming the asserting test; only `killed` with `kill_confirmed: true` counts as a kill (`killed-typecheck`, `errored`, `timeout` prove nothing); the pinned test is deterministic (no shared clock/network/order dependence) or ran green N times unmutated first.
