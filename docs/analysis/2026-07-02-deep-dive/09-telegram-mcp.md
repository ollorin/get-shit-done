# Telegram MCP Integration — Deep Analysis

## Inventory

### Daemon & Adapter Entry Points
- `mcp-servers/telegram-mcp/src/daemon/index.ts` (319 lines) — lifecycle, IPC handler registration, bot startup
- `mcp-servers/telegram-mcp/src/adapter/index.ts` (428 lines) — stdio MCP server, tool proxying, session management
- `mcp-servers/telegram-mcp/src/daemon/ipc-server.ts` (212 lines) — Unix socket IPC listener, NDJSON protocol
- `mcp-servers/telegram-mcp/src/adapter/ipc-client.ts` (227 lines) — IPC connection, request/response routing
- `mcp-servers/telegram-mcp/src/adapter/daemon-launcher.ts` (141 lines) — daemon spawn & health check

### Question & Session Management
- `mcp-servers/telegram-mcp/src/daemon/question-service.ts` (434 lines) — blocking question lifecycle, JSONL persistence
- `mcp-servers/telegram-mcp/src/daemon/session-service.ts` (151 lines) — session registry, in-memory only

### Bot & Handlers
- `mcp-servers/telegram-mcp/src/daemon/bot/index.ts` (369 lines) — Telegraf bot lifecycle, webhook/polling modes, ngrok support
- `mcp-servers/telegram-mcp/src/daemon/bot/handlers.ts` (175 lines) — command handlers, text/voice routing
- `mcp-servers/telegram-mcp/src/daemon/bot/menu.ts` (226 lines) — inline keyboard panels
- `mcp-servers/telegram-mcp/src/daemon/bot/whisper.ts` (167 lines) — voice transcription via whisper.cpp binary

### Shared Types & Utilities
- `mcp-servers/telegram-mcp/src/shared/types.ts` (112 lines) — Session, Question, IPC protocol types
- `mcp-servers/telegram-mcp/src/shared/socket-path.ts` (30 lines) — project-scoped socket path computation
- `mcp-servers/telegram-mcp/src/shared/logger.ts` (pino logging setup)

### Configuration
- `mcp-servers/telegram-mcp/package.json` (31 lines) — dependencies, build targets
- `mcp-servers/telegram-mcp/.env.example` (28 lines) — environment variables

**Total size**: ~3.5 KB TypeScript + 52.5 KB node_modules/package-lock

---

## Architecture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Code (via MCP stdio)                                    │
│  ┌──────────────────────────────────────┐                       │
│  │  Adapter Process (adapter/index.ts)  │ ← Spawned per session │
│  │  ├─ Ensurе daemon running            │                       │
│  │  ├─ Connect to Unix socket @ /tmp/   │                       │
│  │  ├─ Register session with daemon     │                       │
│  │  └─ Proxy tool calls via IPC         │                       │
│  └──────────────┬───────────────────────┘                       │
└─────────────────┼──────────────────────────────────────────────┘
                  │ NDJSON over Unix domain socket
                  │ (IPC client → IPC server)
                  │
┌─────────────────▼──────────────────────────────────────────────┐
│  Daemon Process (daemon/index.ts) ← Spawned once, detached    │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ IPC Server (daemon/ipc-server.ts)                         │ │
│  │ ├─ Listens on Unix socket                                 │ │
│  │ ├─ Routes method calls to handler map                     │ │
│  │ └─ Maps: register_session → sessionService.register()     │ │
│  │         ask_blocking_question → questionService.ask()     │ │
│  │         send_message → bot.telegram.sendMessage()         │ │
│  │         etc.                                              │ │
│  └────┬──────────────┬──────────────┬──────────────────────┘ │
│       │              │              │                         │
│  ┌────▼──────┐  ┌────▼──────┐  ┌───▼──────────┐              │
│  │ Session   │  │ Question  │  │ Bot Instance │              │
│  │ Service   │  │ Service   │  │ (Telegraf)   │              │
│  │           │  │           │  │              │              │
│  │ • In-mem  │  │ • Blocks  │  │ • Polling/   │              │
│  │   session │  │   on      │  │   webhook    │              │
│  │   registry│  │   promise │  │ • Handlers   │              │
│  │ • Status  │  │ • JSONL   │  │ • Forum      │              │
│  │   updates │  │   persist │  │   mgmt       │              │
│  │           │  │ • Event   │  │              │              │
│  │           │  │   emitter │  │              │              │
│  └───────────┘  └────┬──────┘  └───┬──────────┘              │
│                      │              │                         │
│                      │              │  handlerEvents          │
│                      └──────┬───────┘  EventEmitter           │
│                             │                                 │
│                      ┌──────▼─────────┐                       │
│                      │ Telegram API   │                       │
│                      │ (via Telegraf) │                       │
│                      └────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
         ↕ Telegram protocol (bot token, group ID)
    ┌─────────────────────┐
    │  Telegram Cloud API │
    └─────────────────────┘
