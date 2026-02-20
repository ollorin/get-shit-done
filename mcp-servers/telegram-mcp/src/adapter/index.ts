/**
 * Telegram MCP Adapter — thin stdio transport that proxies tool calls to the daemon.
 *
 * This is what Claude Code launches via the MCP stdio protocol. It is intentionally
 * minimal: all business logic lives in the daemon process.
 *
 * Lifecycle:
 *   1. Load dotenv config
 *   2. Compute project-scoped socket path
 *   3. Ensure daemon is running (launch if not)
 *   4. Connect to daemon via IPC
 *   5. Register this session with the daemon
 *   6. Set up MCP server with StdioServerTransport
 *   7. Register all 6 MCP tools (proxied via IPC)
 *   8. On shutdown: unregister session, disconnect IPC, exit
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getSocketPath } from '../shared/socket-path.js';
import { createLogger } from '../shared/logger.js';
import { ensureDaemon } from './daemon-launcher.js';
import { IPCClient } from './ipc-client.js';

const log = createLogger('adapter');

// ─── State ───────────────────────────────────────────────────────────────────

let sessionId: string | null = null;
let ipcClient: IPCClient | null = null;

// ─── MCP Tool Definitions ────────────────────────────────────────────────────

/**
 * All 6 MCP-visible tools. These schemas match the existing implementation
 * (ask_blocking_question, check_question_answers, mark_question_answered) and
 * add the 3 new daemon tools (send_message, send_status_update, update_session_status).
 */
const TOOL_DEFINITIONS = [
  {
    name: 'ask_blocking_question',
    description:
      'Send a blocking question to user via Telegram and wait for their response. Blocks until the user replies or the timeout expires.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to send to the user',
        },
        context: {
          type: 'string',
          description: 'Optional execution context (e.g., current task, plan phase)',
        },
        timeout_minutes: {
          type: 'number',
          description: 'Max wait time in minutes (default: 30)',
          default: 30,
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'check_question_answers',
    description:
      'Poll for answers to pending blocking questions. Supports long polling with configurable timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        question_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Specific question IDs to check. If empty or not provided, checks all pending questions.',
        },
        wait_seconds: {
          type: 'number',
          description: 'Long poll timeout in seconds (default: 60, max: 300)',
          default: 60,
          maximum: 300,
        },
      },
    },
  },
  {
    name: 'mark_question_answered',
    description: 'Confirm receipt of an answered question.',
    inputSchema: {
      type: 'object',
      properties: {
        question_id: {
          type: 'string',
          description: 'The question ID to mark as answered',
        },
      },
      required: ['question_id'],
    },
  },
  {
    name: 'send_message',
    description:
      'Send a plain text message to the Telegram group (or a specific thread if thread_id is provided).',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Message text to send',
        },
        thread_id: {
          type: 'number',
          description: 'Optional forum thread ID. If omitted, sends to the main group.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'send_status_update',
    description:
      'Format and send a status update message to the Telegram group.',
    inputSchema: {
      type: 'object',
      properties: {
        status_text: {
          type: 'string',
          description: 'Status update text to send',
        },
      },
      required: ['status_text'],
    },
  },
  {
    name: 'update_session_status',
    description:
      "Update this session's status in the daemon registry. Use 'idle', 'busy', or 'waiting'.",
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['idle', 'busy', 'waiting'],
          description: "Session status: 'idle', 'busy', or 'waiting'",
        },
        question_title: {
          type: 'string',
          description: "Optional title of the current pending question (used when status='waiting')",
        },
      },
      required: ['status'],
    },
  },
  {
    name: 'create_topic',
    description:
      'Create a new forum topic (thread) in the configured Telegram group and return its thread_id. Used to create a dedicated thread for roadmap execution notifications.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Topic title displayed as the thread name in Telegram',
        },
      },
      required: ['title'],
    },
  },
];

// ─── IPC helper ──────────────────────────────────────────────────────────────

/**
 * Forward a tool call to the daemon via IPC, with per-method timeout.
 * Returns the daemon's result or throws on error.
 */
async function proxyTool(
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  if (!ipcClient || !ipcClient.isConnected()) {
    throw new Error('IPC client is not connected — daemon may have crashed');
  }

  // Compute method-specific timeout
  const timeoutMs = IPCClient.methodTimeout(
    method as Parameters<typeof IPCClient.methodTimeout>[0],
    params
  );

  return ipcClient.request(
    method as Parameters<typeof IPCClient.methodTimeout>[0],
    params,
    timeoutMs
  );
}

