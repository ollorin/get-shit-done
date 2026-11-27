# Mutation testing

`scripts/mutate/mutate.mjs` is a scripted mutate-run-restore tool, with no model per mutant. It applies each mutant's `old -> new` snippet to one file in place, runs the project's test command for that mutant's test file, restores the original bytes and checks the restored sha256. A mutant that no test fails on is a survivor: the test suite does not prove that line.

It edits the target in place, so it runs only in a linked worktree (`git worktree add .tmp/wt-<name> HEAD`) or a temp copy. The primary worktree of a repo is refused unless `--allow-primary`; `--dry-run` never edits and is always allowed.

```bash
node scripts/mutate/mutate.mjs --mutants .tmp/m.json --root .tmp/wt-<name>
```

## Profile and flags

The test commands come from `stack.mutation.runners[]` of `.planning/config.json` (read from the current directory; an unreadable or non-JSON config, or a config with no runners, is a failure, exit 2): the only path, there is no `--test-cmd` and no `stack.commands.test_file` fallback. Each runner is `{ id, test_cmd (with {file} and {name}), build_error_pattern, pass_pattern, selftest, lane? }`, and every field except `lane` is required. `{file}` is replaced by the mutant's test file. The command runs through `sh -c` from `--root`, in its own process group. The old key `stack.mutation.error_pattern` is refused (exit 2). A mutant names its runner in `runner` (optional with one runner), and an unknown id is refused (exit 2). A runner `test_cmd` must contain `{name}`, outside double quotes, after its own `-t` (and its own bail flag): `{name}` becomes the shell-quoted, regex-escaped, anchored `expect_failing_test` (at most 4096 characters, no NUL; a longer or NUL title is refused at load, exit 2), or a match-everything regex for the baseline and self-test. A kill counts only when the first `FAIL` line of the output ends in ` > <title>` (the echoed command line never counts); a filtered pass needs a passed-test count under `pass_pattern`; anything else, the confirmation run included, is `errored` ("filter matched no test"), never killed or survived. A failing run whose output matches the build error pattern stops the run after the restore and exits 5: a crash is never a kill, and no verdict of that run counts.

Flags: `--mutants <json>` (required), `--root <dir>` (default: the current directory), `--out <jsonl>`, `--timeout <s>` (default 120, max 2147483), `--test-env KEY=VALUE` (repeatable), `--dry-run`, `--allow-dirty`, `--allow-primary`. Unknown flags and stray positionals abort with exit 2, so a typo such as `--dryrun` cannot start a real mutation.

Exit: 0 ok; 1 canary mismatch, inconclusive mutant (`invalid-snippet`, `errored` or `timeout`), or the unmutated test went red after the run; 2 aborted before mutating (bad input or flags, a target outside `--root`, the primary worktree, a leftover `<out>.restore/`, a dirty, untracked or ignored target, a red baseline); 3 restore failed; 4 internal error; 5 the build error pattern matched a run's output. `--dry-run` exits 1 on an invalid snippet.

## Mutants file

A JSON array of objects:

| Field | Meaning |
|---|---|
| `id` | unique, non-empty |
| `file` | the file to mutate, a repository-relative path (no absolute path, no `..`, no backslash) |
| `old`, `new` | `old` must occur exactly once in `file` (overlaps counted) and differ from `new` |
| `test` | the test file the command runs for this mutant, a readable file |
| `expect` | optional, `killed` or `survived`: makes the mutant a canary, and the outcome must equal it |
| `expect_failing_test` | required, non-empty: the name of the test that must fail (the filter of WP10 and the misattribution check key on it) |
| `runner` | optional, the id of a `stack.mutation.runners[]` entry; required when several runners exist |

A runner entry carries `pass_pattern` (a regex whose first group is the passed-test count: a baseline whose output shows no count is red), `selftest` (`dir`, `ext`, `pass`, `kill`, `build` file contents) and optionally `lane` (`unit` or `db`; a `db` runner needs `STACK_LOCK_HELD=1`, set by `scripts/stack-lock.sh`, else exit 2). The run first proves the harness: the pass file must classify `survived`, the kill file `killed` and name itself in the output, the build file `errored` through the build pattern; any mismatch is exit 2 ("harness fault") and `<out>.run.json` records `self_test`. Three consecutive rows whose outcome is `errored` or `timeout` stop the run with exit 5 and `harness_fault: true` (`harnessFault` in `classify.mjs`). `--dry-run` skips it. The engine catalogue `references/mutation-runners.json` holds only a known engine's runner defaults and captured output fixtures; the project writes its own `selftest` files.

## Outcomes

| Outcome | Meaning |
|---|---|
| `killed` | the test command exited non-zero (and its output did not match the error pattern) |
| `survived` | the test command exited 0 |
| `timeout` | exceeded `--timeout`; the whole process group was killed; inconclusive (exit 1) |
| `errored` | the command did not run (exit 126 or 127, a signal, no `sh`), the output matched the error pattern, the source or test file changed during the run, or a kill did not reproduce |
| `invalid-snippet` | `old` absent or not unique, the target unreadable, a symlink out of the root or not UTF-8, or the test not a readable file |
| `restore-failed` | restore or its sha check failed; the run stops, exit 3 |

Only `killed` counts as a kill, and a kill is run twice: the second run must also fail, so a flaky test cannot manufacture a kill. A mutant that does not build is `errored` through the runner's `build_error_pattern`, never a kill.

## Evidence

One JSONL line per mutant: `outcome`, `exit_code`, `duration_ms`, `first_failing_line` (never set on a survivor), `source_sha_before`, `mutated_sha`, `source_sha_after`, `test_sha`, `kill_confirmed` (`null` unless the run was a kill), plus `expect` and `detail`. `--out` (and a stale `<out>.run.json`) is cleared once the guards pass, before the baseline; it may not be the mutants file, a target or a test file. A run that finishes writes `<out>.run.json` (`exit_code`, `mutants`, `baseline_before`, `baseline_after`); no `<out>.run.json` means the run was cut short and its JSONL is not citable, and `baseline_after: "red"` or a non-zero `exit_code` voids its verdicts. Commit both files with the claim that cites them.

## Safety

- Each distinct test file runs unmutated first and again after the last mutant; red either time aborts or fails the run.
- The target is restored in `finally` and on SIGINT, SIGTERM and SIGHUP: the handler stops the runner, kills live test groups, waits for an in-flight mutation write, restores every still-mutated file (sha-checked) and exits 130, 143 or 129 (3 if a restore failed). Original bytes are also kept in `<out>.restore/` until the restore is verified; a run whose `<out>.restore/` is non-empty is refused (exit 2), so those bytes are never overwritten.
- A timeout, a signal or the end of a run SIGKILLs the test's whole process group.
- Limitation: a test that moves a process out of the group (`setsid`, a double fork) escapes the kill and survives the run. Do not mutate tests that daemonize.
- A target or test file that changed under a mutated run makes the verdict `errored`. Other files the test imports are not watched: use a linked worktree no one else edits.
- One run per worktree. Sequential only.
