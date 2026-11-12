# M-04 summary: interview steps, /gsd:init-project, legacy pass-through, pointer blocks (4.1-4.5)

Branch `exp/agnostic`, worktree `~/get-shit-done-agnostic`. Executor: Haiku 5.5. Review rounds: not run (pending coordinator dispatch; plan asks one Sonnet round for these prompt files).

## Commits

| Task | Commit | Files | New tests |
|---|---|---|---|
| 4.1 brief step | 5e81180 (text), c8a9ef7 (tests) | new-project.md (workflow, command) | 4 |
| 4.2 stack step, Style section | 3180b5a | new-project.md, stack-profile.md template, project-context.test.js | 7 |
| 4.3 init-project, --legacy, callers | 5385e9f | init-project.md (new), plan-phase, execute-phase, execute-plan, complete-milestone, executor-detail, planner-detail, planning-config, execute-roadmap, project-context.test.js | 3 (computed caller list) |
| 4.4 pointer, first 11 agents | 3a18948 | 11 agents, prompt-budgets.json | 0 (covered by 4.5) |
| 4.5 pointer, remaining 11 + pack agent | b1e0133 | 11 agents, pack agent, project-context.test.js | 3 |

Targeted runs (`NODE_PATH=$HOME/get-shit-done/node_modules node --test`): project-context.test.js 72 pass / 0 fail; project-profile.test.js 37 / 0; tests/phase-37 prd-trace and wave-context 17 / 0; gsd-tools.test.js name-filtered subset (plan-phase, execute-phase, new-project, agent, ...) 119 / 0; prompt-budget.test.js and the `checkAllBudgets` wiring tests 27 / 0. Full `npm test` not run (coordinator runs it once per plan).

Lint: `node scripts/agnostic-lint.js check` ok (613 denied, 364 allowed) after 4.4. No `--allow-raise`, no `write-baseline` by this plan. No lint term in any added line.

Gates: `init plan-phase|execute-phase` stop line present in all seven callers; `${GSD_LEGACY:+` absent; `sync-project.md` absent; `agents/v2` unchecked.

## Deviations

1. Concurrent lanes in the same worktree (M-06 and an M-05-like owner sweep) had uncommitted hunks in plan-phase.md, execute-phase.md, planner-detail.md (4.3) and gsd-demo.md (4.4). I staged only my hunks by writing a HEAD-based blob with the same edit and `git update-index --cacheinfo`; their hunks stayed unstaged and were not committed by me. Working tree still holds their edits.
2. 4.3: `project-context.test.js` had a foreign uncommitted block at the moment of `git add`; I restaged the file without it before committing. The foreign block is now committed by its own lane.
3. 4.1 tests land in c8a9ef7, one commit after the text (5e81180): the shared test file was held by another lane when 4.1 was committed.
4. 4.2: the step is numbered 5.6 and placed after 5.5 (the plan said before 5.5). Numbering stays monotonic.
5. 4.4: `gsd-executor` budget 6700 to 6790 (+90, the block's measured size; HEAD 6696, now 6786). Done in 4.4, not 4.5, so the wiring test passes at every commit. The `_comment` in prompt-budgets.json still describes the earlier raise; not edited.
6. Existing `<project_context>` tags: `gsd-phase-researcher.md` (body, now line ~50) and `gsd-plan-checker.md` (two occurrences) already carry a `<project_context>` element. The pointer block coexists with them; the plan's block text is kept byte-identical. Coordinator may want a different tag name for those two files.
7. M-09 is not on `exp/agnostic`: its work sits in `.tmp/wt-m09` (branch `exp/agnostic-m09`). `presets/base/scripts/style-gate/rule-sets/` does not exist yet, so the 5.6 text names rule sets that are not on disk until M-09 merges. The text test only checks the names.
8. 4.3: `init-project.md` has no `argument-hint` (no arguments). Frontmatter otherwise as new-project.md.
9. The `risk_domains_source` wording in 4.1 relies on M-06 (dcaf92f on this branch); present now.

## Self-Check: PASSED

- Commits 5e81180, c8a9ef7, 3180b5a, 5385e9f, 3a18948, b1e0133 exist on `exp/agnostic` (`git log`).
- `commands/gsd/init-project.md`, `.planning/agnostic/M/M-04-SUMMARY.md` present.
- Nothing pushed; no `install:gsd`; no file outside the worktree written; `.audit/` untouched.
