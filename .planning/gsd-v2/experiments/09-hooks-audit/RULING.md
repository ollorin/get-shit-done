# 09 Hooks audit: independent review and rulings (2026-11-01)

Reviewer: Opus, independent of the implementer. Inputs: `RESULT.md`, igaming `076610d36`, all settings files, all hook scripts. Payloads were piped into the real scripts as `{"cwd":...,"tool_input":{"command":"<payload>"}}`; old = `076610d36~1`. Fixtures lived in `/tmp/hookrule/`; nothing in either repo was edited except this file.

## Verdict: NO-GO as specified, GO after the pre-flip batch (section C)

Hook enablement is the right call and most of `076610d36` is sound: the CLAUDE.md test shapes really are allowed, and all 37 project deny/ask canaries and all 9 user deny/rewrite canaries fail against no-op hooks. The flip as written in RESULT.md is blocked by what comes back with it, not by the project hooks:

- **B1 RTK corrupts evidence (HIGH).** RESULT.md scores it "works, transparent". It is not transparent; see the R9 table. A reviewer would see truncated diffs, and history and API checks would return false negatives.
- **B2 schedule-resume can launch a headless writer in the shared tree (HIGH).** Its target command does not exist.
- **B3 check-api-contract-drift denies commits with a false reason outside the repo (MED-HIGH).**
- **B4 R2 and A3 are coupled (MED-HIGH).** Fixing the `--cwd` gap alone would newly deny the shape 401 fix loops use.
- **B5 RESULT.md's smoke test is wrong (MED).** Step 4 would report failure on a correct flip.

After the flip, `.claude/hooks/**` and settings are agent-read-only by design. All hook fixes are cheapest now, so they go in one batch before the flip.

## A. Review of `076610d36`

### Findings

| ID | Sev | Finding | Payload (old -> new) | Cause and fix |
|---|---|---|---|---|
| A1 | MED | Commit exemption now whitelists the whole chained command | `deno task test:regression; git commit -m x`, `deno task test:regression && git tag v1`, `git add . && git commit -m x && cd apps/e2e-charlotte && deno task test:regression` (DENY -> allow) | `check-test-command.sh:44` widened from `^` to `(^|[;&|])` with `exit 0`. Blank the quoted `-m` text, as `redirect-recursive-search.sh:47` does, then run the blocklist; never early-exit |
| A2 | MED | New terminator list misses `>` and `)` | `deno task test:regression>out.log`, `deno task test:integration>x` (DENY -> allow); `(deno task test:regression)` (allow -> allow) | `:94,:98,:104`. Use `([^[:alnum:]_:-]|$)` as the terminator; also accept a quoted task name (`deno task "test:regression"`, allowed in both) |
| A3 | MED | Comment claims `--cwd/-c` coverage that does not exist | `deno task --cwd apps/e2e-charlotte test:regression`, `deno task --cwd apps/e2e-charlotte test`, `deno task -c apps/e2e-charlotte/deno.json test` (allow -> allow); only `--cwd=x` is caught | `:97` comment is false. The flag loop `(-[^[:space:]]+[[:space:]]+)*` cannot skip a separate flag value. Fix together with R2 (B4) |
| A4 | MED | The real suite entry point is never guarded | `deno run --allow-all --env-file=apps/api/.env.test apps/e2e-charlotte/runner/run.ts --tags=regression --parallel=3 --reset-db` (allow -> allow) | `apps/e2e-charlotte/deno.json` tasks all wrap `runner/run.ts`. The stack-lock owner at 18:09Z today ran exactly this form with `--scenario`. Guard `runner/run.ts` the same as the tasks (R2) |
| A5 | LOW | Wrappers bypass, in both old and new | `bash -c 'deno task test:regression'`, `eval '...'`, backticks, `/Users/ollorin/.deno/bin/deno task test:regression`, `NODE_ENV=test DENO_ENV=test deno task test:regression`, `echo session-supervisor.sh; deno task test:regression`, `echo run-integration-tests.sh; ...` (allow -> allow) | `:47,:53,:61` are substring allows. Anchor them to the command word. Handling `bash -c` needs recursion; port the `gsd-guard-bash.js` tokeniser (R7) rather than growing regexes |
| A6 | LOW-MED | New heredoc parser regressions | `/bin/bash <<EOF\ngrep -rn foo .\nEOF`, `bash<<EOF\n...`, `dash <<EOF\n...`, `echo '<<X'\ngrep -rn foo .`, `cat <<<foo\ngrep -rn foo .`, `echo $((1<<N))\ngrep -rn foo .` (DENY -> allow) | `redirect-recursive-search.sh:55`: shell detection requires a preceding space and a following space, and `<<` is matched inside quotes, in `<<<` and in `$((`. An unterminated tag then drops every later line. Match outside quotes, exclude `<<<` and arithmetic, take the basename of the shell |
| A7 | LOW | Pre-existing first-pipe truncation | `false || grep -rn foo .`, `ls | head; grep -rn foo .`, `git commit -m "$(grep -rn foo .)"`, `/usr/bin/grep -rn foo .`, `egrep -rn foo .` (allow -> allow) | `:64` stops at the first `|` of any kind. Rewrite as segment-wise in R1. Not safety-critical because `awk '/foo/' f` and `sed -n` are allowed anyway |
| A8 | LOW | All project hooks and the protect hook fail open on bad input | `{not json deno task test:regression git push` and `PATH` without jq: allow on all six hooks tested | `.claude/rules/guard-authoring.md` section 2 says "Unreadable is FAIL" for every gate. `/usr/bin/jq` ships with the OS, so failing closed cannot stall; add to the shared preamble of the project hooks |
| A9 | LOW | Perf claim holds on real input only | A 216 KB single-line non-ASCII `python3 -c` took 9.2 s in `redirect-recursive-search.sh`; replay max is 261 ms | Awk `substr` loop. Skip the scan above 64 KB by checking the raw text with a cheap regex, or accept. Not a blocker |

