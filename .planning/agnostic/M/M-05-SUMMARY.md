# M-05 summary: stack and tool classes sweep (5.1-5.12)

Branch `exp/agnostic`, worktree `~/get-shit-done-agnostic`. Executor Haiku 5.5. Commits per task. Review rounds: not run (coordinator dispatches the one round, plan section 0). Full `npm test`: not run (coordinator runs it once per plan). Targeted runs only.

## 5.1 coordinator-detail.md (commit b94dfd3)

- File: `get-shit-done/references/coordinator-detail.md`: denied 63 → 0 (abs 22, charlotte 32, deno 1, frontend 2 → 1, gates 1, igaming 2, nx 2, paths 1). Allowed +1.
- Allow-list entry added: `get-shit-done/references/coordinator-detail.md` × `frontend`, max 1, reason "generic web-framework detection list read from package.json (D:93)". `write-baseline --allow-raise` used; the only RISE row was `RISE allowed get-shit-done/references/coordinator-detail.md frontend baseline=0 current=1`, no RISE denied.
- Plan count "72 lines to clear" differs from the lint count of 63 denied lines at HEAD; the lint is the authority.
- Test file changed: `get-shit-done/bin/gsd-tools.test.js` "the coordinator detail reference mirrors the Charlotte + verifier dispatch suffixes": literal `(reviewed by: charlotte)` → `(reviewed by: ui-qa)`. Same guard.
- Tests run: `project-context.test.js`, `prompt-budget.test.js`, `tests/phase-38/service-health.test.js` (91/91 pass); `gsd-tools.test.js` full file (971 tests, 1 failure before the assertion fix, now pass).
- Lint after: `ok (550 denied, 365 allowed)`.
- Kept: the command-shape rule (no inline env, no pipes, chains, `bash -c`) now reads "through `stack_commands` (`test_file`, `test_all`), verbatim".

## 5.2 verifier-detail.md (commit 7333fd1)

- File: denied 53 (plan count; lint shows charlotte 31, deno 7, gates 7, frontend 4, edgefn 1, supabase 1 plus two legacy lines) → 0 denied. Allowed +4.
- Step 8b test command: `TEST_CMD` from `stack_commands.test_all`; the deno.json detection (`DENO_TEST_CMD`, unused) removed.
- Step 8i (tier-delta, QGATE-16) reads `stack.gates[]` entries `tier-delta` and `tier-assignment`; runtime-missing stays a gap.
- Section renamed `check_ui_qa_coverage`, shell vars `UI_QA_FOUND`, `HAS_UI_QA`. Test assertions in `gsd-tools.test.js` (3 tests) follow the rename; they read the agent file through `readEffectiveAgentContent`.
- Allow-list: `verifier-detail.md` × `frontend` max 2 (framework list, dev-tool config classifier); × `charlotte` max 2 (legacy `*-CHARLOTTE-*.md` report glob, still matched).
- Lint after: `ok (499 denied, 369 allowed)`. Tests: `gsd-tools.test.js` 971/971.

## 5.3 execute-roadmap.md (commit 1ffcbaf)

- File: denied 55 (plan) → 0 denied; allowed +6 (gates 4 quota step names, charlotte 2 legacy alias and failure code).
- Allow-list: `execute-roadmap.md` × `gates` max 4, reason "generic quota-preflight step and event names, asserted by gsd-tools.test.js"; × `charlotte` max 2, reason "legacy alias key charlotte_qa_required and phase-gate failure code missing_charlotte_qa". Lines 96, 124, 140, 145 untouched (plan numbers 94/122/138/143, +2 drift from earlier edits).
- Line 648 (`preflight` gate sentence) rewritten. `build` command (`npx nx build`) has no key in the table: replaced with "the project's frontend build command (declared in the project's CLAUDE.md; GSD ships none)". Deviation: a `build` key is missing from `stack_commands`; logged in `deferred-items.md` for the profile plan.
- Lint after: `ok (444 denied, 375 allowed)`. Tests: gsd-tools, project-context, prompt-budget, agnostic-lint, wave-context, demo-check.

## 5.4 execute-phase, execute-plan, demo (commit e1cafaa)

- execute-phase.md: denied 22 hits → 0 denied, 1 allowed (`missing_charlotte_qa`, legacy failure code). Model-allowance sentences at :203 and :728 do not exist on this base (grep "allowance": none in execute-phase.md); nothing to change.
- execute-plan.md: `vercel` (cloud) and `JWT` (authtech) lines are allow-listed upstream examples; an edit removed them, caught by lint, restored byte-identical. No allowlist change.
- demo.md: all charlotte hits, `TOTP` → "one-time code".
- gsd-tools.test.js: caught_by assertion (`ui-qa`).
- Lint: the mid-task count was 410 denied, 374 allowed, measured before the restore. No count was recorded at the end of 5.4; the first recorded count after it is in 5.5 (361 denied, 377 allowed).

