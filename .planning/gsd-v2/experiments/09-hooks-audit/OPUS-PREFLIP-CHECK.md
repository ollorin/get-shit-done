NO-GO

# 09 Hooks audit: final pre-flip check (2026-11-01)

Hooks themselves are fit to turn on: no coordinator command is blocked or altered. The flip tooling is not: `--smoke` cannot prove hooks fire, and `--apply` can destroy the only way back. All three blockers are in `flip.sh`. No hook or installer change is needed before the flip.

Checked at igaming `6f3fe64f7` (no commit after `83457b057` touches hook paths) and fork `5df11b1`. Real `~/.claude/settings.json`, `.claude/settings.local.json` and `~/.claude/RTK.md` keep their original mtimes. Probes live in `igaming/.tmp/preflip-check/` (`q1..q4`, `mut.sh`, `replay.py`, `corpus.py`).

## Blockers (exact fixes)

**B1 HIGH. `flip.sh --smoke` tests nothing useful and can report success.** Four separate defects at `flip.sh:167-178`:

| Defect | Evidence |
|---|---|
| `--allowedTools Bash "<prompt>"`: the flag is variadic and swallows the prompt | Real CLI, same flag order, `</dev/null`: `Error: Input must be provided either through stdin or as a prompt argument` |
| `claude -p` inherits the `while read` stdin (`done < <(smoke_rows)`, `:177`) and consumes the remaining rows | Stub that reads stdin like the real CLI: 1 call of 8, `STDIN_BYTES=433 first=git push origin zz-nosuch...`, then `flip: smoke ok`, rc 0. Real CLI with piped `ROWDATA-7Q42`: the model answered about that token and never saw the instruction |
| `2>&1` merges CLI config warnings into `$out`: row 8 (`EMPTY`) reads as WRONG | Real stderr carried the permission-rule warnings in all 3 runs |
| Same merge breaks row 7 (`:172`): `tr -dc 0-9` picks up digits from warnings | Real stderr digits: `2121`. A 10-line RTK result becomes `212110`, above 8000, so "RTK off" passes with RTK on |

In the real flow the first model call gets the seven remaining rows as its whole prompt, with Bash pre-approved. What it then does is unverified. Also, the "main session" final step prints only in the dry-run branch (`:178`).

Fix:
```bash
out=$(cd "$PROJECT_DIR" && claude -p "Run exactly ...: $cmd" <existing flags> </dev/null 2>/dev/null)
```
Prompt first, stdin closed, stderr dropped. Verified on the real CLI: `echo smoke-ok-123` returned exactly that. Print the final-step text in both branches. Extend `flip-test.sh` case 6 with a stub `claude` that asserts 8 calls, an empty stdin, and the prompt not following `--allowedTools`. Case 6 today only greps `--dry-run` output, which is why this passed.

**B2 HIGH. `--apply` continues when the backup fails.** `flip.sh:127-130` checks nothing. Executed with an unwritable backup dir (P1): rc 0, `flip: applied. Backup: <dir that does not exist>`, all three files changed, then `--rollback` says `no backup recorded`. On disk-full the later `cp` also truncates the target. Rollback has the same hole (P2): `cp` failed `Permission denied`, yet rc 0, `flip: rolled back`, marker removed.

Fix:
```bash
mkdir -p "$b" || die "cannot create backup dir; nothing changed"
cp "$USER_SETTINGS" "$b/settings.json" && cp "$LOCAL_SETTINGS" "$b/settings.local.json" || die "backup failed; nothing changed"
if [ -f "$RTK_MD" ]; then cp "$RTK_MD" "$b/RTK.md" || die "backup failed; nothing changed"; else : > "$b/RTK.md.absent"; fi
cmp -s "$USER_SETTINGS" "$b/settings.json" && cmp -s "$LOCAL_SETTINGS" "$b/settings.local.json" || die "backup mismatch; nothing changed"
echo "$b" > "$BACKUP_ROOT/latest" && echo "$b" > "$APPLIED" || die "cannot record backup; nothing changed"
```
In `do_rollback`: first line `[ -f "$APPLIED" ] || die "nothing applied"` (P6: a second rollback silently removed a later permission rule, rc 0). Each `cp` at `:188-189` gets `|| die "rollback incomplete; marker kept"`.

