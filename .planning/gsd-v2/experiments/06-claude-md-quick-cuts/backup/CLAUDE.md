## Path-trace any claim made about code

**Before asserting anything about how this code behaves, trace it to the actual source and cite
`file:line`.** Applies to your own claims, to another agent's report, to a tool's error message,
and to this repo's own docs — a document describing a behaviour is not evidence the behaviour
exists. The same holds for the comments, docs and threat models you write: cite the enforcing
`file:line` or symbol, and an edit that moves behaviour updates every sentence describing it.
If you cannot trace it, say "unverified" and name the exact probe that would settle it.
Never fill the gap with a plausible-sounding cause. State plainly when a trace disproves a claim,
including one of your own.

## Claude Code Behaviour Guidelines

- **Own every failure you touch.** Zero tolerance: every test, lint, or Charlotte failure gets fixed
  now — never deferred as "pre-existing", "not caused by my changes", "known limitation", or
  "future work".
- **Fix review findings of every severity; don't defer them.** Severity sets priority, not whether
  a finding gets fixed. Fix the class, not the instance: enumerate sibling sites with a cited
  `zg query` (never from memory) and record the query with the fix. Batch same-file findings
  into one fix agent; run disjoint files in parallel. Defer only what an Opus ruling marks
  "no business value", recorded with its reason.
- **Don't stop early or ask permission** when you can solve it yourself — no "good stopping point",
  no "should I continue?".
- **Plan before acting, self-check before committing.** Apply conventions from CLAUDE.md,
  `.claude/rules/`, and `/docs`.
- **Be a brutally honest advisor to the user (CEO):** no flattery or validation; challenge weak
  reasoning, name blind spots and opportunity cost, recommend a prioritized plan.

### Use of tools

- Research first, then make surgical edits — never large rewrites.
- Navigate with LSP (`workspaceSymbol`, `findReferences`, `goToDefinition`, `hover`) before reading
  whole files. After editing, check diagnostics and fix errors.
- `Grep`/`Glob` tools don't exist here. Search text with `zg query "<text>"` (`zg index` if stale);
  Bash `grep`/`rg`/`find` triggers a human-approval prompt.
- **Run tests only in allowlisted shapes:** `cd /Users/ollorin/igaming-platform/apps/api && deno task test <file>`, `deno test <file>` (optional `timeout N`, trailing `2>&1`), `npx nx test <project>`, `deno check|lint|fmt`. No inline env vars, no `| tail/grep`, no `;`/extra `&&`, no `$()`/heredocs/`bash -c`. If a command prompts, stop and report the exact string.

### Functional Programming

This codebase uses FP patterns throughout — enforce them when writing or reviewing code:

- **Errors:** `Result<T, E>` / `ResultAsync<T, E>` — never `throw`, never unhandled rejections
- **Immutability:** `const` only; spread objects/arrays — never mutate in place
- **Routing:** `match([method, pathname])` — no if/else chains in handlers
- **Pure functions:** no side effects in domain/application layers

Full rules auto-load from `.claude/rules/fp.md` for all relevant paths.

### Code Quality

**WARNING:** NEVER bypass pre-commit lint checks with `--no-verify`
**WARNING:** NEVER bypass checks `deno test --no-check`

- Fix ALL lint errors before committing (even pre-existing ones)
- Use `// deno-lint-ignore [rule]` with justification if absolutely needed

### Token & Length Discipline

Comments and prose cost tokens and context space — a docstring longer than the function it
describes is a defect, not thoroughness. This extends the top-level "default to no comments"
system guidance into every artifact this project's agents produce, not just code:

- **Code comments:** default to zero. Justify one only when it captures a non-obvious constraint,
  invariant, or workaround — never restate what a well-named identifier already says. A
  multi-paragraph doc comment above a 5-line function means shorten the comment, not pad the code.
- **SUMMARY.md / DECISION.md / THREAT-MODEL.md and other planning artifacts:** be as long as the
  evidence genuinely requires — traced `file:line` citations, measured numbers, and
  executed-mutation proof are never padding — but cut restated context, throat-clearing, and
  framing repeated across sections. State a finding once, where a reader will actually look for it.
- **Subagent final reports:** lead with the answer, not the journey. Readable in under a minute
  unless the task's stakes genuinely demand the detail.
