# 07 — Instruction A/B quality eval (design)

Purpose: prove that the D4 instruction cuts (`research/05-GSD-V2-DESIGN.md:42`, targets `:52-64`, waves 11 and 14 `:101,:104`) do not lower agent work quality before any of them reaches v0.1.34 or later spawns. CEO rule: cut carefully, no quality drop, independent blind judge (`DECISIONS.md` row 6). Design only. The runner is a later Haiku task (§7).

Status 2026-10-31: designed, nothing run. Every "unverified" item has a probe in §9 that must pass first.

## 0. Answer

| Item | Choice |
|---|---|
| Tasks | 12 replayed from completed work: 7 executor (4 T1, 3 T0-adjacent), 2 code reviews, 1 plan-check, 1 planning, 1 phase verification (§2) |
| Variants | A = current instructions (HEAD). B = D4 slimming, delete/compress/move only, nothing added. C (optional) = B + Anthropic's two Haiku paragraphs, executor tasks only (§3) |
| Runs | 12 tasks × {A,B} × 3 reps = 72 agent runs. Matched pairs (A_r, B_r) judged twice with sides swapped = 72 Opus judge calls |
| Accept B if | G1-G6 all pass (§6): instructions really slimmed; acceptance passes B ≥ A − 1; no B-only critical violation; known-defect recall B ≥ A − 0.10; judged (A-wins − B-wins)/36 ≤ 0.10 with a clustered 90% upper bound ≤ 0.25; executor first-turn tokens B ≤ 0.75 × A |
| Budget | A/B ≈ $320-360 est-$ (01 index, ±30%), ≈ 13-15 h wall at 2 runs in parallel. C adds ≈ $110 and 4 h. Extension to 5 reps adds ≈ $210 (§6.4) |
| Limit | 36 pairs catch a large regression (a 30 pp judged gap gets accepted 4% of the time) but not a small one (a 10 pp gap gets accepted 45% of the time; §6.3). Post-rollout monitoring covers the rest (§6.5) |

## 1. Hypothesis

H0 (to reject): B lowers quality. B ships only if it is non-inferior to A on every gate in §6, on the same tasks, same models, same briefs and the same harness. The only thing that differs between arms is the instruction text: project `CLAUDE.md`, `.claude/rules/*.md`, the MEMORY dir, and the GSD agent defs of the role under test.

## 2. Task set

Base = the tree the historical agent started from: parent of the plan's first code commit, or the commit before the review/check ran. Ref = the historical outcome. All shas are on `feature/codebase-review-hardening`. Plan presence at base was checked with `git cat-file -e <base>:<plan>` for every row.

### 2.1 Tasks

| ID | Source (scope) | Role / model | Tier | Base | Ref outcome | Acceptance oracle | Why it is instruction-sensitive |
|---|---|---|---|---|---|---|---|
| E1 | 398-02 Tasks 1-3 (grid checker RED, GREEN, mutation tests; scripts/validation) | gsd-executor / haiku | T1 | `ed0a7bec5` | `c593162eb`; later hardening `7f8963782`, review fix `14e9f4782` (scope `inventoryBaseUnits` to the unit table) | `grid-check.test.ts` green; hidden ref tests; file <500 LOC | `guard-authoring.md` path rule (canary corpus, parse-or-fail); fail-first |
| E2 | 394-01 T2 (generation primitive + versioned config keys, RED then GREEN) | gsd-executor / haiku | T1 | `6ea48f652` | `af08b8edb` | G1-G14 green; `deno check`/`lint`; `barrel-surface.test.ts` green | edge-functions + database + fp + module-structure rules all load on `libs/**` (05-M5) |
| E3 | 394-03 T2 (one awaited bump helper, six writers, legacy DEL, failure semantics) | gsd-executor / haiku | T1 | `fd5396a8b` | `83bc133e4` | configurations handler tests green; `patch-arena-config.ts` LOC below base | fire-and-forget rule (fp-gate), handler correctness principles |
| E4 | 390-01 Tasks 2-4 (clusters A-C: fix stale unit fixtures, GUC write-shape patterns) | gsd-executor / haiku | T1 (test-only) | `2ae3b723d` (plan R2 + Task 1 present) | `7a9557c59`, `21a986873`, `b28e12836` | named suites green; zero diff under `functions/ libs/ migrations/` except test files | "never loosen an assertion", test falsifiability, no prod edits |
| E5 | 399-15 Tasks 2-3 (characterise enabled-TOTP verification, then move-only refactor) | gsd-executor / haiku | T0-path, mechanical | `c5f843d33` | `7b1f46eac`, `41405fc25`; review nits `2b970eb52` | characterisation + two-factor suites green; moved block byte-identical apart from imports (`git diff --color-moved`) | move-only split pattern (`module-structure.md`), auth path rules |
| E6 | 399-20 Task 1 (`lockout-policy.ts` constants + credential normalisation, libs/domain) | gsd-executor / haiku | T0-adjacent (auth) | `1f2010f81` | RED `bf282bc41`, GREEN `8ec92a323` | `lockout-policy.test.ts` + hidden ref tests; `deno check`/`lint` | pure domain, Result types, barrel line |
| E7 | 400-14 Task 1 (unit cases U1, U2, U2b only) + Task 2 (compare-and-set fix) | gsd-executor / haiku | T0-adjacent (money/reconciliation) | `42093fcf9` | RED `e918b69a8` (unit part), fix `a398dbaf7` | `resolve-gap.test.ts` + hidden ref unit cases; 409 on non-open gap | money handler correctness, CAS principle, honest "integration GR1/GR2 not run" |
| R1 | Review of 400-24 GREEN (player transaction allow-list projection) | general-purpose / sonnet, historical review brief | T0 (wallet) | review target `6f59d662e`, diff `25eaa7235..6f59d662e` | review fix `f861f5852` | K1: projection reads inherited properties (`k in metadata`, unguarded `source[k]`); fix = `Object.hasOwn` | rules on trust boundaries and own-property access live in edge-functions/database text that B compresses |
| R2 | Review of 400-21 GREEN (operator adjustment authority policy) | general-purpose / sonnet | T0 (money) | target `41b074edb`, diff `a0e982660..41b074edb` | fix `828a89223` | K1: unbounded `^\d+(\.\d+)?$` digit runs before BigInt scaling; K2: non-string `amount` throws a TypeError at `amount.startsWith` | FP "never throw", hostile-input rules |
| R3 | Plan-check of 390-01 R1 | gsd-plan-checker / opus | T1 | plan @ `19fa2f0ef` | `390-01-PLAN-CHECK-R1.md` (`7dabd66f1`) | HIGH-1 (narrowed MC-R5 misses `UPDATE pg_settings`, `EXECUTE format(...)`, concatenated and variable GUC writes); PC1-PC5 (PC1: plan uses `rg`, which prompts in this repo) | PC1 is only findable from CLAUDE.md "Use of tools"; checker def is a slimming target |
| P1 | Write plan 399-11 for finding A3a-C9-1 (MILE-07, MILE-08) | gsd-planner / opus | T0 (auth) | `816216617` (399 CONTEXT + RESEARCH, no plans) | revised plan `ff82da998:.../399-11-PLAN.md`; executed outcome `a1a5c0bee` | `gsd-tools verify plan-structure` + `verify references` exit 0; `coverage.md` items C1 72-byte helper in libs/domain, C2 PasswordSchema + shared validator refuse >72 UTF-8 bytes, C3 SQL `hash_password` RAISE + ROLLBACK migration, C4 real-stack test for the SQL limit and register route, C5 `docs/authentication.md` policy, C6 mutation proof of the SQL guard (T0) | planner def slimming; migration/ROLLBACK, grants, test economy, tier tags |
| V1 | Verify phase 398 (first verification) | gsd-verifier / opus | T1 (tooling) | `17400ddbf` | `238023d5d:.../398-VERIFICATION.md` | `status: gaps_found`; recall of G1 SC4 T0 timings missing (`T0.md:22-25,36`), G2a blank severities on 3 register rows, G2b unvalidated env `MAX_CONCURRENT_BUCKETS` (`run-integration-tests.sh:1733`), G2c missing Defect Classes rows | G2 exists only because CLAUDE.md says "fix review findings of every severity"; verifier def loses 8.5 KB Hard Rules Digest in B |

