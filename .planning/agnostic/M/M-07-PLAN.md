---
phase: agnostic-M
plan: 07
type: backend
wave: 9
depends_on: ["06"]
files_modified:
  - scripts/agnostic-lint/baseline.json
  - scripts/agnostic-lint/allowlist.json
  - scripts/agnostic-lint.test.js
  - get-shit-done/bin/preset-base.test.js
  - .planning/agnostic/M/M-PILOT-TRANSCRIPT.md
autonomous: true
e2e_flows: []
must_haves:
  truths:
    - "The lint baseline holds denied lines for the telegram class only"
    - "A new project created from `base` receives every transferable improvement by default: the full deployed-file list below, the default gates, the clean-code mandate and the style gate, with the `backend` and `web_ui` groups present unless the capability is `false`"
    - "In a new project the style gate fails on a planted throw, a planted mutation of an input and a planted duplicate block"
    - "Projects are created side by side in under a minute, with different ports, and nothing dispatched for them names the old QA driver, runtime or database"
    - "An auto-mode interview run produces a brief, a profile and recorded assumptions"
  artifacts:
    - .planning/agnostic/M/M-PILOT-TRANSCRIPT.md
    - get-shit-done/bin/preset-base.test.js
---

<objective>
Close the ratchet and run the pilot (H3). The pilot is a test in the suite, not a script: it stays green for every later change.
</objective>

<tasks>

<task id="7.1" type="auto" tdd="true">
<name>Final ratchet</name>
<files>scripts/agnostic-lint/baseline.json, allowlist.json, scripts/agnostic-lint.test.js</files>
<action>
Run `node scripts/agnostic-lint.js report`. Any denied line outside `telegram` is fixed now with the M-05 table. A generic list that must stay is allow-listed with a reason, under the allow-list raise rule of index section 1: `--allow-raise` only when `check` shows `RISE allowed` rows solely for the entries added in this task and no `RISE denied` row; quote both. Then `write-baseline`.
</action>
<behavior>
- T2 unit: every class key under `denied` in the committed `baseline.json` is `telegram`. ADD (in `scripts/agnostic-lint.test.js`, next to the existing baseline tests).
- T2 unit: every allowlist entry added since `0b9c35a` has a non-empty `reason`, and none has class `igaming`, `game`, `reg`, `money` or `abs`. REUSE the existing allowlist-shape test if it checks `reason`; else ADD.
</behavior>
<verify>Full gate; summary records denied before (869) and after, allowed before (338) and after with one line per entry added in M (file, class, max, reason, task).</verify>
<done>Denied = telegram only.</done>
</task>

<task id="7.2" type="auto" tdd="true">
<name>Pilot: three throwaway projects, full deployed-file list, default gates, style gate red on three planted defects</name>
<files>get-shit-done/bin/preset-base.test.js (new describe `pilot`)</files>
<action>
In one test, with `GSD_HOME=<tmp>` and three tmp git repos:
- `pilot-a`: `stack.capabilities: {}` (the wiring turns both groups on), `stack.style: { rule_set: "js-ts", roots: ["src"] }`, `stack.deploy.never_touch: ["tools/release.sh prod"]`.
- `pilot-b`: `stack.capabilities: { backend: {}, web_ui: false }`.
- `pilot-c`: `stack.capabilities: { backend: false, web_ui: false }`.
1. Minimal config in each: slug, owner title "Founder", `risk_domains: ["billing"]`, `ruling_topics: []`, `stack.preset: "base"`, `commands.test_file: "node --test {file}"`, `test_all`, `typecheck`, `lint` = `true`, the capabilities above, no default written by hand (no `stack.gates`; no `stack.style` in `pilot-b` and `pilot-c`), no `ui_qa`; a brief and a profile from the two templates.
2. Run `project init --preset base` in each; then `profile check`, `project diff --preset base` (the flag is passed; `stack.preset` is also set, either alone is enough: `project-deploy.js:152-153`), `init new-project`, `init plan-phase 1` (with a one-phase ROADMAP fixture), `init execute-phase 1`; the env has no `GSD_LEGACY`.
3. Collect the dispatch set: every `agents/*.md`, every file under `commands/`, `get-shit-done/workflows/`, `references/`, `templates/`; every file `init` wrote into the three projects; the JSON output of each command in step 2.

