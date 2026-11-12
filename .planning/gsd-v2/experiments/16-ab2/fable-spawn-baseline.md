# Fable spawn baseline: measured GSD agent spawns, startup tokens, probes, duplication

Read-only extraction. Nothing run, nothing edited.

Citation key (line numbers are in these files, under `~/get-shit-done/.planning/gsd-v2/`):
- `01` = research/01-SESSION-ANALYSIS.md
- `05` = research/05-GSD-V2-DESIGN.md
- `06` = research/06-PROBES.md
- `07` = experiments/07-instruction-ab-eval/PROBES.md
- `07A` = research/07-AGENT-AUDIT.md
- `10` = experiments/10-haiku-100k/RESULT.md
- `KPI` = research/KPI.md

Estimated $ in `01` is an index (+/-30%, `01:7`), not a bill.

## 1. Spawns per role and period

**Period:** 2026-09-27 to 2026-10-31, 33.7 days, 809 h (`01:3`). Transcripts before 09-27 are not on disk (`01:3`). `07A:3` and `05:3` use "34 d" and 4,032 spawns (a different `metrics_v2.py` run); 01 counts 3,981 subagent transcripts (`01:32`). Both are shown; 01 is the primary.

| Role (requested name) | Spawns (01 census) | By model (01 role table) | est $ (01:44-84) | Source |
|---|---|---|---|---|
| gsd-executor | 1,130 | sonnet 593, haiku 509, opus 29 | sonnet 1,941; haiku 342; opus 84 | 01:50,55,62,265 |
| general-purpose | 2,144 | opus 433, sonnet 686, haiku 1,026 | opus 945; sonnet 624; haiku 184 | 01:52,53,58,264 |
| gsd-phase-coordinator | 91 (30 phases; phase 400 = 26) | sonnet 88, opus 3 | sonnet 1,085; opus 23 | 01:51,71,268 |
| gsd-planner | 119 | opus 105, sonnet 14 | opus 411; sonnet 9 | 01:54,74,266 |
| gsd-plan-checker | 102 | opus 70, sonnet 32 | opus 189; sonnet 23 | 01:57,70,267 |
| gsd-verifier | 88 | opus 84, sonnet 4 | opus 221; sonnet 2 | 01:56,81,269 |
| gsd-debugger | 51 (07A says 52) | sonnet 44, opus 7 | sonnet 57; opus 26 | 01:63,67,271; 07A:98 |
| gsd-test-writer | 30 | sonnet 20, haiku 9, opus 1 | sonnet 28; haiku 2; opus 6 | 01:66,78,80,272 |
| gsd-docs-updater | 81 | haiku 70, sonnet 11 | haiku 7; sonnet 9 | 01:76,77,270 |
| gsd2-runner | not found (no gsd2-* name in any table; runner work ran as general-purpose haiku) | n/a | n/a | grep: `gsd2` over 01 returned no spawn row |
| gsd-charlotte-qa | 28 | sonnet 23, haiku 5 | sonnet 17; haiku 1 | 01:72,83,273 |
| fork | 22 | opus 16, sonnet 6 | opus 38; sonnet 23 | 01:65,69,274 |
| gsd-plan-attacker / -judge / -defender | 18 / 20 / 17 (Oct 17-23 only; 18 Oct 17-23, 17 Oct 17-18) | opus / opus / sonnet | 13 / 9 / 2 (07A) | 01:73-82,277-278; 07A:21-23 |
| gsd-phase-researcher | 14 | opus 4, sonnet 10 | opus 40; sonnet 25 | 01:64,68,279 |
| gsd-docs-updater, others (Explore 19, integration-checker 2, roadmapper 2, codebase-mapper 1, e2e 1) | see census | | | 01:79,84,276,280-283 |
| MAIN-session (not a spawn) | 5 sonnet + 4 opus | | 151 + 122 | 01:59,61 |
| charlotte-runner-session (claude -p, haiku-4.5) | 334 | haiku-4.5 | 125 | 01:60,315 |

