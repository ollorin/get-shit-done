# 07A — Per-agent audit of all 27 GSD agents (context savings, quality, disposition)

Inputs: defs `~/get-shit-done/agents/gsd-*.md` (installed copies in `~/.claude/agents/` have the same byte size except executor 30,730 vs 30,704 B, project-researcher, research-synthesizer, roadmapper, task-router, each within 65 B; content equality not diffed); `metrics_v2.py` run 2026-10-31 21:16 UTC (34 d, 4,032 spawns, est $6,900, ±30% index); transcript scans over `igaming-platform/.tmp/gsd-v2/out/files.jsonl` + raw jsonl by two Sonnet sub-audits (scripts `igaming-platform/.tmp/gsd-v2/agent-audit/{e,c,p,tx2_}*.py`, my own `stats.py`, `roles.py`, `savings.py` in the same dir). Transcript examples are `agent-<id>.jsonl` basenames under `~/.claude/projects/-Users-ollorin-igaming-platform/*/subagents/`. "sub-audit" = a number computed by the delegated Sonnet scans, spot-checked where marked ✓. Tokens = bytes × 0.40 (01 §2a: executor 12,389 tok / 30,704 B). Eval coverage: `experiments/07-instruction-ab-eval/DESIGN-ALL-AGENTS.md`.

## 0. Answer