**B3 MED-HIGH. Cleanup deletes the backup after 2 days.** `BACKUP_ROOT` is `.tmp/hooks-flip-backup` (`flip.sh:33`). It is on neither keep list (`.planning/cleanup-keep.txt`, `.tmp/cron-prompts.md:17`), and both delete `.tmp` top-level entries older than 2 days. That also removes `latest` and the `applied` guard, so rollback dies and a second apply becomes possible.

Fix: `BACKUP_ROOT="$PROJECT_DIR/.tmp/gsd-v2/hooks-flip-backup"` (`gsd-v2` is on both lists) and update `flip-test.sh:69`.

**After the fix:** fresh independent review of the `flip.sh`/`flip-test.sh` diff only, `flip-test.sh` green. No repeat of this check unless a hook file changes. Batch N2 and N9 (same file).

## 1. Section C and R1-R9 on disk

| Item | Status | Evidence |
|---|---|---|
| C1 hook patch: A1-A3, A4/R2, A5-A7 | closed | 29 ruling payloads re-run, all deny (`q1.txt`) |
| A8 fail closed | closed | `{not json` and empty stdin: rc 2 on 8 project hooks and protect |
| A9 perf | closed per review, not re-measured | largest replay item finished inside the 60 s limit |
| A10-A14 | closed | `/tmp` and fork `git commit` allowed; push variants deny; `git merge x && git reset --hard` no decision; `gh api ... merge`, `HEAD:main`, `bash -c "gh pr merge"` ask |
| A15, A16 | closed in fork, live only after install | `sed -i`/`cp` to managed hooks deny; `write_text` denies; `git apply` of a real protected patch denies. Variables not chased, as ruled |
| C1 "rounds to zero" | closed by rule change | Round 2 was not zero and its fixes had no further round. `CLAUDE.md` caps non-high-stakes plans at 2 rounds unless round 2 has CRITICAL/HIGH; it had none |
| C2 canaries moved, reasons, wiring, mutants | closed, one survivor (N7) | `scripts/preflight.sh:663`; 10 fresh mutants below |
| C3 replay | closed | 6,000 rows re-run: redirect 130 (limit 140), check-test 2 (limit 3), supabase 2; no R2 shape denied |
| C4 fork, install | code closed, install not run | `flip.sh:51` refuses until `gsd-hook-lib.js` exists; absent today, as expected |
| C5 `hooks-apply.sh`, `flip.sh` | `hooks-apply.sh` closed; **`flip.sh` not closed: B1-B3** | throwaway clone: dry-run 431/0, tampered patch refused, non-TTY refused. Real apply path not exercised |
| C6 CLAUDE.md, RTK.md | closed | RTK.md rewrite at `flip.sh:98-111` |
| Smoke table | **not closed: B1** | |
| Rollback | **not closed: B2, B3; "agents cannot" is false: N3** | |
| R1, R2, R5, R6, R9 | closed | payloads above; `flip.sh --apply` unregisters exactly 5 entries (executed on fixture) |
| R3 reminder | closed; delivery unverified | emits `additionalContext`. Dated tightening recorded only in a comment (`check-test-command.pl:146`): N10 |
| R4 | closed | `install.js:1751`; install after flip leaves settings byte-identical |
| R7 | open by ruling (post-flip) | committed, unregistered. `git -c core.hooksPath=/dev/null commit`, `--no-verify`, `--no-check`, `git stash` deny; `git merge x --no-verify` rc 0: N8 |
| R8 | **partly open: N4** | `Hook-Patch:` preflight control absent from `scripts/preflight.sh`. RESULT.md calls it outside section C. It is R8's stated compensation for the protect gaps |

