# Pre-PR gates

## The Rule

**Before opening ANY PR or claiming work is complete, run the local pre-PR gate:**

```bash
{{stack.commands.pre_pr_gate}}
```

This single script mirrors the project's pull-request validation workflow. It:

- Runs stage 1 ONCE: the type check (`stack.commands.typecheck`) and lint (`stack.commands.lint`). Static analysis cannot flake, so a second identical run adds only wall time. Red here stops the gate before the test stage.
- Runs stage 2, the test suite (`stack.commands.test_all`), ONCE. Red here stops the gate before stage 3. `.planning/pre-pr-disagreements.jsonl` is history from the earlier double run; nothing writes it any more.
- Keeps the full output of every check in `.tmp/pre-pr-gate/<check id>.log` (cleared at the start of each run, ignored by git); read the failing lines there, not the console tail.
- Runs stage 3 ONCE: each `stack.gates[].run`, in profile order. The script does not reset a local stack between runs; a project that needs a doubled integration or UI suite makes it part of `stack.commands.test_all`. A command key that is unset, or a `stack.gates` entry without a non-empty `id` and `run`, prints `NOT CONFIGURED` and fails the gate before anything runs. An explicit `none` or `null` for `typecheck`, `lint` or `test_all` (no code yet) is skipped with a `WARNING ... not configured yet` line and the final line reads `PASSED, BUT NOT CONFIGURED (skipped): ...`.
- Writes the pre-PR marker in the git directory of the worktree that unblocks `git push`. It is written ONLY when every stage is green.

The "before claiming done" checklist (check, lint, format, style gate, type check) lives in the project's CLAUDE.md under "Before Creating a PR".

### Test cost: where the gate runs (phases and plans)

The PR-time requirement above is unchanged. Earlier in a phase, cost is bounded:

1. **Inside a plan and in fix loops:** run only the affected test files (`stack.commands.test_file`, with the `{file}` placeholder), once. No full pre-PR gate inside a plan.
2. **One full pre-PR gate per phase**, on the final phase tree, before the final phase review. After fixing its findings, rerun only what the fixes touch.
3. **The one green full gate per phase is also the PR gate**: all suites run once, at phase end or before the PR, not per plan.
4. **Cheap gates run on their own, early:** the type check, lint, formatting and the style gate. The phase-final full run stays mandatory: it catches cross-module breakage (a formatting rule against a pinned test, a contract change against another plan's test).

Why: each full gate run holds the shared stack lock for a long time. Five full runs in one phase starved a parallel phase for about an hour.

## Enforcement

- There is NO "open PR anyway" escape hatch.
- There is NO "I'll fix it after the PR" path.
- Claiming "tests pass" without actually running them is never acceptable.
- Each gate must produce visible output proving it ran and passed.
- The `git push` hook blocks unless the pre-PR marker exists in the git directory and is less than 30 minutes old.

## Advisory check

`node scripts/validation/freshness-tracker.mjs --map '<doc glob>=<code glob>,...'` lists documentation older than the code it describes. It is warn-only (exit 0 always), so it is not in `stack.gates[]`; run it before a docs-heavy change and update the stale pages it names.