## 5.5 core agents (commit 5e09b85)

- verifier 11 charlotte + 6 gates + 1 deno + 1 paths + 1 postgres → denied 0 (one legacy failure-code line allowed: `agents/gsd-verifier.md` × `charlotte` max 1).
- phase-coordinator 12 charlotte, 1 gates, 1 zg → 0. executor: charlotte 3, gates 2, paths 1, zg 1 → 0 (upstream `authtech` 2FA line kept). planner: charlotte 5 → 0 (upstream `edgefn` line kept). plan-checker: charlotte 2, gates 1 → 0 (upstream `authtech` lines kept).
- MANDATE-2 wording per plan. Coordinator HARD RULE carries the `ui_qa` skip clause.
- Budgets: executor 6790 hit at 6805 after the first pass; trimmed two of my own phrases to 6790 (no budget change).
- Lint after: `ok (361 denied, 377 allowed)`. Tests: gsd-tools, project-context, prompt-optimize, prd-trace, service-health: 1091/1091.
- Pre-existing, not run in gate: `tests/phase-38/kb-feedback.test.js` fails at 0b9c35a too (agent file has no `kb_feedback`; not in `npm test`). Logged in `deferred-items.md`.

## 5.6 other agents (commit 8a9b58f)

- Files: gsd2-runner, gsd-roadmapper, gsd-qa-analyst, gsd-test-writer, gsd-e2e-test-generator, gsd-meta-answerer, gsd-product-investigator, gsd-ui-inventory. Denied 8 files → 0 except one line in product-investigator.
- gsd2-runner runs only `stack_commands` and `stack.test_command_shapes`; its test-shape list is now a pointer, not a literal list.
- Roadmapper `**Charlotte QA:**` AC label becomes `**UI QA:**` (the PRD template follows in 5.8).
- Allow-list: `agents/gsd-product-investigator.md` × `charlotte` max 1 (the `tools:` frontmatter names the driver MCP tools; no pack tool-list mechanism yet, same as gsd-demo).
- Lint: `ok (312 denied, 378 allowed)` after the task.
- Tests: `gsd-tools`, `project-context`, `eval-harness`, `prompt-budget`: 1115/1115.

## 5.7 references (commit eddac35)

- Files: gsd-test-protocol (26 → 0 except one legacy line), planner-detail (denied 22 → 0), executor-detail (17 → 0), checkpoints (9 → 0; the rest were already allow-listed), service-health, fp-lint, and the abs-only files (decimal-phase-calculation, git-integration, phase-argument-parsing, git-planning-commit, verification-patterns, audit-log, debugger-detail).
- Legacy `missing_charlotte_qa` in gsd-test-protocol: allow-listed `charlotte` max 1, same reason as the other prose files.
- Deviation: the planner-detail rewrite replaced product examples (Stripe, Vercel, jose, Tailwind) with generic ones. The plan's "stripe" examples were not on the allow-list, so they had to be rewritten.
- Deviation: `executor-detail.md` TEST_CMD fallback was package.json/deno.json detection; now `stack_commands.test_all`. `gsd-tools.test.js` "post_plan_test_gate references test command auto-detection" asserted `package.json`; its assertion now checks `stack_commands.test_all`. Guard kept.
- Lint: `ok (202 denied, 379 allowed)` after the task.
- Tests: `gsd-tools`, `project-context`, `eval-harness`, `prompt-budget`: 1115/1115 after the assertion update (one failure before it).

## 5.8 commands and milestone workflows (commit c56c7ed)

