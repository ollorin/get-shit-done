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