Note: general-purpose census 2,144 vs role-table sum 2,145; executor 1,130 vs 1,131 (01 internal rounding, not resolved).

## 2. First-turn (startup) tokens per role

Method: first assistant turn's input + cache-create + cache-read tokens, median over 10 sampled spawns per row (`01:95`, `01:97`). Columns are split proportionally to char share (split note at `01:116`).

| Role / model | First-turn ctx tok | Agent def (system) | Tool schemas | CLAUDE.md + MEMORY + rules | Skill listing | Other |
|---|---|---|---|---|---|---|
| gsd-executor sonnet | 38,259 | 12,389 | 7,583 | 15,466 | 0 | 2,727 (01:101) |
| gsd-executor haiku | 38,480 | 12,441 | 7,607 | 15,903 | 0 | 2,835 (01:102) |
| gsd-phase-coordinator sonnet | 34,573 | 8,728 | 6,795 | 15,638 | 0 | 3,307 (01:103) |
| gsd-planner opus | 31,763 | 7,326 | 5,061 | 16,248 | 0 | 3,058 (01:104) |
| gsd-plan-checker opus | 39,235 | 14,024 | 6,599 | 16,202 | 0 | 2,436 (01:105) |
| gsd-verifier opus | 33,832 | 8,466 | 6,579 | 16,153 | 0 | 2,589 (01:106) |
| gsd-debugger sonnet | 29,195 | 5,324 | 5,951 | 15,734 | 0 | 2,199 (01:107) |
| gsd-docs-updater haiku | 28,730 | 7,202 | 3,631 | 15,734 | 0 | 2,143 (01:108) |
| gsd-charlotte-qa sonnet | 36,575 | 10,262 | 8,453 | 15,564 | 0 | 2,282 (01:109) |
| gsd-test-writer haiku | 25,828 | 2,967 | 3,631 | 15,820 | 0 | 3,252 (01:110) |
| gsd-plan-attacker opus | 24,981 | 2,713 | 4,348 | 15,861 | 0 | 2,056 (01:111) |
| general-purpose haiku / sonnet / opus | 33,620 / 33,346 / 34,215 | 1,124 / 1,122 / 1,117 | 5,230 / 5,224 / 6,589 | 16,138 / 15,864 / 15,785 | 8,461 / 8,451 / 8,409 | (01:112-114) |

Breakdown facts:
- Fixed block: CLAUDE.md + MEMORY + rules is 15.5k-16.2k tok in every row (`01:101-114`, column 4). The file does not split CLAUDE.md, MEMORY and rules inside that column.
- Chars median per file, all spawns (n=3,793): `igaming-platform/CLAUDE.md` 17,514; `memory/MEMORY.md` 12,543; `pre-pr-quality-gates.md` 8,647; `RTK.md` 957 (`01:118`). The block is "about 41k chars" (`01:118`) and "40-64% of startup context" per role (`01:118`).
- Conflict: `06:11` and `07:9` say `RTK.md` is NOT attached to subagents (only the 7-char `@RTK.md` stub in `~/.claude/CLAUDE.md`). `01:118` counts 957 chars for it. Unresolved.
- Skill listing: 8,409-8,461 tok, general-purpose only, 0 for custom agents (`01:112-114`; `05:31`).
- Agent def sizes on disk (bytes): plan-checker 33,855; executor 30,730; charlotte-qa 25,253; verifier 21,078; coordinator 20,954; planner 17,273; docs-updater 17,187; debugger 12,486; test-writer 7,978 (`01:144`). Installed executor 30,704 B (`07A:3`).
- Startup at first real work turn: executor sonnet 44,977 tok; haiku 74,544; checker 102,170 (`01:126-134`).

**Bytes-to-tokens ratio measured:** all components together = 0.385 tokens/char, about 2.6 chars/token, over 60 sampled spawns (median 2.60, range 2.57-2.66, `10_calib.py`, `01:95`). `01:95` warns prose tokenizes lighter, so per-file numbers are upper bounds. `07A:3` uses bytes x 0.40. Neither was measured per file.

