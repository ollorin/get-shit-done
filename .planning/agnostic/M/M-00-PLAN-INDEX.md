# M: project-agnostic GSD (re-plan after the scope check, the CEO corrections and two Fable plan-checks)

Worktree `~/get-shit-done-agnostic`, branch `exp/agnostic`, base HEAD `0b9c35a` (A, B incl. 3 fix rounds, C-01 done; 1979 tests green, lint `869 denied, 338 allowed`).
Sources: `FABLE-AGNOSTIC-SCOPE-CHECK.md` (S:), `FABLE-AGNOSTIC-GSD.md` (D:), `FABLE-KNOWHOW-TRANSFER.md` (K:), all in `~/igaming-platform/.planning/fable-review/`.

## 0. Ruling (binding for coordinator, executors and reviewers)

**Goal.** (1) GSD core carries no igaming/domain/stack/service specifics (ratchet from 869 denied lines to the Telegram residual, 48, which is its own track, D:92). (2) A new project gets a brief, a stack profile and **every transferable igaming improvement** from `/gsd:new-project` in minutes. (3) Several projects run in parallel without colliding.

**Owner correction (binding).** There are no optional or opt-in know-how packs and no "thin base". "All improvements" means all: everything K: classes AS-IS or PARAMS reaches every new project by default, ported to Node where it was bound to another runtime and driven by the profile, each with canary rows or tests. That is the CLAUDE.md methodology incl. tiering, review loop and orchestration rules; the guard-authoring / testing / handler-correctness rules; all five generic hooks (incl. the flake-pattern hook) with the canary runner; the generic deny rules and the project's never-touch deploy rows; agent-ops and engineering lessons; the quality-gate scripts; the mutation tool, the dependency gate, the host guards and the K:157 scripts; secure backend, web test rules, skills. **Clean code, DRY and functional style are a default mandate** in the base CLAUDE.md and rules, written language-agnostically, with the stack profile supplying the idioms, and enforced by a style gate that is on for every project: the interview chooses the rule set, never whether. Only K: class PROJECT (iGaming domain, product and runtime names, money/KYC specifics, the four migration/runtime hooks, the three scaffold skills, the body of the igaming gate script) stays in `presets/igaming`. No line or file budget on deployed content. Proportion is kept on the plan side: each task is one file group sized for Haiku (under 100k tokens) unless the table names a Sonnet redesign.

**Frozen.** `get-shit-done/bin/project-deploy*.js` is not edited by any task. `project init` (create-only on a fresh project, exemption at `project-deploy.js:227-228`) and `project diff` are used as they are. No `sync-project` command, no three-way/managed-block work, no `extends`/`packs` support (`project-deploy-render.js:153` rejects both). C-02 and C-03 are cancelled.
*One test-only exception:* `project-deploy.test.js:449` (the `cli` helper passes `env` straight to `spawnSync`). After 2.1 the `project init` dispatch allocates a port before the engine runs, and `cli(['init', …])` at `:679` runs with slug `demo` (`:18`), so it would write the real `~/.gsd/projects.json`. 2.1 changes that one line to `env: { ...env, GSD_HOME: <tmp dir> }`. No assertion and no engine file changes.

**Critical path: review rounds to zero findings.** Fresh Sonnet reviewer each round. Capped by the project rule: after round 4 a Fable ruling on the last round's findings decides whether another round runs or the loop closes.

| Piece | Tasks | Why it is a boundary |
|---|---|---|
| Missing-brief gate | 1.3 | Only thing that stops a plan/execute run with no project context |
| UI-QA gate no-op + lock hook no-op | 2.2, 2.3 | Decides whether a phase can pass with no UI QA evidence; must not open for legacy projects |
| Port/slug registry | 2.1 | A wrong allocation makes two projects share ports |
| Settings fragment, deploy deny rows, every deployed hook, canary runner, hook-change tooling | 3.2-3.5, 3.9-3.12, 3.8 | The guardrail files every new project gets; 3.8 is the Fable review |
| Gate script whose marker the push hook trusts | 8.7 | A marker written on a red run opens the push |
| Stack lock | 8.4 | Two holders at once corrupt a shared stack; Node has no kernel lock |
| Style gate, duplicate detector, default gate list | 9.2, 9.3, 9.13 | Decide what blocks a PR in every new project |
| Mutation tool safety, restore, verdict and CLI; stale-process reaper | 9.4, 9.5, 9.6, 9.9 | Edit files in place / kill processes; a wrong verdict is a false proof |
| Legacy API globs and the tier gate | 5.10 | Dropping the two legacy API patterns would let a legacy project pass the phase gate with no UI QA after an API change |
| Risk-domain generalisation | 6.1-6.4 | The T0 / threat-model rule for critical paths must not weaken; 6.4 is the Fable diff review |

