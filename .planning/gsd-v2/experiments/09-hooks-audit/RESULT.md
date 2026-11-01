# 09 Hooks audit (2026-11-01)

Scope: every hook in `igaming-platform/.claude/settings.json`, `.claude/settings.local.json` (own `hooks` block) and `~/.claude/settings.json`, plus `.claude/hooks/*`. Nothing in any `settings*.json` was edited; `disableAllHooks` untouched. Fix commit: `076610d36` (igaming-platform, branch `feature/codebase-review-hardening`). Canary corpus + runner: `.claude/hooks/tests/run-canaries.sh` (174 canaries; old hooks fail 12, new hooks 0).

## Verdict

Can be flipped after the one remaining decision below (item R1 is the only one that changes daily agent behaviour). With the fixes, replayed over 9,000 real tool calls (6,000 Bash, 2,500 Write/Edit, 500 Read; 2,000 of them sampled 10-20..10-31, the rest 10-31..11-01 = live phases 401/402) the project hooks deny 498 Bash calls (8.3%) instead of 792; 494 of those are the grep/rg rule (R1).

## Probes (claude 2.1.304, haiku, sandbox `igaming-platform/.tmp/hook-probe/`)

| Question | Answer | Evidence |
|---|---|---|
| Does project `disableAllHooks` also disable user-level hooks? | YES | With it on, `touch .claude/hooks/x` succeeded (user hook gsd-protect-managed-files silent); with it off the same call was BLOCKED by `~/.claude/.../gsd-protect-managed-files.js`. |
| Do project and user hooks fire inside subagents? | YES | Logger saw `agent_id`+`agent_type: general-purpose`; protect hook blocked the subagent. Hooks that block test commands therefore also block haiku test runners. |
| Hook ordering / does the RTK rewrite bypass guards? | NO bypass | Hooks run in parallel and `updatedInput` is not chained: a rewriter changed `echo hello` to `echo REWRITTEN` (that is what ran) while two other hooks logged the ORIGINAL command. Guards always see the raw command; their `rtk ...` patterns only matter when an agent types `rtk` itself. |
| Same hook in settings.json and settings.local.json | deduped | Logged once. The local `hooks` block (8 of the 10 project hooks, missing check-test-command and check-git-merge-target) is redundant. |
| Does Bash grep/find prompt? (premise of redirect-recursive-search) | mostly NO | In the project (defaultMode auto, current allow rules) `grep -n x file`, `git grep`, `rtk grep`, `until grep -q ...` all ran with no permission denial. Only `find ... -exec` was denied by permission (also in a bare sandbox, where `rtk grep` was too). |

## Per-hook table

Latency = serial p50 of the script alone (25 runs). Replay columns: denials / of which false positive (FP) / wrong-reason (WR), before then after fix, over the 9,000-call corpus (`.tmp/hook-audit/corpus3.jsonl`, results `res3-*.jsonl`, not committed).