// ─── Shutdown ────────────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Shutdown signal received — cleaning up adapter');

  try {
    if (ipcClient && ipcClient.isConnected() && sessionId) {
      await ipcClient.request('unregister_session', { sessionId });
      log.info({ sessionId }, 'Session unregistered');
    }
  } catch (err) {
    log.warn({ err }, 'Error unregistering session during shutdown');
  }

  try {
    if (ipcClient) {
      await ipcClient.disconnect();
    }
  } catch (err) {
    log.warn({ err }, 'Error disconnecting IPC client during shutdown');
  }

  process.exit(0);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Compute socket path (project-scoped)
  const socketPath = getSocketPath();
  log.debug({ socketPath }, 'Using socket path');

  // 2. Ensure daemon is running (launch if needed)
  log.info('Ensuring daemon is running...');
  await ensureDaemon(socketPath);

  // 3. Connect to daemon via IPC
  ipcClient = new IPCClient(socketPath);
  await ipcClient.connect();

  // 4. Handle unexpected daemon disconnects with exponential backoff
  const MAX_RECONNECT_RETRIES = 10;
  const BASE_RECONNECT_DELAY_MS = 1000;
  const MAX_RECONNECT_DELAY_MS = 8000;

  const attemptReconnect = async (attempt: number): Promise<void> => {
    if (attempt > MAX_RECONNECT_RETRIES) {
      log.error({ maxRetries: MAX_RECONNECT_RETRIES }, 'Max reconnect attempts reached — giving up');
      process.exit(1);
      return;
    }

    const delay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt - 1), MAX_RECONNECT_DELAY_MS);
    log.info({ attempt, maxRetries: MAX_RECONNECT_RETRIES, delayMs: delay }, 'Scheduling reconnect attempt');

    await new Promise<void>(resolve => setTimeout(resolve, delay));

    try {
      const fresh = new IPCClient(socketPath);
      await fresh.connect();
      ipcClient = fresh;

      // Re-register session
      const result = (await ipcClient.request('register_session', {
        projectRoot: process.cwd(),
      })) as { sessionId: string; label: string };
      sessionId = result.sessionId;
      log.info({ sessionId, label: result.label, attempt }, 'Reconnected and re-registered session');

      // Re-attach disconnect handler so next disconnection starts a fresh backoff loop
      ipcClient.on('disconnected', () => {
        log.warn('Daemon disconnected — starting reconnect loop with exponential backoff');
        attemptReconnect(1).catch(() => process.exit(1));
      });
    } catch (err) {
      log.warn({ err, attempt }, 'Reconnect attempt failed — will retry');
      await attemptReconnect(attempt + 1);
    }
  };

  ipcClient.on('disconnected', () => {
    log.warn('Daemon disconnected unexpectedly — starting reconnect loop with exponential backoff');
    attemptReconnect(1).catch(() => process.exit(1));
  });

  // 5. Register session with daemon
  const registerResult = (await ipcClient.request('register_session', {
    projectRoot: process.cwd(),
  })) as { sessionId: string; label: string };

  sessionId = registerResult.sessionId;
  log.info({ sessionId, label: registerResult.label }, 'MCP adapter connected, session registered');

  // 6. Create MCP server with StdioServerTransport
  const server = new Server(
    {
      name: 'telegram-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 7. Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_DEFINITIONS };
  });

  // 8. Register tool call handler — each tool proxied to daemon via IPC
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args ?? {}) as Record<string, unknown>;

    try {
      let result: unknown;

      switch (name) {
        case 'ask_blocking_question':
          result = await proxyTool('ask_blocking_question', {
            sessionId,
            question: toolArgs['question'],
            context: toolArgs['context'],
            timeout_minutes: toolArgs['timeout_minutes'],
          });
          // Daemon returns { answer: string }; extract the answer text
          result = (result as { answer: string }).answer;
          break;

        case 'check_question_answers':
          result = await proxyTool('check_question_answers', {
            sessionId,
            question_ids: toolArgs['question_ids'],
            wait_seconds: toolArgs['wait_seconds'],
          });
          break;

        case 'mark_question_answered':
          result = await proxyTool('mark_question_answered', {
            sessionId,
            question_id: toolArgs['question_id'],
          });
          break;

        case 'send_message':
          result = await proxyTool('send_message', {
            sessionId,
            text: toolArgs['text'],
            threadId: toolArgs['thread_id'],
          });
          break;

        case 'send_status_update':
          result = await proxyTool('send_status_update', {
            sessionId,
            message: toolArgs['status_text'],
            status: 'status_update',
          });
          break;

        case 'update_session_status':
          result = await proxyTool('update_session_status', {
            sessionId,
            status: toolArgs['status'],
            questionTitle: toolArgs['question_title'],
          });
          break;

        case 'create_topic':
          result = await proxyTool('create_topic', {
            title: toolArgs['title'],
          });
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ tool: name, err: error }, 'Tool call error');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: errorMessage, tool: name }),
          },
        ],
        isError: true,
      };
    }
  });

  // 9. Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info(
    { sessionId, label: registerResult.label },
    `MCP adapter connected, session: ${registerResult.label}`
  );
}

// ─── Signal handlers ─────────────────────────────────────────────────────────

process.on('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)); });
process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });

// ─── Bootstrap ───────────────────────────────────────────────────────────────

main().catch((err) => {
  log.error({ err }, 'Adapter startup failed');
  process.exit(1);
});