```

### IPC Protocol

**Location**: `mcp-servers/telegram-mcp/src/daemon/ipc-server.ts:7-11` & `src/adapter/ipc-client.ts:9-11`

- **Transport**: NDJSON over Unix domain socket (`/tmp/telegram-mcp-{hash}.sock`)
- **Request format**: `{ "id": "uuid", "method": "ask_blocking_question", "params": {...} }\n`
- **Response format**: `{ "id": "uuid", "result": {...} }` or `{ "id": "uuid", "error": {...} }`
- **Flow**:
  1. Adapter writes request + newline to socket
  2. Daemon parses request, looks up handler in Map
  3. Handler executes (may block), returns result or error
  4. Daemon writes response + newline back to socket
  5. Adapter correlates response via UUID, resolves Promise

### Session Registration Flow

**Location**: `daemon/index.ts:116-127` (handler), `adapter/index.ts:289-294` (invocation)

```
Adapter starts → ensureDaemon() → connect to socket → 
register_session(projectRoot) → SessionService.register() → 
  [daemon] Create session { id, label, status='idle', connectedAt }
  [daemon] Return { sessionId, label }
[adapter] Store sessionId in closure, attach disconnect listener
```

**Auto-rebalance**: `daemon/index.ts:290-296` — When adapter disconnects, daemon auto-unregisters session.

### Blocking Question Mechanism

**Location**: `daemon/question-service.ts:84-226` (ask method)

1. **Create question record** (UUID, sessionId, title, body, context, timeoutMinutes)
2. **Find follow-up thread** (line 121) — if session answered a question within last 5 min, reuse that thread
3. **Create forum topic** (line 130) via `bot.telegram.createForumTopic()` or fallback to DM mode
4. **Post question body** (line 151) to thread or group
5. **Update session status** (line 164) to 'waiting'
6. **Block on Promise** (line 173):
   ```typescript
   const answer = await new Promise<string>((resolve, reject) => {
     const onAny = (answerText: string) => { clearTimeout(timer); resolve(answerText); };
     const timer = setTimeout(() => {
       // On timeout: notify user, clean up, reject
       questionRecord.answer = undefined; // ← marks as not answered
       this.cleanUpQuestion(questionId);
       reject(new Error(`Question timed out after ${timeoutMinutes} minutes`));
     }, timeout);
     this.once(`answer:${questionId}`, onAny); // ← waits for event
   });
   ```
7. **Answer arrival** (via `deliverAnswer()` at line 235):
   - Bot receives text/voice reply in thread
   - Handler emits `thread:text_reply` or `thread:voice_reply` event
   - `daemon/index.ts:82-93` (line 82-105) listens, calls `questionService.deliverAnswer(threadId, text)`
   - `deliverAnswer()` emits `answer:{questionId}` event → resolves waiting Promise
8. **Post-answer**: Save to JSONL, confirm receipt in thread, update session to 'busy'

**Timeout behavior**: Default 30 minutes (configurable). Daemon-side timeout only — adapter has independent IPC timeout.

### Multi-Instance Safety

**Location**: `shared/socket-path.ts:26-30`

```typescript
const root = projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
const hash = createHash('sha1').update(root).digest('hex').slice(0, 8);
return `/tmp/telegram-mcp-${hash}.sock`;
```

**Claim**: Each project gets a unique socket file based on SHA1(projectRoot).
- ✅ Project isolation verified: different projects → different hashes → separate daemon instances
- ✅ Socket path locked: Unix socket has owner-only permissions (0o600) set in `ipc-server.ts:177`
- ⚠️ No file locking on the JSONL state file (`~/.claude/knowledge/question-state.jsonl`) — see Issues below

**Daemon persistence**: Multiple adapters can connect to the same daemon (one per terminal session). All adapters route through a single daemon instance per project.

---

## Invocation Map

### MCP Tool Definitions

**Location**: `adapter/index.ts:44-174` — Six tools registered:

1. **`ask_blocking_question`** (lines 46-68)
   - Input: `{ question, context?, timeout_minutes? }`
   - Output: `{ answer: string }`
   - IPC method: `ask_blocking_question` → `daemon/index.ts:142-159`

2. **`check_question_answers`** (lines 70-90)
   - Input: `{ question_ids?, wait_seconds? }`
   - Output: `{ questions: Question[] }` (pending only)
   - IPC method: `check_question_answers` → `daemon/index.ts:161-197`

3. **`mark_question_answered`** (lines 92-104)
   - Input: `{ question_id }`
   - Output: `{ delivered: boolean }`
   - IPC method: `mark_question_answered` → `daemon/index.ts:199-225`

4. **`send_message`** (lines 106-123)
   - Input: `{ text, thread_id? }`
   - Output: `{ sent: true, mode: 'thread'|'group', threadId? }`
   - IPC method: `send_message` → `daemon/index.ts:227-242`

5. **`send_status_update`** (lines 125-138)
   - Input: `{ status_text }`
   - Output: `{ sent: true }`
   - IPC method: `send_status_update` → `daemon/index.ts:244-273`

6. **`create_topic`** (lines 160-173)
   - Input: `{ title }`
   - Output: `{ threadId: number }`
   - IPC method: `create_topic` → `daemon/index.ts:275-283`

### No Detected Workflow/Agent Invocations

**Search result**: Grep for `ask_blocking_question`, `send_status_update`, `create_topic`, `check_question_answers` across `/agents/` and `/workflows/` yielded **no hits**. The integration is defined but not actively used in the GSD framework yet.

---

## Issues Found

### 1. **Race Condition: Question State JSONL Without File Locking** [HIGH]

**Location**: `daemon/question-service.ts:413-423` (saveState method)

```typescript
private saveState(): void {
  try {
    const allQuestions = Array.from(this.questions.values());
    const lines = allQuestions.map((q) => JSON.stringify(q));
    const content = lines.length > 0 ? lines.join('\n') + '\n' : '';
    fs.writeFileSync(this.stateFilePath, content, 'utf8');
    // ...
  }
}
```

**Problem**: 
- Called frequently (after question creation, after answer received, after cleanup).
- Multiple daemons (one per project) could write to *shared* `~/.claude/knowledge/question-state.jsonl` if projects share that path.
- `fs.writeFileSync()` has no locking — concurrent writes corrupt the file (truncation, partial lines).
- **Evidence**: 
  - Line 418: `fs.writeFileSync(...)` without using `proper-lockfile` package (which IS in dependencies but not used).
  - Line 57: State file path is hardcoded: `path.join(os.homedir(), '.claude', 'knowledge', 'question-state.jsonl')` — no per-project scoping.

**Failure scenario**: Daemon 1 (project A) and Daemon 2 (project B) both save state simultaneously → file corruption, lost questions.

**Mitigation present**: ❌ None. The `proper-lockfile` dependency is listed in `package.json:20` but never imported.

---

### 2. **Daemon Crash Silent Failure: Adapter Reconnect Loop But No User Notification** [MEDIUM]

**Location**: `adapter/index.ts:243-286` (reconnect logic)

```typescript
const MAX_RECONNECT_RETRIES = 10;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 8000;