| Hook (registered where) | Intent | Verdict | p50 | Replay before | Replay after | Fix |
|---|---|---|---|---|---|---|
| check-supabase-command.sh (proj) | block bare `supabase start/stop` | works | 29 ms | 1 deny, 0 FP (bare `npx supabase start`, correct) | same | none. Gap: `/path/node_modules/.bin/supabase start` bypasses the anchor (seen once in corpus); left, see R5 |
| check-test-command.sh (proj, not in local) | delegation nudge + keep Charlotte suite off | CONFLICTS with CLAUDE.md (confirmed): old lines 79/82/88 blocked every `deno test`, `deno task test`, `nx test` | 42 ms | 292 deny, 289 FP (all `cd apps/api && deno task test <file>`, `deno test <file>`, `nx test`), 3 Charlotte | 3 deny, 0 FP | `076610d36`: only Charlotte suite tasks (`test:player/operator/e2e/scenario/regression/smoke/rg/tags`, bare `test` inside e2e-charlotte) and `deno task test:integration[:ci]` are blocked; commit/tag exemption now also matches chained `git add && git commit` |
| block-push-without-local-tests.sh (proj) | no push without fresh `.preflight-passed` (30 min) | works | 23 ms | 0 deny (1 push in corpus, allowed by cwd/repo rules) | same | none. State: `.preflight-passed` is dated Oct 30, so every `git push` in this repo is blocked until `scripts/preflight.sh` passes (intended) |
| check-api-contract-drift.sh (proj) | block `git commit` when frontend calls lack backend routes | works, slow | ~4.1 s per commit (deno cold) | not bulk-replayed (runs deno); `diff-registries.ts` exits 0 on the current tree; 159 commits in corpus | same | none. Gaps: matches only `^git commit` / `&& git commit` (`a; git commit`, `git -C x commit` skip it) |
| redirect-recursive-search.sh (proj) | force `zg query` instead of grep/rg/find that read disk | works for its stated rule; premise unverified (probe above); had a perf bug | 11 ms (was up to 19 s on 10 KB+ heredoc commands) | 499 deny (8.3%); 5 WR (grep word inside heredoc body / commit message) | 494 deny, 0 WR | `076610d36`: fast path, linear awk scan, heredoc bodies and quoted `git commit -m` text ignored, `find -exec` still checked on the whole command. Remaining 494: 348 plain grep/rg on files, 75 `git grep`, 55 `rtk (proxy) grep`, rest chained real greps; see R1 |
| check-git-merge-target.sh (proj) | ask for `gh pr merge` and merges into main | works | 19 ms | 0 ask (9 merge-ish commands, all non-main) | same | none |
| check-migration-concurrently / check-migration-drop / check-deno-json-imports / check-flake-patterns (proj) | block bad migration SQL, function deno.json `imports`, flake-prone integration tests | work | 16 to 26 ms (flake 14 ms) | 0 deny over 2,500 Write/Edit (52 migration, 236 integration-test edits, 0 function deno.json) | same | none; deny paths covered by canaries |
| rtk-rewrite.sh (user) | rewrite git/ls/deno/nx etc. to `rtk ...` | works | 31 ms | 1,073 of 6,000 rewritten (17.9%), 0 denials | same | none |
| gsd-protect-managed-files.js (user) | block agent writes to GSD-managed files, `.claude/settings*.json`, `.claude/hooks/**`, any Bash mentioning `disableAllHooks` that is not provably read-only | works, strict by design | 29 ms | 5 deny of 8,500 (all Bash: python or compound read of settings.local.json / `.claude/hooks`; 54/54 unit tests pass) | same | none. Consequence: after the flip no agent can edit hooks or settings, nor probe `disableAllHooks` with python |
| gsd-charlotte-lock.js (user) | refuse DB reset / `preflight.sh` / `test:regression` while a live Charlotte lock exists | works | 40 ms | 0 deny (no `.tmp/charlotte.lock` exists now; 54/54 unit tests; lock-live canaries pass) | same | none |
| doc-compression-hook.js (user, Read) | "compress" big GSD docs on Read | BROKEN / inert: fires and logs a 97% reduction, but emits legacy top-level `additionalContext`; the transcript shows `hook_success` and the model still received the full file via Read | 63 ms | 0 denies | same | not fixed on purpose: a correct delivery would ADD ~6k tokens on top of the full file. Recommend unregistering (R4). Its test file fails 2 of 3 from `~/.claude` (needs `bin/install.js`, absent in the install) |
| schedule-resume.js (user, PostToolUse + Stop `--scan`) | arm a launchd job to run `claude -p /gsd:resume-paused` after a quota pause | works; side-effect risk | 27 ms | no PAUSED.json exists under `.planning/phases`; one July test plist, none loaded now | same | none. Once a PAUSED.json exists, any Bash/Write/Edit mentioning it (even `cat`) or any Stop schedules a headless acceptEdits resume in the project root (R6) |
| session-end-standalone.js (user, Stop) | cleanup + bounded knowledge maintenance | works | 79 ms | n/a | n/a | none |
| gsd-check-update.js (user, SessionStart) | background update check | works (spawns detached child) | not timed | n/a | n/a | none |
| gsd-guard-bash.js, gsd-hook-lib.js (fork, unregistered drafts) | deny `--no-verify`, `deno --no-check`, stash/reset/clean/rebase in primary tree | drafts only, untouched | n/a | n/a | n/a | not finished. Direct run: denies `--no-verify`, `-n`, `--no-check`, `git stash`; allows `git -c core.hooksPath=/dev/null commit` |

