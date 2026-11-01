NOT READY: 3 HIGH, 4 MED, 3 LOW

# 09 Hooks audit: independent review of the pre-flip fixes (2026-11-01)

Scope: fork `f9109c8..966ff00` (hooks, `flip.sh`, `flip-test.sh`), igaming `53d512fe2 fd56f169e 0c4998474`. Everything was executed on temp copies under `igaming/.tmp/preflip-review/` (`p.sh`/`p2.sh` feed a payload to a hook, `m_*.sh` are flip.sh mutants, `fix.sh`, `fixp/` are the proposed fixes). Real `settings*.json`, `~/.claude`, `flip.sh --apply|--rollback` on real files: untouched. No stack, docker or supabase command. The reviewer's shell denied a probe `sudo -n true`, so the `sudo` idea in H1 is unverified.

## Verdict on the asked items

| # | Question | Answer |
|---|---|---|
| 1 | B1-B3, N1-N9 closed on disk | B2, B3, N1, N2, N4, N6, N7, N8, N9, N10 closed (executed). B1 closed except S1 (row 8 reports WRONG on a healthy host with the real CLI), L1, L2. N3 and N5 are not closed: H1, H2, H3 |
| 2 | `FLIP_PROCS_ROOT_PID` | Yes, it skips the Charlotte-runner and restart refusals in a real `--apply`: M1 |
| 3 | N3 deny bypasses | Many: H1. `hooks-apply.sh` `script` gap must be fixed now: H3 |
| 4 | trailer check | Breaks no branch or merge path. One remedy gap: M4 |
| 5 | new denials | No coordinator shape lost by the diff. One pre-existing hook denies a documented restart step: M3. The charlotte-lock heredoc denials are limited to a live lock (confirmed) |
| 6 | restart marker | Not needed, after M3 is fixed |

## 1. Suites (quoted)

- `bash flip-test.sh`: every case PASS, last line `flip-test: all pass` (47 PASS lines, 0 FAIL).
- `node --test get-shit-done/bin/hooks/*.test.js`: `# tests 446 / # pass 446 / # fail 0`.
- `scripts/validation/hook-canaries/run-canaries.sh`: `canaries: pass=445 fail=0`. Stack-safe, confirmed first: corpus tools are Bash 416, Edit 14, Write 14, Read 1; no `mcp__*` tool and no `SubagentStart`, so `gsd-charlotte-lock.js:174-176` (the only write path) is unreachable; hooks only parse stdin text; temp repos in `$TMPDIR` (`run-canaries.sh:20`); `check-api-contract-drift` runs only against the stub repo or with `SLOW=1` (`run-canaries.sh:92`).
- `deno test scripts/validation/hook-patch-trailer-check.test.ts scripts/validation/guard-registry-reconcile.test.ts`: `ok | 28 passed | 0 failed`.
- Real CLI, exact `flip.sh:240-241` argv order, `</dev/null 2>/dev/null`: `echo smoke-ok-123` returned `smoke-ok-123`, rc 0. B1's argument-order and stdin defects are fixed.

Mutation run on `flip.sh` (17 mutants, `flip-test.sh` against each, `.tmp/preflip-review/results.txt`):
- Caught: stderr merged back (4 fail), prompt after `--allowedTools` (5), no fails check (3), rc ignored (1), loop on stdin (8), no fresh-marker skip (1), no lock re-check (1), backup root moved back (4), `applied` cleared on a failed first write removed (1).
- Survived: `</dev/null` removed (L1); row-count check removed (L2); backup `cmp` removed, rollback `cmp` removed, backup `cp ... || die` loosened, `mkdir ... || die` removed, rollback `applied` guard removed, `total -gt 0` removed. The last six are equivalent: a second guard (the other `cmp`, the RTK `cp`, `cat "$APPLIED"` then `[ -d "" ]`) refuses with a different message.

## HIGH

