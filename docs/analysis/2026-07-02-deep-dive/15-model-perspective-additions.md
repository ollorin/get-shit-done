# Model-Perspective Additions to the Improvement Plan

**Date:** 2026-07-04
**Author:** The orchestrating model (Fable), asked by the maintainer: *"what would you analyze and add from your end?"*
**Vantage point:** Unlike docs 01–14 (code/docs audit driven by the maintainer's goals), these items come from *being the agent that runs inside GSD* — failure modes visible from the driver's seat, several observed live during the v1.14.0 run. Evidence measurements gathered 2026-07-04 (read-only sweep; numbers below are from that sweep).

Ranked by my judgment of impact on the maintainer's target: a high-quality framework for fully autonomous development.

## S-1. Session/quota-limit resilience (HIGH — observed live this run)

**What happened:** Phase 44's first coordinator died mid-planning with "You've hit your session limit · resets 12:30am". No automated recovery existed — the orchestrator manually inspected CHECKPOINT.json and hand-spawned a successor. If this had been a true unattended overnight run, the entire night would have been lost silently.

**Evidence:** Grep sweep found zero handling for session/quota exhaustion (circuit-breaker timeouts and the haiku→sonnet→opus escalation ladder target task errors, not provider limits). The existing quota commands track GSD's own budgets, not the provider session window.

**Proposal:**
- Orchestrator-level auto-resume protocol: on subagent death matching quota/session-limit patterns, read the phase CHECKPOINT.json and spawn a successor coordinator from `resume_from` automatically (exactly what was done by hand on 2026-07-02) — with a wait-until-reset option when the limit message includes a reset time.
- Pre-flight quota check in execute-roadmap: estimate run cost (phases × observed avg tokens) vs remaining session budget; if insufficient, either start later or plan a mid-run pause point deliberately instead of dying wherever the limit lands.
- This composes with US-16's fallback policy: session death is just another "channel down" event that must never hang a run.

## S-2. Behavioral eval harness for prompts and workflows (HIGH)

**The gap:** The framework's actual product is ~500KB of agent/workflow prompts, and there are **zero behavioral tests** — gsd-tools.test.js covers CLI functions only; nothing ever runs a workflow/agent and asserts what it does. Every prompt edit (including everything this milestone changes) ships blind. The framework enforces TDD on target projects while its own core logic is untested.

**Proposal:** A golden mini-project fixture (tiny repo with a 2-phase roadmap) + an eval runner that executes plan→execute→verify with cheap models and asserts on *artifacts*, not prose: were the right agents spawned, did the phase-gate fire, were commits atomic, was DEFERRED.json written when a step was skipped. Run on prompt-file changes in CI (weekly cadence if cost matters). This was P4-4 in the original backlog; from my seat it's the second most important item in the whole plan — without it, nobody can know whether the v1.14.0 enforcement changes actually reduced skip rates, and A/B-ing a prompt improvement (e.g. S-3) is impossible.

## S-3. Prompt size budgets and instruction architecture (HIGH)

**Evidence:** gsd-phase-coordinator.md is 70KB ≈ **17.5k tokens** — 8–9% of the context window consumed before any work starts, and its hard rules are scattered across dozens of sections. Five agents exceed 8k tokens (coordinator 17.5k, planner 14.5k, verifier 12.4k, debugger 9.4k, executor 9.2k). Top-3 workflows add another ~22k.

**Why this matters more than token cost:** instruction-following degrades with prompt length and rule dispersion. The maintainer's original complaint — mandatory steps skipped — is partly *caused* by burying "MUST" rules at position 14k of a 17.5k-token prompt. The v1.14.0 answer (deterministic gates) catches violations after the fact; slim prompts reduce violations at the source.

**Proposal:** (a) per-agent token budget enforced by a trivial CI check (e.g. coordinator ≤ 8k core); (b) an instruction architecture convention: short non-negotiable preamble (hard rules, return contract) + on-demand `@references/` for everything else; (c) the eval harness (S-2) measures whether slimming changes behavior. Extends simplification-plan D2 from "dedup duplicated text" to "budget and structure as a design rule."

## S-4. Version-skew detection: repo vs installed copy (MEDIUM)

**Evidence:** install.js prints the version but nothing detects that `~/.claude/get-shit-done/` is stale relative to the repo. The current detection mechanism is the maintainer's memory ("BTW, don't forget to run the install script" — 2026-07-02). During dogfooding runs like this one, agents execute the *installed* workflows while editing the *repo* copies; skew is guaranteed unless someone remembers to reinstall.

**Proposal:** install writes a manifest (content hash per deployed file + source git SHA); a cheap `gsd doctor` / SessionStart check compares and warns; execute-roadmap pre-flight asserts freshness when running inside the GSD repo itself. One-day change, removes a whole class of "why is my fix not taking effect" confusion.

## S-5. Agent self-report telemetry (MEDIUM)

**The gap:** When a GSD subagent underperforms, the reasons (context pressure, contradictory instructions, a tool error it swallowed, an instruction it couldn't satisfy) die with its context. The orchestrator sees only the final status JSON. Post-mortems (like the v0.1.9 one that spawned half the current gates) had to be reconstructed archaeologically.

**Proposal:** Extend every agent's return contract with a small structured self-report: `{context_pressure_estimate, instructions_not_followed:[{rule, why}], ambiguities:[...], tool_errors_swallowed:n}` appended to a run JSONL. Near-zero cost (it's part of the return the agents already produce), and after a few weeks the data shows exactly *which* instructions get dropped under pressure — feeding S-3 with facts instead of guesses.

## S-6. Prompt-injection hardening at the framework trust boundary (MEDIUM, security)

**The exposure:** GSD runs against arbitrary target repos. Coordinators/executors read target-repo file content directly into their context; the knowledge DB persists extracted content across projects; Telegram is an outbound channel. A hostile or merely-compromised target repo (a README, a test fixture, a comment block) can address instructions to the agents. Nothing in any agent prompt currently frames file-derived content as data-not-instructions.

**Signal:** upstream (glittercowboy) shipped prompt-injection suites and adversarial parser fixtures in v1.43 — they've evidently hit this. Port the concept, not necessarily the code.

**Proposal:** (a) a standard "content firewall" convention in agent prompts for quoted file content; (b) injection-pattern screening in the knowledge write path (composes with US-10's secrets filter — same choke point); (c) adversarial fixtures in the S-2 eval harness (a fixture repo that actively tries to derail the executor).

## S-7. Model-registry indirection (LOW-MEDIUM)

**Evidence:** Tier→model knowledge is mostly centralized in gsd-tools.js MODEL_PROFILES, but duplicated in gsd-circuit-breaker.js (per-tier timeout thresholds), gsd-escalation.js (escalation ladder), analytics.js (tier counters). Model generations also moved (Claude 5 family exists; routing docs and thresholds speak in 4.x terms). A model upgrade currently means editing 4 files and hoping thresholds still make sense.

**Proposal:** single config-sourced registry (tier name → model id → per-tier operating parameters); the other three files read from it. Fold into the deferred gsd-tools split (D1) or do standalone in an afternoon.

## S-8. Workflow-level crash-point audit (MEDIUM, extends P2)

**Evidence from this run:** the STATE.md schema mismatch (Phase 44 deferred item — `state advance-plan` can't parse the file it's supposed to advance) and the PRD `mv`-then-commit sequence that exits with a manual-fix instruction if interrupted halfway. P2 fixes file-level atomicity; nothing audits *workflow-level* crash points (killed between commit and state update; between archive and mining; between PRD move and roadmap write).

**Proposal:** enumerate the state-mutating steps in the golden-path workflows (~a dozen), classify each as idempotent/resumable/neither, and fix the "neither" ones. The Phase 44+ checkpoint discipline already gives the resume skeleton; this closes the gaps between checkpoints.

## S-9. Upstream sync cadence (LOW, strategic)

UPSTREAM-DIFF.md is from February; upstream has since shipped v1.42–v1.43 (multi-runtime support, security/fault-injection suites, deterministic test design). No urgency, but set a deliberate quarterly cherry-pick review so divergence stays a choice rather than drift. The security suites (S-6) are the first thing worth mining.

## What I checked and did NOT add

- **Human end-of-run report** — already exists (`analytics.js generateReport()`: phases, durations, failure rates, tier distribution). Worth extending with the US-3 waiver table once DEFERRED.json lands, but it's a refinement, not a gap.
- **Model-name hardcoding in prompts** — agents/workflows are clean (placeholders/config fallbacks); the issue is confined to the 4 bin files (S-7).

## Suggested disposition

| Item | Where it belongs |
|------|------------------|
| S-1 session-limit resilience | **Add to v1.14.0** if appetite allows (it composes with US-16 and Phase 48's retry machinery), else first item of v1.15 |
| S-2 eval harness, S-3 prompt budgets | v1.15 headline pair — "make prompt changes measurable, then shrink the prompts" |
| S-4 version-skew, S-5 self-report, S-8 crash-point audit | v1.15, small/medium items |
| S-6 injection hardening | v1.15, paired with S-2's adversarial fixtures |
| S-7 model registry, S-9 upstream cadence | Opportunistic / with the D1 split |