Weakening beyond CLAUDE.md: the intended allows (`deno test`, `deno task test`, `nx test`, `CI=false nx test`) match the CLAUDE.md shapes. `deno test --no-check x.test.ts` is now allowed by this hook (DENY -> allow), but CLAUDE.md forbids `--no-check`; no registered hook enforces it (R7). `deno test` on `*.integration.test.ts` is also newly allowed (R3).

Effective comparison: today every hook is off, so the flip only tightens. The regressions above are relative to the old text, not to current reality.

### Adjacent hooks (not in the diff, same flip)

| ID | Sev | Payload | Finding |
|---|---|---|---|
| A10 | MED-HIGH (B3) | Hook cwd `~/get-shit-done` or `/tmp`, `git commit -m x` | DENY "API contract drift" while the real error is `Module not found`. `check-api-contract-drift.sh:19,30,36,44`. `cd ~/get-shit-done && git commit` from the igaming root judges GSD's commit by igaming's contract and costs 4 s |
| A11 | MED | `true; git push`, `git  push`, `/usr/bin/git push`, `command git push`, `git -c a=b push`, `GIT_TRACE=0 git push`, `bash -c "git push"` | All allowed; anchor at `block-push-without-local-tests.sh:27` |
| A12 | MED | `touch .preflight-passed`, then `git push` | Marker is forgeable. Only `scripts/preflight.sh:1550` should write it |
| A13 | MED | `git merge x && git reset --hard HEAD~3` | `check-git-merge-target.sh:33` emits `permissionDecision: allow` for the whole compound command (output verified). Emit allow only when the command is a single merge; otherwise exit 0 with no decision |
| A14 | MED | `gh api -X PUT repos/o/r/pulls/1/merge`, `git push origin HEAD:main`, `bash -c "gh pr merge 1"` | All bypass the merge ask |
| A15 | MED | `sed -i '' 's/x/y/' ~/.claude/get-shit-done/bin/hooks/gsd-protect-managed-files.js`, `cp /dev/null ~/.claude/get-shit-done/bin/hooks/gsd-charlotte-lock.js` | Bash route to managed hooks is open; `bashConfigViolation` covers only `.claude/settings*` and `.claude/hooks` (`gsd-protect-managed-files.js:60`), and the manifest check is Write/Edit only. Fix in fork |
| A16 | MED | `python3 -c "import pathlib;pathlib.Path('.claude/settings.local.json').write_text('{}')"`, `D=.claude; echo '{}' > $D/settings.local.json`, `F=.claude/hooks/check-test-command.sh; : > $F`, `python3 /tmp/x.py`, `git apply .tmp/hookfix.patch` | All allowed. Protect is a guardrail for honest agents, not a boundary. R8 must not rely on it. Add `write_text`, `Path(`, and `git apply` with a path check; do not try to chase variables |
| A17 | LOW | `git commit -m 'hook says disableAllHooks is off'`, `echo disableAllHooks` | Denied by design. Commit messages must avoid the word after the flip, so the coordinator brief says so |