| # | Agent | Spawns (34 d) | est $ | Now B / ~tok | Target B | Disposition | Top 2 changes | Savings est (34 d) | Quality risk of the change |
|---|---|---|---|---|---|---|---|---|---|
| 1 | gsd-phase-coordinator | 91 | 1,145 | 20,983 / 8.4k | ≤10,000 | keep+slim → gsd2 (D1) | replace "poll it in the foreground" with foreground Agent waits; compress the 8 KB digest, delete Telegram + duplicated tiering | def $11; behaviour (D1) −$650-750 (05) | HIGH (orchestration) |
| 2 | gsd-executor | 1,144 | 2,390 | 30,704 / 12.3k | ≤12,000 | keep+slim | delete digest/messaging/routing-tier/auto-mode text; add the missing waiting + hand-back + test-output rules | def $124; compaction 22% → lower (unverified) | MED-HIGH |
| 3 | general-purpose as reviewer (no def) | 458 true reviews | 644 | 1.1k def + 8.4k skill list | new gsd2-reviewer ≤7,500 | replace with custom def | one canonical severity-JSON verdict; read-only tools | skills $38; enables D6 filter (−$500-700, 05) | MED (T0 reviews) |
| 4 | general-purpose as Haiku runner (no def) | 1,040 | 187 | 1.1k + 16k inherited + 8.4k skills | new gsd2-runner ≤3,500 | replace with custom def | omitClaudeMd, tools Bash+Read | ≈$38 carrying; first turn 33.9k → ≤8k | LOW |
| 5 | gsd-plan-checker | 102 | 212 | 33,855 / 13.5k | ≤15,000 | keep+slim | one plan per spawn (11-plan batch compacted); split off its 24% diff-review use to gsd2-reviewer | def $10; >200k-ctx runs were $118 of $212 | MED (Opus pre-exec gate) |
| 6 | gsd-verifier | 88 | 223 | 21,078 / 8.4k | ≤12,500 | keep+slim | compress (not delete) the digest — it is the only procedure the verifier sees; gates 8g-8j → one script | def $5; suite re-runs (avg 4.7/run) | HIGH (phase gate) |
| 7 | gsd-planner | 119 | 420 | 17,273 / 6.9k | ≤14,000 | keep+slim | add Edit (45% are revisions done via python heredoc); inline compact PLAN format + escalate rule | def $3 | MED-HIGH (T0 plans) |
| 8 | gsd-debugger | 52 | 83 | 12,486 / 5.0k | ≤10,000 | keep+slim | replace dead interactive modes with the real "fix red test/flake, autonomous" mode; inline 1 KB of methodology | def $1 | LOW-MED |
| 9 | gsd-test-writer | 31 | 37 | 7,978 / 3.2k | ≤6,000 | keep+slim | add RED-only mode, drop "fix the implementation"; mutation in a worktree made concrete | <$1 | MED (T0 tests) |
| 10 | gsd-docs-updater | 81 | 16 | 17,187 / 6.9k | ≤6,000 | keep+slim, part script | tools Read/Edit/Bash + omitClaudeMd; scope classification + commit → script | ~$3 | LOW |
| 11 | gsd-charlotte-qa | 28 | 18 | 25,253 / 10.1k | ≤12,000 | keep, rewrite after Bladebro pilot | describe what it actually does (scenario runner + reset gate); drop dead JSON contract / ux-audit unless used | ~$1 | LOW-MED |
| 12 | gsd-phase-researcher | 14 | 64 | 18,668 / 7.5k | ≤10,000 | keep+slim | read budget (median max ctx 265k, 6/14 compacted); drop dead `skills:` + commented hooks | ~$1 | LOW |
| 13 | gsd-plan-attacker | 18 | 13 | 5,800 | 0 | archive (05 D8) | attack dimension moves into Opus checker for T0 | $13 + listing | LOW |
| 14 | gsd-plan-judge | 20 | 9 | 8,170 | 0 | archive (05 D8) | same | $9 | LOW |
| 15 | gsd-plan-defender | 17 | 2 | 5,586 | 0 | archive (05 D8) | same | $2 | LOW |
| 16 | gsd-roadmapper | 2 | 0.4 | 19,614 / 7.8k | ≤11,000 | keep+slim | cut 2.2 KB anti_patterns + long examples | ~0 | LOW |
| 17 | gsd-codebase-mapper | 1 | 3 | 16,395 / 6.6k | ≤8,000 | keep+slim | 7.8 KB templates → template files Read on demand | ~0 | LOW |
| 18 | gsd-integration-checker | 2 | 2 | 16,059 / 6.4k | ≤7,000 | keep+slim | 10 KB of bash example fences → 1 KB checklist | ~0 | LOW |
| 19 | gsd-e2e-test-generator | 1 | 0.4 | 16,220 / 6.5k | ≤9,000 | keep+slim, absorb ui-inventory | merge ui-inventory as step 0 | ~0 | LOW |
| 20 | gsd-project-researcher | 0 | 0 | 15,827 / 6.3k | ≤9,000 | keep+slim (05 D8) | 6.3 KB output_formats → templates | 0 now | LOW |
| 21 | gsd-research-synthesizer | 0 | 0 | 6,768 | ≤5,000 | keep (05 D8) | minor | 0 | LOW |
| 22 | gsd-product-investigator | 0 | 0 | 4,840 | 4,840 | keep as is (05 D8) | tool list only | 0 | LOW |
| 23 | gsd-discovery-synthesizer | 0 | 0 | 3,649 | 3,649 | keep as is (05 D8) | tool list only | 0 | LOW |
| 24 | gsd-ui-inventory | 0 | 0 | 2,645 | 0 | merge into e2e-test-generator | — | listing | LOW |
| 25 | gsd-qa-analyst | 0 | 0 | 10,638 | 0 | archive (05 D8) | remove spawn at `audit-milestone.md:317-347` | listing | LOW |
| 26 | gsd-task-router | 0 | 0 | 9,557 | 0 | archive (05 D8, D5) | remove refs in coordinator/planner/executor-detail | listing | none |
| 27 | gsd-meta-answerer | 0 | 0 | 8,121 | 0 | archive (05 D8; DB dead 05-M4) | remove ref in coordinator-detail | listing | none |
| 28 | gsd-nyquist-auditor | 0 | 0 | 6,287 | 0 | archive (05 D8) | also drop checker Dimension 9 dup | listing | none |
| 29 | gsd-integration-tester | 0 | 0 | 4,880 | 0 | archive (05 D8) | remove ref in coordinator-detail | listing | none |

Ranking logic: rows 1-4 carry 80% of agent-attributable spend; their savings come from behaviour (polling, compaction, review rounds, inherited block), not from def text. Def-text carrying cost for all 27 cut to target is only ≈ $155 / 34 d (`savings.py`: executor $124, coordinator $11, checker $10, verifier $5, others ≤ $3), so def slimming alone is a small lever; it pays mainly through the quality fixes it enables and through the 45% shorter agent-type listing every spawner carries after archiving (05 table). Totals of def bytes: 366,521 now → ≈ 214,000 at target (−42%); installed agent count 27 → 19.

## 1. Cross-cutting findings (apply to many defs; each agent section refers back by number)

