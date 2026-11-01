# gsd-executor: diagnosis and candidate D

Status: candidate only. No A/B run, nothing installed. Candidate: `~/get-shit-done/agents/v2/gsd2-executor.d.md`, 30,125 B against A's 30,704 B (-579 B, -1.9%). A = `agents/gsd-executor.md`, cited as A:n. B = `agents/v2/gsd2-executor.md`, cited as B:n.

## Answer

1. **A does not fail 9 of 21 on instructions.** All 9 fail on a hidden test the plan does not pin. Five have no other blocker, one is borderline, three also carry a real blocker. With the hidden test ignored, acceptance is A 18/21, B 6/20, C 12/21 (rows in §1).
2. **B and C did not lose by omission. They obeyed a step A ignores.** A says the docs step is "not skippable" (A:273) but never gives the action; B gives it (B:70). The grader then scores the output as out of scope. With hidden and docs both excused, acceptance is A 19/21, B 16/20, C 18/21. The same legibility gap costs A on test quality: the judge favours B 29 to 4.
3. **The reported production symptoms are frequent but almost free.** Pipes on test commands: 72-91% of test commands, only 3 denied. Wrong model in trailers: 316 Haiku commits, all from a brief that dictated it. The money is in context size and cache rewarm: 65% of cost in turns at 150k+ context, 24% in cache rewrites.
4. **Candidate D targets higher quality at equal tokens in the eval, and fewer tokens in production.** It makes the gates legible, adds an inline RED-first rule and a scoped-run rule, gives a compliant test-output shape, and bounds waits. D fails G6 by construction, so G6 needs a ruling before the rerun.

