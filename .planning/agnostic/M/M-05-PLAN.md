---
phase: agnostic-M
plan: 05
type: backend
wave: 7
depends_on: ["02", "04"]
files_modified:
  - agents/*.md
  - commands/gsd/*.md
  - get-shit-done/workflows/*.md
  - get-shit-done/references/*.md
  - get-shit-done/templates/**
  - get-shit-done/config/gate-capabilities.json
  - routing-rules.md
  - get-shit-done/bin/gsd-tools.js
  - get-shit-done/bin/gsd-tools.test.js
  - get-shit-done/bin/*.js
  - hook-config.json
  - scripts/agnostic-lint/baseline.json
  - scripts/agnostic-lint/allowlist.json
autonomous: true
e2e_flows: []
must_haves:
  truths:
    - "After this plan the lint reports zero denied lines in every class except money, reg, game, owner (plan 06) and telegram"
    - "No methodology rule was deleted: each removed line's rule survives with a profile or brief slot in place of the literal"
    - "A legacy project (no `stack.capabilities`) keeps today's API-file detection and tier gate"
  artifacts:
    - scripts/agnostic-lint/baseline.json
---

<objective>
Phase E, the stack and tool classes (D:274 E1-E3, E6-E8; D:79-95). One task per file set; each task clears every class listed below in its files in one pass. Start counts are the per-file lint numbers at `0b9c35a`.

**Not touched in this plan:** lines whose only hit is class `money`, `reg`, `game` or `owner` (plan 06), `telegram`, and allow-listed upstream examples (`scripts/agnostic-lint/allowlist.json`).

**Replacement table (apply the same wording everywhere):**

| Found | Write instead |
|---|---|
| the QA driver's name, its agent name, its MCP tool prefix | "the UI QA capability" (`stack.capabilities.ui_qa`: `agent`, `tool_prefix`); "if the profile declares none, skip and record `ui_qa_ran: false  # no ui_qa capability`" |
| `charlotte_qa_ran` | `ui_qa_ran` |
| a test, typecheck, lint, format or search command of any runtime | "the `<key>` command from `stack_commands` (init output)" with key `test_file`, `test_all`, `typecheck`, `lint`, `format`, `frontend_test`, `search` |
| a gate script name | "every gate in `stack.gates[]` and `stack.commands.pre_pr_gate`; a gate whose runtime is missing is a gap, never a skip" |
| a repo path (`apps/…`) | `stack.paths.<key>` |
| a service, database, cache, container or runtime product name | "the service named in `stack.services[]`" or delete if it is only an example |
| `/Users/<name>/.claude` | `~/.claude` |
| the GSD source checkout path | "the path in `~/.claude/gsd-source-path.txt`" |
| a port, URL or lock file name | `stack.services[].url`; `capabilities.ui_qa.lock_file` |
| a product example (badge, player, cap) | delete, or a neutral example ("a list page") |
| the model-allowance sentence | "owner model overrides (brief: Owner Policies)" |

**How each task works:** list the hit lines with `git grep -n -i -E "<pattern>" -- <file>` (patterns in `scripts/agnostic-lint/terms.json`), edit those lines, run `node scripts/agnostic-lint.js check`, then `write-baseline`. Read the file in ranges around the hits. The summary records `file: before → after` per task. If a hit is a generic tool list or a generic name that must stay (D:93), add an allowlist entry with a one-line reason instead and count it in the summary. An entry moves lines from `denied` to `allowed`, which `write-baseline` refuses: use `--allow-raise` only under the allow-list raise rule of index section 1 (the `RISE allowed` rows shown by `check` are exactly the entries just added, no `RISE denied` row), and quote entry and rows in the summary. Named uses in this plan: 5.3, 5.10, 5.11.
</objective>

<tasks>

<task id="5.1" type="auto" tdd="true">
<name>references/coordinator-detail.md (1439 lines; 72 lines to clear: charlotte 32, abs 22, nx 4, ports 4, frontend 2, igaming 2, deno 1, gates 1, paths 1)</name>
<files>get-shit-done/references/coordinator-detail.md</files>
<action>Apply the table. The command-shape block at :1432-1439 becomes "use `stack_commands` verbatim; never retype a command".</action>
<behavior>- T2: lint count for this file in the listed classes is 0 after `write-baseline`; the ratchet test (`scripts/agnostic-lint.test.js`) is green. REUSE the ratchet (no new test: the lint is the assertion).</behavior>
<verify>Full gate; `prompt-budget.test.js` green.</verify>
<done>72 → 0.</done>
</task>

<task id="5.2" type="auto" tdd="true">
<name>references/verifier-detail.md (1245 lines; 53: charlotte 31, deno 7, gates 7, frontend 4, authtech 2, edgefn 1, supabase 1)</name>
<files>get-shit-done/references/verifier-detail.md</files>
<action>Apply the table. Gate lists at :1129-1130, :1169-1170 become the `stack.gates[]` rule.</action>
<behavior>- T2: counts 0 in the listed classes. REUSE the ratchet.</behavior>
<verify>Full gate.</verify>
<done>53 → 0.</done>
</task>

<task id="5.3" type="auto" tdd="true">
<name>workflows/execute-roadmap.md (785 lines; 55: charlotte 28, paths 8, gates 5, edgefn 4, nx 4, deno 3, docker 2, supabase 1)</name>
<files>get-shit-done/workflows/execute-roadmap.md, scripts/agnostic-lint/allowlist.json, baseline.json</files>
<action>
Apply the table, with one exception. Four of the five `gates` hits are not a gate script: `:94` `<step name="preflight_quota_estimate">`, `:122` `quota_preflight_insufficient`, `:138` `quota_preflight_ok`, `:143` `<step name="preflight_skew_check">`. They are generic step and event names that `gsd-tools.test.js:10093-10102` and `:10507-10538` assert by literal. Do not rewrite them: add one allow-list entry (`get-shit-done/workflows/execute-roadmap.md` × `gates`, `max: 4`, reason "generic quota-preflight step and event names, asserted by gsd-tools.test.js") under the allow-list raise rule. Only `:646` (the gate-script sentence) is rewritten per the table.
</action>
<behavior>
- T2: denied counts 0 in the listed classes; `allowed` for this file × `gates` is 4. REUSE the ratchet.
- T2: the quota-preflight and skew-check tests at `gsd-tools.test.js:10093-10102, 10507-10538` pass unchanged. REUSE.
</behavior>
<verify>Full gate; `git diff` shows lines 94, 122, 138, 143 untouched.</verify>
<done>55 denied → 0 denied, 4 allowed.</done>
</task>

<task id="5.4" type="auto" tdd="true">
<name>workflows/execute-phase.md (29), execute-plan.md (3), demo.md (6)</name>
<files>get-shit-done/workflows/execute-phase.md, execute-plan.md, demo.md</files>
<action>Apply the table. In `execute-phase.md` the model-allowance sentences (:203, :728) follow the last table row.</action>
<behavior>- T2: counts 0 in every class except the plan-06 ones. REUSE the ratchet.</behavior>
<verify>Full gate.</verify>
<done>38 → 0.</done>
</task>

<task id="5.5" type="auto" tdd="true">
<name>Agents: verifier (21), phase-coordinator (14), executor (7), planner (5), plan-checker (3)</name>
<files>agents/gsd-verifier.md, gsd-phase-coordinator.md, gsd-executor.md, gsd-planner.md, gsd-plan-checker.md</files>
<action>Apply the table. `gsd-planner.md` MANDATE-2 keeps "UI changes → UI QA" and gains "when the profile declares the capability; otherwise the plan states `no ui_qa capability`".</action>
<behavior>- T2: counts 0 in the non-plan-06 classes; budgets hold. REUSE the ratchet and `prompt-budget.test.js`.</behavior>
<verify>Full gate.</verify>
<done>50 → 0.</done>
</task>

<task id="5.6" type="auto" tdd="true">
<name>Other agents: gsd2-runner (12), roadmapper (9), qa-analyst (7), test-writer (7), e2e-test-generator (7), meta-answerer (3), product-investigator (2), ui-inventory (2)</name>
<files>agents/gsd2-runner.md, gsd-roadmapper.md, gsd-qa-analyst.md, gsd-test-writer.md, gsd-e2e-test-generator.md, gsd-meta-answerer.md, gsd-product-investigator.md, gsd-ui-inventory.md</files>
<action>Apply the table. `gsd2-runner.md:18-21`: the allowed command shapes are `stack.test_command_shapes` and `stack_commands`.</action>
<behavior>- T2: counts 0 in the non-plan-06 classes. REUSE the ratchet.</behavior>
<verify>Full gate.</verify>
<done>49 → 0.</done>
</task>

<task id="5.7" type="auto" tdd="true">
<name>References: gsd-test-protocol (26), planner-detail (denied, non-plan-06: about 19), executor-detail (17), checkpoints (9), service-health (rest), fp-lint (7), and the abs-only files</name>
<files>get-shit-done/references/gsd-test-protocol.md, planner-detail.md, executor-detail.md, checkpoints.md, service-health.md, fp-lint.md, decimal-phase-calculation.md, git-integration.md, phase-argument-parsing.md, git-planning-commit.md, verification-patterns.md, audit-log.md, debugger-detail.md</files>
<action>Apply the table. `planner-detail.md` is 1286 lines: work from the grep hit list only.</action>
<behavior>- T2: counts 0 in the non-plan-06 classes. REUSE the ratchet.</behavior>
<verify>Full gate.</verify>
<done>Counts recorded.</done>
</task>

<task id="5.8" type="auto" tdd="true">
<name>Commands and milestone workflows: open-pr (15), generate-e2e-coverage (13), audit-milestone (14), complete-milestone (12), prd.md, update.md, three one-line command hits</name>
<files>commands/gsd/open-pr.md, generate-e2e-coverage.md, execute-phase.md, execute-roadmap.md, plan-phase.md, get-shit-done/workflows/audit-milestone.md, complete-milestone.md, prd.md, update.md</files>
<action>Apply the table. `open-pr.md`: "run `stack.commands.pre_pr_gate`; if that script file is absent, run the stack-detected checks of `config/pre-pr-checks.json`".</action>
<behavior>- T2: counts 0 in the non-plan-06 classes. REUSE the ratchet.</behavior>
<verify>Full gate.</verify>
<done>Counts recorded.</done>
</task>

<task id="5.9" type="auto" tdd="true">
<name>Templates and hook-config: phase-prompt (abs 10), codebase/structure (3), codebase/stack (2), summary (2), VALIDATION (2), prd (2), hook-config.json (2)</name>
<files>get-shit-done/templates/phase-prompt.md, codebase/structure.md, codebase/stack.md, summary.md, VALIDATION.md, prd.md, hook-config.json</files>
<action>Apply the table. `hook-config.json`: the project docs glob becomes a relative `docs/**` pattern; check its reader `get-shit-done/bin/hooks/config.js:5-6` still loads it.</action>
<behavior>
- T2: counts 0. REUSE the ratchet.
- T2: the hook-config loader test still passes with the relative glob. REUSE `doc-compression-hook.test.js`; UPDATE it if it asserts the old path.
</behavior>
<verify>Full gate.</verify>
<done>23 → 0.</done>
</task>

<task id="5.10" type="auto" tdd="true">
<name>gsd-tools.js: API globs with the legacy patterns kept, tier-gate argv, remaining strings [critical path, mutation]</name>
<files>get-shit-done/bin/gsd-tools.js (:87, :283-300, :2901-2905, :6757-6800, :7057, :7449-7490, :7803, :7838 and the lines `git grep` lists for classes charlotte, deno, gates, igaming, abs, paths, supabase, frontend, authtech), gsd-tools.test.js (only tests that assert the changed strings), scripts/agnostic-lint/allowlist.json, baseline.json</files>
<action>
- API detection (`:288-292`, `isApiFile` `:294-298`): split the list. `GENERIC_API_PATTERNS` = the `(app|pages)/api/` pattern, always applied. `LEGACY_API_PATTERNS` = the two patterns at `:289-290`, applied **only when the project is legacy** (`uiQaMode` = `'legacy'`, index decision 1): a legacy project has no `api_globs`, and without these two patterns an API change there would stop requiring UI QA. A project with a `stack.capabilities` object uses the generic pattern plus `stack.paths.api_globs`. The two legacy lines stay in the file: allow-list them (`get-shit-done/bin/gsd-tools.js` × `paths`, `supabase`, `edgefn` as `check` reports, reason "legacy-project API patterns, applied only without a stack profile") under the allow-list raise rule.
- Tier-assignment gate (`:6770` onward, `runP0TierAssignmentGate`): with a `stack.gates[]` entry whose id is `tier-assignment`, run its `run` string. `run` is a command string (`project-profile.js:84-90`), not an argv: replace `{root}` with `cwd`, then call the injected `exec('sh', ['-c', run + ' "$@"', 'sh', '--plan', fullPath, '--json'], { cwd, encoding: 'utf8' })`. The plan path travels as an argument, never inside the string. Exit 1 with a parseable `{ violations: [] }` on stdout → errors, as today (`:6785-6794`); exit 127 (command not found) takes today's missing-binary warning branch (`:6795-6796`); any other failure → the existing warning. No such gate and the project is **not** legacy → `not_configured`, no error, no warning. Legacy project → today's behaviour unchanged (script path `:6775-6776`, runtime call `:6783`), those two lines allow-listed with the reason "legacy-project tier gate".
- Check name `charlotte_qa` in the gate output becomes `ui_qa`; `charlotte_qa_required` stays as the alias line allow-listed in 2.2. Comments and messages follow the table.
- `DEFECT_CLASSES_CAUGHT_BY` (`:2901-2905`): add `'ui-qa'`; keep `'charlotte'` as an accepted legacy value (existing SUMMARY tables carry it; `gsd-tools.test.js:15933` lists it) and allow-list that line, reason "legacy caught_by value". The prompt that fixes the value (asserted at `gsd-tools.test.js:16058`) says `ui-qa`.
- Leave every `telegram` line.
</action>
<behavior>
- T1 CLI A-a: legacy project (no `stack`), touched file under each of the two legacy paths → `has_api` true and the phase gate requires UI QA. REUSE the existing `has_api` tests unchanged (find with `grep -n "has_api" gsd-tools.test.js`; cite the lines); ADD only for a path no existing test covers.
- T1 CLI A-b: project with `stack.capabilities: { ui_qa: {…} }` and `api_globs: ["srv/handlers/**"]`: `srv/handlers/x.ts` → `has_api` true; a file under a legacy path → false. ADD.
- T1 CLI A-c: same project, file under `app/api/` → true (generic pattern in both modes). ADD.
- T1 unit T-a: gate `run: "node {root}/tools/tier.js"` → `exec` receives `sh`, `-c`, the string with `{root}` replaced and ` "$@"` appended, then `sh`, `--plan`, the plan path, `--json`. ADD.
- T1 unit T-b: a plan path containing a space and a quote arrives as one argument (run it for real against a script that prints `$#`). ADD.
- T2 CLI T-c: profile project with no `tier-assignment` gate → `not_configured`; gate exiting 1 with violations → errors; exit 127 → warning. UPDATE the existing tier-gate tests that inject `exec`; the legacy-path tests stay unchanged (REUSE, cite lines).
- T2 CLI: phase-gate output has a check of type `ui_qa`. UPDATE existing assertions on the old type.
- T2 unit: `'ui-qa'` and `'charlotte'` are both accepted `caught_by` values. UPDATE `gsd-tools.test.js:15933`, `:16058`.
Mutants: m1 legacy patterns dropped in legacy mode → A-a; m2 legacy patterns applied in profile mode → A-b; m3 plan path interpolated into the `-c` string → T-b; m4 legacy tier gate replaced by `not_configured` → the existing legacy tier-gate test (cite it).
</behavior>
<verify>Full gate; 4 mutants killed; lint for this file: denied holds only `telegram` and plan-06 classes; the `RISE allowed` rows are exactly the entries added here (quoted). Sonnet rounds to zero (index section 0).</verify>
<done>Counts recorded.</done>
</task>

<task id="5.11" type="auto" tdd="true">
<name>Other bin modules</name>
<files>get-shit-done/bin/hooks/gsd-guard-bash.js:325-340, gsd-protect-managed-files.js:125-145, knowledge-safety.js, dashboard-server.js:71, token-monitor.js, conversation-miner.js, gsd-feedback.js, gsd-learning.js, scripts/agnostic-lint/allowlist.json, baseline.json</files>
<action>
Absolute paths → `os.homedir()`-relative. Dashboard port: `process.env.GSD_DASHBOARD_PORT || 8766`. The interpreter and bypass-flag lists in the two hooks are generic defence (D:93): keep the code, add allowlist entries (`gsd-guard-bash.js` × `deno` 3, `gsd-protect-managed-files.js` × `deno` 2, the baseline counts at `0b9c35a`) with the reason "generic interpreter / check-bypass list", under the allow-list raise rule. Leave `telegram` lines and the `owner` line (6.5).
</action>
<behavior>
- T2: `gsd-guard-bash.test.js` and `gsd-protect-managed-files.test.js` unchanged and green. REUSE.
- T2 unit: dashboard server honours `GSD_DASHBOARD_PORT`. ADD only if the module is importable without starting a server; otherwise state "unverified, probe: start with the env set" in the summary.
</behavior>
<verify>Full gate; allowlist additions and their `RISE allowed` rows listed in the summary.</verify>
<done>Counts recorded.</done>
</task>

<task id="5.12" type="auto" tdd="true">
<name>The fifteen single-hit files no other task names</name>
<files>get-shit-done/bin/knowledge-extraction.js (frontend 1), knowledge-permissions.js (cloud 1), knowledge-synthesis.js (game 1), gsd-validator.js (money 1), get-shit-done/config/gate-capabilities.json (gates 1), routing-rules.md (authtech 1), get-shit-done/references/agent-messaging.md (charlotte 1), model-profile-resolution.md (abs 1), resilience.md (paths 1), get-shit-done/templates/codebase/testing.md (charlotte 1), summary-complex.md, summary-minimal.md, summary-standard.md (charlotte 1 each), get-shit-done/workflows/mine-conversations.md (abs 1), verify-phase.md (frontend 1)</files>
<action>
One denied line each at `0b9c35a` (`scripts/agnostic-lint/baseline.json`). Apply the table. The three summary templates carry the evidence key: write `ui_qa_ran`. In the four `.js` files and the JSON file, change a string or comment only if no test asserts it (`git grep -n "<literal>" -- '*.test.js'` first); a keyword list used for classification that must keep the word is allow-listed under the raise rule with its reason. The `money` and `game` hits (`gsd-validator.js`, `knowledge-synthesis.js`) are examples or keyword lists, not the risk rule: clear them here; if one states the risk rule, leave it, name it in the summary, and 6.3 takes it.
</action>
<behavior>
- T2: denied count 0 for each of the fifteen files (or the named hand-over to 6.3). REUSE the ratchet.
- T2: the tests of the four modules and of the summary templates pass. REUSE; UPDATE only an assertion on a string this task changed, and name it.
</behavior>
<verify>Full gate.</verify>
<done>15 → 0, per file.</done>
</task>

</tasks>

<verification>`node scripts/agnostic-lint.js report`: every class column except money, reg, game, owner, telegram reads 0 in the `denied` set. Full gate green.</verification>
<success_criteria>Both must-have truths; the one Sonnet round reads the plan's whole diff for a deleted rule.</success_criteria>
<output>`.planning/agnostic/M/M-05-SUMMARY.md`</output>