Mix against the brief: 7 executor tasks (4 T1 + 3 T0-adjacent; E6 is libs/domain), 2 code reviews + 1 plan-check with historical defects, 1 planning task, and V1, added because the verifier def is on the slimming list and would otherwise ship untested.

### 2.2 Scope rules per task (constant across variants)

- Executor tasks run only the listed task numbers. The runner confirms each number against the plan's `<name>` before setup (390-01 tasks are named by cluster).
- Integration, Charlotte, mutation-under-lock and `db reset` steps are out of scope. The brief says the stack is unavailable and that such steps must be reported as not run. Claiming one passed is an honesty failure (§5.1).
- The ref outcome and the known-defect lists live only under `tasks/<ID>/oracle/`. The agent cannot read them (§4.4).

### 2.3 Candidates rejected

| Candidate | Why not |
|---|---|
| 401-*, 402-* | live milestone phases, most without SUMMARY (only 402-01/02 have one); peer edits still landing |
| 399-01..10, 400-04..13, most of 400 | acceptance is a migration or a real-DB integration test |
| 400-44, 400-32, 400-49 | acceptance includes player-web/operator-web builds and Charlotte |
| 398-06 | same shape as E1 (tooling RED/GREEN); slot given to V1 |

### 2.4 Not covered by this eval (ship decision excluded)

| Instruction | Why not covered | Consequence |
|---|---|---|
| `gsd-phase-coordinator` def, CLAUDE.md tiering/orchestration text moved to the coordinator | coordinator behaviour is multi-hour and stack-bound | B's move of that text into a gsd2 coordinator def is tested in exp 10 (`05:100`), not here. This eval only checks that leaf roles still work without it. |
| `gsd-docs-updater`, `gsd-charlotte-qa`, runners | different experiments (`05:97`) | out of scope |
| `e2e-testing.md`, `frontend-apps.md`, `flutter.md`, `bonus-system.md` | no task touches their paths | B leaves them unchanged |

## 3. Variants

### 3.1 Construction rules

1. A = byte copies at a frozen HEAD sha (recorded in `variants/A/MANIFEST.md`): igaming `CLAUDE.md`, `.claude/rules/*.md`, the full memory dir `~/.claude/projects/-Users-ollorin-igaming-platform/memory/` (MEMORY.md + 74 files), and the installed defs `~/.claude/agents/gsd-{executor,planner,plan-checker,verifier}.md`. The installed defs are what runs; they differ from `~/get-shit-done/agents/`.
2. B may only delete, compress, or move text to an on-demand file with a one-line pointer. B must not add a rule, inline new detail (for example the `planner-detail.md:1202` tier-tag rule, 05-M2b), or replace general-purpose reviewers with a new `gsd2-reviewer` def. Additions confound in B's favour and could hide a regression. Each gets its own experiment.
3. A Sonnet drafter writes B plus `variants/B/MOVES.tsv` (columns: `src_file, section, action{keep,compress,move,delete}, dest, bytes_before, bytes_after, reason, duplicate_of(file:line)`). A fresh Opus dispatch reviews every row that touches money/auth/RNG/KYC rule content (wave 14 `05:104` requires it), and every `delete` that claims a duplicate is checked against its cited `duplicate_of`. B is then frozen by sha256 in `variants/B/MANIFEST.md`. Any later edit is a new variant B′ with fresh runs.
4. Both arms reach the agent the same way (§4.3). Only file contents differ.

### 3.2 B: what changes, per file (target sizes from D4 `05:42,56-64`)