| # | Finding | Evidence | Fix (class, not instance) |
|---|---|---|---|
| X1 | **Detail files are never read, so each "Hard Rules Digest" is the agent's real procedure, not a duplicate.** Executor/coordinator/planner/verifier/debugger defs put the full procedure in `references/*-detail.md` behind an `@` line; `@` in agent bodies is not expanded (06 P9) | reads: executor-detail 9/1144 (0.8%), coordinator-detail 11/91, planner-detail 3/119, verifier-detail 2/88, debugger-detail 0/52 (sub-audit; my scan 3/6/1/2/0 on first-reads ✓) | B compresses digests instead of deleting them (amends 07 §3.2 verifier/planner rows); a later Q variant inlines the 1-2 KB each role actually needs, then the detail files become maintainer docs |
| X2 | Structured return contracts are mostly ignored; callers parse prose | executor `## PLAN COMPLETE` last 82/1144 (my scan: 58 start with it ✓), JSON trailer 12; coordinator return_state 5/91; checker `## VERIFICATION PASSED/ISSUES FOUND` 6/102; charlotte JSON 0/28 ✓; debugger trailer 28/52; verifier trailer 65/88; docs contract 70/81 | keep the two that work (verifier, docs); for the rest either a SubagentStop hook that rejects a missing trailer (06 P10, absolute path, retry cap) or delete the contract text |
| X3 | MILE-26 self-report telemetry line is near-dead text in 8 defs | executor 1/1144, verifier 13/88, test-writer 3/31, debugger 0/52 (sub-audit) | delete from all defs |
| X4 | `Grep`, `Glob` listed in 24 defs, never called (this repo has no such tools; CLAUDE.md "Use of tools"); `docs-updater` Step 2 even prescribes `Glob(...)` | 0 calls in every role (`roles.py`) | drop from tool lists; replace Glob/Grep instructions with `zg query` |
| X5 | `Agent, Task` in all 27 tool lists; leaf roles barely spawn | docs-updater 0, charlotte-qa 0, plan-defender/judge 0, test-writer 3 (self-spawns) | remove Agent/Task from leaf roles; keep for coordinator, executor, verifier (spawns runners) |
| X6 | `Monitor`/`TaskStop` missing from executor/coordinator tools while the product's sleep guard tells agents to "use Monitor" | executor: 216 sleep-guard errors in 183 transcripts, 57 Monitor "No such tool" (sub-audit; my scan of 400: 17 Monitor-missing ✓); coordinator 69 blocked sleeps | either add Monitor to waiting roles or state the one sanctioned wait (`stack-lock.sh wait --timeout`, D2) in the def |
| X7 | `SubagentHandback` is the real return channel for many spawns; no def mentions it | executors after 2026-10-14: 127/418 (30%) | one line per def: "Your final report goes in SubagentHandback; end it with the JSON trailer" |
| X8 | Off-label use: roles dispatched for jobs their def does not describe | checker 24/102 and verifier 19/88 are "Opus diff review"; 45% of planners are revisions; 45+ of 91 coordinators are death-resume / "drive plan"; only 286/1144 executors are "Execute plan N" | define gsd2-reviewer (row 3) and route diff reviews there; give planner a revision section; coordinator resume brief (D11c) |
| X9 | `content_firewall` pointer (≈330 B) in 16 defs points at a file read 0-1 times | sub-audit reads: 0-1 | keep one sentence, drop the pointer |
| X10 | Dead frontmatter: `skills: gsd-*-workflow` in plan-checker, debugger, phase-researcher, nyquist-auditor — no such skill installed (`~/.claude/skills/` has none); commented-out `hooks:` blocks in debugger and phase-researcher | `ls ~/.claude/skills` | delete |
| X11 | Spawn prompts restate policy in paraphrase (zero-tolerance in 57% of reviewer prompts, read-only 83%) | sub-audit est | not a def issue; D4a moves orchestration text into the coordinator def so briefs can point to it |

## 2. Per-agent sections