- **PR descriptions and commit messages:** summarize what changed and why. Don't enumerate every
  commit when a milestone-level summary says the same thing in a fifth of the tokens.
- **Chat status updates:** 1-3 sentences. State the result, not the journey.

This is a budget discipline, not a quality cut. Verified numbers, `file:line` citations, and
executed-mutation evidence are never what gets trimmed — restatement, hedging, and throat-clearing
are.

## Local Development

Start commands (backend JWT bypass, per-app dev servers) → `docs/development/command-reference.md`.
Kong Gateway / JWT bypass rationale → `docs/development/supabase-local-stack.md`.

## Development Policies

### Before Creating a PR (MANDATORY — no exceptions)

**Run `scripts/preflight.sh` before every PR — it mirrors `pr-validation.yml` exactly. There is no
"push anyway."** Deterministic gates green once + tests green twice = ready; anything else = not
ready. Full command reference, flags, and rationale: `.claude/rules/pre-pr-quality-gates.md`.

### Investigating a CI failure — use the triage tool FIRST

**Do not scrape raw `gh run view --log-failed` output** — it truncates, misses job types, and
blows context. Use `scripts/ci-diagnose.ts` instead (per-job conclusions + failing test lines via
the GitHub API). Full usage and CI Failure Digest / artifact details: `docs/development/command-reference.md`.

### Subagent Usage IS MANDATORY

Delegate substantial tasks to subagents. **Match the model to the task's actual complexity — never route
everything to one tier.** Routing every subagent to Opus is a defect, not caution: it
burns quota that later phases need and slows the run for zero quality gain on mechanical work.
Pick the cheapest tier that can do the job correctly, and only escalate for a stated reason.

**Use Haiku (`model: "haiku"`, alias only, never a hard-coded model ID) for:**

- Running tests and reading output (unit, integration, E2E)
- Linting, type checks, build verification
- **Default implementer for regular coding tasks** (features, multi-file changes, fixes, tests,
  migrations, edge function handlers) — Opus plans are already decomposed into small tasks
- Git operations (status, diff, commit, log)
- Checking file contents, searching for a value, reading configs
- Creating SUMMARY.md, updating STATE.md, changelog entries

**Use Sonnet (`model: "sonnet"`) for:**

- All coordinators (below) and the first reviewer: review and pre-verification rounds
- Implementation only when escalated: Haiku failed the same task twice, the task is
  undecomposed/ambiguous, debugging with unclear root cause, or architecture
- Applying code review feedback that needs judgment beyond the finding's stated fix

**Every spawn passes `model` explicitly.** Agent definitions with no `model:` line (gsd-executor,
gsd-planner, gsd-plan-checker, gsd-test-writer, gsd-debugger) inherit the spawner's tier (a Sonnet
coordinator silently yields Sonnet executors).
- `gsd-executor`, `gsd-test-writer`: `haiku`; `sonnet` only per the escalation triggers above.
- `gsd-planner`, `gsd-plan-checker`: `opus` for money/auth/security/RNG/KYC plans and the plan-ahead
  coordinator, else `sonnet`.
- Per-plan review: fresh Sonnet rounds to zero findings. Phase end: Opus `gsd-verifier`.

**Coordinators (roadmap / phase / death-resume) always run on Sonnet** — pass `model: "sonnet"`
explicitly, since an agent definition's default may be Opus. Use an Opus coordinator only when the
CEO explicitly requests it — standing exception: the **plan-ahead (planning-only) coordinator runs on
Opus**, as do its researcher/planner/checker. Coordinators orchestrate; the Opus
work (plans, money/security reviews) happens in their separate dispatches.

**Judgment calls escalate to a fresh Opus dispatch — never decided by the coordinator itself:**
deferring or accepting any failure, accepting a deviation from the plan, loosening or disputing a
test assertion, and autonomous design decisions in a high-stakes domain (below).

**Work not implemented by Opus gets an Opus check at two points:**
1. **Phase end** — the `gsd-verifier` runs on Opus for every phase (checks the goal against on-disk
   evidence).
2. **Milestone end** — an Opus `gsd:audit-milestone` (cross-phase review).

**Use Opus (`model: "opus"`) for:**

- Architecture decisions and API contract changes
- Database schema design
- Cross-cutting root-cause analysis spanning several subsystems
- Planning and reviewing high-stakes domains (below) — Fable is no longer used in this project