const attemptReconnect = async (attempt: number): Promise<void> => {
  // ... exponential backoff loop, silently retries ...
  if (attempt > MAX_RECONNECT_RETRIES) {
    log.error({ maxRetries: MAX_RECONNECT_RETRIES }, 'Max reconnect attempts reached — giving up');
    process.exit(1); // ← Hard exit, no tool error returned to user
  }
};
```

**Problem**:
- If the daemon crashes after an adapter session starts, the adapter enters a 10-attempt reconnect loop with exponential backoff.
- Max delay is 8 seconds between attempts, total retry time ~45 seconds before giving up.
- During this time, **any tool call hangs** waiting for a response that will never come.
- If a tool (e.g., `ask_blocking_question`) is mid-flight when daemon dies, the request times out after `30 + timeout_minutes` (line 191-194).
- **User-facing impact**: Questions timeout silently, agent doesn't know the daemon crashed.

**Evidence**: `adapter/index.ts:391-403` — tool error handling returns `{ error, isError: true }` but reconnect failures just log and exit.

**Failure scenario**: Daemon OOM, crashes. Adapter tries to reconnect for ~45 seconds. Agent blocks on `ask_blocking_question` for 30+ minutes before timeout, unaware daemon is down.

---

### 3. **Question Timeout Race: Daemon Crashes After Question Created, Before Answer Timeout** [MEDIUM]

**Location**: `daemon/question-service.ts:285-344` (restoreState method)

```typescript
public restoreState(savedQuestions: Question[]): void {
  // ... restores unanswered questions ...
  // Filter out pending questions that expired while the daemon was down
  if (q.answer === undefined) {
    const expiresAt = new Date(q.createdAt).getTime() + q.timeoutMinutes * 60 * 1000;
    if (expiresAt < now) {
      staleCount++;
      // Notify user in thread, then skip restore
      continue;
    }
  }
  this.questions.set(q.id, q);
}
```

**Problem**:
- If daemon crashes after question creation but before the user answers, the question is restored on daemon restart.
- But the **adapter is already waiting** for the response from the old daemon instance (which crashed).
- The restored question will timeout at the daemon's calculated time, but the adapter will timeout at its own scheduled time (IPC timeout, not question timeout).
- If adapter reconnects between question timeout and daemon restart, it gets a stale "already timed out" question.

**Evidence**: 
- `question-service.ts:295-314`: Stale question detection only checks `createdAt + timeoutMinutes`, not whether the adapter is still waiting.
- `ipc-client.ts:159-164`: IPC timeout for `ask_blocking_question` is `timeoutMinutes * 60 + 60` seconds — **longer than question timeout at daemon**. If question times out at daemon (30 min) but IPC timeout is 31 min, adapter still thinks it's waiting.

**Failure scenario**: 
1. Adapter calls `ask_blocking_question` (30 min timeout)
2. Daemon creates question, posts to thread
3. Daemon crashes 5 seconds later
4. Adapter reconnects 45 seconds later, re-invokes same question
5. Daemon restores question, but it now has 5 sec less timeout
6. Daemon times out question at 29m 55s
7. Adapter still waiting for response (30m IPC timeout)
8. Question silently fails at daemon, timeout message posted, but adapter never learns why

---

### 4. **Whisper Transcription Error Returns String, Not Throw** [MEDIUM]

**Location**: `daemon/bot/whisper.ts:122, 158-161` & `handlers.ts:136-140`

```typescript
export async function transcribeVoice(fileLink: string): Promise<string> {
  try {
    // ... transcription logic ...
    return transcript;
  } catch (err: any) {
    const message = `[Transcription failed: ${err.message}]`;
    log.error({ err: err.message }, 'Voice transcription error');
    return message; // ← Returns error as string, not throws
  }
}