### 2.1 gsd-phase-coordinator — 91 spawns, $1,145, 20,983 B (8.4k tok) + inherited 15.6k
- Loads: def; CLAUDE.md+MEMORY+gates rule (15.6k tok, 01 §2a); path rules median 2.1k chars (05-M5). Used as: phase driver, but 45+/91 are death-resume or "drive plan" runs; 82% spawn executors, 11% a researcher, 2% charlotte-qa (sub-audit) → discuss/research/UI-QA/UX-sweep digest text is mostly dead for this project.
- (a) Digest 8,034 B quotes `coordinator-detail.md`, which 11/91 read (X1); Telegram "Notification 6" (`:296-308`) with no `mcp__telegram` in tools and 0 calls; `review_tiering` (`:183-187`) repeats CLAUDE.md "Haiku implements…" verbatim in substance; "Haiku cost … see coordinator-detail.md" (`:189`) points at an unread file; MILE-26 telemetry (`:268`, X3); handoff-brief `@references/handoff-brief.md` (`:310`) not expanded (06 P9). Emphasis 13, caps 112.
- (b) **Contradiction driving the largest waste in GSD:** "Poll it in the foreground until it finishes" (`:27`) → 40% of tool uses are poll/tail loops, 146 background sleep loops, 69 blocked sleeps (sub-audit; 01-F2: 454 h, $767 cache premium). Fix = D1 foreground waits with explicit `run_in_background: false` (06 foreground probe). Return JSON produced 5/91 (X2). Wrote source itself in 2 transcripts (`agent-a382514db6089fce7.jsonl` useGameBalance.ts; `agent-aaf7cc17816f33980.jsonl` migrations) despite `:29`; Edit attempted 14×, not in tools. "Context budget 80%" rule (`:57-58`) mentioned in 3/91 while 20 compacted. Digest's "Self-Check FAILED → HARD FAIL, return failure" (`:84-88`) vs CLAUDE.md "a child that died is re-dispatched" — no rule for a lying-but-alive child.
- (c) Target ≤10 KB: role, supervision (rewritten for foreground waits), spot-check list, verify/return rules compressed, resume-from-CHECKPOINT brief. `cacheTtl: 1h` stays (06 P4 YES). Tools: drop WebFetch/Glob/Grep, decide Edit (no). `maxTurns` not advised (multi-hour). Disposition keep+slim as gsd2-phase-coordinator (05 D12). Eval: C1-C3.

### 2.2 gsd-executor — 1,144 spawns, $2,390, 30,704 B (12.3k tok)
- Loads: def 12.4k + inherited 15.9k + path rules median 59k chars mid-run (05-M5). Used as: plan executor in 286/1144; the rest review-fix, mutation proof, triage, docs (sub-audit).
- (a) Dead or never-reached text: hard_rules_digest 3,656 B (X1, but quotes only gate rules — keep 1 KB of it); `agent_messaging` App #4/#5 2,139 B (`<wave_peers>` in 0 prompts, heartbeat 0); routing-tier bash block (`:318-323`, removed by D5); `auto_mode_detection` (`:40-56`, coordinator-driven project); checkpoint human-verify "90%" taxonomy (`:174-181`; `CHECKPOINT REACHED` 2/1144); Rule 4 cited in 1 transcript, `[Rule N - Type]` tag in 0 (deviation_rules 3.5 KB → 1 KB); telemetry (X3); "see coordinator-detail.md" (`:136`) unread; `@checkpoints.md` (`:162`) not expanded. Emphasis 18, caps 153 — highest of any def.
- (b) Missing instructions vs observed failures: no waiting rule (X6: 16% of transcripts hit the sleep guard); no Handback mention (X7); no rule on test output size — 4,661 test commands piped to tail/grep and ≈675 inline-env prefixes (est, sub-audit) against CLAUDE.md shapes; 589 un-limited Reads averaging 32k chars, `testing.md` re-read 14× (`agent-a77db47ebfa9fdf18.jsonl`, 5 compactions). Self-stop protocol fires rarely (handoff in ≈30 of 252 compacted, 14 `PLAN INTERRUPTED`) — compaction, not self-stop, is the real limiter (22%). Green claimed without a test after the last edit ≈7% (15 with no check, 24 with lint-only; `agent-a9aec2f1a9d421a2f.jsonl`) → the Haiku/Sonnet "run a real check" paragraph (04-P8) is justified. Docs-updater spawned by only 63/293 SUMMARY writers despite "not skippable" — the step lives in the unread detail file. Nested executor spawns 54 (fix groups) — acceptable, but def is silent.
- (c) Target ≤12 KB (07 §3.2). Keep task_commit_protocol, scope_boundary, self_check, resilience (compressed), JSON trailer. Q: Anthropic's two paragraphs (07 C), `effort: medium`, `maxTurns` (D2), one paragraph on waiting + test-output-to-`.tmp/` (D11f). Tools: drop Grep/Glob; add Monitor or forbid waits. Eval: 07 E1-E7.

