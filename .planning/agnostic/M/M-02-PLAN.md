---
phase: agnostic-M
plan: 02
type: backend
wave: 2
depends_on: ["01"]
files_modified:
  - get-shit-done/bin/project-registry.js
  - get-shit-done/bin/project-registry.test.js
  - get-shit-done/bin/project-pack.js
  - get-shit-done/bin/project-profile.js
  - get-shit-done/bin/project-profile.test.js
  - tests/fixtures/agnostic/ui-qa-lock-verdicts.json
  - tests/phase-38/service-health.test.js
  - get-shit-done/bin/project-context.js
  - get-shit-done/bin/gsd-tools.js
  - get-shit-done/bin/gsd-tools.test.js
  - get-shit-done/bin/project-deploy.test.js
  - get-shit-done/bin/hooks/gsd-ui-qa-lock.js
  - get-shit-done/bin/hooks/gsd-ui-qa-lock.test.js
  - bin/install.js
  - bin/install.test.js
  - get-shit-done/presets/packs/charlotte/**
  - agents/gsd-demo.md
  - get-shit-done/bin/demo-check.js
  - get-shit-done/references/service-health.md
  - get-shit-done/references/coordinator-detail.md
  - get-shit-done/workflows/execute-phase.md
  - package.json
autonomous: true
e2e_flows: []
must_haves:
  truths:
    - "Two projects initialised on one machine get different port_base values and container ids equal to their slugs"
    - "A project whose `stack.capabilities` object has no ui_qa key passes the phase gate without UI QA evidence; a legacy project, and a project whose `stack` holds only what the wiring wrote, do not"
    - "The renamed lock hook gives the same verdict as the old one on every recorded command"
    - "No core file falls back to localhost:3000"
  artifacts:
    - get-shit-done/bin/project-registry.js
    - get-shit-done/bin/hooks/gsd-ui-qa-lock.js
    - get-shit-done/presets/packs/charlotte/preset.json
---

<objective>
G1-minimal, E2-minimal, E3, G4. The deploy engine is not edited. Every test passes `GSD_HOME=<tmp>`; no test may create or change `~/.gsd`.
</objective>

<tasks>

<task id="2.1" type="auto" tdd="true">
<name>Slug and port registry (G1) [critical path, mutation]</name>
<files>get-shit-done/bin/project-registry.js (new; no line cap), project-registry.test.js (new), gsd-tools.js:15184-15189, project-profile.js:126-134 + project-profile.test.js (value restriction), project-deploy.test.js:449 (env only: the test-only exception in the index, "Frozen"), package.json:64</files>
<action>
- `registryDir(env)` = `env.GSD_HOME || path.join(os.homedir(), '.gsd')`. File `projects.json`: `{ "version": 1, "projects": { "<slug>": { "root", "port_base" } } }`.
- `allocate({ dir, slug, root, wanted })` → `{ ok:true, port_base, reused }` or `{ ok:false, reason }`. Same slug + same real path → reuse. Same slug, other root → `slug already registered at <root>`. `wanted` (a `port_base` already in the config) is registered as is, or refused when another project is within 100 of it. Otherwise the lowest free of 55000, 55100, … 64900. A malformed file is an error and is never overwritten.
- Write: tmp file + rename, under `projects.lock` taken with `fs.openSync(lock, 'wx')` (retry 40 × 50 ms; a lock older than 30 s is removed).
- `applyToConfig(root, slug, port_base)`: set `stack.isolation.port_base` and `stack.isolation.container_suffix = slug` in `.planning/config.json` only where absent; in the same write, fill the base defaults only where absent: `project.owner_title` "owner", `stack.branch.default` "main", `stack.commands.search` "git grep -n", `stack.commands.pre_pr_gate` "scripts/pre-pr-gate.sh" (index decision 3); and, inside an existing `stack.capabilities` object, `backend: {}` and `web_ui: {}` where the key is absent (index decision 4; `false` is kept). It never creates `stack.capabilities` and never adds `ui_qa`: creating the object would turn a legacy project into "no UI QA" (index decision 1).
- Value restriction in `project-profile.js` (`SHAPE_CHECKS`, `:126-134`): `project.owner_title`, `stack.branch.default`, `stack.commands.search`, `stack.commands.pre_pr_gate` must match `^[A-Za-z0-9 ._/-]+$` (they are rendered into Perl, shell and JSON files in M-03). `stack.commands.pre_pr_gate` is stricter: a repo-relative path to one file, matching `^[A-Za-z0-9._][A-Za-z0-9._/-]*$` (no space, no leading `/` or `-`) with no `..` segment. The push-gate hook allows a push when the gate script file does not exist (`block-push-without-local-tests.pl:48`, kept in 3.5), so a path that resolves to nothing from the repository root (absolute, escaping with `..`, or holding a space that splits it) would silently turn the gate off; the loader refuses it instead.
- Wiring at `gsd-tools.js:15184`, when `args[1] === 'init'`: resolve the root the same way `project-deploy.js:279` does. Config unreadable or no valid `project.slug` → delegate to the engine unchanged (it reports the problem). Otherwise **validate everything before the first write**, in this order, and on any failure print `{ ok:false, errors:[{ reason }] }`, exit 1, with config and registry bytes unchanged: (1) `validateProfile` reports no `invalid` entry; (2) `stack.capabilities` is an object, else reason `stack.capabilities is not set: declare it (interview step 5.6), e.g. {"backend":{},"web_ui":{}}`; (3) the registry file is absent or well-formed; (4) `allocate` computed in memory succeeds. Then write the config, then the registry, then delegate to `projectDeploy.runCli` unchanged.
- `project-deploy.test.js:449`: the `cli` helper's env becomes `{ ...env, GSD_HOME: <tmp dir> }`. Its `init` call at `:679` runs with slug `demo` (`:18`) and would otherwise write the real `~/.gsd/projects.json`. No assertion changes; engine code untouched.
</action>
<behavior>
- T1 unit P-a: two slugs → 55000 and 55100; third after removing none → 55200. ADD.
- T1 unit P-b: same slug + same root twice → same port, `reused:true`, one entry. ADD.
- T1 unit P-c: same slug, different root → `ok:false`, file unchanged. ADD.
- T1 unit P-d: `wanted: 54320` registers 54320; a second project wanting 54350 is refused. ADD.
- T1 process P-e: 8 child processes allocate 8 slugs at once → 8 distinct ports, valid JSON. ADD.
- T2 CLI P-f: `project init --preset igaming` with `GSD_HOME=<tmp>` and a config holding a slug and `stack.capabilities: {}` (allocation runs before the engine, so the assertion holds whatever the engine's exit code; `--preset-dir` is refused outside a terminal, `project-deploy-guard.js:123`): `<tmp>/projects.json` is written, config gains `port_base`, `container_suffix` = slug, the four defaults, `backend: {}` and `web_ui: {}`; a config that already has `container_suffix: "api"`, `owner_title: "CEO"` or `web_ui: false` keeps them; no `ui_qa` key appears. ADD.
- T1 CLI P-h: config with a slug and no `stack` object → exit 1, reason names `stack.capabilities`; config bytes and `<tmp>/projects.json` (absent) unchanged. ADD.
- T1 CLI P-i: `owner_title: "a\"; b"` → exit 1 before any write; `stack.gates: "x"` → the same; `pre_pr_gate` of `/tmp/gate.sh`, `../gate.sh`, `tools/my gate.sh` and `-x` → the same, naming the key. ADD.
- T2 unit P-j: `profile check` rejects each of the four keys with a quote, a backtick, `$(` or a newline, and accepts `git grep -n`, `scripts/pre-pr-gate.sh`, `release/1.x`. ADD.
- T1 unit P-g: malformed `projects.json` → error, bytes unchanged. ADD.
- Guard: `after` hook asserts the real `~/.gsd/projects.json` stat (or absence) equals the value captured in `before`. ADD.
Mutants: m1 allocation ignores existing entries → P-a; m2 root check removed → P-c; m3 `registryDir` ignores `GSD_HOME` → P-f; m4 lock removed → P-e; m5 neighbour check removed → P-d; m6 wiring creates `stack.capabilities` when absent → P-h; m7 config written before validation → P-i.
</behavior>
<verify>Full gate; 7 mutants killed; `project-deploy.test.js` green with its assertions unchanged (`git diff` of that file shows the one env line).</verify>
<done>11 tests pass.</done>
</task>

<task id="2.2" type="auto" tdd="true">
<name>Phase gate: UI-QA no-op without capability, ui_qa_ran alias (E2-minimal) [critical path, mutation]</name>
<files>project-context.js, gsd-tools.js:6738-6755, 7401-7412, 7449-7466, 7480-7490, gsd-tools.test.js (inside the describe at :5431 only), scripts/agnostic-lint/allowlist.json, baseline.json</files>
<action>
- `uiQaMode(cwd)` in `project-context.js`, three values (index decision 1): `'legacy'` when `stack.capabilities` is not an object (no `stack`, or a `stack` with only `isolation`, `branch`, `commands`: exactly what the 2.1 wiring can write); `'none'` only when `stack.capabilities` is an object with no own `ui_qa` key; `'capable'` when the `ui_qa` key is present with any value (an invalid value such as `true` still means required; `profile check` reports it separately). A config that cannot be read → `'legacy'`.
- `:6740` becomes one line: `verification: { required: ['phase','verified','status','score'], any_of: [['ui_qa_ran','charlotte_qa_ran']] },`. `cmdFrontmatterValidate` (`:6743-6755`) reports `ui_qa_ran` as missing when no key of an `any_of` group is present.
- Gate (`:7451-7455`): required = `(hasUi || hasApi) && mode !== 'none'`; satisfied = any key of the alias group `=== true`. The `e2e_plan` check (`:7461-7466`) gets the same `mode !== 'none'` condition. Result (`:7489`, `charlotte_qa_required`): add `ui_qa_required` with the same value, and `ui_qa_mode`.
- The old key stays as an alias on the existing lines (`:6740`, `:7453`, `:7489`), so the denied count for this file does not rise. Those alias lines can never reach zero: add allow-list entries for `get-shit-done/bin/gsd-tools.js` × `charlotte` sized to the alias lines only, reason "legacy evidence-key alias", under the allow-list raise rule (index section 1). `:287-291` is not touched here (5.10).
- Tests go inside the existing describe at `gsd-tools.test.js:5431` because its fixture builder is local to that file.
</action>
<behavior>
- T1 CLI E-a: profile with `stack` and no `ui_qa`, UI file touched, no QA key → gate `passed:true`, `ui_qa_required:false`. ADD.
- T1 CLI E-b: same profile with `capabilities.ui_qa` and no QA key → fails with the QA failure type. ADD.
- T1 CLI E-c: `ui_qa_ran: true` satisfies the gate; `ui_qa_ran: "true"` (string) does not. ADD.
- T1 CLI E-d: legacy project (no `stack`), UI file, no QA key → fails. REUSE the existing failing-case test in the describe at `:5431` (cite its line in the summary); if none asserts exactly this, ADD.
- T1 CLI E-e: legacy project with `charlotte_qa_ran: true` → passes. REUSE (existing matrix), cite line.
- T2 CLI E-f: `frontmatter validate --schema verification` accepts either key, rejects neither. ADD.
- T1 CLI E-g: config whose `stack` holds only `isolation`, `branch` and `commands` (the 2.1 output on a project with no capabilities), UI file, no QA key → fails, `ui_qa_mode: "legacy"`. ADD.
- T1 CLI E-h: `stack.capabilities: { ui_qa: true }` (present, invalid), UI file, no QA key → fails. ADD.
- T1 CLI E-i: `stack.capabilities: { backend: {} }` (object, no `ui_qa`) → passes, `ui_qa_mode: "none"`. ADD.
Mutants: m1 mode ignored in `required` → E-a; m2 `'legacy'` treated as `'none'` → E-d; m3 alias key dropped → E-e; m4 `=== true` loosened to truthy → E-c; m5 `'none'` decided by "a `stack` object exists" (only `stack.isolation` → QA not required) → E-g; m6 `'none'` decided by "`ui_qa` is not an object" → E-h.
</behavior>
<verify>Full gate; 6 mutants killed; `check` shows no `RISE denied` row; the only `RISE allowed` rows are the alias entries (quoted in the summary).</verify>
<done>Tests pass; mutant table in the summary.</done>
</task>

<task id="2.3" type="auto" tdd="true">
<name>Profile-driven UI-QA lock hook and installer registration (E3) [critical path, mutation]</name>
<files>get-shit-done/bin/hooks/gsd-charlotte-lock.js → gsd-ui-qa-lock.js (git mv, 233 lines), its test (git mv, 209 lines), tests/fixtures/agnostic/ui-qa-lock-verdicts.json (new), bin/install.js:1824-1845, bin/install.test.js:150, 531-559, package.json:64, scripts/agnostic-lint/allowlist.json, baseline.json</files>
<action>
- First statement of the hook: read `<cwd>/.planning/config.json`; no `stack.capabilities.ui_qa` object → exit 0 (no lock file, no block).
- From the capability: `agent` (replaces the constant at `:24`), `tool_prefix` (PreToolUse on a tool whose name starts with it takes the lock), `reset_patterns` (literals), `lock_file` (default `.tmp/ui-qa.lock`, replaces `:22`).
- **Step 0, before the rename:** record the old hook's verdicts. Corpus = every command string the existing 209-line suite passes to `isDbResetCommand` (exported, `gsd-charlotte-lock.js:223-224`) or to the hook process, plus the six commands of `presets/igaming/canaries/canaries.jsonl:88-93`, plus 20 added probes (each built-in pattern of `:31-39` with a flag between its words, behind a path prefix, behind each `RUNNER` wrapper, inside `bash -c "…"`, and as quoted data in `echo` / `git commit -m`). Write `tests/fixtures/agnostic/ui-qa-lock-verdicts.json` as `[{ "command", "blocked" }]` from the old function. This file is the oracle.
- Reset detection: delete the five built-in patterns (`:31-39`). A configured literal is a token sequence. Split the command into segments with the existing `PREFIX` boundaries (`:27`: start, `; & | ( {`, backtick, `$(`, `then|do|else`, the quote after `-c`/`eval`, the `--` of a lock wrapper); a literal matches when its tokens occur in order anywhere in one segment, at any position (not only as the first word, so `cd x && <runner> task <literal>` and `<tool> --flag <literal>` match). A single-token literal that starts with `--` matches as a whole word anywhere, as `:36` does today. Literals are escaped: `.` matches only a dot.
- **Zero verdict changes:** with the fixture literals below, the new function returns the oracle's `blocked` for every row. A difference is fixed in the matcher or by adding a fixture literal; it is never listed as accepted. If two rows cannot both keep their verdict under the token-sequence rule, stop and report the two rows (a Fable ruling decides).
- Installer (`:1824-1845`): register `PreToolUse` with matchers `mcp__.*` and `Bash`, `SubagentStart` and `SubagentStop` with no matcher; the hook filters at run time. The stale-entry cleaner (`:1838`) removes entries whose command contains `gsd-charlotte-lock` or `gsd-ui-qa-lock`: the old name stays there as a literal so an upgrade removes the old registration. Allow-list that line (`bin/install.js` × `charlotte`, reason "stale-entry cleaner for the renamed hook") under the allow-list raise rule. For a local install (`!isGlobal`) whose project config has a `stack.capabilities` object without `ui_qa`: register nothing.
- The old name also stays, untouched, in `presets/igaming/canaries/canaries.jsonl:88-93` (verbatim snapshot) and in `gsd-protect-managed-files.test.js:86-115` (rows that prove hook files are protected by path; add the same four rows for the new file name, keep the old ones).
- Tests: UPDATE the existing 209-line suite to run with a fixture config whose literals reproduce the five old patterns (start from `db reset`, `db:reset`, `db-reset`, `supabase:reset`, `supabase-reset`, `--reset-db`, `preflight.sh`, `test:regression`; adjust until the oracle is met) and `lock_file: ".tmp/charlotte.lock"`.
</action>
<behavior>
- T1 process L-a: no capability → a reset command on Bash exits 0 and `SubagentStart` creates no lock file. ADD.
- T1 process L-b: capability + live lock → a configured literal is blocked (exit 2); an unlisted command passes. UPDATE existing rows.
- T1 process L-c: a tool with another prefix does not take the lock. ADD.
- T2 unit L-d: installer registers the four entries for a global install; none for a local install with a profile and no capability. UPDATE `install.test.js` registration tests.
- T1 unit L-e: for every row of `ui-qa-lock-verdicts.json`, the new function with the fixture literals returns the recorded `blocked`; the row count is asserted (no row removed). ADD.
- T2 unit L-f: an upgrade from settings that hold the old hook's four entries leaves none with the old name and four with the new. UPDATE `install.test.js:531-559`.
Mutants: m1 early exit removed → L-a; m2 `tool_prefix` ignored → L-c; m3 literals not escaped (`.` matches any char) → a row in L-b with `preflightXsh` must stay allowed; m4 match only at the first word of a segment → an L-e row with a flag before the literal; m5 segments not split (match across `;`) → an L-e probe `echo db; echo reset`.
</behavior>
<verify>Full gate; 5 mutants killed; lint baseline falls for the renamed file (`write-baseline`); the only `RISE allowed` row is the installer entry.</verify>
<done>The old file name remains only in: the installer cleaner line, `presets/igaming/canaries/canaries.jsonl:88-93`, `gsd-protect-managed-files.test.js`, `install.test.js` upgrade fixtures, the verdict fixture (`git grep -n gsd-charlotte-lock` output quoted in the summary).</done>
</task>

<task id="2.4" type="auto" tdd="true">
<name>Charlotte pack and `pack install` (E3)</name>
<files>agents/gsd-charlotte-qa.md → get-shit-done/presets/packs/charlotte/agents/ (git mv), packs/charlotte/preset.json, settings.fragment.json, README.md (new), get-shit-done/bin/project-pack.js (new, under 50 lines), gsd-tools.js dispatch (new `case 'pack'` after :15189), project-registry.test.js, bin/install.test.js, gsd-tools.test.js:15822-15826, 15866-15869, tests/phase-38/service-health.test.js:9</files>
<action>
- Pack `preset.json`: name `charlotte`, version `1`, one file (agent → `.claude/agents/gsd-charlotte-qa.md`, `render:false`), `settings_fragment` holding the 7 `mcp__charlotte__*` allow rules copied from `get-shit-done/presets/igaming/settings.fragment.json`. README: 10 lines, states that layering onto a base project is cutover work.
- `project-pack.js`: `installPack({ packsRoot, name, root })` copies each `agents/*.md` to `<root>/.claude/agents/` only if absent and returns `{ ok, copied, skipped, manual_settings }` (the fragment, for the owner to add by hand). Name must match `^[a-z0-9][a-z0-9-]*$`. CLI: `gsd-tools pack install <name> [--root <dir>]`.
- Fix `install.test.js` expectations that count or name the moved agent.
- Three tests read the agent at its old path: `gsd-tools.test.js:15824` and `:15868` (`readRepoFile(path.join('agents', …))` over a name list that includes the QA agent) and `tests/phase-38/service-health.test.js:9`. Point each at `get-shit-done/presets/packs/charlotte/agents/gsd-charlotte-qa.md`; assertions unchanged. Sweep for others: `git grep -n "gsd-charlotte-qa" -- '*.test.js' tests`.
- This is the one pack mechanism (index decision 5): the base preset never names the driver. igaming needs `gsd-tools pack install charlotte` at cutover (index section 4, item 2).
</action>
<behavior>
- T2 unit: `loadPreset` (`project-deploy-render.js:138`) accepts the pack directory. ADD.
- T2 CLI: `pack install charlotte --root <tmp>` copies the agent; a second run reports it as skipped and leaves an edited copy untouched. ADD.
- T2 CLI: `pack install ../x` → exit 1. ADD.
- T2: the three re-pointed tests pass with their assertions unchanged. UPDATE (path only).
</behavior>
<verify>Full gate, including `tests/phase-38/service-health.test.js` if it is outside `package.json:64` (run it directly and quote the result); lint falls by the 44 lines of the moved agent (`write-baseline`).</verify>
<done>`agents/` has 22 files; pack loads.</done>
</task>

<task id="2.5" type="auto" tdd="true">
<name>Demo: driver-neutral names (E3)</name>
<files>agents/gsd-demo.md (64 lines), get-shit-done/bin/demo-check.js (363 lines), get-shit-done/bin/demo-check.test.js</files>
<action>Replace the driver name in prose, comments and identifiers with "UI QA driver" / `uiQa`. Index file names (`demo-check.js:5`) come from `stack.capabilities.ui_qa.driver` as `.<driver>-screenshots.json` / `.<driver>-screencasts.json`; no capability → `build` exits with `no ui_qa capability`. Leave "CEO" lines for 6.5.</action>
<behavior>
- T2 unit: with driver `x`, `build` reads `.x-screenshots.json`. UPDATE the existing build test fixture.
- T2 unit: no capability → non-zero exit with the message. ADD.
</behavior>
<verify>Full gate; lint class `charlotte` = 0 in both files (`write-baseline`).</verify>
<done>Both files clean for that class.</done>
</task>

<task id="2.6" type="auto" tdd="true">
<name>Remove the :3000 fallbacks (G4)</name>
<files>references/service-health.md:38-76, references/coordinator-detail.md:930-940, 1116, 1286, workflows/execute-phase.md:428-436, presets/packs/charlotte/agents/gsd-charlotte-qa.md:36-50, 66-71, project-context.test.js</files>
<action>The service URL, health check and launch command come from `stack.services[]` (profile), then from the CLAUDE.md `## QA / Dev Server` section. When neither exists: stop and report `stack.services is not set`. Delete the Defaults table (`service-health.md:68-76`) and every literal default URL. Do not add a new default.</action>
<behavior>
- T2 unit: none of the four files contains `localhost:3000` or `:3000`. ADD (in `project-context.test.js`).
- T2 unit: `service-health.md` names `stack.services`. ADD.
</behavior>
<verify>Full gate; lint class `ports` falls (`write-baseline`).</verify>
<done>Zero hits.</done>
</task>

</tasks>

<verification>Full gate; lint check ok after each `write-baseline`; `ls ~/.gsd/projects.json` unchanged from before the plan.</verification>
<success_criteria>The four must-have truths hold by test; 18 mutants killed across 2.1-2.3.</success_criteria>
<output>`.planning/agnostic/M/M-02-SUMMARY.md`</output>