// handlers.ts:136-140
if (transcript.startsWith('[Transcription failed:')) {
  log.warn({ threadId }, 'Transcription failed — prompting user to retry with text');
  await ctx.reply(`Could not transcribe voice message. Please reply with text instead.\n${transcript}`);
  return; // ← Early exit, no answer delivered
}
```

**Problem**:
- Voice transcription never throws; it returns a string.
- If transcription fails (ffmpeg missing, whisper.cpp binary not found, network issue downloading model), the handler sends a message but **does not deliver an answer** to the question.
- The question remains pending, waiting for a text reply.
- **Silent failure**: The agent doesn't know the transcription failed; it only knows the user sent a voice message and then never replied (because the handler told them to retry with text but didn't mark it as answered).

**Evidence**: `whisper.ts:122` (function signature `Promise<string>`), line 159 (catch always returns error string).

**Failure scenario**: Whisper model not downloaded, user sends voice reply to `ask_blocking_question`, daemon logs error, user is told to retry with text, but question stays pending. Agent thinks user is ignoring it.

---

### 5. **Socket File Permission Race: TOCTOU (Time-of-Check-Time-of-Use)** [MEDIUM]

**Location**: `daemon/ipc-server.ts:161-187` (listen method)

```typescript
async listen(): Promise<void> {
  try {
    fs.unlinkSync(this.socketPath); // Remove stale socket
    log.debug({ socketPath: this.socketPath }, 'Removed stale socket file');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn({ err }, 'Unexpected error removing stale socket file');
    }
  }

  // RACE: Between unlink and listen, another process could create the socket
  await new Promise<void>((resolve, reject) => {
    this.server.listen(this.socketPath, () => {
      try {
        fs.chmodSync(this.socketPath, 0o600); // Set permissions AFTER binding
        // ...
      }
    });
  });
}
```

**Problem**:
- Socket file is created by `net.Server.listen()`, then permissions are chmod'd.
- Between `listen()` completing and `chmod()` executing, another process could connect with default permissions (0o666 or 0o644 depending on umask).
- **Security issue**: If multiple projects use the same socket path (hash collision or misconfiguration), an unprivileged user could connect to another user's daemon and ask questions as them.

**Evidence**: 
- Lines 174-181: `listen()` creates socket, **then** chmod in callback
- Hash collision risk: SHA1(projectRoot) is 8 hex chars — only ~2^32 possible values. Two different projects could map to same hash.

**Mitigation**: Weak — relies on hash uniqueness and fast chmod.

---

### 6. **IPC Buffer Overflow Protection Logged But Not Enforced** [LOW]

**Location**: `daemon/ipc-server.ts:63-70`

```typescript
socket.on('data', (chunk: Buffer) => {
  buffer += chunk.toString('utf8');

  if (buffer.length > IPCServer.MAX_BUFFER_SIZE) {
    log.warn({ clientId, bufferLength: buffer.length }, 'Buffer exceeded MAX_BUFFER_SIZE — destroying socket to prevent memory growth');
    socket.destroy(new Error('buffer overflow'));
    return;
  }
  // ...
});
```

**Problem**: 
- Max buffer is 1 MB (line 41). If a tool call sends a very large parameter (e.g., a 5 MB question body), the socket is destroyed.
- **Impact**: Agent cannot ask very large questions (e.g., full source code as context).
- **Not documented**: Tool input schemas don't mention size limits.

**Evidence**: `IPCServer.MAX_BUFFER_SIZE = 1024 * 1024` (line 41), no validation of input size before accepting.

---

### 7. **Missing Logging in Question Delivery Path** [LOW]

**Location**: `daemon/question-service.ts:235-246` (deliverAnswer)

```typescript
deliverAnswer(threadId: number, text: string): boolean {
  const questionId = this.threadToQuestion.get(threadId);
  if (questionId === undefined) {
    log.debug({ threadId }, 'Thread reply received but no pending question for this thread');
    return false;
  }

  log.info({ questionId, threadId }, 'Delivering answer to pending question');
  this.emit(`answer:${questionId}`, text);
  this.emit('anyAnswer');
  return true;
}
```

**Problem**:
- If a user replies to a thread but the daemon has no record of that question (e.g., daemon restarted, question already timed out), the handler silently ignores it.
- `log.debug` is not visible at default `info` level.
- **User confusion**: User replies in a thread, gets a checkmark reaction from the bot, but their reply disappears. No log entry to help debug.

**Evidence**: Line 238, `log.debug` at INFO level threshold.

---

### 8. **Adapter Doesn't Validate Tool Response Shape** [LOW]

**Location**: `adapter/index.ts:319-405` (tool handler)

```typescript
case 'ask_blocking_question':
  result = await proxyTool('ask_blocking_question', { ... });
  result = (result as { answer: string }).answer; // ← Assumes shape
  break;
