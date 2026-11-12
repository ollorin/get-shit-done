# M-09 summary (tasks 9.1-9.6)

Merge of exp/agnostic into exp/agnostic-m09: a21b68c. Worktree .tmp/wt-m09. Tasks 9.7-9.13 not in scope.

| Task | Commit | Deliverable |
|---|---|---|
| 9.1 | e4b0383 | rules/code-style.md (65 lines, 9 headings, 8 checklist items) |
| 9.2 | 8216325 | style-gate.mjs + style-gate/{scan,input-mutation,dup}.mjs + rule-sets generic/js-ts/python; canaries (18 fixtures + meta-fixture); registry and guard-estate rows |
| 9.3 | 25d324c | duplicate-block detector style-gate/dup.mjs (55 lines) |
| 9.4 | 5232bfe | mutate/{classify,restore,worktree}.mjs |
| 9.5 | 9478912 | mutate/{guards,options,process}.mjs |
| 9.6 | c911c4e | mutate/mutate.mjs (216 lines), docs/gsd/mutation-testing.md, stack.mutation.error_pattern profile key |

## 9.1 code-style.md
Rule file with the checklist; a test in preset-base.test.js pins headings and items.

## 9.2 style gate
Per-(top directory, rule) ratchet against .planning/style-baseline.json; flags --write-baseline, --seed-baseline; exit 0/1/2. Mutants m1-m9: all killed.

## 9.3 duplicate blocks
Mutants m1, m2: both killed. Tags `style-gate:edge <reason>` / `style-gate:ignore <reason>` need a reason.

## 9.4 mutation tool part 1
classify/restore/worktree. Mutants m1, m2: both killed.

## 9.5 mutation tool part 2
guards/options/process. Mutants (timeout counted as killed, pattern ignored, exit inverted, NODE_TEST_CONTEXT kept): all killed. Nested `node --test` inherits NODE_TEST_CONTEXT and wrongly reports success, so process.mjs strips it.

## 9.6 CLI
Refusals as processes (exit 2, bytes unchanged): dirty, untracked, ignored, outside root/symlink, leftover restore dir, unknown flag, stray positional, bad mutants file, not a git worktree, --out clash, red baseline; primary worktree refusal; dry-run; e2e in a linked worktree (killed + survived, exit 0, byte-equal); canary mismatch exit 1; SIGTERM (exit 143, byte-equal, test killed); SIGKILL then second run refused over leftover backups; withProfile. project-profile.test.js covers stack.mutation.
Mutants: skip outsideRootError -> killed; drop signal install -> killed; skip staleBackupError -> killed.
commandFor in process.mjs now escapes {file} inside double quotes (small fix to 9.5 code, covered by the e2e tests).
A missing .planning/config.json is allowed only when --test-cmd is given.