**H1. The N3 deny is bypassed by quoting, line continuation, shell pipes and a copied script, and `--approved-by-ceo` still rolls back.** `gsd-protect-managed-files.js:103-108` (regexes), `:347-348` (loop), `flip.sh:42-50` (`need_tty`).
Executed (`p.sh`, fork hook): allowed `bash flip.sh "--apply"`, `bash flip.sh '--rollback'`, `bash flip.sh --roll""back`, `bash "fl""ip.sh" --apply`, `bash flip.sh \<newline> --rollback`, `echo "bash flip.sh --apply" | bash`, `bash <<'X'<newline>bash flip.sh --apply<newline>X`, `cp flip.sh /tmp/f.sh; bash /tmp/f.sh --apply`, `F=flip.sh; bash $F --apply`, `bash f*.sh --apply`, `cat flip.sh | bash -s -- --apply`, `python3 -c "subprocess.run(['bash','flip.sh','--apply'])"`. Denied: literal forms, `cd d && ./flip.sh --rollback`, `bash -c "bash flip.sh --apply"`, `env`/`nohup`/`xargs`/`script` prefixed, `--apply=1`, `--rollback --dry-run`; allowed by design: `--apply --dry-run`, `--smoke`.
So `bash flip.sh "--rollback" --approved-by-ceo "any eight chars"` turns hooks off from an agent: the quote is not verified (`flip.sh:44-45`).
Fix, two layers:
1. `flip.sh`, first line of `do_rollback`: refuse `--approved-by-ceo` and any Claude ancestor. Proven on a fake-HOME copy (`fix.sh`): approved rollback `rolled back` before, `flip: rollback runs only from a terminal outside Claude Code` after, also under `script -q /dev/null`.
```bash
is_fixture() { [ "$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$CLAUDE_HOME")" != "$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$HOME/.claude")" ] &&
  [ "$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$PROJECT_DIR")" != "$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$HOME/igaming-platform")" ]; }
under_agent() { ps -axo pid=,ppid=,comm= | awk -v p=$$ '{pp[$1]=$2; c[$1]=$3} END{while(p>1&&p in pp){n=c[p]; sub(/.*\//,"",n); if(n ~ /^claude/) exit 0; p=pp[p]} exit 1}'; }
# first line of do_rollback:
is_fixture || { ! under_agent || die "rollback runs only from a terminal outside Claude Code"; [ "$APPROVED" = 0 ] || die "--approved-by-ceo is not accepted for --rollback"; }
```
`flip-test.sh` keeps passing because its fixtures use temp paths (`is_fixture` true): `FLIP_SH=fix.sh bash flip-test.sh` gives `flip-test: all pass`.
2. Protect, `gsd-protect-managed-files.js:347`: normalise before matching. Proven: `"--apply"`, `'--rollback'`, `roll""back`, `"flip.sh"`, continuation all deny; `--apply --dry-run`, `--smoke`, `git commit -m "... flip.sh --apply"` still allow; fork protect tests `# tests 240 / # pass 240`.
```js
for (const seg of withoutHeredocBodies(command.replace(/\\\n/g, ' ')).replace(/["']/g, '').split(/&&|\|\||;|\n|\|(?!\|)/)) {
```
Residual, executed: an orphaned process leaves no Claude ancestor (`nohup sh -c '...' &`, probe printed `agent_ancestor=0` once the parent shell had exited). So layer 1 stops `script` and direct runs, not a deliberately detached one. The only check an agent cannot answer is a secret: add `sudo -v` (password prompt) to `need_tty` for the real run. Unverified whether this Mac has passwordless sudo; the CEO probes with `sudo -n true; echo $?` in a terminal (0 means `sudo -v` proves nothing).
Also update the sentence at `flip.sh:10-12` and the RULING line that says agents cannot.