### 2.3 general-purpose as reviewer — 458 true reviews (580 "review" descriptions incl. 122 fix passes), $644
- Loads: built-in def 1.1k + inherited 15.9k + **8.4k-token skill listing** none use (01 §2a). Opus avg $2.66, Sonnet $0.68.
- (a) Skill listing alone ≈ $38 / 34 d on reviewers (`savings.py` style calc over 394 Sonnet + 133 Opus review spawns); every brief re-states read-only/file:line/zero-tolerance policy (X11).
- (b) No canonical verdict: ≥12 verdict spellings, 74% with none in the first 400 chars (sub-audit est) — this is why 01 could only regex "zero findings" and why D6's script filter needs a schema. "Read-only" violated by 10 that edited source, 28 `sed -i` mutants in the shared tree (2 used a worktree), 28 `--no-check` test commands in 4 reviewers (CLAUDE.md forbids). 79 reviewers > 200k ctx = $288 of $644; 116 full-file Reads > 30k chars (prior REVIEW files 13).
- (c) Replace with `gsd2-reviewer` (D4 table: ≤3k tok def): tools Read, Bash; output = severity-tagged JSON (CRIT/HIGH/MED/LOW, file:line, mechanism, fix), per Opus 5 guidance "report everything, filter separately" (04-P6); "never edit, never mutate the shared tree". Model per tier from the coordinator. Eval: 07 R1-R2 (A) + Q arm.

### 2.4 general-purpose as Haiku runner — 1,040 spawns, $187
- Loads 33.9k first-turn tokens to run a test file and read a log: 16k inherited + 8.4k skill listing + 5.2k tool schemas (01 §2a).
- (a) Everything except the brief is surplus. (b) Failure modes not sampled in depth (unverified); runner deaths are part of the 41 general-purpose API-error endings.
- (c) `gsd2-runner` (05 D4: ≤1.5k tok def, `omitClaudeMd: true`, tools Bash+Read, `maxTurns` ~30, `effort: low`): exact allowlisted test shapes in the def, output = counts + failing names + log path. Path rules still load on Read (06 P1) — runners should read logs under `.tmp/`, not source. Eval: H1.

### 2.5 gsd-plan-checker — 102 spawns (70 Opus), $212, 33,855 B (13.5k tok)
- Loads: largest def; median 95k chars read in first 40 turns (01 §2b); median max ctx 139k.
- (a) Duplicate `## Dimension 9: Nyquist Compliance` heading (`:385` and `:430`) and Nyquist checks for VALIDATION.md files that exist in 2 phase dirs; `<project_context>` tells it to Read `./CLAUDE.md` (`:37`), already loaded as instructions; dead `skills:` (X10); live_course_correction 1.2 KB (SendMessage 2 calls in 102); examples 0.9 KB; success_criteria restates the 12 dimensions.
- (b) Return contract ignored: 6/102 use `## VERIFICATION PASSED/ISSUES FOUND`, 75/102 use BLOCKER/HIGH/MED/LOW (def defines blocker/warning/info `:768-787`) (sub-audit). "Static plan analysis only / DO NOT run the application" (`:871-887`) contradicted: 62/102 run tests, 15 run `sed -i` mutants, 25 edit the plans themselves (15 via sed/python), 48 `deno test --no-check` in 7 transcripts. 24/102 are diff reviews (X8). Batches overflow: `agent-a011cf196cbfeb1fd.jsonl` read 11 plans (441k chars) and compacted; > 200k-ctx runs = $118 of $212. Repeat dispatches: phase 391 = 14 checker runs/$41.
- (c) Target ≤15 KB (07 §3.2) + one plan per spawn, read plan by section; severity vocabulary aligned with reviewers (CRIT/HIGH/MED/LOW); an explicit "fix-plans" mode or a rule that it never edits; Opus: drop success_criteria self-check list (04-P8). Tools: Read, Bash, LSP. Eval: 07 R3.