| File (now) | B target | Keep (compressed to plain statements, emphasis ≤3 per file, 04-P4 `04:35-43`) | Move to on-demand file (pointer line stays) | Delete |
|---|---|---|---|---|
| `CLAUDE.md` 18.4 KB, 273 lines | ≤8 KB, ≤200 lines | path-trace rule (3 lines); own every failure + fix every finding + sibling-sweep via `zg` (4 lines); no early stop (1 line, plain wording per 04-P4); honest advisor (1 line); Use of tools whole (zg not grep/rg, LSP, allowlisted test shapes); FP 4 bullets; Code Quality 2 lines (`--no-verify`, `--no-check`); Token discipline (3 lines); Temp files; Branch; References + Domain Rules tables; leaf-relevant orchestration one-liners: no `git stash/reset/rebase/clean` on the shared branch, commit only your paths, no secrets in artifacts, never touch guardrails, only on-disk evidence counts; **one spawner line**: "every Agent call passes `model`; Haiku unless the description says `escalate:<reason>`" (executors spawn general-purpose children 1,012 times, 01 §0) | Subagent Usage tiering detail, Opus mandatory points, high-stakes domain list, Haiku context sizing, parallelism ceiling and its exceptions, same-phase executor rule, wait-in-turn, never SendMessage a handed-back child, one writer per file set, db reset / Charlotte rules, dispatch GSD roles by `subagent_type` → `docs/rules/orchestration.md` (later the gsd2 coordinator def + main-session skill, D4a); pre-PR detail → existing `pre-pr-quality-gates.md` (already path-scoped at HEAD `4063077f5`) | restatements of the same rule across sections (each delete cites the surviving line) |
| `MEMORY.md` 14.1 KB, 74 entries | ≤4 KB, ≤40 lines, ≤100 chars each (D4b) | user role (1); entries a leaf agent acts on: CI import map in 3 places, MSW flat auth shape, common backend pitfalls, new-schema checklist, view recreation drops grants, Redis mock divergence, editor diagnostics unreliable for Deno, SES not Resend, market-generic mandate, no production users, PVP-first, planners write PLAN.md only, testing strategy (1 line) | orchestration/host entries (supervisor, GSD/Charlotte fork, Docker runtime, gsd-tools bugs, bucket instability, false gate pass, wait-shell, nx serve crash, supabase npx, two phases in flight, worktree phases, SendMessage, decide autonomously, stack/history approvals, OS prompts, disk threshold, host cleanup, OrbStack restart, zg refresh, roadmap before reassign, Charlotte deferral, next milestone, disk pressure, config overhaul, v0.1.22 follow-ups, audits, PRD hardening, e2e additive, v0.1.9 post-mortem, provenance tags, 2FA replay history) → new topic index `orchestration.md` in the memory dir, one pointer line | entries that restate CLAUDE.md: model tiering, never skip gates, zero tolerance, fix all findings, Haiku-implements/Sonnet-reviews, permitted test shapes, check settings before permissions, be concise. Topic files stay on disk unchanged. |
| `rules/testing.md` 24.3 KB (paths `**/*.test.ts` and others) | core ≤6 KB | Test Types (0.4), Test Failure Policy, Test Falsifiability (2.9 → 1.2), Test Economy (1.8 → 0.8), new coverage in an existing suite, cross-layer consistency, parallel-execution rule (1.9 → 0.4), "why local passes, CI fails" as 6 headline rules (2.6 → 0.6), flake gate (0.8 → 0.3) | Integration Test Conventions, Supabase client selection, operator auth in integration tests, seeding checklist, seed/cleanup, integration isolation, shared stack, Charlotte gotchas, E2E coverage gate, CI env, PVP RNG → `docs/rules/testing-reference.md`, pointer: "before writing or editing an integration test read §<anchor>" | — |
| `rules/edge-functions.md` 23.0 KB | core ≤6 KB | Handler Correctness Principles 13.1 KB → a numbered list, one statement ≤200 chars each (~3 KB), examples moved; workspace imports; non-public schema RPC (0.4); operator auth (0.4); middleware pattern | CI import map, new-function registration and checklist, per-function deno.json, deployment, env vars, JWT-secret note, realtime contract, principle examples → `docs/rules/edge-functions-reference.md` | — |
| `rules/database.md` 18.6 KB (paths include `apps/api/libs/**`) | core ≤6 KB | migrations (0.8), clean-room completeness (0.4), RLS (0.4), grant policy incl. default privileges and SECURITY DEFINER EXECUTE (3.4 → 1.0), schema access (0.3), RPC param names (0.4), data integrity principles (2.5 → 1.0), migration principles (2.7 → 0.8), never `auth.users` | wallet RPC routing, seed config, configurations delete/`version`, column removal, new-schema checklist body → `docs/rules/database-reference.md` | Proposal for the Opus reviewer: narrow `apps/api/libs/**` to `apps/api/libs/infrastructure/**` (domain code is pure per `fp.md`). Ships only if Opus approves. |
| `rules/module-structure.md` 5.5 KB | ≤3 KB | 500-LOC ceiling, cohesion over line count, barrel-preserving move-only split (headlines) | backend-only scope note, grandfathered list → reference | — |
| `rules/fp.md`, `guard-authoring.md`, `qa-exemptions.md`, `pre-pr-quality-gates.md` | unchanged | — | — | — |
| `gsd-executor.md` 30.7 KB (12.4k tok) | ≤12 KB (≤4.5k tok, D4e) | role, TDD flow, task_commit_protocol, scope_boundary, success_criteria (verbatim); deviation_rules 3.6 → 1.5; checkpoint_protocol 1.9 → 0.8; resilience self-stop 3.8 → 1.0; PLAN INTERRUPTED 2.2 → 0.6; tooling 1.3 → 0.5 | Defect Classes detail 1.5 → 0.4 (rest stays in `templates/summary.md`) | Hard Rules Digest 3.7 (restates CLAUDE.md and rules); App #4 peer awareness + App #5 heartbeat 2.2; "Track routing tier" 1.5 (D5 removes tags) |
| `gsd-plan-checker.md` 33.9 KB (14.0k tok) | ≤15 KB (≤6k tok) | all 12 dimensions as 1-3 line checks + one example each; Dim 8 2.9 → 1.0, Dim 10 2.0 → 0.8, Dim 11 1.9 → 0.8, Dim 12 2.1 → 0.5 | — | Live Course-Correction 1.2; any Hard Rules Digest |
| `gsd-verifier.md` 21.1 KB (8.5k tok) | ≤12.5 KB (≤5k tok) | core_principle, VERIFICATION.md format, content_firewall, critical_rules, regression candidates | — | Hard Rules Digest 8.5; Opus self-verify boilerplate (04-P8 `04:55-56`); success_criteria 3.6 → 1.2 |
| `gsd-planner.md` 17.3 KB (7.3k tok) | ≤17 KB (≤7k tok) | role, standard/gap modes, user decision fidelity, status trailer | — | Hard Rules Digest 3.8; ABSOLUTE MANDATES 6.7 → 3.0 (same mandates, plain wording) |

### 3.3 C (optional, executor tasks E1-E7 only)

C = B + the two paragraphs Anthropic publishes for Haiku/Sonnet coding agents ("keep working until done", "run a real check before reporting done"), source cited in `04:154`. The drafter copies the text verbatim from that page into the executor def's top section. Effort stays at the default; `effort: medium` (D4g) is a separate factor and is not mixed in here. Schedule:

- if B passes, C runs against B (do the paragraphs add value);
- if B fails only on executor tasks, C runs against A (do the paragraphs recover it).

## 4. Environment and isolation

### 4.1 Deviation from the brief: snapshot repos outside the igaming tree

| Brief | This design | Reason |
|---|---|---|
| `git worktree` under `igaming-platform/.tmp/` | per-task snapshot repos at `/Users/ollorin/ab-eval/` (no `CLAUDE.md` in `/Users/ollorin` or `/Users`, checked) | (1) Ancestor `CLAUDE.md` files load into every subagent (06-PROBES P1, `06:11`), so a run under `igaming-platform/.tmp/` would get A's `CLAUDE.md` in both arms. Whether loading stops at a nested git root is unverified (probe S1). (2) A worktree shares refs and objects with the live repo, so `git log --all` / `git show <ref sha>` would expose the historical solution. A `git archive` + `git init` snapshot has one commit and no future objects. |

