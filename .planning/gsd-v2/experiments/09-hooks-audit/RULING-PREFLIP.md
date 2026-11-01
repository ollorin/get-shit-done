GO after 7 small fixes (H1 H2 H3 M1 M2 M3 L1) and one closing check, with no new review round. M4 follows right after the flip. L2 and L3 are closed with no business value.

# 09 Hooks audit: ruling on the pre-flip findings (2026-11-01)

Probes ran on temp copies in `igaming/.tmp/preflip-ruling/`. Real settings, `~/.claude`, the stack and `flip.sh --apply|--rollback` on real files were not touched (`~/.claude/settings.json` mtime Oct 31, `.claude/settings.local.json` mtime Sep 24). Ready-made results of the fixes: `cand/flip.sh`, `cand/flip-test.sh`, `ha_repo/scripts/hooks-apply.sh`, `fh_fork_tmp/gsd-protect-managed-files.js`.

## Rulings

| ID | Ruling | Why |
|---|---|---|
| H1 | **FIX-BEFORE-FLIP**, script refusal only (fix 1) | The rollback hole exists only once hooks are on. Today nothing needs bypassing |
| H2 | **FIX-BEFORE-FLIP**, one line + 6 canary rows (fix 2) | Same exposure as today, so the flip does not make it worse. But the fork install has not run yet (installed protect is dated Oct 29), so this saves a second install and costs nothing |
| H3 | **FIX-BEFORE-FLIP**, script refusal + corrected claim (fix 3) | The refused-TTY path has a ready template (`flip-test.sh:25`), and the gate's claim overstates what it proves |
| M1 | **FIX-BEFORE-FLIP** (fix 4) | `--apply` is one shot: after the flip this is inert, so a later fix is worthless. Two lines, using the helper from fix 1 |
| M2 | **FIX-BEFORE-FLIP** (fix 5) | Caused by the flip's own verification: a correct flip prints `consider: flip.sh --rollback`, and RULING.md:214 makes any wrong row a rollback trigger |
| M3 | **FIX-BEFORE-FLIP**, corrected doc text (fix 6) | The deny starts at the flip and lands with the stack down. The report's text is wrong, see fix 6 |
| L1 | **FIX-BEFORE-FLIP** (fix 7) | One line in a file fix 5 already edits. It guards a defect that really happened (B1). Mutant fails 10c, re-run |
| M4 | **FIX-AFTER-FLIP**, ordinary commit (below) | Nothing trips it until a settings or hook commit exists, and the flip makes none: its settings targets are `~/.claude/settings.json`, outside the repo, and the gitignored `settings.local.json` |
| L2 | **NO-BUSINESS-VALUE** | It tests a fail-safe check for a hypothetical (a child reading fd 3) in a one-shot script, and needs a production line changed. A short run is already visible in the final `N of 8 rows` line |
| L3 | **NO-BUSINESS-VALUE** | Works as designed, and the failure names its remedy (`hook-patch-trailer-check.sh:27-28`). No branch fails today |

**Route correction.** None of these needs `hooks-apply.sh`, before or after the flip. No fix touches `.claude/hooks/**`. Executed through fork protect: `sed -i` on `scripts/hooks-apply.sh`, `scripts/validation/hook-patch-trailer-check.sh`, `flip.sh` and fork `gsd-protect-managed-files.js` all allow, and so does `node bin/install.js --global --claude`. So the report's reason for H3 ("the flip makes this the only sanctioned path") applies to hook files, not to fixing this script.

**Dropped from the report, with reasons:**
- H1 layer 2 (protect normalisation): the script refusal covers every spelling. Layer 2 misses `F=flip.sh; bash "$F" --rollback` anyway (executed). `--apply` is already refused by the marker.
- `sudo -v` in `need_tty`: an agent can `sed -i` the check out of `flip.sh` (executed: allowed), so no secret inside this script holds.
- H3's protect deny for `hooks-apply.sh <id>`: the script refusal is enough.
- M4's "patch file must exist in the tree": agents write those files too, so it proves no more than the trailer.

## The orchestrator's position, tested

**1. "Every bypass exists today": true for H2, false for H1, M2 and M3.** Those three start doing harm at the flip. Also, the trailer gate is already live whatever the flag says (`scripts/preflight.sh:668-669`), so the flip does not create that false assurance. The delay cost argument is right, but the cost is the loop, not the fixes: `flip.sh` changes 12 lines, and each fix is already proven here.

