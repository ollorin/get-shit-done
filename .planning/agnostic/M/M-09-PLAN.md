---
phase: agnostic-M
plan: 09
type: backend
wave: 5
depends_on: ["03", "08"]
files_modified:
  - get-shit-done/presets/base/**
  - get-shit-done/bin/preset-base.test.js
  - get-shit-done/bin/preset-base-scripts.test.js
  - get-shit-done/bin/preset-base-style.test.js
  - get-shit-done/bin/preset-base-mutate.test.js
  - get-shit-done/bin/project-registry.js
  - get-shit-done/bin/project-registry.test.js
  - tests/fixtures/agnostic/base-deployed-exceptions.json
  - tests/fixtures/agnostic/findings-register/**
  - package.json
autonomous: true
e2e_flows: []
must_haves:
  truths:
    - "Every new project gets the clean-code and functional-style rule, its review checklist and a style gate that is on by default; the interview chooses the rule set, never whether"
    - "The style gate fails on a new thrown exception, a new mutation of an input, a new duplicated block and a new oversize file, and passes on the same tree without them"
    - "The mutation tool, the dependency gate, the host guards and the remaining K:157 scripts run on Node or POSIX shell alone and take their project facts from the profile"
    - "A new project's `stack.gates[]` holds the default gate list without anyone writing it by hand"
  artifacts:
    - get-shit-done/presets/base/scripts/style-gate.mjs
    - get-shit-done/presets/base/rules/code-style.md
    - get-shit-done/presets/base/scripts/mutate/mutate.mjs
    - get-shit-done/bin/preset-base-style.test.js
---

<objective>
Owner ruling: "all improvements" means every transferable igaming improvement deploys by default. This plan carries what the first re-plan left in igaming (K:94 is in 3.11; here K:151, 155, 156, 157) and the clean-code mandate. Runs after M-08, before the interview. The rules of M-08's objective apply (dests, `render: false` scripts, the 3.7 guard lists, no hook, no settings entry, nothing macOS-only). Sources are read-only under `~/igaming-platform/scripts/`.

Two new test files, both registered in `package.json:64`: `preset-base-style.test.js` (9.2, 9.3) and `preset-base-mutate.test.js` (9.4-9.6); `preset-base-scripts.test.js` would pass 1,500 lines with them. Other script tests go to `preset-base-scripts.test.js`.

Every script reads its project facts from `.planning/config.json` at run time (one `JSON.parse`; unreadable or non-JSON config is a failure, never a default).
</objective>

<tasks>

<task id="9.1" type="auto" tdd="true">
<name>Rule code-style.md: clean code, DRY, functional style + review checklist</name>
<files>presets/base/rules/code-style.md, preset.json, preset-base.test.js</files>
<action>
Sources: `presets/igaming/rules/fp.md` (76 lines) and `module-structure.md` (deployed by 8.6; referenced, not repeated). Written language-agnostically; no library and no language is named in the rule text. Sections:
1. Errors are values: a function that can fail returns a result type; no exception crosses a module boundary; an edge file (a framework callback, a process entry) may catch and convert, tagged `style-gate:edge <reason>`.
2. Immutability: an input or shared value is never changed in place; build a new value.
3. Routing and dispatch by a match expression or a lookup table, not an if/else chain.
4. Pure domain and application logic; side effects at the edges; no async result dropped (`fp.md:19`).
5. Small single-purpose modules: the size and cohesion rule of `.claude/rules/module-structure.md`.
6. DRY: no duplicated logic; a second copy is extracted before the third appears; the gate reports duplicated blocks.
7. "Idioms for this stack": one line pointing at `.planning/STACK-PROFILE.md`, section Style (the interview fills it from the chosen rule set's `idioms`, 9.2, 4.2).
8. **Review checklist** (every review round, per the base CLAUDE.md review loop): 8 yes/no questions, one per section above plus "is every name self-explanatory without its comment" and "does each new function do one thing"; each "no" is a finding with file:line.
9. Enforcement: `scripts/style-gate.mjs`, the ratchet rule (a count may only fall), how to tag an edge, how a brownfield project seeds its baseline once.
Dest `.claude/rules/code-style.md`, no capability.
</action>
<behavior>
- T1: deployed in all three configurations of the 3.7 guard; term check green. UPDATE the 3.7 lists.
- T2 unit: the rule has the nine headings (literal array) and 8 checklist items; it matches none of `neverthrow`, `ts-pattern`, `TypeScript`, `Python`. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Line count recorded.</done>
</task>

<task id="9.2" type="auto" tdd="true">
<name>Style gate: parameterised redesign of fp-gate with the oversize ratchet [critical path, mutation, Sonnet implements]</name>
<files>presets/base/scripts/style-gate.mjs, scripts/style-gate/scan.mjs, scripts/style-gate/rule-sets/{js-ts,python,generic}.json, scripts/validation/guard-registry.mjs, scripts/validation/canaries/style-gate.canaries.mjs, docs/guard-estate.md, preset.json, preset-base-style.test.js (new), package.json:64</files>
<action>
Source `fp-gate.ts` (761 lines), `fp-gate-config.json` (32), `fp-gate.test.ts` (case names first), `validation/canaries/fp-gate.canaries.ts` (shape only). The transferable part (K:155) is the per-directory violation ratchet with a baseline; the rules are per language. Redesign as a template every project runs:
- **Config** `stack.style` (3.1): `rule_set` (a file name under `rule-sets/`), `roots`, optional `exclude_globs` (default: test files, `node_modules`, `dist`, build output), and always, whatever `exclude_globs` says, every `dest` listed in `files` of `.planning/gsd-project-manifest.json` (the deployed GSD files: the deployed scripts, hooks, rules and docs are not project code; an absent manifest excludes nothing; an unreadable one is a failure), `edge_globs`, `max_file_lines` (default 500, `fp-gate-config.json:3`), `dup_min_lines`. The wiring (9.13) writes `{ rule_set: "generic", roots: ["."] }` when the key is absent, so the gate always has a config.
- **Rule set file**: `{ extensions, idioms: { errors, immutability, routing, purity }, regex_rules: [{ id, pattern, message }], structural: [ids], router_branch_threshold }`. A rule set adds rules; it cannot switch off `oversizeFiles` or `duplicateBlocks`, which run for every set.
  - `generic`: no language rules; `extensions` = `.js .mjs .cjs .ts .tsx .jsx .py .go .rs .java .rb .sh .pl` (source files only: no `.md`, `.json`, `.jsonl`, `.txt`), so the default config `{ rule_set: "generic", roots: ["."] }` scans a project's code and nothing else. `js-ts`: `throws` (`throw` and `try {`, source `countThrows`, `:217-230`), `fireAndForget` (`:255`), `ifElseRouters` (`:394`, threshold 4), `inputMutation` (new, below); idioms name a result-type library and a pattern-matching library. `python`: regex rules only (`raise` outside edges, a mutable default argument, a `global` statement).
  - Not carried: `rawFromPromise`, `bareBodyRead`, `anyBodyRead` and `pathCeilings` (`:272-338`, `:536`): one project's library and HTTP conventions.
- **Scan**: every extraction reads a comment-stripped view first (one stripper in `scan.mjs`; source `:189`). An edge is a file matching `edge_globs` or holding the tag `style-gate:edge <reason>`, read from the raw text (source `isAdapterEdge`, `:195-202`: a whole-file exemption by glob or tag). One tightening against the source, which accepts a bare tag: a tag without a reason does not exempt (same rule as the flake ignore, 3.11).
- **`inputMutation`** (structural, js-ts): for each function header, the plain identifier parameters (`name`, `name = default`; destructured and rest patterns are skipped); inside that function's brace-matched body, a violation is `name.x =`, `name[…] =`, a compound assignment or `++`/`--` on a member of `name`, `delete name.x`, `Object.assign(name, …)`, or `name.<push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|delete|clear>(`. The innermost function owning the name wins. The method list also matches non-mutating methods of other types (a `Map`-like `.set(`, a query builder's `.delete(`), so a legitimate line carries the per-line escape `style-gate:ignore <reason>` on the same or the previous line, read from the raw text; an escape without a reason does not exempt (same rule as the edge tag). The escape applies to line-level rules (`inputMutation` and the regex rules), never to `oversizeFiles` or `duplicateBlocks`. Stated limits in the file header: aliases and destructured parameters are not chased; the function body is found by brace matching on the comment-stripped view, which also counts braces inside string, template and regular-expression literals, so a body holding an unbalanced brace in a literal is mis-bounded.
- **`oversizeFiles`**: a file over `max_file_lines` (source `:340`).
- **Ratchet**: counts per (top directory under a root, rule), compared with `.planning/style-baseline.json`. No baseline file means every count is 0. A count above its baseline → exit 1, printing each site as `file:line [rule] message`. A count below → a `STALE` line; `--write-baseline` lowers the baseline and refuses to raise it. `--seed-baseline` writes the measured counts once and refuses when a baseline exists (brownfield adoption, an owner action named in 9.1). No warn mode (the source's `RuleModes`, `:77`, is dropped: every rule blocks).
- **Canaries**: registry entry `style-gate` (8.8 contract) with at least 3 bad fixtures per rule of `js-ts` plus `oversizeFiles`; the doc table row is added so 8.9 stays green.
`style-gate.mjs` is `guarded: true`. Under 500 lines per file.
</action>
<behavior>
- T1 process S-a: a tmp project with `rule_set: "js-ts"` and clean sources → exit 0. ADD.
- T1 process S-b: one added `throw` in a domain file → exit 1 naming file, line and `throws`; the same `throw` inside a comment, inside a string, in an `edge_globs` file, or in a file tagged with a reason → exit 0; in a file tagged without a reason → exit 1. ADD.
- T1 process S-c: a function that does `items.push(x)` on its parameter, and one that assigns `input.total = 1` → exit 1 with `inputMutation`; the same calls on a local copy (`const next = [...items]; next.push(x)`) → exit 0; `param.set(k, v)` with `style-gate:ignore <reason>` on the line → exit 0, with the escape and no reason → exit 1. ADD.
- T1 process S-d: a file of `max_file_lines + 1` lines → exit 1 with `oversizeFiles`, under every rule set incl. `generic`. ADD.
- T1 process S-e: a seeded baseline with 2 throws: a third → exit 1; two → exit 0; one → exit 0 with a `STALE` line; `--write-baseline` then holds 1 and a later second throw fails; `--write-baseline` never raises; `--seed-baseline` refuses when a baseline exists. ADD.
- T1 process S-f: unreadable config, unknown `rule_set`, a rule-set pattern that is not a valid regular expression → exit 1 naming the cause (never a pass). ADD.
- T2 unit S-g: the `python` set flags `raise` in a domain file and a mutable default argument. ADD.
- T1 process S-h: the deployed canary gate (8.8) and reconcile (8.9) exit 0 with the `style-gate` entry; removing one fixture of a rule fails the canary gate. ADD.
- T1 process S-i: a fresh project after `project init --preset base` with the default config the wiring wrote (`{ rule_set: "generic", roots: ["."] }`), one commit, no project source → `node scripts/style-gate.mjs` exits 0 (the deployed tree is excluded through the manifest); a source file of `max_file_lines + 1` lines added → exit 1; an over-size file whose path is a manifest dest → exit 0. ADD.
Mutants: m1 ratchet comparison never exceeds → S-b; m2 comment stripping skipped → S-b; m3 a tag without a reason exempts → S-b; m4 a missing baseline is seeded on the first run → S-b; m5 `--write-baseline` may raise → S-e; m6 parameter collection returns nothing → S-c; m7 an unknown rule set falls back to `generic` → S-f; m8 the manifest exclusion removed → S-i; m9 a line escape without a reason exempts → S-c.
</behavior>
<verify>Full gate; Sonnet rounds to zero. Must-confirm item of the batched Fable diff review.</verify>
<done>9 tests pass; 9 mutants killed, one line each; carried and dropped source rules listed.</done>
</task>

<task id="9.3" type="auto" tdd="true">
<name>Duplicate-block detector, dependency-free, as the gate's rule duplicateBlocks [critical path, mutation]</name>
<files>presets/base/scripts/style-gate/dup.mjs, scripts/style-gate.mjs (one call), canaries/style-gate.canaries.mjs, preset.json, preset-base-style.test.js</files>
<action>
Plan-time decision: a line-window detector is small enough to ship without a dependency (estimate 90 lines: normalise 15, window hashing 25, merge of overlapping windows 25, report 15), so the gate never shells out to an `npx` tool and has no fail-soft path. Ceiling: if `dup.mjs` cannot be done in 150 lines, stop and report; a Fable ruling then decides between a larger file and the `npx` route.
- Input: the files the style gate scans (same roots, excludes, extensions).
- Normalise each file: comment-stripped (the `scan.mjs` stripper), whitespace collapsed, blank lines and lines of only brackets or punctuation dropped, original line numbers kept.
- A window is `dup_min_lines` (default 12) consecutive normalised lines holding at least 200 non-space characters. Each window's text is the key of a `Map` to its first location; a second occurrence that does not overlap the first is a duplicate. Adjacent duplicate windows are merged into one block.
- Report: `fileB:line duplicates fileA:line (N lines)`. Counted as `duplicateBlocks` for the directory of the later occurrence and ratcheted like every other rule.
- 3 bad fixtures added to the `style-gate` corpus.
</action>
<behavior>
- T1 process D-a: a 15-line block pasted into a second file → exit 1 with `duplicateBlocks` naming both locations; the same block pasted twice in one file → exit 1. ADD.
- T1 process D-b: the pasted copy re-indented and with comments added → still exit 1; an 11-line copy → exit 0; 12 lines of closing brackets → exit 0. ADD.
- T2 unit D-c: 40 identical lines pasted once yield one block, not 29. ADD.
- T2 unit D-d: `dup.mjs` has at most 150 lines and no import outside `node:` and `./scan.mjs`. ADD.
Mutants: m1 the second occurrence is not recorded → D-a; m2 normalisation skipped → D-b.
</behavior>
<verify>Full gate; Sonnet rounds to zero with 9.2.</verify>
<done>4 tests pass; 2 mutants killed; line count of `dup.mjs` recorded.</done>
</task>

<task id="9.4" type="auto" tdd="true">
<name>Mutation tool, safety half: options, guards, worktree, restore (K:151) [critical path]</name>
<files>presets/base/scripts/mutate/{options.mjs, guards.mjs, worktree.mjs, restore.mjs}, preset.json, preset-base-mutate.test.js (new), package.json:64</files>
<action>
Source `scripts/gsd-mutate/` (15 files; `README.md` first, then `options.ts` 96, `guards.ts` 144, `worktree.ts` 71, and from `safety_cases.ts` 417, `parse_cases.ts` 153 and `signal-fixture.ts` the case names, then the cases ported). The tool edits the target file in place, so its refusals and its restore are the boundary. `restore.mjs` takes `restoreFile`, `withActiveMutation` and `installSignalRestore` out of the source `process.ts:28, 183, 208` (9.5 ports the rest of that file), so the restore guarantee is built and proven here, at function level, before any CLI exists. Port with the runtime calls replaced; behaviour unchanged:
- Flags and exit codes as the README: 0 ok; 1 canary mismatch, inconclusive mutant or red after the run; 2 aborted before mutating; 3 restore failed; 4 internal. Unknown flags and stray positionals abort with 2.
- Refusals (exit 2, nothing edited): the primary worktree without `--allow-primary`; a leftover `<out>.restore/`; a dirty, untracked or ignored target; a target outside `--root`. `--dry-run` never edits.
- Restore (`restore.mjs`): `restoreFile(path, original, sha)` rewrites the original and fails with a restore error when the hash after the write differs; `withActiveMutation` records the active mutation for the duration of a callback and clears it on every exit path; `installSignalRestore()` restores every active mutation on `SIGINT`/`SIGTERM` and returns a disposer.
- Dropped: `--test-flag` and its allow/deny list (a runner-specific flag list; the command is the profile's, 9.5); the `apps/`/`libs/` path rule (K:151).
- The CLI does not exist until 9.6, so this task's tests call the exported functions in-process or through a tiny fixture script under `tests/fixtures/agnostic/mutate/` (the port of `signal-fixture.ts`); every test that needs the `mutate.mjs` command line (the exit-2 refusals as processes, SIGTERM through the CLI) is in 9.6.
</action>
<behavior>
- T2 unit: each refusal of `guards.mjs` (primary worktree, leftover `<out>.restore/`, dirty, untracked or ignored target, target outside `--root`) returns its refusal value and the target's bytes are unchanged (port of the source safety cases; cite the lines). ADD.
- T2 unit: `restoreFile` writes the original back and raises on a hash mismatch (port of `classify_cases.ts:222-245`); `withActiveMutation` clears the active record when the callback throws. ADD.
- T1 process: a fixture script that mutates a tmp file, installs `installSignalRestore()`, and waits; `SIGTERM` to it leaves the file byte-equal to the original (port of `signal-fixture.ts`). ADD.
- T2 unit: option parsing cases (port of `parse_cases.ts`), minus the dropped flag. ADD.
Mutants: m1 `restoreFile` skips the hash comparison → the `restoreFile` mismatch test; m2 `installSignalRestore` registers no handler → the SIGTERM fixture test.
</behavior>
<verify>Full gate; Sonnet rounds to zero. Must-confirm item of the batched Fable diff review.</verify>
<done>Ported case names listed; dropped cases listed with the reason.</done>
</task>

<task id="9.5" type="auto" tdd="true">
<name>Mutation tool, runner seam redesign: profile test command, exit-code verdict [critical path, Sonnet implements]</name>
<files>presets/base/scripts/mutate/{process.mjs, classify.mjs}, preset-base-mutate.test.js</files>
<action>
Source `process.ts` (245; without the three restore functions taken by 9.4), `classify.ts` (276), cases `classify_cases.ts` (442), `run_cases.ts` (211). The source runs one runtime's test command and parses that runtime's summary text to tell a kill from a broken mutant (K:151: "the stack seam"). Redesign of the seam only:
- Test command: `stack.commands.test_file` with `{file}` replaced by the mutant's test file, or `--test-cmd "<command with {file}>"`; run through `sh -c` in its own process group (`spawn` with `detached: true`), killed as a group on timeout. `--test-env KEY=VALUE` kept.
- Verdict from the exit status: 0 → `survived`; non-zero → `killed`; timeout → `timeout` (inconclusive, neither kill nor survivor); spawn failure → `errored`. If `stack.mutation.error_pattern` or `--error-pattern <regex>` is set and the output matches, a non-zero exit is `errored` (a mutant that does not compile is not a kill). Without a pattern the summary prints `no error pattern: a mutant that fails to build counts as killed`.
- Kept from the source: the unmutated baseline must be green before the first mutant and after the last (`red baseline` → exit 2, red after the run → exit 1); the canary mutant check; one JSONL line per mutant.
- Dropped: the summary parser of the source runtime and the cases that test only it (list them).
</action>
<behavior>
- T1 process: a fixture project with `test_file: "node --test {file}"`: a mutant its test catches → `killed`; a mutant no test catches → `survived`; exit code per the README. ADD.
- T1 process: a mutant that makes the test hang → `timeout`, the whole process group is gone afterwards, exit 1. ADD.
- T1 process: with `--error-pattern SyntaxError`, a syntactically broken mutant → `errored`; without the flag → `killed` plus the printed notice. ADD.
- T1 process: a red baseline → exit 2 before any edit. ADD.
- T2 unit: the classification cases of the source that do not depend on the dropped parser (port; cite the lines). ADD.
</behavior>
<verify>Full gate; Sonnet rounds to zero (a survivor reported as killed is a false proof).</verify>
<done>Ported and dropped case names listed.</done>
</task>

<task id="9.6" type="auto" tdd="true">
<name>Mutation tool: CLI, document, profile key [critical path]</name>
<files>presets/base/scripts/mutate/mutate.mjs, docs/mutation-testing.md, preset.json, preset-base-mutate.test.js, project-profile.js (`mutation` key), project-profile.test.js</files>
<action>
Source `gsd-mutate.ts` (461), `gsd-mutate.test.ts` (426, case names first), `README.md`. Port the main loop over 9.4 and 9.5. `docs/mutation-testing.md` (dest `docs/gsd/`) from the README with the command line `node scripts/mutate/mutate.mjs --mutants .tmp/m.json --root .tmp/wt-<name>` and the mutant file format. Profile loader: `stack.mutation` (`{ error_pattern?: string }`). Dests `scripts/mutate/*.mjs`.
</action>
<behavior>
- T1 process (moved here from 9.4: they need the command line): each refusal of `mutate.mjs` → exit 2 and the target's bytes unchanged (the primary worktree without `--allow-primary`, a leftover `<out>.restore/`, a dirty, untracked or ignored target, a target outside `--root`, an unknown flag or stray positional); `--dry-run` never edits. ADD (port of the source safety cases; cite the lines).
- T1 process: `SIGTERM` to a running `mutate.mjs` between mutate and restore → the target is byte-equal to its original; a second run over a leftover restore directory refuses with exit 2. ADD (port).
- T1 process: end to end in a linked worktree of a tmp repo: two mutants (one killed, one survived) → the JSONL has two lines, exit code per the README, the target byte-equal to its original. ADD.
- T1: deployed in all configurations; term check green. UPDATE the 3.7 lists.
- T2 unit: `profile check` accepts `stack.mutation.error_pattern` and rejects a non-string. ADD.
</behavior>
<verify>Full gate; Sonnet rounds to zero (first task where the safety half and the verdict half meet in a process). Must-confirm item of the batched Fable diff review.</verify>
<done>Ported case names listed; file line counts recorded.</done>
</task>

<task id="9.7" type="auto" tdd="true">
<name>Dependency-vulnerability gate, Node port with a lockfile parameter (K:157)</name>
<files>presets/base/scripts/dependency-scan-gate.mjs, preset.json, preset-base-scripts.test.js</files>
<action>
Source `cve-scan-gate.ts` (555 lines) and `cve-scan-gate.test.ts` (case names first; the source name stays in this sentence only). The deployed script is `dependency-scan-gate.mjs`: `cve-scan-gate` is a term of the `gates` class in `scripts/agnostic-lint/terms.json` (and `agnostic-lint.js:17` scopes `bin`, so a script of that name or text naming it would be a denied hit), so the name appears in no deployed file, doc, gate table, test fixture or pilot list. Kept (ported): the pure evaluation over the scanner's JSON output (`normalizeSeverity`, `meetsFloor`, the flattening at `:152`, parse-or-fail at `:254`), the severity floor, the accepted-findings baseline (dest name `.planning/cve-baseline.json`, absent means empty). Changed:
- Lockfiles: `stack.cve.lockfiles`, or when unset every tracked file named `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `requirements.txt`, `go.mod`, `Cargo.lock`, `Gemfile.lock`. None found → `no lockfile, nothing to scan`, exit 0.
- Scanner: `osv-scanner`, one call per lockfile. **Prerequisite**: the tool is an external binary that GSD does not install; the interview (4.2) tells the owner so when a lockfile is detected. The command syntax is unverified: v1 is `osv-scanner --format json -L <lockfile>`, v2 is `osv-scanner scan source -L <lockfile> --format json`. First step of the task: if `osv-scanner` is installed on the executor's machine, run `osv-scanner --help` and record which form it accepts; if it is not installed, say so in the summary and rely on the tolerant adapter. The adapter is version-tolerant: a pure `scannerArgs(helpText, lockfile)` picks the v2 form when the help text lists a `scan` subcommand and the v1 form otherwise, the help text being read once from `osv-scanner --help`.
- Scanner absent, explicit degrade: a lockfile exists and the scanner is not installed → exit 1 with `NOT INSTALLED: osv-scanner`, the install line, and the one documented way out: `stack.cve.allow_missing_scanner: true` (3.1) turns that case into `SKIPPED: osv-scanner not installed (stack.cve.allow_missing_scanner)` on stdout and exit 0. The key is never set by default; the interview records it as an assumption when the owner declines the install. With a scanner present the key changes nothing.
- Dropped: the branch that queries the vulnerability API for one runtime's lock format (`:20-36`).
</action>
<behavior>
- T2 unit: the evaluation cases of the source test on its in-memory fixtures (port; no network, no binary). ADD.
- T1 process: no lockfile → exit 0 with the line above; a lockfile and an empty `PATH` → exit 1 naming the scanner; the same with `allow_missing_scanner: true` → exit 0 with the `SKIPPED` line; a stub `osv-scanner` on `PATH` printing a HIGH finding → exit 1 naming the package; the same finding listed in the baseline → exit 0; a stub printing non-JSON → exit 1; a stub whose `--help` lists `scan` receives the v2 argument vector, one whose help does not receives the v1 vector (the stub writes its argv to a file). ADD.
- T2 unit: `scannerArgs` on the two help-text shapes. ADD.
Mutants (fail-open paths, must-confirm in the Fable batched review): m1 a missing scanner exits 0 without the key → the empty-`PATH` test; m2 non-JSON scanner output ignored → the non-JSON test; m3 the baseline match widened to any package name → the baseline test.
</behavior>
<verify>Full gate.</verify>
<done>Ported case names listed.</done>
</task>

<task id="9.8" type="auto" tdd="true">
<name>Host guards: memory and container-disk report scripts (K:156)</name>
<files>presets/base/scripts/memory-guard.sh, scripts/container-disk-guard.sh, preset.json, preset-base-scripts.test.js</files>
<action>
Sources `memory-guard.sh` (377 lines), `docker-disk-guard.sh` (231). Shell already; no port. Report-first: nothing is killed or removed without `--live` and the double confirmation (kept as is).
- Read each source's platform calls first. `memory-guard.sh:98-111` reads memory with `sysctl` and `vm_stat` (macOS only): add a Linux branch reading `/proc/meminfo`; any other platform prints `UNSUPPORTED PLATFORM: <uname>` and exits 0 in report mode, 1 with `--live`.
- The container-runtime advice blocks (`memory-guard.sh:121-132`, `docker-disk-guard.sh:222-229`) run only when that runtime's CLI exists (`command -v`, as now); their product name goes on the shared exception list as a generic tool name, or the block is reworded to "the container runtime".
- The project-term lines (5 and 2) and the stale-process name patterns become `stack.host.protected_patterns` (processes never listed as stale) read once from the config.
`host-ops.md` (8.1) names both scripts. Dests `scripts/`.
</action>
<behavior>
- T1 process: each script with no flag exits 0, prints its report and changes nothing (a sentinel background process started by the test is still alive). ADD.
- T1 process: `--live` with stdin not a terminal → refuses, sentinel alive. ADD.
- T1: deployed in all configurations; term check green. UPDATE the 3.7 lists.
</behavior>
<verify>Full gate (macOS locally, Linux in CI).</verify>
<done>Changed lines listed per script.</done>
</task>

<task id="9.9" type="auto" tdd="true">
<name>Stale test-process reaper with profile worker patterns (K:156) [critical path, Sonnet implements]</name>
<files>presets/base/scripts/lib/reap-stale-test-processes.sh, scripts/reap-stale.sh, preset.json, preset-base-scripts.test.js</files>
<action>
Source `scripts/lib/reap-stale-test-processes.sh` (558 lines, sourced, never executed) and `scripts/reap-stale-test-processes.test.ts` (case names and its process-snapshot seam first). It kills automatically, so its fail-safe direction is the boundary: a candidate is reaped only when the one-snapshot ownership walk proves no live owner; anything unrecognised, a cycle, a depth cap or a vanished ancestor makes it protected (source header, first 30 lines). Keep that logic byte-for-byte where it names no project. Tier: Sonnet implements the whole task (a kill-capable library with a platform read cannot be split between a Haiku library port and a Haiku test port without the second agent weakening the fail-safe cases).
- **Platform read** (as 9.8 does for memory): the library reads `ps` with BSD keywords (`-Awwo pid=,ppid=,pgid=,tty=,stat=,etime=,time=,rss=,command=` at `:159`, `-o lstart= -p` at `:112, :136`, `-Ao pid=,ppid=` at `:67`). First read every `ps`, `date` and `awk` call; on Linux (procps) `etime`, `lstart`, `tty` (prints `?` for none) and `stat` exist but their text differs from macOS, so the `etime`/`time` converter (`:182`), the `tty` test and the `lstart` equality check are each run against the real `ps` output on the machine: a test captures `ps -o lstart= -p $$` and `ps -o etime= -p $$` and feeds them to the library's parsers (on macOS locally, on Linux in CI). A platform whose `ps` lacks a keyword → `UNSUPPORTED PLATFORM: <uname>` and nothing is reaped (protected, the fail-safe direction).
- The three worker classes: the test-runner class becomes `stack.host.worker_patterns` (a list; empty or absent → that class matches nothing); the headless agent CLI class and the browser class stay.
- Owner and pass-through pattern lists: project names replaced by `stack.host.protected_patterns` additions.
- `scripts/reap-stale.sh [--dry-run]` sources the library and runs it; `--dry-run` prints the kill list and sends no signal. Not added to `stack.gates[]`; `host-ops.md` names it.
</action>
<behavior>
- T1 process: the source test's snapshot cases (owner present → protected; unrecognised ancestor → protected; cycle and depth cap → protected; orphaned worker with only pass-through ancestors → reaped), run against the source's snapshot seam (port; cite the lines). ADD.
- T1 process: with no `worker_patterns`, a live process matching a typical test-runner name is not listed. ADD.
- T1 process: `--dry-run` with a real orphaned sentinel → listed, still alive. ADD.
- T2 unit: the library's `etime` and `lstart` parsing accepts the live output of the platform's own `ps` (captured in the test, never a literal). ADD.
</behavior>
<verify>Full gate (macOS locally, Linux in CI); Sonnet rounds to zero. Must-confirm item of the batched Fable diff review.</verify>
<done>Ported case names listed; changed lines listed.</done>
</task>

<task id="9.10" type="auto" tdd="true">
<name>Doc freshness tracker + ADR reconcile, Node ports (K:157)</name>
<files>presets/base/scripts/validation/freshness-tracker.mjs, scripts/validation/adr-reconcile.mjs, preset.json, preset-base-scripts.test.js</files>
<action>
Sources `scripts/validation/freshness-tracker.ts` (373 lines) and `adr-reconcile.ts` (160), with their test files (case names first).
- Freshness tracker: warn-only, exit 0 always (source header). The front-matter library import (`:14`) is replaced by a 15-line reader of the `---` block for the keys the source reads; doc and code path mappings that name the project (11 lines) become flags with the source's values as documented examples. Not a gate; `pre-pr-gates.md` names it.
- ADR reconcile: the scan roots and the ADR directory become `--docs <dir>` (default `docs`) and `--adr-dir <dir>` (default `docs/adr`). No ADR directory and no ADR reference → exit 0; a reference with no ADR directory → exit 1.
</action>
<behavior>
- T2 unit: the pure functions of both on the source tests' fixtures (port; cite the lines). ADD.
- T1 process: `adr-reconcile.mjs` in a tmp repo: no docs → 0; a doc citing `ADR-0007` with no file → 1 naming it; with the file → 0. ADD.
- T1 process: the freshness tracker exits 0 with a stale doc and prints it. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Ported case names listed.</done>
</task>

<task id="9.11" type="auto" tdd="true">
<name>Assertion-quality lint, Node port, in the web_ui group (K:157)</name>
<files>presets/base/scripts/validation/check-assertion-quality.mjs, preset.json, preset-base-scripts.test.js</files>
<action>
Source `scripts/check-assertion-quality.ts` (391 lines) and its test (case names first). A phrasing lint over UI scenario source text for the five anti-patterns `e2e-assertions.md` (8.13) lists; the source's "honest limitation" header is kept. The scan root is `stack.paths.e2e_scenarios`; unset → `no e2e scenarios path (stack.paths.e2e_scenarios)`, exit 0. The driver name in messages becomes "the UI QA scenario". Entry `"capability": "web_ui"`.
</action>
<behavior>
- T2 unit: the source test's cases for the five anti-patterns and the behaviour-assertion floor (port; cite the lines). ADD.
- T1 CLI: deployed with `web_ui: {}`, absent with `web_ui: false`. UPDATE the 3.7 lists.
</behavior>
<verify>Full gate.</verify>
<done>Ported case names listed.</done>
</task>

<task id="9.12" type="auto" tdd="true">
<name>Findings register, Node port (K:157)</name>
<files>presets/base/scripts/findings-register.mjs, scripts/lib/findings-register/{parse.mjs, owner.mjs, telemetry.mjs}, preset.json, preset-base-scripts.test.js, tests/fixtures/agnostic/findings-register/** (new)</files>
<action>
Source `scripts/findings-register.ts` (417 lines), `scripts/lib/findings-register/` (`parse.ts` 192, `owner.ts` 95, `telemetry.ts` 48, `types.ts` 75) and the tests with their four fixtures (`scripts/fixtures/findings-register/`). Read the usage text and the test case names first. Port: types become JSDoc; the type-only import of the telemetry schema (`findings-register.ts:3`) becomes an inline shape. The 4 project-term lines (input globs, phase naming) become flags with the same defaults expressed as `.planning/phases/**`. Fixtures are rewritten with neutral rows of the same shape and stored under `tests/fixtures/agnostic/findings-register/`; no igaming finding text is copied.
</action>
<behavior>
- T2 unit: the parse, owner and telemetry cases of the source tests on the rewritten fixtures (port; cite the lines). ADD.
- T2 process: seed then check on a fixture tree → exit 0; a register row whose source finding is gone → the source's failure exit. ADD.
- T1: deployed in all configurations; term check green over the deployed files. UPDATE the 3.7 lists.
</behavior>
<verify>Full gate.</verify>
<done>Ported case names listed.</done>
</task>

<task id="9.13" type="auto" tdd="true">
<name>Default gates and style config written by the init wiring [critical path, mutation]</name>
<files>get-shit-done/bin/project-registry.js (`applyToConfig`), project-registry.test.js, preset-base.test.js</files>
<action>
`applyToConfig` (2.1), in the same validated write:
- `stack.style` absent → `{ "rule_set": "generic", "roots": ["."] }`. Present → untouched.
- `stack.gates`: for each default entry below whose `id` is not in the list, append it (the list is created when absent). An existing entry with the same id is never changed; no entry is removed.

| id | run |
|---|---|
| `hook-canaries` | `scripts/validation/hook-canaries/run-canaries.sh` |
| `hook-patch-trailer` | `scripts/validation/hook-patch-trailer-check.sh` |
| `guard-canaries` | `node scripts/validation/canary-gate.mjs` |
| `guard-registry` | `node scripts/validation/guard-registry-reconcile.mjs` |
| `style` | `node scripts/style-gate.mjs` |
| `flake-patterns` | `node .claude/hooks/lib/flake-gate.mjs --all` |
| `dependency-scan` | `node scripts/dependency-scan-gate.mjs` |
| `adr` | `node scripts/validation/adr-reconcile.mjs` |
| `assertion-quality` (only when `capabilities.web_ui` is an object) | `node scripts/validation/check-assertion-quality.mjs` |

The style gate is in the list for every project: the interview sets `stack.style.rule_set` and has no question that removes the entry (4.2).
</action>
<behavior>
- T1 CLI G-a: `project init --preset base` on a config with no `stack.gates` and `web_ui: {}` → the nine ids in the table's order; with `web_ui: false` → eight, no `assertion-quality`; with the `web_ui` key absent (`stack.capabilities: { backend: {} }`, and `{}`) → in one write the wiring first sets `web_ui: {}` (2.1), then appends `assertion-quality`, so the result holds `web_ui: {}` and nine ids ending in `assertion-quality`. ADD.
- T1 CLI G-b: a config whose `stack.gates` holds `{ id: "style", run: "custom" }` and `{ id: "mine", run: "x" }` → both kept unchanged, the other defaults appended. ADD.
- T1 CLI G-c: `stack.style` absent → the default; `{ rule_set: "js-ts", roots: ["src"] }` → kept. ADD.
- T1 process G-d: in a deployed tmp project with one commit and the default config (`stack.style` written by the wiring, no `src/`), every default `run` exits 0 from the project root, in particular `node scripts/style-gate.mjs` (the deployed files are excluded through the manifest, 9.2). ADD.
Mutants: m1 defaults written only when `stack.gates` is absent → G-b; m2 an existing id is overwritten → G-b; m3 `style` left out of the defaults → G-a; m4 `assertion-quality` added regardless of `web_ui` → G-a.
</behavior>
<verify>Full gate; Sonnet rounds to zero.</verify>
<done>4 tests pass; 4 mutants killed.</done>
</task>

</tasks>

<verification>Full gate; the 3.7 guard green with the complete expected lists; `node scripts/agnostic-lint.js check` ok.</verification>
<success_criteria>The four must-have truths hold by test.</success_criteria>
<output>`.planning/agnostic/M/M-09-SUMMARY.md`</output>
