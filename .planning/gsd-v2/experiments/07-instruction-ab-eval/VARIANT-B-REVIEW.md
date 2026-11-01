# Variant B drafts — Opus review (2026-11-01)

Scope: `agents/v2/gsd2-*.md` (+ `.c.md`) vs arm A `agents/gsd-*.md`, against `VARIANT-B-WAVE1.md`, `VARIANT-B-WAVE2.md`, `DESIGN.md` §3, `DESIGN-ALL-AGENTS.md` §3, `research/03` (I1-I4, F1-F5), `06-PROBES.md`, `DECISIONS.md`. All fixes are in the drafts in this commit; my edits have not been re-reviewed by a second agent.

## Verdict

| Draft | Arm after this review | Verdict |
|---|---|---|
| gsd2-runner | new def (H1) | ready |
| gsd2-docs-updater | B | ready |
| gsd2-phase-coordinator.md | B (new, pure: A compressed, 9,200 B) | ready for C1-C3 A vs B |
| gsd2-phase-coordinator.c.md | Q / exp 10 (D1 foreground waits; was the B file) | ready for C1-C3 Q; live use waits on P3 (waits > 4 min) and `verify plan-done` (does not exist; manual fallback inlined) |
| gsd2-executor (+ .c.md) | B; C = B + Anthropic paragraphs | ready |
| gsd2-test-writer.md | B (rewritten pure from A) | ready |
| gsd2-test-writer.c.md | Q (RED mode, no prod edits, gsd-mutate; was the B file) | ready |
| gsd2-reviewer | Q-only new def (never B, DESIGN §3.1 rule 2) | ready |
| gsd2-plan-checker | B | ready (no change) |
| gsd2-verifier | B | ready |
| gsd2-planner (+ .c.md) | B; C = B + skeleton + escalate + Edit | ready |
| gsd2-debugger (+ .c.md) | B; C = B + method | ready |

The eval itself is blocked by finding 5 (harness, outside the drafts).

## Findings