If S1 shows that ancestor loading stops at a nested git root, `.tmp/ab-eval/` becomes acceptable (snapshots, still not worktrees).

### 4.2 Snapshot build (once per task × variant)

| Step | Command / action |
|---|---|
| 1. disk check | `df -g /Users/ollorin` ≥ 15 GiB free (≈ 12 × (264 MB tree + 2 × ~100 MB .git)); abort below 5 GiB (host-cleanup threshold in MEMORY) |
| 2. raw tree | `git -C /Users/ollorin/igaming-platform archive <base> \| tar -x -C tasks/<ID>/raw` |
| 3. constant harness overlay (both arms) | from HEAD: `.claude/hooks/`, `.claude/settings.json`, `.claude/skills/`; `.git/hooks/pre-commit` copied after `git init`; `apps/api/.env.test` copied from the live repo (untracked, local test values; never quoted in artifacts) |
| 4. variant overlay | `variants/<V>/overlay/` → `CLAUDE.md`, `.claude/rules/*.md`, and for B `docs/rules/*-reference.md` |
| 5. scrub | `scrub.py tasks/<ID>/pristine-<V> --task <ID>`: (a) delete the target plan's SUMMARY/VERIFICATION/REVIEW files if present at base; (b) for P1, delete any `399-*-PLAN.md`; (c) grep the variant memory dir for task identifiers (plan id, finding ids, symbols from the ref diff) and log hits. A topic file with a hit is removed from **both** arms for that task. |
| 6. one-commit repo | `cd pristine-<V> && git init -q && git add -A && git commit -qm "base <base>"`. Overlay and base are one commit, so `git status` is clean and history does not reveal the variant. |
| 7. per run | `cp -cR tasks/<ID>/pristine-<V> runs/<RUN>/repo` (APFS clone, near-zero disk) |
| 8. memory | `cp -R variants/<V>/memory runs/<RUN>/memory`; write `runs/<RUN>/repo/.claude/settings.local.json` = `{"autoMemoryEnabled": true, "autoMemoryDirectory": "<abs runs/RUN/memory>"}` (mechanism worked in the 06 sandbox, `06:42`; subagent path is probe S4) |
| 9. deps | calibration (§4.6) decides whether `apps/api/node_modules` must be cloned from the live repo (`cp -cR`) or DENO_DIR alone is enough |

### 4.3 Agent invocation (identical across arms except `variants/<V>/agents.json`)

Executor tasks use a thin dispatcher session. The agent under test then runs as a subagent, which is how production loads instructions (system prompt = def body; CLAUDE.md/MEMORY/unscoped rules as a first-turn reminder; path rules on Read, `06:11,43`).

```
cd runs/<RUN>/repo
claude -p "$(cat ../brief.md)" \
  --model haiku \
  --agents "$(cat /Users/ollorin/ab-eval/variants/<V>/agents.json)" \
  --setting-sources project,local \
  --settings /Users/ollorin/ab-eval/harness/settings.json \
  --strict-mcp-config --mcp-config /Users/ollorin/ab-eval/harness/empty-mcp.json \
  --permission-mode bypassPermissions \
  --session-id <uuid4> \
  --max-budget-usd <cap> \
  --output-format stream-json --verbose \
  > ../stream.jsonl 2> ../stderr.log
```

| Element | Value | Note |
|---|---|---|
| `brief.md` (executor) | "Make exactly one Agent call: `subagent_type: gsd-executor`, `model: haiku`, `run_in_background: false`, description `Execute plan <N> tasks <X-Y>`, prompt = the Wave-1 executor template from `~/.claude/get-shit-done/workflows/execute-phase.md:206-240` rendered for the plan, plus the `<scope>` block from §2.2. When it returns, print its final report verbatim and stop." | `run_in_background: false` must be explicit, because the headless default is background (`06:24`) |
| `brief.md` (R1/R2) | the historical reviewer prompt, pulled from `files.jsonl` `first_prompt` (matched by plan id + `review` in the description), with paths and shas rewritten; fallback template in §7.5 | general-purpose Sonnet, built-in def (unchanged in both arms) |
| `brief.md` (R3/P1/V1) | the plan-phase / execute-phase spawn templates for plan-checker, planner, verifier, rendered for the task | Opus subagent via `--agents` |
| `agents.json` | built by `ab_setup.py` from the variant's def files: frontmatter → `description, tools, model`; body → `prompt` | both arms go through the same converter; precedence over `~/.claude/agents` is probe S3 |
| `--setting-sources project,local` | drops user settings (RTK rewrite hook, user MCP) for both arms | `~/.claude/CLAUDE.md` + `RTK.md` still load (`06:11`); same in both arms |
| `--permission-mode bypassPermissions` | the snapshot folder is untrusted, so project `permissions.allow` is ignored (`06:20`). The harness deny hook is the safety net | bypass is limited to a throwaway snapshot; hook firing under bypass inside a subagent is probe S2 |
| caps | `--max-budget-usd`: executor 8, Sonnet review 5, Opus 15; runner wall timeout 90 min (executor), 30 min (others) | a cap hit counts as a failed run, not a void one |
| model | dispatcher haiku; subagent per §2.1 | an Opus/Sonnet fallback in the transcript (`model_fallback` notice) voids the run, which is then re-run |

### 4.4 Harness hook (`harness/settings.json`, PreToolUse on `Bash|Read|Edit|Write|Agent`, same in both arms)

| Deny | Pattern | Why |
|---|---|---|
| shared stack | `supabase`, `docker`, `orbctl`, `colima`, `psql`, `db reset`, `functions serve`, `nx start`, `run-integration-tests`, `test:integration`, `preflight`, `stack-lock`, `:5432[0-9]`, `integration.test.ts` as a test target | the live milestone owns the stack (CLAUDE.md shared-stack rules) |
| network/remote | `git push`, `gh `, `curl`, `wget` | isolation |
| contamination roots (Read and Bash) | `/Users/ollorin/igaming-platform`, `~/.claude/projects`, `/Users/ollorin/get-shit-done/.planning`, `/Users/ollorin/ab-eval/tasks`, `/Users/ollorin/ab-eval/judge`, `/Users/ollorin/ab-eval/results` | the live repo, historical transcripts, and this design all hold the solutions |
| writes | Edit/Write outside `runs/<RUN>/` and `/tmp` | isolation |

Every denial goes to `runs/<RUN>/harness-denials.jsonl`. The grader also scans the transcript for any denied root reached by other means (`cd ..`, globbing); a hit marks the run `contaminated` and voids it.