`--no-verify` and `core.hooksPath=/dev/null`: no REGISTERED hook catches either (canaries `known-gap` document it). `settings.json` has no deny rule for them either.

## Hooks that will be active after the flip, and what each blocks (for phase coordinators)

Project (`.claude/settings.json`, Bash): check-supabase-command (bare `supabase start`/`stop` without `--exclude`/`--project-id`), check-test-command (Charlotte suite tasks, `deno task test:integration[:ci]`), block-push (git push without fresh preflight marker), check-api-contract-drift (git commit while contract drift exists; +4 s), redirect-recursive-search (grep/rg reading files, `find -exec`; use `zg query`), check-git-merge-target (asks on `gh pr merge` and `git merge` on main). Write/Edit: migration CONCURRENTLY / DROP TABLE without IF EXISTS / REVOKE after DROP FUNCTION / OR REPLACE VIEW with DROP COLUMN, function `deno.json` `imports`, flake-prone integration-test literals. User: rtk-rewrite (transparent), protect-managed-files (no edits to `.claude/hooks`, `.claude/settings*.json`, GSD-managed `~/.claude` files; no Bash mentioning `disableAllHooks`), charlotte-lock (no `supabase db reset`/`preflight.sh`/`test:regression` while a Charlotte lock is live), schedule-resume, session-end, check-update.

Must-allow shapes verified allowed by canaries (all rows pass): `cd apps/api && deno task test <file>` (with and without `2>&1`), `deno test <file>`, `timeout N deno test`, `npx nx test <project>`, `bash scripts/run-integration-tests.sh --bucket=...`, `deno run ... scripts/stack-lock.ts`, `scripts/stack-lock.sh --label x -- npx supabase start --exclude edge-runtime`, `git commit -m ... -- <paths>`, `git worktree add|remove`, `zg query`, plus real production Bash commands (one or two per leading command word) and 12 real Write/Edit calls. Still denied by design: any `grep`/`rg` on a file (including `git grep` and `rtk grep`), `until grep -q ... file` wait loops, bare `npx supabase start`, `git push` without a fresh marker, Charlotte `deno task test:scenario|test:regression|...`.

## Rollout risk for the live phases (401/402)

- Highest: R1. 8.3% of recent Bash calls are grep/rg/git grep/rtk grep; agents will be denied and must retype with `zg query`. Cheap per retry, but wait loops `until grep -q ... task.output` also fail (use `[ -s file ]`, `pgrep`, or Monitor).
- `git push` blocked until a preflight pass; coordinators must run `scripts/preflight.sh` first (matches CLAUDE.md).
- charlotte-lock: no lock exists now. A Charlotte subagent already running gets no lock until its next `mcp__charlotte__*` call (lock is taken on PreToolUse and SubagentStart); after that, `preflight.sh`, `supabase db reset` and `test:regression` are refused until the lock is released on SubagentStop or expires (30 min TTL, ignored when the holder pid is dead). A SubagentStart that happened before the flip is never recorded, so its Stop is a no-op.
- check-api-contract-drift adds ~4 s per commit and blocks if drift appears.
- protect-managed-files makes `.claude/hooks`, `.claude/settings*.json` read-only for agents: further hook fixes must be applied by the human (or before the flip).
- Unknown (not probed): whether already-running sessions pick up the settings change without restart. Treat new sessions as certain, running ones as possible.

## Exact flip procedure (human, not an agent)

