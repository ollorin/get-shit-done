---
phase: agnostic-M
plan: 01
type: backend
wave: 1
depends_on: []
files_modified:
  - get-shit-done/bin/project-context.js
  - get-shit-done/bin/project-context.test.js
  - get-shit-done/bin/gsd-tools.js
  - get-shit-done/bin/gsd-tools.test.js
  - package.json
autonomous: true
e2e_flows: []
must_haves:
  truths:
    - "Every `gsd-tools init <workflow>` result carries brief_path, stack_profile_path and stack_commands"
    - "`init plan-phase` and `init execute-phase` exit 1 when the brief or profile is missing or the profile has a missing or invalid key, unless --legacy or GSD_LEGACY=1"
  artifacts:
    - get-shit-done/bin/project-context.js
    - get-shit-done/bin/project-context.test.js
---

<objective>
D1, D4, D6 as code. All new logic lives in one new module (target under 120 lines); `gsd-tools.js` gets wiring only.
New test file because `gsd-tools.test.js` is 18,246 lines. Tests spawn the CLI in a tmp project (copy `runGsdTools`/`createTempProject` from `gsd-tools.test.js:17-40`).
</objective>

<tasks>

<task id="1.1" type="auto" tdd="true">
<name>Context fields and preset list (D1, D4a)</name>
<files>get-shit-done/bin/project-context.js (new), project-context.test.js (new), gsd-tools.js:222-223, 11331-11416, 11418-11543, 11545-11595, package.json:64</files>
<action>
Create `project-context.js` exporting:
- `contextFields(cwd)` → `{ brief_path, stack_profile_path, brief_exists, stack_profile_exists, stack_commands, owner_title }`. Paths are `.planning/PRODUCT-BRIEF.md` / `.planning/STACK-PROFILE.md`, or null when the file is absent. `stack_commands` = `stack.commands` with `{root}` replaced by `cwd` (other placeholders untouched), null when absent. Read through `loadProfile` (`project-profile.js:157`); a broken config yields nulls, never a throw.
- `availablePresets(presetsRoot)` → sorted names of directories holding a `preset.json`; `packs` is excluded.
Wire: require next to `gsd-tools.js:222`; spread `...projectContext.contextFields(cwd)` into the result objects of `cmdInitExecutePhase`, `cmdInitPlanPhase`, `cmdInitNewProject`; the last also gets `available_presets` (root `path.join(__dirname, '..', 'presets')`). Add the test file to the `test` script.
</action>
<behavior>
- T2 CLI: `init new-project` in an empty tmp project → `brief_exists:false`, `stack_profile_exists:false`, `available_presets` contains `igaming`, not `packs`. ADD (new field).
- T2 CLI: with both files and `stack.commands.test_file = "cd {root}/api && run {file}"` → `init plan-phase 1` returns both paths and `stack_commands.test_file` starting with the tmp path and still containing `{file}`. ADD.
- T2 unit: invalid JSON config → all nulls/false. ADD.
</behavior>
<verify>Full gate green; lint check ok (the new module contains no denied term).</verify>
<done>3 tests pass; three init results carry the fields.</done>
</task>

<task id="1.2" type="auto" tdd="true">
<name>Remaining cmdInit* (D4b)</name>
<files>gsd-tools.js:11597-12100 (cmdInitNewMilestone, MilestoneBranch, Quick, Resume, VerifyWork, PhaseOp, Todos, MilestoneOp, MapCodebase, Progress, ExecuteRoadmap), project-context.test.js</files>
<action>Spread `...projectContext.contextFields(cwd)` into each result object. Locate each by `grep -n "^function cmdInit"`; read only that function. No other change.</action>
<behavior>
- T2 CLI, table-driven: for each `init` subcommand in the dispatch at `gsd-tools.js:14707-14760`, the JSON output has keys `brief_path`, `stack_profile_path`, `stack_commands`. ADD (one test, one row per subcommand; the row list is read from a literal array and compared with the count of `case` lines so a new subcommand cannot be missed).
</behavior>
<verify>Full gate green.</verify>
<done>Every init subcommand passes the table test.</done>
</task>

<task id="1.3" type="auto" tdd="true">
<name>Missing-brief gate with --legacy (D6) [critical path, mutation]</name>
<files>project-context.js, project-context.test.js, gsd-tools.js:14707-14716, gsd-tools.test.js:17-24</files>
<action>
`contextGate(cwd, { legacy })` → `{ ok, legacy, missing, invalid }`. `missing` lists `.planning/PRODUCT-BRIEF.md`, `.planning/STACK-PROFILE.md` when absent, plus the `missing` keys of `validateProfile` (`project-profile.js:201`); `invalid` is its `invalid` list (`{ key, reason }`, `:189-199`). `ok` = legacy, or nothing missing and nothing invalid: a profile with a malformed key must not pass the gate.
Dispatch: `legacy = args.includes('--legacy') || process.env.GSD_LEGACY === '1'`. For `plan-phase` and `execute-phase` only: when `!ok`, write `{"error":"project_context_missing","missing":[...],"invalid":[...],"hint":"run /gsd:init-project, or pass --legacy (unattended: export GSD_LEGACY=1)"}` to stdout and exit 1 before `cmdInit*` runs. Otherwise add `project_context: { legacy }` to the result.
Existing suite: add `GSD_LEGACY: '1'` to the default env of `runGsdTools` (`gsd-tools.test.js:17-24`), before `...extraEnv`. Find other callers with `git grep -n "init plan-phase\|init execute-phase" -- '*.test.js' scripts tests` and give them the same env.
The D6 tests do the opposite: they build their env from `process.env` with `GSD_LEGACY` deleted, then add only what the row names. An executor or a CI job that exports `GSD_LEGACY=1` must not turn D6-a, D6-b, D6-e or D6-f green or red by inheritance.
</action>
<behavior>
- T1 CLI D6-a: no brief, no profile, no escape → exit 1, `error` = `project_context_missing`, both files in `missing`. ADD.
- T1 CLI D6-b: brief present, profile absent → exit 1, only the profile in `missing`. ADD.
- T1 CLI D6-c: `--legacy` → exit 0, `project_context.legacy` true. ADD.
- T1 CLI D6-d: `GSD_LEGACY=1` → exit 0; `GSD_LEGACY=0` → exit 1. ADD.
- T1 CLI D6-e: both files + valid profile, no escape → exit 0, `legacy` false. ADD.
- T1 CLI D6-f: both files, all required keys present, one invalid key (`stack.gates: "x"`) → exit 1, the key in `invalid`, `missing` empty. ADD.
- T1 unit D6-g: with `GSD_LEGACY=1` set in the test process itself, the D6 env builder returns an env without the key. ADD.
- Regression: `init new-project` and `init progress` never gate (exit 0 with nothing present). ADD.
Mutants (each must fail the named test, then restore): m1 `ok` always true → D6-a; m2 only the brief checked → D6-b; m3 `--legacy` ignored → D6-c; m4 env compared loosely (any value) → D6-d; m5 `invalid` ignored → D6-f.
</behavior>
<verify>Full gate green (the 1979 existing tests run under GSD_LEGACY=1), run once with `GSD_LEGACY=1` exported and once without: same result; 5 mutants killed.</verify>
<done>8 tests pass; mutant table in the summary.</done>
</task>

</tasks>

<verification>Full gate; `node scripts/agnostic-lint.js check` ok.</verification>
<success_criteria>The two must-have truths hold by test.</success_criteria>
<output>`.planning/agnostic/M/M-01-SUMMARY.md`</output>
