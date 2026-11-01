# 11: candidates E for gsd-test-writer and gsd-executor, and Haiku under 100k

**Status:** design only. No A/B run, no workflow edit applied. Candidates: `agents/v2/gsd2-test-writer.e.md` (7,315 B, A 7,978), `agents/v2/gsd2-executor.e.md` (30,397 B, D 30,572, A 30,733).

**Citations:** bare paths are this fork. `igaming:` is `~/igaming-platform`. Transcript figures come from `~/.claude/projects/-Users-ollorin-igaming-platform` plus the exp 07/10 extracts, spawn window since 10-11, re-derived by throwaway scripts (not committed). Volume figures come from `git log --numstat` on test globs, excluding `style`/fmt/reflow commits unless stated. Case counts are a regex over `Deno.test|it(|test(|t.step(`: approximate, and it misses wrappers (mines-handlers reads 0).

## Answers

1. **Test-writer does not run because nothing makes it run.** 349 `tdd="true"` tasks in phases 399-404 produced 16 spawns (12 by executors, 4 by a coordinator): 3.4% compliance from executors. Coordinator-owned dispatch plus removing the executor's `Agent` tool is the fix.
2. **Growth comes from T0/canary/guard work and the rule that every review finding gets a test,** with no plan-level budget and no machine-readable delta. The current test-writer does not curb it: arms with a TW child doubled LOC in the eval. Literal duplicates are small (0.8% of LOC); repeated setup is the larger lever (33% of non-trivial lines occur at least 5 times in their own file).
3. **Only fresh spawns move context much, and only if orientation falls.** As measured (68k), splitting raises cost. Modelled, no lever alone gets below about 30% of calls above 100k; the full stack reaches about 12-23%. "Under 100k" as a hard ceiling is not reachable by rules alone.

## Q1. Why the test-writer almost never runs

### Evidence