## 2. Coordinator commands through the hooks

Nothing blocked or rewritten. 65 shapes went through all 6 project Bash hooks plus protect and charlotte-lock (fork versions); `q2.txt`, `q2.out`. All allowed: `deno task test`, `deno test`, `npx nx test`, `deno check|lint|fmt`, `run-integration-tests.sh`, `git commit -- <paths>` (plain, heredoc, `-F`, `-C`), `git worktree add|remove`, stack-locked single scenarios in 6 spellings, stack-locked and bare `supabase db reset`, `preflight.sh`, supervisor, gate scripts, stack restart steps. No hook emits `updatedInput` once `rtk-rewrite` is unregistered.

Expected non-allow results:
- `deno test *.integration.test.ts`: reminder only.
- `git merge <x>` on a feature branch: grant. Compound merge: no decision.

Independent replay of the 1,230 newest unique Bash commands from session logs:

| Hook | Result | Reading |
|---|---|---|
| redirect-recursive-search | 13 deny | recursive grep, by design |
| check-git-merge-target | 2 ask | `~/charlotte` merges, correct |
| protect | 22 deny | 16 from the hook-fix agent (editing hooks or fork hook source), 4 from audit commands naming the flag, 2 from this check (N6). None from a phase coordinator |

Contract check on commit: 0.35-0.7 s, passes at HEAD and in `wt-401-09`, `wt-404-04`. It denies in `.tmp/merge-scratch` (old branch `scratch/v0133-merge`), a real result for that tree; not a live path.

Under a live Charlotte lock, bare `db reset`, `preflight.sh` and `--reset-db` deny as designed. See N1 for the wrapped forms.

Unverified: how an `ask` behaves in an unattended coordinator. `git -C .tmp/wt-401-09 merge x` asks because that worktree is detached (`check-git-merge-target.pl:54`). 0 such commands in the replay. Probe: one unattended session running a merge in a detached worktree.

## 3. Did round 2 weaken a guard?

**F6: tightening, no weakening.** `nx test:integration` was never in the finding. `apps/api/project.json` maps that target to `bash ../../scripts/run-integration-tests.sh`, which execs `stack-lock.sh` (`:132`), so the deny's stated reason is wrong for this form. Impact is nil: 0 of 6,000 corpus commands, 0 references outside `.planning`, and the message names the equivalent command. Ruling: keep; changing it has no business value. Residual F6 gaps in N7.

**F4: yes, against never-deployed `7c0499d`. No, against what is installed.** Installed to fork, the only deny that becomes allow is the intended read `open('/tmp/a','w').write(open('.claude/hooks/x').read())`. Everything else is stronger. Shapes `7c0499d` denied and the fork allows:

| Payload | Why it passes |
|---|---|
| `y=Path('.claude/hooks/a'); x=Path('/tmp/a'); y.write_text('2')` | nearest `Path(` is the safe one (`gsd-protect-managed-files.js:140`) |
| `os.chdir('.claude/hooks'); open('a','w')` (`-c` and heredoc) | literal `a` is safe; `chdir` not seen |
| `node -e "process.chdir('.claude/hooks'); ...writeFileSync('a','1')"` | same |
| `D=.claude/hooks; python3 -c "open('$D/a','w')"`, same with `sys.argv[1]` | region excludes the assignment (`:154-199`) |
| `cd .claude/hooks && python3 -c "open('a','w')"` | one-letter names look like modes (`:82`); `open('zz','w')` and real names deny |

Real hook-edit shapes still deny: `cd .claude/hooks/lib && python3 - <<PY ... p='ShellParse.pm'; open(p,'w')...`.

**Attack matrix** (`q3.txt`, 108 payloads, three protect versions; `q3.out`). `tee`, `dd of=`, plain `cp`, `mv`, `ln`, `rm`, `truncate`, `chmod`, `touch`, `sponge`, `install`, `sed -i`, `perl -pi`, `git checkout|restore|apply` all deny. Gaps present in all three versions (not regressions): N5.

