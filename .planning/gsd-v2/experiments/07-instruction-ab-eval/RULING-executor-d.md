# Ruling: candidate D (gsd2-executor.d.md), before any run

Independent review of `DIAGNOSIS-executor.md`. Nothing was run in the eval, docker or supabase. Numbers are recomputed from `~/ab-eval/results/runs.jsonl` through `ab_aggregate.load_runs` and `split_rows` (regrades applied, 40 superseded rows dropped, 0 stale). Definition tests ran on a copy in `/tmp`, since deleted. A:n means `agents/gsd-executor.md` at `69bbbd3`; D:n means `agents/v2/gsd2-executor.d.md` at this review.

| # | Ruling | One line |
|---|---|---|
| R1 | MODIFY | Sound in principle, but the author's gate lets a tie ship. Add a strict "better" clause; use the sum of task medians, not a pooled median |
| R2 | MODIFY | Claims verified. Make hidden informational per file, not per task. B and C stay rejected |
| R3 | MODIFY | Split by risk: inline RED first always, plus one `gsd-test-writer` after GREEN on high-stakes plans |
| R4 | MODIFY | The shape is usable, but D's poll is broken and its 4-minute premise was overtaken at 18:04 today by the 1 h TTL rollout |
| R5 | MODIFY | "0 prompts" holds, "no workflow emits it" is false. D breaks two tests as written. Keep a one-line App #4 |
| R6 | PASS | Leaving handoff out is right. Cheapest test: forced handoff on E1 and E4, 6 runs |

Outside the questions, for the CEO: `~/igaming-platform/.claude/settings.local.json:76` sets `"disableAllHooks": true`. The file is untracked, so nothing in git shows it. Every project hook in `.claude/settings.json:326+` is inert here, confirmed live: `echo deno test ...` passed although the script exits 2 on that string, and none of the 10,489 unprefixed test commands in the extract shows the hook's message. "Never touch the guardrails" is guarding switched-off hooks. Whether user-level `gsd-guard-bash.js` also stops firing is unverified; probe: one `git commit --no-verify` attempt on a scratch repo. I did not change this.

## R1. Gate for a "same tokens, better quality" arm: MODIFY

Replacing G6 for this arm is sound. G6 (DESIGN:245, `ab_aggregate.py:224-231`) asks whether the change pays. A first-turn ratio is the wrong way to ask that for a non-slim, and declaring the swap before the run avoids a post-hoc loosening.

The proposal as written fails: cost plus size ensures no extra spend but nothing ensures gain. G2 (`B >= A-1`, `:99`), G3 (`:124,131`) and G5 (`d <= 0.10`, `:203`) are all non-inferiority gates, so an identical arm passes all of them and ships with no value. That is what G6 exists to stop.

Pooled median is also the wrong statistic. It misses the expensive tasks, where the author expects D's extra cost. Against A's fixed rows, resampling A's reps with true cost scaled (10,000 draws):

| True cost vs A | P(pass) pooled median <= 1.10 | P(pass) sum of task medians <= 1.10 |
|---|---|---|
| 1.00 | 0.91 | 0.86 |
| 1.10 | 0.64 | 0.29 |
| 1.20 | 0.02 | 0.005 |

The author's $0.49 is the estimated figure. The gate's field, `result_cost_usd`, has median $0.546 and sum of task medians $4.37. B is 1.55x and C 1.40x on that sum.

**Gate G6-Q, replacing G6 for arm D only. G6's ratio is still printed, not gating.** All of:

