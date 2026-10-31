# GSD v2 evidence base 01: where time and tokens actually go (session transcripts)

Window: 2026-09-27 to 2026-10-31 (33.7 days, 809 h). Earlier transcripts are not on disk, so the requested 45 days is not available. Dataset: 4,324 transcripts, 5.7 GB, parsed streaming. That is 9 main sessions, 3,981 subagent transcripts and 334 Charlotte runner sessions. All scripts are in `/Users/ollorin/igaming-platform/.tmp/gsd-v2/`, listed at the end.

Conventions:
- "Active h" is the first-to-last transcript timestamp span with gaps over 30 min removed. These are usually a session limit or the user being away. "Wall h" is the raw span.
- "Est $" is an index, not a bill. It prices tokens at the ratios fresh 1 : cache-write 1.25 : cache-read 0.1 : output 5. The $/Mtok input anchors (opus 2.8, sonnet 2.05, haiku-5.5 0.43, haiku-4.5 1.0) are calibrated to the `modelUsage` rows in the main sessions' `cost-state` records. It is within about +/-30% of those records (see caveats).
- The 27 hours of background work I describe as "polling" are shell `sleep`/`until` loops. Sources are named per claim.

## Key findings

1. **Cache-read tokens are 94.8% of all tokens and 54% of cost.** Cache write is 31% of cost, output 13%, fresh input under 2%. Total: 74M fresh, 1,018M cache-write, 22,015M cache-read, 106M output tokens, about $6.7k est. over 33.7 days (`03_q1.py`, `99_tables.py`). Cost is set by context size multiplied by turn count, not by anything the agent writes.
2. **Phase coordinators spend 91% of their active time in shell polling loops** (454 of 501 active h, 3,883 `sleep`/`until`/`seq` calls). Most loops wait for a child to write a SUMMARY.md or git commit; the rest are blind sleeps. The Bash tool's 10-minute cap exceeds the 5-minute prompt-cache TTL, so every poll after 300 s or more re-writes the whole context. Coordinators re-wrote 325M of their 333M cache-write tokens (98%) this way. The premium over cache-read pricing is about $767, which is 69% of the $1,104 total cache-miss premium across all roles, and about 70% of coordinators' $1,085 est. cost (`22_cache_all.py`, `15_q6.py`).
3. **Two weekly-limit stalls removed about 136 h (16.8%) of the window.** Oct 18 13:09 UTC to Oct 20 17:00 UTC is about 52 h, and Oct 24 05:09 to Oct 27 17:00 is about 84 h. Reset times come from the "resets Oct 20 at 7pm / Oct 27 at 6pm (Europe/Madrid)" error text. There was zero transcript activity on Oct 19, 25 and 26 (`08_fail.py`). A session limit added about 5 h on Oct 14. Two API outages (malformed HTTP 200, and "issue with the selected model") each lasted about 17.5 h on Sep 28-30.
4. **The Charlotte LLM runner loses 68% of its wall-clock to one broken call.** 498 of 522 `charlotte_screenshot` calls (95%) hit the 180 s `Page.captureScreenshot timed out` SESSION_ERROR. That is 90,461 s (25.1 h) of 133,000 s (37 h) for 334 runs. 318 of 324 runs that took a screenshot hit it, and the median run loses 68% of its wall to it. Every day from Oct 16 to Oct 31 is affected (`17_charlotte_tools.py`).
5. **Only about 17% of changed lines are production source or migrations.** Of 1.96M lines changed in 4,452 non-merge commits, 51.2% are `.planning/`, 30.1% tests, 11.6% src, 5.9% migrations. 2,042 commits (46%) touch only `.planning` or docs. Output tokens show the same shape: edit/write of `.planning`, `.tmp` and `.md` files is 13.2% of leaf-agent output tokens, tests 6.7%, implementation code 4.1% (`14_q4b.py`, `19_q3b.py`).
6. **Startup context is 15% of all est. cost.** Every spawn starts with about 33-39k tokens. `CLAUDE.md` + `MEMORY.md` + `pre-pr-quality-gates.md` are about 41k chars, roughly 16k tokens, loaded into all 3,981 subagents including Haiku log-readers. That one block costs about $474 (7.0%) in carrying cost, and the whole startup context about $1,041 (15.3%) (`18_startup_table.py`).
7. **GSD workflow and reference files are almost never read by subagents.** At most 2% of executors, planners or verifiers read any `~/.claude/get-shit-done/**` file. 6% of coordinators read `coordinator-detail.md`. The framework's load is the agent definition (system prompt, 7-36k chars, 3-14k tokens) plus project `CLAUDE.md`/MEMORY, not workflows (`11_q2b.py`).
8. **Executors spend more time waiting than writing.** Of 405 active h, waiting/polling is 109 h (27%) and test/integration runs 90 h (22%). The residual model-generation and harness time is about 37%. Edits are near zero wall time (`19_q3b.py`).
9. **Review is the second largest spend.** Review-verify is 16% of leaf agent-hours and 17.6% of $. Rulings are 8.3%. Opus is 31% of est. $ with 794 spawns (`06b_activity_final.py`, `99_tables.py`).
10. **Review loops are short but mostly end in findings.** Per reviewed plan there are 2.3 Sonnet reviews on average (median 2, p90 5), 0.9 Opus reviews and 1.25 rulings. 21.6% of Sonnet reviews report zero findings and 78% report findings. Only 27 of 524 report a HIGH. In `FINDINGS.tsv`, 67% of 860 findings are LOW (579 LOW, 198 MED, 67 HIGH, 10 CRIT) (`13_q4.py`). Treat the 21.6% / 78% split as indicative: it comes from a regex over each reviewer's last message (`z()` in `13_q4.py`).
11. **Dead agents and re-dispatches are common.** 128 transcripts end on a synthetic API-error message: 41 general-purpose, 35 executors, 15 coordinators. 38 of 91 coordinator spawns (42%) are resume-style spawns (380 h wall, $627). Phase 400 alone had 26 coordinator spawns. 244 of 1,130 executors (21.6%) hit a context compaction (`08_fail.py`, `15_q6.py`).
12. **Ten of 27 defined GSD agents never ran:** discovery-synthesizer, integration-tester, meta-answerer, nyquist-auditor, product-investigator, project-researcher, qa-analyst, research-synthesizer, task-router, ui-inventory. The attacker/defender/judge trio ran only for 18/17/20 spawns costing about $24 total. Slash-command GSD entry points were barely used: 8 `/gsd:` slash or Skill invocations across 9 main sessions (`04_scan2.py`).
13. **Host and stack operations are cheap in tokens but heavy in clock.** 102 agents named "OrbStack ...", 78 h agent time, $18. `supabase db reset` was called 9 times for 11.5 h (one call 8.6 h). `stack-ops` tool-wait is 26.5 h. Stack-lock waits are 46 h (`15_q6.py`, `04_scan2.py`).
14. **Haiku and Sonnet executors differ 5x in cost per spawn.** Sonnet is $3.27 and 17.7 active min median, Haiku $0.67 and 6.2 min. 593 Sonnet, 509 Haiku and 29 Opus executors ran (`03b_q1_final.py`). No quality adjustment is possible from the transcripts.
15. **Parallelism was shallow.** There was 456 h with at least one leaf agent running (56% of the window after removing idle gaps), with mean concurrency 1.78 when busy and a max of 16 (`07b_sweep_active.py`).