- Files: open-pr (15 → 0), generate-e2e-coverage (13 → 0), audit-milestone (14 → 0 except one allow-listed line), complete-milestone (12 → 0 except one allow-listed line), prd (4 → 0), update (4 → 0). execute-phase, execute-roadmap and plan-phase had no denied hits.
- open-pr: `stack.commands.pre_pr_gate`; the plan's fallback to `config/pre-pr-checks.json` is written into the gate step.
- Deviation: the `.preflight-passed` marker name is replaced by a placeholder, `<pass marker written by stack.commands.pre_pr_gate>`. The gate script that writes the marker is project-specific, so the marker name is no longer hard-coded here.
- Deviation: `scripts/qa-verdict.ts` is replaced by `<verdict gate command from stack.gates[]>`; the `<qa-verdict-gate>` tags became `<verdict-gate>` and the check name `qa_verdict_gate` became `verdict_gate`. No code or test references those names.
- Capability ID `qa-verdict-lifecycle-v1` kept (shared with `config/gate-capabilities.json` and the gsd-tools tests). Allow-listed `gates` max 1 in audit-milestone and complete-milestone.
- Product-example line in complete-milestone ("Next.js, Supabase, Canvas API") is an allow-listed upstream example and was not touched.
- Lint: `ok (140 denied, 381 allowed)` after the task.
- Tests: `gsd-tools`, `project-context`, `eval-harness`, `prompt-budget`: 1115/1115.

## 5.9 templates and hook config (commit 0f0a126)

- Files: phase-prompt (abs 10 → 0), codebase/structure (3 → 0), codebase/stack (2 → 0), summary (2 → 0), VALIDATION (2 → 0), prd (2 → 0), and hook-config.json (2 → 0).
- Deviation, outside the plan's file list: `summary-complex.md`, `summary-minimal.md`, `summary-standard.md` and `codebase/testing.md` each had one denied `charlotte` line (the same table row). Changed in the same commit so the four summary templates and summary.md name the same `caught_by` values.
- Deviation, code change: a relative `docs/**` pattern against an absolute file path never matches with minimatch, so project docs would silently stop being compressed. `matchesPattern` (`get-shit-done/bin/hooks/config.js`) now also matches the cwd-relative path. Test added in `doc-compression-hook.test.js` (red first: positive case returned false; green after the fix, 9/9).
- The test in `doc-compression-hook.test.js` loads a copy of `config.js` from the deps cache, because the `minimatch` resolved under `NODE_PATH` is 3.1.2 (default export), not the v9 named export the hook uses.
- `gsd-tools.test.js` `CAUGHT_BY_ENUM`: `charlotte` → `ui-qa` to match the templates. Same guard.
- Lint: `ok (113 denied, 381 allowed)` after the task.
- Tests: `gsd-tools`, `project-context`, `eval-harness`, `prompt-budget`: 1115/1115; `doc-compression-hook.test.js`: 9/9.

## 5.10 gsd-tools.js API detection, tier gate, ui_qa (commit c55f1dd)

- gsd-tools.js denied 27 → 0 in the 5.x classes (abs 2, authtech 1, charlotte 7, deno 7, frontend 1, gates 4, igaming 3, paths 1, supabase 1; line numbers in the plan had drifted, the lint is the authority). Allowed +9 via allow-list entries on `gsd-tools.js`: charlotte 3 → 7 (legacy aliases: evidence key, caught_by value, failure code, e2e path), deno 3, gates 1, supabase 1, frontend 1, authtech 1. `RISE allowed` rows were exactly these; no `RISE denied`.
- API detection: `GENERIC_API_PATTERNS` always; `LEGACY_API_PATTERNS` only when `uiQaMode` is `legacy`; `stack.paths.api_globs` (small glob subset, no new dependency) in profile mode. `isApiFile(path, opts)` defaults to legacy so existing callers are unchanged.
- Tier gate: `stack.gates[]` entry `tier-assignment` runs through `sh -c '<run> "$@"' sh --plan <path> --json` (`{root}` replaced, plan path never inside the string); exit 127/ENOENT and other failures warn; no gate and not legacy → `{errors:[],warnings:[],status:'not_configured'}`; legacy keeps the script path and the deno call.
- Check type `ui_qa`. Deviation: the failure code stays `missing_charlotte_qa` (legacy, allow-listed in four prose files, asserted by about 30 tests) and a DEFERRED.json waiver under either step name `ui_qa` or `charlotte_qa` is honoured. This answers the deferred item on the failure code: it is not renamed.
- `caught_by`: `ui-qa` added, `charlotte` kept. Impl-test coverage excludes `stack.paths.e2e_scenarios` (plus the legacy scenarios path in legacy projects).
- Fixes carried over from 5.1-5.9: `build` added to `KNOWN_COMMAND_KEYS`, the stack-profile template, the project-context reference and `execute-roadmap.md` (`<stack_commands.build>`); test in `project-context.test.js` (init output carries it). `agents/v2/gsd2-verifier.md` 8c, status line and frontmatter now say UI QA / `ui_qa_ran` with the no-capability skip.
- Tests added in `gsd-tools.test.js`: A-b (two), A-c, A-d, T-a, T-b (real `sh`, path with space and quote), T-c (two), caught_by pair. Updated: `type === 'ui_qa'` (4), enum size 8 → 9. A-a reuses `isApiFile / computeHasApi (unit)` and `positive: API phase ...` unchanged.
- Mutants, each killed: m1 legacy patterns dropped in legacy mode → `isApiFile / computeHasApi (unit)`, `positive: API phase`, A-d. m2 legacy patterns applied in profile mode → A-b legacy-path test, A-d. m3 plan path interpolated into the `-c` string → T-a, T-b. m4 legacy tier gate replaced by `not_configured` → the existing legacy tier-gate unit tests (`script absent` ... `exec returns valid JSON with violations key absent`).
- Not done: the Sonnet review round (coordinator dispatches). Lint after: ok (86 denied, 392 allowed).