**2. "Text hooks steer, they do not stop deliberate evasion": right, and the evidence is stronger than the orphan.** An agent can edit `flip.sh`, or edit fork protect and reinstall. Allowed, executed. So no gate in these scripts is a boundary, and RULING A16 stands.

The honest-versus-deliberate split is too coarse, because it misses the agent that is blocked, not malicious, and told not to stop (`CLAUDE.md`: "Don't stop early or ask permission"). The test used here: **would a blocked agent reach this in one or two moves, with no intent to defeat a guard?** If yes, fix it, provided the fix adds no new mechanism. If it takes several deliberate steps, record it as residual and stop.

| Shape | Corpus (9,000 commands) | Result |
|---|---|---|
| `script -q` pty wrapper | 0 | Fix anyway: "needs a TTY" invites it and `flip-test.sh:25` shows how |
| Double-quoted interpreter one-liners using `\"` | 3 of 36; 0 target a protected path | A natural shape, one-line fix |
| Quoted `"--rollback"` | 0 | Covered by the script refusal |

After the fixes, a run that gets through needs all of: detach, remove `CLAUDECODE`, fake a pty, pipe the typed word (executed, probe 8). That is deliberate, so it is accepted as residual.

**3. The flag: removed from `--rollback`, kept on `--apply`, no self-disable code.**
- The quote is real: user turn at 2026-11-01T19:43:35Z, session `23b0ea8e`, recorded at `DECISIONS.md:25`. It answers "then a command for you" and delegates running the flip. It says nothing about undoing it, so removing the rollback flag takes nothing from the CEO.
- On `--apply` the flag can only turn hooks on. Once applied it is inert: a second `--apply --approved-by-ceo` is refused by `flip.sh:110-111` (executed). A self-disable would duplicate that.
- The flag stays unverifiable. It is a log line of the delegation, not a proof.

## Recovery when a bad hook blocks work and the CEO is away

**There is no agent rollback.** Blocked agents are exactly the ones who would use it, and it removes every guard at once. A stall is the safe way to fail: time is lost, nothing is damaged. Rejected as more arms race: a time window on the flag, auto-rollback on a failed smoke, and a secret relayed by Telegram.

| Failure | Agent-safe response |
|---|---|
| A deny with a retype path | Retype. Not a rollback trigger (RULING.md:214) |
| Bad fork hook (protect, charlotte-lock) | Fix in the fork, review, `node bin/install.js --global --claude` (allowed, executed) |
| Bad project hook (`.claude/hooks/**`) | Prepare `.planning/hook-patches/<id>.patch`, stop that path, report the exact string by Telegram. Other paths continue. Waits for the CEO's terminal |
| Smoke row 1, 2 or 4 wrong (a deny did not fire) | Guards are no worse than today, nothing stalls. Keep working, fix forward |
| Smoke row 3, 5 or 6 wrong (an allowed shape denied) | Same as the project-hook row |

The chance of needing this is low. Rows 3, 5, 6, 7 and 8 all pass the six project hooks. On the real CLI with hooks on (project settings only, in a copy), rows 2 and 4 returned `BLOCKED` at rc 0 and row 5 ran. The report sampled these rows only with hooks off, so this closes that gap. Row 1 stays unverified until the flip; protect's message contains both accepted words (`gsd-protect-managed-files.js:389`).

**Update RULING.md:214 triggers:** rollback remains the CEO's, from a terminal. The agent's duty on a trigger is to report, not act.

## Does any harm grow because hooks are on?

- **H3: partly, and the fix differs from what the report implies.** Closing the pty does not make the trailer mean anything. A hand-typed `Hook-Patch: nothing-reviewed-nothing-exists` passes the check (executed, rc 0), and `hooks-apply.sh:48` already says the review file proves nothing. The gate can only catch an unstamped commit, which is a real and useful job, so the claim must say that (fix 3).
- **H1, M2, M3: yes**, ruled above.
- **H2, M1, L1-L3: no.**
- **M4: no.** The check is already live and nothing trips it yet.

## Exact fixes