1. `cd ~/igaming-platform && .claude/hooks/tests/run-canaries.sh` must print `canaries: pass=174 fail=0`.
2. Confirm no Charlotte run is live: `ls .tmp/charlotte.lock` (absent) and tell coordinators the list above.
3. `cp .claude/settings.local.json .tmp/settings.local.json.pre-flip`, then delete the line `"disableAllHooks": true,` (`settings.local.json:76`) in an editor (a sed from an agent session would be blocked after the flip and is forbidden now).
4. Smoke in a NEW session: `touch .claude/hooks/zz-probe` must answer `PROTECTED CLAUDE CONFIG - BLOCKED`; `cd apps/api && deno task test functions/games-crud/index.test.ts` must run; `grep -n foo README.md` must be denied with the `zg query` message.
5. Rollback: restore `"disableAllHooks": true` (or `cp .tmp/settings.local.json.pre-flip .claude/settings.local.json`). Restart or open new sessions; it applies to user-level hooks too.

## Rulings needed

- R1 redirect-recursive-search: keep (CLAUDE.md says grep always prompts, probe says it does not in this project) or narrow to `find -exec` plus whatever the classifier really prompts on? Also whether `until grep -q` wait loops and `git grep`/`rtk grep` are exempt.
- R2 Charlotte single-scenario runs (`deno task test:scenario ...`, 3 in the sample, via `stack-lock.sh`) are blocked as before: allow when wrapped by `stack-lock.sh`/`session-supervisor.sh`?
- R3 `deno task test:integration[:ci]` stays blocked (live stack without the lock) while direct `deno test x.integration.test.ts` is allowed (CLAUDE.md shape): accept?
- R4 Unregister doc-compression-hook (inert, user `~/.claude/settings.json`); also optionally drop the duplicate `hooks` block in `settings.local.json`.
- R5 Add `/path/.../supabase start` (path-prefixed binary) to check-supabase-command, and `a; git commit` / `git -C x commit` to check-api-contract-drift? Both are small anchors, deferred because they could newly block current operator flows.
- R6 schedule-resume: keep launchd auto-resume of paused phases in the shared tree, given it triggers on any mention of PAUSED.json?
- R7 Register an extended gsd-guard-bash (needs core.hooksPath handling) to cover `--no-verify`, `--no-check`, stash/reset/rebase.

## After fix batch (2026-11-01, RULING section C)

Nothing was flipped: the project flag, every real `settings*.json` and the real `~/.claude` are untouched. The installer was tested only against a temp config dir; `flip.sh` and `hooks-apply.sh` were run only in dry-run or against copies.

### Section C status

| C item | Status | Evidence |
|---|---|---|
| 1 hook patch A1-A3, A4/R2, A6-A8, R1, R3, R5 (A10-A14) | done (igaming `bb68dceb7`, review fixes in the next commit, see hand-back) | Bash hooks are now tokenised (`.claude/hooks/lib/ShellParse.pm`, Perl port of the `gsd-guard-bash.js` parser); wrappers `.claude/hooks/*.sh` call `lib/<hook>.pl`; all fail closed on unreadable input (`lib/run-perl.sh`, `lib/fail-closed.sh`) |
| 2 canaries moved, bypass + per-task rows, reason check, preflight wiring | done (`bb68dceb7`, preflight `7b71e906b`) | `scripts/validation/hook-canaries/`; 349 rows; every deny/ask row must carry a `reason` substring; mutant killed (below) |
| 3 re-replay | done | table below |
| 4 fork: stop registering check-update + doc-compression, A15/A16 in protect | done (fork `1fb2e26`, `7c0499d`) | `npm run install:gsd` against the REAL `~/.claude` is still the CEO's step before the flip |
| 5 `hooks-apply.sh`, `flip.sh` | done (`scripts/hooks-apply.sh` in `bb68dceb7`; `flip.sh` here) | dry-run on fixtures: unregisters 5 entries (check-update, rtk-rewrite, doc-compression, schedule-resume x2), drops flag + local hooks block, refuses on charlotte owner label / PAUSED.json, non-TTY apply refused |
| 6 CLAUDE.md grep line, RTK.md text | done (`7b71e906b`; RTK.md rewrite is inside `flip.sh --apply`) | |
| R7 gsd-guard-bash | committed, unregistered (fork `25c4168`) | adds `hooks-path` rule; 123 unit tests; canary rows use `fork:gsd-guard-bash.js` |