**Per-file token cost:** not found. Only char counts and dollar shares exist:
- CLAUDE.md: "~$209 (44% char share of the $474 block)" (`05:25`); 18.2 KB, 273 lines (`05:25`).
- Path rules in total: 148 KB; testing 24 KB, edge-functions 23 KB, database 18.6 KB (`05:28`). Per-file rule tokens: not found.
- Live file sizes now (wc, 2026-11-10, outside the named sources): CLAUDE.md 283 lines / 19,323 B; testing.md 25,086 B; pre-pr-quality-gates.md 180 lines / 9,796 B. Command: `wc -l -c` on those paths.

**Path-rule load (measured by transcript attachments):** executors (n=1,131) median 59,412 chars of path rules via `nested_memory` (p90 80.8k) (`05:15`). Load rate per rule: qa-exemptions 77%, fp 74%, module-structure 69%, testing 66%, edge-functions 63%, database 48% (`05:15`). Coordinators median 2.1k chars (`05:15`).

## 3. Probes: how instructions load into subagents

| Question | Answer | Probe id and result |
|---|---|---|
| Do subagents load CLAUDE.md? | YES (user `~/.claude/CLAUDE.md`, ancestor `~/get-shit-done/CLAUDE.md`, project `CLAUDE.md` and its `@import`) | `06:11` P1 default: transcript `instructions` attachment; `07:9` S1 PASS. Ancestor loads even with a nested git root (`07:9`). |
| Does MEMORY.md load into subagents? | YES (typed `AutoMem`). Docs say no. | `06:11` P1 default; `07:12` S4 PASS (run memory dir attached). |
| Do `paths:`-scoped rules load only when a matching file is read? | YES, lazily: `nested_memory` attachment appended to the tool result after a matching `Read` | `06:11` P1 (`PR-5521` absent before read, visible after `Read srcx/a.ts`); `07:9` S1 (`nested_memory` for edge-functions, module-structure, fp after `Read apps/api/functions/x.ts`). |
| Does `omitClaudeMd` work? | YES for CLAUDE.md, ancestors, imports, unscoped rules, MEMORY. NO for path-scoped rules. | `06:12` P1 `p1-omit`: no `instructions` attachment; `PR-5521` still attached after Read. `07:21` S13: `"omitClaudeMd": true` in `--agents` JSON, no `instructions` attachment, cannot see sentinels. Mechanism for file-defined frontmatter not stated in `06:12`: not found. |
| Does `~/.claude/CLAUDE.md` load with `--setting-sources project,local`? | YES | `06:11` ("loads even with --setting-sources project,local"). |
| Does the InstructionsLoaded hook measure subagent start? | NO (only `path_glob_match` fires for subagents) | `06:13` P1 hook. Measure from transcript attachments. |
| Does `@path` in an agent body expand? | NO (literal line in system prompt) | `06:14` P9. |
| Does frontmatter `experimental.cacheTtl: 1h` apply to subagents? | YES for file-defined agents with the field. Other subagents default to 5m. | `06:9` P4; env `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=1h` also works (`06:10`). |
| Do `--agents` JSON definitions override installed defs? | YES. `--setting-sources project,local` drops `~/.claude/agents/`. | `07:11` S3. |
| Is a project `disableAllHooks: true` in production? | YES (live `.claude/settings.local.json`); the eval snapshot strips hooks. | `07:14` S6; `07:25`. |
| Do Agent/Bash PreToolUse hooks fire in subagents and deny with a visible reason? | YES | `06:15` P6 Agent matcher; `06:16` deny; `06:17` Bash in subagent. |
| Does SubagentStop block with a visible reason? | YES (foreground and background; use absolute paths and cap retries) | `06:19` P10. |
| Built-in `sleep N>=25` in foreground Bash blocked by product? | YES, before hooks | `06:18` P6 sleep 400 (`Qhs()`, `Lwr=25`). |
| Is a 240 s foreground wait x2 parallel and blocking, with 0 parent turns? | YES with explicit `run_in_background: false`; default in `-p` is background | `06:23-24`. A 420 s stub wait passes: `07:19` S11. |
| Does `agent_type` identify the spawner in nested calls? | YES | `06:15` P6. |
| Does a file-defined agent's frontmatter `hooks:` run? | Untrusted folder: skipped. Trusted (igaming-platform): NOT probed. | `06:20` P11-lite; `06:35` "not probed". |