## 4. `flip.sh`

| Question | Answer |
|---|---|
| Only TTY replacement? | In the script, yes (`need_tty`, `:38-47`). Missing value and a 7-char quote refused. But `script -q /dev/null bash flip.sh --apply` with a piped `FLIP` passes the TTY gate (P7c), as `flip-test.sh` itself does: N3 |
| Logged before change? | Yes (`:126` before `:127`). Unwritable log: `nothing changed`. Refused and dry runs log nothing |
| Stack lock held? | Refused: non-empty `owner.txt`, or a held flock. Checked against the real `stack-lock.ts` with `--lock-file` on a fixture: python probe rc 1 during hold, 0 after. **But** the check runs before the canaries, and a lock taken during them is missed (P5, applied rc 0): N2 |
| OrbStack restarting? | Refused only while an `orbctl`/`docker`/`supabase`/`nx` start-stop process is alive (`:60`). Between restart steps it passes: N9 |
| Rollback byte-identical? | Yes on a clean run (cases 1c, 2b, 3b, 4, 7d). Not when `cp` fails: B2 |
| Partial failure mid-apply? | Local write fails (P2): user settings and RTK.md changed, flag still set, rc 1, safe (all hooks off), rollback restores. User write fails (P3): nothing changed but `applied` is set, so retry says "already applied" until rollback. RTK write fails (P4): ignored, rc 0. Backup fails (P1): B2 |
| `--smoke` proves hooks fire? | No: B1 |

`flip-test.sh`: `flip-test: all pass` (25 cases, rc 0). It does not exercise any B1-B3 path.

## 5. Installer

`node bin/install.js --global --claude`, `HOME` and `--config-dir` in `.tmp/preflip-check/inst (since removed)`, on a copy of real `agents commands get-shit-done hooks skills gsd-local-patches settings.json RTK.md CLAUDE.md manifest`. Runtime 13.6 s with an empty npm cache, rc 0. Fork tree unchanged. Path-normalised diff against the real copy:

| Path | Change |
|---|---|
| `agents/gsd-phase-coordinator.md`, `workflows/execute-phase.md` | review tiering text; matches `CLAUDE.md` (F3 disproved holds) |
| `workflows/execute-roadmap.md` | 45 min tick, 4 h report, 12 h cleanup; intended policy |
| `bin/hooks/gsd-protect-managed-files.js`, `.test.js`, `gsd-tools.test.js` | A15/A16/F4 |
| `bin/hooks/gsd-guard-bash.js`, `.test.js`, `gsd-hook-lib.js` | new, unregistered |
| `get-shit-done/compression-cache/`, `compression-state.json` | removed (doc-compression state) |
| `gsd-file-manifest.json`, `gsd-local-patches/` | rewritten |

**Unchanged, byte for byte:** `settings.json` (hook set, order, every user key), `RTK.md`, `CLAUDE.md`, `skills`, `~/.claude/hooks`, the other 27 agents.

**Undoes nothing:**
- `experimental: cacheTtl: 1h` stays in all 4 agents; it is in fork source.
- `gsd2-runner.md` is byte-identical; it is in fork source and `install.js:1583` only unlinks `gsd-*`.
- `gsd-test-writer` is identical. `gsd-charlotte-qa` keeps its frontmatter.
- Charlotte scenario settings live in `igaming/apps/e2e-charlotte/runner/run.ts`; the installer does not touch the repo.
- Temp `HOME` afterwards holds only `.npm` and `Library`, so no `.claude.json` or MCP merge.

**After a flip:** a second install leaves flipped settings byte-identical; no re-registration. Canaries against the post-install tree (`HOME` pointed at the temp copy): `canaries: pass=431 fail=0`. So `flip.sh:67` will pass after the real install.