## 0. Dataset and totals

| Item | Value | Source |
|---|---|---|
| Transcripts | 4,324 (9 main, 3,981 subagent, 334 Charlotte runner) | `02_extract.py` |
| Spawn mode | 3,610 background / 373 foreground (90.6% background) | `meta.json`, spawn census |
| Spawn depth | depth 1: 451, depth 2: 2,097, depth 3: 1,435 | `meta.json` |
| Common parents | executor -> general-purpose 1,012; coordinator -> executor 998; coordinator -> general-purpose 611; main -> general-purpose 288; coordinator -> planner 112 | spawn census |
| Tokens (M) | fresh 74, cache-write 1,018, cache-read 22,015, output 106 | `99_tables.py` |
| Est $ by tier | sonnet $4,003 (59%), opus $2,126 (31%), haiku $660 (10%) | `99_tables.py` |
| `cost-state` totals (recorded main sessions) | adce7a78 $929 (Oct 6-14), 58cca91c $3,108 (Sep 27-Oct 4), b49d2ee0 $849 (Oct 14-20). 181582e5 (Oct 14-31) counter reset, shows $1.59 | `cost-state` records |
| Time per `cost-state` | tool time is 55-83% of tool + API time (adce7a78: tool 368.6M ms vs API 131.0M ms; 58cca91c: 719.3M vs 581.9M; b49d2ee0: 617.0M vs 129.7M) | `cost-state` records |
| Idle | 1,275 of 2,974 raw agent-hours are gaps over 30 min (main sessions 724 h, executors 230 h, coordinators 168 h, general-purpose 151 h) | `02_extract.py` `idle_total` |

Cost-state shows the whole system spends 55-83% of its metered time waiting on tools, not on the model.

## 1. Per role x model (all transcripts, whole window)

Roles with at least 3 spawns or $5. "Active min" is the per-spawn median and p90 after idle removal. Tokens per spawn include cache reads. Stealth-alias spawns are counted in their requested tier.