### 4.5 Scheduling

- Run at most 2 in parallel (CLAUDE.md ceiling, host memory).
- Block-randomise: for each rep, shuffle the tasks; inside a task, coin-flip A/B order and run the pair back to back so API conditions match.
- Before each batch, read `rate_limit_event.rate_limit_info.unifiedWindows.seven_day.utilization` from the last stream (`06:22`). Pause if it is > 0.85 or the run is > 1.15 × linear pace (D3 `05:41`).
- Do not start while free disk is < 10 GiB.

### 4.6 Calibration (no LLM; must pass before any run)

For each task, from the pristine-A tree:

1. Visible verify commands: run at base (must fail or be absent, as the plan says) and at ref (`git archive <ref>` applied to a scratch copy; must pass).
2. Hidden tests (ref test files): fail or don't compile at base, pass at ref 3 times out of 3. Any test that flips is dropped from the oracle and logged as flaky.
3. Gate commands (`deno check`, `deno lint`, fp-gate) complete in the snapshot.
4. Record wall time per command (grader budget).

A task whose oracle cannot be validated is replaced from §2.3, not run with a weaker oracle.

## 5. Metrics

### 5.1 Objective (computed by `ab_grade.py` on an APFS clone of the run's final tree; never by an LLM except where marked)

| Metric | Definition | Source |
|---|---|---|
| `visible_pass` | task verify commands green (`cd apps/api && deno task test <file>`, the test shape from CLAUDE.md); one retry allowed, `flaky_retry` flagged | grader re-run |
| `hidden_pass` | passed / total of calibrated ref tests copied into the scratch tree at their historical paths. When the run created a file at the same path, the hidden copy goes in as `<name>.hidden.test.ts`. `api_mismatch` = compile failure (the plan pins the API, so this counts against the run) | grader |
| `check_lint` | `deno check` + `deno lint` on touched `apps/api` TS; `deno fmt --check` reported only | grader |
| `fp_delta` | per touched file: HEAD `scripts/fp-gate.ts` counters `countThrows`, `countFireAndForget`, `countOversizeFiles`, `countIfElseRouters` (final − base) | fp-gate exported counters |
| `fail_first` | tdd tasks: a run commit where the new tests exist and the implementation doesn't, which the grader checks out and finds failing by assertion → `proven`; failing only by module-missing → `module-missing` (accepted where the plan allows it); RED claimed in the report but not reproducible → `claimed-only`; none → `absent` | git + grader |
| `scope_out` | files touched outside the union of the scoped tasks' `<files>` + `.planning/**` + `.tmp/**` | git diff |
| `criticals[]` | any of: fp_delta > 0; added `.skip(`/`.only(`/`ignore: true`; an existing assertion removed or weakened without a replacement (diff heuristic, confirmed by the judge); edits to `.claude/settings*`, `.claude/hooks/**`, git hooks; `--no-verify`/`--no-check` used; `git stash/reset --hard/rebase/clean` run; shared-stack command attempted (harness log); secret-pattern hit in a committed artifact; honesty mismatch (below); tier violation (below) | grader + transcript |
| `honesty` | each check is a mismatch when it fails: cited shas exist; cited files exist; a "tests pass / N passed" claim has a test Bash call after the last code edit, and the grader agrees; no integration/Charlotte/mutation-under-lock step is claimed as run; `Self-Check: PASSED` matches what is on disk | report regex + transcript + grader |
| `tier` | every nested Agent call passes `model`; executor children are haiku unless the description carries `escalate:<reason>` | transcript `tool_use` inputs (06 P6 field names `06:15`) |
| `known_recall` (R1-R3, V1, P1 coverage) | known items found / total. Match = names the location and the mechanism. **LLM-classified** by a Sonnet matcher (§7.6); 20% sample re-checked by the main session | matcher |
| `false_pos` (R1-R3) | findings the matcher cannot tie to code at the reviewed sha | matcher |
| `plan_ok` (P1) | `gsd-tools verify plan-structure` and `verify references` exit 0 | gsd-tools |
| `verify_ok` (V1) | frontmatter `status: gaps_found` | grader |
| cost and effort | tokens (fresh, cache-write, cache-read, output), est $ (`lib.tokens`, `scripts/gsd-metrics/lib.py:63`), first-turn tokens, API turns, max context, compactions (`api_errors.compact_boundary`), wall seconds, `total_cost_usd`/`num_turns`/`permission_denials` from the stream `result` line (field presence is probe S8) | `extract.process((path, proj, 'top'\|'sub'))` (`extract.py:84`) called directly on the run's transcripts under `~/.claude/projects/-Users-ollorin-ab-eval-runs-<RUN>-repo/`. The eval projects are not in `PROJ` (`extract.py:7`), so live KPIs stay clean. |
| `manipulation` | chars loaded per instruction file, from `instr` and `nested` (`extract.py:146-148`). B must hit its targets and A must be within 5% of current | transcript |

`acceptance_pass` (executor) = `visible_pass ∧ check_lint ∧ fp_delta = 0 ∧ criticals = ∅ ∧ scope_out = 0 ∧ (hidden_pass = 1 or no hidden oracle)`.
For R/P/V tasks, acceptance = `known_recall ≥` the task threshold (R1 K1; R2 K1 and K2; R3 HIGH-1; P1 ≥ 5 of 6 coverage items and `plan_ok`; V1 `verify_ok` and ≥ 3 of 4 gap items) with `criticals = ∅`.

### 5.2 Judged (blind pairwise, Opus)

| Role | Dimensions (each: X / Y / tie, plus major/minor and a one-line file:line reason) |
|---|---|
| executor | correctness; completeness vs the scoped tasks; project conventions (FP, module structure, test rules, repo hard rules); test quality (falsifiable, lowest layer, fail-first, no hollow asserts); report honesty vs the supplied evidence; scope discipline (deviations declared) |
| reviewer / plan-checker / verifier | real defects found (reference list supplied); false positives; severity calibration; actionability (file:line + fix); claims traced to code |
| planner | coverage of the finding and requirements; executability (files, verify, tasks sized, tier tags); test plan (fail-first, lowest layer, mutation where T0); conventions (500 LOC, migration + ROLLBACK, grants, allowlisted commands, `zg`); risk handling (threat model, stack lock); no gold-plating |
| all | overall preference X / Y / tie |

Blinding:

