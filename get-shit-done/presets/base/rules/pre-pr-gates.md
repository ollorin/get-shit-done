# Pre-PR gates

## The Rule

**Before opening ANY PR or claiming work is complete, run the local pre-PR gate:**

```bash
{{stack.commands.pre_pr_gate}}
```

This single script mirrors the project's pull-request validation workflow. It:

- Runs stage 1 ONCE: the type check (`stack.commands.typecheck`) and lint (`stack.commands.lint`). Static analysis cannot flake, so a second identical run adds only wall time. Red here stops the gate before the test stage.
- Runs stage 2, the flake-sensitive test suite (`stack.commands.test_all`), TWICE; run 2 starts only after run 1 passed. A pass followed by a fail is recorded as one append-only JSONL line in `.planning/pre-pr-disagreements.jsonl` (stage, run outcomes, best-effort failing tests). That file is the evidence base for any future decision to relax the double run to run-once-plus-retry. Do not drop the double run without it.
- Runs stage 3 ONCE: each `stack.gates[].run`, in profile order. The script does not run these twice and does not reset a local stack between runs; a project that needs a doubled integration or UI suite makes it part of `stack.commands.test_all`. A command key that is unset, or a `stack.gates` entry without a non-empty `id` and `run`, prints `NOT CONFIGURED` and fails the gate before anything runs.
- Writes the pre-PR marker in the git directory of the worktree that unblocks `git push`. It is written ONLY when every stage is green, including both `test_all` runs.

The "before claiming done" checklist (check, lint, format, style gate, type check) lives in the project's CLAUDE.md under "Before Creating a PR".

### Test cost: where the gate runs (phases and plans)

The PR-time requirement above is unchanged. Earlier in a phase, cost is bounded:

1. **Inside a plan and in fix loops:** run only the affected test files (`stack.commands.test_file`, with the `{file}` placeholder) plus the single suite that contains them (`stack.commands.test_bucket`), once. No full pre-PR gate inside a plan.
2. **One full pre-PR gate per phase**, on the final phase tree, before the Sonnet pre-verification. After fixing its findings, rerun only what the fixes touch.
3. **"Tests green twice" over all suites runs once, at phase end or before the PR**, not per plan.
4. **Cheap gates run on their own, early:** `stack.commands.coverage_gate` for touched code, the type check, lint, formatting and the style gate. The phase-final full run stays mandatory: it catches cross-module breakage (a formatting rule against a pinned test, a contract change against another plan's test).

Why: each full gate run holds the shared stack lock for a long time. Five full runs in one phase starved a parallel phase for about an hour.

### Coverage ratchet: the floor moves only up, and only in a PR

- The coverage baseline file is git-tracked and records each domain's last-measured line coverage. The gate (`stack.commands.coverage_gate`) fails any change that drops a domain below its recorded floor. It never runs with write access.
- To **raise** the floor after a real improvement, run `stack.commands.coverage_update`. It ratchets the baseline up only. **Review the diff** and commit the updated baseline **in the same PR** as the change that earned it.
- Never hand-edit a value downward. If real coverage regresses, fix the regression; do not lower the floor.
- The floor is never updated by a CI bot on the main branch. Such a bot needs a write token, couples coverage bookkeeping to deploys, and can lock in a fluke-high measurement.
- **Deleting redundant tests is allowed** when the floor still holds, or when the uncovered lines are a pure barrel (only re-export statements). Until a reviewed exclusion list exists, deleting a test must not drop a domain below its baseline.

Run coverage locally with the profile keys above: `stack.commands.test_all` (unit tests and coverage collection), `stack.commands.coverage_gate` (floor check only), `stack.commands.coverage_update` (ratchet up only, review the diff), and the coverage report command.

## Enforcement

- There is NO "open PR anyway" escape hatch.
- There is NO "I'll fix it after the PR" path.
- Claiming "tests pass" without actually running them is never acceptable.
- Each gate must produce visible output proving it ran and passed.
- The `git push` hook blocks unless the pre-PR marker exists in the git directory and is less than 30 minutes old.

## Advisory check

`node scripts/validation/freshness-tracker.mjs --map '<doc glob>=<code glob>,...'` lists documentation older than the code it describes. It is warn-only (exit 0 always), so it is not in `stack.gates[]`; run it before a docs-heavy change and update the stale pages it names.