**Expected deployed files** (one literal array in the test; the same lists the 3.7 guard holds, asserted here end to end through the CLI). Paths are relative to the project root; `H` = `.claude/hooks`, `R` = `.claude/rules`, `V` = `scripts/validation`:
- Always (all three projects): `CLAUDE.md`; `.claude/settings.json`; `H/{redirect-recursive-search.sh, check-git-merge-target.sh, block-push-without-local-tests.sh, check-test-command.sh, check-flake-patterns.sh}`; `H/lib/{run-perl.sh, fail-closed.sh, ShellParse.pm, redirect-recursive-search.pl, check-git-merge-target.pl, block-push-without-local-tests.pl, check-test-command.pl, flake-gate.mjs}`; `V/hook-canaries/{run-canaries.sh, canaries.jsonl}`; `scripts/hooks-apply.sh`; `V/hook-patch-trailer-check.sh`; `R/{testing.md, shared-stack.md, guard-authoring.md, pre-pr-gates.md, module-structure.md, code-style.md}`; `docs/gsd/{agent-ops-lessons.md, engineering-lessons.md, defect-classes.md, host-ops.md, file-claims-template.md, session-supervisor.md, guard-estate.md, mutation-testing.md}`; `.planning/cleanup-keep.txt`; `scripts/{stack-lock.mjs, stack-lock.sh, session-supervisor.sh, pre-pr-gate.sh, log-pre-pr-disagreement.sh, ci-diagnose.mjs, style-gate.mjs, dependency-scan-gate.mjs, memory-guard.sh, container-disk-guard.sh, reap-stale.sh, findings-register.mjs}`; `scripts/style-gate/{scan.mjs, dup.mjs}` and `scripts/style-gate/rule-sets/{js-ts, python, generic}.json`; `scripts/mutate/{mutate, options, guards, worktree, restore, process, classify}.mjs`; `scripts/lib/reap-stale-test-processes.sh`; `scripts/lib/findings-register/{parse, owner, telemetry}.mjs`; `V/{canary-gate.mjs, guard-registry.mjs, guard-registry-reconcile.mjs, freshness-tracker.mjs, adr-reconcile.mjs}`; `V/guards/sample-guard.mjs`; `V/canaries/{sample-guard, style-gate}.canaries.mjs`; `.claude/skills/{finishing-a-development-branch, test-enforcement, create-unit-test, create-documentation}/`.
- Group `backend` (`pilot-a`, `pilot-b`; absent in `pilot-c`): `R/handler-correctness.md`, `R/data-integrity.md`, `.claude/skills/vibe-security/SKILL.md`.
- Group `web_ui` (`pilot-a` only): `R/e2e-assertions.md`, `R/frontend-testability.md`, `R/qa-exemptions.md`, `V/check-assertion-quality.mjs`.
If a task of M-03, M-08 or M-09 named a dest differently, the task's summary is the source and this list follows it; a file missing from the list is a finding against this task, not a reason to shorten the list.
</action>
<behavior>
- T1: all three inits exit 0; total wall time for step 2 under 60 s. ADD.
- T1: the dests in the `files` report of `init` (and on disk) equal the expected list for that project, exactly (no missing, no extra); the three `backend` files are in `pilot-a` and `pilot-b` only, the four `web_ui` files in `pilot-a` only. ADD.
- T1: the rendered CLAUDE.md of `pilot-a` contains the headings of the tiering table, the review loop, the orchestration hard rules, path-trace, token discipline, and clean code and functional style (literal array shared with the 3.1 test); the deployed `code-style.md` holds the 8-item review checklist. ADD.
- T1 default gates: after `init`, `stack.gates` of `pilot-a` holds the nine default ids of 9.13, among them `hook-canaries`, `hook-patch-trailer` and `style`; `pilot-b` and `pilot-c` hold eight (no `assertion-quality`) and `stack.style.rule_set: "generic"` written by the wiring. ADD.
- T1 deny rows and hooks: the deployed settings of `pilot-a` deny `Bash(tools/release.sh prod:*)`; `pilot-b` holds five inert slot rows; all three hold the 19 fixed deny rows and the 3 ask rows and register five hooks (four on `Bash`, one on `Write|Edit`). ADD.
- T1 style gate, in `pilot-a` after one commit of the deployed tree plus a clean `src/` module: `node scripts/style-gate.mjs` exits 0. Then, each planted alone and removed again: (1) a `throw` in `src/` → exit 1 naming `throws`; (2) a function that pushes onto its own parameter → exit 1 naming `inputMutation`; (3) a 15-line block copied into a second file → exit 1 naming `duplicateBlocks`. After each removal → exit 0. In `pilot-c` (`generic`) defect (3) → exit 1. ADD.
- T1 default config: in each of `pilot-a`, `pilot-b` and `pilot-c` immediately after `init` and one commit of the deployed tree, with no project source file, `node scripts/style-gate.mjs` exits 0 (`pilot-b`, `pilot-c` run the default `{ rule_set: "generic", roots: ["."] }` the wiring wrote; the deployed scripts, hooks and docs are excluded through the manifest, 9.2); then a 501-line `src/big.js` → exit 1 naming `oversizeFiles` in `pilot-c`. ADD.
- T1 gate and push: in `pilot-a` (one commit made) the deployed canary runner exits 0; `scripts/pre-pr-gate.sh` exits 0 and its output names every default gate id as run; the marker is inside the git dir and `git status --porcelain` is empty; the deployed push hook then allows a push. With defect (1) planted the gate script exits non-zero and writes no marker. ADD.
- T1: the three projects have three different `port_base` values; each `container_suffix` equals its slug; `.gitignore` holds the four engine lines. ADD.
- T1: `project diff --preset base` exits 0 in all three (nothing left to deploy); a fourth repo that already holds a different `R/testing.md` gets exit 2, a `conflict` row for that file, and its bytes unchanged. ADD.
- T1: `init plan-phase 1` exits 0 without `--legacy`, `risk_domains` = `auth`, `security`, `billing`, source `brief`. ADD.
- T1: in the dispatch set, zero lines match `/charlotte|\bdeno\b|supabase/i` outside the lines `scripts/agnostic-lint/allowlist.json` permits (core files) and the triples of `tests/fixtures/agnostic/base-deployed-exceptions.json` (deployed files: the same file the 3.7 guard reads, no second list here); in the command outputs zero lines match, with no exception. ADD.
- T1: a phase with a touched `.tsx` file and no QA evidence passes `verify phase-gate` in `pilot-a` (capabilities object, no `ui_qa`). REUSE 2.2 E-a if the fixture builder cannot be shared across files; state which in the summary.
</behavior>
<verify>Full gate.</verify>
<done>Pilot test green; the summary quotes the measured wall time, the deployed file and line counts per project, and the count of excepted lines in the dispatch set.</done>
</task>