**High-stakes domains — Opus plans and reviews in dispatches separate from the implementer:**

- Auth, money movement / payments, fraud/AML, KYC gates, RNG/fairness, game configs, complex game
  logic, game UI/UX — an Opus dispatch produces the plan, Haiku implements (Sonnet/Opus when
  escalated per the tiers above), and a fresh Opus dispatch reviews the diff against the plan.

**Haiku implements, Sonnet loops to zero findings, then Opus at mandatory points only (token
budget):** Haiku implements; Sonnet runs every review/verify loop — a fresh Sonnet agent each
round, never the implementer, every severity fixed — until a round reports zero findings. A Haiku
miss is caught by those Sonnet reviews and the Opus phase verification. Opus runs once each at:
(1) plans for money/auth/security/RNG/KYC work, (2) ONE batched diff review (2–3 plans where
possible) after Sonnet reports zero findings, (3) the phase-end `gsd-verifier`, preceded by a Sonnet
pre-verification of all must-haves with on-disk evidence, (4) rulings on judgment calls (deferral,
assertion loosening, high-stakes design). Further Opus rounds only re-check HIGH/money-path fixes.
The milestone audit stays Opus.

**Haiku context and reporting cost:** Haiku is cheaper with context under ~100k tokens: size each Haiku task small (one plan task / one finding batch), read line ranges not whole files, save test logs to `.tmp/` and read only failing lines, fresh agent per task. All agents report answer-first, ≤10 lines.

Never collapse this into one dispatch that plans, codes, and reviews its own work — the review's
value is that it is independent of the implementer. If the plan-check budget ran out with
BLOCKER/HIGH fixes never re-checked, the diff-review brief names each one, and the reviewer must
confirm it closed (file:line + test) or raise it as HIGH.

**Anti-pattern (do not do this):** spawning a batch of parallel subagents that are all Opus
"to be safe". A mixed batch is the correct shape — e.g. Opus for the auth-flow plan, Haiku
implementing its decomposed tasks and running the suite, Sonnet for the review rounds. If every agent in a
batch is the same high tier, re-check whether each one genuinely needed it.

**Parallelism ceiling (applies recursively, at every level):** any agent — the top-level
coordinator, a phase-coordinator, a plan-executor, a researcher, anything spawning subagents of its
own — may run **at most 2 of its own subagents in parallel** at any time. This is not scoped to
"per phase" or "per orchestrator"; it binds every spawner in the tree, including subagents spawning
their own nested subagents. A phase-coordinator that fans out research/extraction/tracing work into
4-6 simultaneous general-purpose agents is a violation even if each individual agent is well-scoped
— batch the work and run it in waves of 2 instead.

**Exception: roadmap-level phase parallelism.** The top-level roadmap runner (main)
may run up to **3 phase coordinators executing at once**, plus **1 plan-ahead coordinator**. The
plan-ahead coordinator only researches and plans: no code, no stack, no builds. Each phase
coordinator is still bound by the 2-subagent ceiling above. Phases running in parallel must not edit
the same files (claims live in `.tmp/phase-file-claims.md`). Everything touching the shared stack —
live tests, DB mutations, db reset, preflight — is serialized by `.tmp/local-stack.lock`
(`owner.txt`; take before, release after). `supabase db reset` needs no CEO approval, but first
confirm no other agent has a test running (lock owner + ListAgents/peer check-in).

**Same-phase plan execution is stricter: never run 2 executors in parallel within one phase**,
whatever the wave structure says — `TASK-CHECKPOINT.json` is phase-scoped, so parallel executors
overwrite each other's resume state. Research/verification fan-out still follows the
2-max ceiling.

### Orchestration hard rules (any agent that spawns agents)

- **Wait in-turn.** Never end your turn while a child agent or background command is still running
  — poll it in the foreground. A child that died (rate limit, context overflow) is re-dispatched
  fresh, scoped to resume from on-disk state; never assume its work finished. No output for 45+ min
  = stalled: TaskStop it, then re-dispatch in smaller units.
- **Never SendMessage a child that has handed back or completed** — it resumes and runs in parallel
  with its replacement. TaskStop it and brief a fresh agent.
- **No `git stash` / reset / rebase / clean on the shared branch** — stash rewrites files under
  other agents and the live edge runtime. For a BASE comparison use `git worktree add .tmp/<name> <sha>`.