**Everything else: at most ONE ordinary Sonnet round**, batched per plan (rules and docs prose, lessons, skills, plain script ports, the sweeps, the pilot). Fix its findings, close.

**Ruling (recorded): one round is accepted for the canary gate and guard registry (8.8, 8.9), ADR reconcile (9.10) and the assertion-quality lint (9.11).** They are checks that run in the project's own CI or pre-PR gate and turn a warning into a failure; they are not agent guardrails (they sit in no hook and no deny list, and no agent action depends on their verdict). A fail-open bug in one of them lets a CI check pass that should have failed; it cannot let an agent edit a protected file, push, or kill a process. The dependency scan (9.7) is different (a missing or mis-parsed scanner passing silently hides a vulnerable dependency) and is a must-confirm item instead.

**Mutation testing only on gates, locks, hooks' config wiring and allocation:** 1.3 (gate), 2.1 (allocation), 2.2 and 2.3 (no-op), 3.12 (deny slots), 5.10 (legacy API globs), 8.4 (lock), 9.2 and 9.3 (style gate), 9.4 (restore), 9.7 (fail-open paths of the dependency gate), 9.13 (gate list). Mutants are listed in the task; scripts stay in `.tmp/`, the summary records one line per mutant. Hooks are proven by their canary rows (a flipped row must fail the runner), not by mutants. No mutation anywhere else.

**Before any new "rounds to zero" loop starts on code not in the table above**, a Fable ruling states whether it is on this critical path; if not, one round and a recorded freeze (S:128).

**Plan-time decisions (mine, Fable tier; reviewers may challenge with evidence):**

