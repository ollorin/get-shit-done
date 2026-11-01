# 09 Hooks audit: independent review round 2 (2026-11-01)

Reviewer: fresh Sonnet, read-only. Scope: igaming `bb68dceb7`, `fea0a00f4`, `7b71e906b`; fork `1fb2e26`, `7c0499d`, `25c4168`, `906216d`. Spec: `RULING.md` sections A, B (R1-R9), C. Nothing in igaming, the fork or the real `~/.claude` was edited. Probes ran against the real hook scripts with synthetic payloads, a local clone (`/tmp/rv2/clone`), temp copies of the hooks (`/tmp/rv2/mut`), and a temp config dir (`/tmp/rv2/cfg`, `/tmp/rv2/cfg2`) with `HOME=/tmp/rv2/ihome`. No docker, supabase or `claude -p`.

## Verdict

GO for the hook logic and for `flip.sh` as a single run. Not zero findings: **0 HIGH, 6 MED, 7 LOW, 3 INFO**. RESULT.md "After fix batch" holds on every number I could re-measure (349/0 canaries, mutant killed, replay near 130, installer diff). Its own caveat stands: the second Sonnet round to zero and the Opus diff check were not run, and this round shows a second round would not have been zero. Two MEDs (F1, F2) hit the CEO's one-command flow and should be fixed before it is run.

## Verified claims

| Claim | Result | Evidence |
|---|---|---|
| Canaries `pass=349 fail=0` | confirmed, 31.7 s wall | `scripts/validation/hook-canaries/run-canaries.sh`; also 349/0 with `HOME` pointed at the post-install temp tree |
| Narrowing mutant killed | confirmed in the ruling's form; but 3 of my 6 mutants survive (F5) | `/tmp/rv2/mut/m1..m6` |
| Replay 130 of 6,000 | consistent: my independent 1,500 unique recent Bash commands (60 newest session logs) gave 28 redirect denials (1.9%) | all 28 inspected: 24 genuine `-r`/`-R` greps, 4 `rtk grep`. No false denial among them |
| Other 4 Bash hooks on the same 1,500 | 0 denials; 1 ask (a `git fetch`/merge-ish command, correct) | `/tmp/rv2/replay.tsv` |
| `flip.sh` unregisters exactly 5 entries, drops flag + local hooks block, other keys unchanged | confirmed | fixture run: `settings.json` round-trips byte-identical through `json.dump(indent=2)`; other keys equal after apply |
| Installer leaves `settings.json` alone | confirmed: byte-identical after normalising the config-dir path; no re-registration of check-update or doc-compression, also when run after the flip transform | `/tmp/rv2/cfg.settings.norm.json`, `cfg2` |
| Perf A9 | holds: 87 KB command 0.11 s, 1.7 MB 2.2 s, 8.7 MB 10-13 s, linear; 3,000-deep nesting, 200k-line unterminated heredoc, 3 MB single word all under 1 s | `/tmp/rv2/p.json` runs |

## Ruling conformance (item 1)

| Item | Status | Deviation |
|---|---|---|
| A1-A3, A5-A7 | implemented; every ruling payload now denies (`>` terminator, `--cwd`/`-c`, wrappers, `/bin/bash <<EOF`, `bash<<EOF`, `<<<`, `$((1<<N))`, `false \|\| grep -rn`, `egrep`, `$(grep -rn)` in `-m`) | none |
| A4/R2 | implemented: single scenario allowed only under `stack-lock.(sh\|ts) ... -- cmd` or supervisor; bulk tasks, `runner/run.ts`, 2 scenarios denied | `nx` targets are not covered (F6) |
| A8 | implemented: invalid JSON, empty stdin, top-level `null`/trailing junk all deny (rc 2); `PATH` without jq falls back to `/usr/bin/jq` | Perl hooks also deny a BOM and top-level arrays; the jq hooks allow them (F14, harmless) |
| A10-A14 | implemented: `cd ~/get-shit-done && git commit` skipped; `a; git commit`, `git -C` judged; `git merge x && git reset --hard` emits no decision; `gh api -X PUT .../merge`, `git push origin HEAD:main`, `bash -c "gh pr merge 1"` ask; marker forging variants deny | residual gaps F12 |
| A15/A16 (fork `7c0499d`) | implemented | introduces a new false-denial class (F4) |
| R1 | implemented as ruled; CLAUDE.md line rewritten; message names `git grep` and `zg query --rg` | stated: pipe-fed `rg` allowed. **Unstated**: `rg foo < file` also allowed (same reasoning, harmless). Bypasses F8 |
| R3 | implemented: `deno test x.integration.test.ts` without stack-lock exits 0 with `additionalContext`; `test:integration*` denies | `additionalContext` alone in a PreToolUse `hookSpecificOutput` is the ruling's own shape; delivery is unverified here |
| R4 | implemented in fork `1fb2e26` and `flip.sh` | none |
| R5 | implemented: path-prefixed and `@version` supabase, same-segment flags | `supabase start -x gotrue` (short flag) is denied though it excludes (F13) |
| R6 | implemented in `flip.sh` (both registrations) | none |
| R7 | committed, unregistered, as the ruling allows | none |
| R8 | `hooks-apply.sh` works end to end: dry-run on a clone passes 349 canaries on the patched copy; tampered patch refused by hash; bad id refused; non-TTY refused; a canary-breaking patch is reverted and nothing committed | **Unbuilt, stated**: the preflight detective control (`Hook-Patch:` trailer). Human prompt shows no diff (F9) |
| R9 / RTK.md | implemented in `flip.sh`; RTK.md rewrite replaces the old text | none |
| Section C smoke table | matches `flip.sh --smoke` rows | row 8 fragile (F10) |