### Canary quality

Deny canaries are real: `HOOKS_DIR=<no-op copies>` gives pass=137 fail=37, all project deny/ask rows. `HOME=<no-op copies>` gives 9 failures, all user deny/rewrite rows. But:

- **Mutant survives.** Narrowing `CHARLOTTE_TASKS` to `test:(regression|smoke)` passes 174/174, so `test:scenario|player|operator|e2e|rg|tags` have zero coverage, and neither does the R2 behaviour.
- **No bypass class.** No row covers A1-A7 or A10-A14.
- **Reason unchecked.** `verdict()` in `run-canaries.sh` treats any exit 2 as a correct deny, so a crash-path deny would pass. Add an expected stderr substring per deny row.
- **Not wired.** `scripts/preflight.sh` and `.github/workflows/*.yml` have no `run-canaries` reference, so the corpus can rot unnoticed.
- **Frozen after the flip.** `canaries.jsonl` sits under the protected `.claude/hooks/`. Move corpus and runner to `scripts/validation/hook-canaries/` so agents can add rows without touching enforcement; `HOOKS_DIR` already supports this.
- Old-hook failure count: I measured 13 with `hooks-orig`, RESULT.md says 12. Immaterial.

### RESULT.md claims disproved

- Step 4 "`grep -n foo README.md` must be denied": allowed in both old and new. `redirect-recursive-search.sh:79` needs a `/` or glob. A correct flip would look failed.
- "Still denied: any `grep`/`rg` on a file": false for slashless paths (`grep foo file.txt` is allowed).
- "R2 blocked as before": the 401-08 shape `deno run -A scripts/stack-lock.ts ... -- deno task --cwd apps/e2e-charlotte test:scenario ...` passes (A3). The corpus has 9 real runner invocations; only the `cd apps/e2e-charlotte && ... deno task test:scenario` forms were denied.
- "`touch .claude/hooks/zz-probe`" as smoke: leaves junk in the hooks directory if hooks are off. Use `echo disableAllHooks` (no side effect either way).
- "Edit the line in an editor": the CEO does not edit files. A one-command script replaces it.
- Verified as stated: 174 canaries green; replay 494/3/1 denials; local `hooks` block is a subset of `settings.json`; no PAUSED.json; one July test entry in `scheduler.log`, no `com.gsd.resume` plist.

## B. Rulings

### R1 redirect-recursive-search: NARROW, before the flip

Premise is disproved for the shapes that matter: `Bash(grep:*)` is allowed in both user and project settings, the main session (pid 25102) runs `--dangerously-skip-permissions` and cannot prompt, and this auto-mode session ran `grep -n`, `grep -rl` and `find -name` with no prompt. The classifier is real, since it refused another of my commands, so "never prompts" stays unverified for every mode. "Always prompts" is false.