## 4. Cost share per role and activity

Per role (est $, 33.7 d, `01:44-84`): executor sonnet 1,941 (29% of total est, `01:223`); coordinator sonnet 1,085; general-purpose opus 945; general-purpose sonnet 624; planner opus 411; executor haiku 342; verifier opus 221; checker opus 189; general-purpose haiku 184; charlotte-runner 125. Total est $6.7k (`01:12`); $6,790 used for startup share (`01:150`).

Startup carrying cost by role (`01:150`): general-purpose $463 (27% of its $1,699); executor $337 (19%); planner $60; verifier $48; checker $42. Total startup carry $1,041 = 15.3% (`01:17,150`). Instructions block alone $474 (7.0%) (`01:17,150`).

Per activity (`01:158-175`, share of est $):

| Activity | Spawns | Active h | % of $ | Source |
|---|---|---|---|---|
| plan-execution (gsd-executor) | 675 | 273 | 22.6% | 01:160 |
| review-verify | 978 | 120 | 17.6% | 01:161 |
| coordinator (polling, dispatch) | 91 | 501 | 16.3% | 01:162 |
| ruling (Opus rulings) | 321 | 42 | 8.3% | 01:163 |
| planning | 135 | 23 | 7.1% | 01:164 |
| evidence-register | 205 | 35 | 4.2% | 01:165 |
| plan-check (checker, attacker, defender, judge) | 157 | 10 | 3.5% | 01:167 |
| phase-verify | 90 | 9 | 3.3% | 01:168 |
| mutation | 131 | 23 | 1.2% | 01:174 |
| docs-update | 81 | 2 | 0.2% | 01:178 |

Review and rulings: review-verify 16% of leaf agent-h and 17.6% of $; rulings 8.3% (`01:20`). Plan-attributed: review-verify 14.8% of $; rulings 9.9%; coordinators 11.7% (`01:182`). Polling: coordinators 454 of 501 active h spent in shell polling (`01:13`); cache-write premium on coordinators $767 (`01:13`, `01:221`). Haiku vs Sonnet executor per spawn: $0.67 vs $3.27 (`01:25`). Opus rulings + diff reviews: 321 rulings $561; 180 Opus reviews $466 (`01:228`).

Context: `10:60` production 349 Haiku executor spawns, $261 at tier prices; 80.3% of calls above 100k. `10:26-28` REJECT for Haiku window 130000 compaction (thrashing; G1, G2, G6 fail).

## 5. Duplication and dead text (07A) and fix status

Status column: "status unknown" means no file in the named sources records it as done. Live-file checks were run only where stated.

