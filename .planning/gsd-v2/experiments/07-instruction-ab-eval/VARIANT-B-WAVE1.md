# Variant B drafts, wave 1 (runner, docs-updater, coordinator)

Drafts in `~/get-shit-done/agents/v2/` (not installed). `bin/install.js:1564-1566` copies only top-level `agents/*.md` files (`entry.isFile()`), so the `v2/` subdirectory is skipped by the installer. D12's `gsd2-*` rollout copy step does not exist yet. Sources: `research/07-AGENT-AUDIT.md` (07A) rows 1, 4, 10 and X1-X10, `DESIGN.md` §3, `DESIGN-ALL-AGENTS.md` §3/§5, `research/05` D1/D2/D4, `research/06`, `research/03` I1-I4. Tokens = bytes x 0.40.

| Agent | A bytes (tok) | B bytes (tok) | 07A target | Variant class |
|---|---|---|---|---|
| gsd2-runner | no def (built-in general-purpose 1.1k tok + 16k inherited + 8.4k skill listing) | 2,123 (850) | 1.5k tok | new def (H1), not a B; additions are its purpose |
| gsd2-docs-updater | 17,187 (6.9k) | 4,893 (1.96k) | <= 6,000 B | B: delete/compress/move, plus two audit-directed behaviour removals (below) |
| gsd2-phase-coordinator | 20,983 (8.4k) | 9,986 (4.0k) | <= 10,000 B | quality-fix variant (DESIGN-ALL §3): waiting rewritten from polling to foreground spawns |

Emphasis words (MUST/NEVER/CRITICAL/HARD/DO NOT/...): A coordinator 25, A docs-updater 4; all three B drafts 0.

## gsd2-runner (new)

| Choice | Source |
|---|---|
| `tools: Bash, Read`, `omitClaudeMd: true`, `model: haiku`, `maxTurns: 30`, `effort: low` | 07A row 4, 05 D4 (h), D2; flag honoured per 06 P1 and PROBES S13 |
| Carries only: allowlisted test shapes, no inline env/pipes/`;`/`$()`/heredocs/`bash -c`, no `--no-verify`/`--no-check`, `zg query` not grep/rg/find, report denied command verbatim, no `git stash/reset/rebase/clean`, `.tmp/` logs read by offset/limit, `df -h` before heavy runs, no sleep/poll, report <= 10 lines answer-first, never edit | CLAUDE.md "Use of tools", "Token & Length Discipline", Haiku sizing paragraph; each is a fact the runner cannot see once `omitClaudeMd` drops CLAUDE.md/MEMORY |
| Path-scoped rules still load on `Read` (06 P1), so the def tells it to read only `.tmp/` logs and brief-named files | 07A row 4 |

Open points: (1) the `> .tmp/<name>.log 2>&1` redirect shape is not in CLAUDE.md's allowlist (it lists only a trailing `2>&1`); unverified whether it prompts. Probe: one H1 run with a log path in the brief. (2) `igaming-platform/.claude/hooks/check-test-command.sh:78-81` blocks bare `deno test` / `deno task test` without `NODE_ENV=test DENO_ENV=test`, while CLAUDE.md allowlists those bare shapes and forbids inline env. The runner reports the exact blocked string, as instructed, but H1 may hit this; it affects arms A and B equally.

## gsd2-docs-updater (07A 2.10, X1-X5, X9)

| Action | What | Finding / reason | Bytes (approx, +added/-removed vs A) |
|---|---|---|---|
| removed | `Grep, Glob, LSP, Agent, Task` from tools (kept Read, Write, Edit, Bash) | X4/X5: 0 calls; docs-updater spawns nothing | 100 |
| removed | Step 2 `Glob(...)` instruction, replaced by "list with `ls`; grep/rg/find prompt" | X4 | 150 |
| removed | `@get-shit-done/references/content-firewall.md` pointer, kept one sentence | X9 (not expanded, 06 P9) | 200 |
| removed | Padding-guard BAD/GOOD examples, "Padding guard" report line, Log: lines, duplicate restatements of the guard (quality table, step 3, report) | 07A 2.10(a) | 1,700 |
| removed | `.claude/rules/api-conventions.md` create/update branch of `api_change`, and the `ls .claude/rules` check | 07A 2.10(b): a docs agent writing rule files, against D9; writable paths now `docs/` and `CHANGELOG.md` only. This removes behaviour, as the audit directs | 700 |
| compressed | Four BUILD_SCOPE templates (6.4 KB) to bullet specs that keep table columns, target paths, append rules | 07A 2.10(a); `ui_surface` kept as a short spec rather than deleted because B does not drop a scope | 5,200 |
| compressed | Three failure paths in Step 5 (each stated 3 times across steps 1, 2, 4, 5) stated once at the point of failure plus the contract block | duplicates | 1,100 |
| compressed | Error paths, git commands, frontmatter rules | - | 800 |
| changed | frontmatter: `omitClaudeMd: true`; `{current_date}` becomes `date +%F` (a tool-free way to get the date, since CLAUDE.md context is gone) | 07A 2.10(c), 06 P1 | +60 |
| kept | contract `written_files`/`commit`/`errors` and the "empty + empty is never valid" rule | 70/81 spawns follow it (X2); executor and docs agree only after the executor def changes | - |

