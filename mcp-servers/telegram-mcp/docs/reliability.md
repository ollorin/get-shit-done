---
title: Telegram MCP Reliability
summary: Daemon-crash detection, atomic state persistence, delivery retry, and escalation timeout fallback for the Telegram MCP integration (Phase 47).
domain: infra
tags: [telegram, mcp, reliability, ipc, daemon]
updated: 2026-07-04
---

# Telegram MCP Reliability

The escalation channel other GSD autonomy features route through (`ask_blocking_question` and friends). This doc covers what changed so the channel fails loud instead of hanging or silently dropping data: daemon-crash detection, atomic state persistence, delivery retry, and a workflow-layer timeout fallback.

## Daemon-crash detection

**`QuestionService.restoreState()`** (`src/daemon/question-service.ts`) now applies one deterministic path to every restored pending (unanswered) question — never a silent zombie:

| Question state at restart | Behavior |
|---|---|
| Already past its `timeoutMinutes` deadline | Dropped from live state, thread notified: `Question timed out after {N} minutes (daemon was restarted): "{title}"` |
| Not yet expired | Also dropped from live state (the crash destroyed the owning Promise/listener regardless of remaining time), thread notified: `This question cannot be resumed after a daemon restart -- please re-ask if still needed: "{title}"` |
| Already answered | Skipped — restored questions with `answer !== undefined` serve no operational purpose |

Every dropped question's `threadId` is added to an in-memory `orphanedThreadIds` set. `deliverAnswer(threadId, text)` checks this set first: a reply landing on an orphaned thread is logged at `warn` ("Reply arrived for an orphaned (post-restart) question -- cannot be delivered...") and returns `false`, distinct from a reply on a genuinely unknown thread (logged at `debug`, also returns `false`). Previously these two cases were indistinguishable and a reply to an orphaned thread could be silently swallowed.

### `DaemonUnavailableError`

`src/shared/errors.ts` defines a typed error surfaced whenever client-side code detects the daemon is unreachable:

```typescript
export class DaemonUnavailableError extends Error {
  readonly code = 'DAEMON_UNAVAILABLE' as const;
}
```

Wired at both client-side detection points:

| Site | File | Trigger |
|---|---|---|
| `IPCClient.request()` not-connected throw | `src/adapter/ipc-client.ts` | A request is made while the socket is not connected |
| Socket `'close'` handler | `src/adapter/ipc-client.ts` | Daemon process dies mid-request |
| `proxyTool()` catch | `src/adapter/index.ts` | Any tool call whose underlying error carries a `code` |

The MCP tool error JSON (`adapter/index.ts`'s catch block) includes `code` whenever the caught error has one:

```json
{ "error": "IPC client is not connected — daemon may have crashed", "tool": "ask_blocking_question", "code": "DAEMON_UNAVAILABLE" }
```

A tool call issued while the daemon is down fails with this shape immediately (milliseconds), not after the ~45s reconnect-exhaustion window.

### Reconnect policy

`src/adapter/reconnect-policy.ts` extracts the adapter's give-up/backoff decision into two pure functions (no dependency on `adapter/index.ts`, so they're directly importable in tests):

| Function | Signature | Purpose |
|---|---|---|
| `shouldGiveUpReconnecting` | `(attempt: number, maxRetries: number) => boolean` | `attempt > maxRetries` |
| `computeReconnectDelayMs` | `(attempt: number, baseDelayMs: number, maxDelayMs: number) => number` | Exponential backoff, capped at `maxDelayMs` |

Single-timer ownership: the daemon-side `question-service.ask()` `setTimeout` is the sole authority on "did the user answer in time." The adapter-side `IPCClient.methodTimeout()` value is a dead-man's-switch backstop only, for the case where the daemon hangs without closing the socket. Documented via matching code comments at both call sites.

## State file persistence

**Location:** `src/daemon/question-service.ts` (`saveState()`), path computed by `getStateFilePath()` in `src/shared/socket-path.ts`.