<task id="7.3" type="auto" tdd="true">
<name>Interview dry-run transcript [Sonnet]</name>
<files>.planning/agnostic/M/M-PILOT-TRANSCRIPT.md (under 120 lines)</files>
<action>
In `.tmp/pilot-interview/` (tmp git repo, `GSD_HOME=.tmp/pilot-interview-home`), follow `workflows/new-project.md` steps 1, 4.5 and 5.6 in auto mode against a 15-line idea document for a non-web CLI tool with a Python test command; use the worktree's `gsd-tools.js`, never the installed one. Do not run research, requirements or roadmap steps. Record: each question the step would ask and where the answer came from (idea document, detection, assumption); the capability values written (expected: `web_ui: false` with an assumption record, `backend` on because the document does not rule it out); the style rule set written (expected `python`, with no question whether the gate runs) and the Style section of the profile; the `never_touch` answer and the deny rows `init` rendered from it; the default gates the wiring wrote; each command run with exit code; the files written, with the gated groups present and absent; the `A-` records created and their reversibility; wall time; every point where the workflow text was unclear or wrong. Fix unclear workflow text in `new-project.md` in the same task (under 15 changed lines) and note it.
</action>
<behavior>
- T2: the transcript's final state is checked by commands, quoted in it: `profile check` exit 0; `init plan-phase 1 ` gate result; `project diff --preset base` exit code; `decisions list` shows the assumptions, the `risk_domains` and `never_touch` ones as `costly`; `node scripts/style-gate.mjs` exit code in the new project. ADD + reason: this is a recorded run, not a suite test; the suite coverage is 7.2.
</behavior>
<verify>The transcript exists; `.tmp/pilot-interview*` deleted; `~/.gsd` and `~/.claude` untouched (`ls -la` timestamps quoted before and after).</verify>
<done>Transcript committed with `git add -f`.</done>
</task>

</tasks>

<verification>Full gate twice; `node scripts/agnostic-lint.js check` ok.</verification>
<success_criteria>The five must-have truths. Then the batched Fable diff review and the phase-end verifier named in the index.</success_criteria>
<output>`.planning/agnostic/M/M-07-SUMMARY.md`</output>