| role | model | spawns | wall h | active h | active min med | active min p90 | fresh in M | cache write M | cache read M | output M | est $ | $/spawn | tokens/spawn med M | tokens/spawn p90 M | API turns med |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gsd-executor | sonnet | 593 | 497 | 300 | 17.7 | 71 | 40.0 | 146 | 5861 | 27.6 | 1941 | 3.27 | 6.47 | 25.8 | 80 |
| gsd-phase-coordinator | sonnet | 88 | 664 | 495 | 204.4 | 769 | 18.9 | 333 | 717 | 4.5 | 1085 | 12.33 | 4.26 | 33.0 | 83 |
| general-purpose | opus | 433 | 52 | 52 | 4.4 | 11 | 0.0 | 75 | 2149 | 5.9 | 945 | 2.18 | 3.82 | 12.6 | 36 |
| general-purpose | sonnet | 686 | 113 | 51 | 2.0 | 7 | 5.1 | 79 | 1612 | 7.8 | 624 | 0.91 | 1.25 | 5.7 | 18 |
| gsd-planner | opus | 105 | 20 | 20 | 9.5 | 19 | 0.0 | 24 | 841 | 6.7 | 411 | 3.92 | 6.32 | 16.9 | 49 |
| gsd-executor | haiku | 509 | 131 | 99 | 6.2 | 26 | 0.1 | 138 | 5017 | 24.1 | 342 | 0.67 | 6.54 | 24.1 | 49 |
| gsd-verifier | opus | 84 | 12 | 9 | 5.7 | 11 | 0.0 | 12 | 507 | 2.5 | 221 | 2.63 | 4.83 | 12.3 | 51 |
| gsd-plan-checker | opus | 70 | 7 | 7 | 5.6 | 10 | 0.0 | 12 | 406 | 2.3 | 189 | 2.70 | 4.63 | 13.5 | 37 |
| general-purpose | haiku | 1026 | 185 | 96 | 2.2 | 12 | 1.1 | 113 | 2197 | 12.5 | 184 | 0.18 | 0.95 | 5.9 | 15 |
| MAIN-session | sonnet | 5 | 959 | 328 | 2989 | 10853 | 0.0 | 12 | 528 | 1.2 | 151 | 30.26 | 45.13 | 268.8 | 394 |
| charlotte-runner-session | haiku-4.5 | 334 | 37 | 37 | 6.6 | 9 | 0.1 | 24 | 784 | 3.3 | 125 | 0.37 | 2.13 | 4.1 | 32 |
| MAIN-session | opus | 4 | 221 | 128 | 60.4 | 7531 | 0.0 | 6 | 323 | 0.8 | 122 | 30.56 | 3.61 | 321.2 | 33 |
| gsd-executor | opus | 29 | 6 | 6 | 8.0 | 25 | 0.1 | 6 | 175 | 1.0 | 84 | 2.90 | 3.65 | 13.1 | 47 |
| gsd-debugger | sonnet | 44 | 12 | 12 | 7.2 | 53 | 0.9 | 6 | 152 | 1.0 | 57 | 1.30 | 1.34 | 12.1 | 39 |
| gsd-phase-researcher | opus | 4 | 1 | 1 | 13.9 | 21 | 0.0 | 1 | 106 | 0.3 | 40 | 9.91 | 29.15 | 33.0 | 149 |
| fork | opus | 16 | 2 | 2 | 2.9 | 15 | 0.0 | 2 | 91 | 0.3 | 38 | 2.34 | 3.28 | 18.9 | 24 |
| gsd-test-writer | sonnet | 20 | 4 | 4 | 9.8 | 25 | 0.6 | 1 | 75 | 0.9 | 28 | 1.41 | 2.93 | 10.5 | 68 |
| gsd-debugger | opus | 7 | 4 | 4 | 39.9 | 45 | 0.0 | 2 | 49 | 0.3 | 26 | 3.70 | 7.46 | 11.0 | 71 |
| gsd-phase-researcher | sonnet | 10 | 2 | 2 | 7.8 | 13 | 0.4 | 2 | 79 | 0.3 | 25 | 2.46 | 8.61 | 15.0 | 57 |
| fork | sonnet | 6 | 22 | 22 | 228.5 | 355 | 5.7 | 0 | 42 | 0.3 | 23 | 3.90 | 7.38 | 13.5 | 120 |
| gsd-plan-checker | sonnet | 32 | 2 | 2 | 2.4 | 9 | 0.4 | 2 | 57 | 0.5 | 23 | 0.72 | 0.93 | 3.3 | 16 |
| gsd-phase-coordinator | opus | 3 | 6 | 6 | 92.6 | 181 | 0.0 | 5 | 17 | 0.1 | 23 | 7.61 | 4.69 | 14.5 | 48 |
| gsd-charlotte-qa | sonnet | 23 | 8 | 8 | 11.5 | 22 | 0.1 | 4 | 28 | 0.1 | 17 | 0.74 | 0.54 | 3.8 | 13 |
| gsd-plan-attacker | opus | 18 | 1 | 1 | 2.8 | 4 | 0.0 | 2 | 24 | 0.0 | 13 | 0.71 | 1.52 | 2.2 | 20 |
| gsd-planner | sonnet | 14 | 1 | 1 | 2.4 | 9 | 0.1 | 1 | 19 | 0.3 | 9 | 0.64 | 0.56 | 5.3 | 11 |
| gsd-plan-judge | opus | 20 | 1 | 1 | 1.1 | 3 | 0.0 | 1 | 14 | 0.1 | 9 | 0.44 | 0.26 | 1.6 | 7 |
| gsd-docs-updater | sonnet | 11 | 1 | 1 | 2.1 | 7 | 0.1 | 1 | 25 | 0.2 | 9 | 0.80 | 0.72 | 2.3 | 29 |
| gsd-docs-updater | haiku | 70 | 2 | 2 | 1.3 | 2 | 0.0 | 6 | 66 | 0.4 | 7 | 0.10 | 0.72 | 2.1 | 11 |
| gsd-test-writer | opus | 1 | 1 | 1 | 50.8 | 51 | 0.0 | 1 | 12 | 0.1 | 6 | 6.40 | 12.97 | 13.0 | 131 |
| Explore | sonnet | 13 | 0 | 0 | 1.6 | 4 | 0.3 | 0 | 11 | 0.1 | 5 | 0.37 | 0.34 | 2.8 | 19 |
| gsd-test-writer | haiku | 9 | 1 | 1 | 4.3 | 5 | 0.0 | 1 | 29 | 0.2 | 2 | 0.25 | 3.84 | 4.3 | 40 |
| gsd-verifier | sonnet | 4 | 0 | 0 | 5.5 | 9 | 0.0 | 0 | 5 | 0.1 | 2 | 0.54 | 0.45 | 3.9 | 33 |
| gsd-plan-defender | sonnet | 17 | 0 | 0 | 0.4 | 0 | 0.0 | 1 | 1 | 0.0 | 2 | 0.11 | 0.12 | 0.2 | 4 |
| gsd-charlotte-qa | haiku | 5 | 1 | 1 | 10.2 | 51 | 0.0 | 1 | 5 | 0.0 | 1 | 0.14 | 1.25 | 2.7 | 18 |
| Explore | haiku | 6 | 0 | 0 | 0.7 | 1 | 0.0 | 0 | 0 | 0.0 | 0 | 0.02 | 0.10 | 0.1 | 9 |

Also present: gsd-codebase-mapper (1, $3), gsd-integration-checker (2, $2), gsd-roadmapper (2), gsd-e2e-test-generator (1), claude-code-guide (1).

Notes:
- Coordinator wall (median 204 active min, p90 769) is waiting, not work (finding 2). The coordinator cost is mostly cache re-writes.
- The 'stealth/space-bunny-alpha' model alias served 581 spawns between Sep 28 and Oct 4 (requested Sonnet or Haiku). That alias reports input as fresh (no cache split), which is why fresh-in is 40M for executors-sonnet. Their $ is priced at the requested tier and is the least reliable column.
- The longest single leaf spawn was `Execute plan 400-31`: 93.6 h wall, of which 92.1 h idle (a limit stall) and $4.

## 2. Startup instruction load

Method: first assistant turn's input + cache-create + cache-read tokens, per spawn. Decomposition: chars of system prompt (agent definition), tool schemas, rendered attachments (CLAUDE.md, MEMORY, rules, skill listing, environment), and spawn prompt. Calibrated against tokens: all components together average 0.385 tokens/char (about 2.6 chars/token) over 60 sampled spawns (median chars/token 2.60, range 2.57-2.66, `10_calib.py`). Markdown prose alone likely tokenizes lighter, so the per-file token numbers below are upper bounds for prose.

### 2a. First-turn context and what is loaded (median over 10 sampled spawns per row)

| role / model | first-turn ctx tok | agent def (system) tok | tool schemas tok | CLAUDE.md+MEMORY+rules tok | skill listing tok | other (session ctx, spawn prompt, env) tok |
|---|---|---|---|---|---|---|
| gsd-executor sonnet | 38,259 | 12,389 | 7,583 | 15,466 | 0 | 2,727 |
| gsd-executor haiku | 38,480 | 12,441 | 7,607 | 15,903 | 0 | 2,835 |
| gsd-phase-coordinator sonnet | 34,573 | 8,728 | 6,795 | 15,638 | 0 | 3,307 |
| gsd-planner opus | 31,763 | 7,326 | 5,061 | 16,248 | 0 | 3,058 |
| gsd-plan-checker opus | 39,235 | 14,024 | 6,599 | 16,202 | 0 | 2,436 |
| gsd-verifier opus | 33,832 | 8,466 | 6,579 | 16,153 | 0 | 2,589 |
| gsd-debugger sonnet | 29,195 | 5,324 | 5,951 | 15,734 | 0 | 2,199 |
| gsd-docs-updater haiku | 28,730 | 7,202 | 3,631 | 15,734 | 0 | 2,143 |
| gsd-charlotte-qa sonnet | 36,575 | 10,262 | 8,453 | 15,564 | 0 | 2,282 |
| gsd-test-writer haiku | 25,828 | 2,967 | 3,631 | 15,820 | 0 | 3,252 |
| gsd-plan-attacker opus | 24,981 | 2,713 | 4,348 | 15,861 | 0 | 2,056 |
| general-purpose haiku | 33,620 | 1,124 | 5,230 | 16,138 | 8,461 | 2,650 |
| general-purpose sonnet | 33,346 | 1,122 | 5,224 | 15,864 | 8,451 | 2,445 |
| general-purpose opus | 34,215 | 1,117 | 6,589 | 15,785 | 8,409 | 2,621 |

