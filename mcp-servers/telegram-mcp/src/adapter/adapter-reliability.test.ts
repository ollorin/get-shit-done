/**
 * Tests for:
 *   - reconnect-policy.ts's pure give-up/backoff decision functions
 *   - DaemonUnavailableError's shape
 *   - Single-timer ownership between the daemon's ask() timeout and the
 *     adapter's IPC backstop, proven with a real IPCServer/IPCClient pair
 *     bound to a randomized temp/fake socket path (NEVER the production
 *     default path).
 *
 * Reference (not duplicated here): question-service.test.ts already proves
 * restored/orphaned questions never re-enter a state expecting a second
 * answer -- that is a QuestionService/restoreState() concern, not an
 * IPC-transport concern, so it is not re-tested in this file.
 */

import { describe, test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

import { shouldGiveUpReconnecting, computeReconnectDelayMs } from './reconnect-policy.js';
import { DaemonUnavailableError } from '../shared/errors.js';
import { IPCClient } from './ipc-client.js';
import { IPCServer, type MethodHandler } from '../daemon/ipc-server.js';
import type { IPCMethod } from '../shared/types.js';

// ─── reconnect-policy: pure decision functions ────────────────────────────────

describe('shouldGiveUpReconnecting()', () => {
  test('returns false for attempt <= maxRetries', () => {
    assert.equal(shouldGiveUpReconnecting(1, 10), false);
    assert.equal(shouldGiveUpReconnecting(5, 10), false);
  });

  test('boundary: exactly maxRetries is still false (not yet given up)', () => {
    assert.equal(shouldGiveUpReconnecting(10, 10), false);
  });

  test('boundary: maxRetries + 1 is true (give up)', () => {
    assert.equal(shouldGiveUpReconnecting(11, 10), true);
  });

  test('returns true for attempt > maxRetries generally', () => {
    assert.equal(shouldGiveUpReconnecting(15, 10), true);
  });
});

describe('computeReconnectDelayMs()', () => {
  test('first attempt returns the base delay', () => {
    assert.equal(computeReconnectDelayMs(1, 1000, 8000), 1000);
  });

  test('exponential growth for early attempts', () => {
    assert.equal(computeReconnectDelayMs(2, 1000, 8000), 2000);
    assert.equal(computeReconnectDelayMs(3, 1000, 8000), 4000);
  });

  test('clamps at max for large attempts', () => {
    assert.equal(computeReconnectDelayMs(10, 1000, 8000), 8000);
  });
});

// ─── DaemonUnavailableError shape ──────────────────────────────────────────────

describe('DaemonUnavailableError', () => {
  test('is an instanceof Error with a stable code and name', () => {
    const err = new DaemonUnavailableError('daemon is down');
    assert.ok(err instanceof Error);
    assert.equal(err.code, 'DAEMON_UNAVAILABLE');
    assert.equal(err.name, 'DaemonUnavailableError');
    assert.equal(err.message, 'daemon is down');
  });
});

// ─── Single-timer ownership: real IPCServer/IPCClient pair ────────────────────
//
// Uses a randomized /tmp path per test -- NEVER the production socket path
// (getSocketPath() with no args). No bot/Telegraf instance is involved at all;
// this exercises pure IPC transport reliability.

interface TestServerHandle {
  server: IPCServer;
  socketPath: string;
  cleanup: () => void;
}

async function startTestServer(handlers: Map<IPCMethod, MethodHandler>): Promise<TestServerHandle> {
  const socketPath = `/tmp/telegram-mcp-test-${randomUUID()}.sock`;
  const server = new IPCServer(socketPath, handlers);
  await server.listen();
  return {
    server,
    socketPath,
    cleanup: () => {
      try {
        server.close();
      } catch {
        // already closed by the test itself (simulated crash) -- ignore
      }
    },
  };
}

const activeClients: IPCClient[] = [];
const activeCleanups: Array<() => void> = [];

afterEach(async () => {
  for (const client of activeClients.splice(0)) {
    // IPCClient.disconnect() waits for a 'close' event that will never fire
    // again if the socket was already destroyed (e.g. by a crash-simulation
    // test) -- calling it unconditionally would hang forever. Only disconnect
    // clients that are still actually connected.
    if (client.isConnected()) {
      await client.disconnect().catch(() => {});
    }
  }
  for (const cleanup of activeCleanups.splice(0)) {
    cleanup();
  }
});

describe('IPC transport reliability: single-timer ownership', () => {
  test('daemon crash (server-side socket close) rejects a pending request with DaemonUnavailableError well under 1 second, proving the socket-close path -- not the backstop timer -- resolves it', async () => {
    // Handler that never resolves on its own -- simulates a daemon that goes
    // silent / crashes before ever responding. Its resolve function is kept
    // (via an object property, not a bare closured `let`, to sidestep a
    // TS control-flow-narrowing quirk with nested-closure reassignment) so
    // the test can settle it cleanly during cleanup (never leave a genuinely
    // dangling/unsettled promise behind for the test runner to flag).
    const handlerState: { release: (() => void) | null } = { release: null };
    const handlers = new Map<IPCMethod, MethodHandler>([
      [
        'register_session',
        (() =>
          new Promise<unknown>((resolve) => {
            handlerState.release = () => resolve({});
          })) as MethodHandler,
      ],
    ]);

    const { server, socketPath, cleanup } = await startTestServer(handlers);
    activeCleanups.push(cleanup);

    const client = new IPCClient(socketPath);
    activeClients.push(client);
    await client.connect();

    try {
      const start = Date.now();
      // Long client-side timeout (30s) -- if this test's rejection took anywhere
      // close to that, it would prove the backstop timer fired instead of the
      // socket-close path. It must resolve in well under 1 second.
      const requestPromise = client.request('register_session', {}, 30_000);

      // Give the request a brief moment to actually reach the server before
      // simulating the crash.
      await new Promise((resolve) => setImmediate(resolve));

      // Simulate a daemon crash: the server destroys the connection.
      server.close();

      await assert.rejects(requestPromise, (err: unknown) => {
        assert.ok(err instanceof DaemonUnavailableError, `expected DaemonUnavailableError, got ${String(err)}`);
        return true;
      });

      const elapsed = Date.now() - start;
      assert.ok(elapsed < 1000, `expected fast fail-fast rejection, took ${elapsed}ms`);
    } finally {
      // Settle the still-in-flight server-side handler promise so nothing
      // dangles past the end of this test.
      handlerState.release?.();
      // IPCServer.handleLine() awaits this handler via a fire-and-forget
      // `void this.handleLine(...)` call -- give its continuation (the
      // now-resolving await chain, including the socket.destroyed check in
      // sendResponse()) a moment to fully drain before this test returns, so
      // the test runner never observes it as still-pending.
      await new Promise((resolve) => setImmediate(resolve));
    }
  });

  test('daemon responds normally before the backstop timer -- resolves via handleLine(), timer is cleared, no late rejection fires afterward', async () => {
    const handlers = new Map<IPCMethod, MethodHandler>([
      ['register_session', (async () => ({ sessionId: 'fake-session', label: 'test/1' })) as MethodHandler],
    ]);

    const { socketPath, cleanup } = await startTestServer(handlers);
    activeCleanups.push(cleanup);

    const client = new IPCClient(socketPath);
    activeClients.push(client);
    await client.connect();

    const clearTimeoutSpy = mock.method(globalThis, 'clearTimeout');
    try {
      // Short client-side timeout -- the real daemon handler resolves almost
      // immediately, well before this would ever fire as a backstop.
      const result = await client.request('register_session', {}, 5000);
      assert.deepEqual(result, { sessionId: 'fake-session', label: 'test/1' });

      // The normal handleLine() resolve path must have cleared the pending
      // request's timer.
      assert.ok(clearTimeoutSpy.mock.callCount() >= 1, 'expected clearTimeout to have been called on normal resolve');

      // Confirm no late rejection / unhandled rejection fires in a short
      // window after resolution (proves the timer is not left dangling).
      let unhandledFired = false;
      const onUnhandledRejection = (): void => {
        unhandledFired = true;
      };
      process.on('unhandledRejection', onUnhandledRejection);
      try {
        await new Promise((resolve) => setTimeout(resolve, 150));
      } finally {
        process.off('unhandledRejection', onUnhandledRejection);
      }
      assert.equal(unhandledFired, false);
    } finally {
      clearTimeoutSpy.mock.restore();
    }
  });
});