```

**Problem**:
- If daemon returns malformed response (e.g., `{ result: "some string" }` instead of `{ result: { answer: "..." } }`), the cast silently produces undefined.
- Tool call returns `undefined`, agent sees `"undefined"`.

**Evidence**: `adapter/index.ts:331` and other case blocks use unsafe type assertion without validation.

---

### 9. **Question State Restore Doesn't Re-emit Pending Answers** [MEDIUM]

**Location**: `daemon/question-service.ts:285-344` (restoreState)

```typescript
public restoreState(savedQuestions: Question[]): void {
  // ... restore questions to maps ...
  this.questions.set(q.id, q);
  if (q.threadId !== undefined && q.answer === undefined) {
    this.threadToQuestion.set(q.threadId, q.id);
  }
  // ... but never re-emit pending answers from *before* the crash ...
}
```

**Problem**:
- If daemon crashes *after* user answers but *before* saving to JSONL, the answer is lost on restart.
- Daemon restores question as pending, but answer isn't in JSONL.
- User sees "Answer received" in Telegram, but adapter sees question still pending and times out.

**Evidence**: 
- `question-service.ts:200-215`: Answer is saved to JSONL *after* being emitted to adapter.
- If crash happens between lines 202 and 206, answer is lost.
- Restore (line 285+) has no mechanism to re-query Telegram for the answer that was delivered but not persisted.

---

## Improvement Candidates

1. **Add File Locking to Question State Persistence**
   - Use `proper-lockfile` package (already in dependencies)
   - Wrap `saveState()` to acquire lock before write
   - Per-daemon lock file (project-scoped) to prevent multi-daemon collisions
   - Estimate: 20 LOC in `question-service.ts`

2. **Implement Health Check Endpoint in Daemon**
   - Add lightweight IPC method `ping` that returns OK
   - Adapter uses this in reconnect backoff to distinguish "daemon down" from "socket not ready"
   - Notify agent immediately on daemon unavailability instead of silent retry loop
   - Estimate: 15 LOC in daemon, 10 LOC in adapter

3. **Scope Question State File Per-Project**
   - Change `stateFilePath` to include project hash: `~/.claude/knowledge/questions-{hash}.jsonl`
   - Eliminates shared-file contention between projects
   - Estimate: 3 LOC in `question-service.ts`

4. **Add Attempt-Count to Restored Questions**
   - Track how many times a question has been restored from JSONL
   - If > N restores, auto-expire question to prevent infinite pending state
   - Estimate: 10 LOC in `question-service.ts` + `types.ts`

5. **Implement Voice Transcription Retry with User Consent**
   - On transcription failure, return a special answer marker `[TRANSCRIPTION_FAILED]`
   - Allow user to retry or manually type response
   - Don't leave question hanging
   - Estimate: 25 LOC in `whisper.ts` + `handlers.ts`

6. **Document Tool Input Size Limits**
   - Update MCP tool schema descriptions to warn about 1 MB buffer limit
   - Consider raising limit or implementing streaming for large questions
   - Estimate: 5 LOC + docs

7. **Add Struct Validation to IPC Response Handler**
   - Before type-casting daemon response, validate shape with zod or similar
   - Fail loudly on malformed response
   - Estimate: 30 LOC in `adapter/index.ts`

8. **Implement Question Answer Confirmation at Telegram Level**
   - When user replies in thread, ask daemon to query message history
   - Confirm answer was posted, not just assume it
   - Estimate: 40 LOC in `handlers.ts` + `question-service.ts`

9. **Scope IPC Socket Path in Safer Location**
   - Move socket from `/tmp/` (world-readable, TOCTOU-vulnerable) to `~/.claude/ipc/` (owner-only directory)
   - Estimate: 5 LOC in `socket-path.ts`

10. **Add E2E Test Coverage for Daemon Crash Recovery**
    - Verify question state survives daemon restart
    - Verify adapter reconnection succeeds
    - Verify stale question cleanup works
    - Estimate: 200 LOC in `.test.ts` file

---

## Open Questions

1. **Is the JSONL state file shared across multiple machines (NFS, cloud sync)?**
   - If yes, file locking becomes critical across network boundaries
   - Current `fs.writeFileSync` will silently corrupt shared files
   - Test: Does the codebase run in multi-machine setups?

2. **What happens if a user answers a question via Telegram DM instead of the thread?**
   - Handlers only look for `message_thread_id` (line 106 in handlers.ts)
   - DM replies are silently ignored
   - Is this intentional fallback behavior or a bug?

3. **How are very old timed-out questions cleaned up?**
   - Timed-out questions are removed from `questions` map (line 393 in question-service.ts)
   - But JSONL file keeps growing with answered + timed-out records
   - Will it eventually bloom?
   - Estimate cleanup needs: Implement JSONL compaction on daemon startup

4. **Is the adapter expected to handle tool timeouts gracefully?**
   - `ask_blocking_question` blocks for up to 30+ minutes
   - Some Claude Code terminals might kill long-running processes
   - What's the expected UX if user closes terminal mid-question?

5. **Can a malicious agent spam `create_topic` and leak Telegram groups?**
   - Each `create_topic` call creates a new forum thread forever
   - No rate limiting, quota, or cleanup
   - Can an agent exhaust Telegram's forum topic limit?

6. **Why is SessionService in-memory only?**
   - Sessions are ephemeral (lifetime of adapter connection)
   - But what if an agent wants to query all past session activity?
   - Should session state persist to JSONL like questions do?

---

## Summary

The Telegram MCP integration is **well-architected at the high level** (daemon + adapter IPC, clean separation of concerns, good logging). However, it has **several production-readiness gaps**:

- **Critical**: Race condition on JSONL state file (no locking)
- **High**: Silent daemon crashes leave adapters hanging
- **High**: Question timeout race between daemon and adapter timers
- **Medium**: Voice transcription failures don't bubble up as answer delivery failures
- **Medium**: Socket file permission race (TOCTOU)

The integration is **not currently invoked by any workflow or agent** in the GSD framework (no grep hits for the tool names), suggesting it's infrastructure-ready but awaiting agent integration.

**Recommendation**: Before using in production roadmap execution, resolve issues #1, #2, #3, and implement improvements #2, #3 (file locking, health checks, per-project state scoping).