(Source: `18_startup_table.py`, which splits the measured first-turn token count proportionally to char share.)

The instructions block is about the same size (~41k chars) for every spawn: `igaming-platform/CLAUDE.md` 17,514 chars, `memory/MEMORY.md` 12,543, `pre-pr-quality-gates.md` 8,647, `RTK.md` 957 (medians over 3,793 spawns, `11_q2b.py`). It makes up 40-64% of the startup context of every role. General-purpose agents add an 8.4k-token skill listing that none of them uses.

### 2b. Context at first real work turn, and what executors read first

"First work turn" = first Edit/Write, Agent spawn, test/gate/mutation/preflight Bash, or stack op (`09_q2.py`).

| role / model | n | ctx at first work turn (median tok) | turns before work (median) | chars Read before work (median) |
|---|---|---|---|---|
| gsd-executor sonnet | 593 | 44,977 | 5 | 22,557 |
| gsd-executor haiku | 508 | 74,544 | 5 | 29,305 |
| general-purpose opus | 433 | 92,039 | 11 | 30,377 |
| gsd-planner opus | 105 | 90,754 | 8 | 47,604 |
| gsd-plan-checker opus | 70 | 102,170 | 11 | 84,345 |
| gsd-verifier opus | 84 | 59,766 | 7 | 4,377 |
| gsd-phase-coordinator sonnet | 88 | 43,011 | 4 | 2,229 |
| gsd-phase-researcher sonnet | 10 | 107,905 | 9 | 53,145 |
| gsd-charlotte-qa sonnet | 23 | 37,693 | 2 | 0 |

What agents read in their first 40 turns (`12_reads.py`):
- **Executor (Sonnet):** the plan file `NNN-NN-PLAN.md` in 33% of spawns (avg 23,770 chars), then `NNN-NN-SUMMARY.md` (12%), `EXEC-RULES.md` (5%). Median 30,100 chars read in the first 40 turns, p90 92,652. Haiku executors read a median 59,275 chars, partly because 21% open a large saved tool-result file.
- **Plan-checker (Opus):** plan file in 62% (31,825 chars avg), RESEARCH.md 10%, CONTEXT.md 11%. Median 95,245 chars, p90 207,667.
- **Planner (Opus):** existing PLAN.md 57%, RESEARCH.md 9%. Median 60,027 chars.
- **Verifier (Opus):** VERIFICATION.md 22%, SUMMARY.md 20%; median 12,245 chars.

### 2c. GSD framework files

Bytes on disk (tokens at 0.385 tokens/char are an upper bound): agents `gsd-plan-checker.md` 33,855 B, `gsd-executor.md` 30,730 B, `gsd-charlotte-qa.md` 25,253 B, `gsd-verifier.md` 21,078 B, `gsd-phase-coordinator.md` 20,954 B, `gsd-phase-researcher.md` 18,668 B, `gsd-planner.md` 17,273 B, `gsd-docs-updater.md` 17,187 B, `gsd-debugger.md` 12,486 B, `gsd-test-writer.md` 7,978 B. References: `coordinator-detail.md` 84,060 B, `verifier-detail.md` 61,508 B, `planner-detail.md` 51,394 B, `executor-detail.md` 36,149 B. Workflows: `execute-phase.md` 54,006 B, `audit-milestone.md` 47,474 B, `execute-roadmap.md` 44,857 B, `complete-milestone.md` 38,479 B.

Measured use: workflow and reference files are read by at most 2% of spawns of any role, except `coordinator-detail.md` (6 of 91 coordinators, avg 27.7k chars/read) and `execute-phase.md` (2 coordinators). Aside from the agent-definition system prompts, the main way GSD text enters context is the Skill expansion in main sessions (about 8 invocations) and the project CLAUDE.md block.

### 2d. Carrying cost

For 3,505 subagent spawns with a measurable first turn (excluding forks), the cost of writing the startup context once and re-reading it every later turn is est. $1,041 of $6,790 (15.3%). By role: general-purpose $463 (27% of its $1,699), executor $337 (19%), planner $60, verifier $48, plan-checker $42. The 16k-token instruction block alone is $474 (7.0%). (`ad hoc calc`, same pricing ratios; assumes the 5-min cache stays warm, so it is a lower bound given finding 2.)

## 3. Step time breakdown

Three lenses, because agents run in parallel and a single "% of wall-clock" would double count.

### 3a. By agent activity (classified from agent type + description; `lib.py:activity`)