| Fact | Source |
|---|---|
| 349 `tdd="true"` of 580 tasks in 135 PLANs. Plans/tasks/tdd per phase: 399 35/141/104; 400 52/190/130; 401 22/107/51; 402 17/99/39; 404 9/43/25 | regex over `igaming:.planning/phases/{399..404}*/*-PLAN.md` |
| 0 PLAN.md files name `gsd-test-writer` | same |
| 547 executor spawns, 15-16 TW spawns (brief's 545/15 confirmed, window moved) | transcripts; `RULING-executor-d.md` R3 |
| Spawners of TW: executor 12, coordinator 4 (401-09 only) | transcripts |
| Test authors by Write/Edit chars on test files: gsd-executor 49.0%, **general-purpose 42.8%** (231 spawns, 224 Haiku), TW 7.6%, debugger 0.7% | transcripts |
| Executors spawned 897 general-purpose children (519 haiku, 298 sonnet, 80 opus), 74 untyped, 68 docs-updater, 47 executor, 26 charlotte, 12 TW, 3 runner | transcripts |

The bypass is not only inline tests: nearly as much test text comes from general-purpose children named "400-40 T1 integration RED tests". `igaming:CLAUDE.md` "Subagent Usage IS MANDATORY" is the likely driver (inferred from prompts, not proven).

### Causes, each traced

1. **The instruction is cut off.** The digest ends at `> DO NOT execute the task inline. Instead:` (`agents/gsd-executor.md` ~251) with no action; the action is at `get-shit-done/references/executor-detail.md:320-362`, read in 2 of 21 eval runs (DIAGNOSIS-executor).
2. **The workflow says inline.** `get-shit-done/workflows/execute-plan.md:140`: "if `tdd="true"` -> TDD execution. Implement with deviation rules". `execute-phase.md` has no test-writer dispatch step at all.
3. **The router-and-spawn path goes through a dead step.** `executor-detail.md:328-362` routes via `gsd-task-router` first, which has 0 spawns (R3).
4. **The post-task spawn is off by default.** `get-shit-done/bin/gsd-tools.js:408,424,480` default `test_writer_enabled` to false; `executor-detail.md:228-244`; `igaming:.planning/config.json` does not set it.
5. **Briefs are hand-written.** The workflow template appears in 5 of 547 first prompts, TW is named in 13, `tdd` in 0 first prompts.
6. **Order is contradictory.** `agents/gsd-test-writer.md:3` "Spawned by executor after implementation tasks" and `agents/gsd-planner.md:69` (impl task "immediately followed by" a tdd task) put tests after code, while `execute-plan.md:215-228` and the rules want RED first.
7. **Nothing checks authorship.** No gate reads who wrote a test.

When the spawn was named at the top of the definition, arm B spawned 16 of 20 times and C 11 of 21 (DIAGNOSIS §2). Prose alone tops out near there.

### Who should spawn: coordinator, not executor

| Criterion | Executor spawns (nested) | Coordinator spawns (chosen) |
|---|---|---|
| Depth | Coordinator-under-coordinator occurs (14 spawns); an executor there is at depth 3 and `Agent` is withheld per the sub-agents docs (up to three layers, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). The contract silently fails | Works at any depth a coordinator can reach |
| 2-subagent ceiling | Fine | Fine: serial, TW then executor |
| TASK-CHECKPOINT | TW writes none in either design | Same; TW runs between executors, so no collision. TW death is idempotent because step 1 inventories what exists |
| RED-first | Executor must stop itself before coding | RED commit exists before the executor starts, and is observable |
| Executor context | Parent holds context while waiting, then resumes at same size | Executor starts fresh after RED |
| Cost per 21 days | Parent turn about $5 (150k x $0.05/MTok x 2 x 349) | +about 271 coordinator spawns (488 executor spawns over 135 plans is 3.6 per plan vs 4.3 tasks per plan): 1-2 turns each at $0.065 per turn with 1h TTL (exp 03 sim $250/4,249 turns): **$18-45** |
| Bypass | `Agent` must stay, so general-purpose children stay. `Agent(type)` allowlists are ignored in subagent frontmatter (docs), so it cannot be narrowed | `Agent` removed from executor: deterministic, also closes the 897-child route |

Coordinator costs $13-40 more per 21 days in dollar terms (quota weighting Sonnet vs Haiku unverified). Chosen because it is the only form that is enforceable and does not fail at depth. If X4 misses on cost, the fallback is fewer TW dispatches (tasks with a planner-verified REUSE-only list skip it), not nesting.

### Keeping the executor from bypassing

- **Deterministic:** executor E has no `Agent`/`Task` tool. Plan-end `gsd-tools verify test-authorship` (D5): new case lines only in commits carrying `Test-Author: gsd-test-writer`, or in sweep commits with no new cases.
- **Deterministic, conditional:** frontmatter `PreToolUse` hook denying a new case line, only after `disableAllHooks` is flipped (`igaming:.claude/settings.local.json:76`, exp 09 RESULT). Whether frontmatter hooks run under `disableAllHooks` is unverified: X0 probe.
- **Prose:** executor E returns `## PLAN BLOCKED`, `"reason": "test_writer_required"` when the RED commit is missing, and files `TW-REQUEST` for an auto-fix with no owning test.

**Rollout risk:** an executor without `Agent` under a live coordinator whose hand brief says "spawn a review child" or "spawn gsd-docs-updater" will block. Ship workflow and agents together, at a phase boundary. The drafts keep `name: gsd2-*` for the eval (`scripts/ab-eval/README.md:42`, `roles.json`). The live milestone dispatches `gsd-executor` and `gsd-test-writer`, so at ship the body replaces those files under those names; neither name changes.

## Q2. What drives test growth

### Rule truth

- "Target: 11-20 tests per feature. Never fewer than 6." added `0d86ee1` (2026-03-09); hard "MUST write at least 6" `c61d7bb` (2026-03-13); removed `c02f558` (2026-10-29). `igaming` `721227221` (2026-10-29) added "No test-count minimums", "Merging and deleting are first-class" (`igaming:.claude/rules/testing.md:152-157`).
- **No ban on deleting or merging exists or existed:** `git log -S` for "never delete" finds only `be38497`, about E2E fixtures. The installed test-writer equals the fork file.
- Floor-like text remaining: D:63 auto-fix "at least one test"; `gsd-planner.md:69` MANDATE-1; verifier Step 8d (every implementation file exercised).

### Measured

| Measure | Value |
|---|---|
| Tracked test files, LOC, excluding mobile | 1,401 files, 749.5k LOC (brief confirmed) |
| 60 days, excluding reflow | +525k/-90.7k LOC, +14,831/-3,287 cases, 691 new files, 10 deleted |
| Plans 399-404, 109 scopes, excluding reflow | +140.9k/-27.7k LOC, +3,914/-1,167 cases; net per plan: median 14 cases and 684 LOC, p90 48 cases and 2,140 LOC |
| Commits labelled review/round/ruling/finding, same scope | 783 cases (20%), 25.1k LOC (18%) |
| Same, including reflow commits | 28% of cases; reflow inflates labels, use the 20% |
| Subject labels, overlapping, 60 days | T0/mutant/kill 113k LOC, 3,448 cases; canary/guard 79.8k, 2,216; review 44.7k, 1,461; split/move 28.8k, 798; gate/coverage 18.7k, 633; ruling 8.3k, 310 |
| Coverage-named test files | 29.6k LOC, 818 cases |
| Literal-only duplicates, 257 files touched since 10-25 | 173 of 4,611 tests (3.8%), 2,208 of 275.7k LOC (0.8%), 16 hollow. Top: `operator-methods.test.ts` 26, `scripts/fp-gate.test.ts` 24 |
| Boilerplate | 33.0% of non-trivial lines (44,172/133,879) occur at least 5 times in their own file; 60 LOC per test |
| Files over 1,500 lines | 103 tracked, 253k LOC; 52 of them touched recently, 135.8k LOC |
| ADD rows with `mutant=none`, 401/402 Test Delta | 45 of 120 (37.5%; crude, includes controls and T1) |
| Review docs 399-404, 111 files | "add test" 172, "untested/survivor" 111, "redundant/duplicate" 54, "delete/merge test" 21; sampled hits of the last two are mostly mutation wording |
| Test Delta | 28 of 71 phase-40x SUMMARYs have the section; **0 have `added: N` lines**, so `parseTestDelta` (`gsd-tools.js:7551`) gets nothing and Step 8j is blind |

Before and after the 10-29 controls: +211 to +265 cases/day, 11.2 new files/day either way. Only 4 days and confounded by phase mix: no measured effect yet.

Example: 401-07: +269/-113 cases, 111 from review rounds, over 11 rounds. 402-06: +48/-10, 28 from review.

### Instruction sources

- `igaming:CLAUDE.md` "Fix review findings of every severity": a finding becomes a test by default.
- `igaming:.claude/rules/testing.md:154`: T0 one test per threat, one mutant per guarded condition; `:137` positive control.
- `agents/v2/gsd2-executor.d.md:63` auto-fix "MUST include at least one test".
- Verifier 8d / QGATE-10: 400-52 added tests for 15 modules because 40 files had no importing test.
- Coverage glide path: TW prompts "Cover payments ..." with coverage as the goal.
- Step 8j(a) lets +3,000 net LOC per phase pass with no justification (`get-shit-done/references/verifier-detail.md:1203`); phase 400 alone added 149k gross, including reflow.
- `agents/v2/gsd2-reviewer.md:20-21` can only ask for tests; no finding class says "this test kills nothing".

### The current test-writer does not curb volume

Eval, LOC+/cases+ summed over E1, E2, E3, E6, E7 (15 runs per arm): A 3,381/183, B (TW child) 6,509/303, C 6,367/314. E3: 290/16, 1,051/42, 989/45. E7, A vs B: 38/2, 251/15. `test_quality` B beat A 29 to 2, association only (R3), and A left E3 W2, W4, W5 unwritten, so part of the gap is A under-delivering. As a direct role: TW1 A 194/3, C 110/3; TW2 A 385/6, C 308/5. TW2's flip (the one that hurt C): an unreconciled old fixture, a pinned non-plan constant, and overclaimed counts.

**So a specialist alone would double volume. E has to bind it.**

### What test-writer E does differently

| Change | Where | Enforcement |
|---|---|---|
| Extend by default: REUSE > UPDATE > ADD, ADD needs a reason | Budget | Prose; rows auditable |
| Behaviour budget: one case per behaviour, about 40 net lines (80 real-DB), helper before more | Budget | Prose; X1 gate, later 8j |
| Reconcile contradicting fixtures in the same commit (TW2 fix) | Step 3 | Prose; TW2 regrades it |
| Never pin a name the plan does not name (TW2 fix) | Step 4 | Prose |
| Prune only the block touched; DELETE/MERGE needs a covering citation, sensitive paths need MERGE plus verified mutant | Step 5 | Prose; `igaming:testing.md` existing rule, 8j uncited rows |
| Fail-first: an added case that neither failed at RED nor killed a mutant is removed before commit | Step 7 | Prose; X1 mutant check |
| Coverage: never edit baseline, report deletions, runner checks the floor | Step 5 + D1 | Deterministic at the runner step |
| File above 1,500 lines must not grow | Budget | Prose; deterministic once Phase 418 SC7 lands |
| `added:/updated:/merged:/deleted:/net_test_loc:` from `git diff --numstat` | Report | Parser-compatible, `parseTestDelta`; executor copies to SUMMARY |
| `Test-Author:` body line | Step 8 | Gate D5 |
| Stop at about 40 calls with `NOT WRITTEN` | Steps | Prose. Production TW: 14 of 15 cross 100k, calls 11-81, peak 80-278k |

Modes RED, COVER, PROVE are coordinator-chosen; PROVE keeps R3's independence for high-stakes plans.

### Fit with Phase 418 and the coverage floor

`igaming:.planning/ROADMAP.md:434` Phase 418 owns the **backlog**: test audit, named duplicates, `crash-bet-wallet` split below 1,500, net test LOC at most 0, exclusion list before the first barrel delete (SC6), fp-gate LOC ratchet (SC7), 61 unproven mutants. TW E owns the **flow**, touched blocks only, and says so at step 5.

- **No duplication:** TW E does not sweep; deferred items go to the audit.
- **No floor breakage:** `igaming:.claude/rules/pre-pr-quality-gates.md:75-79,99-104,141-142` allow deletion when the floor holds, and the reviewed exclusion list is planned for 418. TW E refuses barrel deletes unless the brief says the list exists, and never edits a baseline. When `deleted > 0`, the runner runs the coverage gate once at plan end; a lines-axis drop fails and the delete is reverted (D1).
- **418 should adopt TW E** for its rewrites if X1 passes. Its SC7 ratchet turns "may only shrink" into a gate.

## Q3. Context fixes, ranked

### Corrections to earlier evidence

- **Exp 10 "Bash 76%" was a top-20 cache-write attribution.** On all 349 Haiku spawns, regression on growth (60.77M tokens): tool results 51.9%, output 23.7%, constant 18.3%, tool inputs 6.1%. Result chars: Bash about 53.6% (search 17.3, file-inspect 11.6, test 10.2, gate 5.3, other 4.6, git-read 4.4, commit 0.6), Read 43.4%.
- **Exp 10 "crosses 100k near call 35-40" is false.** Of 297 crossing spawns, median crossing call is 9 (p25 6, p75 13). Median context by call: 1 50.6k, 5 79.5k, 10 102k, 15 120k, 25 150k, 40 186k. First turn median 37k, peak median 191k.
- **Orientation is the problem:** context at first edit minus first turn is p25 43k, p50 68k, p75 99k. Resume spawns make their first edit at 105k after 9 calls. Today's fresh spawn is expensive because it re-reads.
- 85.1% of Haiku executor spawns peak above 100k (349 spawns, 21,624 calls) confirmed; 80.3% of calls above 100k.

### Bash cap: docs verified

`code.claude.com` docs: valid output inline up to about 30,000 chars, then a file path plus 2,000-char preview; failures inline about 10,000 head-tail, no path. `BASH_MAX_OUTPUT_LENGTH` sets only the read-back window, "doesn't raise the inline ceilings". `bashOutputMaxChars` (settings, v2.1.261+, clamp 4000-128000) sizes both. **Global per session; no `env` frontmatter.** Per-agent scope only via frontmatter `hooks` PostToolUse `updatedToolOutput`, which hooks being off currently blocks. Installed 2.1.304. Per-call chars: p50 546, p90 5,321, p95 7,836, p99 17,899. Above 8k: 4.85% of calls, 30.1% of Bash chars. A cap hits coordinators and verifiers too, in both directions; a tail-truncated failure costs a read-back.

### Model

Replay of 349 spawns with per-tier prices; baseline $236.2 per 21 days, 80.3% of calls above 100k. TW, runner and coordinator cost excluded; handoff turn included. **Modelled, not measured.**

| Rank | Lever | Cost | Calls above 100k | Kind |
|---|---|---|---|---|
| 1 | Fresh spawn at task commit, tasks sized to 25 calls, orientation 30k | 0.47-0.48x | about 30% | Spawn deterministic (D1), sizing checkable (D5), orientation prose + `plan slice` |
| | Same as drafted in E: task boundaries only, tasks unsized, orient 30-43k | 0.71-0.76x | 54-59% | Handoff trigger prose; observable |
| | Same at today's 68k orientation, every 15/25 calls | **1.46x / 1.15x** | 80-82% | Harmful without rank 2 |
| 2 | Orientation: task slice, handoff replaces rereads. Precondition of rank 1 | alone about 0.93x | 77% | Plan slice tool deterministic, rest prose |
| 3 | First-turn trim (`omitClaudeMd`, frontmatter, v2.1.271+): -10k | 0.94x | not computed | Deterministic, but drops project rules: X3 must check banned-shape regression |
| 4 | Read by range; all Read capped at 8k | 0.91x | 76% | Prose; `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` is global |
| 5 | Bash cap 8000 (no read-back / 50% read-back) | 0.93-0.96x | 77-79% | Deterministic, global |
| | 6000 / 4000 | 0.91-0.95x / 0.89-0.94x | 76-78% / 75-78% | Same; more risk on failure output |
| 6 | Log-file shape via `gsd2-runner` or redirect, grep then read | 0.95x | 79% | Prose; `.tmp` logs are already 19.9% of Read chars, so the read-back is where it leaks |
| 7 | Path-rule load | about 0 | | Nested rules about 2k chars; rule reads 3.2% of Read chars |

Stacks: cap 8k + log + plan 6k: 0.85x, 73%. Plus split every 25, orient 30k: 0.38x, 22.7%. Plus first turn -10k, commit-or-25, orient 30k: 0.32x, 13.1%. Same with orient 20k and every 25: 0.26x, 11.6%. Below 10% is not reached by any modelled combination. Autocompact stays rejected (exp 10).

**Coordinator cost cuts against rank 1.** Task-boundary dispatch adds about 271 spawns, $18-45 per 21 days. As-drafted E saves $57-69 on Haiku, so net **0.78-0.95x** in dollars, before TW cost. The saving is real only when sizing also lands. X3 gates on the total including coordinator turns. If it fails on that term alone, one option to weigh then, not designed here: a Haiku per-plan driver between coordinator and executor, which adds a depth level and so breaks under coordinator-in-coordinator. Unverified.

**Mid-task spawns stay out.** The handoff protocol commits at a task boundary, and the live protocol must stay parseable. So the "every 25 calls" numbers need tasks sized at planning time (D4). `maxTurns` is a deterministic backstop only if its partial output can be recovered with uncommitted work: unverified, X0 probe. Modelled with a 40-call cap, orient 30-43k: 0.54-0.62x, 38-47%.

**Resume-by-agentId defeats the fix.** `execute-phase.md:148` "Prefer resume-by-agentId over cold fresh-spawn when in-session (App #2)" reuses the transcript, so context does not reset. For Haiku it must be a cold spawn (D1). `igaming:CLAUDE.md` already bans SendMessage to a handed-back child.

### Deterministic vs prose

- **Deterministic:** executor tools; coordinator dispatch order (given coordinators follow the workflow, and hand-written briefs are the known leak, 5 of 547 use the template, so `verify test-authorship` is what catches misses); `bashOutputMaxChars`; `omitClaudeMd`; `maxTurns`; `plan slice`; plan-structure lint; coverage gate at plan end.
- **Prose:** orientation rules, read-by-range, first edit within 5 reads, TW budget and stop rule, handoff trigger. Context cannot be observed by the agent; a PostToolUse hook could inject a call count through `additionalContext`, only once hooks are on.

## Protected formats

Verified against D on the draft: `checkpoint_return_format`, `task_commit_protocol`, `completion_format` byte-identical. The handoff JSON and trailer block differs only in the continuation sentence. `reason` remains `context_pressure` on handoff. New status text is carried in existing fields: `reason`, `recommended_split`. Definition tests on a copy (`get-shit-done/bin/gsd-tools.test.js` name filter for executor, test-writer, resilience, drift, tdd, docs, telemetry, 59-0): baseline 278 of 278, E pair 278 of 278, including the prompt budget of 6,700 est tokens. TW keeps the Telemetry line pinned at `gsd-tools.test.js:14474-14494`. `eval-harness.test.js:371` expects a TW entry in the spawn trace (MILE-37): coordinator-owned spawns must still appear there at ship. `gsd-tools.test.js:6266,7210` tdd limits follow D3. All in `get-shit-done/bin/`.

## R1-R6 status

| Ruling | Status for E |
|---|---|
| R1 G6-Q (D only) | Superseded for E by gates below; size clause kept (at most current definition) |
| R2 hidden tests informational per file | Binds |
| **R3 inline RED everywhere, TW after GREEN on high-stakes** | **Superseded.** CEO decision: TW is the specialist. TW RED always; PROVE after GREEN keeps the independence R3 wanted. R3's cost objection (E3-type $0.37-0.79) answered by X4's cost gate and TW's budget. Its objection "child cannot be the RED step" answered by changing the description and spawner |
| R4 log path `../../.tmp/`, 9-minute slices, no `timeout`, poll regexp | Binds. `cacheTtl` still added at ship, not in the draft |
| R5 one-line App #4, protected blocks, banned-shape fix | Binds; inherited from D |
| R5 narrower brief may skip docs child | Superseded: `gsd-docs-updater` moves to the coordinator. Narrow-brief wording on suite and `.md` remains |
| R6 handoff left out, tested separately | Superseded in draft, kept in spirit: E carries a forced task-boundary trigger, as R6 recommended, and X3 tests it alone. Needs R6's `ab_run.py` continuation loop |

E's edit to D:63 "at least one test" supersedes that floor: extend the owner, else `TW-REQUEST`.

## Workflow and planner edits (not applied)

### D1 `get-shit-done/workflows/execute-phase.md`

```diff
@@ step 3, before the executor spawn
+   **Test-writer dispatch (coordinator-owned).** Before the executor of a plan with `tdd="true"` tasks:
+   Agent(subagent_type="gsd-test-writer", model="haiku", prompt=<mode: RED, task_name, behaviours: the
+   task's <behavior> lines, files, project_dir, test_framework>). One at a time. Pass its commit to the
+   executor as `<red_commit>{sha}</red_commit>`, or `<reuse>` when every behaviour is REUSE. After the GREEN
+   commit of a task with mutants: same agent, mode PROVE, with mutants and GREEN sha.
+   `## PLAN BLOCKED` with `"reason": "test_writer_required"`: dispatch RED for that task, respawn from it.
+   Two blocks on the same task: judgment call, escalate per project rules. `TW-REQUEST` in a report: dispatch.
@@ :148 (also :183 and :361, same rule)
-   3. **Prefer resume-by-agentId over cold fresh-spawn when in-session (App #2, `@get-shit-done/references/agent-messaging.md`).** Decide by this rule:
+   3. **Haiku executor: always a cold spawn from the handoff; resume keeps the old context and defeats it. Other tiers: prefer resume-by-agentId when in-session (App #2, `@get-shit-done/references/agent-messaging.md`).** Decide by this rule:
@@ after the executor returns
+   After SUMMARY: Agent(subagent_type="gsd-docs-updater", ...) (moved from the executor).
+   gsd2-runner: `gsd-tools verify test-authorship {plan_id}`. If any report shows deleted > 0, runner also runs
+   the project's coverage gate once. A floor failure reverts the deletion through a TW dispatch.
```

Coordinators take reviews too; no brief may ask an executor to spawn anything.

### D2 `get-shit-done/workflows/execute-plan.md`

```diff
@@ :70
-spawn gsd-test-writer with `model="haiku"`)
+the coordinator spawns gsd-test-writer with `model="haiku"` before tdd tasks; the executor cannot)
@@ :140
-   - `type="auto"`: if `tdd="true"` → TDD execution. Implement with deviation rules + auth gates.
+   - `type="auto"`: if `tdd="true"` → confirm the RED commit or REUSE list from gsd-test-writer, else return BLOCKED; implement to green. Implement with deviation rules + auth gates.
```

### D3 `get-shit-done/references/executor-detail.md`, `agents/gsd-test-writer.md`

Replace `:228-310` and `:320-391` with one line pointing at the coordinator's dispatch; update `gsd-tools.test.js:6266,7210`. Remove `test_writer_enabled` defaults at `gsd-tools.js:408,424,480` once nothing reads them. The description at `agents/gsd-test-writer.md:3` becomes the one in the draft.

### D4 `agents/gsd-planner.md`, `get-shit-done/references/planner-detail.md`

```diff
@@ gsd-planner.md:20
-- Decompose phases into parallel-optimized plans with 2-3 tasks each
+- Decompose phases into plans with 2-3 tasks each; each task fits about 25 executor tool calls
@@ gsd-planner.md:69
-Every task that creates or modifies implementation files (.ts, .tsx, .js) MUST be immediately followed by a `tdd="true"` test task in the same plan,
+Every task that creates or modifies implementation files (.ts, .tsx, .js) MUST be immediately preceded by a `tdd="true"` test task in the same plan, `agent="gsd-test-writer"`,
@@ gsd-planner.md:309
-- [ ] Each plan: 2-3 tasks (~50% context)
+- [ ] Each plan: 2-3 tasks. PLAN.md at most 16 KB. Each task has <read_first> with path:line ranges, so a fresh executor orients in about 5 reads
@@ planner-detail.md:192-202
-<task type="auto" tdd="true">
+<task type="auto" tdd="true" agent="gsd-test-writer">
-  <action>Spawn gsd-test-writer to inventory existing tests first, then reuse, update, merge, or add tests for the behaviours above.</action>
+  <action>Dispatched by the coordinator before the implementing task. Dispositions above are the test-writer's scope.</action>
```

PLAN reads are 11.1% of result chars with mean 21 KB, which is why the limit and slice matter.

### D5 `get-shit-done/bin/gsd-tools.js` (new, each with a test and a demonstrated failure)

- `plan slice <plan> <task>`: prints objective, the one task block, and `<read_first>`.
- `verify test-authorship <plan>`: added case lines per commit in plan's range; fail when a line sits in a commit without `Test-Author:`. Regex approximate: wrappers can hide cases, so it needs a corpus and the guard-authoring canary rule.
- `verify plan-structure` (`:14424`) adds: tdd task precedes its implementation task, PLAN size, `<read_first>` present (warn first).

### D6 `agents/gsd-plan-checker.md:377` Check 8-T4

Add a blocker: test task after its implementation task. Add: a task over about 25 calls in scope (files and behaviours) is a split finding.

### D7 `agents/gsd-verifier.md:148` / `verifier-detail.md` Step 8j

Add: `## Test Delta` must carry machine-readable lines, not free-form tables (0 of 71 today). Add a per-behaviour report: net LOC per ADD above budget is a `gaps_found` row unless justified. Lower the per-phase +3,000 only after X4 and 418's audit.

### D8 `agents/v2/gsd2-reviewer.md:20-21`

```diff
+- A test you demand names the behaviour or mutant it would catch. Extend the owner rather than add.
+- Test volume is a finding: a case that kills nothing, a literal-only variant, or setup copied instead of extracted.
```

### Project rules (CEO decision, Phase 418 or earlier; not in this fork)

- `igaming:CLAUDE.md` "Subagent Usage IS MANDATORY": an implementer never spawns implementers.
- `igaming:CLAUDE.md` "Fix review findings of every severity": the fix for a test finding names a killed mutant, and may be a merge.
- `igaming:.claude/rules/testing.md:154`: "one test per threat" reads as a floor on files; add "extend first".

## Experiments

Each runs against A and reuses A rows where the harness allows. Registration is this file; any later aggregate change is committed before the first row. Models by alias only. `variant-from-drafts --suffix .e`. Harness changes come from a separate brief.

### Volume metric (new)

Per run, from `diff.patch` on test globs, excluding pure-whitespace hunks:

- `cases_added`, `cases_removed`, `loc_added`, `loc_removed`, `net_loc`; per task `behaviours` from a new registry
- `loc_per_behaviour`, `cases_per_behaviour`
- `kills_per_added_case` = seeded mutants killed / max(cases_added, 1), using `ab_role_grade.grade_mutants`
- `mutants_survived`
- Stat: sum over tasks of per-task medians, as elsewhere

Known weakness: regex case count misses wrappers. Check per task at calibration, or use a task-specific pattern.

### X0 calibration, no LLM except the probes

1. Harness: continuation loop on `interrupted` (R6, about 40 lines); ordered TW then executor dispatcher to imitate D1; `behaviours` registry; volume metric; `bashOutputMaxChars` arm via `--settings` (the `--window` arm is the model).
2. Seeded mutants for E3, E6, E7 (`mkmutant.py`), calibrate with `ab_calib.py` against the reference solutions.
3. **TW3, bloated file:** from `apps/api/functions/payments/handlers/operator-methods.test.ts` (1,567 lines, 26 literal duplicates). New behaviour plus a duplicate-heavy block in scope. **TW4:** from `apps/api/functions/games/handlers/crash-multiplayer-handlers.test.ts` (4,267 lines; duplication unmeasured, probe first; replace it if under 10 duplicates). Both with reference solution, seeded mutants, and net LOC at most 0 achievable, shown by the reference.
4. A-vs-A about 10 judge pairs. R1 did not measure noise; gates below assume it.
5. Probes: `maxTurns` partial output and recoverability; frontmatter hooks under `disableAllHooks`; `bashOutputMaxChars` reaching subagents; TW `Test-Author` trailer surviving the commit hook.
6. Baseline volume from existing rows, no new runs.

Cost: about 3 runs for probes plus TW3/TW4 reference checks, about 1pp.

### Order and gates

Separately testable: the TW (X1), the cap (X2) and the handoff (X3) are each single-factor. Spawn contract (X4) depends on X1. Run X1 first: cheapest, and X4 is pointless without it.

**X1, TW E vs A, role-direct.** TW1-TW4, 5 reps (20 runs, A top-ups for TW3/TW4). About $9-10, about 3pp.

| Gate | Pass |
|---|---|
| Acceptance | At least A per task, no flip (TW2 A 3/3) |
| Mutants survived | At most A |
| Volume | Sum of medians: LOC at most 0.8 x A; cases at most A |
| Bloated start | TW3, TW4: net LOC at most 0 and every behaviour covered |
| Kills per added case | At least A |
| Judge `test_quality` | Non-inferior, using X0's noise |
| Honesty losses | At most A + 1 (TW2 overclaim must not recur) |
| Cost | Sum of medians at most 1.0 x A |
| Share above 100k | At most A |

**X2, Bash cap, one arm.** A + `bashOutputMaxChars: 8000`; E3, E4, E6, E7 x 3 (12 runs). About $6, about 1.5pp. Pass: acceptance no flip; cost at most 0.95 x A at tier prices; calls above 100k lower; read-back counted and reported; judge non-inferior. A pass still needs one verifier and coordinator check, because the setting is global and tasks test only executors.

**X3, executor E handoff and orientation, no TW.** Executor E with RED requirement off by brief; E1, E4, E7 x 3 with continuation, about 18 spawns. About $12, about 4pp.

| Gate | Pass |
|---|---|
| Cost | Tokens at most 0.85 x A including 1 coordinator turn per extra spawn at $0.065, or at most 1.10 x A with quality better (R1 form) |
| Manipulation | Orientation median at most 35k. **Miss = reject the handoff; at 68k it raises cost** |
| Above 100k | Share at most 40% |
| State loss | 0 lost commits; handoff JSON valid every time; final tree grades as A |
| Quality | Non-inferior; acceptance no flip; banned-shape count at most A |

**X4, spawn contract.** TW E + executor E through the dispatcher vs D inline (never run) vs A; E1, E3, E6, E7 x 3. About $25, about 7pp.

| Gate | Pass |
|---|---|
| Manipulation | TW on all tdd tasks; 0 new case lines by executor; 0 general-purpose children |
| Volume | Per behaviour at most the current child, and at most 1.25 x best inline |
| Kills per added case | At least inline |
| `test_quality` | Net better than inline |
| Cost | At most 1.10 x inline, TW and coordinator turns included |
| Blocking | No false `test_writer_required` on E1/E4 test-only sweep tasks |

Any FAIL rejects that candidate without a second round. X3 pass with X4 fail ships the handoff with the inline rule. X1 pass with X4 fail ships TW E only as a phase-418 tool.

**Limit of a pass.** E1-E7 are the tasks D's rules were drawn from, and hand-written production briefs differ. A pass means ship with a check: 14-day post-rollout read of TW share of authored tests (target above 90%), Haiku calls above 100k, net test LOC per plan, TW peak context. n=3-5 finds large effects only.

### Quota

`~/ab-eval/results/quota.json`: 7-day 0.75, resets 2026-11-03 17:00 UTC, ceiling 0.85, so 10pp left. Wave 2 rate about 0.26pp per $ (upper bound, production also ran). Total about 16pp plus calibration. **X0, X1 and X2 fit before the reset (about 5.5pp). X3 and X4 go after it.** Mid-week estimate if production keeps running at today's rate: unverified.

## Open

- Quota weight of a Sonnet coordinator turn vs Haiku turn: unverified. Probe: compare `quota.json` deltas over a coordinator-heavy interval.
- Whether coordinators follow a new step without the template: 5 of 547 used it, so the authorship gate is the real enforcement. A hand-brief coordinator will get blocks, not silent bypass. Unverified until X4-adjacent production trial.
- E has no `maxTurns` and no `omitClaudeMd`: left out until X0 and X3 say they are safe.