1. *Legacy project* = `.planning/config.json` has no `stack.capabilities` object (no `stack` at all, or a `stack` that holds only what the 2.1 wiring wrote). The UI-QA phase gate keeps today's behaviour for legacy projects. It is a no-op only when `stack.capabilities` is an object with no own `ui_qa` key. A `ui_qa` key with any value means required; an invalid value (`ui_qa: true`) also fails `profile check`. The 2.1 wiring never creates `stack.capabilities`. The lock hook is a no-op whenever there is no valid `ui_qa` capability object (legacy included).
2. *Missing-brief gate* is code, not prose: `init plan-phase|execute-phase` exits 1 when the brief or profile is missing, or when `validateProfile` reports a `missing` or an `invalid` key. Escape: `--legacy` flag or `GSD_LEGACY=1`. Every workflow and reference that calls those two `init` commands passes the flag through (4.3); an unattended run exports `GSD_LEGACY=1`.
3. *Parameters* of base files are `{{dot.path}}` placeholders rendered at `init` (K: section B). A missing key fails `init` (`renderText` collects it in `missing`, `project-deploy-render.js:50-54`; `:6` is only the placeholder regex), so the wiring of 2.1 writes the defaults first: `project.owner_title` "owner", `stack.branch.default` "main", `stack.commands.search` "git grep -n", `stack.commands.pre_pr_gate` "scripts/pre-pr-gate.sh". Besides these four text keys the only placeholders are the five deny slots `stack.deploy.slot_1..5`, derived by the wiring from the list `stack.deploy.never_touch` (3.12: the engine renders scalars only, `project-deploy-render.js:25, 56`). All nine values are restricted to `[A-Za-z0-9 ._/-]` because they are rendered into Perl, shell and JSON files. Every other command, list and pattern is read from the config at run time. Changing a rendered value after `init` means editing the deployed file by hand until `sync` exists.
4. *One base deployment, default on.* Every base file deploys to every project. Two file groups are gated, only because the stack makes them meaningless otherwise: `stack.capabilities.backend` (handler-correctness and data-integrity rules, the security skill) and `stack.capabilities.web_ui` (e2e-assertion, frontend-testability and QA-exemption rules, the assertion-quality lint). Mechanism: `"capability": "<key>"` on the file entry, included when the key is an object (`project-deploy-render.js:254-255`). The interview decides and is **on when unsure**; "off" is the explicit value `false`. When `stack.capabilities` exists and a key is absent, the 2.1 wiring writes `{}` (on). When `stack.capabilities` is absent the wiring stops and names the key (it cannot guess without flipping a legacy project, decision 1).
5. *The UI QA driver pack is a separate mechanism and stays one.* The core and the base preset must not name a driver, so its agent lives at `get-shit-done/presets/packs/charlotte` and `gsd-tools pack install charlotte` copies the agent file if absent and prints the settings entries for the owner to add. It is the only "pack"; it is not know-how and is installed only when the interview names a driver.
6. `.gitignore` lines come from the engine (`project-deploy-apply.js:12`); the preset cannot add any. `.tmp/` is a line of guidance in the base CLAUDE.md. Consequence for the push marker: it lives in the git dir, not the repository root (3.5, 8.7).
6a. *Traced, `init` on files that already exist:* absent → `create`; whole file byte-equal → `adopt` (`project-deploy.js:73-75`); whole file that differs → `conflict: exists and is not managed`, that file is not written, the rest is, exit code 2 (`project-deploy-files.js:45`, `project-deploy.js:295`); CLAUDE.md without markers → the managed block is appended, project text untouched (`project-deploy-files.js:122-129`); an existing `.claude/settings.json` ends the fresh-project exemption (`project-deploy.js:227-228`), so inside an agent session any hook or settings write is refused and nothing is written (`project-deploy-guard.js:118-125`). So `init` is copy-if-absent, never overwrite.
6b. *Traced, no `doctor`:* the CLI is `init|diff|sync` (`project-deploy.js:259-260`). The report is the existing read-only `project diff` (never refused, `project-deploy-guard.js:119`) plus `profile check`. `diff` stops with `no preset` unless `--preset` is passed or `stack.preset` is set (`project-deploy.js:152-153`): the interview writes `stack.preset` and every `diff` call in this plan also passes `--preset`.
6c. *Traced, what the engine guards:* a deployed file is guarded when its preset entry says `guarded: true`, when its top directory is `.husky` or `.githooks` (`project-deploy-guard.js:14`), or when a hook command names it or its directory (`:100-101`). Nothing under `scripts/` and no `lib/` file below a hook directory is guarded by itself. Every enforcement file therefore carries `guarded: true` explicitly (M-03 objective, 8.4, 8.7, 9.2) and 3.7 asserts it.
7. No A/B replay (`scripts/ab-eval` needs the igaming repo). D:296 R1 is accepted for the branch and becomes a cutover gate.
8. MANDATE-6 does not apply: no task moves money or changes authentication. 6.x changes the wording of the risk rule and is treated as critical path instead.
9. Nine plans, executed in the order M-01, M-02, M-03, M-08, M-09, M-04, M-05, M-06, M-07. M-03 is the guardrail half of the base deployment (CLAUDE.md, settings, five hooks, canaries, the Fable review); M-08 is the know-how half (rules, lessons, scripts, skills, the two gated groups); M-09 is the clean-code mandate, the style gate and the tools the first re-plan left behind. All three run before the interview and the pilot.
10. Scripts that igaming runs on a runtime the new project may not have are moved to plain Node (`.mjs`): Node is the one runtime GSD itself requires. A *port* changes the runtime calls and removes type annotations, nothing else. Where the source cannot be carried that way the task is a named *redesign*, states what is kept and what is dropped, and is implemented by Sonnet: 3.9 (lock-command hook), 3.11 (flake hook), 8.4 (stack lock: no kernel lock in Node), 8.8 (canary corpus discovery), 8.9 (reconcile against one document), 9.2 (style gate), 9.5 (mutation runner seam).
11. *Nothing transferable is left in igaming.* The earlier "not ported, available in igaming at `<path>`" list is withdrawn. Where each item goes: flake-pattern hook → 3.11; mutation tool → 9.4-9.6; style gate with the oversize ratchet → 9.2; dependency gate → 9.7; host guards → 9.8, 9.9; `check-assertion-quality`, `findings-register`, `freshness-tracker`, `adr-reconcile` (K:157) → 9.10-9.12; the three `production` deny rows → 3.12 (K:123-124).
12. Work stays on `exp/agnostic`; no task pushes.
13. *Style gate.* One Node script, rule sets as data (`js-ts`, `python`, `generic`), a per-directory ratchet whose missing baseline means zero. `oversizeFiles` and `duplicateBlocks` run for every rule set. The source has no rule for mutating an input (`fp-gate.ts:58-65` lists its seven rules); the pilot requires one, so `inputMutation` is new code in 9.2, with its limits stated in the file and a per-line escape `style-gate:ignore <reason>`. The default config (`generic`, roots `["."]`) scans the deployed tree itself unless told otherwise, so the gate always excludes every `dest` in `.planning/gsd-project-manifest.json` and `generic` lists source extensions only (9.2, test S-i).
14. *Duplicate detection without a dependency.* A line-window detector is estimated at 90 lines of Node, so the gate does not shell out to an `npx` tool and needs no fail-soft path. Ceiling 150 lines; above it the executor stops and a Fable ruling decides (9.3).
15. *Fork CI is `ubuntu-latest` running `npm test`* (`.github/workflows`, `package.json:64`). No test and no deployed script may need a macOS-only tool: the canary runner sets file times with `perl utime` instead of `date -v` (3.4), the memory guard gets a Linux branch (9.8).