**1. H1, `flip.sh`.** After `:52`:
```bash
real() { python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; }
is_fixture() { [ "$(real "$CLAUDE_HOME")" != "$(real "$HOME/.claude")" ] && [ "$(real "$PROJECT_DIR")" != "$(real "$HOME/igaming-platform")" ]; } # both paths away from the real defaults: tests only
under_agent() { [ -n "${CLAUDECODE:-}" ] || ps -axo pid=,ppid=,comm= | awk -v p=$$ '{pp[$1]=$2; x=$0; sub(/^ *[0-9]+ +[0-9]+ +/,"",x); c[$1]=x} END{while(p>1&&p in pp){n=c[p]; sub(/.*\//,"",n); if(n ~ /^claude/) exit 0; p=pp[p]} exit 1}'; }
```
This differs from the report's awk in two ways, both executed. The report's `$3` misses a Claude binary whose path has a space (`agent=0`, this form `agent=1`). `CLAUDECODE` also catches a plain `nohup` orphan (report `agent=0`, this form `agent=1`), which shrinks the residual the report named.

First line of `do_rollback`:
```bash
is_fixture || { ! under_agent || die "rollback runs only from a terminal outside Claude Code"; [ "$APPROVED" = 0 ] || die "--approved-by-ceo is not accepted for --rollback"; }
```
`flip-test.sh`, before the last line (fixtures skip the refusal, so without this a deleted line survives; mutant executed, it fails 15):
```bash
# 15. real paths (no fixture): --rollback refuses an agent and refuses the flag from anyone
d=$(mktemp -d); mkdir -p "$d/.claude" "$d/igaming-platform/.claude"
o=$(env -u CLAUDE_HOME -u PROJECT_DIR HOME="$d" bash "$FLIP_SH" --rollback --approved-by-ceo "any eight chars" </dev/null 2>&1); r=$?
[ "$r" != 0 ] && printf '%s' "$o" | grep -qE 'outside Claude Code|not accepted' && ok "15 real-path rollback refuses an agent and the flag" || bad "15 rc=$r: $o"
rm -rf "$d"
```
Update the sentences that change: `flip.sh:3,6-12,28,277`, `flip-test.sh:64`, RULING.md:214. State the truth: agents are refused by ancestor and environment, this steers rather than enforces, and a deliberately detached process still passes.

**2. H2, `gsd-protect-managed-files.js:351`:**
```js
const regions = interpreterRegions(command).map(r => r.replace(/\\(["'])/g, '$1'));
```
Executed: protect tests 240/240; six payloads deny; the two reads allow; 88 corpus rows it could affect, 0 verdict changes. Add the six payloads as canary rows with hook `fork:gsd-protect-managed-files.js` (`run-canaries.sh:71` reads the fork, so they pass before install).

**3. H3, `scripts/hooks-apply.sh`.** Insert before `:45` (`--dry-run` exits earlier and keeps working, executed):
```bash
under_agent() { [ -n "${CLAUDECODE:-}" ] || ps -axo pid=,ppid=,comm= | awk -v p=$$ '{pp[$1]=$2; x=$0; sub(/^ *[0-9]+ +[0-9]+ +/,"",x); c[$1]=x} END{while(p>1&&p in pp){n=c[p]; sub(/.*\//,"",n); if(n ~ /^claude/) exit 0; p=pp[p]} exit 1}'; }
under_agent && die "runs only from a terminal outside Claude Code (an agent can fake a TTY with script(1))"
```
Executed in a throwaway repo: before, committed under `script` with trailer `p1`; after, refused and the file unchanged.

Correct the claims:
- `docs/testing/gate-estate.md:53`, add: "Detects an unstamped commit. A trailer is free text (a hand-typed one passes), so a pass does not prove a person applied the patch."
- `hooks-apply.sh:3` and `:45`, and RULING.md:119: drop "Bash tool calls have no TTY".

**4. M1, `flip.sh`** (executed: with the variable set and non-fixture paths the runner refusal prints again; committed version prints none):
```bash
FLIP_FIXTURE=$(is_fixture && echo 1 || echo 0) python3 -I - <<'PY'      # :57
root=os.environ.get('FLIP_PROCS_ROOT_PID') if os.environ.get('FLIP_FIXTURE')=='1' else None   # :63
```

**5. M2, `flip.sh`:**
```bash
'ls ~/Library/LaunchAgents | grep -c gsd' ZERO 'no resume armed'                  # :220
ZERO)    t=$(printf '%s' "$out" | tr -d '[:space:]'); [ "$t" = 0 ] && v=ok;;      # replaces the EMPTY arm at :248
```
Real CLI: `0` in 2 of 2 further runs, on top of the report's 2. Update the comment at `:211` (the report says `:222`), the stub at `flip-test.sh:135` (`echo 0`), and `EMPTY` to `ZERO` at `flip-test.sh:149,156,219,220`.

