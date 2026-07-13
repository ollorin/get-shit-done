# Agent-to-Agent Messaging (SendMessage)

This is the canonical GSD reference for agent-to-agent messaging via Claude Code's
`SendMessage` tool. The agent and workflow files @-reference this document rather than
duplicating its prose — edit the patterns HERE, once.

Messaging composes **on top of** the Executor Resilience Protocol
(`@get-shit-done/references/resilience.md`): handoff docs, PAUSED.json, JSON status
trailers, and the executor's headroom self-stop remain the durable file-based backbone.
SendMessage is **additive signalling** — a faster path for the common case and an enabler
of new coordination. Every message-based path below has an intact file-based fallback. If a
message is never delivered, the file mechanism still recovers the run.

---

## The tool

`SendMessage` sends a message to another agent. Canonical params:

- `to` — the recipient (see recipient forms below).
- `message` — the message text.
- `summary` — a 5–10 word UI preview of the message.

### Recipient forms

- **A teammate NAME** — addresses a named agent.
- **The literal `"main"`** — a background subagent uses this to reach ITS SPAWNER / the
  orchestrator that launched it. This is the ONLY correct way for a subagent to signal
  upward.
- **An `agentId`** (format `a1b2c3…`, captured from a spawn result) — RESUMES a
  completed or paused background agent from its transcript, in the same session.

---

## Three hard semantics (encode these; do not fight them)

1. **Delivery is at the recipient's NEXT tool round, not real-time.** Messaging is a
   COOPERATIVE signal, never a preemptive halt. The executor's own headroom self-stop
   (self-monitoring) stays PRIMARY — messaging makes the common case tighter and unlocks
   new coordination, but it never replaces self-detection. Never build a design that
   assumes a message stops a peer instantly.

2. **A subagent cannot observe another agent's context/session state.** A signal about "I'm
   near my limit" MUST originate FROM the agent hitting the limit and flow UPWARD
   (`to: "main"`). A coordinator cannot see a subagent's context and so must never push a
   top-down "you're about to overflow" signal — it has no way to know.

3. **Resume-by-agentId is SAME-SESSION only.** Across a quota/launchd resume (a fresh
   `claude -p`), the agentId is gone. So the handoff-doc + PAUSED.json mechanism remains
   the ONLY durable cross-session recovery path. SendMessage-resume optimizes the
   in-session case; the file-based fallback must stay intact for every cross-session case.

---

## The 6 application patterns

### App #1 — Executor upward continuation signal
When the executor self-stops at its headroom boundary (`<executor_resilience_protocol>` in
`agents/gsd-executor.md`), IN ADDITION to writing EXECUTOR-HANDOFF.json and returning
`## PLAN INTERRUPTED` + the JSON status trailer, it `SendMessage`s `to: "main"` with
summary "continuation needed — handoff written" and a message naming the plan, the
last-completed-task index, and the handoff path. This gives the coordinator an out-of-band
early signal instead of waiting for the turn to unwind. The handoff + trailer are the
durable record; the message is purely additive.

### App #2 — Prefer resume-by-agentId over cold fresh-spawn (in-session)
The coordinator (`workflows/execute-phase.md`) CAPTURES each executor's `agentId` from its
spawn result and retains it. On a resumable in-session interruption (a clean
`## PLAN INTERRUPTED`, or a session-limit pause where the window has since reset and the
agent is still in-session), the coordinator PREFERS `SendMessage(to: <agentId>, …)` to
resume that same executor from its transcript (richer context than a handoff doc) OVER
cold-spawning a fresh executor that re-reads the handoff. It FALLS BACK to the existing
fresh-spawn + `<prior_executor_handoff>` path whenever the agentId is unavailable — crossed
a session boundary, launchd resume, or agentId not captured. Decision rule: **agentId
present + same session → resume; else → cold spawn from handoff.**

### App #3 — Live course-correction (coordinator-mediated)
When `gsd-plan-checker` or `gsd-charlotte-qa` detects a problem in work an executor is STILL
producing, it `SendMessage`s `to: "main"` (the coordinator) with the finding MID-RUN, so
the coordinator can relay a correction to the executor instead of letting it finish wrong
and forcing a redo. This stays **coordinator-mediated**, not direct peer-to-peer: the
coordinator receives the finding and MAY `SendMessage(<executor agentId>, …)` to adjust the
in-flight executor. The structured report the checker/QA agent normally returns remains the
record; the message is the fast path.

### App #4 — Peer awareness in parallel waves
When a wave spawns multiple executors in parallel, the coordinator passes EACH executor the
peers' agentIds/names in its spawn prompt and instructs: **if you modify a file another
wave-peer's plan lists in its `files_modified`, `SendMessage` that peer** (its agentId) to
warn of the shared-file mutation. This fires ONLY on genuine shared-file overlap — never
chattily. It is the highest-value collision-prevention win in a parallel wave.

### App #5 — Upward progress heartbeat
On long plans (say > 4 tasks), after each task commit the executor MAY `SendMessage`
`to: "main"` a one-line progress heartbeat ("task N/M complete, green"). This is OPTIONAL
and rate-limited — not every task, not on short plans. It is a coordinator-visibility aid,
never required, never blocking. Its absence changes nothing about recovery.

### App #6 — Human relay at checkpoints
When a subagent hits a `checkpoint:decision` / `checkpoint:human-action` that isn't
auto-approved, it `SendMessage`s `to: "main"` to surface the decision to the
orchestrator/user immediately, and can stay alive awaiting the answer instead of only
ending its turn. This COMPOSES with the existing checkpoint return format — the structured
`## CHECKPOINT REACHED` return is still emitted as the durable record; the message is the
fast path that gets a human's attention sooner.

---

## Runtime assumption

For any of this to fire, the Claude Code harness must expose `SendMessage` to custom
subagents at runtime (in addition to the tool appearing in each agent's `tools:`
frontmatter, which is the necessary-but-not-sufficient prerequisite). Validate this on the
next real roadmap run; if the harness does not surface SendMessage to a given subagent, that
agent silently falls back to the file-based backbone with no loss of correctness.