**Corrections to the sources, recorded here:**
- K:121 says "17 of 20" deny lines are generic, K:22 and K:200 "17 generic deny rules". The array has 19 rows (`.claude/settings.json:299-317`): 16 generic, 3 `production`. The base carries 16 + 3 secret-read rows + 5 deploy slots.
- K:79 and K:155 class `fp.md` and `fp-gate` as PROJECT style / "later, optional". Overruled by the owner: default mandate and default gate.
- K section C row 8 says to move two files "next to this report", which is inside the igaming checkout; no task writes there, so they go to the fork with row 9 (8.14).
- Plan-check finding 6 reads "the marker lives under the git dir". In the source it is at the repository root (`block-push-without-local-tests.pl:49`, `preflight.sh:1620`, kept out of commits by `.gitignore:7`). The git-dir location is adopted as a design change for base (decision 6), not as a description of the source.
- Plan-check finding 8 puts both shared row groups in 3.9. The 12 `@edit-all` rows run the `Write|Edit` hooks, and the base has none until 3.11, so they are carried there; the 82 `@bash-all` rows are in 3.9.
- The previous 8.8 asked for "two red, one green" canary fixtures. The source fails on any fixture the guard does not flag (`canary-gate.ts:121`), so all three must be bad inputs.
- The previous 8.4 asked for "a lock whose owner process is gone is taken over (port the stale-lock case)". The source has no such case; its case at `stack-lock.test.ts:221` asserts the opposite for `owner.txt`. 8.4 now states the lock design.

## 1. Rules for every task