**6. M3, `docs/development/supabase-local-stack.md`.** The report's text omits the env load. The working recipe loads it first (`apps/api/project.json:25`, `.tmp/401-restart/restart.sh:65-70`), so use:
- `:315` step 6: `set -a && . ./.env.test && set +a && npx supabase start --exclude edge-runtime`
- `:223`: `cd apps/api && npx supabase stop --project-id api && set -a && . ./.env.test && set +a && npx supabase start --exclude edge-runtime`
- One sentence: bare `supabase start` and `stop` are denied.

The hook allows the start form and the stop-then-start form (rc 0, executed).

**7. L1, `flip-test.sh:142`:** `printf ROWDATA | PATH="$d/stubbin:$PATH" STUB_LOG="$d/stub.log" CLAUDE_HOME="$d/claude" PROJECT_DIR="$d/proj" bash "$FLIP_SH" --smoke >"$d/smoke.out" 2>&1; echo $?`

Candidate with fixes 1, 4, 5, 7: `flip-test: all pass`, 48 PASS.

**M4, right after the smoke, same session, ordinary commit, not handed to a phase:**
- `hook-patch-trailer-check.sh:45`: name both cases. Hooks and settings go through `scripts/hooks-apply.sh`; a revert or amend keeps the trailer in the last paragraph.
- `gate-estate.md:53`: same text.
- `hooks-apply.sh:32`: accept `.claude/settings.json`; for such a patch `--dry-run` stops after `git apply --check`, because `:39-40` copy only hooks. This replaces the report's hand-typed `manual-<reason>` trailer: the CEO does not edit files (RULING.md:67), and without it a legitimate settings commit has no route at all.

## Closing rule

One fix dispatch applies fixes 1-7. Then one fresh agent that did not implement them runs this list on the final tree and quotes each result. It reviews nothing else.

| # | Check | Pass |
|---|---|---|
| 1 | `git diff` in both repos | Only the files named in fixes 1-7 and the sentences they name |
| 2 | `bash flip-test.sh` | `flip-test: all pass`, includes case 15 |
| 3 | `node --test` on the protect test file | 0 fail |
| 4 | `run-canaries.sh` | `fail=0`, six new rows present |
| 5 | Fake `HOME` with both real-default paths under it: `--rollback --approved-by-ceo "any eight chars"`, and `--rollback` under `script` | Both refused, files unchanged |
| 6 | Same fake `HOME`: `--apply --approved-by-ceo "<quote>"` | Reaches `applied`; the new line does not block it |
| 7 | Throwaway repo: `hooks-apply.sh p1` under `script`, then `--dry-run` | Refused, file unchanged; dry-run rc 0 |
| 8 | Fake `HOME`, fake runner process, `FLIP_PROCS_ROOT_PID=999999`, `--apply --dry-run` | Runner refusal prints |
| 9 | Real CLI, row 8 once | `ok` under the ZERO arm |
| 10 | The two M3 forms through `check-supabase-command.sh` | rc 0 |

**All 10 pass: the flip proceeds** in the existing order (fork install, `--apply --dry-run`, `--apply --approved-by-ceo` at the joint plan boundary with no stack lock, `--smoke`, main-session probe), under `DECISIONS.md:20,25`.

**A failing line:** fix that item and re-run that line plus line 2. The same line failing twice goes to one fresh independent ruling on that line alone.

**Anything else noticed, including a new bypass, does not hold the flip** and goes on the after-flip list. The only exceptions are a regression from this diff that breaks `--apply`, `--smoke` or a real-terminal `--rollback`, or that denies a coordinator shape from section 2 of `*PREFLIP-CHECK.md`. There is no further review round on this batch. Any later file change is covered by re-running lines 2-4, not by a new review.

## Unverified

- Row 1 under real hooks, and whether running sessions pick up the change: settled by the smoke and the main-session probe at the flip.
- `under_agent` on a real terminal: the walk is executed for agent and orphan cases, and the CEO's chain was read (`Terminal, login, zsh`), but no person ran it. A false refusal would name itself and can be cleared by opening a plain terminal.
- A future CLI that renames its process and drops `CLAUDECODE` would silently disable the refusal. Line 5 proves it only for today's CLI.

## CEO

Notice, no decision needed: while you are away, a project hook that wrongly blocks work stalls that path until you run `flip.sh --rollback` from your own terminal.