1. **Cost.** Sum over E1-E7 of the per-task median `result_cost_usd`: D <= 1.10 x A, so <= $4.81. Any D row with `status: failed` and no result line, after one rerun of an infrastructure void, fails this clause. `ab_aggregate.py:248` silently drops missing costs, and E4-B-r2 (90 min) has none.
2. **Size.** `wc -c` of the D draft <= 30,704, the as-run A at `69bbbd3`.
3. **Better**, all three, so a tie cannot pass:
   - (a) `test_quality` net, D-win minus A-win, over every Opus judgment in both orders >= +10 of 42, and the task-clustered bootstrap 10th percentile of that net > 0 (10,000 resamples, seed 7, as `bootstrap_upper90`).
   - (b) `fail_first == proven` count: D >= 3 (A has 1).
   - (c) Overall pairs: D-wins >= A-wins, so d <= 0. G5's tolerance of 0.10 does not apply to an arm claiming to be better.

Calibration, disclosed because these thresholds were set after seeing wave 2: B has net +27 of 40, p10 +17.7, proven 4, d -0.05, so it clears all three. C has net +7, p10 -2.0, proven 3, d +0.048, so it fails (a) and (c). Only E2 and E3 discriminate on (b): E1 is `unknown`, E4 and E5 `n/a`, E6 `module-missing` and E7 `absent` in all three arms. The false-pass rate for a truly tied arm was not computed; no A-vs-A judge data exists. Probe if wanted: judge 21 A-vs-A pairs.

No S4 extension and no retune round. One pass of 21 runs; a fail rejects D. A second candidate needs a CEO call. This honours "don't loop for hours".

## R2. Hidden tests on E1-E3: MODIFY, informational per file

Verified:

- **All 9 A failures carry a hidden fail** (`hidden.pass` false on all 9). 8 are `api_mismatch`; E3-A-r3 is one assertion failure with `api_mismatch: false`. Three also have real blockers: E1-r1 docs scope, E2-r2 `fp-increase=1`, E2-r3 scope. The author's 5 + 1 + 3 split holds.
- **E2.** `394-01-PLAN.md:173` at `6ea48f652` pins 7 parameters including `ns`. `oracle/hidden/00-cache-generation.test.ts:187,231,246,269` calls 6. All three A diffs have 7 (`_ns` or `namespace`). E2-B-r1, the only pass on E1-E3 in any arm, dropped `ns`, deviating from the plan.
- **E1.** 10 of 14 imported names have zero plan mentions (`assembleGrid`, `catalogueClassIds`, `GridRow`, `inventoryBaseUnits`, `mergeRows`, `normaliseClass`, `parseTsv`, `stripNoise`, `toTsv`, `UNITS`). The plan's `checkGrid` has 4 arguments (`398-02-PLAN.md:78`), the test calls 3.
- **E3.** `cacheInvalidationMeta`, `cacheInvalidationHeaders` and `redis_deadline_breach` have zero mentions in `394-03-PLAN.md`.

DESIGN:190 ("the plan pins the API") is disproved for these three tasks.

**Keep as is: no.** E1-E3 have 1 accepted run of 27 across the arms, and that one deviated from the plan. **Rewrite: no.** E2's rewrite fails at the ref unless the ref changes too. E1 and E3 do not pin enough to test without inventing a contract. It costs hours and new calibration, and would be written after seeing results. **Informational: yes, but per file**, so the loosening is as narrow as possible. Per-task, as the author's table does, would also discard two files every run compiles against:

| Task | Informational | Still gating |
|---|---|---|
| E1 | `grid-check.test.ts` | none |
| E2 | `cache-generation.test.ts` | `redis-client-upstash.test.ts` |
| E3 | `config-cache-invalidation.test.ts` | `patch-arena-config.test.ts` |

Conditions: applies to all arms, declared by this commit before any D run, strict acceptance still printed beside the treated figure, informational pass rates reported per arm, and DESIGN:190 and :424 corrected. E3-A-r3's assertion miss becomes informational too; the judge still sees it.

**Earlier rejections survive.** Recomputed with `usable` denominators, counting E4-B-r2:

| Treatment | A | B | C | G2 B | G2 C |
|---|---|---|---|---|---|
| strict | 12/21 | 2/21 | 7/21 | FAIL, flips E4-E7 | FAIL, flip E6 |
| **chosen, per file** | **18/21** | **6/21** | **12/21** | **FAIL, flips E3-E7** | **FAIL, flips E3, E6** |
| per file + `.md` scope excused (not adopted) | 19/21 | 16/21 | 17/21 | FAIL, flip E4 | FAIL, flip E3 |
| all E1-E3 hidden + `.md` excused (author's) | 19/21 | 16/21 | 18/21 | FAIL, flip E4 | PASS, net 18 >= 18, no flip |

So even the author's most generous reading only clears C's G2. C remains rejected on G5 honesty (20 vs 10, `:203`) and G6 (0.78); B on G2, G4 T0, G5 and G6. Per-file also adds signal: hidden mean on gating files is A 1.00, B 1.00, C 0.857, so C now also fails G3, which it passed before. Correction to the author's table: C is 17/21, not 18/21, under per-file plus docs, and B's denominator is 21 under the aggregator's rule (`usable` includes `failed`).

Docs in a scoped run: not excused. `scope_out` stays a hard blocker, so D's rule to skip the child is the right fix and A's luck in ignoring A:273 is not a defence of A's text.

## R3. Who writes the tests: MODIFY, split by risk

**Definition versus production today.** `executor-detail.md:320` says "DO NOT execute the task inline", and A's digest quotes it without the action. Production ignores it: the gsd-metrics index (`.tmp/gsd-v2/out/files.jsonl`) has 545 `gsd-executor` and 15 `gsd-test-writer` spawns since 10-11, confirming the brief (transcript metas now show 548 and 17). Executors spawned 12 of those. So the real baseline is inline, and D's default documents what already happens. The router step at `executor-detail.md:328` has 0 spawns per the diagnosis; I did not recount.

**Eval evidence.** Verified, with superseded pairs dropped: `test_quality` B 29, A 2 (author's 29 vs 4 includes superseded pairs). C with child 13 vs 2, C without 6 vs 10. This is not randomised, so it shows association only: B on E2 without a child won 4 of 4, and on E4 with a child lost 2 of 2. Child cost scales with plan size, not per run: E6 $0.04, E7 $0.05-0.09, E3 $0.37-0.79. One real hazard: the only B-only T0 critical (`--no-check`, E5-B-r3) came from a child.

**Choice.**

- Everywhere: inline RED-first with the checklist (D:248-253). RED proof must precede implementation, and the child's own definition says it runs "after implementation tasks" (`gsd-test-writer.md:3`), so it cannot be the RED step.
- High-stakes plans (CLAUDE.md "High-stakes domains"): additionally one `gsd-test-writer` after the last GREEN commit, scoped to the same test files. The reason is independence, which CLAUDE.md requires of review in those domains, not the eval's association.
- Not always-spawn: E3-type cost alone ($0.37-0.79) would break the 1.10 bar.

**Eval consequence.** The child should fire on E6 and E7 (`tdd: true`, auth and money), adding about $0.11 to the sum of medians (2.5%), and not on E1 or E2. E3 is cache plumbing around config writers and could go either way; if it fires, its cost counts. E4 and E5 are `tdd: false`. **Production cost estimate:** phases 399-402 are 358 of 547 spawns; at the eval's $0.19/run that is at most about $68 per 21 days (6.4%), lower in practice because only `tdd` tasks trigger it. Unverified: how many of those plans have `tdd="true"`, since briefs mention it in only 15 of 547. Probe: count `tdd="true"` across their PLAN.md files.

At ship, edit `executor-detail.md:320` and A's digest to match. Until then the detail contradicts D, but D:239's pointer list does not send the executor there.

## R4. Log-file shape and wait cap: MODIFY

**Shape, `check-test-command.sh`.** Direct invocation exits 2 for `deno task test x`, `deno test x` and `npx nx test y`, and the redirect changes nothing: same verdict with and without it. The only passing forms are `NODE_ENV=test DENO_ENV=test ...` (`:52`), which CLAUDE.md bans as inline env vars. So script and CLAUDE.md contradict each other independently of D. In practice the hook is inert (see the CEO note), so D's shape is not blocked. If hooks are re-enabled, CLAUDE.md's own allowlist breaks first.

**Shape, CLAUDE.md.** "Run tests only in allowlisted shapes" neither lists nor bans `> file`; it lists a trailing `2>&1`. Allow rules are prefix matches (`.claude/settings.json:44,57`). Production has 2,891 redirected test commands, 873 with no pipe, and 2 classifier denials. One denial is this shape under a `stack-lock.sh` wrapper, reason "Interfere With Workloads", cause not established. Permission prompts are not visible in transcripts: unverified, as the author says. Probe: one such command in an attended default-mode session. Recommendation: add the redirect to CLAUDE.md's shape line so D is not relying on silence.

**Path defect.** From `apps/api`, `.tmp/x.log` is `apps/api/.tmp`, not the repo root CLAUDE.md requires ("at the repo root"). Use `../../.tmp/`; the harness allows it (`harness-deny.py:4`, RUNNER.md:119).

**`timeout N` is dead here.** `which timeout` finds nothing, and 10 of 96 such production commands logged exit 127. Why the rest did not is unverified. Drop it from D. Sibling at ship: `executor-detail.md:478` runs `timeout 300 bash -c`, which is both missing and a banned shape.

**The poll is broken three ways.**

1. The pattern `(ok|FAILED) \|` never matches. Real logs have ANSI between the words: `\x1b[31mFAILED\x1b[0m | 23 passed`. On `.tmp/404-02-red.log` it matches 0 lines, and `\| [0-9]+ passed` matches 1. Every poll would run its full length.
2. 40 x 5 s is 200 s, over the Bash default of 120 s, with no `timeout` set in D and no override in settings.
3. `$(seq ...)` is needless; `{1..N}` works in this shell. `Bash(for:*)` is allow-listed (`settings.json:264`), and all 231 `sleep` blocks in production started with `sleep`, so `sleep` inside a loop is fine.

**A cap does not break long jobs, if it is per wait.** Buckets and lock waits run in the background. `stack-lock.ts:21` defaults to 3600 s, so a stall cut-off must sit above that or it kills a valid lock wait: 65 minutes. It should also match `stack-lock: timed out`.

**The 4-minute premise is out of date.** `cdb285a`, 18:04 today, CEO approved, sets `experimental.cacheTtl: 1h` on the executor. `research/06-PROBES.md:9` shows subagents honour it. So "expires after 5 idle minutes" is false for the shipped executor, and 4-minute slices now pay for reads with nothing to save. Use 9 minutes (Bash maximum is 10). Consequences:

- The diagnosis's **$114 saving (row 2a) can no longer be claimed for D**; the TTL took it, as the diagnosis itself anticipated (§3 "TTL alternative"). D's case now rests on eval quality plus part of $22 in re-runs.
- **Control pinning.** The A rows ran at sha `e2b2ec1a`; the installed file is now `20f84401`. Reuse the rows and **do not rebuild `variants/A`**, or `stale_reason` (`ab_aggregate.py:302-308`) excludes all of them. D stays without `cacheTtl` for the eval so both arms are 5 m. Writing at 2x would fail D unfairly. Add the two frontmatter lines when shipping.

Exact wording is in the edit list below. It is not exercised in the eval: stack work is excluded and A rows show no gaps over 5 minutes, so check it post-rollout.

## R5. App #4 removal and protected formats: MODIFY

- **`<wave_peers>` absent: confirmed and stronger.** 0 of 547 in the window and 0 of 1,257 executor prompts in the whole extract, none clipped. CLAUDE.md forbids two executors in one phase.
- **"No workflow still emits it": false.** `workflows/execute-phase.md:190-200` still tells coordinators to inject it for parallel waves. `references/agent-messaging.md:86-91` documents it. `gsd-tools.test.js:16230-16238` asserts it. It is unreachable here by project rule, not by code, and the fork's workflow is generic.
- **D as written breaks tests.** On a copy with D in A's place: baseline 42 pass, 3 fail; D 40 pass, 5 fail. New failures: App #4 and App #5 (`/OPTIONAL/` is case-sensitive, `:16243`). With the edits below: 42 and 3, the same 3 as baseline. Those 3 sit in budget and wiring suites and may be a side effect of the partial copy; not investigated, not caused by D.
- **Fix:** keep a one-line App #4. It costs 150 B, keeps the emitter's contract valid and needs no sibling edits. `<wave_peer_awareness>` (`execute-phase.md:195`) names a tag that exists in neither A nor D, already dead.
- **Other dependencies: none.** The App #1 and #6 hooks (D:174, D:397) point at a block that never held their detail in A either. D:320's heartbeat pointer still resolves.
- **Protected text: verified per tag.** 15 of 18 blocks are byte-identical to A, including `checkpoint_return_format`, `task_commit_protocol`, `executor_resilience_protocol` and `completion_format`. TASK-CHECKPOINT, EXECUTOR-HANDOFF, the JSON status trailer and the `**Type:**` line are unchanged. Neither file has `Co-Authored` text or `--no-verify`/`--no-check` text, so nothing was lost there. Commit trailers are unaffected.
- **Banned shapes:** D:136 restates CLAUDE.md. A contradiction inherited from A remains at D:376, "pipe long command output through grep/tail", which bans itself against D:136. Fixed below. That and the routing snippet are the only protected-block touches I require, and neither is a format.
- **Two behaviour changes the diagnosis under-reports:**
  - D:243 lets a narrower brief skip the docs child and the whole suite. Production resumes use hand-written briefs (diagnosis §4, `<completed_tasks>` in 0 prompts), so "resume at task 4" could read as narrower and drop both gates. Fixed below.
  - D:259's last sentence narrows A's HARD RULE on infrastructure to the case where a brief declares the stack unavailable. Accepted, since it is coordinator-declared.
- Minor: D is 30,105 B, not the stated 30,125.

## R6. Earlier handoff left out of D: PASS

A `status: interrupted` return has nowhere to go: `ab_run.py` has no continuation handling (no match for `interrupted`, `continuation` or `handoff`), so it would be graded as partial. Adding it to D would also confound the quality question. The $215-275 is a simulation assuming 15-30k and 6-12 turns per restart, with no quality term; I did not re-run it.

Cheapest honest test, as a separate experiment after D's verdict:

1. Add about 40 lines to `ab_run.py`: on a trailer `status: interrupted`, spawn a fresh executor with the handoff, sum the costs, grade the final tree.
2. Use a forced trigger, "hand off after every task commit", not a context estimate, because no context counter exists. This separates "does a restart pay and hold quality" from "can the model estimate context". It is also the worst case for handoff.
3. Run E1 and E4 only, 3 reps, 6 runs at about $6 plus judging, reusing A rows. Both have 3 tasks, and A peaks at 166-265k. E2 and E3 are single-task, so they have no boundary to hand off at, whatever their context.
4. Pre-register: sum of task medians <= 0.85 x A, G2 and G5 pass. If so, build the real trigger. If not, drop the lever.

## Required edits to D before running

Exact replacements in `agents/v2/gsd2-executor.d.md`. Applied together on a copy: 30,572 B, under the bar, and tests as baseline.

1. D:136. Replace `` from `apps/api`: `deno task test <file>`, `deno test <file>` (optional `timeout N`, trailing `2>&1`), `npx nx test <project>`, `deno check|lint|fmt`. `` with:
   `` from `apps/api`: `deno task test <file>`, `deno test <file>`, `npx nx test <project>`, `deno check|lint|fmt`, each with at most one trailing log redirect or `2>&1`. No `timeout` command on this host: use the Bash `timeout` parameter. ``
2. D:138. Replace `` `deno task test <file> > .tmp/<name>.log 2>&1`, then `` with:
   `` `deno task test <file> > ../../.tmp/<name>.log 2>&1` (repo-root `.tmp/`), then ``
3. D:140. Replace the whole paragraph with:
   ``**Wait in slices of at most 9 minutes** (Bash allows 10). The cap is per wait, not per job. Start anything that can outlast that with `run_in_background` and a `.tmp/` log, then repeat this poll with the Bash `timeout` set to 540000, matching the runner's last line: `for i in {1..100}; do grep -qE '\| [0-9]+ passed|Found [0-9]+ error|stack-lock: timed out' ../../.tmp/x.log && break; sleep 5; done`. No output for 65 minutes: stop it, return `## PLAN BLOCKED`. Never an unbounded `until` loop, never `sleep N; cmd` (blocked); no Monitor tool.``
4. D:243. Insert this bullet immediately before it:
   `- A resume or continuation brief is not narrower if it runs to the plan's last task.`
5. D:253. Insert this line immediately after it:
   `` 6. If the plan changes auth, money movement or payments, fraud/AML, KYC gates, RNG/fairness, game config values or game logic: after your last GREEN commit spawn `gsd-test-writer` once (model haiku) with the plan's case list and your test files, write only to those files, and commit what it adds. ``
6. D:299-304. Delete the `# Track routing tier for SUMMARY` bash block with its trailing blank line. It is 0-use, shell variables do not persist across calls, and `executor-detail.md:61-62,594` handles an unset tier.
7. D:376. Replace `pipe long command output through grep/tail instead of ingesting it raw` with:
   `` send long command output to a `.tmp/` log and read only the lines you need ``
8. D:461. Replace `### App #5 — Optional progress heartbeat` with:
   ```
   ### App #4 — Wave peer awareness

   If your prompt has a `<wave_peers>` block, `SendMessage` a peer only when you edit a file in its `files_modified`. Never chatty.

   ### App #5 — OPTIONAL progress heartbeat
   ```

Before or at ship, not for the eval: add `experimental: {cacheTtl: 1h}` to D's frontmatter, and edit `executor-detail.md:320,478`.

## Pre-registered gates for arm D

Run: 21 D runs, 3 reps on E1-E7, haiku. Reuse the 21 A rows and 21 pairs of Opus judgments in both orders. `variant-from-drafts --suffix .d`, no rebuild of A. This commit is the registration; the aggregate changes must be committed before the first D row. If D's `result_model_keys` differs from A's, rerun A rep 1 before comparing.

| Gate | Pass condition | Source |
|---|---|---|
| G1 | Inherited context within 5% | unchanged |
| G2 | Treated acceptance D >= 17/21 (A 18), no flip. Strict figure printed beside it | R2 |
| G3 | Hidden mean on gating files D >= 0.95 (A 1.00), `fail_first` proven >= A-1 | R2 |
| G4 | Criticals D <= 1, no D-only T0 | unchanged |
| G5 | d <= 0.10, clustered upper <= 0.25, honesty losses D <= A+1 | unchanged |
| G6-Q | Cost, size and better (a), (b), (c) as in R1 | replaces G6 for D only |
| G7 manipulation | `gsd-test-writer` on >= 4 of 6 E6 and E7 runs; 0 on E1 and E2; docs child and `.md` `scope_out` on <= 1 of 21 | Miss on the test-writer clause = INCONCLUSIVE, since the hypothesis was not tested. Docs clause miss = FAIL for the narrow-brief wording |

Any FAIL rejects D, with no second round.

**Limit of a PASS.** D's rules were written from these tasks' judge quotes ("Self-Check: PASSED", the `void 0` mutant, reflow, the stack excuse), so a pass is optimistic: the tasks are training data, and `<scope>` appears in 0 of 547 production prompts. A pass means ship with a check, not proven. After 14 days compare, on the 1 h baseline: pipe rate per test command, re-runs with no edit, `fail_first`-style RED commits in live plans, review findings per plan. If none improves, revert D.
