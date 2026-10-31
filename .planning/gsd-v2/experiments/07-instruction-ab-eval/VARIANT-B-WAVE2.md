# Variant B drafts, wave 2 (executor, test-writer, reviewer, plan-checker, verifier, planner, debugger)

Drafts in `~/get-shit-done/agents/v2/` (not installed: `bin/install.js:1564-1566` copies only top-level `agents/*.md`). Sources: `research/07-AGENT-AUDIT.md` (07A) rows 2, 3, 5-9 and X1-X10, `DESIGN.md` §3 and §3.2, `DESIGN-ALL-AGENTS.md` §1 and §3, `research/05` D4-D7, `research/04` P4/P5/P8, `DECISIONS.md` (no LOW batching; cap review rounds on non-T0). Tokens = bytes x 0.40. Emphasis = count of `MUST|NEVER|CRITICAL|HARD|DO NOT|ALWAYS|REQUIRED|NON-NEGOTIABLE|ABSOLUTE|IMMEDIATELY|MANDATORY|BLOCKING|FORBIDDEN|STOP` as whole words. "T0" below = touches money/auth/RNG/KYC/ledger-relevant instruction text (Opus review needed).

| Agent | A bytes (tok) | B bytes (tok) | 07A / DESIGN target | Emphasis A -> B | C file (bytes) |
|---|---|---|---|---|---|
| gsd2-executor | 30,704 (12.3k) | 10,143 (4.1k) | <= 12,000 | 30 -> 0 | `gsd2-executor.c.md` 11,133 (B + Anthropic's two Haiku paragraphs, verbatim) |
| gsd2-test-writer | 7,978 (3.2k) | 4,712 (1.9k) | <= 6,000 | 8 -> 0 | none (quality fixes folded into B, below) |
| gsd2-reviewer | no def (built-in 1.1k tok + 8.4k skill listing) | 3,248 (1.3k) | <= 7,500 / <= 3k tok | n/a -> 0 | none (new def) |
| gsd2-plan-checker | 33,855 (13.5k) | 8,264 (3.3k) | <= 15,000 | 29 -> 0 | none |
| gsd2-verifier | 21,078 (8.4k) | 7,913 (3.2k) | <= 12,500 | 28 -> 0 | none (Q needs `gsd-tools verify layer1`, which does not exist) |
| gsd2-planner | 17,273 (6.9k) | 7,099 (2.8k) | <= 14,000 | 29 -> 0 | `gsd2-planner.c.md` 8,597 (B + plan skeleton + escalate rule) |
| gsd2-debugger | 12,486 (5.0k) | 5,539 (2.2k) | <= 10,000 | 8 -> 0 | `gsd2-debugger.c.md` 6,898 (B + 1 KB inlined method) |

Every B is under its target, in most cases by a wide margin, because the whole of the unread-detail-file duplication and all example fences are gone. The risk is under-specification rather than size; the pointers below are how the cut text stays reachable. All pointers are `Read` with offset/limit against `~/.claude/get-shit-done/references/*-detail.md` (not `@`, 06 P9); line numbers were verified against the repo copies at draft time and drift if those files are edited.

Cross-cutting, applied to every B (07A X3, X4, X5, X9, X10): MILE-26 telemetry lines deleted; `Grep`/`Glob` dropped from tools and `zg query` named where text search is needed; `Agent, Task` dropped from the leaf roles (planner, plan-checker, test-writer, debugger, reviewer) and kept for executor and verifier (they spawn); `content_firewall` pointer replaced by one sentence; dead `skills:` and commented `hooks:` frontmatter deleted; all ALL-CAPS emphasis rewritten as plain statements (04 P5), with the hard-stop rules left as hard stops in wording ("blocks", "fails", "is a blocker"); required return block placed in a final `## Finish` section, short, with the JSON trailer last (07A X2). Child names stay `gsd-*` as in wave 1 (the namespace rollout resolves them). Names in frontmatter are `gsd2-*`.

## gsd2-executor (07A 2.2, X1, X3-X7)

| Action | What | Finding / reason | Bytes (approx, -removed/+added vs A) |
|---|---|---|---|
| removed | Hard Rules Digest preamble prose and the verbatim quotes (3.7 KB); gate rules kept as a 1.1 KB `## Gates` list | X1: executor-detail read 9/1144, so the gate rules are the executor's only copy; 07A says keep ~1 KB | -2,600 |
| removed | `agent_messaging` App #4 (wave peers) and App #5 (heartbeat) | 07A 2.2(a): `<wave_peers>` in 0 prompts, heartbeat 0 | -2,200 |
| removed | Routing-tier bash block (`TASK_ROUTING_TIER`, `RETRY_ESCALATED`) | D5: tags removed | -400 |
| removed | `auto_mode_detection` (`workflow.auto_advance`, auto-approve of human-verify and decision) | 07A 2.2(a): coordinator-driven. Behaviour change: with `auto_advance=true` A would auto-approve; B always stops at `checkpoint:*` (A's non-auto behaviour) | -1,200 |
| removed | Telemetry fields and paragraph in completion and interrupted blocks | X3 | -700 |
| removed | `@checkpoints.md`, `@content-firewall.md`, "see coordinator-detail.md: cost + test-command rules" pointers | X9, 06 P9, unread files | -700 |
| removed | Checkpoint "90% / 9% / 1%" taxonomy; `[Rule N - Type]` tag rule; Rule 1-3 example lists | 07A 2.2(a): tag emitted 0 times | -2,300 |
| compressed | deviation_rules 3.6 -> 1.7 KB; checkpoint_protocol + return format 1.9 + 1.4 -> 1.9 KB; resilience self-stop 3.8 -> 1.5 KB; PLAN INTERRUPTED 2.2 -> 0.5 KB (handoff field list as a sentence); Defect Classes 1.5 -> 0.9 KB; tooling 1.3 -> 0.8 KB | DESIGN §3.2 table | -8,500 |
| kept | task_commit_protocol (steps 1-6, TASK-CHECKPOINT.json fields), scope_boundary with the deferred-items.md queue note, self_check, success_criteria (verbatim wording, as a checklist), JSON trailer, load-bearing `**Type:**` line | DESIGN §3.2 "verbatim" | - |
| moved | Execution flow (load state to final commit), TDD, test gate, docs, state, final commit sections: one pointer paragraph with section line numbers | X1 | +450 |
| changed | frontmatter tools: Read, Write, Edit, Bash, LSP, SendMessage, Agent, Task (A also had Grep, Glob). `SendMessage` kept because the human-relay (checkpoint) and continuation signals still use it | X4, 07A 2.2(c) | -20 |
| changed | tdd handling: the router call is gone (task-router archived, D8) and the test writer is spawned on `haiku` where A defaulted to `sonnet` when parsing failed | D5/D8; CLAUDE.md "Haiku implements". T0-adjacent: the test writer authors T0 tests | +/-0 |
| changed | Mutation proof: one sentence pointing at `scripts/gsd-mutate/` and forbidding hand mutation of the shared tree; A had the manual worktree recipe only in the unread detail file | `.claude/rules/testing.md:141` | +230 |

C file: `gsd2-executor.c.md` = B + the two paragraphs from https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5 (sections "Prevent early stopping in long agent prompts" and "Tell coding agents to verify their changes"), copied verbatim at the top of the body (fetched 2026-11-01). `effort` is not set (DESIGN §3.3).

Not applied: `Monitor` in tools or a written waiting rule (X6; an addition, Q); a SubagentHandback line (X7; wave 1 treated it the same way); test-output-to-`.tmp/` rule and unlimited-Read warning (07A 2.2(b), D11f; additions); `effort: medium`, `maxTurns` (D4g, D2; separate factors, DESIGN §3.3); docs-updater spawn made visible beyond the Gates bullet (63/293 spawn rate; the bullet is the whole of what B keeps, so this may not move); `[Rule N - Type]` tag deleted rather than kept.

T0-touching changes (3): Rule 2 consistency-within-a-module and orphaned-side-effect sentences compressed (auth/money contract inheritance); test-writer spawn model default sonnet -> haiku with the router gone; mutation-proof sentence now points at gsd-mutate.

## gsd2-test-writer (07A 2.9, X3-X5; DESIGN-ALL TW1-TW2)

| Action | What | Finding / reason | Bytes |
|---|---|---|---|
| removed | `Agent, Task, Grep, Glob` from tools (A: 3 self-spawns in 31) | X4, X5, 07A 2.9(c) | -60 |
| removed | Step 6 "If the implementation has a genuine bug: fix it, re-run"; replaced by "report it with file:line, never edit production code" | 07A 2.9(b): 13/31 RED-only prompts and 10/31 "no production edits" contradict it | -80 |
| removed | Role paragraph "Your job is to BREAK things... happy-path tests are the minimum" and the 6 question bullets, replaced by one sentence listing the same questions plus "no more than the behaviour needs" | 07A 2.9(a): contradicts `test_categories` "fewest tests, T1 <= 8" | -700 |
| removed | MILE-26 telemetry paragraph; `FAILURE: 0 tests` kept | X3 | -450 |
| removed | Category checklist sub-bullets (auth/validation/error/edge lists) reduced to the one-line category list | duplicates project testing rules | -1,000 |
| compressed | Fixture rules (step 3), anti-patterns, inventory/layer steps | `testing.md` isolation rules duplicate | -900 |
| changed | New `## Mode` section: COVER (default) and RED (tests only, each must fail by assertion, no non-test edits) | 07A 2.9(c); a clarification of the 13/31 RED-only and 10/31 no-prod-edit jobs, not a new capability | +750 |
| changed | Mutation step: "throwaway worktree" recipe replaced by "run TS unit mutants through `scripts/gsd-mutate/`" | `.claude/rules/testing.md:141`; 07A 2.9(b): 0/31 used a worktree | +100 |
| changed | Report is now the final block, answer-first; keeps tests passing/failing, tier per behaviour, REUSE citations, mutants, files | X2: fields were emitted 0-6/31 | +/-0 |
| kept | Tier budgets (T0 no cap and real DB; T1 <= 8; T2 0 new with REUSE cite), inventory step 2a, layer step 2b, deterministic fixture identifiers, teardown, "always run the tests you write" | DESIGN-ALL §4 TW oracle | - |

No separate C file: DESIGN-ALL §3 defines the test-writer Q arm as "drop impl-fix step, resolve role contradiction", and the task instructed those audit fixes into B as deletions/clarifications. The B arm therefore already carries Q; expect TW1-TW2 to show B vs A differences from both the size cut and these behaviour fixes.

T0-touching (3): T0 tier-budget line (kept, compressed); mutation step now `gsd-mutate`; production-fix step removed and RED mode added.

## gsd2-reviewer (new; 07A row 3, 05 D4/D6, 04 P6)

New definition, not a B. Choices: `tools: Read, Bash` (no Edit/Write, read-only is enforced by tools, not prose, 07A 2.3(b): 10 reviewers edited source, 28 `sed -i` mutants); `model: sonnet`; no `skills:` (the 8.4k-token skill listing is what the 07A saving is); no `omitClaudeMd` (D4 table: ≤6k inherited stays). Output: one JSON array and nothing else, fields `id, severity (CRIT|HIGH|MED|LOW), file_line, claim, evidence, fix`; told that "no findings" (`[]`) is valid and not to invent findings, and to report every supportable finding so the filter script (D6) does the severity cut. Round cap per the CEO amendment: T0 up to 3 rounds fixing >= MED then one batched Opus review; T1 at most 2 rounds, continuing only if the last had CRIT or HIGH; at the cap report CRIT/HIGH only. Reads by section, `zg query` not grep, no `--no-check`/`--no-verify`, no mutants in the shared tree.

Unverified: whether the reviewer should be allowed to run allowlisted test shapes (it can, via Bash); whether the round number is supplied in briefs (the def relies on the brief, as the coordinator def does not yet pass it). Severity definitions are mine; no source defines CRIT/HIGH/MED/LOW thresholds.

T0-touching (1): the "what to look for" list for money/auth/RNG/KYC/ledger paths and the T0 round rule.

## gsd2-plan-checker (07A 2.5, X1, X3-X5, X10; DESIGN §3.2)

| Action | What | Finding / reason | Bytes |
|---|---|---|---|
| removed | `skills: gsd-plan-checker-workflow`; `Glob, Grep, SendMessage, Agent, Task` from tools | X10, X4, X5 | -80 |
| removed | `<project_context>` instruction to Read `./CLAUDE.md` (already loaded) and the skill-loading procedure (kept one clause) | 07A 2.5(a) | -800 |
| removed | Duplicate `## Dimension 9` heading and its output table block | 07A 2.5(a); Dimension 9 itself kept, compressed to one entry | -900 |
| removed | `live_course_correction` (SendMessage 2 calls in 102) | DESIGN §3.2 | -1,200 |
| removed | `<examples>` (scope-exceeded), per-dimension YAML example fences (one example kept in the issue section), `<success_criteria>` checklist (restates the 12 dimensions; Opus drops self-verify boilerplate, 04 P8) | DESIGN §3.2, 07A 2.5(a) | -9,500 |
| removed | Steps 1-10 prose and bash fences, merged into a 5-step `## Process` (gsd-tools `init`, `verify plan-structure`, `frontmatter get must_haves`, requirement cross-check, static-only) | duplicated the dimensions | -4,800 |
| compressed | All 12 dimensions to 1-4 lines each; Dim 8 2.9 -> 1.4 KB, Dim 10 2.0 -> 0.6, Dim 11 1.9 -> 0.5, Dim 12 2.1 -> 0.7 | DESIGN §3.2 | -5,500 |
| kept | Dim 8-T4 T0 rules (REUSE satisfies T0 only when the cited test is the T0 test, path:line plus mutant id, "0 tests" rejected), 8-T3 deferral phrase list, the `existing:` inventory requirement, the `match()` routing rule, issue fields, blocker/warning/info vocabulary, `## VERIFICATION PASSED` / `## ISSUES FOUND` headers, 3-round revision loop, "Do not run the application. Static plan analysis only." | the checker's contract with the planner | - |

Not applied: one-plan-per-spawn and read-by-section (spawn-brief and addition); a rule that it never edits plans or an explicit fix-plans mode (07A 2.5(b): 25/102 edited plans; tools already have no Edit, but Bash `sed` does, so a text rule is an addition, Q); severity vocabulary change to CRIT/HIGH/MED/LOW (75/102 already use it; renaming is not a delete/compress/move, and the planner/coordinator parse blocker/warning/info); an Opus "attack" dimension (D8, an addition); splitting off diff review (X8, done by gsd2-reviewer). The "static plan analysis only" sentence is kept although 62/102 runs executed tests; reconciling it is a decision for the reviewer, not for B.

T0-touching (1): Dimension 8-T4 (T0 tagging and REUSE rule) kept in compressed form with the same obligations.

## gsd2-verifier (07A 2.6, X1, X3-X5; DESIGN-ALL §3 "compressed, not deleted")

| Action | What | Finding / reason | Bytes |
|---|---|---|---|
| compressed | Hard Rules Digest 8.5 KB -> `## Checks and gates` 4.2 KB. The digest is the verifier's only procedure (verifier-detail read 2/88), so steps 6b, 6c, 6d, 8b, 8c, 8c.5, 8c.6, 8d, 8e, 8g-8j, 9 keep their hard-fail outcomes, one to three sentences each | 07A 2.6(a) amends DESIGN §3.2 "delete" | -4,300 |
| removed | Digest preamble, "additive, does not replace" prose, quoted blockquotes | X1 | -1,300 |
| removed | `success_criteria` (3.6 KB, restates the digest; Opus self-verify boilerplate) | DESIGN §3.2, 04 P8 | -3,600 |
| removed | Step 11 KB anti-pattern writes (KB dead, 05-M4) incl. its success-criteria line | 07A 2.6(a) | -300 |
| removed | MILE-26 telemetry, `Grep, Glob, SendMessage` tools | X3, X4, 07A 2.6(c) | -350 |
| removed | Prose "Do NOT trust..." critical_rules block (merged into the first paragraph); "use grep/file checks" (contradicts project `zg` rule) replaced by `zg query` | 07A 2.6(b) | -700 |
| compressed | VERIFICATION.md format 3 KB -> 1.8 KB (frontmatter fields kept: `charlotte_qa_ran`, `gaps[].failure_type`; body as a section list) | - | -1,200 |
| changed | Commit contradiction resolved: "DO NOT commit" (A) vs 58/88 verifiers that commit because 86/88 spawn prompts and `gsd-phase-coordinator.md:214-215` say the verifier commits its own Defect Classes rows. B: commit only when the brief says to, only your own paths (`git commit -- <paths>`). Wave-1 coordinator draft says "the verifier commits its own rows", consistent | 07A 2.6(b) | +250 |
| changed | `--no-check` guard `! grep -n "no-check" apps/api/deno.json apps/api/project.json` -> "confirm absent (`zg query`)" | CLAUDE.md: Bash grep triggers an approval prompt; same check | +/-0 |
| kept | Partial pass is not a pass wording; the `human_needed` is never a soft `gaps_found` rule; `charlotte_qa_ran` frontmatter; JSON trailer with status equal to frontmatter; eval-candidate on gaps_found; 6d repair-the-record rule | verbatim rules | - |
| moved | Steps 0-10, 8c-8j: pointer paragraph with line numbers into verifier-detail.md | X1 | +450 |

Not applied: Layer-1 gates 8g-8j replaced by one `gsd-tools verify layer1` call (Q; the subcommand does not exist); "run the suite once, re-run only failing files" (04 P8 over-verification; an addition, Q); PRD Intent Alignment removal (1/88 used, but it is a hard-fail rule; kept in one bullet, delete only with a ruling); `Agent, Task` kept for runner spawns.

T0-touching (4): Step 8d sensitive-path regex and exemption (compressed); Steps 8g-8j gates (fp-gate, migration-security, cve-scan, p0-tier-delta, test-delta incl. missing T0 mutant rows); the "partial pass / deferral = gaps_found" and `human_needed` rules; the commit clarification (which paths the verifier may commit).

## gsd2-planner (07A 2.7, X1, X3-X5, X10; DESIGN §3.2)

| Action | What | Finding / reason | Bytes |
|---|---|---|---|
| compressed | Hard Rules Digest 3.8 KB folded into mandates 1, 2 and 4 (when a test task is required, `e2e_flows`, automation-first, the Hard Testing Gate and its `PLAN REJECTED` block, must_haves emptiness) | 07A 2.7 / DESIGN-ALL §3: compressed to ~1.5 KB, not deleted (planner-detail read 3/119) | -2,300 |
| compressed | ABSOLUTE MANDATES 6.7 -> 4.5 KB, same eight mandates in plain wording. MANDATE-4's eight-item checklist merged with the self-check list in `context_fidelity` | DESIGN §3.2 asked 3.0; money/auth mandate 6 is T0 and kept whole, so the target was not hit for the mandates section | -1,300 |
| removed | `success_criteria` standard/gap lists; "Self-check before returning" checklist in `context_fidelity`; `Glob, Grep, Agent, Task` from tools; `@content-firewall` pointer; the plan-template and revision-mode specifics that already lived in planner-detail | X1, X4, X5, 04 P8 | -4,400 |
| compressed | `structured_returns`: two full templates + trailer rules -> one short `## Finish` block + JSON line | 07A X2 | -600 |
| changed | Tools now include `Edit` | 07A 2.7(b): 54/119 spawns are revisions, 353 python-heredoc rewrites and 81 `sed -i` of PLAN.md for lack of it. Revision mode: "change existing PLAN.md in place with Edit" (one sentence) | +100 |
| moved | PLAN.md format, task anatomy, revision mode, gap closure, validate steps: pointer paragraph with line numbers into planner-detail.md; `git_commit` step pointer added so the commit is not lost with `success_criteria` | X1 | +550 |

C file: `gsd2-planner.c.md` = B + a compact PLAN skeleton (07A 2.7(c): "inline compact PLAN format") + `## Escalation` (D5: Haiku default, `escalate: <reason>` on a task, no `<model>` tags; DESIGN-ALL §3 Q column "`<model>`/escalate rule inlined"). The escalate reasons (ambiguous requirements, architecture, unclear root cause) restate CLAUDE.md "Sonnet only after..."; the sentence that money/auth tasks stay Haiku under Opus planning/review is my reading of CLAUDE.md "Haiku implements... Opus reviews", not a quoted rule.

Not applied: plan size reconciliation (A says 2-3 tasks; real median 4, 29% >= 6; kept A's wording, 07A 2.7(c) "enforce <= 3 or state the real cap" needs a decision); MANDATE-2 vs the milestone Charlotte waiver (116 plans cite a waiver; kept the mandate, flagged for the reviewer); tier-tag sentence in planner-detail (05-M2b) not inlined in B.

T0-touching (3 in B, 1 in C): MANDATE-6 money/auth threat-model and atomicity mandate reworded and kept whole; MANDATE-1 T0 REUSE rule and MANDATE-4 merged checklist; the testing gate and PLAN REJECTED block. C: escalation sentence on money/auth tasks.

## gsd2-debugger (07A 2.8, X1, X3-X5, X10; DESIGN-ALL §3)

| Action | What | Finding / reason | Bytes |
|---|---|---|---|
| removed | `skills: gsd-debugger-workflow`, commented eslint `hooks:` block; `Grep, Glob, LSP, Agent, Task` from tools (kept `WebSearch`: 8 calls in 7 runs) | X10, X4, X5, 07A 2.8(c) | -450 |
| removed | Hard Rules Digest (1.7 KB; its five rules are restated in `## Debug file` ("Write tool, not heredocs"), `## Mode` (no fix in root_cause_only; resolved only after confirmation), eval-candidate once) | X1: debugger-detail read 0/52 | -1,700 |
| removed | `success_criteria` checklist (restates the file protocol) | 04 P8 | -700 |
| compressed | File protocol 2.4 -> 1.5 KB (status-transition diagram and update-rules table folded into the template comments); checkpoint behaviour 2.0 -> 1.0 KB; structured returns 2.3 -> 1.3 KB; modes 1.7 -> 1.5 KB | DESIGN §3.2-style | -3,100 |
| kept | All four mode flags and the interactive default. 07A calls `symptoms_prefilled`, `interactive:false`, `goal:` dead (0/52) and wants them replaced by one autonomous find_and_fix / root_cause_only mode; replacing is an addition, so B keeps them, compressed | 07A 2.8(b) | - |
| kept | Load-bearing `**Type:**` checkpoint line, JSON trailer, `eval-candidate from-debug` rule | followed 28/52 | - |
| moved | Methodology and step flow: pointer with line numbers into debugger-detail.md | X1 | +300 |

C file: `gsd2-debugger.c.md` = B + `## Method` (~1.3 KB distilled from debugger-detail.md:65-170: 3+ falsifiable hypotheses, one variable per experiment, evidence quality, act-only-when criteria, restart triggers) + a rerun-discipline bullet (07A 2.8(b): 85 identical re-runs in 19 transcripts). The rerun bullet is my wording of that finding.

Not applied: replacing dead modes with an autonomous-only mode (see above, Q); `maxTurns`.

T0-touching: none new (D3 root-cause-only on the 2FA task keeps its read-only mode intact).

## Totals and verification done

B total 46,918 B (7 defs) vs A 123,374 B for the six existing defs plus the reviewer (no A). C files: 26,628 B. Checked: every pointer line number against the repo reference files; every `gsd-tools` subcommand named exists in A's defs (`init phase-op`, `roadmap get-phase`, `verify plan-structure`, `frontmatter get`, `eval-candidate`; none new). Not done: no eval run, no installer test, no frontmatter-field probe (`effort`, `omitClaudeMd`, `TaskStop` unprobed, as in wave 1).

## For the Opus review (T0-touching B changes, 15; C 1)

Executor 3, test-writer 3, reviewer 1, plan-checker 1, verifier 4, planner 3, debugger 0; planner C 1. The ones most worth a second reader: verifier commit clarification, planner mandate 6 and 1 wording, executor test-writer model default, plan-checker 8-T4 compression, reviewer severity definitions.