**Window:** `get-shit-done/` is wiped and recopied (`install.js:1553`); `rm` of `node_modules` took 0.44 s, then `npm ci` runs with a 30 s limit (`:1434`). A live `gsd-tools.js` call can fail for about a second while the file is absent. Tested without `node_modules`: `current-timestamp` and `progress` work; sqlite-backed commands are unverified. It writes nothing under `.planning`, so a failure costs a retry, not corruption. With hooks still off, nothing else depends on the tree. If `npm ci` and its fallback both time out, install continues with a visible warning and sqlite-backed features stay off until re-run. Run at a plan boundary, as already advised.

**Notice to ignore:** the real run will print `Local patches detected: agents/gsd-phase-coordinator.md ... Run /gsd:reapply-patches`. Do not run it: it restores the old review text. (`gsd-executor.md` also appears in a temp run; that is an artefact of path substitution in the backup comparison.)

## 6. Tests

Stack safety confirmed first: the corpus has only Bash, Write, Edit and Read rows fed to hook scripts, no `mcp__*` or Subagent events, so the charlotte-lock write path is unreachable (`gsd-charlotte-lock.js:174-176`). Temp repos come from `run-canaries.sh:20` in the default `$TMPDIR`.

- `canaries: pass=431 fail=0 (HOOKS_DIR=/Users/ollorin/igaming-platform/.claude/hooks)`, 32.2 s wall.
- Fork hook and installer test files: `# tests 343 / # pass 343 / # fail 0`. Full `npm test` not run (RESULT.md claims 1536).
- Mutants on round-2 code: task-set 8 fail, nx e2e 19, nx integration 2, locked scenario 3, locked any 1, run.ts locked 1, merge grant 1, drift skip 2, wrapper unwrap 1. **Survivor: `run-perl.sh:8` crash branch changed to exit 0 gives 431/0** (N7).

## 7. Rulings

| Item | Blocks? | Ruling |
|---|---|---|
| F8 runtime-assembled commands (`G=grep; $G -r`, `os.system`, `eval "$(base64 -d)"`) | No | **No business value.** The rule steers honest agents off lossy, unbounded search; it protects no money or data. 0 replay commands use these. Catching them needs an evaluator, which RULING A16 rejects |
| F11 canary runtime | No | **No business value.** Measured 32 s, not 60, once per preflight. A parallel runner is a rewrite for seconds saved |
| F11 machine coupling | No | **No business value today:** one machine, AI-only team, documented in `gate-estate.md:52`. Reopen when a second machine or CI needs preflight parity |
| Lone `git merge` into non-main emits `allow` | No | Keep; RULING A13 asked for exactly this. `.claude/settings.local.json:16` already allows `Bash(git:*)`, so the grant adds no reach. LOW residual: it also grants `git merge x --no-verify` and `git -c core.hooksPath=/dev/null merge x`. R7 closes the second; N8 closes the first |

## Non-blockers

Each stays open until fixed. Hook edits are cheapest before the flip, but they must not hold it. After the flip they go through `hooks-apply.sh` or a fork install.