**H2. Protect misses every interpreter one-liner whose string uses backslash-escaped quotes (pre-existing, not in the earlier pre-flip finding list, still open).** `gsd-protect-managed-files.js:351` (regions), mention regex end `:69`.
Executed, fork protect and the pre-fix `f9109c8` version both allow:
`python3 -c "open(\".claude/settings.local.json\",\"w\").write(\"x\")"`, `python3 -c "open(\"/Users/ollorin/.claude/settings.json\",\"w\")..."`, `python3 -c "import os;os.remove(\".claude/settings.json\")"`, `bun -e "Bun.write(\".claude/settings.json\",\"x\")"`, `deno eval "Deno.writeTextFileSync(\".claude/settings.json\",\"x\")"`, `node -e "require(\"fs\").writeFileSync(\".claude/settings.json\",\"x\")"`. The same payloads with single-quoted bodies deny, and so do `.claude/hooks/...` targets, so the new `Deno.`/`Bun.` entries (N5) work only for unescaped quotes. A JSON rewrite of `settings.json` that drops hook entries needs no flag string, so the flag-name substring rule does not catch it.
Fix (proven: all six deny; `python3 -c "print(open(\".claude/settings.json\").read())"` and `open(\"/tmp/a\",\"w\")` stay allowed; protect tests 240/240):
```js
const regions = interpreterRegions(command).map(r => r.replace(/\\(["'])/g, '$1'));   // line 351
```
Add canary rows for the six payloads (hook `fork:gsd-protect-managed-files.js`).

**H3. The `script` pty gap in `hooks-apply.sh` must be fixed now.** `scripts/hooks-apply.sh:45` (TTY gate), `:32` (path filter).
Executed in a throwaway repo with the real script, an agent-style patch and a self-written `.review.md` carrying the right hash: `(sleep 1; printf 'APPLY\n') | script -q /dev/null bash scripts/hooks-apply.sh p1` printed `hooks-apply: 'p1' committed`, the hook file changed, the commit carries `Hook-Patch: p1`. Protect allows the command (`p.sh`: allow). So an agent can change `.claude/hooks/**` with a valid trailer, and the new N4 control passes it: R8's "person in a terminal" is not enforced. Do it before the flip because the flip makes this the only sanctioned path.
Fix (proven in the throwaway repo: refused under `script`, `--dry-run` still works), insert before the TTY gate at `:45`:
```bash
under_agent() { ps -axo pid=,ppid=,comm= | awk -v p=$$ '{pp[$1]=$2; c[$1]=$3} END{while(p>1&&p in pp){n=c[p]; sub(/.*\//,"",n); if(n ~ /^claude/) exit 0; p=pp[p]} exit 1}'; }
under_agent && die "runs only from a terminal outside Claude Code (an agent can fake a TTY with script(1))"
```
Same residual as H1 (a detached orphan). Also add a protect deny for `hooks-apply.sh <id>` without `--dry-run` with the H1 normalisation, since agents only ever need `--dry-run`.

## MED

**M1. `FLIP_PROCS_ROOT_PID` weakens a real `--apply`.** `flip.sh:63` (read), `:55` (comment). The first `--apply` is legitimately run by an agent (hooks are off), so an agent or a stale `export` can set it.
Executed: a process named `deno run --allow-all runner/run.ts --tags=regression` running; `flip.sh --apply --dry-run` on a fixture: `REFUSING: a Charlotte runner (runner/run.ts) is running`. With `FLIP_PROCS_ROOT_PID=999999`: no refusal, `dry-run complete`. Same on real default paths: only the unrelated "fork hooks not installed" reason remained. Same for a restart process. Fix (proven on a fake-HOME copy: with the variable set and real paths both reasons print again; `flip-test.sh` all pass): use the `is_fixture` helper from H1 and honour the variable only then.
```bash
FLIP_FIXTURE=$(is_fixture && echo 1 || echo 0) python3 -I - <<'PY'      # flip.sh:57
root=os.environ.get('FLIP_PROCS_ROOT_PID') if os.environ.get('FLIP_FIXTURE')=='1' else None   # flip.sh:63
```
Both `CLAUDE_HOME` and `PROJECT_DIR` must differ from the real defaults, so a fixture run cannot touch real files.