| Leak | Control |
|---|---|
| arm label | packets name sides X and Y only; each pair is judged twice with sides swapped; the mapping lives in `judge/<PID>/key.json`, which the judge cannot read |
| paths, ids | run dir, session ids, timestamps, `Co-Authored-By` and `Claude-Session` lines rewritten to `<repo>`, `<id>` |
| variant fingerprints | regex redaction in the diff and report of `CLAUDE.md`, `.claude/rules`, `docs/rules/*-reference.md`, `MEMORY`, `orchestration.md`, and section names unique to either arm (the list comes from MOVES.tsv) → `<instructions>`; `docs/rules/` files themselves excluded from the packet diff |
| cost | no tokens, $, turns or wall time in the packet (B is expected to be cheaper) |
| length bias | the judge is told to ignore length; the aggregate reports the correlation between judged preference and the char ratio per pair |
| anchoring on objective results | the packet has visible-gate results and grader re-run logs (needed to judge honesty) but **not** `hidden_pass` or `known_recall`, so judged and objective signals stay partly independent |

Pair verdict = B-win if both orders prefer B; A-win if both prefer A; otherwise tie (inconsistent verdicts count as ties and are counted as position-bias evidence).

## 6. Statistics and decision rule

### 6.1 Units

Matched pair (task t, rep r) = A_r vs B_r; 12 × 3 = 36 pairs. Objective metrics are per run (36 per arm). The bootstrap resamples tasks (clusters), not pairs.

### 6.2 Gates (B accepted only if all pass)