- One executor at a time, in the order below. Haiku implements (`Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`) unless the table says Sonnet; read line ranges, never whole `gsd-tools.js` (16,435 lines) or `gsd-tools.test.js` (18,246 lines).
- Nothing touches `~/igaming-platform` (read-only where a task says so; the verbatim copy at `get-shit-done/presets/igaming/` is preferred), `~/.claude`, `~/.gsd`, or runs `install:gsd`. Workflows name `$HOME/.claude/get-shit-done/bin/gsd-tools.js`; executors run the worktree copy.
- Safe git probing: `agents/gsd-executor.md` section '## Safe git probing' binds every executor (no destructive git, `git -C <abs-path>` only, no probing by running destructive commands).
- After each task: the full gate used in A-C (`B-FIX3-SUMMARY.md`, "Full gate") green, then `node scripts/agnostic-lint.js check`. A `STALE` line means a count fell: run `node scripts/agnostic-lint.js write-baseline` and commit the baseline with the task.
- **Allow-list raise rule.** An allow-list entry moves lines from `denied` to `allowed`, so `allowed` rises and `write-baseline` refuses (`scripts/agnostic-lint.js:210-213`; `compare` covers both kinds, `:141`). `--allow-raise` is permitted in exactly one case: the task added allow-list entries, and `check` run just before prints `RISE allowed <file> <class>` rows only for the (file, class) pairs of those entries, and no `RISE denied` row. The summary quotes each entry with its reason and the RISE rows. Any other rise is a defect to fix, not to raise. Tasks that use the rule: 2.2 (alias key lines), 2.3 (installer stale-entry literal), 5.3 (four quota-step names), 5.10 (alias line, two legacy API patterns, `gsd-tools.js:2904` enum value), 5.11 (interpreter and bypass lists), 5.12 (a keyword list, if one must stay), 6.5 (flag alias), 7.1 (any last generic list).
- New tests go in the named new test file (registered in `package.json:64`); `gsd-tools.test.js` grows only where a task cites the fixture builder it must reuse. Base-preset tests are split by concern: `preset-base.test.js` (deployment, hooks, pilot), `preset-base-scripts.test.js` (deployed scripts), `preset-base-style.test.js` (style gate), `preset-base-mutate.test.js` (mutation tool).
- Each plan is written as `type="auto" tdd="true"` tasks: tests first, in the same task. No `.tsx/.jsx`, no frontend consumer: no `checkpoint:ui-qa`, `e2e_flows: []`.
- Summary per plan: `M-0N-SUMMARY.md`, under 60 lines, counts and commits only.

## 2. Ordered task list (74 tasks, in execution order)