**M2. Smoke row 8 reports WRONG on a healthy host.** `flip.sh:220` (row), `:248` (EMPTY match). Real CLI, hooks off, no matching LaunchAgents: the reply was `The command returned no output. No files in ~/Library/LaunchAgents match gsd.`; another healthy-state empty reply (`grep -n foo README.md`) was `(Bash completed with no output)`. Neither is in the accepted set (`''`, `(no output)`, `empty`, `none`), so a correct flip ends with `flip: 1 smoke row(s) wrong; consider: flip.sh --rollback`. The stub says `(no output)`, which is why `flip-test.sh` passes. Fix: make the row numeric (real CLI printed `0` in 2 of 2 runs).
```bash
'ls ~/Library/LaunchAgents | grep -c gsd' ZERO 'no resume armed'                      # flip.sh:220
ZERO) t=$(printf '%s' "$out" | tr -d '[:space:]'); [ "$t" = 0 ] && v=ok;;            # replaces the EMPTY arm at :248
```
Update the header comment at `:222`, the stub (`*LaunchAgents*) echo 0`), and `flip-test.sh` cases 10d, 10g, 6 (`EMPTY` becomes `ZERO`).
Row 4 (`grep -rn zzprobe`) with hooks off printed `(No output: the grep ran...)`, which is correctly WRONG, so BLOCKED rows do not false-pass in the hooks-off state (one sample each).

**M3. A documented restart step is denied once hooks are on.** `docs/development/supabase-local-stack.md:315` (step 6 `npx supabase start`) and `:223` (`npx supabase stop && npx supabase start`) against `check-supabase-command.sh:3-4`. Executed: `cd apps/api && npx supabase start` rc 2, `npx supabase stop` rc 2, `npx supabase start --exclude edge-runtime` rc 0, `npx supabase stop --project-id api` rc 0, `orbctl stop|start`, `docker compose -f supabase/docker-compose.redis.yml up -d --wait`, `npx supabase functions serve ... --env-file ...`, `npx nx start:dev|stop:dev api` all rc 0. A coordinator following step 6 mid-restart gets a deny with the stack stopped. Fix the doc: step 6 `npx supabase start --exclude edge-runtime` (the recipe in `apps/api/project.json:25`), `:223` `npx supabase stop --project-id api && npx supabase start --exclude edge-runtime`, and say bare `start`/`stop` are denied. No hook change.

**M4. A legitimate `.claude/settings.json` commit can never pass the trailer check.** `scripts/hooks-apply.sh:32` accepts only `.claude/hooks/*`, so it cannot stamp a `settings.json` change; `hook-patch-trailer-check.sh:45` tells the author to use it. History shows these are routine (`567916f98`, `673fc8ab6` allow-rules). Executed in temp repos: a revert of a trailered commit (`Revert "fix(hooks): x"`), a trailer followed by a separate `Co-Authored-By` paragraph, and a conflict-resolved merge touching hooks all FAIL, with only a floor bump as recovery; a plain `--no-ff` merge of a trailered branch passes. Fix: change the FAIL line to `...touching .claude/settings.json: a person adds a 'Hook-Patch: manual-<reason>' trailer; hooks: scripts/hooks-apply.sh; revert/amend: keep the trailer in the last paragraph`, and say so in the `gate-estate.md` row. Optional hardening (LOW): the check accepts any `Hook-Patch:` text, so a forged trailer passes; require `.planning/hook-patches/<id>.patch` to exist in the same commit's tree.

## LOW

**L1. The `</dev/null` fix is untested.** `flip-test.sh:142` runs `flip.sh --smoke </dev/null`, so removing `</dev/null` from `flip.sh:241` survives (mutant M01). Fix: `printf ROWDATA | PATH=... bash "$FLIP_SH" --smoke` (assignments before `bash`, not before `printf`). Proven: the mutant then fails 10c (`1 CALL stdin=7`), the real script passes all cases.

**L2. The row-count check is unexercised.** `flip.sh:256` survives removal (M04). It only triggers if the loop ends early, which a child reading inherited fd 3 would cause. Fix: add `3<&-` to the `claude` command at `:241` and a case with a stub that runs `cat <&3` (proven: without `3<&-` the stub gives `flip: smoke ran 1 of 8 rows`; with it all 8 rows run).