| activity | spawns | active agent-h | % of leaf agent-h | share of busy wall-clock (concurrency-weighted) | cache-read M | output M | est $ | % of $ |
|---|---|---|---|---|---|---|---|---|
| plan-execution (gsd-executor) | 675 | 273 | 36.8% | 39.4% | 6620 | 32.1 | 1532 | 22.6% |
| review-verify (Sonnet/Opus reviewers, pre-verify, ver pass) | 978 | 120 | 16.2% | 13.9% | 4201 | 17.6 | 1195 | 17.6% |
| coordinator (polling and dispatch) | 91 | 501 | - | - | 734 | 4.6 | 1108 | 16.3% |
| ruling (Opus rulings/escalations) | 321 | 42 | 5.6% | 6.6% | 1643 | 6.4 | 561 | 8.3% |
| planning (planner, researcher, roadmapper) | 135 | 23 | 3.1% | 3.1% | 1045 | 7.5 | 485 | 7.1% |
| evidence-register (FINDINGS.tsv, registers, ledgers) | 205 | 35 | 4.7% | 4.2% | 1233 | 7.2 | 283 | 4.2% |
| main-orchestrator | 9 | 457 | - | - | 851 | 2.0 | 274 | 4.0% |
| plan-check (checker, attacker, defender, judge) | 157 | 10 | 1.4% | 1.5% | 503 | 2.9 | 236 | 3.5% |
| phase-verify | 90 | 9 | 1.3% | 1.8% | 518 | 2.6 | 225 | 3.3% |
| other general-purpose | 246 | 17 | 2.3% | 1.8% | 763 | 3.8 | 199 | 2.9% |
| charlotte-scenario-run (runner sessions) | 334 | 37 | 5.0% | 3.5% | 784 | 3.3 | 125 | 1.8% |
| test-run-gates (Haiku bucket/test/lint runners) | 263 | 44 | 5.9% | 7.0% | 960 | 3.9 | 112 | 1.6% |
| implementation-fix | 136 | 27 | 3.7% | 2.9% | 441 | 2.4 | 92 | 1.4% |
| debug | 51 | 16 | 2.2% | 2.4% | 201 | 1.2 | 83 | 1.2% |
| mutation (mutant writing/runs) | 131 | 23 | 3.1% | 3.4% | 670 | 3.3 | 78 | 1.2% |
| charlotte-qa (agents) | 59 | 31 | 4.2% | 3.1% | 153 | 0.7 | 68 | 1.0% |
| stack-host-ops (OrbStack, cleanup, db reset, ticks) | 282 | 22 | 2.9% | 4.1% | 378 | 2.0 | 67 | 1.0% |
| test-writing | 58 | 8 | 1.1% | 1.0% | 241 | 1.8 | 53 | 0.8% |
| docs-update | 81 | 2 | 0.3% | 0.3% | 91 | 0.6 | 16 | 0.2% |

Source: `06b_activity_final.py`, `07b_sweep_active.py`. Busy wall-clock = minutes with at least one leaf agent running after removing gaps over 30 min: 456 h of the 809 h window (56%), mean concurrency 1.78, max 16.

Plan-attributed view (agents whose description names a plan ID; 242 plans with an executor): median $7 and 1.1 active h per plan, mean $14 and 3.9 h, p90 $32 and 10.2 h. Execution is 36% of hours and 39% of $; review-verify 10% of hours and 14.8% of $; rulings 4.2% / 9.9%; coordinators 29.5% / 11.7% (`13_q4.py` addendum).

### 3b. By tool call, inside leaf agents (excluding coordinators and main; 704 active h, 3,890 spawns)

Tool-wait h is summed call durations (result timestamp minus call timestamp). "% of $" is the est. cost of turns whose first action was this tool class. It tracks turn count times context size, so it is not a cost caused by the tool.

| category | calls | tool-wait h | % of active wall | % of $ | output tokens M |
|---|---|---|---|---|---|
| wait/poll loops (shell sleep/until) | 4,762 | 168.2 | 23.9% | 3.7% | 1.77 |
| run integration buckets | 23,098 | 79.4 | 11.3% | 11.5% | 10.39 |
| run unit tests (`deno task test`, nx) | 12,847 | 48.3 | 6.9% | 5.1% | 4.47 |
| stack ops (supabase/orbctl/docker) | 2,198 | 25.7 | 3.6% | 0.7% | 0.70 |
| other bash (file inspect, host/disk, gsd-tools) | 35,669 | 16.7 | 2.4% | 15.1% | 11.60 |
| spawn subagent (foreground wait) | 1,506 | 16.8 | 2.4% | 1.7% | 1.64 |
| search (zg/rg) | 41,616 | 15.4 | 2.2% | 23.3% | 14.70 |
| preflight/gates/lint/typecheck/coverage | 9,969 | 11.7 | 1.7% | 4.8% | 4.29 |
| mutation/mutant commands | 4,683 | 7.3 | 1.0% | 2.6% | 3.98 |
| git | 18,747 | 4.5 | 0.6% | 10.3% | 6.54 |
| Charlotte QA | 3,045 | 2.9 | 0.4% | 2.1% | 1.17 |
| read files | 25,845 | 1.9 | 0.3% | 7.5% | 6.86 |
| edit/write .planning/.tmp/.md (evidence, summaries, registers) | 9,629 | 0.2 | ~0% | 4.7% | 12.62 |
| edit/write tests | 7,042 | 0.1 | ~0% | 1.8% | 6.41 |
| edit/write implementation code | 6,844 | 0.1 | ~0% | 1.5% | 3.95 |
| model-only turns (no tool) | - | - | - | 2.5% | 4.05 |

Source: `19_q3b.py`.

Waiting breakdown (`04_scan2.py` `waits`, all agents): total wait/poll shell time 625 h in 8,688 calls (extractor view). By target: waiting for an agent artifact (SUMMARY/REVIEW/VERDICT/git log) 284 h in 3,192 calls; blind sleep 200 h in 2,609 calls; stack lock 46 h; test or job to finish 60 h; background task output 35 h. Coordinators account for 251 h (artifact) + 157 h (blind sleep) + 35 h (lock) + 6 h (job); executors for 45 h (job) + 34 h (blind) + 15 h (bg output) + 13 h (artifact).

Inside gsd-executor only (405 active h): wait/poll 109 h (27%), integration buckets 60 h (15%), unit tests 30 h (7%), stack ops 21.5 h (5%), mutation 5.8 h (1.4%), gates 5 h (1.2%), search 7 h, git 3 h, Charlotte 1 h. The residual, model generation and harness latency, is about 37% (45% across all leaf agents).

Inside coordinators (501 active h): polling 454 h (90.6%), foreground spawn waits 61 h, everything else under 3%.

Main sessions (456 active h): model-only turns 40.8% of their $, AskUserQuestion waits 12.0 h (33 calls, longest 5.8 h).

### 3c. Top 10 most expensive activities (ranked by clock lost or $)