### 2.6 gsd-verifier — 88 spawns (84 Opus), $223, 21,078 B (8.4k tok)
- (a) Digest 8,460 B is the real procedure (X1: verifier-detail 2/88) — 07 §3.2's "delete Hard Rules Digest 8.5" would remove Steps 6c-8j from the only text the verifier sees; compress to ≈4 KB instead. "NEVER a warning" ×10; success_criteria 2.8 KB restates the digest; "Anti-patterns written to KB (Step 11)" — KB dead (05-M4); PRD Intent Alignment used 1/88.
- (b) "DO NOT commit" (`critical_rules`) vs 58/88 that commit, because 86/88 spawn prompts say commit, and coordinator def says verifier path commits SUMMARY rows (`gsd-phase-coordinator.md:214-215`) — three-way contradiction. "Use grep/file checks" contradicts project `zg` rule. Over-verification: avg 4.7 suite runs, 32 identical re-runs in 23/88, 10 runs on 387.1 = $23 (`agent-a191618422b10eee7.jsonl`); Opus 5 docs say verification instructions cause over-verification (04-P8). 19/88 used as diff reviewer (X8). JSON trailer followed 65/88 — keep.
- (c) Target ≤12.5 KB. Q: Steps 8g-8j (fp-gate, migration-security, cve-scan, `--no-check` guard, p0-tier-delta, test-delta) → one `gsd-tools verify layer1 <phase>` JSON call (replace with script); "run the suite once; re-run only failing files". Tools: drop Grep/Glob/SendMessage. Eval: 07 V1 (+Q).

### 2.7 gsd-planner — 119 spawns (105 Opus), $420, 17,273 B (6.9k tok)
- (a) Digest 3,815 B + ABSOLUTE MANDATES 6,702 B: emphasis 27 (highest density per KB); "Self-check before returning" list (`:51-54`) and MANDATE-4 checklist overlap; success_criteria 1.5 KB; plan template and revision mode live in planner-detail (3/119 read, X1).
- (b) **No Edit tool** (`:4`) while 54/119 (45%) are revisions → 353 python-heredoc rewrites, 81 `sed -i` of PLAN.md (`agent-ab37ab908e5018484.jsonl`). Plan size: median 16.8 KB, p90 34 KB, median 4 tasks, 29% ≥ 6 tasks vs "2-3 tasks each" (`:21`, `:309`) — downstream executors Read ≥20k-char PLAN.md 201 times. MANDATE-2 (`:82-91`) vs the milestone Charlotte waiver: 116 plans (29%) cite a waiver, `e2e_flows: []` in 53% of writes. Tier tags present in ≈76% of plans although the rule is only in planner-detail (`:1202`, 05-M2) — they come from spawn prompts. Return marker 34/119 (X2).
- (c) Target ≤14 KB: add Edit; inline a ≤2 KB PLAN skeleton + revision steps + `escalate:` rule (Q, addition); plain wording for mandates (04-P5); either enforce ≤3 tasks or state the real cap. Opus: drop self-check lists. Eval: 07 P1 + P2.

### 2.8 gsd-debugger — 52 spawns, $83, 12,486 B (5.0k tok)
- (a) Investigation methodology is in debugger-detail (0/52 read, X1), so the def carries file protocol (2.4 KB), checkpoint behaviour (2.0 KB), structured returns (2.3 KB) and modes (1.7 KB) but no method. Dead `skills:` + commented eslint hook (X10).
- (b) Modes dead: `symptoms_prefilled` 0/52, `interactive: false` 0/52, `goal:` 0/52 (12 prompts ask root-cause-only in prose); checkpoints 2/52; debug file written 20/52 vs "created immediately". Real job: autonomous "fix red test / flake" (35/52 commit, 29 edit source). 85 identical test re-runs in 19 transcripts (`agent-a71902f49c1092163.jsonl`: one test 15×). LSP 0 calls.
- (c) Target ≤10 KB: one autonomous mode (find_and_fix | root_cause_only), 1 KB hypothesis loop inlined, rerun discipline, trailer kept. Tools: drop WebSearch? (8 calls/7 runs — keep), drop LSP/Grep/Glob. Eval: D1-D3.

### 2.9 gsd-test-writer — 31 spawns, $37, 7,978 B (3.2k tok)
- (a) Role paragraph "Your job is to BREAK things… Happy-path tests are the minimum" (`<role>`) and the 6-category checklist pull against `test_categories` "fewest tests, T1 ≤ 8" and CLAUDE/testing Test Economy; fixture rules (step 3) duplicate `testing.md` isolation rules.
- (b) Step 6 "If the implementation has a genuine bug: fix it" vs 13/31 RED-only prompts and 10/31 "no production edits" (`agent-a057e750b8a3d37de.jsonl`, `agent-a7f6ef69409b4176f.jsonl`); def has no RED mode. Step 7 "run mutants in a throwaway worktree" — 0/31 used `git worktree`, one mutated prod in the shared tree with `cp .bak` + `sed -i` (`agent-ad318ed07ff55c62a.jsonl`). Report fields (tier, REUSE, FAILURE: 0) emitted 0-6/31. 107 identical re-runs in 16 transcripts. Self-spawns 3 (`agent-a3296982277a43ba6.jsonl`).
- (c) Target ≤6 KB: modes RED (tests only, must fail by assertion) and COVER; the mutation step as a concrete worktree command; report as the trailer. Tools: drop Agent/Task/Grep/Glob. Eval: TW1-TW2.