| Property | Before | After |
|---|---|---|
| Write mechanism | Bare `fs.writeFileSync()` | Write to `${stateFilePath}.tmp-${pid}-${random}`, then `fs.renameSync()` over the target (atomic POSIX rename — no torn/partial JSONL line survives a crash mid-write) |
| Path scoping | Hardcoded, shared across all projects: `~/.claude/knowledge/question-state.jsonl` | Per-project, SHA1-hash-scoped (mirrors `getSocketPath()`): `~/.claude/knowledge/question-state-{hash8}.jsonl` |
| `QuestionService` constructor | N/A | 5th constructor arg `stateFilePath` (optional, defaults to `getStateFilePath()`) |

```typescript
export function getStateFilePath(projectRoot?: string): string {
  const root = projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 8);
  return path.join(os.homedir(), '.claude', 'knowledge', `question-state-${hash}.jsonl`);
}
```

**Migration note:** changing the path only affects daemons started *after* this change. An already-running daemon keeps using the path it computed at its own startup and only picks up the new per-project path on its next organic restart. `proper-lockfile` remains a listed (intentionally unused) `package.json` dependency — atomic write-rename was chosen instead since it needs no lock-file lifecycle/staleness handling for this package's single-writer-per-process threat model.

## Delivery retry

`src/shared/retry.ts` exports `withRetry<T>(fn, options)`, wired into all three outbound Telegram send functions in `src/daemon/bot/index.ts`: `sendToGroup`, `sendToThread`, `createForumTopic`. `reactToMessage` is intentionally left unwrapped (cosmetic checkmark reaction, out of scope).

| Option | Default | Notes |
|---|---|---|
| `attempts` | 4 (1 initial + 3 retries) | `delaysMs.length + 1` |
| `delaysMs` | `[500, 1500, 4000]` | ms delay before each retry |
| `sleepFn` | real `setTimeout` | injectable for tests |

Every retry logs at `WARN`; final exhaustion logs at `ERROR` and rethrows the original error — a send failure is never silently dropped, but it also never blocks the primary blocking-question flow from returning the user's actual answer (callers keep their existing catch/no-catch semantics).

## Escalation timeout fallback (workflow layer)

`agents/gsd-phase-coordinator.md`'s sensitive-item escalation loop (Step A) reads the escalation timeout from config instead of a hardcoded literal:

| Config key | Location | Default |
|---|---|---|
| `telegram.escalation_timeout_minutes` | `.planning/config.json`, inside the existing `telegram` block | `30` (if file missing, unparseable, or key absent) |

**Step A-fallback:** if `ask_blocking_question` throws or errors for any reason — IPC timeout, a `DAEMON_UNAVAILABLE`-coded error, or the daemon's own question-timeout bubbling back as an IPC error — the coordinator:

1. Logs the failure loudly (visible in the milestone audit).
2. Writes a `DEFERRED.json` waiver via the sanctioned CLI:
   ```bash
   node get-shit-done/bin/gsd-tools.js deferred add {phase_number} --step discuss --reason "Telegram escalation timed out/unavailable for: {item.question}" --approver timeout-fallback
   ```
3. Appends an `escalation_complete` JSONL record to `.planning/telegram-sessions/{YYYY-MM-DD}.jsonl` with `escalated_to_discretion: true`.
4. Pushes the item into `discretion_items` (so `CONTEXT.md`'s Claude's Discretion subsection documents it).
5. Continues to the next item — the run is never left hanging on a reply that may never come.

One shared path covers both "user didn't reply in time" and "daemon was down at escalation time" — both surface identically as the `ask_blocking_question` call throwing/rejecting.

`workflows/execute-roadmap.md` has no `ask_blocking_question` call sites (verified by grep) — its Telegram usage is exclusively fire-and-forget `send_message`/`send_status_update`, so no fallback wiring is needed there.

## Testing

`mcp-servers/telegram-mcp` has its own test suite, run separately from the root suite:

```bash
cd mcp-servers/telegram-mcp
npm test   # tsc && find dist -name '*.test.js' | xargs node --test
```

35 tests across 5 files (`question-service.test.ts`, `adapter-reliability.test.ts`, `socket-path.test.ts`, `retry.test.ts`, `daemon/bot/index.test.ts`) — all use fake/injected `createForumTopic`/`sendToThread`/`sendToGroup` and isolated `os.tmpdir()`-scoped paths, never the production socket or state file.