Not applied:

| 07A recommendation | Why not |
|---|---|
| tools exactly Read/Edit/Bash | Dropped Write would make creating a new doc impossible (Edit needs an existing file; Bash heredocs prompt in this repo). `api_change`, `ui_surface`, `architecture` all create files. Write kept, constrained by text. Hook-level path restriction is a Q item |
| BUILD_SCOPE classification + commit staging to a script | Needs new tooling; B may only delete/compress/move. The 4-line path/keyword classifier and the commit sequence stay in the def |
| `omitClaudeMd` makes project facts disappear | Applied; the one fact needed (grep/rg/find prompt) is inlined. Other CLAUDE.md rules (FP, token discipline) do not apply to a docs writer |
| Resolve contract conflict with executor (`gsd-executor.md:278` treats `written_files: []` + `errors: []` as failure; docs def allows it for refactoring) | Executor def is outside wave 1; the docs def keeps its stricter rule (never emit that combination), which is consistent with the executor's reading |

## gsd2-phase-coordinator (07A 2.1, X1-X3, X6, X7, X9; 05 D1, D11a)

| Action | What | Finding / reason | Bytes (approx, +added/-removed vs A) |
|---|---|---|---|
| changed (D1) | "Poll it in the foreground until it finishes" replaced by: every child is an `Agent` call with explicit `model` and `run_in_background: false`; no sleep/until/ping/tail -f/wait shells | 07A 2.1(b); 06 foreground probe (default in `-p` is background; explicit `false` blocks, 0 parent turns while waiting); 03 design notes | +1,400 |
| changed (I1) | spot-check list replaced by `gsd-tools verify plan-done {phase} {plan}` with the same checks inlined as a manual fallback (SUMMARY + `Self-Check: PASSED`, tagged commit, cited test log) | 05 D1(b); `plan-done` does not exist in `gsd-tools.js` yet (repo grep, no match) | +/-0 |
| changed (I2) | stall handling moved child-side: briefs carry the no-poll rule and a wall budget; coordinator checks `git log -1 --format=%cr`/mtimes on a silent return or resume; 45 min no change = TaskStop + fresh child | 03 invariant 2; 05 D1 "I2 moves child-side (D2)" | +450 |
| changed (I3, I4) | TaskStop owner before killing a wait shell (only relevant to inherited resume state); no placeholder turn, last message is the JSON; a `completed` with no report is not done | 03 invariants 3-4, F1/F2/F4 | +500 |
| changed (D11a) | "Self-Check FAILED = HARD FAIL, return" replaced by: redispatch once from `resilience resume-brief` + git log, then fail naming the plan; test-gate blocks (`PLAN FAILED`, "Test gate blocked") still return the failure with no coordinator-written SUMMARY | 07A 2.1(b): contradiction with CLAUDE.md "re-dispatch"; DESIGN-ALL C2/C3 oracle accepts both, C3 needs one redispatch | +/-0 |
| changed | verifier inline-write fallback (`verifier: coordinator`) removed: never write VERIFICATION.md; missing file = one redispatch then fail | foreground waits remove the timeout case the fallback was for | -450 |
| changed | frontmatter: tools Read, Write, Edit, Bash, Agent, TaskStop (A: Read, Write, Bash, Glob, Grep, WebFetch, Task, Agent, SendMessage); `cacheTtl: 1h` kept; no `maxTurns` | X4/X5/07A 2.1(c); 06 P4; `TaskStop` for I3 (name unverified in frontmatter, harmless if ignored) | - |
| removed | Telegram input, Notifications 1-6 and JSONL logging | 07A 2.1(a): no `mcp__telegram` in tools, 0 calls | 4,100 (detail file) + 1,200 (def) |
| removed | MILE-26 self-report fields and paragraph | X3 | 900 |
| removed | `@references/handoff-brief.md`, `@coordinator-detail.md`, `content-firewall.md` `@` pointers (not expanded); "Haiku cost ... see coordinator-detail.md" line | 06 P9, X9, 07A 2.1(a) | 900 |
| removed | Hard Rules Digest quotes (8 KB) | X1: digest was the real procedure, so its non-negotiables are restated as the Procedure steps instead of deleted | 8,000 |
| removed | Dependency-drift check, file-conflict check, MODEL_PROFILE/PER_TASK_MODE tier tags, task-router call, quota downgrade, escalation loop, routing ledger | 05 D5/D8: task-router archived, tags removed; executors default to haiku per CLAUDE.md | detail-only |
| removed | `cross_phase_integration` step (spawns `gsd-integration-tester`) | 05 D8 archives integration-tester; 07A 2.20 | detail-only |
| compressed | `review_tiering` (CLAUDE.md duplicate) to 3 sentences; kept because 05 D4(a) moves tiering into this def and the eval's CLAUDE.md snapshot may lack it | 07A 2.1(a) says "delete duplicated tiering"; partially applied | -700 |
| compressed | Defect Class recording 3.3 KB to 1.5 KB; return state; error handling; checkpoint protocol (field semantics, tooling invariant) | - | -3,400 |
| compressed | Context-budget monitoring (60%/80% thresholds, compressed mode, Telegram) to the single 80% early-return rule | 07A 2.1(b): rule mentioned in 3/91 | -2,300 (detail) |
| moved | discuss, UI QA checkpoint loop, UX sweep, post-phase E2E: one-line summary + section pointer with approximate line numbers into `~/.claude/get-shit-done/references/coordinator-detail.md`, read with `Read` offset/limit (not `@`) | 07A: 82% of coordinators spawn executors, 11% a researcher, 2% charlotte-qa; X1 | -1,800 |
| inlined | execute, verify, plan, research step essentials from `coordinator-detail.md` (pre-flight, plan-structure gate, spot-check, verifier spawn, VERIFICATION.md exists + `status:` routing, phase-gate authority) | X1 (detail read 11/91): the def itself must carry them | +2,600 |
| kept | 2-subagent ceiling (executors serial, other children parallel up to 2), stack-lock protocol, `df -h`, on-disk evidence, one writer per file set, no stash/reset/rebase/clean, commit own paths, no secrets, opus-ruling rule, fix every severity, Defect Classes no-bare-None rule, handoff brief, return JSON | task brief and CLAUDE.md | - |