The 494 denials break down as: targeted file 248, `git grep` 75, `rtk grep` 61 + 5 recursive, recursive 36, `rg` non-recursive 35, wait loops 33, `find -exec` 1 (approximate classifier, `/tmp/hookrule/classify.py` over `.tmp/hook-audit/corpus3.jsonl`).

`zg` does not replace these. `zg status` reports the index stale right now (3 added, 15 modified), and hybrid search cannot serve exact claim-tracing. A targeted denial pushes agents to whole-file Reads or to `awk`/`sed`, which the hook allows anyway.

Resulting behaviour:

- **Deny:** any `grep|egrep|fgrep|rg` with `-r/-R/--recursive` in any `;`/`&&`/`||` segment. `rg` with no explicit file target. `find -exec` without `-maxdepth` (the cleanup cron's `-maxdepth 1 ... -exec rm` must pass; denied today, verified). `rtk grep` always, since it is lossy: 500 matches became 16 lines and "+490"; 40 files showed 25.
- **Allow:** non-recursive grep on named files or shell globs, `until grep -q ...` wait loops, `git grep` (index-bound, exact), pipe-fed grep, `rtk proxy grep` by the same rules as `grep`, any leading `zg ...`. The last fixes the false deny `zg query --rg -F "git grep" apps/api/x`.
- **Message:** drop the "always forces a human-approval prompt" claim (`:90-92`, header `:11-17`). Name `git grep -n <pat> -- <path>` and `zg query --rg -F <pat> <path>` for exact sweeps and `zg query` for discovery.
- **Expected denials:** 103-138 of 6,000 (1.7-2.3%), against 494 (8.2%). Acceptance: re-replay the patched hook, at most 140.
- Rewrite CLAUDE.md's "Bash `grep`/`rg`/`find` triggers a human-approval prompt" in the same change, and allow `zg query --rg` for the "cited zg query" sweep rule.

### R2 Charlotte single scenarios: ALLOW under the lock only

Allow `deno task [--cwd x] test:scenario <one>` and `deno run ... runner/run.ts --scenario=<one>` only when the command word sequence starts with `stack-lock.(sh|ts) ... --` or `session-supervisor.sh`. Everything else on `runner/run.ts` and all bulk tasks (`test`, `test:regression|smoke|rg|tags|player|operator|e2e`) stay denied unless run through the supervisor. Ships together with the A3 and A4 fixes so the 401-08 and 401-09 shapes continue to work. Add one canary per task name.

### R3 Integration tests: ACCEPT, with a reminder and a dated tightening

`deno task test:integration[:ci|:*]` stays denied, with the A2 terminator fix. Direct `deno test`/`deno task test` on `*.integration.test.ts` stays allowed because CLAUDE.md lists the shape, but when `stack-lock` is absent the hook exits 0 with `hookSpecificOutput.additionalContext` saying to wrap it. 14 of 33 such corpus commands had no lock, which breaks CLAUDE.md's stack-serialisation rule. A deny today could queue a fix loop behind a Charlotte lock for up to `--timeout`, so it waits: convert to deny through the R8 path when 401 and 402 close. Recorded as a scheduled change, not a deferral.

### R4 doc-compression: UNREGISTER

The hook's own header (`doc-compression-hook.js:38-46`) admits the legacy output shape and that delivery is unproven; `:172,:219` still emit it. RESULT's transcript evidence of inert delivery is unverified by me, and a working version would add tokens on top of the full Read. Remove from `~/.claude/settings.json` **and** from fork `bin/install.js:1749-1758`, which re-registers on every `npm run install:gsd`. Also drop the redundant `hooks` block in `settings.local.json` (subset of `settings.json`, verified).

### R5 Anchors: YES, all in the batch

- `check-api-contract-drift`: resolve target like `block-push:14-19`, `exit 0` when `scripts/api-contract/diff-registries.ts` is absent, and match `a; git commit` and `git -C x commit` (B3).
- `check-supabase-command`: add path-prefixed binary (`(^|[\s;&|(])(\S*/)?supabase\s+(start|stop)`); check `--exclude`/`--project-id` in the same segment (`echo --project-id; supabase stop` passes today).
- `block-push`: A11, A12. `check-git-merge-target`: A13, A14.
- Restart and test shapes verified allowed through all Bash hooks: `npx nx stop:dev api`, `orbctl stop/start`, `npx supabase functions serve ...`, `stack-lock ... supabase db reset`, `run-integration-tests.sh`, `preflight.sh`, `git worktree add`. The one bare path-prefixed `supabase start` in the corpus becomes a deny that names `npx nx start:dev api` and `--exclude edge-runtime`; tell the restart owner.

### R6 schedule-resume: UNREGISTER (see R9)

### R7 gsd-guard-bash: YES, after the flip, through the fork

Not a flip blocker: corpus use is `--no-verify` 0, `--no-check` 0, stash 2, `reset --hard` 0, clean 0, rebase 0, hooksPath 1, so stall risk is near zero. Required before registration: commit the two untracked files in the fork, deny `core.hooksPath` (draft returns rc=0 for `git -c core.hooksPath=/dev/null commit`, verified; `bash -c "git commit --no-verify"` and `--no-check` are correctly denied), add the canaries, register through `install.js`. A rebase the CEO approves is run from his terminal, since the guard denies it in the primary tree.

### R8 Future hook fixes after the flip

Hook changes are made by a person's one command, prepared by agents.

1. Agent writes `.planning/hook-patches/<id>.patch` plus canary rows in `scripts/validation/hook-canaries/`, and tests against a copy with `HOOKS_DIR=$PWD/.tmp/hook-try/<id>` (the path must not contain `.claude/hooks`).
2. A fresh Sonnet reviews to zero findings. A fresh Opus reviews anything that narrows a deny.
3. CEO runs `bash scripts/hooks-apply.sh <id>` in a terminal. It requires a TTY and a typed word, checks the patch hash against the review file, applies, runs canaries, commits only `.claude/hooks` paths, and reverts on any failure. Bash tool calls have no TTY.
4. GSD-managed hooks (`~/.claude/get-shit-done/bin/hooks/*`): edit in the fork, review, `npm run install:gsd`, as the protect message says. Non-manifest files (`~/.claude/hooks/*`): `hooks-apply.sh`.
5. Emergency: `flip.sh --rollback` (section C).

Rejected: an env-var override (any agent can set one inline), moving logic behind an unprotected wrapper (launders the guard), and allowing agents `git apply` (A16 shows they can, CLAUDE.md "Never touch the guardrails" says they may not). Detective control for the A16 gap: preflight fails when `git diff --name-only <base>...HEAD -- .claude/hooks .claude/settings.json` is non-empty without a `Hook-Patch:` commit trailer matching a reviewed patch id.

Side note: `.claude/hooks` is tracked and `076610d36` is not on `main` (`git branch --contains` shows only the feature branch). A session started on `main`, or in a `.tmp/wt-*` worktree at an older SHA, runs the old `check-test-command.sh` that blocks all test shapes. `settings.local.json` is gitignored, so such a worktree session already has hooks on. Both live sessions have cwd at the repo root (verified), so this is not a present problem.

### R9 What comes back

All hooks read state fresh on each call, so none has "session started while off" state, with the one exception noted for the Charlotte lock. Plugin hooks: only `superpowers` has a `hooks.json` among installed plugins and it is disabled in user settings. No `hooks:` frontmatter in `~/.claude/agents`.

| Hook | Launchd | Outbound | Writes in shared tree | Ruling |
|---|---|---|---|---|
| rtk-rewrite | none | none | none | **Unregister first** |
| schedule-resume | **yes** | none | `.planning/resume-scheduler.log` | **Unregister first** |
| gsd-check-update | none | **`npm view get-shit-done-cc` per session (`:77`)** | none (`~/.claude/cache`) | **Unregister, and in fork `install.js:1708-1732`** |
| doc-compression | none | none | none (`~/.claude/get-shit-done`) | **Unregister (R4)** |
| gsd-charlotte-lock | none | none | `.tmp/charlotte.lock` (gitignored) | Keep |
| session-end-standalone | none | none | none | Keep |
| gsd-protect-managed-files | none | none | none | Keep |

**RTK.** Not a transparent filter. It has not been rewriting in igaming: `settings.local.json` last changed Sep 24 with the flag in place, this session's git output is raw, and the corpus shows only typed `rtk`. `history.db` has no project column, so other projects and typed use cannot be separated. The flip would be a sudden change for every review loop. Measured on this repo and fixtures:

| Agent types | Runs as | Result |
|---|---|---|
| `git log --oneline \| grep -c '399'` | `rtk git log --oneline \| grep ...` (pipe is not skipped) | **0 instead of 410.** Default limit 10 lines of 8,741. "Verify commits" gives a silent false negative |
| `curl -s <json>` | `rtk curl` | **Values replaced by a type schema**: `status: string` instead of `"FAILED"`, `balance: int` instead of 100. rc 0. Corpus: 125 calls |
| `git diff A B`, `git diff A B > f` | `rtk git diff` | 436 lines became 85, ending in `... (truncated)`. The saved file fails `git apply`. **Bad ref returns rc 0** (raw 128). Corpus: 68 |
| `git show <sha>` | `rtk git show` | 449 became 84 |
| `git show HEAD:CLAUDE.md` | `rtk git show` | **Content printed twice** (559 vs 279). A BASE file saved this way is corrupt |
| `cat x.ts`, `cat CLAUDE.md` | `rtk read` | **Whole-line comments stripped** from code; last 6 lines of CLAUDE.md dropped, rc 0. Corpus: 246 |
| `deno test f` (also `2>&1`) | `rtk deno test` | rc preserved, failure message kept. **All `console.log`/`console.error` from a failing test dropped**, passing test names dropped, a passing test's "GATE: 12 sites scanned" line dropped |
| `deno run`, `deno test` long-running | `rtk deno ...` | **Output buffered until exit**: 0 lines after 2.5 s against 3 raw. `until grep -q` wait loops and the "no output for 45 min = stalled" rule misread it. `supabase functions serve` and `npx nx start:dev` go through the same wrapper family; streaming there is unverified |
| `git commit` with failing pre-commit | `rtk git commit` | Fine: rc 1, message shown |

Rewriting is also skipped for `cd x && cmd` but applied to bare `cmd`, so the same command gives different evidence by spelling. Typed `rtk grep` (66 in corpus) already truncates sweeps today; R1 stops that.

Decision: unregister from `~/.claude/settings.json`; keep the binary. Savings lost in igaming against today: none. Re-enable later only per command, with a fidelity canary (full output and rc equal to raw, or an explicit marker) for each. Change `~/.claude/RTK.md` so it stops saying commands are auto-rewritten.

Unverified, moot while off, must be settled before any re-enable:

- Whether `rtk git reset --hard` (rewrite verified) evades `Bash(git reset --hard:*)`, and `rtk git rebase` evades the ask rule. Probe: sandbox with a deny rule on `echo forbidden`, a hook rewriting to a non-stripped wrapper, and that wrapper allowed. My `command echo` version was denied, which is inconclusive because `command` may be stripped; the wrapper version was refused by the auto-mode classifier and I did not retry it.
- `rtk nx test` failure fidelity (99.7% savings in `rtk gain`) and `rtk docker exec/logs` (70 corpus calls; docker was out of scope).

**schedule-resume.** `/gsd:resume-paused` does not exist (`find ~/get-shit-done ~/.claude -name '*resume-paused*'` is empty; only `resume-work.md`). What `claude -p` does with it, either an error or a run as prompt in `acceptEdits`, is unverified. Arming is reachable: `execute-phase.md:135,371` write PAUSED.json on quota or session-limit events, and any later Stop or mention of the file calls `schedule()`. `RunAtLoad` plus a past `fireAt` runs immediately (`schedule-resume.js:68,87,118`). It conflicts with "one writer per file set" and with `scripts/session-supervisor.sh`, the documented mechanism. Nothing is armed now. Not installer-registered, so unregistering sticks.

**gsd-check-update.** Installed 1.18.0, upstream 1.42.3, so `update_available` is permanently true and points at `/gsd:update`, which clobbers the fork per project memory. It would also fire in every Charlotte scenario subprocess (`runner/run.ts:301` spawns `claude` with default setting sources). No value on a fork.

**gsd-charlotte-lock.** Bash check only reads the lock; absent means allow. A run started before the flip holds no lock until its next `mcp__charlotte__*` call. Nested scenario sessions will start taking it, which is the intended behaviour. Flip only when no Charlotte run is live.

**session-end-standalone.** Stop only. Cleans old `/tmp/gsd-session-*` and prunes up to 200 rows per Stop from `~/.claude/knowledge/ollorin.db` (242 rows, staleness over 0.7, `knowledge-lifecycle.js:319-339`), bounded at 5 s. Deleted rows are silent, but this already runs in every project without the flag, and the main DB file is unchanged since Oct 29 including across the 25 timing runs. Keep.

**Binary note (`claude.exe` 2.1.304, bundle functions `r()` and `d()`).** When the flag is set only at project level and a gate `sy()` is true, user-level hooks keep running despite the flag. RESULT's probe shows the gate off today; what `sy()` means is unverified. So an update could bring user hooks back with no edit by anyone. That is a reason to unregister RTK and schedule-resume regardless of the flip's timing.

## C. Go/no-go checklist

### Pre-flip batch (agents, one change set)

1. Hook patch: A1-A3, A4/R2, A6-A8, R1, R3 reminder, R5 (A10-A14). Fresh Sonnet implements (parser work, ambiguous by CLAUDE.md's tiers), fresh Sonnet rounds to zero, one Opus re-check of the diff. Commit with `git commit -- <paths>`; no phase claims these paths.
2. Move canaries, add bypass and per-task rows and reason checks, wire into preflight. The narrowing mutant must now fail.
3. Re-replay over `corpus3.jsonl`. Acceptance: R1 at most 140 denials; check-test-command at most 3 real denials and no R2 shape denied.
4. Fork: stop registering check-update and doc-compression in `install.js`; add A15 and A16 patterns to protect; `npm run install:gsd` before the flip so protect is current.
5. Write `scripts/hooks-apply.sh` (R8) and `experiments/09-hooks-audit/flip.sh`, reviewed. `flip.sh` modes: `--apply`, `--smoke`, `--rollback`.
6. Rewrite the CLAUDE.md grep line and `~/.claude/RTK.md` text. `~/.claude/RTK.md` is user-private, so it goes in `flip.sh`.

### Flip (CEO, one command, about 2 minutes)

Order:

1. Tell coordinators (brief below) **before** the flip. Whether running sessions pick it up is unverified: the binary reads hooks from a per-session snapshot `initialHooksConfig` (`mW()`), with an update path (`fW()`) whose callers I could not determine, and my reload probe was refused by the classifier. Assume possible.
2. Wait for a safe window. `flip.sh --apply` refuses and names the reason if any of these holds: `.tmp/local-stack.lock/owner.txt` label contains `charlotte`; `.tmp/charlotte.lock` is live; an OrbStack restart is running; canaries fail; any `PAUSED.json` or `com.gsd.resume*` plist exists.
3. **OrbStack:** independent, never at the same time. If a restart is due or running, finish it and confirm stack health first, then flip, so failures stay attributable. Every restart step passes the hooks, so the flip does not need a restart either way.
4. `flip.sh --apply` requires a typed word, backs up both settings files, removes from `~/.claude/settings.json` the entries for `rtk-rewrite`, `schedule-resume` (both registrations), `gsd-check-update`, `doc-compression-hook`, and only then removes the flag and the `hooks` block from `settings.local.json`. It validates the JSON and prints the diff. Unregistering comes first and is in the same step, so no session can see the old set.

### Coordinator brief

> Hooks are coming on. Denied now: recursive `grep`/`rg`, `rg` without a file, `rtk grep`, `find -exec` without `-maxdepth` (use `git grep -n X -- path` or `zg query --rg -F X path`). Charlotte suite tasks and `runner/run.ts` outside `stack-lock.sh`/`session-supervisor.sh`. `deno task test:integration*` (use `run-integration-tests.sh`). `git push` without a fresh `scripts/preflight.sh`. `git commit` with contract drift (+4 s). `supabase start/stop` without `--exclude`/`--project-id`. `db reset`, `preflight.sh` and `test:regression` during a live Charlotte lock. Any Bash text containing the hook-disable setting's name, including commit messages. Edits to `.claude/hooks/**` and `.claude/settings*.json`: use `.planning/hook-patches/`. Asks: `gh pr merge`, merge to main. Still allowed: `grep` on named files, `until grep -q` loops, the CLAUDE.md test shapes, stack-locked single scenarios. A deny is not a failure: read the message, retype once. If a deny blocks a CLAUDE.md shape, stop and report the exact string; do not work around it. Raw `git`, `curl`, `cat` output is unchanged. Do not type `rtk grep`, `rtk git diff`, `rtk git log` for evidence.

### Smoke (`flip.sh --smoke`, new session, run from the CEO's terminal)

| Command | Expected | Proves |
|---|---|---|
| `echo disableAllHooks` | BLOCKED | user-level hooks live, no side effect |
| `git push origin zz-nosuch` | BLOCKED (marker stale since Oct 30) | project hooks live |
| `cd apps/api && deno task test functions/games-crud/index.test.ts` | runs | allowed shape |
| `grep -rn zzprobe apps/api/functions/games-crud` | BLOCKED, `zg`/`git grep` message | R1 deny |
| `grep -n foo README.md`, `git grep -n foo -- README.md` | run | R1 allow |
| `git log --oneline \| wc -l` | above 8,000 | RTK off |
| `ls ~/Library/LaunchAgents \| grep gsd` | empty | no resume armed |

Then the main session's runner runs `echo disableAllHooks`. BLOCKED means running sessions pick up changes. Printed means they do not; that settles the unknown, and those sessions stay unhooked until restarted at a phase boundary. "Enabled 100%" is true only when no Claude process predates the flip (`ps -o etime`).

### Rollback

`flip.sh --rollback` restores both backups (the flag returns; it applies to user-level hooks too per RESULT's probe). A person in a terminal runs it. The TTY gate alone does not stop an agent (`script -q /dev/null bash flip.sh` supplies a pty; the `--approved-by-ceo` quote cannot be verified), so once hooks are on the protect hook denies any Bash command that runs `flip.sh` with `--rollback`, or with `--apply` unless `--dry-run` is also given (`gsd-protect-managed-files.js`, `flipRunsForReal`). The first `--apply` still works from an agent because hooks are off at that moment; `--smoke` stays allowed. Triggers: any smoke row wrong; a coordinator reports a CLAUDE.md shape denied; a phase unable to progress for 15 minutes on a hook deny. A single wrong deny with a retype path goes to R8, not rollback.

## What is the CEO's

Only two things: run `flip.sh --apply` at the safe window (agents may not touch settings), and restart the long-lived sessions at a phase boundary if the smoke shows they did not pick it up. RTK off is my ruling, not a question; it is user-wide, so if token savings in other projects matter more than output fidelity there, say so and the per-command re-enable can be prioritised.