| # | Draft | Sev | Issue | Fix |
|---|---|---|---|---|
| 1 | gsd2-reviewer | HIGH | "T0 allows up to 3 rounds fixing MED and above, then one batched Opus review" is D6's T0 row (`05:83`), which DECISIONS 2026-10-31 rejected (round caps on non-T0 only; LOWs not batched) and which contradicts CLAUDE.md (every severity fixed, loop to zero). Readable as permission to stop reviewing T0 and leave T0 LOWs. "At the cap report only CRIT and HIGH" also contradicts "a script filters, report every LOW". | Round policy is the caller's; T0 is never round-capped and every severity on it is fixed; the reviewer reports every supportable finding in every round. |
| 2 | gsd2-phase-coordinator | HIGH | The B-slot file was the D1 quality-fix variant (wave 1 calls it that; DESIGN-ALL §3 puts D1 in the coordinator's Q column). No pure B existed, so C1-C3 "A vs B" would confound D1 with slimming. | `git mv` to `gsd2-phase-coordinator.c.md` (Q / exp 10). New pure B written from A: polling wording, spot-check HARD FAIL, inline-verifier fallback with `verifier: coordinator`, return enum kept; Telegram, MILE-26, Glob/Grep/WebFetch, "Haiku cost" pointer deleted; digest compressed. |
| 3 | gsd2-test-writer | HIGH | B carried the Q arm: RED mode, "never edit production code" (A step 6 says fix a genuine impl bug), role rewrite, gsd-mutate recipe. DESIGN-ALL §3 lists these as Q; the wave-2 log says "the B arm already carries Q". TW1/TW2 oracle (d) "no prod edits" grades exactly the changed behaviour. | Draft moved to `gsd2-test-writer.c.md`; B rewritten from A (role, impl-fix step, worktree mutation rule kept; telemetry, Grep/Glob/Agent/Task deleted; fixtures compressed). |
| 4 | coordinator .c.md | HIGH | F3 resume and executor contract: `## PLAN INTERRUPTED` fell into "any other failure" (one redispatch, then plan failed), although the executor def says it is not a retry; a resumed partially executed plan got a fresh executor with no resume brief, so it would redo committed tasks. | Interrupted: immediate continuation, not a retry; BLOCKED: fail with split; a plan named by TASK-CHECKPOINT/EXECUTOR-HANDOFF is spawned with `gsd-tools resilience resume-brief {phase}` (subcommand exists, `gsd-tools.js:14929`). |
| 5 | harness (not a draft) | HIGH | `ab-eval/variants/B/roles.json` maps `review` to `gsd2-reviewer` in B (DESIGN §3.1 rule 2 forbids; DESIGN-ALL §3 reviewer B = inherited-block cut only). `variants/B/agents.json` was built from the pre-review drafts (coordinator tools still `Edit, TaskStop`). | Not edited (outside scope). Rebuild agents.json from this commit; B `review` -> general-purpose; gsd2-reviewer and every `.c.md` only in Q/C variants. |
| 6 | gsd2-runner | HIGH | Hard-coded `cd /Users/ollorin/igaming-platform/apps/api`: eval runs sit under `/Users/ollorin/ab-eval/runs/...`, and the harness denies the live repo as a contamination root (DESIGN §4.4), so H1 B runs would be denied or voided. | `<repo>` = the repository the runner was started in (production path given as an example). |
| 7 | coordinator .c.md (and B) | MED | Tiering line dropped A's "gsd-verifier, preceded by a Sonnet pre-verification of all must-haves with on-disk evidence" (A `gsd-phase-coordinator.md:185`). Verify step did not run it. | Restored in tiering and in step 7 of .c.md; B carries A's wording. |
| 8 | coordinator .c.md | MED | Planner spawned with no model although CLAUDE.md requires opus for money/auth/security/RNG/KYC plans; the batched Opus diff review appeared only in the tiering line, not in the execute procedure. | Planner model rule in step 3; Opus batched diff review for T0 plans in step 4. |
| 9 | coordinator .c.md | MED | Executor `## CHECKPOINT REACHED` of type decision / human-action / human-verify had no handling (only ui-qa). | Return `human_needed` with the block in `human_items`. |
| 10 | gsd2-debugger (+ .c.md) | MED | `goal: find_and_fix` returned DEBUG COMPLETE straight after self-verification; A requires a human-verify checkpoint in interactive runs (`gsd-debugger.md:351-355`). Silent behaviour change. | Human-verify checkpoint before DEBUG COMPLETE unless `interactive: false`. |
| 11 | gsd2-verifier | MED | 8g `--no-check` guard moved from a `grep` of two files to `zg query`; the zg index is never auto-refreshed (memory `reference_zg_index_refresh`), so a freshly added `--no-check` can pass the gate. | Read `apps/api/deno.json` and `apps/api/project.json`. |
| 12 | gsd2-executor | MED | gsd-mutate sentence is an addition (A def has no mutation rule; source `testing.md:141`); "Unit-level" can be read as "only TS-unit mutants are required" for T0 SQL paths. | Removed from B. Not put in executor C (DESIGN §3.3: C = the two paragraphs only); carried by test-writer C with SQL/live mutants kept manual in a `.tmp/wt-*` worktree. |
| 13 | gsd2-planner | MED | `Edit` in tools and "change the existing PLAN.md in place with Edit" are additions that favour B on P2 (the revision task). | Moved to planner C. |
| 14 | gsd2-docs-updater | MED | "Write only under docs/ and CHANGELOG.md. Do not touch .claude/rules/ or any source file" is an added rule aimed at DU2's critical. | Removed; the deletion of A's `api-conventions.md` branch (`gsd-docs-updater.md:204-208`) stays (pure delete). Rule listed for Q. |
| 15 | gsd2-reviewer | MED | No T0 test check (real DB, positive control, real concurrency, mutant kill), so a mock-only T0 diff could come back `[]`; "allowlisted test shapes" allowed integration runs on the unlocked shared stack. | T0-test bullet (missing item = at least HIGH); unit shapes only, nothing touching the stack. |
| 16 | gsd2-runner | MED | With `omitClaudeMd` and no test-file Reads, the testing.md rule "a run counts only with its count" never loads, so exit 0 with 0 tests could be PASS; the `df -h` line implied the runner may db reset without the lock; relative `.tmp/` resolves under `apps/api/`. | PASS needs a count > 0 and the runner's success line; no db reset/serve/Charlotte, integration only via `run-integration-tests.sh` (self-locks, `:132`); absolute log path. |
| 17 | MOVES (CLAUDE.md B plan) | MED | DESIGN §3.2 moves tiering, Opus points, parallelism ceiling, same-phase executor rule, stack lock and db-reset rules to `docs/rules/orchestration.md`, which no def tells any agent to read (06 P9: a move to an unread file is a delete). | B coordinator now carries them, compressed, as the move destination. Open: executors would lose the stack-lock line (rules mention the lock only for writes, `testing.md:185`, `database.md:19`); keep a `.tmp/local-stack.lock` one-liner in CLAUDE.md B's leaf list. `variants/B/overlay/CLAUDE.md` is still the 18,446 B A copy, so nothing to fix there yet. |
| 18 | gsd2-executor (+ .c.md) | LOW | Compression dropped Rule 2 examples CSRF/CORS, null checks, error logging; checkpoint type-specific contents; post-checkpoint continuation actions; the "unsure and one task done, stop" self-stop line. | Restored, compressed. C resynced as B + paragraphs. |
| 19 | gsd2-test-writer (B) | LOW | Auth/validation sub-checks (401 vs 403, correct role passes) deleted as "duplicates of testing rules"; `testing.md` has no such list. | Restored as one line per category (also in C). |
| 20 | gsd2-planner (+ .c.md) | LOW | Commit instruction sat between the return block and the JSON trailer. | Moved before the block. |
| 21 | gsd2-planner.c.md | LOW | A-inherited: "database RPCs ALWAYS" vs "migration files SKIP"; a wallet RPC in a migration reads as skippable. B unchanged (= A). | C: logic-free migrations skip; a migration that creates or changes an RPC, trigger, RLS policy or grant needs a real-DB tdd task. |
| 22 | coordinator .c.md | LOW | Parallel disjoint fix executors could both write TASK-CHECKPOINT.json; I2 implied a hung foreground child is detectable. | Fix executors briefed fix-only; I2 states that a non-returning child is ended only by its wall budget and the supervisor. |

## T0-touching changes flagged in the change logs (16)

| Draft | Change | Ruling |
|---|---|---|
| executor | Rule 2 module-consistency and orphaned-side-effect sentences compressed | same obligations; OK |
| executor | test-writer spawn model haiku (A detail: router, else sonnet) | equals CLAUDE.md "gsd-test-writer: haiku"; A's default lived only in unread `executor-detail.md:348` behind the archived router; OK |
| executor | gsd-mutate sentence | removed (finding 12) |
| test-writer | T0 budget line | kept verbatim in substance; OK |
| test-writer | mutation step -> gsd-mutate | B reverted to A's worktree rule; C has gsd-mutate + manual SQL (findings 3, 12) |
| test-writer | prod-fix removed, RED mode | moved to C (finding 3) |
| reviewer | T0 list and round rule | HIGH, fixed (findings 1, 15) |
| plan-checker | Dim 8-T4 compressed | same five obligations as A `gsd-plan-checker.md:375-382` (inventory line, behaviour list, T0 tag, REUSE-only-if-T0-test with mutant id, warning); OK |
| verifier | 8d sensitive-path regex and exemption | regex identical to A `gsd-verifier.md:113`; OK |
| verifier | 8g-8j gates | outcomes kept; `--no-check` probe fixed (finding 11) |
| verifier | partial pass / `human_needed` rules | kept; OK |
| verifier | commit rule ("only when the brief says, own paths" vs A "DO NOT commit") | accepted: 86/88 briefs and A coordinator `:214-215` already order the commit; B is narrower (own paths). Behaviour change, LOW |
| planner | MANDATE-6 reworded | all of (a) threat model, (b) single RPC / transaction, POSTMORTEM 9 and 4, T0 tag, "implied" invalid, confirm-before-return kept; OK |
| planner | MANDATE-1 T0 REUSE, MANDATE-4 merged checklist | all 8 A checks present plus must_haves; OK |
| planner | testing gate and PLAN REJECTED block | kept; "do not return COMPLETE, SUMMARY or commit" kept; OK |
| planner C | money/auth tasks stay Haiku under Opus plan/review | matches CLAUDE.md high-stakes rule (Haiku implements, Sonnet/Opus when escalated); OK |

No remaining B wording reads as permission to skip a T0 gate. A-inherited T0 weakness, unchanged in both arms: verifier 8j(d) makes a missing T0 mutant row "not by itself gaps_found" (`verifier-detail.md:1209`), so a T0 test without mutation proof can pass on judgment. Needs an Opus ruling before any Q arm tightens it.

## B-purity rulings

| Item | Ruling |
|---|---|
| executor `auto_mode_detection` removed | Behaviour-neutral here: `igaming-platform/.planning/config.json` sets no `workflow.auto_advance`, so A's auto-approve branch never fires. Keep the delete. |
| plan-checker "Do not run the application. Static plan analysis only." | A's text is right for the role and stays. The 62/102 test-running checkers were largely off-label diff reviews (24/102, 07A X8) that belong to a reviewer; running tests also breaks "do not check code existence (verifier's job)" and touches the unlocked stack. A "never run tests or edit plans" rule is an addition (Q). |
| executor 0-test re-spawn once before blocking | Inline of A's own procedure (`executor-detail.md:382-385`); end state still blocks. Accept. |
| docs-updater `omitClaudeMd` in B | DESIGN-ALL §3 lists it under Q, §7 S13 says it blocks "DU (B)". It is a deletion of inherited context; accept in B and fix the DESIGN-ALL table. |
| `@` pointers -> "Read offset/limit" pointers | Allowed move form. Destinations exist; line numbers checked against the installed `~/.claude/get-shit-done/references/*` (same line count as the repo copies, only `~` expansion differs); `~/.claude/get-shit-done` is not a harness-denied root. |
| coordinator B carrying orchestration rules from CLAUDE.md | Move, not addition (finding 17). |

## Q backlog (additions found, not put in B)

docs-updater writable-path rule (14); executor JSON status for `## PLAN FAILED` (not in the trailer enum in A or B); executor gsd-mutate line (12); executor "stay alive" on decision/human-action checkpoints blocks a foreground coordinator (D1 interaction); plan-checker never-edit/never-run-tests rule; verifier 8j(d) T0 tightening (Opus ruling first).

## Residual risks (not fixable in a def)

- Q coordinator foreground waits: a child that hangs blocks the coordinator; only the child's wall budget, the D2 hook and `session-supervisor.sh` end it. P3 (waits > 4 min) is unprobed; 05-M7 foreground executors ran up to 201 min.
- `gsd-tools verify plan-done` does not exist (manual fallback inlined); `TaskStop` in `tools:` and `effort`/`maxTurns` in file frontmatter are unprobed (wave 1 open points).
