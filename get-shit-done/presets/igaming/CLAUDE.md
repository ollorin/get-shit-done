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
  Exact sweeps: `git grep -n <pat> -- <path>` or `zg query --rg -F <pat> <path>`. The hooks deny recursive
  `grep`/`rg`, `rg` without a file, `rtk grep` and `find -exec` without `-maxdepth`; `grep` on named files is fine.
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

Prose costs tokens and context. Never trim verified numbers, `file:line` citations or
executed-mutation evidence; trim restatement, hedging and throat-clearing.

- **Code comments:** default to zero. Keep one only for a non-obvious constraint, invariant or
  workaround; never restate what a well-named identifier says. A doc comment longer than its
  function is a defect: shorten the comment.
- **SUMMARY.md / DECISION.md / THREAT-MODEL.md and other planning artifacts:** as long as the
  evidence requires; state each finding once, where a reader will look for it.
- **Subagent final reports:** lead with the answer, not the journey; readable in under a minute
  unless the stakes demand the detail.
- **PR descriptions and commit messages:** what changed and why at milestone level, not a commit list.
- **Chat status updates:** 1-3 sentences; the result, not the journey.

## Local Development

Start commands (backend JWT bypass, per-app dev servers) → `docs/development/command-reference.md`.
Kong Gateway / JWT bypass rationale → `docs/development/supabase-local-stack.md`.

## Development Policies

### Before Creating a PR (MANDATORY — no exceptions)

**Run `scripts/preflight.sh` before every PR — it mirrors `pr-validation.yml` exactly. There is no
"push anyway."** Deterministic gates green once + tests green twice = ready; anything else = not
ready. Full command reference, flags, coverage gate and rationale: `.claude/rules/pre-pr-quality-gates.md`
(read it before running preflight or opening a PR).
Within a phase, full preflight runs once on the final tree, not per plan: see its "Test cost" section.

**Before any plan, fix or SUMMARY claims done:** tests green is not done. On the final tree run
`deno check` and `deno lint` for touched `apps/api` paths; `deno fmt` then lint again (fmt can detach a
`// deno-lint-ignore`); `deno run --allow-read scripts/fp-gate.ts`; `npx nx typecheck` and `lint` for a
touched frontend project; for any NEW money/auth/KYC module,
`deno run --allow-read scripts/check-p0-tier-delta.ts --diff-file <diff>`.

### Investigating a CI failure — use the triage tool FIRST

**Do not scrape raw `gh run view --log-failed` output** — it truncates, misses job types, and
blows context. Use `scripts/ci-diagnose.ts` instead (per-job conclusions + failing test lines via
the GitHub API). Full usage and CI Failure Digest / artifact details: `docs/development/command-reference.md`.

### Subagent Usage IS MANDATORY

Delegate substantial tasks to subagents. **Every spawn passes `model` explicitly** (alias only, never
a model ID): agent definitions with no `model:` line (gsd-planner, gsd-plan-checker, gsd-debugger)
inherit the spawner's tier. Pick the cheapest tier that does the job correctly and escalate only for
a stated reason; a batch where every agent is Opus "to be safe" is a defect.

| Tier | Use for |
|---|---|
| `haiku` | Default implementer (`gsd-executor`, `gsd-test-writer`: features, multi-file changes, fixes, tests, migrations, edge handlers; Opus plans are already decomposed). Test/lint/type-check/build/git/log runs via `subagent_type: "gsd2-runner"` (Bash+Read, no CLAUDE.md load, ~4k-token start vs ~25k). File/config lookups, SUMMARY.md, STATE.md, changelog. |
| `sonnet` | ALL coordinators (roadmap / phase / death-resume; Opus only when the CEO asks); they orchestrate, the Opus work runs in separate dispatches. Every review, verify and pre-verification round. `gsd-planner` / `gsd-plan-checker` outside high-stakes. Implementation only when escalated: Haiku failed the same task twice, the task is undecomposed/ambiguous, debugging with unclear root cause, architecture, or review feedback needing judgment beyond the stated fix. |
| `opus` | Plans and plan-checks for high-stakes domains; architecture and API contract changes; DB schema design; cross-subsystem root-cause analysis; the phase-end `gsd-verifier`; `gsd:audit-milestone`; rulings. Runs as `fable` while the allowance lasts (below). |