## 5.11 other bin modules (commit bbb7720)

- token-monitor (abs 2 → 0: `os.homedir()`-relative, `~` in the message), conversation-miner (abs 2 → 0, comment example), dashboard-server (ports 1 → 0): WebSocket port `GSD_DASHBOARD_PORT || 8766`, page built by `renderDashboardHtml(port)`; knowledge-safety (cloud 3 → 1 allowed, comments reworded). Tests: `5.11` pair in `gsd-tools.test.js` (module importable; env read in a fresh process).
- Allow-list entries added (all `RISE allowed`, no `RISE denied`): `gsd-guard-bash.js` × deno 3 and `gsd-protect-managed-files.js` × deno 2 ("generic interpreter / check-bypass list"), `knowledge-safety.js` × cloud 1, `gsd-feedback.js` × authtech 1, docker 1, `gsd-learning.js` × frontend 1, authtech 1 (generic keyword lists). Hook tests, knowledge-safety tests unchanged and green (410).
- Left: telegram lines (48 in 8 files) and the `owner` allowed line, per plan.

## 5.12 single-hit files (commit a3658f2)

- Cleared: knowledge-permissions (cloud comment example), agent-messaging (UI QA agent wording), model-profile-resolution and mine-conversations (`~/.claude`), resilience (neutral example path). Allow-listed (1 each, with reasons): knowledge-extraction × frontend, gate-capabilities.json × gates (capability id `qa-verdict-lifecycle-v1`, test-asserted), routing-rules.md × authtech (routing keyword pattern), verify-phase.md × frontend (section heading names defined in verification-patterns.md). knowledge-synthesis and the summary templates were already clear.
- Deviation: four leftovers outside the plan's lists were needed for the zero target: `Version-skew preflight` → `Version-skew check` in the three `commands/gsd/*.md` files (no test asserts it), the demo agent's example base URL (`agents/gsd-demo.md`), and the React sentence in `references/fp-lint.md`.
- Handed to plan 06: `gsd-validator.js:27` (`THOROUGH_KEYWORDS`, the high-risk keyword list, states the risk rule, left in place).

## Lint after 5.12

`ok (55 denied, 406 allowed)`. Denied by class: telegram 48 (8 files), money 5 (gsd-circuit-breaker.js 1, gsd-tools.js 2, gsd-validator.js 1, execute-plan.md 1), game 1 (gsd-tools.js), reg 1 (gsd-tools.js). Every other class, including owner, reads 0 denied. Targeted tests green: gsd-tools.test.js, demo-check, prompt-budget, project-context, project-profile, agnostic-lint, hooks, knowledge-safety (last run 1111 pass, 0 fail). Full `npm test` not run.

## Not done in this run

- Full `npm test`: not run (coordinator runs it once per plan).

## Fable round 1 fixes

Reviewed at 1a2ca36. Tests: `NODE_PATH=$HOME/get-shit-done/node_modules node --test` on `project-context.test.js` + `prompt-budget.test.js` (95/95) and `gsd-tools.test.js` (984/984); lint `ok (55 denied, 406 allowed)` after each commit. No full `npm test`.