| # | Task | Plan | Tier | Review |
|---|---|---|---|---|
| M-00 | Append `## Freeze` to `B/B-FIX3-SUMMARY.md`; mark `C/C-02-PLAN.md`, `C/C-03-PLAN.md` cancelled (text in section 3) | index | Haiku | none |
| 1.1 | `project-context.js`: context fields + presets; wire `init new-project`, `plan-phase`, `execute-phase` (D1, D4a) | M-01 | Haiku | 1 round |
| 1.2 | Wire the remaining `cmdInit*` (D4b) | M-01 | Haiku | 1 round |
| 1.3 | Missing-brief gate + `--legacy` (D6) | M-01 | Haiku | to zero |
| 2.1 | `project-registry.js`: slug + `port_base` registry and base defaults, validated then wired before `project init` (G1) | M-02 | Haiku | to zero |
| 2.2 | Phase gate: UI-QA no-op without capability, `ui_qa_ran` + alias (E2-minimal) | M-02 | Haiku | to zero |
| 2.3 | Lock hook → profile-driven `gsd-ui-qa-lock.js`, verdict-identical; installer registration (E3) | M-02 | Haiku | to zero |
| 2.4 | Move the QA agent to `presets/packs/charlotte`; `pack install` (E3) | M-02 | Haiku | 1 round |
| 2.5 | `gsd-demo.md`, `demo-check.js`: driver-neutral names (E3) | M-02 | Haiku | 1 round |
| 2.6 | Remove the `:3000` fallbacks (G4) | M-02 | Haiku | 1 round |
| 3.1 | Base CLAUDE.md (full methodology + clean-code mandate), `preset.json`, profile keys (K: T1, T7 part) | M-03 | Haiku | 1 round |
| 3.2 | Settings fragment: generic deny/ask, read-only allow, secret-read deny (K: T2) | M-03 | Haiku | to zero |
| 3.12 | Never-touch deploy commands → five rendered deny rows (K:123) | M-03 | Haiku | to zero |
| 3.3 | Hook shell + recursive-search redirect (K: T3) | M-03 | Haiku | to zero |
| 3.4 | Canary runner without macOS-only tools + rewritten rows, rendered (K: T4) | M-03 | Haiku | to zero |
| 3.5 | Merge-target and push-gate hooks (marker in the git dir) + rewritten rows (K: T5) | M-03 | Haiku | to zero |
| 3.9 | `check-test-command` hook, profile-driven redesign + rows + 82 shared Bash rows (K: T8 part) | M-03 | Sonnet | to zero |
| 3.11 | `check-flake-patterns` hook, profile-driven redesign in Node + rows + 12 shared edit rows (K:94) | M-03 | Sonnet | to zero |
| 3.10 | `hooks-apply.sh` + `hook-patch-trailer-check.sh` with a floor parameter (K: T8 part) | M-03 | Haiku | to zero |
| 3.6 | Rule `testing.md` (full kernel) + skill `finishing-a-development-branch` (K: T6, T9 part) | M-03 | Haiku | 1 round |
| 3.7 | Regression guard for the base deployment, shared exception list, hook registrations and `guarded` flags (K: T14) | M-03 | Haiku | 1 round |
| 3.8 | Fable review: fragment row by row, five hook registrations, tooling; fixes | M-03 | Fable + Haiku | is the review |
| 8.1 | Rule `shared-stack.md`, `host-ops.md`, file-claims and cleanup-keep templates (K: T7 part) | M-08 | Haiku | 1 round |
| 8.2 | `agent-ops-lessons.md` from 27 memory files + A/B and flow findings (K: T7 part) | M-08 | Haiku | 1 round |
| 8.3 | `engineering-lessons.md` from 17 memory files + `defect-classes.md` (K: T9 part) | M-08 | Haiku | 1 round |
| 8.4 | Stack lock: Node redesign (exclusive lockfile, pid liveness, takeover step) + shell wrapper (K: T8 part) | M-08 | Sonnet | to zero |
| 8.5 | Session supervisor + its doc (K: T8 part) | M-08 | Haiku | 1 round |
| 8.6 | Rules `guard-authoring.md`, `pre-pr-gates.md`, `module-structure.md` (K: T9 part) | M-08 | Haiku | 1 round |
| 8.7 | `pre-pr-gate.sh` skeleton + disagreement log; writes the push-hook marker in the git dir (K: T10 part) | M-08 | Haiku | to zero |
| 8.8 | Canary gate + guard registry + sample guard, Node redesign of corpus discovery (K: T10 part) | M-08 | Sonnet | 1 round |
| 8.9 | Guard-registry reconcile, Node redesign against one document (K: T10 part) | M-08 | Sonnet | 1 round |
| 8.10 | CI diagnose, Node port (K: T10 part) | M-08 | Haiku | 1 round |
| 8.11 | Skills `test-enforcement`, `create-unit-test`, `create-documentation` (K: T10, T12 part) | M-08 | Haiku | 1 round |
| 8.12 | Gated group `backend`: handler-correctness, data-integrity, security skill (K: T11) | M-08 | Haiku | 1 round |
| 8.13 | Gated group `web_ui`: e2e-assertions, frontend-testability, qa-exemptions (K: T12) | M-08 | Haiku | 1 round |
| 8.14 | Preserve memory, tools, A/B inventory and run data (K: T13, section C rows 3, 7, 8, 9), only if the fork remote is private | M-08 | Haiku | 1 round |
| 9.1 | Rule `code-style.md`: clean code, DRY, functional style + review checklist | M-09 | Haiku | 1 round |
| 9.2 | Style gate: rule sets, input-mutation rule, oversize ratchet, baseline (K:155) | M-09 | Sonnet | to zero |
| 9.3 | Duplicate-block detector, dependency-free, as rule `duplicateBlocks` | M-09 | Haiku | to zero |
| 9.4 | Mutation tool, safety half: options, guards, worktree, restore (K:151) | M-09 | Haiku | to zero |
| 9.5 | Mutation tool, runner seam redesign: profile test command, exit-code verdict | M-09 | Sonnet | to zero |
| 9.6 | Mutation tool: CLI, document, profile key (CLI process tests: refusals, SIGTERM restore) | M-09 | Haiku | to zero |
| 9.7 | Dependency-vulnerability gate, Node port with a lockfile parameter (K:157) | M-09 | Haiku | 1 round |
| 9.8 | Host guards: memory and container-disk report scripts (K:156) | M-09 | Haiku | 1 round |
| 9.9 | Stale test-process reaper with profile worker patterns, platform `ps` read (K:156) | M-09 | Sonnet | to zero |
| 9.10 | Doc freshness tracker + ADR reconcile, Node ports (K:157) | M-09 | Haiku | 1 round |
| 9.11 | Assertion-quality lint, Node port, `web_ui` group (K:157) | M-09 | Haiku | 1 round |
| 9.12 | Findings register, Node port (K:157) | M-09 | Haiku | 1 round |
| 9.13 | Default `stack.gates[]` and `stack.style` written by the init wiring | M-09 | Haiku | to zero |
| 4.1 | `new-project.md`: brief step (D2) | M-04 | Haiku | 1 round |
| 4.2 | `new-project.md`: stack step (rule set, never-touch deploy commands, flake patterns) + `project init` (D2) | M-04 | Haiku | 1 round |
| 4.3 | `/gsd:init-project`; `--legacy` pass-through in every caller (D3, D6) | M-04 | Haiku | 1 round |
| 4.4 | Pointer block, agents a-m (D5) | M-04 | Haiku | 1 round |
| 4.5 | Pointer block, agents p-z + presence test (D5) | M-04 | Haiku | 1 round |
| 5.1 | Sweep `references/coordinator-detail.md` | M-05 | Haiku | 1 round |
| 5.2 | Sweep `references/verifier-detail.md` | M-05 | Haiku | 1 round |
| 5.3 | Sweep `workflows/execute-roadmap.md` | M-05 | Haiku | 1 round |
| 5.4 | Sweep `workflows/execute-phase.md`, `execute-plan.md`, `demo.md` | M-05 | Haiku | 1 round |
| 5.5 | Sweep agents: verifier, phase-coordinator, executor, planner, plan-checker | M-05 | Haiku | 1 round |
| 5.6 | Sweep the other agents | M-05 | Haiku | 1 round |
| 5.7 | Sweep references (test-protocol, planner/executor-detail, checkpoints, service-health, small ones) | M-05 | Haiku | 1 round |
| 5.8 | Sweep commands + milestone workflows (E1, E6) | M-05 | Haiku | 1 round |
| 5.9 | Sweep templates + `hook-config.json` (E7) | M-05 | Haiku | 1 round |
| 5.10 | Sweep `gsd-tools.js` (API globs with legacy patterns kept, tier gate argv, strings) | M-05 | Haiku | to zero |
| 5.11 | Sweep other `bin/` modules | M-05 | Haiku | 1 round |
| 5.12 | Sweep the fifteen single-hit files | M-05 | Haiku | 1 round |
| 6.1 | `effectiveRiskDomains` + term-coverage test + tracked igaming project block incl. its run-time stack keys (E4) | M-06 | Haiku | to zero |
| 6.2 | Risk wording in planner, plan-checker, test-writer, coordinator + other agents (E4) | M-06 | Sonnet | to zero |
| 6.3 | Risk wording in references and workflows (E4) | M-06 | Sonnet | to zero |
| 6.4 | Fable diff review of 6.1-6.3; fixes | M-06 | Fable + Haiku | is the review |
| 6.5 | Owner title: "CEO" → the owner (E5) | M-06 | Haiku | 1 round |
| 7.1 | Final ratchet: baseline = Telegram only, lint test | M-07 | Haiku | 1 round |
| 7.2 | Pilot: three throwaway projects, full deployed-file list, default gates, style gate red on a planted throw, input mutation and duplicate block (H3) | M-07 | Haiku | 1 round |
| 7.3 | Interview dry-run transcript (H3) | M-07 | Sonnet | none |