### 2.10 gsd-docs-updater — 81 spawns (70 Haiku), $16, 17,187 B (6.9k tok)
- (a) Best-behaved role (contract 70/81). Templates per BUILD_SCOPE 6.4 KB while 29/81 jobs are drift fixes of existing docs; `ui_surface` used once. Step 2 prescribes `Glob(...)` (X4). Inherited 15.7k block unused (reads CLAUDE.md/rules in 3/81).
- (b) Tools used: Bash, Read, Edit, LSP(12) — Write 0, Agent 0. Wrote `.claude/rules/database.md` in `e4f53986e` (400-12): a docs agent editing a rule file, against D9 "no unreviewed agent writes to rules". Contract conflict: executor digest calls `written_files: []` + `errors: []` a failure (`gsd-executor.md:278`), docs def allows it for refactoring (report section). 13 full-file Reads > 30k (`docs/authentication.md` 60-66k ×3).
- (c) Target ≤6 KB; tools Read, Edit, Bash; `omitClaudeMd: true` (06 P1: drops 16k; path rules still load); writable paths `docs/**` only; BUILD_SCOPE classification (pure path regex) + staging/commit → script, agent writes prose; one contract rule shared with executor. Eval: DU1-DU3.

### 2.11 gsd-charlotte-qa — 28 spawns (23 Sonnet; def says haiku), $18, 25,253 B (10.1k tok)
- (a) Written for three browser modes; used as a scenario-suite runner: ≈25/28 run `deno task test:scenario`/stack-lock, 21/28 never touch a browser tool, ux-audit requested 0 times, service-health 0 (sub-audit). testing_protocol 3.8 KB, ux_audit_protocol 3.7 KB, service_startup 2.9 KB mostly unexercised; screenshot-every-state rule meets the 180 s timeout (01-F4).
- (b) JSON output contract 0/28 ✓ (X2). The exercised part is `suite_preconditions` (reset gate) — keep it. Spawn model mismatch (frontmatter haiku, 23 Sonnet spawns).
- (c) Target ≤12 KB, rewrite after exp 02 (screenshot fix) and the Bladebro pilot (05 D4 table "defer"); until then only delete dead text. Eval: Q1-Q2 after exp 02 rollout.

### 2.12 gsd-phase-researcher — 14 spawns, $64, 18,668 B (7.5k tok)
- (a) Dead `skills:` + commented hooks (X10); output_format 4.0 KB template; "Mandatory Initial Read" emphasis.
- (b) Median max ctx 265k, 6/14 compacted; spawns 11 general-purpose helpers (fine) but reads whole files — no read budget in def.
- (c) Target ≤10 KB; template → file; add "cite file:line, read sections". Eval: S-PR.

### 2.13 gsd-plan-attacker / gsd-plan-defender / gsd-plan-judge — 18 / 17 / 20 spawns, $24 total, 5.8 / 5.6 / 8.2 KB
- Ran only Oct 17-23 (phase 400; 17 VERDICT files, 05-M3). Defender median 4 turns (rebuttals with little evidence work).
- Disposition: archive (05 D8); T0 plans get an "attack" dimension in the Opus checker. Spawn site to remove: `plan-phase.md:422-517` (Step 9.5/10 trio path). No eval (E3).

### 2.14 gsd-roadmapper — 2 spawns, $0.4, 19,614 B
- (a) anti_patterns 2.2 KB, philosophy 1.4 KB, testing_mandate 1.5 KB restating planner mandates; 4.1 KB code fences. (b) 2 Oct-14 runs both short (median 5 turns); a preview run ended with empty last text (`agent-a76a21aad53087303.jsonl`) — unverified cause. (c) ≤11 KB, keep. Eval: S-RM.

### 2.15 gsd-codebase-mapper — 1 spawn, $3, 16,395 B
- (a) `templates` 7.8 KB inline for four focus areas; one run used a custom PREAMBLE overriding the output location (`agent-a100789ad37f90019.jsonl`). (c) ≤8 KB: templates to `templates/codebase/*.md`, Read the one for the focus. Eval: S-CM.