| Gate | Rule | Fails if |
|---|---|---|
| G1 manipulation | every B run's loaded instruction chars meet §3.2 targets (inherited block ≤ ~16k chars ≈ 6k tok; executor path-rule chars ≤ 20k, 05-M5 `05:15`); every A run within 5% of current | any failure → run voided and redone |
| G2 acceptance | Σ B `acceptance_pass` ≥ Σ A − 1 over the 36 runs per arm, and no task with A ≥ 2/3 and B ≤ 1/3 | B loses ≥ 2 runs net, or one task flips |
| G3 secondary objective | mean `hidden_pass` B ≥ A − 0.05; `fail_first = proven` count B ≥ A − 1; mean `known_recall` B ≥ A − 0.10; every K1/HIGH item found by B in ≥ (A's count − 1) runs | any |
| G4 criticals | Σ B criticals ≤ Σ A criticals, and no critical code that appears only in B on a T0 task (E5-E7, R1, R2, P1) | any B-only T0 critical rejects B outright; on T1 it must be root-caused and fixed in B′ |
| G5 judged non-inferiority | d = (A-wins − B-wins)/36 ≤ 0.10 and the one-sided 90% upper bound of d (task-clustered bootstrap, 10k resamples) ≤ 0.25; honesty-dimension losses B ≤ A + 1 | any |
| G6 value | executor first-turn tokens, median B ≤ 0.75 × A (D4 target 38k → ~20k, `05:42`) | the cut does not pay, so it doesn't ship even if quality holds |

### 6.3 What 36 pairs can and cannot show

Simulated with 40% ties, normal approximation, ignoring clustering (the bootstrap will be wider):

| True gap d (A-win − B-win) | P(G5 accepts) n=36 | n=60 |
|---|---|---|
| 0.00 | 0.74 | 0.86 |
| 0.10 | 0.45 | 0.53 |
| 0.20 | 0.19 | 0.17 |
| 0.30 | 0.04 | 0.02 |

G5 alone lets a 20 pp degradation through 1 time in 5, and an equal-quality B fails it 1 time in 4. G2-G4 are the sharper signals for executors; G5 is a backstop for quality the oracles can't see. The eval guards against large regressions. Small ones are left to §6.5.

### 6.4 Sequencing and stopping

| Stage | Content | Stop / continue |
|---|---|---|
| S0 probes + calibration | §9 probes S1-S8; §4.6 | any failed probe blocks the run until fixed or redesigned |
| S1 smoke | E2 × {A,B} × 1, full grade + judge | checks the pipeline end to end; ≈ $5 |
| S2 rep 1 | 12 tasks × {A,B} | **harm stop**: ≥ 2 tasks where A passes and B fails acceptance, or any B-only T0 critical → stop. Attribute each failure to a MOVES.tsv row (find the removed passage that would have prevented it, by transcript), restore those rows → B′, restart S2. B results kept as evidence. |
| S3 reps 2-3 | as S2 | evaluate G1-G6 |
| S4 extension (only if inconclusive) | reps 4-5 on all tasks (n = 60) | inconclusive = G2-G4 pass and d ∈ (0.10, 0.20] or the bound is in (0.25, 0.35]. Futility: d > 0.20 after rep 3 rejects B with no extension |
| budget stop | any stage | cumulative est $ > 1.3 × §6.6, or weekly utilization > 0.85 → pause and report |

### 6.5 After acceptance (residual risk)

Ship B at the v0.1.34 boundary (wave 14). For 2 weeks, track per plan: Self-Check FAILED rate, Sonnet reviews with ≥ MED findings, Opus verifier `gaps_found`, and the escape proxy P11 (`05:137`), all against the last 5 phases. Revert trigger: any of these worsens by > 50% relative. `git revert` the CLAUDE.md/rules commit and restore the memory backup.

### 6.6 Budget (est-$ index from 01 §1, ±30%; wall at 2 in parallel)

| Item | Count | Unit (01 §1 / §4) | est $ | Serial min |
|---|---|---|---|---|
| executor runs E1-E7 | 42 | Haiku executor $0.67/spawn (full plans) → $1.3 (dispatcher + test-heavy slices) | 55 | 630 |
| reviews R1, R2 | 12 | Sonnet general-purpose ≈ $1.0 | 12 | 60 |
| plan-check R3 | 6 | Opus plan-checker $2.70 | 16 | 36 |
| planner P1 | 6 | Opus planner $3.92 | 24 | 60 |
| verifier V1 | 6 | Opus verifier $2.63 | 16 | 48 |
| Sonnet matcher | 30 | ≈ $0.3 | 9 | 60 |
| Opus judge | 72 | ≈ $2.0 (two diffs + reports + logs, 40-80k input) | 144 | 360 |
| second judge, 25% sample | 18 | Fable if available, else see §8 | 36-72 | 90 |
| probes + smoke | — | — | 10 | 60 |
| **A/B total** | | | **≈ 320-360** | ≈ 1,400 → **≈ 13-15 h wall** incl. grading (≈ 2 h CPU, overlaps) |
| C (E1-E7 × 3 + 42 judge calls) | | | ≈ 110 | ≈ 4 h |
| S4 extension | | | ≈ 210 | ≈ 9 h |

Against quota: wk3 burned est $1,277 in 4.3 days (05-M6 `05:16`), so A/B ≈ 1.1 days of normal burn on top of the live milestone. Start after the Tue 2026-11-03 17:00 UTC reset (`06:22`) or while utilization < 0.60.

## 7. Runner spec (Haiku implementer)

### 7.1 Layout

```
~/get-shit-done/scripts/ab-eval/          # committed, reusable for later cuts
  ab_setup.py  ab_run.py  ab_grade.py  ab_match.py  ab_judge.py  ab_aggregate.py  scrub.py  md2agents.py
  hooks/harness-deny.sh   prompts/{judge-exec,judge-review,judge-plan,judge-verify,matcher}.md
  tests/                                   # unit tests for redaction, verdict collapse, bootstrap, honesty parser
/Users/ollorin/ab-eval/                   # data, not committed
  tasks.yaml
  harness/{settings.json,empty-mcp.json}
  variants/{A,B,C}/{overlay/,memory/,agents.json,MANIFEST.md}   B also MOVES.tsv
  tasks/<TID>/{raw/,pristine-A/,pristine-B/,oracle/{hidden/,ref.diff,known.md,coverage.md},calib.json}
  runs/<TID>-<V>-r<N>/{repo/,memory/,brief.md,stream.jsonl,stderr.log,harness-denials.jsonl,grade/,run.json}
  judge/<TID>-r<N>-o<1|2>/{packet/X/,packet/Y/,task.md,prompt.md,key.json,out.json}
  results/{runs.jsonl,matches.jsonl,judgments.jsonl,pairs.jsonl,REPORT.md,decision.json}
```

### 7.2 `tasks.yaml` (one entry per §2.1 row)

```yaml
- id: E6
  role: executor            # executor | review | plancheck | planner | verifier
  agent: gsd-executor
  model: haiku
  tier: T0-adjacent
  plan: .planning/phases/399-auth-sweep-a1-a4/399-20-PLAN.md
  tasks: [1]                # executor only; checked against <name>
  base: 1f2010f81
  ref: [bf282bc41, 8ec92a323]
  scope_files: [apps/api/libs/domain/src/lib/auth/lockout-policy.ts, apps/api/libs/domain/src/lib/auth/lockout-policy.test.ts, apps/api/libs/domain/src/index.ts]
  verify: ["cd apps/api && deno task test libs/domain/src/lib/auth/lockout-policy.test.ts"]
  hidden: [apps/api/libs/domain/src/lib/auth/lockout-policy.test.ts@8ec92a323]
  known: []                 # review/plancheck/verifier: [{id: K1, where: "...", mechanism: "..."}]
  tdd: true
  budget_usd: 8
  timeout_min: 90
```

### 7.3 Commands

| Step | Command | Output |
|---|---|---|
| setup | `python3 ab_setup.py --tasks tasks.yaml --variants A,B` | §4.2 steps 1-6; `variants/*/agents.json` via `md2agents.py`; `calib.json` via §4.6 |
| probes | `python3 ab_run.py --probe S1..S8` | `results/probes.md` (each PASS/FAIL with transcript evidence) |
| run | `python3 ab_run.py --tasks tasks.yaml --variants A,B --reps 3 --parallel 2 [--only E2] [--rep 1]` | per run: §4.2 steps 7-8, §4.3 invocation via `subprocess.run(timeout=…)`, `run.json` skeleton; resumable (skips runs with `run.json.status=done`) |
| grade | `python3 ab_grade.py runs/<RUN>` (or `--all`) | `grade/*.log`, `run.json` objective fields |
| match | `python3 ab_match.py --all` (R*, P1, V1 only; Sonnet `claude -p --model sonnet` in an empty dir) | `results/matches.jsonl` |
| judge | `python3 ab_judge.py --all` | builds redacted packets, runs Opus twice per pair (§7.5), collapses → `pairs.jsonl` |
| aggregate | `python3 ab_aggregate.py` | `REPORT.md`, `decision.json` |

Judge/matcher invocation: `cd judge/<PID> && claude -p "$(cat prompt.md)" --model opus --setting-sources local --settings '{"autoMemoryEnabled":false}' --strict-mcp-config --mcp-config <empty> --allowedTools Read --disallowedTools "Bash Edit Write Agent" --output-format json`. Parse the last fenced JSON block of `.result`; retry once on invalid JSON, then record `judge_error`.

### 7.4 `run.json` (one line per run in `results/runs.jsonl`)

```
run_id, task_id, variant, rep, role, agent, model, tier, base, status{done,void,failed}, void_reason,
start_ts, end_ts, wall_s, exit_code, timed_out, budget_hit, session_id, transcripts[],
tok{fresh,cache_write,cache_read,output}, est_usd, result_cost_usd, result_num_turns, api_turns,
first_turn_tok, max_ctx, compactions, model_fallback,
instr_chars{claude_md,memory,rules_unscoped,rules_path{<file>:chars}}, manipulation_ok,
rate_limit_util{start,end}, permission_denials, harness_denials[], contaminated,
nested_spawns[{subagent_type,model,explicit_model,description}], tier_violations,
commits[], files_touched[], scope_out[],
visible{pass,fail,total,flaky_retry}, check_ok, lint_ok, fmt_ok, fp_delta{throws,ff,oversize,ifelse},
hidden{pass,total,api_mismatch}, fail_first, criticals[], honesty{checked,mismatches[]},
known_recall, false_pos, plan_ok, verify_ok, acceptance_pass
```

### 7.5 Judge prompt template (`prompts/judge-exec.md`; review/plan/verify variants swap the dimension list from §5.2)

```
You are an independent reviewer comparing two attempts, X and Y, at the same engineering task in a
TypeScript/Deno codebase. You do not know how either attempt was produced. Judge only the work.

Read, in this order:
- task.md: the task and the scope the agents were given (plan excerpt, constraints).
- reference/: a known-good historical solution. It is one correct answer, not the only one;
  a different design that meets the task is not worse.
- X/ and Y/: each has diff.patch (code), planning.patch (bookkeeping, may be truncated),
  report.md (the agent's final report), gates.md (lint/typecheck/test re-run results by a grader).

For each dimension below, prefer X, prefer Y, or tie. Mark the difference major (would change
whether this merges or what a reviewer must fix) or minor. Give one line of evidence with a
file:line from the diffs.
1 correctness  2 completeness vs scope  3 project conventions (Result types not throw, immutability,
pure domain, 500-line files, move-only splits, test rules)  4 test quality (can fail, lowest layer,
RED before GREEN, no hollow assertions)  5 report honesty (every claim in report.md matches
gates.md and the diffs; unrun steps declared)  6 scope discipline (no unrelated edits; deviations
declared)
Ignore length, style of prose, and verbosity. Do not reward extra work outside the scope.
Ties are fine when the difference is immaterial.

Output exactly one fenced JSON block:
{"dims":{"correctness":{"pref":"X|Y|tie","weight":"major|minor","why":"..."}, ...6 dims},
 "overall":{"pref":"X|Y|tie","why":"..."},
 "critical_issues":{"X":["..."],"Y":["..."]}}
```

Reviewer fallback brief (if no historical prompt is found): "Review the diff `<base>..<target>` for plan `<N>` (plan file path). Report every finding with severity CRIT/HIGH/MED/LOW, file:line, mechanism, and fix. Run the plan's unit tests if useful. Do not edit files."

### 7.6 Matcher prompt (`prompts/matcher.md`, Sonnet)

Inputs: `known.md` (id, location, mechanism for each item) and the agent's report or produced artifact. For each known item, output `found: yes|no` plus the quoted sentence. A finding counts only if it names the location (file or function) **and** the mechanism. Then list every other finding with `grounded: yes|no` (does the cited code exist at the reviewed sha and behave as claimed). Output JSON.

### 7.7 `REPORT.md` and `decision.json`

| Section | Content |
|---|---|
| Gates | G1-G6: PASS/FAIL, the numbers, the threshold |
| Per task × variant | acceptance x/3, hidden mean, fail_first counts, criticals, known_recall, est $, first-turn tok, turns, wall, compactions |
| Pairs | per task: B-win / tie / A-win; position-inconsistency rate; d, bootstrap 90% bound |
| Dimensions | A-win − B-win per judged dimension (where B lost, if anywhere) |
| Judge reliability | second-judge agreement (Cohen's κ, overall pref), length–preference correlation |
| Attribution | every B loss or critical → transcript excerpt → MOVES.tsv row suspected |
| Cost | est $ and $ from stream per stage; quota utilization start/end |

`decision.json` = `{"variant":"B","accepted":bool,"gates":{...},"stage":"S3","notes":[...]}`.

## 8. Risks

| Risk | Effect | Control |
|---|---|---|
| Contamination via git history | agent copies the ref solution | one-commit snapshot (§4.2 step 6); no worktree |
| Contamination via the filesystem (live repo, `~/.claude/projects` transcripts, this design, oracle dirs) | same | harness deny hook (§4.4) + transcript scan → `contaminated` voids the run |
| Contamination via memory | HEAD memory topic files may describe later fixes (e.g. Redis mock divergence vs E6 lockout) | scrub step 5c, removal applied to both arms |
| Ancestor CLAUDE.md / user agents leaking A into B | B is not really B | snapshots outside the igaming tree; G1 manipulation check per run; probes S1, S3 |
| Base-sha tree vs HEAD instructions | HEAD rules cite scripts/paths missing at old bases (E2-E4 date from Oct 2-8) | the same mismatch hits both arms; calibration runs gates in the snapshot; the judge is told the instructions postdate the tree |
| Flaky tests | false fail | calibration 3/3 at ref; one grader retry flagged `flaky_retry`; flippers removed from the oracle |
| Plan-pinned API vs a different correct design | hidden tests fail on a valid solution | `api_mismatch` reported separately; the judge sees the reference as one answer, not the only one; G3 uses the mean and tolerates −0.05 |
| Judge position bias | spurious wins | both orders; inconsistent → tie; inconsistency rate reported |
| Judge self-preference (Opus judging Opus planner/checker/verifier output) | inflated quality on both sides | both arms use the same model, so the bias is shared; second judge on a 25% sample |
| Second judge availability | "Fable" may not exist on this account; CLAUDE.md says Fable is no longer used here | probe S7. If it is unavailable, fall back to Sonnet as second judge on the same 25% (weaker, reported as such) plus a CEO spot-check of 5 pairs. κ < 0.4 makes G5 inconclusive, and the decision rests on G2-G4 + S4 |
| LLM matcher errors | wrong known_recall | 20% hand re-check by the main session; disagreement > 10% → matcher prompt fixed and re-run |
| Too few reps for small effects | B with a modest regression ships | stated in §6.3; post-rollout monitoring §6.5 |
| Cost overrun / quota | stalls the live milestone | per-run `--max-budget-usd`; budget stop §6.4; utilization gate §4.5 |
| Host pressure while the milestone runs | timeouts, hangs | ≤ 2 parallel; disk check; unit tests only; no stack use |
| Runner bugs biasing one arm | invalid result | runner unit tests (`tests/`); smoke S1 checks a pair end to end; arms go through the same code path, so only `--agents` JSON and overlay dirs differ |
| bypassPermissions differs from production | B or A could do things production would block | project PreToolUse hooks (`check-test-command.sh` etc.) still apply; the grader replays every Bash command against the project allow-list (prefix-glob approximation) → `would_prompt` count reported per arm |
| B drafter silently adds guidance | biased toward B | construction rule 2; the Opus MOVES.tsv review rejects any `add` |

## 9. Pre-run probes (unverified until run; each blocks the run)

| # | Assumption | Probe (sandbox snapshot, haiku, ≈ $0.01-0.05 each) | Pass condition |
|---|---|---|---|
| S1 | only the snapshot's CLAUDE.md, user `~/.claude/CLAUDE.md`, RTK.md and the run memory load | dispatcher + subagent reading `apps/api/functions/x.ts`; list `instructions` and `nested_memory` attachments (method `06:13`) | no path under `/Users/ollorin/igaming-platform` or `~/get-shit-done`; the MEMORY path equals the run memory dir |
| S2 | the harness PreToolUse deny fires under `bypassPermissions`, inside the subagent, for Bash and Read | subagent tries `cat /Users/ollorin/igaming-platform/CLAUDE.md` and `supabase status` | both denied with the hook reason; `harness-denials.jsonl` has 2 rows |
| S3 | `--agents` JSON overrides the installed `~/.claude/agents/gsd-executor.md` | sentinel string in the JSON prompt | subagent `prompt_snapshot.systemPrompt` contains the sentinel and not a line unique to the installed def |
| S4 | `autoMemoryDirectory` from `settings.local.json` applies to subagents in the snapshot | sentinel in the run MEMORY.md | subagent `AutoMem` attachment path = run memory dir, sentinel visible |
| S5 | `zg query` in the snapshot searches the snapshot, not the live repo index | `zg status`; `zg query "<string only in the snapshot overlay>"` | hits come from the snapshot path; otherwise run `zg index` at setup, or record zg as broken in both arms |
| S6 | unit tests resolve deps offline in the snapshot | calibration §4.6 | E2-E7 visible commands run at ref |
| S7 | Fable is callable | `claude -p --model fable "Reply OK" --output-format json` | `modelUsage` key names a Fable model; otherwise use the §8 fallback |
| S8 | the stream `result` line carries `total_cost_usd`, `num_turns`, `usage`, `permission_denials`; a `rate_limit_event` is present | any smoke run | fields present, or the runner uses transcript-only accounting |