### Replay: same 9,000 calls (`corpus3.jsonl`; 6,000 Bash)

| Hook | Before (`076610d36`) | After | Notes |
|---|---|---|---|
| redirect-recursive-search | 494 deny | **130 deny** (target 103-138) | after: 66 recursive grep/rg, 55 `rtk grep` (lossy), 9 `rg` on a directory/without file. 104 of the old 494 stay denied; 26 are newly denied chained recursive greps the old first-pipe truncation hid (A7); 390 old denials are now allowed (named-file grep, `git grep`, wait loops, pipe-fed `rg`) |
| check-test-command | 3 deny | **2 deny**, 14 reminders | both denials are un-locked `deno task test:scenario` runs (400-43 triage); no stack-locked shape denied. 14 = direct `deno test *.integration.test.ts` without stack-lock (R3 reminder; ruling counted 14 of 33) |
| check-supabase-command | 1 deny | 2 deny | the stack-locked bare `npx supabase start` (401-review-fix-r2) and the path-prefixed `node_modules/.bin/supabase start` (R5) |
| block-push, check-git-merge-target | 0 | 0 | |
| 4 Write/Edit hooks | 0 over 2,500 | 0 | |

p50 latency 31-32 ms per Bash hook (Perl start included). A9: a 336 KB single-line command takes 0.26 s (was 9.2 s). Final replay (after the review fixes) covers all 9,000 calls with zero harness errors; numbers identical.

### Canaries

- New hooks: `canaries: pass=349 fail=0`. Prior hooks (`076610d36`) against the same corpus: `pass=209 fail=86`, so every section A bypass row fails first (RED) and passes after (GREEN). Rows that deliberately pass on the prior hook: per-task R2 rows and the lock-wrapped allow rows (they pin the behaviour).
- Mutant killed: narrowing the task list to `test:(regression|smoke)` now gives `pass=287 fail=8` (test:player, operator, e2e, scenario, rg, tags, two-scenarios-under-lock, one-scenario-without-lock).
- Reason check: a deny row without `reason`, or whose substring is absent from stderr/ask-JSON, fails; `verdict` also distinguishes a granted `allow` decision from no decision (A13).
- Peer must-allow shapes are explicit `peer-must-allow` rows through every Bash hook, all green.

### Fork test summary

`npm test` in the fork: `tests 1523, pass 1523, fail 0` (after `25c4168`).

### Rulings applied with a deviation

- R1: pipe-fed `rg` (`git log | rg x`) is allowed. `rg` reads stdin when piped and never walks the cwd; denying it would contradict "pipe-fed grep allowed". It does not change the replay target (130). `rg -r` is rg's replace flag, not recursion, so only grep-family `-r/-R/--recursive` counts.
- R8 detective control (preflight failing on `.claude/hooks` diffs without a `Hook-Patch:` trailer) is NOT built: it is outside section C and the preflight scope of this batch.
- Review: one fresh Sonnet read-only review of `bb68dceb7` found 14 issues (stack-lock/supervisor tokens as data, `<(..)`, `$'..'`, stdin shells, shell injection through `-C` dirs, supabase@version, gh `-R`, `+main`, marker forging variants, rg option values); all fixed and each pinned as a `review-r1` canary row (52 of the new rows fail on `bb68dceb7`). A second Sonnet round to zero and the Opus diff check from section C were NOT run; recommended before relying on the hooks as more than a guardrail for honest agents. Known unfixed: aliases (`git -c alias.p=push p`), runtime-assembled marker paths.

### CEO command

`cd ~/get-shit-done && npm run install:gsd && bash .planning/gsd-v2/experiments/09-hooks-audit/flip.sh --apply` in a terminal, type `FLIP`, then `flip.sh --smoke` from a new terminal. `flip.sh --rollback` undoes it. Dry-run first: `flip.sh --apply --dry-run`.