### 2.16 gsd-integration-checker — 2 spawns, $2, 16,059 B
- (a) verification_process 11.1 KB, of which 10.1 KB are bash/grep example fences (Bash grep prompts in this repo; CLAUDE.md "Use of tools"). (b) Both runs static-only and produced a clear verdict (5/8 PASS, 3 FAIL; `agent-aa49ae0b46db6ef69.jsonl`). (c) ≤7 KB checklist using `zg`. Eval: S-IC.

### 2.17 gsd-e2e-test-generator (+ gsd-ui-inventory) — 1 spawn / 0 spawns, 16,220 B + 2,645 B
- (a) Fixture Isolation Mandate R1-R7 is referenced by `generate-e2e-coverage.md:50` — keep; emphasis 14. ui-inventory exists only to feed it (`plan-phase.md:283-284`, `execute-roadmap.md:328`). (b) One run hit "Too big; read per-file" (`agent-aa1a73bb0b26b1232.jsonl`). (c) ≤9 KB including a 1 KB inventory step; archive ui-inventory. Eval: S-EG.

### 2.18 gsd-project-researcher, gsd-research-synthesizer — 0 spawns, 15,827 B / 6,768 B
- Spawned by `new-milestone.md:174-230` (4 researchers + synthesizer); the Oct-14 v0.1.34 milestone skipped research. Kept by 05 D8. (a) project-researcher output_formats 6.3 KB → template files; tool_strategy 2.5 KB mostly generic. (c) ≤9 KB / ≤5 KB. Eval: S-PJ, S-RS.

### 2.19 gsd-product-investigator, gsd-discovery-synthesizer — 0 spawns, 4,840 B / 3,649 B
- Spawned by `prd.md:138-148, 286-296`; `/gsd:prd` invoked once in the window but these did not run (01 §5). Small, no dead sections found; only tool-list cleanup (X4, X5). Keep as is. Eval: S-PI, S-DS (they still inherit the shared-block cut).

### 2.20 Archive set without use — task-router 9.6 KB, meta-answerer 8.1 KB, nyquist-auditor 6.3 KB, integration-tester 4.9 KB, qa-analyst 10.6 KB
- 0 spawns each (01-F12). task-router superseded by D5 deterministic routing; meta-answerer queries a knowledge DB with no writes since 2026-10-08 (05-M4); nyquist-auditor fills VALIDATION.md gaps that exist in 2 phase dirs; integration-tester referenced only from model-profiles/coordinator-detail; qa-analyst conditionally spawned at `audit-milestone.md:317-347` and never triggered.
- Disposition: `git mv agents/<x>.md agents/_archive/` (installer must skip `_archive/`), remove the spawn/reference lines named above and in `model-profiles.md`, drop checker Dimension 9. Reversible; no eval (E3).

## 3. What this changes in 07 DESIGN.md (for the B drafter)

| 07 row | Change | Reason |
|---|---|---|
| §3.2 verifier "Delete Hard Rules Digest 8.5" | compress to ≈4 KB, do not delete | X1: it is the verifier's only procedure (2/88 read the detail) |
| §3.2 planner "Hard Rules Digest 3.8 → delete" | compress to ≈1.5 KB | X1 (3/119) |
| §3.2 executor digest delete | keep ≈1 KB: tdd block rule, test-gate block, docs step | X1 (9/1144); docs step otherwise invisible (63/293 spawned docs-updater) |
| §3.2 plan-checker | also delete duplicate Dimension 9 heading, `<project_context>` CLAUDE.md read, dead `skills:` | §2.5 |
| all B defs | X3, X4, X9, X10 deletions apply | cheap, no behaviour expected |

## 4. Unverified (probe that would settle it)

| Claim | Probe |
|---|---|
| Executor compaction falls with a slimmer def + test-output rule | 07 E1-E7 `compactions` field, A vs B/C |
| Removing `Agent, Task` from leaf tools does not break a hidden caller | `rg '"subagent_type"'` over transcripts of the leaf role (0 expected) + installer diff |
| Runner/reviewer failure modes beyond the counts above | sample 20 Haiku runner transcripts by `ended_err`/compaction (not done here) |
| gsd2-reviewer JSON lowers rounds per plan (D6) | exp 12 metrics `13_q4.py` |
| Roadmapper empty final text cause | open `agent-a76a21aad53087303.jsonl` last 5 events |