| # | Item | Where (07A) | Bytes / count | Status |
|---|---|---|---|---|
| X1 | Hard Rules Digest is the real procedure; detail files unread (executor-detail 9/1,144; verifier 2/88) | 07A:45 | digest 3,656 B exec; 8,460 B verifier | status unknown; `07A:3-5` proposes compress, not delete |
| X2 | Structured return contracts ignored (coordinator return_state 5/91; checker 6/102) | 07A:46 | n/a | status unknown |
| X3 | MILE-26 telemetry line near-dead in 8 defs | 07A:47; coordinator `:268` | n/a | status unknown |
| X4 | Grep/Glob listed in 24 defs, 0 calls | 07A:48 | n/a | status unknown |
| X5 | Agent, Task in all 27 tool lists | 07A:49 | n/a | status unknown |
| X6 | Monitor/TaskStop missing while guard says use Monitor | 07A:50 | 216 sleep-guard errors (executor) | status unknown |
| X7 | SubagentHandback not mentioned in any def | 07A:51 | 127/418 post-10-14 executors | status unknown |
| X8 | Off-label use: diff reviews by checker/verifier | 07A:52 | 24/102; 19/88 | status unknown |
| X9 | content_firewall pointer in 16 defs | 07A:53 | ~330 B each | status unknown |
| X10 | Dead `skills: gsd-*-workflow` frontmatter; commented hooks | 07A:54 | n/a | status unknown; `~/.claude/skills` has none (07A:54 cites `ls`; not re-run) |
| X11 | Spawn prompts restate policy | 07A:55 | n/a | status unknown |
| Coord (a) | Telegram "Notification 6" with no mcp__telegram tool | 07A:61 (`:296-308`) | ~1 KB | status unknown |
| Coord (a) | review_tiering repeats CLAUDE.md tiering | 07A:61 (`:183-187`) | n/a | status unknown |
| Exec (a) | agent_messaging App #4/#5 | 07A:67 | 2,139 B; 0 `<wave_peers>` prompts | status unknown |
| Exec (a) | auto_mode_detection and routing-tier block | 07A:67 (`:40-56`, `:318-323`) | n/a | status unknown; 05 D5 says routing removed |
| Planner (a) | ABSOLUTE MANDATES | 07A:94 | 6,702 B | status unknown |
| Verifier (a) | Steps 8g-8j to one script | 07A:89, 91 | n/a | status unknown |
| Checker (a) | duplicate Dimension 9 heading (`:385`, `:430`) | 07A:84 | n/a | status unknown |
| Debugger (b) | dead modes symptoms_prefilled, interactive: false, goal: (0/52) | 07A:100 | n/a | status unknown |
| Charlotte-QA (a) | ux_audit_protocol 3.7 KB, testing_protocol 3.8 KB mostly unexercised | 07A:114 | 25,253 B def | status unknown |
| Archive set (0 spawns) | task-router 9.6 KB, meta-answerer 8.1 KB, nyquist 6.3 KB, integration-tester 4.9 KB, qa-analyst 10.6 KB | 07A:145-148 | ~39 KB | status unknown; 05 D8 `05:46` proposes archive |

Rules / CLAUDE.md quick-cut backup (experiments/06-claude-md-quick-cuts/backup/): contains `CLAUDE.md` (273 lines, 18,177 B), `CLAUDE.md.pre-runner` (277 lines, 18,446 B), `pre-pr-quality-gates.md` (157 lines, 8,807 B), `testing.md` (215 lines, 24,330 B). No RESULT.md or README in that folder (`find`, maxdepth 3). The live files are LARGER than the backup (CLAUDE.md 283 lines / 19,323 B; pre-pr 180 lines / 9,796 B; testing 25,086 B; wc run 2026-11-10). So the backup's cuts are NOT in effect in the live files. Whether they were ever applied: status unknown.

Decisions and rollout status (05): D1-D12 are all proposed; `05:50` D12 "zero change to running behaviour until opt-in". No file in the named sources records any D-item as implemented. Status: unknown for all D1-D12. Only evidence of a shipped change: `05:11` 05-M1 says a Haiku policy fix `d11bcd441` and GSD `53f7f14` (Oct 29-31) cut Sonnet executors to 17% of the total. That is a model-tiering fix, not a text cut. Sonnet executors: Oct 7-28 216 Sonnet / 379 Haiku; Oct 29-31 26 Sonnet / 128 Haiku.

## 6. Gaps and conflicts

- Spawn period: 33.7 d (01) vs 34 d (07A, 05). Spawn totals: 3,981 vs 4,032 (07A:3).
- Debugger spawns: 51 (01:271) vs 52 (07A:98).
- RTK.md size: 957 chars (01:118) vs not attached (06:11, 07:9).
- gsd2-runner: not found in any measured data (it did not exist in the window).
- Per-file token cost of CLAUDE.md and each rule file: not found (chars only).
- Probe for `omitClaudeMd` via file-defined frontmatter (vs `--agents` JSON): not found in 06 or 07.
- Trusted-folder hook frontmatter: not probed (06:35).
- Idle-period cache TTL (5m vs 1h) per role in production: not found beyond `06:9-10`.