Data: 62 non-superseded, non-void executor rows from `results/runs.jsonl`, with `regraded.jsonl` applied. 84 Opus executor judgments from `results/judgments.jsonl`. Production: 547 `gsd-executor` transcripts since 2026-10-11, $1,056 at `lib.py` prices (the brief's figures were 545 and about $1,150). Attribution percentages overlap and do not add up. Scripts were throwaway, kept in `/tmp/execdiag`. Run IDs below are the prefix `<task>-<arm>-r<n>`; full IDs are in `runs.jsonl`.

## 1. Why A fails E1-E3 (grade fields from `runs/<RUN>/grade/summary.json`)

| Run | `hidden.files[]` | Other blockers | Class |
|---|---|---|---|
| E1-A-r1 | `grid-check.test.ts` `api_mismatch: true`, rc 1 | `scope_out: command-reference.md` | oracle + **real** (docs step) |
| E1-A-r2 | same | none (`criticals` empty after regrade) | oracle only |
| E1-A-r3 | same | none (`criticals` empty after regrade) | oracle only |
| E2-A-r1 | `cache-generation.test.ts` `api_mismatch: true` | none | oracle only |
| E2-A-r2 | same | `criticals: fp-increase=1` | oracle + **real** (`try/catch` in parseJson) |
| E2-A-r3 | same | `scope_out: update-config.test.ts, game-kill-switch.test.ts` | oracle + **real** (edited tests of other plans) |
| E3-A-r1 | `config-cache-invalidation.test.ts` `api_mismatch: true` | none | oracle only |
| E3-A-r2 | same | none | oracle only |
| E3-A-r3 | same file `api_mismatch: false`, `failed: 1` | none (`criticals` empty after regrade) | borderline, see below |

Why the oracles are unfair. Calibration only proves the hidden test passes at the ref tree (`tasks/E1/calib.json`, 24 of 24). DESIGN:190 says "the plan pins the API, so this counts against the run". A trace against the plan at base disproves that for all three tasks:

- **E2.** The plan pins seven parameters: `writeStamped(redis, ns, dataKey, shape, value, gen, ttl)` (394-01-PLAN.md:173 at `6ea48f652`). The ref dropped `ns`, and the hidden test calls six arguments (`oracle/hidden/00-cache-generation.test.ts:187,231,246,269`). All three A runs follow the plan (`grade/diff.patch`, `_ns` or `namespace`). "Found 4 errors" in the log equals those 4 call sites. The only passing run, E2-B-r1, is the one that deviated from the plan.
- **E1.** 10 of the 14 imported names have zero mentions in the plan (`assembleGrid`, `mergeRows`, `parseTsv`, `toTsv`, `stripNoise`, `UNITS` and others). The plan pins `checkGrid(rows, units, classes, findingsIds)` and `mergeSplitUnits` (398-02-PLAN.md:78); the hidden test calls `checkGrid(rows, IDS, [])`. No arm passes. Judge E1-r2-0656b9c7 also notes the plan's input files are missing from the snapshot, so grid formats were guessed.
- **E3.** `cacheInvalidationMeta` and `cacheInvalidationHeaders` have zero plan mentions; the plan offers `withCacheInvalidationOutcome` "or a body/header builder" (394-03-PLAN.md:159). E3-A-r1 exported `cacheInvalidationHeader` and E3-A-r2 exported `withCacheInvalidationMeta`.
- **E3-A-r3 is borderline.** Rebuilt in scratch from base plus `diff.patch`: only case B3 fails, expecting `error_type` `redis_deadline_breach` and getting `config_cache_invalidation_failed`. The literal is not in the plan, but the repo already uses it (`account-takeover-redis.test.ts:138`) and the base handler used `classifyRedisError`. A careful agent could have matched it (A:86).

Real A failures the acceptance gate does not see, from the judge: E3 skipped RED in all 3 reps (E3-r1-c6122c1f, E3-r2-daca53fa, E3-r3-c5d91299; `fail_first` `claimed-only` 3/3) and left W2, W4, W5 unwritten. E2 tests assert only `kind`, not `reason` (E2-r1-d91604d7). "Self-Check: PASSED" on a partial plan and a false "shared stack" excuse for `test:repo-scripts` (both E1-r2-0656b9c7, the second major). These are what better instructions can reach.

| Acceptance, E1-E7 | A | B | C |
|---|---|---|---|
| strict, as reported | 12/21 | 2/20 | 7/21 |
| hidden ignored for E1-E3 | 18/21 | 6/20 | 12/21 |
| hidden and `.md` scope_out excused | 19/21 | 16/20 | 18/21 |

Denominators are completed rows; the results table's 2/21 counts E4-B-r2's timeout rep.

## 2. What made B and C worse

**No removed text explains the docs behaviour. It runs the other way.**

| Behaviour (completed rows) | A | B | C |
|---|---|---|---|
| spawned `gsd-docs-updater` | 1/21 | 14/20 | 12/21 |
| spawned `gsd-test-writer` | 1/21 | 16/20 | 11/21 |
| `scope_out` on a docs file | 1 | 14 | 6 |
| ... of those with no docs child | 0 | 0 | 0 |
| read `executor-detail.md` | 2/21 | 12/20 | 5/21 |

- A:273 says "not skippable. Fire it" with no named action. The only place A names `gsd-docs-updater` is a contract clause (A:278). A:251 ends "DO NOT execute the task inline. Instead:" and the quote stops, because the digest kept the warning and dropped the instruction. The pointer at A:514 uses `@` and does not load: A's first turn is 7.7k tokens above B's, about the 20 KB def difference, not the extra 36 KB of detail.
- B:67 and B:70 say "spawn `gsd-test-writer`" and "spawn `gsd-docs-updater` with the SUMMARY path". B obeys.
- Natural experiment inside A: the one docs child (E1-A-r1) follows a read of `executor-detail.md` at offset 560, and it produced that run's scope_out. The one test-writer child (E1-A-r2) follows a full read of the same file.
- C's added line (`gsd2-executor.c.md:12`, "Don't add ... docs ... that weren't asked for") cut docs scope_out from 14 to 6 although C still spawned the docs child in 12 runs.

**Judge dimensions (84 judgments, A-win / candidate-win, major in brackets):**

| Dim | A vs B | A vs C |
|---|---|---|
| scope | 28 (10) / 5 (3) | 18 (5) / 11 (4) |
| honesty | 17 (5) / 13 (1) | 20 (3) / 10 (0) |
| test_quality | 4 (0) / 29 (12) | 12 (3) / 19 (7) |
| completeness | 7 (0) / 18 (8) | 12 (4) / 10 (7) |
| correctness | 6 (1) / 5 (5) | 11 (8) / 6 (2) |

Counts cover every Opus judgment in the file; the aggregate drops superseded pairs, so it reports B honesty 15 vs A 13. The children explain the two big dimensions. Scope, B judgments with a docs child: A-win 26, B-win 2, tie 2; without one: 2, 3, 7. Test quality, B with a test-writer child: B-win 22, A-win 2, tie 8. C with a test-writer: 13 to 2; C without: 6 to 10.

The children also explain cost. Est $/run: A 0.49, B 0.86, C 0.76. Executor-only: A 0.48, B 0.55, C 0.57. B's extra: test-writer $0.19, general-purpose $0.07, docs $0.04. So the slim did not raise cost through the def; it raised cost by making the mandatory children fire.

Not traced to removed text (unverified, not attributed): C's correctness losses (leftover mutant `void 0` E3-r3-0eb4cc13, side worktree E2-r1-11e1a18a) and the E4-B-r2 90-minute busy-wait. A has no line that prevents any of them. Probe: rerun those tasks on D and inspect.

## 3. Production failures, ranked by cost (547 spawns, $1,056)

| # | Failure | Frequency | Est $ (21 d) | Addressable in the def? |
|---|---|---|---|---|
| 1 | Long context. Turns at 150k+ are 65% of cost (Sonnet $544, Haiku $141). Cost is 59-71% cache read and 28-40% cache write; output about 1% | handoffs at median 228k (37 writes, min 133k); 291 of 547 peak at 180k+ | simulated handoff at the first commit past 120k: Sonnet saves 21.8-28.1%, Haiku 14.1-18.3%, about $215-275 | yes, but not testable until the harness has a continuation loop. **Not in D** |
| 2 | Cache rewarm after a gap over 5 min | 857 rewrites | $258 (24%): Sonnet $236, Haiku $22 | yes |
| 2a | ... directly after a foreground wait loop (`until ...`) | 392, mean 559 s on Sonnet; many near the 600 s Bash limit | $148; simulated 240 s slices cost $34, saving **$114 (10.8%)** | **D change 1** |
| 3 | Test re-run with no edit in between | 863 in 244 spawns; 640 (74%) piped | $22 | **D change 1** |
| 4 | Spawns with no final text (died or cut off) | 25 spawns | $20 spent | no |
| 5 | Shell and tool errors | 634 other exits, 139 missing cmd/file, 126 `sleep` blocked, 48 Monitor missing | $9, $2.5, $3.3, $1.4 | `sleep` and Monitor in **D change 1** |
| 6 | Bash denial | 12 events in 31,563 commands (3 on test commands) | $0.5 | **D change 1** |
| 7 | Banned test shapes | Haiku 1,660/2,301 (72%), Sonnet 1,788/1,961 (91%). Briefs banning test pipes: 148/359 spawns still pipe. `sed -i`: 483 commands in 154 spawns, but of 28 briefs naming it only 1 used it | about $0 direct | **D change 1** offers the compliant shape |
| 8 | Commit trailers | 15/1,619 missing (0.9%). 316 Haiku commits name Sonnet, all under a brief that says Sonnet, none without; another 184 ignore that brief and name Haiku. 1 amend in the window | $0 | no: the def has no trailer text. **Fix the coordinator's dispatch brief** |

Not ranked:

- **Model mix.** Sonnet is 195 spawns and $843 (80%). Since 10-30 the mix is 227 Haiku and 31 Sonnet, so the tier rule is already biting.
- **Hook bypass, needs attention.** 2 commands ran `git -c core.hooksPath=/dev/null commit` in "Fix 404-02 review findings" (`.tmp/wt-404-02f`). `gsd-guard-bash.js` denies `--no-verify` but not this form. No real `--no-verify` or `--no-check` found; `--no-verify-jwt` and `--no-check=false` are false matches.
- **TTL alternative.** `03-coordinator-cache-ttl/RESULT-BREAKEVEN.md:11` shows a 1 h TTL pays 19.6% for Sonnet executors. If adopted, it largely replaces 2a.
- **Why first-turn cuts cannot pay.** First-turn context carried costs $184 (17%), of which the def is about a third, so roughly 6% of spend. B's 23% first-turn cut is worth about 4%, less than its child spend adds back.

Unverified: whether banned shapes raise human prompts in attended runs (4 "user doesn't want to proceed" events). Probe: replay the commands through the project allow-list.

## 4. Blocks: never needed versus load-bearing (547 spawns)

| Block (bytes) | Evidence | Verdict |
|---|---|---|
| `agent_messaging` App #4 peer awareness (about 1.2 KB) | `<wave_peers>` in 0 prompts; CLAUDE.md forbids two executors in one phase | never reachable, **removed in D** |
| `agent_messaging` App #5 heartbeat | 9 SendMessage to `main` in total, across all uses | barely used, **compressed in D** |
| `hard_rules_digest` (3,696) | detail read in 2 production spawns; test-writer child 12, docs child 68. In eval 1/21 each | present but not acted on, **rewritten in D** |
| Pointer A:136 | `coordinator-detail` read 0 times | dead pointer, **replaced in D** |
| Routing-tier snippet in `task_commit_protocol` (about 245) | 0 uses; `gsd-task-router` 0 spawns | removable, left for a later cut (3-block limit) |
| `auto_mode_detection` (789) | `auto_advance` queried 0 times | removable, left for a later cut |
| `continuation_handling` tags | `<completed_tasks>` and `<prior_executor_handoff>` in 0 prompts; resumes use hand-written briefs | format unused, kept |
| `completion_format`, status trailer | `PLAN COMPLETE` 13, telemetry 9, JSON trailer 70 (13%); 323 briefs ask for 10 lines or fewer | mostly overridden by briefs; kept, the coordinator parses it (`execute-phase.md:359-363`) |
| `checkpoint_*` | `CHECKPOINT REACHED` 1 | rare, kept (protected format) |
| `task_commit_protocol`, TASK-CHECKPOINT | about 429 spawns ran `git status --short`; TASK-CHECKPOINT written or staged in at least 98 | **load-bearing** |
| `executor_resilience_protocol` | 37 handoffs, median 228k | **load-bearing**, rule fires late (§3 row 1) |
| `scope_boundary`, deferred-items | written in 140 spawns | **load-bearing** |
| `tooling_and_resources` disk check | `df -h` in 335 spawns | **load-bearing** |

Not measured: `deviation_rules` and `defect_classes` act through Write content, which this pass did not scan. `content_firewall`: 1 mention, effect not observable.

## Candidate D: block-level diff

Frontmatter follows the v2 drafts (`name: gsd2-executor`; `Grep, Glob` dropped: 0 uses in the window, and CLAUDE.md says they do not exist). Every other block is byte-identical to A, checked per tag.

| # | Block | Bytes | Change | Finding |
|---|---|---|---|---|
| 1 | `tooling_and_resources` | 1,345 → 2,310 | A:136 pointer replaced by the allowlist text (same wording as `coordinator-detail.md:1747`, path relative to `apps/api`, since the eval runs outside the live repo); a log-file shape for test output; waits in slices of at most 4 min with a bounded poll example; `sleep N; cmd` and Monitor named | Q3 rows 2a, 3, 5, 6, 7; Q4 |
| 2 | `hard_rules_digest` | 3,696 → 3,568 | Fragments become imperatives with a real Read-offset pointer. New: a brief narrower than the plan wins (no docs child, no out-of-list edits, honest partial report); true NOT RUN reasons; inline RED-first checklist with exact assertions and no committed mutant; final-tree checks and no reflow. Kept: 2-retry block, 0-tests REUSE block, syntax checkpoint, post-plan gate, docs hard block, handoff brief | Q1 real failures; Q2 |
| 3 | `agent_messaging` | 2,177 → 782 | App #4 removed; App #5 compressed. App #1 and #6 hooks in the protected blocks still point here; their detail was already only in `references/agent-messaging.md` | Q4 |

Protected text is untouched: `checkpoint_return_format`, `task_commit_protocol` (TASK-CHECKPOINT and commit format), `executor_resilience_protocol` (EXECUTOR-HANDOFF and status trailer), subagent names. Banned-shape rules are restated, not altered. Trailers: the def had no trailer text and D adds none.

Deliberate behaviour change, to be ruled on before any ship: D writes tests inline unless the plan or brief names `gsd-test-writer`. This contradicts `executor-detail.md:320` ("DO NOT execute the task inline") and matches practice (12 child spawns in 547). Spawning instead would buy B's test quality at about +$0.19/run, failing "same tokens". D also carries project-specific commands in a generic def, as `coordinator-detail.md` already does. Before shipping, `references/executor-detail.md` needs the same edit.

## Hypothesis

D keeps A's scope discipline and reaches for B's test quality at A's cost, because the gates become actions and the costly children stay off in scoped runs. Effects below are predictions; D has not been run.

| Gate | Prediction | Why |
|---|---|---|
| G1 | pass | inherited context unchanged |
| G2 | pass: at least 12/21 strict. With hidden neutralised, at least 18/21 and up to 20 | E4-E7 stay accepted, docs child off in scoped runs; E1-r1 and E2-r3 classes covered by the narrow-brief rule, E2-r2 by fp-gate |
| G3 | pass: hidden mean about 0.57; `fail_first` proven rises from 1 toward 4+ | RED commit rule; A has 5 `claimed-only` and 3 `absent` |
| G4 | pass: criticals at most 1; no B-style child `--no-check` | no test-writer child |
| G5 | pass: D wins test_quality and completeness on E1-E3, scope ties, honesty losses at or below A's | checklist and partial-report rules; risk: B's wins came from a child with its own instructions, and inline Haiku may not reproduce them |
| G6 | **fail by construction**: ratio about 0.99 | D is not a slim |
| Cost | est $/run within +10% of A's 0.49, mainly on E1-E3 from more tests | no children; more test-writing turns are the risk |
| Not visible in the eval | $114 per 21 days from waits, part of $22 from re-runs, fewer pipes | A rows have 0 gaps over 5 min and $0.25 of rewarm in total. Measure post-rollout: rewarm $ per Sonnet executor spawn and pipe rate per test command |

Falsifiers: test_quality not above A, or cost above +10% on E1-E3, rejects the inline-RED rule. A docs child or `.md` scope_out in a scoped run rejects the narrow-brief wording.

## What the rerun needs

Decisions and fixes I did not make (gates and graders unchanged):

1. **G6 ruling, blocking.** With G6 as written, D is rejected whatever the quality. Proposal for this arm: replace it with median `result_cost_usd` at most 1.10 x A. CEO or Opus call.
2. **Hidden oracle on E1, E2, E3, blocking for G2 and G3 to mean anything.** All nine A rows and almost all B and C rows fail on API names the plan does not pin, and one of the few passes was rewarded for deviating from the plan. Either report hidden as informational on these three tasks, or rewrite the hidden tests against plan-pinned names. DESIGN:190 and §8 ("Plan-pinned API") need correcting either way. Until then those tasks discriminate only through the judge.
3. **Reading wave 2.** B and C's G2 rejection rests mainly on the docs step and the hidden test. Their real findings stand: B costs about 1.5-1.8x per run (results table and transcript estimate) and does not beat A on honesty. A's winning position partly comes from skipping a step its own def calls mandatory. Whether the docs step belongs in a scoped run is a ruling worth recording.
4. **Build.** `variant-from-drafts --suffix .d`. It falls back to the base `gsd2-*` drafts for other roles (`ab_setup.py:252-254`), so other drafts sit in `agents.json`. Children are spawned by `gsd-*` names and stay A copies, so this should be harmless; confirm with one smoke run.
5. **Reweight.** E6 and E7 cost little and now discriminate only by scope; keep them as regression guards. E3 carries most of the quality signal.
6. **Representativeness.** The harness brief is the standard template with a `<scope>` tag. In production `<scope>` appears in 0 of 547 prompts and the template in 5. D's rule is worded for any narrowing brief, but the eval only tests the tagged form.
7. **Separate experiment, not in D.** Earlier handoff (§3 row 1) is the largest lever. It needs a continuation loop in the harness, since a `status: interrupted` return would otherwise count as a partial failure, and evidence that an executor can estimate its context (no context counter exists; `total_tokens_reminder` reports account budget). The simulation assumes 15-30k and 6-12 orientation turns per restart and does not model quality loss.