## Findings

### MED

**F1. A second `flip.sh --apply` makes `--rollback` restore the flipped state, not the original.** `flip.sh:94-96` writes a new timestamped backup and repoints `latest` on every apply; nothing refuses when the flag is already gone. Repro on the fixture HOME: apply, apply again, rollback. All three files differ from the originals; only the first dated backup dir still holds them and `--rollback` cannot reach it. Single apply then rollback is byte-identical (verified for all 3 files). Fix: refuse apply when `$BACKUP_ROOT/latest` exists or the flag is absent, or never overwrite `latest`.

**F2. `npm run install:gsd` aborts on the fork's current state, so the CEO one-liner stops before `flip.sh`.** `scripts/install-preflight.js:8-10` fails on any non-empty `git status --porcelain`; the fork now has ` M .planning/gsd-v2/experiments/05-mutation-speed/PILOT.md` and `?? deno.lock`. The `&&` chain stops (safe, nothing copied). The same orchestrator then, in steps 1,3,4,5 that I did not run, does `npm install` (network), whisper model fetch, merges the telegram MCP entry into `~/.claude/.claude.json` (writing `.claude.json.backup`), and writes `.env.template` into the fork root (not gitignored, so it dirties the tree after install). Only `bin/install.js --global --claude` (step 2) was tested. Fix: commit or discard the two files before the chain, or document `node bin/install.js --global --claude` as the install step.

**F3 (DISPROVED, no change; see "Round-2 fix batch" below). The install ships unrelated v2 policy changes that contradict igaming's CLAUDE.md and alter live-run behaviour.** Path-normalised `diff -r` of the real `~/.claude/{agents,commands/gsd,get-shit-done,hooks}` against the temp install has these content changes:
- `agents/gsd-phase-coordinator.md` and `workflows/execute-phase.md` (`record_defect_classes`): review loops to zero only for high-stakes plans, otherwise at most 2 rounds (fork `ad0bd1c`, "CEO decision"). igaming CLAUDE.md still says "fresh Sonnet agent each round ... until a round reports zero findings" and "fix review findings of every severity". Coordinators of 401/402 would pick up the new text on their next spawn.
- `workflows/execute-roadmap.md` `arm_watchdogs`: status tick 30 to 45 min, adds a 4 h delivery report and a 12 h Haiku cleanup replacing the 2 h cleanup.
Not hooks-related, but it rides the same install. Decide intentionally before the run.