**MED**
- **N1 Charlotte lock misses the wrapped forms, the project's standard way to reset.** With a live lock, `scripts/stack-lock.sh --label q -- npx supabase db reset` and `... -- scripts/preflight.sh` both give rc 0 (bare forms rc 2). A stack lock does not serialise against a Charlotte QA agent that holds no stack lock. `gsd-charlotte-lock.js:27`: add `stack-lock\.(?:sh|ts)\b[^;&|\n]*\s--\s` to `PREFIX`, not a bare `--` (that would catch `git commit -- scripts/preflight.sh`). Add tests. Worth doing before the install.
- **N2 Lock check before a 32 s canary run (P5).** Move `flip.sh:65-69` to the top of `refusals`, and re-check the lock lines right before `:127`, since a TTY prompt can wait indefinitely. Same batch as blockers.
- **N3 Rollback is reachable by agents, contrary to the ruling.** `flip.sh --rollback --approved-by-ceo "hook blocks my test"` and `script -q /dev/null bash flip.sh --rollback` both pass protect, and the first passes the script (flag not verifiable). `hooks-apply.sh:45` has the same `script` gap. Fix: protect denies a `flip.sh` command with `--apply|--rollback`, so after the flip only a terminal runs it. Update the RULING sentence.
- **N4 R8 detective control unbuilt.** In `scripts/preflight.sh`: fail when a commit in `83457b057..HEAD -- .claude/hooks .claude/settings.json` lacks a `Hook-Patch:` trailer. The floor SHA avoids flagging this branch's history. Canary row plus demonstrated failure per `guard-authoring.md`.
- **N5 Protect gaps, honest shapes first** (`gsd-protect-managed-files.js`):
  - Trailing redirect defeats the last-argument rule: `cp /tmp/x .claude/settings.json 2>/dev/null`, `ln -s ... 2>/dev/null` (`:205-207`). Strip redirects first.
  - Directory targets: `cp /tmp/settings.json .claude/`, `cp -R /tmp/hooks .claude/`, `rsync -a /tmp/hooks .claude/`. Treat `.claude/?` as a protected last argument.
  - Persisted cwd: payload `cwd=.claude/hooks` with `echo 1 > check-test-command.sh` or `sed -i` is allowed, and `cwd` is unused here (`:267-268`). Seed `cwdHooks`/`cwdClaude` from it.
  - `cd .claude; cd hooks; ...`, `pushd`, `dd of=` after cd.
  - Interpreter calls missing from `SCRIPT_WRITE_RE:89-97`: `Deno.writeTextFileSync` (this repo's main runtime), `Bun.write`, `File.write`, perl 3-arg `open`.

**LOW**
- **N6** `GIT_WRITE_RE:88` matches words in paths: `git diff A B -- .claude/hooks scripts/hooks-apply.sh` denies "rewrites a protected path". Anchor to the subcommand position. Audit commands only. Related: a python heredoc editing fork hook source that mentions `.claude/hooks` also denies (executed); the Edit tool on the fork path is the route.
- **N7** Round-2 coverage:
  - `npx nx e2e-charlotte:regression` is allowed. At `check-test-command.pl:85` split `$cmd` on `:` as the `run` branch does.
  - `cd apps/e2e-charlotte/runner && deno run ./run.ts --tags=regression` is allowed (`:116`).
  - Add a canary for the `run-perl.sh` crash branch: a string `tool_input` reaches it.
  - Restore F4 coverage for `chdir`, nearest-`Path` and `$D` assignment (section 3).
- **N8** `gsd-guard-bash.js` allows `git merge --no-verify`. Fix before R7 registration.
- **N9** `flip.sh` robustness:
  - Set `applied` only after the first write succeeds (P3).
  - Warn on RTK write failure (P4).
  - Replace in-place `cp` with same-directory temp plus `mv`.
  - `.tmp/charlotte.lock` is vacuous pre-flip because nothing takes it while hooks are off; add `pgrep -f 'runner/run\.ts'`.
  - `pgrep` (`:60`) also matches prompt text in a `claude -p` argv (fails safe, names the reason) and misses gaps between restart steps.
  - A preflight within 30 minutes makes smoke row 2 report WRONG; check the marker age first.
- **N10** R3's conversion to deny at 401/402 close is tracked only in a code comment. Add it to the phase-close checklist.

## Execution notes

- Canaries ran in the default `$TMPDIR`, not `.tmp`, because the runner's contract uses throwaway repos there; they self-delete.
- Three short `claude -p` calls and one `--depth 1` clone were used for proof.
- No stack, docker or supabase command was run. `stack-lock.sh` was run only with fixture `--lock-file`/`--owner-file` and `sleep`.

## CEO order after the fixes

1. `cd ~/get-shit-done && node bin/install.js --global --claude`; ignore the reapply notice.
2. `flip.sh --apply --dry-run`.
3. `flip.sh --apply`, in a window with no stack lock.
4. `flip.sh --smoke` from a new terminal.
5. Have the main session run the flag probe. If it prints, restart long-lived sessions at a phase boundary.

Whether running sessions pick up the change stays unverified until step 5.