Dependencies: 1.1 → 1.2 → 1.3; 2.x need 1.1; 2.4 needs 2.3; 3.x need 2.1 (defaults, value restriction, wiring); 3.12 needs 3.2; 3.9, 3.11 and 3.10 need 3.4 (runner); 3.8 needs 3.2-3.5, 3.9-3.12; 8.x need 3.7 (the guard they extend); 8.7 needs 3.5 (marker); 8.4 before 8.5; 9.x need 8.8 and 8.9 (registry contract) and 8.6 (module rule); 9.3 needs 9.2; 9.4 → 9.5 → 9.6; 9.13 last in M-09 (every default gate script must exist); 4.x need 3.x, 8.x, 9.x and 1.3 (the interview describes what `init` deploys); 5.x need 2.2-2.6 and 4.5; 6.x need 5.x (same files); 7.x after 6.x. K: R0 (pushing branches) is an owner action and already done for the fork.

After M-07: one batched Fable diff review of the plans not reviewed by 3.8 or 6.4, then the phase-end verifier, per the project rule. **Must-confirm items of that review** (each closed with file:line and a test, or raised as HIGH): the 8.4 diff (lock design, the seven mutants), the 8.7 diff (marker written only on a green run, in the git dir), 9.2 and 9.3 (the gate cannot pass with a new violation), 9.4 and 9.5 (no target left mutated, no survivor reported as killed), 9.6 (the CLI exit-2 refusals and the SIGTERM restore hold end to end; the restore functions of 9.4 are the ones the CLI calls), 9.7 (the fail-open paths: a missing scanner exits 0 only with `allow_missing_scanner`, non-JSON scanner output fails, the baseline matches the exact finding), 9.9 (nothing with a live owner is killed), 9.13 (no default gate lost, none overwritten). Also asked of the review: the 8.4 limit that a lock holder paused for more than 10 s inside the create-to-write window can be judged dead (stated in the file header).