| Finding | Commit | Test |
|---|---|---|
| H1 verifier machine gates fail open for legacy (8g, 8i, verifier-detail 8i, FP ratchet in execute-phase); prose pointed at "init output" | b193dc6 | `project-context.test.js` "H1 every machine-gate site carries a legacy clause..." (legacy clauses name no script, so no lint term). `project.block.json` carries only locked_commands, flake_patterns, style, host, deploy (no gates, capabilities, paths, services), so only M-00-PLAN-INDEX section 4 item 1 was edited (adds `tier-delta` and the Layer-1 gate ids). |
| M2 UI QA skipped for legacy / no agent to spawn | b193dc6 | "M2 UI QA is skipped only on ui_qa_mode none..." over coordinator, coordinator-detail, execute-roadmap. Spawn placeholder is now `<UI QA agent>`, defined as `stack.capabilities.ui_qa.agent`, legacy = the project's configured QA agent. |
| M3 verifier 8c without no-capability carve-out | b193dc6 | "M3 the verifier skips UI QA coverage on ui_qa_mode none..." (agent + verifier-detail) |
| L8 garbled round-4 sentence | b193dc6 | "L8 the round-4 ruling cap attaches to loop to zero" (coordinator + execute-phase) |
| L4 tier-assignment profile gate with a missing file returned errors [] + "unparseable" warning | 1e14241 | red first: `T-c ... exit 127 -> error`, `L4` real-`sh` test (node on a missing file exits 1, empty stdout), `L4` non-JSON stdout. Every failure shape of a profile gate is an error now; the legacy deno path keeps warnings. |
| M6 `--legacy` not reaching spawned agents; hint inaccurate | 49f971d | "M6 every init plan-phase / execute-phase call line accepts LEGACY_FLAG..." (computed caller list) and "M6: the gate hint names the flag (this call only) and the env variable". Child files take `$LEGACY_FLAG` (set when the spawn prompt says `legacy: true`); plan-phase and execute-phase pass `legacy: true` to spawned agents. |
| M5 interview half state | a7cb638 | "a config with only the four mandatory commands..." (diff exits 1 before init, init, diff 0, gate 1 without the md files, gate 0 with them), "init new-project reports the context gate...", "the interview text keys its skips...". Smaller change chosen: reorder, no engine change. `init new-project` now returns `context_gate`; 4.5/5.6 skip on it; STACK-PROFILE.md is written after `project init`; the pre-deploy `project diff` preview is gone (a review `diff` follows the deploy). Two existing order tests were updated to this order. |
| L7 no assumption for "no UI QA driver" in auto mode | a7cb638 | "L7 auto mode records an assumption when no UI QA driver is chosen" |

Deviations: the finding cites `commands/gsd/new-project.md:348,530`; the sections live in `get-shit-done/workflows/new-project.md`. Dropping the pre-deploy preview changes a plan decision (M-04 4.2). `init` is not absent-files-only: CLAUDE.md gets action `update` (managed block appended, owner text kept) and `config.json` is rewritten with the defaults, isolation and deploy slots; the other files follow their own action.

Notes, not fixed (for 7.1 or the coordinator):
- `SENSITIVE_LONG_RE` / `SENSITIVE_SHORT_RE` (`gsd-tools.js:7868`, `:7870`) against the `risk_domains` prose: reconcile in 7.1.
- Generic keyword lists left for 7.1: `gsd-tools.js:7120`, `gsd-circuit-breaker.js:18`, `gsd-validator.js:27`, `execute-plan.md:486`.
- `gsd-plan-checker.md` and `gsd-phase-researcher.md` carry two `<project_context>` elements.
- Builtin mode (no brief) routes every state-mutating plan to the Opus tier.

## Fable round 2 fixes

Tests: `project-context.test.js` + `prompt-budget.test.js` (97/97), `gsd-tools.test.js` (987/987); `agnostic-lint check` ok (55 denied, 406 allowed). No full `npm test`.

| Finding | Commit | Test |
|---|---|---|
| F1 new-project 5.6 step 3 had no already-deployed branch | f1a421e | "F1 re-run after a deploy..." (init, no md, second init exits 1 `already initialised`, sync rc 0 or 2; step text) |
| F2 coordinator-detail HARD RULE ignored legacy | f1a421e | M2 test now rejects the old wording |
| F3 tier-assignment gate fail-open shapes | 8bca9b8 | three F3 tests (red first): non-array/null violations, exit 1 with none, entry without `run` |
| F4 STACK-PROFILE invariant + 'absent files only' sentence | f1a421e | F1 test rejects the old sentence; deviation line corrected above |
| F5 complete-milestone spawn-prompt comment | f1a421e | "F5 complete-milestone parses $ARGUMENTS..." |

Notes, not fixed: relay of `legacy: true` down execute-roadmap -> coordinator -> planner/executor relies on `GSD_LEGACY=1` in the launch env (execute-roadmap.md:22), fails closed; `ui_qa_mode` is emitted only by `verify phase-gate` (gsd-tools.js:~7554), so the coordinator must call it before the UX sweep; the H1/M2/M3/L8 tests are text-presence regexes.
