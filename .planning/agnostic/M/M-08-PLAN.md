---
phase: agnostic-M
plan: 08
type: backend
wave: 4
depends_on: ["03"]
files_modified:
  - get-shit-done/presets/base/**
  - get-shit-done/presets/igaming/memory/**
  - get-shit-done/presets/igaming/lessons-stack.md
  - .planning/gsd-v2/tools/**
  - .planning/gsd-v2/experiments/16-ab2/**
  - get-shit-done/bin/preset-base.test.js
  - get-shit-done/bin/preset-base-scripts.test.js
  - get-shit-done/bin/preset-igaming.test.js
  - tests/fixtures/agnostic/base-deployed-exceptions.json
  - package.json
autonomous: true
e2e_flows: []
must_haves:
  truths:
    - "Every file of this plan deploys to a new project by default; only the `backend` and `web_ui` groups disappear, and only when the capability is `false`"
    - "The deployed gate script runs the profile commands, fails on an unset command, and writes the marker the push hook accepts"
    - "The stack lock never lets two holders run at once, on macOS and on Linux, and a holder whose process is gone is taken over by the next waiter through the liveness check (stated limits: a recycled pid, a waiter paused for more than 10 s inside the create-to-write window)"
    - "Every deployed script runs on Node or POSIX shell alone"
    - "No deployed file names the igaming project, its domain, its products or an absolute user path, outside the shared exception list"
  artifacts:
    - get-shit-done/presets/base/preset.json
    - get-shit-done/bin/preset-base-scripts.test.js
---

<objective>
The know-how half of the base deployment (index decisions 4, 9, 10): K: section B.3 content and tasks T7-T13, deployed by default instead of as opt-in packs. Runs after M-03 and before the interview (M-04). Read ranges are in K:334-340 and are not repeated here.

Rules for every task:
- Entries have no `capability`, except the files of 8.12 (`backend`) and 8.13 (`web_ui`).
- Source layout `presets/base/{rules,docs,scripts,skills}/`; dests `.claude/rules/`, `docs/gsd/`, `scripts/`, `.claude/skills/`. No `packs/` directory.
- Prose keeps the source wording and every rule; only names change. No line limit. Commands are named as profile keys in prose (no new placeholder: index decision 3). Each lesson is 2 lines or less with its incident pointer.
- Each task adds its dests to the expected lists of the 3.7 guard and keeps that guard green; an exception entry needs a reason and obeys the 3.7 rule.
- No task adds a hook or a settings entry (those are M-03). Scripts are `render: false`, mode executable.
- Script behaviour tests go in the new `get-shit-done/bin/preset-base-scripts.test.js` (registered in `package.json:64`): process-level tests of deployed scripts are a separate concern from the deployment tests in `preset-base.test.js`.
- Ports to Node (decision 10): replace the runtime calls and remove type annotations; same flags, same output, same exit codes. Port the source's own tests that the behaviour list names; do not add behaviour.
- Redesigns, not ports (decision 10): 8.4, 8.8, 8.9. Each states what is kept and what is dropped. `guarded: true` on `stack-lock.sh`, `stack-lock.mjs` and `pre-pr-gate.sh` (the engine guards nothing under `scripts/` by itself, `project-deploy-guard.js:14`).
- No test and no deployed script may need a macOS-only tool (fork CI is `ubuntu-latest`).
</objective>

<tasks>

<task id="8.1" type="auto" tdd="true">
<name>Rule shared-stack.md, host-ops.md, templates (K: T7 part)</name>
<files>presets/base/rules/shared-stack.md, docs/host-ops.md, docs/file-claims-template.md, docs/cleanup-keep.txt, preset.json, preset-base.test.js</files>
<action>
Per K:189-192. `shared-stack.md`: the stack lock and window protocol, worktree lanes, file claims, "one writer per file set", the reset rule (from igaming CLAUDE.md "Parallelism" and the memory files `feedback_worktree_phases_while_stack_locked`, `feedback_keep_two_phases_in_flight`, read-only under `~/.claude/projects/-Users-ollorin-igaming-platform/memory/`). The lock command is `scripts/stack-lock.sh`; the list of commands that need it is `stack.locked_commands`. The rule states: always call the `.sh` wrapper. The hook parser recognises a wrapped command only when the command word is `stack-lock.sh` or `stack-lock.ts` (`ShellParse.pm:261`, `:267`, copied byte-equal), so `node scripts/stack-lock.mjs -- <cmd>` is denied by `check-test-command` as unwrapped (canary row in 3.9). `host-ops.md`: cleanup, runtime restart and process audit with thresholds as named parameters (K:189); the three threshold conflicts of K:171-175 are resolved by the newest dated rule, stated in the file. Templates per K:190, 192. Dests `.claude/rules/shared-stack.md`, `docs/gsd/host-ops.md`, `docs/gsd/file-claims-template.md`, `.planning/cleanup-keep.txt`.
</action>
<behavior>
- T1 CLI: the four files deploy in all three configurations of the 3.7 guard. UPDATE the 3.7 expected lists.
- T1: the 3.7 term check stays green over them. REUSE (3.7).
- T2 unit: `shared-stack.md` contains `scripts/stack-lock.sh` and the sentence that `stack-lock.mjs` called directly is not recognised. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Line counts recorded.</done>
</task>

<task id="8.2" type="auto" tdd="true">
<name>agent-ops-lessons.md (K: T7 part)</name>
<files>presets/base/docs/agent-ops-lessons.md, preset.json, preset-base.test.js</files>
<action>
The 27 memory files K:165 classes "general agent-ops" (read each in full; about 600 lines), the review-mining numbers (K:184), flow findings F1-F4 (K:187), the A/B verdict lines (K:188). One lesson per source, 2 lines or less, with its incident pointer. The model-allowance paragraph is not carried. Lessons that the base CLAUDE.md (3.1) already states as a rule are kept here as the incident behind the rule, not restated. Dest `docs/gsd/agent-ops-lessons.md`.
</action>
<behavior>
- T1: deployed in all configurations; term check green. UPDATE the 3.7 lists.
- T2 unit: the file has one entry per source file (27 + the three finding groups); the count is asserted. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Lesson count recorded; skipped sources listed with the reason.</done>
</task>

<task id="8.3" type="auto" tdd="true">
<name>engineering-lessons.md + defect-classes.md (K: T9 part)</name>
<files>presets/base/docs/engineering-lessons.md, docs/defect-classes.md, preset.json, preset-base.test.js</files>
<action>
`engineering-lessons.md`: the 17 memory files K:166 classes "general engineering", same format as 8.2, plus the two lines rescued from the stale files (K:169). No "available in igaming" list: every tool K:94, 151, 155-157 names is deployed (3.11, M-09; index decision 11). `defect-classes.md` per K:183 from `~/igaming-platform/.planning/code-review/findings/POSTMORTEM.md` (76 lines, read-only): the ten class names made stack-neutral, the four-column template, the method sentence; project rows stay out. Dests `docs/gsd/`.
</action>
<behavior>
- T1: deployed in all configurations; term check green. UPDATE the 3.7 lists.
- T2 unit: `defect-classes.md` has ten class rows and the four column headers. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Counts recorded.</done>
</task>

<task id="8.4" type="auto" tdd="true">
<name>Stack lock: Node redesign + shell wrapper (K: T8 part) [critical path, mutation, Sonnet implements]</name>
<files>presets/base/scripts/stack-lock.mjs, scripts/stack-lock.sh, preset.json, preset-base-scripts.test.js (new), package.json:64</files>
<action>
Source `~/igaming-platform/scripts/stack-lock.ts` (219 lines), `stack-lock.sh` (2 lines), tests `stack-lock.test.ts` (612 lines; case names first, then only the cases named below). **This is not a port.** The source holds a kernel `flock` (`:99-112`, `file.lock(true)`): the kernel queues waiters and frees the lock when the holder dies. Node has no `flock`. Design:
- **Lock** = the file `--lock-file`, created with `fs.openSync(path, 'wx')` (atomic create is the exclusion; same primitive as the 2.1 registry lock) and holding one JSON line `{ pid, label, start }`.
- **Wait**: on `EEXIST` retry every 200 ms until `--timeout` seconds, then the source's message (`:180`) and exit 75.
- **Dead holder**: on `EEXIST` read the pid in the lockfile; `process.kill(pid, 0)` throwing `ESRCH` means dead (`EPERM` means alive). Takeover is its own atomic step so two waiters cannot both remove a lock: `fs.mkdirSync(<lock-file>.takeover)`; on success re-read the lockfile, and only if it still holds the same dead pid unlink it; remove the takeover directory; go back to the `wx` create (the lock is never handed over directly). `EEXIST` on the takeover directory → keep waiting; a takeover directory older than 10 s is removed. A lockfile that is empty or not JSON is treated as held until it is older than 10 s (the window between create and write), then as dead.
- **`owner.txt` stays informational** as in the source (`:185-193`, `:203`): written after acquire, cleared on release, never read. This is what keeps the source case `stack-lock.test.ts:221` true: while a live holder runs, an `owner.txt` rewritten with a dead pid does NOT grant the lock, because liveness is read from the lockfile only.
- **Stated limits, in the `stack-lock.mjs` file header and in `shared-stack.md` (8.1)**: (1) a recycled pid looks alive: the waiter times out with 75 (the safe direction); (2) the 10 s rule for an empty or non-JSON lockfile is a timing assumption, not a guarantee: a process that created the lockfile and is paused (stopped, or starved) for more than 10 s before writing its JSON is judged dead, its file is unlinked and a second holder can run beside it; (3) liveness is a local `kill(pid, 0)`, so the lock is only valid for processes on one machine and one pid namespace (not across containers or a network filesystem). Exclusion is therefore "at most one live holder under normal scheduling", and the batched Fable review is asked to rule on limit (2).
- **Release**: unlink the lockfile only if it still holds this process's pid; on normal exit, and on `SIGINT`/`SIGTERM` after forwarding the signal to the child and waiting for it (exit 130/143, `:17`, `:141-143`). A `SIGKILL`ed wrapper leaves the lockfile; the next waiter takes over through the liveness check.
- **Child**: `spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, STACK_LOCK_HELD: '1' } })`. Node replaces the environment where the source's runtime adds to it (`:125`), so the spread is required. Spawn failure → 127.
- Flags, defaults, usage text and exit codes as the source (`:21-38`, `:57-80`): 75 timeout, 2 usage, 127 spawn failed, 1 internal. Default paths are relative to the repository root (the parent of `scripts/`).
`stack-lock.sh` runs `node "$(dirname "$0")/stack-lock.mjs" "$@"` and is the only supported entry point (8.1). Dests `scripts/stack-lock.mjs`, `scripts/stack-lock.sh`, both `guarded: true`.
</action>
<behavior>
- T1 process L-a: `stack-lock.sh --label a -- <cmd>` runs the command, returns its exit code, leaves no lockfile and an empty `owner.txt`; the child sees `STACK_LOCK_HELD=1` and the parent's `PATH`. ADD.
- T1 process L-b: a second wrapper started while the first holds the lock runs only after the first's command ended (start/end stamps); a waiter that timed out never runs its child. ADD (ports of `stack-lock.test.ts:102` and `:296`).
- T1 process L-c: with a live holder, a waiter with `--timeout 1` exits 75 and the holder's command still completes with 0; the same with `owner.txt` emptied. ADD (ports of `:191` and `:247`).
- T1 process L-d: with a live holder, `owner.txt` rewritten with `{ pid: 999999 }` → a waiter with `--timeout 1` exits 75. ADD (port of `stack-lock.test.ts:221`).
- T1 process L-e: the holding wrapper is `SIGKILL`ed → a waiter acquires within 2 s (port of `:143`, the kernel release replaced by the liveness takeover); a planted lockfile holding a dead pid → the command runs, exit 0. ADD.
- T1 process L-f: 6 wrappers started at once, each appending start and end stamps → the 6 intervals do not overlap; repeated with a dead-pid lockfile planted first. ADD.
- T1 process L-g: `SIGTERM` to the wrapper → the child receives it, the wrapper exits 143, `owner.txt` is cleared, no lockfile remains; the same for `SIGINT` and 130. ADD (port of `:344`).
- T1 unit L-h: `parseArgs` cases of the source (`:385-447`), usage exit 2 (`:475`, `:505`), child exit code passed through (`:533`). ADD (port).
- T2 unit L-i: the header comment of `stack-lock.mjs` contains the three stated limits (recycled pid, the 10 s create-to-write window, single pid namespace). ADD.
Mutants: m1 liveness always reports dead → L-c, L-d; m2 `'wx'` → `'w'` → L-f; m3 takeover unlinks without the re-read → L-f (second half); m4 release unlinks without the pid check → L-f; m5 timeout exits 1 → L-c; m6 signal not forwarded → L-g; m7 `env` without the spread → L-a.
</behavior>
<verify>Full gate on macOS; the same test file is part of `npm test` on the Linux CI. Sonnet rounds to zero (index section 0). Must-confirm item of the batched Fable diff review.</verify>
<done>9 tests pass; 7 mutants killed, one line each.</done>
</task>

<task id="8.5" type="auto" tdd="true">
<name>Session supervisor + doc (K: T8 part)</name>
<files>presets/base/scripts/session-supervisor.sh, docs/session-supervisor.md, preset.json, preset-base-scripts.test.js</files>
<action>
Source `~/igaming-platform/scripts/session-supervisor.sh` (445 lines) and its doc (locate with `git -C ~/igaming-platform ls-files '*SESSION-SUPERVISOR.md'`). The 13 project-term lines (K:148) become flags or profile-key prose; nothing else changes. Dests `scripts/session-supervisor.sh`, `docs/gsd/session-supervisor.md`.
</action>
<behavior>
- T1 process: `session-supervisor.sh --max-resumes 1 -- true` exits 0; with a child that exits non-zero for a non-limit reason, the supervisor returns that code without a resume (read the source's own exit rules and assert them; cite the lines). ADD.
- T1: term check green over both files. REUSE (3.7).
</behavior>
<verify>Full gate.</verify>
<done>Changed lines listed (13 expected).</done>
</task>

<task id="8.6" type="auto" tdd="true">
<name>Rules guard-authoring.md, pre-pr-gates.md, module-structure.md (K: T9 part)</name>
<files>presets/base/rules/guard-authoring.md, rules/pre-pr-gates.md, rules/module-structure.md, preset.json, preset-base.test.js</files>
<action>
Per K:70, 72, 77, from `presets/igaming/rules/`: `guard-authoring.md:15-111`; `pre-pr-quality-gates.md:22-75, 117-180` (one script mirrors CI, deterministic once / flake-sensitive twice, test cost rule, coverage ratchet up-only, no escape hatch), with the gate script named `{{stack.commands.pre_pr_gate}}` (`render: true`) and the other commands as profile keys; `module-structure.md:1-61, 80-82` with the threshold and scan roots as named parameters. Dests `.claude/rules/`.
</action>
<behavior>
- T1: deployed in all configurations; term check green. UPDATE the 3.7 lists.
- T2 unit: `pre-pr-gates.md` contains the test cost rule heading and the rendered gate path. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Line counts recorded.</done>
</task>

<task id="8.7" type="auto" tdd="true">
<name>pre-pr-gate.sh skeleton + disagreement log (K: T10 part) [critical path]</name>
<files>presets/base/scripts/pre-pr-gate.sh, scripts/log-pre-pr-disagreement.sh, preset.json, preset-base-scripts.test.js</files>
<action>
Skeleton from `~/igaming-platform/scripts/preflight.sh:140-239, 1466-1560` (read-only): `run_check`, `run_flake_check`, `detect_affected`, `print_summary`, `with_stack_lock`; two stages (deterministic once, flake-sensitive twice). Dest `scripts/pre-pr-gate.sh`, the default of `stack.commands.pre_pr_gate`.
- Commands are read at run time from `.planning/config.json` (`node -e`, one read): `typecheck`, `lint` in stage one; `test_all` in stage two; then each `stack.gates[].run`. A key that is not set prints `NOT CONFIGURED: stack.commands.<key>` and the gate fails: an unset command is a gap, never a skip. The owner sets the command, or the literal `true` to state there is none.
- On a fully green run, and only then, write the marker the push hook reads (3.5): `"$(git rev-parse --absolute-git-dir)/.pre-pr-passed"`, not the repository root (the source writes the root, `preflight.sh:1620`, behind igaming's own `.gitignore` line; the base preset cannot add one). No other code path writes it. Entry `guarded: true`.
- `log-pre-pr-disagreement.sh` from `log-preflight-disagreement.sh` (102 lines, coupling 0): rename only.
The push block is therefore active on a default project from the first commit; the ruling of 3.8 point 3 applies and is cited in the summary.
</action>
<behavior>
- T1 process: tmp project whose three commands are `true` → exit 0, the marker exists in the git dir and `git status --porcelain` shows no new untracked file; the deployed push hook then allows `git push origin feature/x`. ADD.
- T1 process: the same in a linked worktree (`git worktree add`): the marker is in that worktree's git dir and a push from the main worktree is still blocked. ADD.
- T1 process: `lint` unset → non-zero, output names `stack.commands.lint`, no marker. ADD.
- T1 process: `test_all` = a command that passes on the first run and fails on the second → non-zero, no marker, one line appended to the disagreement log. ADD.
- T1 process: a `stack.gates[]` entry whose `run` exits 1 → non-zero, no marker. ADD.
</behavior>
<verify>Full gate; Sonnet rounds to zero (index section 0). Must-confirm item of the batched Fable diff review.</verify>
<done>5 tests pass; skeleton line count recorded.</done>
</task>

<task id="8.8" type="auto" tdd="true">
<name>Canary gate + guard registry + sample guard, Node redesign (K: T10 part) [Sonnet implements]</name>
<files>presets/base/scripts/validation/canary-gate.mjs, guard-registry.mjs, guards/sample-guard.mjs, canaries/sample-guard.canaries.mjs, preset.json, preset-base-scripts.test.js</files>
<action>
Sources `~/igaming-platform/scripts/validation/canary-gate.ts` (236 lines) and `guard-registry.ts:1-45` (the shape; registry rows are project data and stay out). **A redesign of the corpus discovery; the evaluation is ported.**
- Source discovery: a static import of every corpus file and one hand-kept array (`canary-gate.ts:32-46`, `:59`), ids as a TypeScript union (`guard-registry.ts:17`), plus a union for corpora outside the registry (`canary-gate.ts:31`).
- **Contract.** `guard-registry.mjs` exports `GUARD_REGISTRY`, an array of `{ id, guard, prevents, implementedIn }` (the three doc cells, `guard-registry.ts:37-55`); ids are strings, a duplicate id fails. For each registry id the gate loads `scripts/validation/canaries/<id>.canaries.mjs` with a dynamic `import()`; the file must export `CANARIES`, an array of `{ name, why, detect }` where `detect()` returns true when the real guard function flags the fixture. The guard id is the file name. A missing file, a failed import or a missing export is a failure naming the id (unreadable is FAIL). A `*.canaries.mjs` file whose id is not in the registry is printed as `PHANTOM` and does not change the exit code (the source computes it, `:104`, and does not fail on it, `:165`).
- **Kept** (ported): `evaluateCanaries`, `exitCodeFor`, `MIN_FIXTURES_PER_GUARD = 3`, a `detect()` that throws counts as missed (`:121`), `--json`, the report.
- **Dropped:** the static import list, the id unions, corpora outside the registry (the style gate's corpus is a registry entry in base, 9.2).
- The registry ships one entry, `sample-guard`: a pure function ("file has no tab character", about 20 lines) with three canaries, all three bad inputs the guard must flag. A clean input is a unit test of the guard, not a canary.
Dests under `scripts/validation/`.
</action>
<behavior>
- T1 process: `node scripts/validation/canary-gate.mjs` in a deployed tmp project → exit 0. ADD.
- T1 process: one canary removed (2 left) → non-zero naming the id as undersized; a canary whose `detect` returns false, and one that throws → non-zero naming the fixture. ADD.
- T1 process: a registry id with no corpus file → non-zero naming the id; a corpus file with no registry id → `PHANTOM` printed, exit unchanged. ADD.
- T2 unit: `evaluateCanaries` on the source test's injected fixtures gives the source's result (port those cases; cite the lines). ADD.
</behavior>
<verify>Full gate.</verify>
<done>4 tests pass; kept and dropped lists in the summary.</done>
</task>

<task id="8.9" type="auto" tdd="true">
<name>Guard-registry reconcile, Node redesign (K: T10 part) [Sonnet implements]</name>
<files>presets/base/scripts/validation/guard-registry-reconcile.mjs, docs/guard-estate.md, preset.json, preset-base-scripts.test.js</files>
<action>
Source `guard-registry-reconcile.ts` (313 lines) and its test file (case names first). **A redesign: the source reconciles three igaming documents and one live export; base has one document.**
- **Kept** (ported): `parseTableByHeading` (`:44`), `reconcile` (registry against the doc table: missing, phantom, field divergence, `:106`), `exitCodeFor`, `scanGuardIdReferences` (`:167`) over the one document, and the on-disk check that each `implementedIn` path exists (the source applies it to the ids with no live export; here it applies to every id). A missing document is a failure.
- **Dropped:** the cross-check against the live `ALL_GUARDS` export (`:16`), the failure-mode matrix (`verifyFmMatrix`, `:186`, `MATRIX_PATH`, `:20`), the second and third document paths (`:19-21`).
- **Contract.** The document is `docs/gsd/guard-estate.md`; the table is found by the exact heading `## Machine-enforced guards` and a header row starting `| ID`, four cells per row: id, guard, prevents, implemented in. Cell text must equal the registry strings.
`docs/guard-estate.md` (dest `docs/gsd/guard-estate.md`) ships that table with the registry's rows and the "where to add a new gate" paragraph of `guard-authoring.md` by reference, not copied.
</action>
<behavior>
- T1 process: registry and doc table agree → exit 0. ADD.
- T1 process: a registry entry with no doc row, a doc row with no registry entry, one differing cell, and an `implementedIn` path that does not exist → non-zero naming each. ADD.
- T1 process: the document missing, and the heading missing → non-zero. ADD.
- T2 unit: `parseTableByHeading` and `reconcile` on the source test's fixtures (port those cases; cite the lines). ADD.
</behavior>
<verify>Full gate.</verify>
<done>4 tests pass; kept and dropped lists in the summary.</done>
</task>

<task id="8.10" type="auto" tdd="true">
<name>CI diagnose, Node port (K: T10 part)</name>
<files>presets/base/scripts/ci-diagnose.mjs, preset.json, preset-base-scripts.test.js</files>
<action>
Source `~/igaming-platform/scripts/ci-diagnose.ts` (495 lines, 1 project-term line) and `ci-diagnose.test.ts` (case names first). Port; the repository comes from `git remote get-url origin`, never a literal. Dest `scripts/ci-diagnose.mjs` (the name 3.1's CLAUDE.md gives).
</action>
<behavior>
- T2 unit: the pure parsing functions (job conclusions, failing-test lines) give the source test's expected output on the source test's fixtures (port those cases; no network). ADD.
- T2 process: with no run id and no token → the usage text and a non-zero exit, no network call. ADD.
</behavior>
<verify>Full gate.</verify>
<done>Ported case names listed.</done>
</task>

<task id="8.11" type="auto" tdd="true">
<name>Skills test-enforcement, create-unit-test, create-documentation (K: T10, T12 part)</name>
<files>presets/base/skills/test-enforcement/SKILL.md, skills/create-unit-test/**, skills/create-documentation/**, preset.json, preset-base.test.js</files>
<action>
From `presets/igaming/skills/` (174, 264, 106 lines). Test globs, runner imports and paths become profile keys in prose; the runtime-specific template file of `create-unit-test` is replaced by a neutral outline that uses the `test_file` command of the profile; the domain enum of `create-documentation` becomes "the domains of the product brief". Not gated: unit tests and documentation apply to every stack. Dests `.claude/skills/`.
</action>
<behavior>- T1: deployed in all configurations; term check green. UPDATE the 3.7 lists.</behavior>
<verify>Full gate.</verify>
<done>Line counts recorded.</done>
</task>

<task id="8.12" type="auto" tdd="true">
<name>Gated group backend (K: T11)</name>
<files>presets/base/rules/handler-correctness.md, rules/data-integrity.md, skills/vibe-security/SKILL.md, preset.json, preset-base.test.js</files>
<action>
Per K:73-74, 79-80, 112, entries with `"capability": "backend"`. `handler-correctness.md` from `presets/igaming/rules/edge-functions.md:202-285, 343-355` plus `fp.md:19` and `bonus-system.md:17` (fail-closed, outage is 503, outcome-unknown, one authorisation gate, cache never decides safety, partial failure, atomic multi-write, boundary validation, allow-list projections, no database error text in responses, misconfigured vs wrong key, no fire-and-forget async result, commit before notify). `data-integrity.md` from `database.md:10-41, 192-227` and the batch principles in `:236-286` (migrations only with a paired rollback, "verified only after it executed", clean-room replay, compare-and-set with row count, lock order). Every platform and product name is dropped; no rule is. `vibe-security` (658 lines) is copied; a line that matches a class pattern is rewritten or, for a generic technology list, added to the exception file.
</action>
<behavior>
- T1 CLI: the three files deploy with `backend: {}` and are absent with `backend: false`. UPDATE the 3.7 lists.
- T1: term check green. REUSE (3.7).
</behavior>
<verify>Full gate.</verify>
<done>Deployed with the capability only; exception entries added listed.</done>
</task>

<task id="8.13" type="auto" tdd="true">
<name>Gated group web_ui (K: T12)</name>
<files>presets/base/rules/e2e-assertions.md, rules/frontend-testability.md, rules/qa-exemptions.md, preset.json, preset-base.test.js</files>
<action>
Per K:75-76, 78, entries with `"capability": "web_ui"`, from `presets/igaming/rules/e2e-testing.md:12-66, 111-129, 150-175, 194-199`, `frontend-apps.md:33-58, 89-99`, `qa-exemptions.md:12-48`. The driver is "the project's UI QA capability" and the evidence key is `ui_qa_ran`; the frontend directories are `stack.paths.frontends`.
</action>
<behavior>
- T1 CLI: the three files deploy with `web_ui: {}` and are absent with `web_ui: false`. UPDATE the 3.7 lists.
- T1: term check green. REUSE (3.7).
</behavior>
<verify>Full gate.</verify>
<done>Deployed with the capability only.</done>
</task>

<task id="8.14" type="auto" tdd="true">
<name>Preserve the rest (K: T13, section C rows 3, 7, 8, 9) [conditional]</name>
<files>get-shit-done/presets/igaming/memory/** (73 files), presets/igaming/lessons-stack.md, .planning/gsd-v2/tools/**, .planning/gsd-v2/experiments/16-ab2/**, preset-igaming.test.js</files>
<action>
Runs only if `git remote get-url origin` plus `gh repo view --json visibility` shows the fork is private; otherwise stop and report (memory files hold project and owner details). All sources are read-only; nothing is written outside this worktree. `.planning/` is ignored in the fork (`.gitignore:29`): add with `git add -f`.
- Row 3: the memory directory → `presets/igaming/memory/` after dropping the 8 stale files; the 17 stack lessons → `presets/igaming/lessons-stack.md`.
- Row 7: from `~/igaming-platform/.tmp/gsd-v2/`: `*.py`, `agent-audit/*.py`, `roles.json`, `hooks-flip-backup/` → `.planning/gsd-v2/tools/`. Data files stay.
- Row 8: `~/igaming-platform/.tmp/fable-ab-inventory.md` and `.tmp/fable-spawn-baseline.md` → `.planning/gsd-v2/experiments/16-ab2/`. K says "next to this report", which is inside the igaming checkout; no task writes there (index section 1), so they go to the fork with row 9.
- Row 9: from `~/ab-eval-fable/`: `ab-eval/results/*.jsonl`, `evolve/decisions.jsonl`, `registry.json` → `.planning/gsd-v2/experiments/16-ab2/`. The clones stay.
This is project material; it is not deployed by `base`. If the directory-listing test of `preset-igaming.test.js` (`:59`) flags the new files, add the two names to its `META` list (`:31`). Nothing is pushed by any task.
</action>
<behavior>
- T1: `scanText` (`project-deploy-scan.js`) over every copied file of all four rows returns no hit; file counts per row match the source. ADD (in `preset-igaming.test.js`, next to the existing scan test).
</behavior>
<verify>Full gate.</verify>
<done>Counts per row recorded, or the stop reason.</done>
</task>

</tasks>

<verification>Full gate; the 3.7 guard green with the complete expected lists; `node scripts/agnostic-lint.js check` ok.</verification>
<success_criteria>The four must-have truths hold by test.</success_criteria>
<output>`.planning/agnostic/M/M-08-SUMMARY.md`</output>