| # | activity | measure | source |
|---|---|---|---|
| 1 | Coordinator polling loops + cache expiry | 454 h in 3,883 calls; $767 cache-miss premium | `22_cache_all.py`, `19_q3b.py` |
| 2 | Weekly-limit stalls | about 136 h with zero throughput (52 h + 84 h) | `08_fail.py` error text |
| 3 | Plan execution by Sonnet executors | 593 spawns, 300 active h, $1,941 (29% of total est.) | `03b_q1_final.py` |
| 4 | Charlotte screenshot timeouts | 498 calls x ~180 s = 25.1 h; 68% of runner wall | `17_charlotte_tools.py` |
| 5 | Integration-bucket and unit-test runs | 79 h + 48 h tool-wait; 35,945 calls | `19_q3b.py` |
| 6 | Executor shell waits (job, blind sleep, bg output) | 109 h in 3,253 calls | `04_scan2.py` |
| 7 | Death-resume coordinator chains | 38 resume-style coordinators, 380 h wall, $627; phase 400 = 26 coordinator spawns | `15_q6.py` |
| 8 | Opus rulings + Opus diff reviews | 321 ruling agents $561 (8.3%); 180 Opus reviews $466 | `06b`, `13_q4.py` |
| 9 | Startup context carrying cost | $1,041 (15.3%); instructions block $474 | `18_startup_table.py` |
| 10 | Stack ops and OrbStack restarts | `supabase db reset` 11.5 h in 9 calls (one 8.6 h); stack-ops 26.5 h; 102 OrbStack agents, 78 h agent time | `04_scan2.py`, `15_q6.py` |

By single spawn, the most expensive are all coordinators: Phase 400 death-resume coordinator 4 ($132, 58 h), Execute phase 397 ($75, 23.6 h), Phase 400 death-resume 5 ($75, 24.8 h), Phase 400 coordinator ($57), Execute Phase 404 resume ($56) (`99_tables.py`). Highest recurring normalized description by $: "execute plan N" 115 spawns, 185 h, $501.

### 3d. Git as a second time source (`14_q4b.py`, `20_gitplans.py`)

4,461 commits since 2026-09-27 (4,452 non-merge). By files touched: 1,827 planning-docs only, 780 tests only, 184 src only, 169 docs only, 82 migrations only, 1,384 mixed. 285 plan IDs have plan-scoped commits (3,010 commits). Median plan: 8 commits and 1.2 h first-to-last commit span. p90 is 21 commits and 86 h. By subject: review mentioned in 10.6%, evidence/register/ledger/findings 13.3%, mutation/mutant 7.9%, summary/state/roadmap 11.5%.

## 4. Review loops

| metric | value | source |
|---|---|---|
| Review-verify agents | 876 with a final text (524 Sonnet, 180 Opus; rest Haiku) | `13_q4.py` |
| Sonnet reviews per reviewed plan | mean 2.31, median 2, p90 5, max 11 (157 plans) | `13_q4.py` |
| Opus reviews per reviewed plan | mean 0.86; rulings mean 1.25 | `13_q4.py` |
| Stated round numbers | median max round 2 (82 plans state one) | `13_q4.py` |
| Reviews to first zero-finding review | mean 1.67, median 1, p90 3; 42 plans zero on the first review; 60 of 129 plans ever reached zero; 69 not seen | `14_q4b.py` |
| Sonnet reviews with zero findings | 21.6% (regex on first 420 chars of last message) | `13_q4.py` |
| Opus reviews with zero findings | 14.4% | `13_q4.py` |
| Sonnet reviews that state HIGH>0 / MED>0 / LOW>0 | 27 / 74 / 94 of 524 | `13_q4.py` |
| Review time per agent | Sonnet median 2.2 min (p90 15.9), 81 agent-h, $613; Opus median 5.9 min (p90 11.2), 22 agent-h, $466 | `14_q4b.py` |
| Fix agents per reviewed plan | 0.52 (only those with plan IDs) | `13_q4.py` |
| Plan-attributed review share | 9.3% of hours, 17.9% of $; implementation 40.5% / 35.4%; review $ = 0.51 x implementation $ | `13_q4.py` |
| Commits with review-fix wording | 473 of 4,461 (10.6%) | `20_gitplans.py` |
| `FINDINGS.tsv` (860 rows) | severity: LOW 579, MED 198, HIGH 67, CRIT 10. Status: candidate 700, mutation-proven 117, disproved 22, fail-first-proven 14. Disposition: live 755, superseded-by-v0.1.33 82, disproved 7 | `.planning/codebase-review/FINDINGS.tsv` |

"Share of findings that led to changes" could not be measured directly. Neither the transcripts nor the register link a finding to its fix commit. Proxy: 78% of Sonnet reviews report findings, and 0.52 fix agents per reviewed plan are visible by description. The remainder are fixed by the executor or reviewer in place or not at all.

## 5. Which GSD flows ran

Agent spawns by type (3,981 subagent transcripts):

| agent | spawns | note |
|---|---|---|
| general-purpose | 2,144 | reviewers, rulers, test runners, ticks |
| gsd-executor | 1,130 | 593 Sonnet, 509 Haiku, 29 Opus |
| gsd-planner | 119 | |
| gsd-plan-checker | 102 | |
| gsd-phase-coordinator | 91 | 30 distinct phases; phase 400 has 26 |
| gsd-verifier | 88 | |
| gsd-docs-updater | 81 | |
| gsd-debugger | 51 | |
| gsd-test-writer | 30 | |
| gsd-charlotte-qa | 28 | |
| fork | 22 | Sep 30-Oct 2 only |
| gsd-plan-judge | 20 | Sep 30-Oct 18 |
| Explore | 19 | |
| gsd-plan-attacker | 18 | Oct 17-23 only |
| gsd-plan-defender | 17 | Oct 17-18 only |
| gsd-phase-researcher | 14 | |
| gsd-integration-checker | 2 | Oct 9-10 |
| gsd-roadmapper | 2 | Oct 14 |
| gsd-codebase-mapper | 1 | |
| gsd-e2e-test-generator | 1 | Oct 17 |

Never run in the window (defined in `~/.claude/agents/`): gsd-discovery-synthesizer, gsd-integration-tester, gsd-meta-answerer, gsd-nyquist-auditor, gsd-product-investigator, gsd-project-researcher, gsd-qa-analyst, gsd-research-synthesizer, gsd-task-router, gsd-ui-inventory (10 of 27).

Entry points: main sessions invoked the Skill tool or a slash command for `gsd:execute-roadmap` (3 + 2), `gsd:plan-milestone-gaps` (1), `gsd:prd` (1), `gsd:new-milestone` (1). Most phases were started by the main session spawning `gsd-phase-coordinator` directly (77 of 91). `audit-milestone.md` and `complete-milestone.md` were read inline by one general-purpose agent each (`11_q2b.py`). No invocation of `mine-conversations`, `task-router`, `meta-answerer` or `nyquist` appears. The 32 command files in `~/.claude/commands/gsd/` otherwise show no use.