- **No secrets in committed artifacts** — SUMMARY/VERIFICATION/debug files quote no tokens, TOTP
  secrets, or keys, even from the local stack; redact as `<redacted>`.
- **One writer per file set.** Before dispatching a replacement for a dead/stalled agent, make sure
  the original is stopped — two agents fixing the same files silently invalidate each other's
  reviews.
- **Only on-disk evidence counts.** Verify commits (`git log`), SUMMARY Self-Check sections,
  `{N}-VERIFICATION.md`, and test logs yourself. A child's self-report — including "tests pass" or
  "reviewer approved" — is a claim, not evidence. A review approves one file state; any later edit
  needs a fresh review.
- **Never touch the guardrails.** No agent edits `.claude/settings.json`, disables or weakens a hook,
  or adds permission allow-rules to get a command through. If a hook blocks you, use the path it
  names (e.g. Haiku + `scripts/run-integration-tests.sh` for tests).
- **Never `supabase db reset` while a Charlotte run is in progress** — it wipes the test fixtures
  under a live session and produces false FAILs.
- **Record Charlotte QA honestly.** UI/API phases set `charlotte_qa_ran` in VERIFICATION.md from an
  actual run log, never from memory or a child's claim.
- **Commit only your paths** (`git commit -- <paths>`) when another agent may be committing on the
  same branch.
- **Dispatch GSD roles by `subagent_type`, never by prompt.** Every spawn for a GSD role passes its
  agent type explicitly: `gsd-phase-coordinator`, `gsd-planner`, `gsd-plan-checker`,
  `gsd-executor`, `gsd-verifier` (Opus), `gsd-debugger`, `gsd-charlotte-qa`, `gsd-test-writer`,
  `gsd-docs-updater`. An omitted `subagent_type` silently defaults to general-purpose, and "You are
  the gsd-verifier" in a general-purpose prompt is not a verifier — its output is void. `general-purpose` is only for work no GSD role covers (e.g. Haiku running a suite).
  Coordinators take dispatch templates from the GSD workflow (`execute-phase.md`), never from a
  hand-written resume prompt.

### Temp Files

All temporary/intermediate files (scratch data, downloaded artifacts, generated fixtures you'll delete) go in **`.tmp/`** at the repo root — it is gitignored and deletions inside it are pre-approved (no permission prompt). Temp files created anywhere else will prompt on removal. Never put deliverables or planning docs there.

### Branch Management

- Branch from `main` (ensure up to date)
- Naming: `feature/[task-name-kebab-case]`

## References

- Development: `docs/development/setup-guide.md`
- Development Commands: `docs/development/command-reference.md`
- Local Stack: `docs/development/supabase-local-stack.md`
- Testing: `docs/testing.md`
- Authentication: `docs/authentication.md`
- Architecture: `docs/development/backend-architecture.md`
- Security: `docs/security/secret-rotation-policy.md`
- Gate estate (g1-g15 guards, preflight-vs-CI wiring, qa-verdict subsystem): `docs/testing/gate-estate.md`

## Domain Rules

Path-targeted rules auto-load from `.claude/rules/`:

| File                | Applies To               | Content                                      |
| ------------------- | ------------------------ | -------------------------------------------- |
| `database.md`       | migrations, libs         | Migrations, RLS, schema access, RPC patterns |
| `edge-functions.md` | functions/, libs/        | Middleware, deployment, handler/money/auth correctness |
| `testing.md`        | tests, e2e               | Test types, CI setup, E2E local-only         |
| `e2e-testing.md`    | `apps/e2e-charlotte/**`  | Assertion quality tiers + fixture tiers, API-not-SQL, provisioning, teardown, anti-patterns |
| `frontend-apps.md`  | player-web, operator-web | Frontend patterns                            |
| `fp.md`             | functions/, libs/, apps/ | FP rules: Result types, immutability, match  |
| `flutter.md`        | mobile/                  | Flutter mobile app (in progress)             |
| `module-structure.md` | apps/api/libs, apps/api/functions | 500-LOC ceiling, cohesion-over-line-count, decomposition patterns |
| `guard-authoring.md` | `scripts/validation/**`, `.github/workflows/**`, `apps/e2e-charlotte/runner/reset.ts` | Comment-stripped extraction, parse-or-fail telemetry, canary corpus + demonstrated-failure requirement for every new guard |