Not applied / decided differently:

| Recommendation | Decision |
|---|---|
| D1 "each wave's children (<= 2) as parallel foreground calls" | Applied only to non-executor children. CLAUDE.md: "never run 2 executors in parallel within one phase" (TASK-CHECKPOINT.json collision). Plan executors run serially, one blocking call each; parallel calls are for reviewers and disjoint fix groups. Wall time per phase may rise; flag for exp 10 |
| 07A: tools without Edit | Kept `Edit`, limited by text to `.planning/**`. Appending Defect Classes rows to the middle of a SUMMARY has no other safe path (Write rewrites the file; Bash heredoc prompts). C-arm criticals (Edit/Write outside `.planning/**`/`.tmp/**`) still hold |
| 07A: delete Telegram + duplicated tiering | Telegram deleted; tiering compressed not deleted (reason above) |
| X7 SubagentHandback line, `Monitor` for waits | Not added: additions, not B. If SubagentHandback becomes the return channel, the "last message is the JSON" line needs to say "put the JSON in the hand-back"; Q item |
| Script-side items (`gsd-tools verify plan-done`, `stack-lock.sh wait --timeout 540` from D2) | Neither exists (`scripts/stack-lock.ts` accepts `--label --timeout -- <cmd>` only). The def uses `plan-done` with an inlined manual fallback and `stack-lock.sh --timeout N`. C1-C3 harness stubs should provide `plan-done` or accept the fallback in both arms |
| `maxTurns` | Not set (07A: multi-hour runs) |
| Section anchors in `coordinator-detail.md` are line numbers (196, 1105, 1466, 1509) | Verified at draft time; they drift if the file is edited. Replace with `<step name=...>` search once a section index exists |

Unverified: that the A snapshot's installed `~/.claude/get-shit-done/references/coordinator-detail.md` has the same line numbers as the repo copy; that `effort`, `omitClaudeMd`, `maxTurns` are all accepted in file-defined agent frontmatter (S13 proved `omitClaudeMd` via `--agents` JSON, 06 P1 for a file-defined agent; `effort`/`maxTurns` not probed); that `TaskStop` is accepted in a `tools:` list.
