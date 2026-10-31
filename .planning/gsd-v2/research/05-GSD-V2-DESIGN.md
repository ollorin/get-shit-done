# 05 — GSD v2 design: decided changes, rollout, open probes

Inputs: `01-SESSION-ANALYSIS.md` (01-F#), `03-POLLING-CONSTRAINTS.md` (03-F#/I#), `04-BEST-PRACTICES.md` (04-P#/c#). New measurements in this doc come from read-only runs over `igaming-platform/.tmp/gsd-v2/out/files.jsonl` and raw transcripts, labelled **[05-M#]**; commands at the end. "est" = estimated with the 01 $-index (±30%). Baseline window: 34 days, est $6.8k.

Author: Opus design pass, 2026-10-31 (saved by the main session; the design agent was read-only). Spot-checked: 05-M3 (17 VERDICT files, all phase 400) and 05-M4 (knowledge max `created_at` 2026-10-08, 242 rows) confirmed by the main session.

## Corrections to the brief (measured)

| # | Brief said | Measured | Source |
|---|---|---|---|
| 05-M1 | executors 593 Sonnet vs 509 Haiku "against Haiku default" | 351 of 593 Sonnet executors ran **before** the 2026-10-07 Haiku policy. Oct 7-28: 216 Sonnet / 379 Haiku (Sonnet $945 vs Haiku $250). Oct 29-31, after fix `d11bcd441` + GSD `53f7f14`: 26 Sonnet / 128 Haiku (17%). After Oct 7, 60% of Sonnet executors are fix/resume/ruling passes. | files.jsonl by t0 |
| 05-M2 | cause unknown (inherit vs explicit) | All paths contributed. (a) Spawns pass `model` explicitly in ~97% of cases, so frontmatter `model: haiku` rarely decides. (b) Plans for phases 398-402 carry 0 `<model>` tags (701 tasks); the rule that writes them is in `planner-detail.md:1202`, which planners don't read (01-F7). (c) Untagged fallback is "sonnet" in `coordinator-detail.md:823,840,873` and `planner-detail.md:488`. (d) Inheritance from Sonnet coordinators covered 400-32..400-44 (d11bcd441 message). Phase 404 has 41 haiku tags of 52 tasks, so the fix is live. | rg over Agent inputs; `.planning/phases/*/PLAN.md` |
| 05-M3 | attacker/defender/judge: no VERDICT files | 17 `*-VERDICT.md` exist, all phase 400 (Oct 17). Usage still only 55 spawns, ~$24. | `ls .planning/phases/*/*VERDICT*` |
| 05-M4 | knowledge DB dead since 2026-09-18 | `knowledge` table: 242 rows, max `created_at` = max `last_accessed` = 2026-10-08. `cost_tracking`, `budget_alerts`: 0 rows. `gsd-meta-answerer` never ran. Dead in effect. | sqlite3 -readonly |
| 05-M5 | path rules load "when touched" (size unknown) | Executors (n=1,131): median **59,412 chars** of path rules via `nested_memory` (p90 80.8k). Load rates: qa-exemptions 77%, fp 74%, module-structure 69%, testing 66%, edge-functions 63%, v0.1.33-milestone 53% (file since removed), database 48%. General-purpose: mean 21k chars. Coordinators: median 2.1k. | rg `nested_memory` joined to roles |
| 05-M6 | weekly-limit pacing can use our $-index | It can't. Limit hit at est $822 (wk1, 4.8 d) and $973 (wk2, 3.5 d); wk3 burned **$1,277 in 4.3 d with no hit**. Either the limit metric is not the $-index (04-c1) or the plan changed. | files.jsonl prorated by span |
| 05-M7 | foreground waits unproven for long children | 373 foreground spawns. 70 foreground executors: median 25.9 min, max 201 min, 13 over 60 min. 8 of 373 ended on API errors (2.1%, ≈ background). | meta `requestShape` |
| 05-M8 | mutation proof as a cost driver | Mutation is 1.2% of $ and 3.1% of leaf hours (01 §3a). Summary template already limits it to T0 (`templates/summary.md:80`). Relaxing it saves almost nothing. | 01 §3a |
| 05-M9 | upstream 1.43 is leaner per agent | It isn't: upstream `gsd-executor.md` 36 KB vs ours 30.7 KB, planner 49 KB. Upstream savings come from skill routers (2,150 → 120 tokens), `--minimal` install, size-budget tests, emphasis trims (04-P13). | `gh api .../contents/agents` |

## Where the instruction weight is (CEO comment checked)

| Source | Size | Loaded into | est $ / 34 d | CEO view | Verdict |
|---|---|---|---|---|---|
| `CLAUDE.md` | 18.2 KB, 273 lines (doc target <200) | every spawn (3,981) | ~$209 (44% char share of the $474 block, 01-F6) | "already small" | Partly wrong: largest file every spawn loads. Lines 99-237 (≈9.7 KB: tiering, parallelism, orchestration) are needed only by spawners. |
| `MEMORY.md` | 14.1 KB index | every spawn (observed; docs say no, 04-Q1) | ~$150 | — | Too heavy for an index; duplicates CLAUDE.md rules. |
| `pre-pr-quality-gates.md` | 8.8 KB, no `paths:` | every spawn | ~$103 | rules = weight | Right: only PR creation needs it. |
| Path rules (testing 24 KB, edge-functions 23 KB, database 18.6 KB…) | 148 KB | executors median 59k chars (05-M5) | ~$190 | rules = weight | Right: per executor, rules outweigh CLAUDE.md+MEMORY. |
| Agent defs (system prompt) | 3-14k tok (executor 12.4k, checker 14k) | each spawn of that role | ~$250 | flow files = weight | Right. |
| Workflows/references (`execute-phase` 54 KB, `coordinator-detail` 84 KB) | 300+ KB | ≤2% of subagents (6% coordinator-detail) | ~$0 for subagents | flow files = weight | Wrong as a token source; right as a correctness problem — rules agents must follow (tier tags, model default) sit in files they never read (05-M2). |
| Skill listing | 8.4k tok | general-purpose only (2,144 spawns) | ~$60-90 | — | Custom agents show 0 listing (01 §2a); replace general-purpose with custom agents. |
| Agent-type list in Agent tool schema | 4.8k chars (27 agents) | every spawner | small | — | Deleting 13 agents removes ~45%. |

## Decisions

| ID | Decision | Evidence | Expected effect | Risk to v0.1.34 | Rollback |
|---|---|---|---|---|---|
| D0 | Measure first: `GSD_SINCE/GSD_UNTIL` filter in `lib.load()` + `metrics_v2.py` KPI table; every experiment reports against it. | 01 scripts have no time filter | before/after for every row | none (scratch) | n/a |
| D1 | Coordinator waiting: (a) keep 1h cacheTtl (shipped), verify. (b) `gsd2-phase-coordinator` spawns each wave's children (≤2) as **foreground parallel Agent calls in one message**; turn blocks until return; no sleep/until/ping loops, no wait shells. After each return run `gsd-tools verify plan-done <plan>` (SUMMARY Self-Check, tagged commit, test log). (c) Rejected for now: Workflow scripts (pause on limits only interactively, failed agent re-runs later agents, no shell, multi-hour stack work unproven — 04-P2/P12/c6; optional pilot E19); single long background waits (ending turn reported `completed`, 03-F1/F4). (d) `session-supervisor.sh` stays as session-limit fallback (03-F3). | 01-F2, 03-F1..F5/I1-I4, 05-M7 | polls 3,883 → <300 per 34 d; coordinator cache-write 333M → <30M; ≈ −$650-750 (~10%); coordinator turns/phase −80%. F1/F4 impossible (foreground returns final result), F2 no wait shells, F5 via D2, I2 moves child-side (D2), I4 by construction. | none: new agent name | spawn unchanged `gsd-phase-coordinator` |
| D2 | Child-side stall elimination: PreToolUse Bash hook denies `sleep N` N>300, `until … pgrep`, `ping -c N` as sleep, `tail -f` without `timeout`; only wait = `scripts/stack-lock.sh wait --timeout 540`. `maxTurns` on gsd2 executors/runners. Bash ≤10 min fg / ≤2 h bg with `timeout`. | 03-F5, 01 §3b (executor waits 109 h, blind 34 h) | executor wait 109 h → <40 h; stall incidents → ~0 | medium: project hooks may reach v0.1.34 spawns (P5) → ship **log-only** first | remove hook entry (backup kept) |
| D3 | Weekly-limit governor = pacing on the real meter: `gsd-tools budget pace` reads weekly % from statusline `rate_limits` (P2) vs linear pace (100%/7 per day). >1.15× pace: pause plan-ahead, T2, docs; batch Opus rulings. >90%: in-flight T0 only. At limit: supervisor resumes at reset. Discard the existing `quota` tracker (guessed 100M limit). | 01-F3, 04-P12, 05-M6 | cliff → slowdown; real lever is D1+D4+D6+D7 (25-35% est-$ cut → 1.3-1.5× work per quota) | low | delete `budget pace` call |
| D4 | Instruction load per role (targets below): (a) CLAUDE.md ≤200 lines/≤8 KB, tiering/orchestration into gsd2 coordinator def + main-session skill; (b) MEMORY.md ≤4 KB, ≤40 lines ≤100 chars, incidents to topic files, no CLAUDE.md duplicates; (c) `pre-pr-quality-gates.md` into `/gsd:open-pr` skill + `preflight.sh`, 1-line pointer; (d) testing/edge-functions/database rules → ≤6 KB core + `docs/rules/*-reference.md` on demand; (e) gsd2 def budgets (executor ≤12 KB, others ≤10 KB), no digest duplicates, needed detail steps inlined; (f) emphasis ≤3 per def, must-not-fail rules → hooks; (g) Haiku/Sonnet executors get Anthropic's "keep going / run a real check" paragraphs + `effort: medium`; Opus roles drop self-verify boilerplate (04-P8); (h) `omitClaudeMd: true` for runner/docs roles only (P1 first). | 01-F6/F7/§2a, 05-M5, 04-P3/P4/P5/P8/P15 | executor first turn 38k → ~20k tok; path rules 59k → ≤20k chars; ≈ −$350-550; compaction 21.6% → ~12% (unverified) | CLAUDE/rules/MEMORY edits reach new v0.1.34 spawns → **milestone boundary** (Q3); agent defs none (gsd2) | `git revert`; agent backups |
| D5 | Deterministic model routing: (a) PreToolUse `Agent` hook — executor/test-writer with `model ≠ haiku` needs description `escalate:<reason>`, else deny (log-only first); (b) delete "default sonnet" fallbacks (05-M2c), task-router branch, `<model>`-tag pass; Haiku unless escalated, planner marks `escalate` per task; (c) T1 fix passes → Haiku with finding text, Sonnet only for `needs-judgment`. | 05-M1/M2, 01-F14 | Sonnet executor share 17% → ≤10%, 100% with reason; ≈ −$40-80 (most already won Oct 28) | hook global → log-only until P6 | remove hook; restore detail files |
| D6 | Risk-tiered verification (table below): reviewer reports every finding with severity in JSON; a script filters; loop exits on gates green + no ≥MED (T1) or no ≥MED after Opus (T0). LOWs → `LOW-BACKLOG.tsv`, one Haiku sweep per phase; deferring a LOW needs no Opus ruling. Opus rulings stay for CRIT/HIGH deferral, assertion loosening, T0 design. | 01-F9/F10, 04-P6 | Sonnet reviews/T1 plan 2.3 → ≤1.3; rulings/plan 1.25 → ≤0.5; review+rulings 26% → ~16% (−$500-700); escape proxy must not rise | policy → Q1; T0 classifier needs Opus review | revert policy text; v1 unchanged |
| D7 | Slim artifacts: (a) `gsd-tools summary build` generates SUMMARY.md (≤3 KB) from git log + test-log JSON; agent writes only Deviations + Defect classes; (b) evidence copies committed for T0 only; T1 cites test path + run; (c) FINDINGS.tsv/register rows appended by script from reviewer JSON; (d) one planning-docs commit per plan. | 01-F5; evidence-register 205 spawns/$283; phase 400: 3.66 MB md, 1,114 evidence files | `.planning` line share 51% → ≤25%; evidence-register spawns → ~0; .md output −50%; ≈ −$200 | low (gsd2) | template revert |
| D8 | Dead flows: archive to `agents/_archive/` (not installed): task-router, meta-answerer, nyquist-auditor, integration-tester, ui-inventory, qa-analyst, plan-attacker/defender/judge (trio replaced by an "attack" dimension in the Opus plan-checker for T0). Keep project-researcher, research-synthesizer, discovery-synthesizer, product-investigator (rare by design). Archive knowledge system (`bin/knowledge-*.js`, `conversation-miner.js`, mine-conversations + analyze-pending-sessions workflows); DB file kept read-only. | 01-F12, 05-M3/M4 | agent list −45%; plan-phase Step 9.5/10 removed (~140 lines); ~25 bin files fewer | archiving can break v1 refs → after milestone | `git mv` back |
| D9 | Cross-session learning instead of the knowledge DB: (1) weekly scheduled `metrics_v2.py` → KPI row in `research/KPI.md`; (2) milestone-end `audit-milestone` proposes ≤5 rule edits from Defect Classes for CEO approval; no unreviewed agent writes to rules/memory; (3) MEMORY.md stays a curated index. | 04-P15, 05-M4 | zero carrying cost; measurable loop | none | stop scheduled task |
| D10 | Upstream port (ideas, not merge): agent size-budget test, emphasis-density lint, convergence semantics (max 3 cycles, exit on no HIGH, stall = count not decreasing; 1.38), orphan-worktree pruning in code, atomic hook builds. Evaluate: 1.42 executor stall detection + safe-resume. Don't port: multi-runtime installers, gsd-sdk, graphify, doc-writer family, namespace routers. Keep fork-specific: Charlotte QA, stack-lock, T0 tiers, supervisor, telegram, phase-gate tooling. | 04-P5/P13, 05-M9 | fewer def-size regressions | none | n/a |
| D11 | Reliability: (a) auto-redispatch once from `TASK-CHECKPOINT.json` via `resilience resume-brief` when `verify plan-done` fails, then escalate; (b) phase cap ≤15 plans (`phase-sizer.js`); phase 400 had 52 plans / 26 coordinators; (c) coordinator resume input = CHECKPOINT.json + `git log`, ≤2k-token brief; (d) `SessionStart(compact)` hook re-injects task checkpoint; (e) one Haiku executor per plan task; (f) test output to `.tmp/`, failing lines only (log-only enforcement via D2 hook). | 01-F11 | coordinator resumes 38 → <15; executor compaction 21.6% → <10%; most deaths auto-recovered | low; cap → Q5 | disable flags |
| D12 | Rollout: v2 agents install side-by-side as `gsd2-*` (installer copies `agents/v2/` → `~/.claude/agents/gsd2-*.md`); v0.1.34 keeps `gsd-*`. igaming instruction edits wait for the boundary or a peer "go". Hooks ship log-only, then enforce for `gsd2-*` only (P6). Every change gets a CHANGES.md row with backup path. | CEO constraint | zero change to running behaviour until opt-in | none | uninstall `gsd2-*` |

### D4 targets per role (first-turn tokens; "now" = 01 §2a medians)

| Role (model) | Now: def / inherited / rules mid-run / skills | Target: def / inherited / rules | omitClaudeMd |
|---|---|---|---|
| gsd2-executor (haiku) | 12.4k / 15.9k / ~15-23k / 0 (≈38k + rules) | ≤4.5k / ≤6k / ≤8k | no |
| gsd2-phase-coordinator (sonnet) | 8.7k / 15.6k / ~1k | ≤5k / ≤6k / — | no |
| gsd-planner (opus) | 7.3k / 16.2k / ~6k | ≤7k / ≤6k | no |
| gsd-plan-checker (opus) | 14.0k / 16.2k | ≤6k / ≤6k | no |
| gsd-verifier (opus) | 8.5k / 16.2k | ≤5k / ≤6k | no |
| gsd2-reviewer (sonnet, replaces general-purpose reviews) | 1.1k / 15.9k / 8.4k skills | ≤3k / ≤6k / 0 | no |
| gsd2-runner (haiku, replaces general-purpose runners, 1,026 spawns) | 1.1k / 16.1k / 8.4k skills | ≤1.5k / 0 / 0; tools Bash, Read | yes |
| gsd-docs-updater (haiku) | 7.2k / 15.7k | ≤3k / 0 | yes (P1) |
| gsd-charlotte-qa | 10.3k / 15.6k | defer to Bladebro pilot | — |

### Moved from prose to deterministic enforcement

| Prose rule today | Replacement |
|---|---|
| "Every spawn passes `model` explicitly"; Haiku implements | PreToolUse `Agent` hook (D5) |
| "Wait in-turn / never end turn with children running" | foreground spawns (D1) |
| Spot-check SUMMARY, commit, Self-Check | `gsd-tools verify plan-done` (D1/D11) |
| `--no-verify`, `deno test --no-check`, `git stash/reset/rebase/clean` on shared branch | PreToolUse Bash deny (no existing hook covers these) |
| Blind sleeps / pgrep loops | D2 hook |
| Plan model tags | removed (Haiku default + `escalate:`) |
| SUMMARY/register bookkeeping | `gsd-tools summary build`, register script (D7) |
| Allowlisted test shapes | already `check-test-command.sh`; keep 1 line in CLAUDE.md |

### D6 verification tiers

| Tier | Scope (path/keyword classifier, Opus-reviewed) | Plan | Review rounds | Exit | LOW | Mutation proof | Opus |
|---|---|---|---|---|---|---|---|
| T0 | money, auth, RNG, KYC, payment, ledger, settlement, wallet migrations, RLS/grants | Opus + attack dimension | Sonnet ≤3 rounds fixing ≥MED; then 1 batched Opus diff review | gates green + 0 open ≥MED after Opus | batched sweep; trivial same-file LOW fixed | yes, as today | plan, diff review, verifier, rulings |
| T1 | default code | Sonnet (Opus if architecture) | 1 Sonnet round; 2nd only on CRIT/HIGH | gates green + 0 open ≥MED | `LOW-BACKLOG.tsv`, 1 Haiku sweep/phase | no; fail-first evidence for new behaviour tests | verifier only |
| T2 | docs, `.planning`, test-only refactors, tooling, copy | none/Haiku | 0 LLM review | deterministic gates | n/a | no | none |

## Rollout waves (one `experiments/NN-name/` each: HYPOTHESIS.md + RESULT.md)

Measure with `metrics_v2.py` (E04) over `GSD_SINCE=<ship time>` vs 01 baseline. Underlying scripts: `22_cache_all.py`, `19_q3b.py`, `03b_q1_final.py`, `18_startup_table.py`, `13_q4.py`, `14_q4b.py`, `08_fail.py`, `15_q6.py`, `20_gitplans.py`.

| Wave | Exp | Change | Metric (baseline → target) | Measure | Implement | Review |
|---|---|---|---|---|---|---|
| 0 | 03 (open) | verify cacheTtl 1h | coordinator `ephemeral_1h_input_tokens` > 0; cache-write/read 0.46 → <0.1 | `22_cache_all.py` | Haiku | — |
| 0 | 04-metrics | `GSD_SINCE` in `lib.py`; `metrics_v2.py` | enabler | reproduces 01 ±1% | Haiku | Sonnet |
| 0 | 05-probes | P1, P2, P5, P6, P10 | each answered | probe logs | Haiku | Sonnet |
| 1 | 06-gsd2-namespace | installer `--v2` installs `agents/v2/*` as `gsd2-*` | `gsd-*` byte-identical after install | `diff -r` | Haiku | Sonnet |
| 1 | 07-gsd2-runner | Haiku runner, omitClaudeMd, Bash+Read | first-turn 33.6k → ≤8k; $/spawn 0.18 → ≤0.07 | `18`, `03b` | Haiku | Sonnet |
| 1 | 08-model-hook | Agent PreToolUse hook, log-only → enforce gsd2 | Sonnet executor share 17% → ≤10% | hook log + `03b` | Haiku | Sonnet |
| 1 | 09-wait-hook | Bash wait-pattern hook, log-only first | executor wait 27% → ≤10% of active | `19_q3b.py` | Haiku | Sonnet |
| 1 | 10-gsd2-coordinator | foreground parallel waits + `verify plan-done` + inlined procedure + 1h TTL | polls/phase ~130 → ≤10; cache-write/phase −90% | `22`, `04_scan2`, `15_q6` | Sonnet def, Haiku tooling | **Opus** (03 I1-I4) |
| 1 | 11-gsd2-executor | def ≤12 KB, ≤3 emphasis, Haiku paragraphs, effort medium, maxTurns | first-turn 38k → ≤24k; compaction → ≤12%; Self-Check FAILED not higher | `18`, `08`, SUMMARY grep | Sonnet | Sonnet; A/B on 1 T1 phase |
| 2 | 12-tiered-review | D6 policy + reviewer JSON + filter | reviews/T1 plan 2.3 → ≤1.3; rulings 1.25 → ≤0.5; escape proxy flat | `13_q4`, `14_q4b`, VERIFICATION gaps | Haiku/Sonnet | **Opus** |
| 2 | 13-slim-artifacts | summary generator, T0-only evidence, register script, 1 docs commit/plan | `.planning` share 51% → ≤25%; planning-only commits 46% → ≤20% | `20_gitplans`, `14_q4b` | Haiku | **Opus** |
| 2 | 14-instruction-cuts | CLAUDE.md ≤200 lines, MEMORY ≤4 KB, gates rule → open-pr skill, rule core/reference split — **at milestone boundary** | inherited 15.9k → ≤6k tok; executor rule chars 59k → ≤20k | `18`, 05-M5 query | Haiku/Sonnet | **Opus** (money/auth/RNG rule content) |
| 3 | 15-governor | `budget pace` + policy | zero hard-limit stalls in 2 weeks, or <24 h | `08_fail` | Haiku | Sonnet; Q4 |
| 3 | 16-dead-flows | archive D8 list, after milestone | installed agents 27 → 18; no refs to archived names | grep | Haiku | Sonnet |
| 3 | 17-reliability | auto-redispatch, phase cap ≤15, compact re-inject | coordinator resumes 42% → <20%; ≥80% deaths auto-recovered | `15_q6`, `08_fail` | Haiku | Sonnet |
| 4 | 18-upstream-ports | size-budget test, emphasis lint, convergence check | CI fails on over-budget def | test | Haiku | Sonnet |
| 4 | 19-workflow-pilot (optional) | Workflow script for the D6 review loop only | wall per loop; parent context | transcript | Sonnet | Opus |

Order: 03/04/05 first (P1, P2, P5, P6 gate D2, D3, D4h, D5). 10+11 together on one non-money T1 phase. 12+13 on a T1 phase before any T0 phase. 14+16 at the v0.1.34 boundary.

## CEO decisions needed

| # | Question | Recommendation |
|---|---|---|
| Q1 | T1 exits review at "gates green + no open ≥MED" (max 2 rounds); LOWs batched into one sweep per phase; deferring a LOW needs no Opus ruling. T0 stays strict. | Yes — 67% of findings are LOW and reviewers almost always find something (01-F10); the Opus verifier remains the backstop. |
| Q2 | Mutation proof stays T0-only, not relaxed further. | Yes — 1.2% of $ (05-M8), protects money/auth. |
| Q3 | CLAUDE.md/MEMORY/rules slimming: at the v0.1.34 boundary, or now with peer "go"? | Boundary; exception: move `pre-pr-quality-gates.md` into the open-pr skill now (~$100 / 34 d). |
| Q4 | When weekly usage runs ahead of pace, what is cut first? | plan-ahead → T2/docs → batch Opus rulings → T1 review round 2; never T0 Opus plan/verify; ≥90%: in-flight T0 only. |
| Q5 | Cap phases at ≤15 plans. | Yes — bounds coordinator context and resume chains (01-F11). |

## Open probes

| # | Unverified assumption | Exact probe |
|---|---|---|
| P1 | MEMORY.md reaches subagents? `omitClaudeMd` also drops MEMORY/rules/RTK? | `InstructionsLoaded` hook logging `file_path, load_reason` to `.tmp/il.log`; spawn general-purpose, a test agent with `omitClaudeMd: true`, and Explore, each reading `apps/api/functions/x.ts`; diff logs. |
| P2 | Statusline JSON carries weekly-limit % (`rate_limits`)? | temp statusline wrapper tees stdin to `.tmp/statusline.json`. |
| P3 | Parent cost/cap for long foreground waits | gsd2 coordinator spawns 2 foreground ~70-min children; read return-turn `cache_creation.ephemeral_1h/5m`; check for timeout errors. |
| P4 | `experimental.cacheTtl: 1h` honoured for subagents? | exp 03 on the next coordinator transcript. |
| P5 | Hook edits reach subagents of an already-running main session? | log-only hook writing `.tmp/hook-probe.log`; spawn from an old and a new session; compare. |
| P6 | PreToolUse input has `agent_type` inside subagents; `Agent` tool matchable/deniable with a visible reason? | log-only hook on `Agent` matcher dumps stdin; deny test on a throwaway spawn. |
| P7 | Haiku vs Sonnet executor quality on decomposed plans | within exp 11: same T1 plans; compare Self-Check FAILED, review ≥MED, reruns. |
| P8 | Why wk3 burned est $1,277 without a limit hit (05-M6) | ask CEO whether the plan changed after Oct 27; then P2. |
| P9 | `@file` refs in agent bodies expanded at spawn? | coordinator def with sentinel `@.tmp/sentinel.md`; grep first-turn system prompt. |
| P10 | `SubagentStop` hook can block a background child's stop with a visible reason? | hook exits 2 unless `SUMMARY.md` exists; spawn a child that skips it. |
| P11 | Escape-rate proxy for D6 | per phase: VERIFICATION `gaps_found` + next-phase suite failures traced by `git blame` to the reviewed plan; baseline last 5 phases. |

## Method notes (05-M#)

- M1: `lib.load()`; executors by `lib.rtier` and t0 windows (<10-07, 10-07..10-28, ≥10-29); "fix/resume" = description regex `fix|resume|finish|close|apply|ruling|gap|continue|retry`.
- M2: `rg -o '"name":"Agent","input":{…}'` over all transcripts (parent-side duplicates → shares, not totals). Plan tags: `grep -ciE '<model>haiku|\[haiku\]'` per phase dir.
- M5: `rg '"attachment":{"type":"nested_memory","path":…'` joined to roles; chars = current file sizes (upper bound; `v0.1.33-milestone.md` counted 0).
- M6: est $ prorated uniformly over each file's span into windows between weekly resets (17:00 UTC) and limit-hit times from 01-F3.
- M7: `meta.requestShape == "foreground"`.
- est $ effects are carrying-cost arithmetic, not measurements; each experiment replaces them with measured numbers.