`gsd-tools` subcommands called (`04_scan2.py`): `verify phase-gate` 94, `verify plan-structure` 70, `roadmap update-plan-progress` 62, `eval-candidate from-verification` 43, `roadmap get-phase` 27, `resilience resume-brief` 16, `execution-log event` 10, `budget check` 9, `verify test-content` 10, `deferred add` 5.

Plan-attacker/defender/judge: 55 spawns total, about $24, ran for a 2-week stretch only (judge 20, attacker 18, defender 17).

## 6. Failure and waste signals

| signal | count / size | source |
|---|---|---|
| Transcripts ended on a synthetic API-error message | 128 (general-purpose 41, executor 35, coordinator 15, plan-checker 8, test-writer 4, debugger 4, main 2) | `08_fail.py` |
| API error kinds (events, capped at 60 per file) | weekly_limit 328, model_unavailable 158, malformed_200 62, session_limit 39, network 9 | `02_extract.py` |
| Weekly-limit episodes | Oct 18 13:09 UTC to Oct 20 17:00 (~52 h); Oct 24 05:09 to Oct 27 17:00 (~84 h) | `08_fail.py` |
| Session-limit episodes | Sep 29 to Sep 30 (6 short), Oct 14 13:15 to 18:12 (4.9 h) | `08_fail.py` |
| Outages | malformed-200: Sep 28 14:30 to Sep 29 07:53 (17.4 h); model_unavailable (opus-5-5): Sep 29 08:36 to Sep 30 02:06 (17.5 h); network Oct 8 00:04 to 01:08 | `08_fail.py` |
| Resume-style spawns | 223 of 3,981 (resume/retry/continue/handoff in description), 594 h wall, $928; 38 of 91 coordinators | `15_q6.py` |
| Context compactions | 475 compactions in 363 transcripts; 244 of 1,130 executors; executor max context median 163k, p90 306k tokens | `08_fail.py`, `99_tables.py` |
| Context-overflow ("prompt too long") errors | 0 | `02_extract.py` |
| Cache-miss turns (idle at least 300 s before the turn) | 3,341 turns, 504M of 993M cache-write tokens re-written; coordinators 2,026 turns, 325M tokens; executors-sonnet 569 turns, 95M; premium over cache-read about $1,104 total | `22_cache_all.py`, `21_cache.py` |
| Repeated identical test/preflight commands in one transcript | 2,062 extra runs over 940 distinct commands; top: `tail -n 3 /tmp/preflight-output.log` x29, `deno task test .../player-auth-gates.fail-closed.test.ts` x25, `.../server-side-hardening.integration.test.ts` x23 | `04_scan2.py` |
| `supabase db reset` | 9 calls, 11.5 h (one 31,013 s call in `.tmp/wt-393`), `npx supabase db ...` 293 calls 2.6 h, `supabase start` 65 calls 1.1 h, `orbctl start` 53 calls | `04_scan2.py` |
| OrbStack/host agents | 102 agents named OrbStack (78 h agent time, $18); 223 stack/host agents (106 h, $38); 127 periodic tick agents ($10) | `15_q6.py` |
| Polling loops | 8,688 wait/poll calls, 625 h; `ping -c 598 127.0.0.1` used as a sleep substitute (the shell hook blocks foreground sleep) | `04_scan2.py`, `05_sample_cmds.py` |
| Human wait | AskUserQuestion 33 calls, 12.0 h | `19_q3b.py` |
| Executor read-before-work | median 30-59k chars read before any edit | `09_q2.py` |

## 7. Charlotte QA

Two separate mechanisms: 334 `claude` runner sessions in the `apps/e2e-charlotte` project (Haiku 4.5, one scenario each) and 28 `gsd-charlotte-qa` subagent runs in the main project.

### 7a. Runner sessions (`16_q7.py`, `17_charlotte_tools.py`)

| metric | value |
|---|---|
| Runs, date range | 334, Oct 16 to Oct 31 (131 on Oct 28, 64 on Oct 29, 56 on Oct 17) |
| Outcome | PASS 273, FAIL 51, PARTIAL 2, unparsed 8; 97 distinct scenarios (3.4 runs per scenario) |
| Duration | mean 6.6 min, median 6.6, p90 9.2, max 14.2; total 37.0 h |
| Turns | median 32 API turns, p90 51 |
| Charlotte tool calls | median 32 per run, p90 54, max 86; total 11,553 |
| Tokens per run | median 2.13M (p90 4.06M), 96.6% cache-read; first-turn ctx median 43k; max ctx median 85k, p90 131k |
| Total | 812M tokens, est. $125 |
| Time split | tool wait 71.6%, model generation 28.4% |

Where the time goes (per-tool wall, runner sessions):

| tool | calls | total s | mean s | p90 s | % of Charlotte tool time |
|---|---|---|---|---|---|
| screenshot | 522 | 90,461 | 173.3 | 180.0 | 93.3% |
| wait_for | 1,491 | 3,461 | 2.3 | 8.0 | 3.6% |
| click | 970 | 827 | 0.9 | 0.6 | 0.9% |
| console | 63 | 720 | 11.4 | 0.0 | 0.7% |
| evaluate | 4,075 | 566 | 0.1 | 0.1 | 0.6% |
| observe | 674 | 376 | 0.6 | 0.0 | 0.4% |

498 of 522 screenshot calls returned `{"error":{"code":"SESSION_ERROR","message":"Unexpected error: Page.captureScreenshot timed out. Increase the 'protocolTimeout' ..."}}` after at least 170 s. Only 21 calls succeeded (under 5 s). Failure occurred every day from Oct 16 to Oct 31: 33/33 on Oct 16, 100/100 on Oct 17, 200/202 on Oct 28, 91/91 on Oct 29. 318 of 324 runs with screenshots had at least one timeout. Median share of run wall consumed: 68%. Without the timeouts, a median scenario would take about 2.1 min (6.6 min x 0.32).

Snapshot sizes (tool-result chars, all 11.5k calls, 31.3M chars): `wait_for` 6,814 chars avg (10.2M chars, 32% of result volume), `click` 6,959, `observe` 5,325, `type` 5,710, `screenshot` 5,255 (this is the error text, not an image), `navigate` 1,185, `evaluate` 105. Click/type/wait_for return a ~6-7k-char page snapshot each (about 2.4k tokens at the file-wide ratio); 3,259 of those calls make up 60% of result volume.