**F4. New false-denial class in the fork protect hook (`7c0499d`): any interpreter write plus any mention of a protected path.** `gsd-protect-managed-files.js` (new lines ~158-161) denies "writes a protected path from a script" when the whole command contains an interpreter word, a CONFIG_MENTION (`.claude/hooks...`, `settings*.json`, now also `get-shit-done/bin/hooks`) and a script-write call anywhere, even when the write target is `/tmp` and the path is only read. Old hook allowed all of these; new denies:
- `ls .claude/hooks; python3 -c "open('/tmp/x','w').write('1')"`
- `git log --oneline -3 -- .claude/hooks; node -e "require('fs').writeFileSync('/tmp/x','1')"`
- `ls .claude/settings.local.json && python3 -c "open('.tmp/a','a').write('x')"`
- `cd ~/get-shit-done; grep -n X ~/.claude/get-shit-done/bin/hooks/compression-cache.js; ...; python3 -I - "$F" <<'EOF' ... open(p,'w') ... EOF` (real command #28 of my sample, writing a file in the fork)
Replay of the same 1,500 real commands: old hook 16 denials, new 31; the 15 new ones all match this rule (13 are the hook-edit session itself, which is intended; #28 and #1105 are not hook edits). Impact is limited to commands that mention these paths, but the fork's own experiments mention `~/.claude/get-shit-done/bin/hooks/` constantly. Fix: require the script's write target, not the whole command, to be protected (the ruling said not to chase variables, so at minimum require the protected path inside the interpreter segment/heredoc body).

**F5. Canary survivors (3 of 6 mutants of my own), all on denies the corpus never exercises.** Run via `HOOKS_DIR=/tmp/rv2/mut/mN`.
- m1 `block-push-without-local-tests.pl:49` freshness `< 1800` to `< 99999999`: 349/0 passes. No stale-marker row exists, so the 30-minute window is untested.
- m4 `redirect-recursive-search.pl:27` `find` exec set reduced to `-exec` only: 349/0 passes. No `-execdir`/`-ok`/`-okdir` row.
- m6 `block-push-without-local-tests.pl:17` drop `perl` from `%ALWAYS`: 349/0 passes. No row for `perl -e ... > .preflight-passed`.
Killed: m2 (`$branch eq 'main'`, 1 fail), m3 (unquoted-heredoc `scan_subs` off, 2 fails), m5 (`@pos == 1` to `<= 2`, 1 fail). Add rows for the three.

**F6. Charlotte suite via `nx` targets is not denied.** `apps/e2e-charlotte/project.json` targets `e2e` (`deno task test`) and `regression` (`deno task test:regression`). `check-test-command.sh` allows `npx nx regression e2e-charlotte`, `npx nx e2e e2e-charlotte`, `npx nx run e2e-charlotte:regression`, `nx run-many -t regression`. The ruling says all bulk tasks stay denied outside the supervisor. Pre-existing in the old hook, so not a regression, but R2's intent is not met. Also allowed: `npm run test:regression`.

### LOW

**F7. Unanchored `e2e-charlotte` match false-denies the CLAUDE.md shape.** `check-test-command.pl` (`classify`): `return 'charlotte' if $eff =~ /e2e-charlotte/` for bare `test`. With payload cwd `/Users/ollorin/igaming-platform/.tmp/wt-e2e-charlotte-fix/apps/api`, `deno task test functions/x/index.test.ts` denies. Anchor to `/apps/e2e-charlotte(/|$)` path component.

**F8. Bypasses of the grep rule (guardrail for honest agents; none matches a typical real shape).**
- `grep -drecurse foo .` (cluster starting with `d`, `redirect-recursive-search.pl` `$cl !~ /^[ABCmdDef]/`), `grep --recurs foo .`, `grep --rec foo .`, `grep --dir=recurse foo .`: GNU/BSD accept unique long-option prefixes; all allowed.
- `exit 0 unless $command =~ /(?:grep|rg|find)/` runs on raw text, so `"gr"ep -r x .` and `g''rep -r x .` skip the parser; allowed.
- Unwrapped prefix commands: `command -p grep -r x .`, `sudo -u x grep ...`, `sudo -E grep ...`, `stdbuf -oL grep ...`, `caffeinate`, `watch`, `env --split-string=...`, `ugrep -r` (the Claude shell function execs ugrep), `function f { grep -r x .; }`.
- `bash -c` nesting deeper than 4 (`flatten` depth guard) is allowed.
- `G=grep; $G -rn foo .`, python/node `os.system("grep -r ...")` (not chasable).

**F9. `hooks-apply.sh` human gate is blind and the review file is self-attested.** Prompt prints only the touched file list (`hooks-apply.sh:46`), not the diff. The `.review.md` lives in `.planning/hook-patches/` where an agent writes it, so `patch-sha256` plus `sonnet-zero-findings: yes` proves nothing beyond file consistency. The TTY plus typed `APPLY` is the only real control; print `git apply --stat` and the diff before the prompt.

**F10. `flip.sh --smoke` row 8 is likely to report a spurious failure, and the smoke depends on a haiku `claude -p` obeying "reply with only raw output".** Row `ls ~/Library/LaunchAgents | grep gsd` expects strictly empty output (`flip.sh:139`); a model replying "(no output)" is WRONG and the script then suggests `--rollback`. Unverified (no `claude -p` allowed here). Treat `EMPTY` as empty or "no output"-like. Also `RUNS` rows fail on any output containing `denied`.

**F11. Preflight wiring is correct but costly and environment-coupled.** Path and cwd are fine (`preflight.sh:42-43` cds to the repo root; file is mode 100755). Costs 31.7 s serial. Needs `~/get-shit-done` (11 `fork:` rows), `~/.claude/get-shit-done/bin/hooks` (17 `user:` rows), `~/.claude/hooks/rtk-rewrite.sh` (2 `user-rtk` rows), node, perl, jq; fails on any machine without them and is not wired in CI (`grep hook-canaries .github/workflows` empty), so a preflight-vs-CI split exists that `docs/testing/gate-estate.md` does not list. Fixed `/tmp/flip-canaries.out` path in `flip.sh:35`.

**F12. Residual gaps in merge/push asks.** `git push` / `git push origin HEAD` while the branch is `main` is not asked; `git checkout main && git merge x` yields no decision at all (compound) so the main-merge ask never fires; `gh api graphql -f query=mutation{mergePullRequest...}` passes; `git merge` into a non-main branch still emits `permissionDecision: allow` (pre-existing; it bypasses ask/permission rules for that command).

**F13. `supabase start -x gotrue`** (short for `--exclude`) is denied by `check-supabase-command.pl` (`has_flag` knows only `--exclude`).

### INFO

- F14. Perl hooks deny a UTF-8 BOM and a top-level JSON array; the jq Write/Edit hooks accept both. Harmless (the harness sends neither).
- F15. After `flip.sh --apply` the original `~/.claude/RTK.md` is only restored by `--rollback` if it existed; if absent the new file stays (moot, it exists).
- F16. `lock_info` makes `echo stack-lock; deno test x.integration.test.ts` skip the R3 reminder (`$has_lock = $command =~ /stack-lock/`), cosmetic.

## False-denial sampling (item 2)

1,500 unique Bash commands from the 60 newest session logs under `~/.claude/projects/-Users-ollorin-igaming-platform/` (of 6,861 extracted), each through the 5 project Bash hooks: 28 redirect denials (all correct), 1 merge ask, 0 others. Fork protect hook on the same set: see F4. Peer must-allow shapes verified allowed by direct payloads: `bash scripts/run-integration-tests.sh --bucket=B3a-payments`, `deno run --allow-all --env-file=... scripts/stack-lock.ts --label l --timeout 600 -- deno task test x`, `cd apps/api && deno task test <file>` (with `2>&1`), `deno test <file>`, `timeout 600 deno test`, `CI=false npx nx test api`, `git commit -m ... -- a b`, `git worktree add|remove`, `zg query "deno task test:regression"`, `git commit -m "$(cat <<'EOF' ...EOF)"` and `gh pr create --body "$(cat <<'EOF'...)"` containing every banned phrase. Quoting/wrapper batteries (about 200 payloads): quotes, `$'..'`, `<(..)`, `$()`, backticks, `env`, `bash -c`, `sh -c`, `eval`, heredocs, `&&`/`;`/`|`/`|&`, absolute paths, `rtk` prefix, `git -C`/`-c`, `exec -a`, `nice`, `timeout`, `xargs` are handled except the F8 list.

## Fail-closed fixtures (item 3)

All 10 project hooks, payloads: empty, `{}`, missing/null/string `tool_input`, `command` null/number/array, top-level array/null, invalid UTF-8 bytes, subagent shape (`agent_id`, `agent_type`, `run_in_background`), Write with no path, missing/null/numeric/nonexistent `cwd`, BOM, trailing junk. Result: empty stdin, `null`, trailing junk fail closed (rc 2) on every hook; a `tool_input` that is a string or a top-level array fails closed on the 6 Bash hooks and is allowed by the 4 jq hooks; missing fields allow (rc 0). Invalid UTF-8 with a real `grep -rn` still denies. No payload produced a crash code other than 0/2 and none stalled (largest 8.7 MB ran in about 12 s, linear). No stall risk found for normal work.

## Flip and apply (item 5)

Run on fixtures only (`HOME=/tmp/rv2/home`, TTY simulated with `script`). `--apply --dry-run` leaves all 3 files byte-identical and prints the diff; real tree untouched (`~/.claude/settings.json` mtime unchanged Oct 31 17:03). Refusals confirmed: charlotte owner label, live `.tmp/charlotte.lock`, `PAUSED.json` (each printed, exit 1); non-TTY apply prints the diff then refuses. `--apply` changes: `~/.claude/settings.json` loses the 5 entries (SessionStart and PostToolUse events disappear; PreToolUse loses the rtk Bash entry and the doc-compression Read entry; Stop loses the schedule-resume --scan entry), remaining hooks keys `PreToolUse, Stop, SubagentStart, SubagentStop`, all other keys equal; `.claude/settings.local.json` loses `disableAllHooks` and the 8-hook `hooks` block (keys left `env, permissions, spinnerTipsEnabled, outputStyle`); `~/.claude/RTK.md` replaced by the "binary kept, not auto-applied" text; backup dir `<project>/.tmp/gsd-v2/hooks-flip-backup/<ts>/` (gitignored by `.gitignore:138`) holds copies of the 3 files. No secret is printed or copied: `~/.claude/settings.json` contains only the public supabase-demo anon JWT in allow rules; `settings.local.json` env has two non-secret flags. Rollback from one apply is byte-identical for settings.json, settings.local.json and RTK.md; F1 is the exception.

## Installer diff (item 6)

Method: copied `agents commands get-shit-done hooks settings.json RTK.md CLAUDE.md gsd-file-manifest.json gsd-source-path.txt gsd-local-patches` from the real `~/.claude` into `/tmp/rv2/cfg`, ran `node bin/install.js --global --claude --config-dir /tmp/rv2/cfg` with `HOME=/tmp/rv2/ihome` (6 s), normalised `/tmp/rv2/cfg` to `/Users/ollorin/.claude`, `diff -r`. Fork tree unchanged by the run. Without normalisation every command/workflow differs only by the config-dir path.

| File (relative to `~/.claude`) | Change |
|---|---|
| `agents/gsd-phase-coordinator.md` | review tiering text: zero-loop only high-stakes, else 2 rounds (F3) |
| `get-shit-done/workflows/execute-phase.md` | same tiering text in `record_defect_classes` (F3) |
| `get-shit-done/workflows/execute-roadmap.md` | `arm_watchdogs`: 45 min tick, 4 h report, 12 h Haiku cleanup, disk/swap fields (F3) |
| `get-shit-done/bin/hooks/gsd-protect-managed-files.js` | A15/A16 patterns, fail closed on bad JSON, new false-denial class (F4) |
| `get-shit-done/bin/hooks/gsd-protect-managed-files.test.js`, `get-shit-done/bin/gsd-tools.test.js` | tests only |
| `get-shit-done/bin/hooks/gsd-guard-bash.js`, `.test.js`, `gsd-hook-lib.js` | new, unregistered, inert |
| `get-shit-done/compression-cache/`, `compression-state.json` | removed (doc-compression runtime state; hook is now unregistered) |
| `gsd-local-patches/` | rewritten: 4 files reported "locally modified" (`gsd-charlotte-qa`, `gsd-debugger`, `gsd-executor`, `gsd-phase-coordinator`) because the installer's own `experimental.cacheTtl` post-processing differs from the manifest hash; backups added, spurious "Run /gsd:reapply-patches" notice |
| `skills/task-context/SKILL.md` | path only |

No changes to `commands/gsd/*`, `references/*`, `hooks/` (`~/.claude/hooks` untouched, so `gsd-check-update.js`, `schedule-resume.js`, `rtk-rewrite.sh` stay on disk, unregistered after the flip), or any other agent. Checked and safe: subagent_type names (agent file list identical, 28 files, `gsd2-runner.md` kept), `experimental.cacheTtl: 1h` retained in the 4 agents that carry it, CHECKPOINT / EXECUTOR-HANDOFF / TASK-CHECKPOINT formats, banned-shape text and trailer text unchanged (no diff in `references/` or the agent/workflow bodies other than the three above), `settings.json` byte-identical after path normalisation, no hook re-registration before or after the flip transform, canaries 349/0 against the post-install tree. Window risk: install wipes and recopies `~/.claude/get-shit-done` (about 6 s); protect and charlotte-lock use only node builtins so they survive it, but a `gsd-tools.js` call from a live agent in that window fails; do it at a plan boundary. Stale or unwanted: none added; the removals above are intended.

## Suggested order for the CEO command

Commit or discard the two dirty fork files (F2), decide F3, then `npm run install:gsd`, then `flip.sh --apply --dry-run`, then `--apply` once (F1), then `--smoke`. F4 and F5 can follow as a hook patch through `hooks-apply.sh` / a fork commit; neither blocks the flip.

## Round-2 fix batch (2026-11-01, fix agent)

F3 disproved: igaming `CLAUDE.md:164-168` carries the cap ("High-stakes plans loop until a round reports zero findings. Other plans get at most 2 rounds ... only a CRITICAL/HIGH in round 2 earns a third round"), added by `886db7087` (docs(claude): cap review rounds at 2 outside high-stakes domains). The review compared against the older line. The coordinator/execute-phase text and the `arm_watchdogs` change (45 min tick, 4 h report, 12 h Haiku cleanup) are intended policy. Nothing changed for F3.

Results per finding are in RESULT.md section "Round-2 fixes".