**Fable allowance (CEO ruling 2026-11-10):** while it lasts, every Opus-tier dispatch (this table's
`opus` row, the batched diff review, phase verifier, audit, rulings) uses `model: "fable"`; if
rejected for allowance/availability, fall back to `model: "opus"` and say so. Sonnet/Haiku tiers
are unchanged; Fable agents may use Haiku subagents; the parallelism ceiling and the
no-all-high-tier-batch rule still apply.

**High-stakes domains:** auth, money movement / payments, fraud/AML, KYC gates, RNG/fairness, game
configs, complex game logic, game UI/UX. Plan, implementation and review are separate dispatches,
never one agent reviewing its own work: an Opus plan (RNG/money/authz plans carry an adversary-view
section: what an anonymous or authenticated caller can read mid-round), a Haiku implementer
(escalated per the table), the Sonnet review loop, then a fresh Opus review of the diff against the
plan.

**Review loop:** a fresh Sonnet agent each round, never the implementer, every severity fixed.
High-stakes plans loop until a round reports zero findings; after round 4 a fresh Opus ruling on
the last round's findings decides whether another round runs or the loop closes with those findings
fixed. Other plans get at most 3 rounds: fix every finding of each round, round 3 reviews the fixes
and the diff, fix its findings and close; only a CRITICAL/HIGH in round 3 earns a fourth.

**Opus runs once each at:** (1) plans for money/auth/security/RNG/KYC work; (2) ONE batched diff
review against the plan (2-3 plans where possible) after the Sonnet loop closes; (3) the phase-end
`gsd-verifier` (goal against on-disk evidence), preceded by a Sonnet pre-verification of all
must-haves with on-disk evidence; (4) rulings; (5) the milestone audit. Further Opus rounds only re-check HIGH/money-path
fixes. If the plan-check budget ran out with BLOCKER/HIGH fixes never re-checked, the diff-review
brief names each one and the reviewer confirms it closed (file:line + test) or raises it as HIGH.

**Rulings: a fresh Opus dispatch decides, never the coordinator itself:** deferring or accepting
any failure, accepting a deviation from the plan, loosening or disputing a test assertion, and
autonomous design decisions in a high-stakes domain.

**Haiku context and reporting cost:** Haiku is cheaper with context under ~100k tokens: one plan
task / one finding batch per fresh agent, read line ranges not whole files, save test logs to
`.tmp/` and read only failing lines. All agents report answer-first, ≤10 lines.

**Parallelism:** every spawner at every level of the tree (coordinator, executor, researcher) runs
**at most 2 of its own subagents at once**; batch wider fan-outs into waves of 2. **Never 2
executors in parallel within one phase**, whatever the wave structure says (`TASK-CHECKPOINT.json`
is phase-scoped, so parallel executors overwrite each other's resume state). Only the top-level
roadmap runner may run up to **3 phase coordinators** at once (no separate plan-ahead coordinator);
their phases must not edit the same files (claims live in `.tmp/phase-file-claims.md`). Everything
touching the shared stack (live tests, DB mutations, db reset, preflight) is serialized by
`.tmp/local-stack.lock` (`owner.txt`; take before, release after). `supabase db reset` needs no CEO
approval, but first confirm no other agent has a test running (lock owner + ListAgents/peer
check-in).

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
  the gsd-verifier" in a general-purpose prompt is not a verifier — its output is void. `general-purpose` is only for work no GSD role covers; test/lint/git/log runs use `gsd2-runner`.
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