### 7b. `gsd-charlotte-qa` agents and Charlotte via general-purpose

| metric | value |
|---|---|
| gsd-charlotte-qa spawns | 28 (Sonnet 23, Haiku 5), Oct 2 to Oct 30 |
| Duration | median 11.5 min, p90 22.0, total 9.0 h |
| Turns / tokens | median 13 turns, 0.57M tokens, est. $18 |
| Charlotte MCP calls | 175 total (they mostly call the Deno runner via Bash instead) |
| General-purpose agents with "Charlotte" in description | 27, 19.1 h, $24 |
| Bash `charlotte`/e2e commands (all agents) | 3,122 calls, 2.4 h |

## Method and caveats

- **Window.** 2026-09-27 to 2026-10-31 only; older transcripts were purged, so the 45-day target is unmet. The 181582e5 main session spans Oct 14-31 and was resumed repeatedly, so its `cost-state` counter is not cumulative; for it I use the token-based estimate only.
- **Parser.** `02_extract.py` streams every `.jsonl`, skips `api-request*` blobs, and keeps one record per file. Assistant messages are split into one line per content block with repeated usage; I deduplicate on `message.id` (first value for input/cache, max for output). Wall = first to last user/assistant timestamp. Tool duration = tool_result timestamp minus tool_use timestamp. Model-generation time is a residual, not measured.
- **Token attribution by tool.** Each assistant turn's tokens are attributed to the category of the first tool it called, or "no tool". This measures turn count times context, not the cost a tool causes. Do not read the `% of $` column in 3b as cost-of-running-tests.
- **Cost index.** Est $ uses fixed ratios and tier prices calibrated from `cost-state` `modelUsage`. Cross-check per main session: adce7a78 est $1,210 vs $929; 58cca91c plus c2931be7 est ~$2,500 vs $3,108; b49d2ee0 $755 vs $849. The error band is about +/-30%. The 581 stealth-alias spawns have no cache split and are priced at their requested tier, so Sep 28-Oct 4 numbers are the least reliable. 1h-cache vs 5m-cache TTL was not separated.
- **Activity classification.** General-purpose and executor agents have no explicit purpose field. Activity is a keyword classifier over the spawn description (`lib.py:activity`). About 6% of spawns land in "other-gp". Description patterns were tuned on a random sample of about 250 descriptions, not validated against a labelled set.
- **Idle removal.** Gaps over 30 min are treated as idle (limit stalls, user away). A coordinator waiting in a 600 s poll has gaps under 30 min, so its waiting counts as active time.
- **Review metrics.** Plan IDs come from regex on descriptions and the first prompt (reviewers without an ID are excluded from per-plan numbers). Zero-finding detection is a regex on the first 420 chars of the last message. Reviews that report "no blocker" or similar could be misclassified either way.
- **Wait classification.** Wait/poll targets (`artifact`, `test-or-job`, `blind-sleep`, `lock`, `bgtask`) come from command text regexes; some `test-or-job` waits are really waits on other agents.
- **Not measured.** Hook latency, MCP server startup, human time outside AskUserQuestion, and whether any finding or fix was correct. `finished` in `meta.json` is unreliable (null for 60% of spawns) and was not used. Only 4 main sessions have `cost-state`.
- **Git.** `git log --all --since=2026-09-27` is read-only; commit counts include work on worktree branches. Line counts include generated evidence files.

## Hypotheses for the overhaul

1. Coordinators should not poll in shell loops. Use completion notifications, or cap each sleep under about 240 s, or use the 1 h cache TTL. Test with the 22_cache_all.py measurement before and after (target: coordinator cache-write below 30M tokens per month).
2. Fix or remove the `charlotte_screenshot` 180 s `protocolTimeout` before any other Charlotte change. A median scenario would drop from 6.6 min to about 2.1 min.
3. Shrink the per-spawn instruction block: scope `CLAUDE.md` / `MEMORY.md` / `pre-pr-quality-gates.md` by role. A Haiku log-reader does not need 16k tokens of project policy, and the 8.4k-token skill listing in every general-purpose spawn is unused.
4. Move bookkeeping (summaries, registers, evidence tables) from agents writing markdown to scripts. Evidence and docs writes are about 13% of output tokens and about half of changed lines.
5. Replace weekly-limit exposure with a budget governor. Two stalls cost about 136 h; Opus is 31% of $ and rulings plus Opus reviews about $1,027.
6. Reduce coordinator count per phase. Phase 400 used 26 coordinator spawns and 38 of 91 coordinators were resumes. Make coordinator state resumable from disk with a small brief rather than a re-read of the full history.
7. Decide whether the 10 never-run agents and the attacker/defender/judge trio earn their definition and maintenance cost. This report shows usage only, not quality.
8. Treat Sonnet vs Haiku executor choice as an experiment. Haiku executors cost about 20% of Sonnet per spawn and run in about a third of the time, but this data cannot show which failed more often.

## Scripts (all in `/Users/ollorin/igaming-platform/.tmp/gsd-v2/`)

- `lib.py` (loaders, role/tier/activity classifiers, pricing)
- `00_meta_survey.py`, `01_types.py` (schema discovery)
- `02_extract.py` (main streaming extractor, writes `out/files.jsonl`)
- `03_q1.py`, `03b_q1_final.py` (role x model table)
- `04_scan2.py` (command-shape census, waits, skills, gsd-tools, repeats; `out/scan2.jsonl`)
- `05_sample_cmds.py` (long-running Bash samples)
- `06_q3.py`, `06b_activity_final.py` (activity table)
- `07_sweep.py`, `07b_sweep_active.py` (concurrency-weighted wall-clock)
- `08_fail.py` (API errors, limit episodes)
- `09_q2.py`, `10_calib.py`, `11_q2b.py`, `12_reads.py`, `18_startup_table.py` (startup load)
- `13_q4.py`, `14_q4b.py`, `20_gitplans.py` (review loops, git)
- `15_q6.py` (waste, resumes, stack ops)
- `16_q7.py`, `17_charlotte_tools.py` (Charlotte)
- `19_q3b.py` (tool-category breakdown)
- `21_cache.py`, `22_cache_all.py` (cache-expiry analysis)
- `99_tables.py` (tier totals, top spawns)