**L3. Trailer check on foreign branches.** Floor `53d512fe2` is an ancestor of HEAD here; 46 local branches and 8 worktrees lack it, but none contains the check script (its commit descends from the floor), so none fails. A cherry-pick of `fd56f169e` onto such a branch (the `wt-404-04-land` style) fails with "floor ... is not an ancestor": by design (`hook-patch-trailer-check.sh:30`). Rebase of this branch also invalidates the floor SHA.

## Item 2 detail: N3 and the other fixes, executed

N1: with a live lock, `scripts/stack-lock.sh --label q -- npx supabase db reset` and `-- scripts/preflight.sh` give rc 2; without a lock rc 0; `git commit -m x -- scripts/preflight.sh` rc 0. N2: mutant without the re-check fails case 13. N5 shapes denied: `cp x .claude/settings.json 2>/dev/null`, `ln -s ... 2>/dev/null`, `cp x .claude/`, `cp -R`, `rsync -a`, `cd .claude; cd hooks; echo 1 > f`, `pushd`, payload `cwd=.claude/hooks`, `deno eval` (unescaped) (exception: H2). N6: `git diff A B -- .claude/hooks scripts/hooks-apply.sh` allowed. N7: `npx nx e2e-charlotte:regression` rc 2, `npx nx e2e-charlotte:lint` rc 0 (only `apps/e2e-charlotte/project.json:8,25` has `e2e`/`regression` targets). N8: `git merge x --no-verify` and `git merge --no-ver x` rc 2, `git merge -m "--no-verify" x` rc 0. N10: `.planning/ROADMAP.md` carries the line.

## 4. Trailer check

- `scripts/preflight.sh:668-669` diff is +5 lines inside the existing block; no other behaviour changed. `bash -c "scripts/validation/hook-patch-trailer-check.sh"` from the repo root: rc 0, also called from a parent running `set -euo pipefail` (a fresh `bash -c` inherits nothing; the script sets `set -u` and checks every git call). Mode `100755`. `run_check` swallows failures into `FAILURES` as before (`preflight.sh:177-179`).
- Today: `scanned 0 commit(s) in 53d512fe2..HEAD ...; 0 without a Hook-Patch trailer`.
- Merge path: `d30f9f5bd` style true merges keep the floor an ancestor (`git merge-base --is-ancestor 53d512fe2 HEAD` is true). Squash merge, rebase and cherry-pick need a `FLOOR_DEFAULT` bump (documented at `:7-8`).

## 5. New denials and coordinators

- Diff-introduced denials affect no coordinator shape (65 shapes were already replayed by the earlier check; the N7 `nx project:target` and runner-dir `run.ts` rules match only `e2e-charlotte`).
- Charlotte-lock: 13 payloads with no lock gave rc 0 each; with a live `.tmp/charlotte.lock` the heredoc text `scripts/stack-lock.sh --label q -- supabase db reset`, a `git commit -m "...stack-lock.sh ... -- supabase db reset..."` and `grep -n "stack-lock.sh --label x -- preflight.sh" README.md` gave rc 2. The two undesigned denials are limited to a live Charlotte lock.
- M3 is the one coordinator-relevant shape.

## 6. Restart marker

No marker. The flip rewrites settings files only; it touches no container. Its effect on a restart in progress is that the next step runs under hooks, and all documented steps pass them except bare `supabase start`/`stop` (M3). `.tmp/401-restart/restart.sh:2` runs under `scripts/stack-lock.sh`, which `flip.sh` refuses (non-empty `owner.txt`, held flock). Step-by-step manual restarts hold no lock between steps (`docs/development/supabase-local-stack.md:308`), so the peer confirmation is the only guard there; fix M3 first, then a flip landing between steps cannot strand the stack. A cron-started restart session after the flip simply runs with hooks on.

## Order before the flip

1. Fix H1 to H3, M1, M2 (fork: `flip.sh`, `flip-test.sh`, protect hook, its tests; igaming: `hooks-apply.sh`, canary rows for H2/H3).
2. Fix M3 (doc), M4 (message, doc).
3. Fresh review of the diff only; `flip-test.sh` green with the L1/L2 cases; canaries green.
4. Then the CEO order at the end of the earlier pre-flip check (`*PREFLIP-CHECK.md` in this directory).