## Deviations
- One `style-gate` registry entry; its corpus ends with a meta-fixture enforcing 3 fixtures per rule.
- Extra modules: style-gate/input-mutation.mjs, mutate/classify.mjs.
- ifElseRouters generalised (method plus path/route/url tokens), not scoped to functions/*/index.ts.
- Strippers gained a keepStrings option for dup.
- Only scan/input-mutation/dup/style-gate and mutate/* scripts are guarded:true.
- 9.5 tests are at runTest level; CLI exit codes are covered in 9.6.
- Dropped from the source: summary parser, killed-typecheck, expect_failing_test, --test-flag, apps/libs path rule.
- Style-gate test S-i writes stack.style by hand (9.13 wiring out of scope).
- Kill-confirm re-run kept as kill_confirmed.
- 3.7 bookkeeping: deployed lists, guarded count 32, mirror count 74, manifest docker lines 397-403, 441, 444, 445.

## Checks
Targeted: preset-base.test.js 3.7/8./9./3.1 19 pass; preset-base-scripts 40+, preset-base-style 13, preset-base-mutate 30, project-profile 38 (121 across the four files), 0 fail. agnostic-lint ok (55 denied, 406 allowed). osv/lockfile note: N/A for 9.1-9.6.

# Tasks 9.7-9.13

| Task | Commit | Deliverable |
|---|---|---|
| 9.7 | 6b57764 | scripts/dependency-scan-gate.mjs (osv-scanner, fail-closed, baseline) |
| 9.8 | 7e6e6d1 | scripts/memory-guard.sh, scripts/container-disk-guard.sh, host-ops.md section |
| 9.9 | 662bfc8 | scripts/lib/reap-stale-test-processes.sh, scripts/reap-stale.sh |
| 9.10 | 2eb5b66 | scripts/validation/adr-reconcile.mjs, freshness-tracker.mjs |
| 9.11 | d7b38b4 | scripts/validation/check-assertion-quality.mjs (web_ui capability), rules/e2e-assertions.md section |
| 9.12 | 85bd144 | scripts/findings-register.mjs + lib/findings-register/{parse,owner,telemetry}.mjs |
| 9.13 | see git log | applyToConfig writes stack.style and the default gates |

## 9.7 dependency scan
Config from stack.cve; baseline .planning/cve-baseline.json. Missing scanner exits 1 unless allow_missing_scanner; no lockfile exits 0. v2 command form verified against osv-scanner 2.4.0 locally. Tests P-a..P-i. Mutants (missing scanner exits 0, non-JSON ignored, baseline widened): all killed.

## 9.8 host guards
Both report-first; --live needs a TTY and two confirmations. memory-guard stale candidates = orphans matching stack.host.worker_patterns, minus protected_patterns. Tests H-a..H-f.

## 9.9 stale reaper
Config via stack.host.* (reap_load_config), unsupported platforms print UNSUPPORTED PLATFORM. Tests X-a..X-g. Mutants (OWNER passes, UNKNOWN passes, protected ignored, cycle check removed, dry-run kills): all killed.

## 9.10 ADR and freshness
adr-reconcile fails on a referenced ADR with no file; freshness-tracker is advisory (exit 0). Tests A-a..A-e (own tests; the source only swept its repo).

## 9.11 assertion quality
Reads stack.paths.e2e_scenarios; unset prints a line and exits 0. Tests Q-a..Q-f.

## 9.12 findings register
Node port of seed and --check. Phase ownership moved from hard-coded maps to an optional owner map (--owner-map; absent = the unit owns its findings). Inputs default to .planning/phases/findings. The TSV reader is dependency-free. Tests F-a..F-e. Mutants (seed overwrites, bare scratch ignored, owner unchecked, quoted verdict prose kept): all killed (the last needed a test with the quoted verdict first, added).

## 9.13 default gates
applyToConfig sets stack.style {generic, ["."]} when absent and appends missing default gates by id (nine; assertion-quality only when capabilities.web_ui is an object, which the existing fill sets when absent). No engine file changed. Tests G-a..G-c (project-registry.test.js) and G-d (preset-base.test.js: every default gate exits 0 in a fresh committed base project). Mutants (defaults only when gates absent, existing id overwritten, style omitted, assertion-quality regardless of web_ui): all killed.

## Deviations (9.7-9.13)
- dependency-scan-gate is guarded:true.
- Bash scripts keep bash (memory-guard); container-disk-guard is POSIX sh.
- container-disk-guard defaults to report-only (the source removed by default); OrbStack blocks dropped.
- memory-guard: worker_patterns select candidates, protected_patterns exclude (the plan's wording was inverted).
- freshness-tracker mapping values are neutral placeholders.
- Reaper: the deno task pass-through is dropped; require_free_disk_space kept with generic advice.
- findings-register: owner map and generic OWNED-BY-<release> pattern replace the project phase tables; the 9.12 plan's fixtures are neutral rewrites.
- 9.13 needed no engine change.

## Checks
Targeted only: preset-base.test.js 3.7/8./9. 17 pass; project-registry.test.js 43 pass; F- 6 pass; G-d pass; agnostic-lint ok (55 denied, 406 allowed).

## Fable round 1 fixes

| Finding | Commit | Test / mutant |
|---|---|---|
| F1 reaper kills by default, host-wide, may kill its own launcher | edfd7ee | Y-a (other-project cwd sentinel never matched, default report-only, --live kills only in-scope; W2 and W3), Y-b (project_pattern), Y-c (launching agent survives). Mutants killed: scope check off (Y-a), ancestor check off (Y-c), default dry-run off (Y-a) |
| F2 reaper tests unfiltered and live | edfd7ee (same commit as F1; the two edits share one test file) | project() always sets STALE_REAPER_CMD_FILTER and STALE_REAPER_PROJECT_ROOT, reap() is dry-run unless --live, Y-d guard with positive control |
| F4 UNKNOWN severity passes | 89dbeee | P-n (MAL id, RUSTSEC group max_severity 9.8, CVSS vector, no severity, low score passes), P-a updated; mutant restoring old mapping fails P-a and P-n |
| F3 bare init leaves style gate blind | 70e7ba1 | F3-a (planted throw, input mutation, duplicate all fail after bare init), F3-b (python; empty stays generic, prints scanned 0 files), F3-c (no-language-rules line, require_language_rules fails); mutants (detection off, warning lines off) fail all three |

Design notes: reap-stale.sh signals only with --live (library callers unchanged); W2/W3 need cwd under STALE_REAPER_PROJECT_ROOT (default repo root) or stack.host.project_pattern, unreadable cwd is out of scope. F3 detection ignores scripts/, .claude/ and dotted tool dirs so deployed GSD files do not count. Generic over source files only warns unless stack.style.require_language_rules is true.

Noted, not fixed: inputMutation flags calls on injected ports in block-bodied functions (escape: style-gate:ignore with a reason); style-gate:edge inside a string literal exempts the file; a backtick in a regex literal hides following code (stated limit); an untracked lockfile is not scanned; mutation default --out is timestamped so the leftover-backup refusal only fires with a reused --out, and --out can truncate any non-target file (not restricted). The zero-files one-liner was done under F3.

## Fable round 2 fixes

| Finding | Commit | Test / mutant |
|---|---|---|
| R1 greenfield / scripts-only project passes with a throw | 8d7be53 | preset-base-style.test.js R1 (init empty then src/a.js with throw + push exits 1; scripts-only tool.mjs exits 1; clean code exits 0; require_language_rules false warns only). Mutant default back to opt-in fails 3 tests |
| R2 polyglot: unscanned .ts under python | 8d7be53 | R2 (src/*.py + src/web/a.ts exits 1 naming the file; opt-out prints WARN, exit 0) |
| R3 reaper W1 ignored cwd scope | 6aa2ff1 | preset-base-reaper-scope.test.js (other-project cwd sentinel out_of_scope, in-root and project_pattern admitted, dry-run only); mutant restoring the W1 exemption fails it. X-d/X-e now set project_pattern |
| L4 host-ops reap-stale usage | 28288e7 | doc: report-only default, --live |
| L5 unparsable v4 vector masked by low v3; MAL only in aliases | 321427a | P-n new cases; old gate fails them |
| L6 severity_floor UNKNOWN | 321427a | L6 test; old gate fails it |

Design: the style gate decides at gate time, not at init. With require_language_rules (default true) it fails when a generic rule set scans js/ts/py files, or when js/ts/py files exist outside the active rule set's extensions; scripts/ stays out of init detection (deployed GSD files), so a scripts-only project is told to set stack.style.rule_set. Non-js/ts/py languages (go etc.) under generic still only warn.

Noted, not fixed: the python rule set has no input-mutation rule; a declared database_specific.severity outranks a higher CVSS (pre-existing); the reaper library signals unless STALE_REAPER_DRY_RUN is set (only reap-stale.sh and the report-only memory-guard source it).