## 3. M-00 text

Append to `.planning/agnostic/B/B-FIX3-SUMMARY.md`:

```
## Freeze

The deploy engine (`get-shit-done/bin/project-deploy*.js`) is frozen at 0b9c35a. No round 4.
Unreviewed for production: the guard heuristics (hook-reference matching, session/ancestor checks,
typed confirmation), the `assigned_secret` / `url_credentials` scan rules, and every `sync` path
(three-way merge, managed blocks, settings set-merge, rollback). They get a fresh review at the
igaming cutover. Reviewed and in use now: `project init` on a project with no `.claude/settings.json`
(create-only) and `project diff`.
```

First line of `C-02-PLAN.md` and `C-03-PLAN.md`: `> CANCELLED (M-00-PLAN-INDEX.md section 0). Not executed; redo at cutover.`

## 4. Postponed to the igaming cutover (not planned here)

`sync`, three-way, managed blocks, settings merge for a driver pack, G2 machine locks, G3 knowledge/routing scoping, golden-hash cutover (F-golden, H1, H2), `project doctor`. Cutover prerequisites created by this plan:

1. igaming `config.json` gets its `project`/`stack` blocks before the install, taken from the tracked `get-shit-done/presets/igaming/project.block.json` (6.1): `risk_domains` is a superset of the seven terms of `tests/fixtures/agnostic/risk-terms.json`; `capabilities.ui_qa` with `lock_file: ".tmp/charlotte.lock"` and its reset literals (2.3); `capabilities.backend` and `web_ui`; `paths.api_globs` (5.10); `gates[]` incl. `tier-assignment` (5.10), `tier-delta` and the Layer-1 gate ids (fp ratchet, migration security, CVE scan; Fable round 1 H1: `project.block.json` carries no `capabilities`, `paths`, `gates` or `services` today, so the cutover writes them; a legacy project without `stack.gates` runs the repo's shipped gate scripts); `services[]` (2.6); `locked_commands` (3.9); `flake_patterns` holding the three igaming categories (3.11); `style` with `rule_set: "js-ts"`, its roots and a baseline seeded once with `--seed-baseline` (9.2); `host.worker_patterns` (9.9); all four written into the block by 6.1. `deploy.never_touch` is `[]` for igaming: its three production rows carry a wildcard before the target (`.claude/settings.json:311-313`), which a prefix row cannot express, so they stay as literal rows in igaming's own settings at the cutover.
2. `gsd-tools pack install charlotte` in the igaming checkout (2.4 moves the QA agent out of `agents/`, so the installer no longer ships it).
3. A/B replay of igaming tasks before and after the prompt sweep (decision 7).
4. Fresh review of the frozen engine (M-00).
