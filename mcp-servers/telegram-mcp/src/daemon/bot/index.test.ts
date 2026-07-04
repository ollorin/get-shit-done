/**
 * Tests for daemon/bot/index.ts's withRetry() wiring on sendToGroup,
 * sendToThread, and createForumTopic.
 *
 * SAFETY: initializeBot() constructs a real (offline) Telegraf instance with
 * a fake token -- Telegraf does not make any network call at construction
 * time. Every test here monkey-patches the returned bot instance's
 * `.telegram.sendMessage` / `.telegram.createForumTopic` methods to fake,
 * in-memory functions BEFORE calling sendToGroup/sendToThread/createForumTopic
 * -- no test in this file makes a real network call or talks to the real
 * Telegram Bot API.
 *
 * To keep tests fast (withRetry()'s default backoff is 500ms/1500ms/4000ms
 * real wall-clock delay), the global `setTimeout` is mocked for the duration
 * of this file so every retry delay resolves on the next microtask instead of
 * waiting in real time.
 */

import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { initializeBot, getBot, sendToGroup, sendToThread, createForumTopic } from './index.js';

let setTimeoutMock: ReturnType<typeof mock.method>;

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'fake-test-token:ABCDEF';
  process.env.TELEGRAM_GROUP_CHAT_ID = '-100123456789';

  // Make every setTimeout-based delay (withRetry's default real sleepFn)
  // resolve on the next microtask instead of waiting real wall-clock time.
  setTimeoutMock = mock.method(globalThis, 'setTimeout', ((fn: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) => {
    fn(...args);
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);

  initializeBot();
});

afterEach(() => {
  setTimeoutMock.mock.restore();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_GROUP_CHAT_ID;
});

describe('sendToGroup() retry wiring', () => {
  test('resolves after exactly 3 calls to the patched sendMessage (fails twice, succeeds third) -- proves withRetry is actually wired in', async () => {
    const bot = getBot()!;
    let callCount = 0;
    const sendMessageMock = mock.method(bot.telegram, 'sendMessage', async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error(`transient network error ${callCount}`);
      }
      return {} as any;
    });

    await sendToGroup('test');

    assert.equal(callCount, 3);
    assert.equal(sendMessageMock.mock.callCount(), 3);
  });

  test('a send that fails on ALL retry attempts rethrows the original error, never silently swallowed', async () => {
    const bot = getBot()!;
    const originalError = new Error('permanent network failure');
    const sendMessageMock = mock.method(bot.telegram, 'sendMessage', async () => {
      throw originalError;
    });

    await assert.rejects(() => sendToGroup('test'), originalError);

    // Default: 4 total attempts (1 initial + 3 retries)
    assert.equal(sendMessageMock.mock.callCount(), 4);
  });
});

describe('sendToThread() retry wiring', () => {
  test('resolves after exactly 3 calls to the patched sendMessage (fails twice, succeeds third)', async () => {
    const bot = getBot()!;
    let callCount = 0;
    const sendMessageMock = mock.method(bot.telegram, 'sendMessage', async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error(`transient network error ${callCount}`);
      }
      return {} as any;
    });

    await sendToThread(42, 'test thread message');

    assert.equal(callCount, 3);
    assert.equal(sendMessageMock.mock.callCount(), 3);
  });

  test('a send that fails on ALL retry attempts rethrows the original error', async () => {
    const bot = getBot()!;
    const originalError = new Error('permanent thread send failure');
    const sendMessageMock = mock.method(bot.telegram, 'sendMessage', async () => {
      throw originalError;
    });

    await assert.rejects(() => sendToThread(42, 'test'), originalError);
    assert.equal(sendMessageMock.mock.callCount(), 4);
  });
});

describe('createForumTopic() retry wiring', () => {
  test('resolves after exactly 3 calls to the patched createForumTopic and eventually returns 42', async () => {
    const bot = getBot()!;
    let callCount = 0;
    const createForumTopicMock = mock.method(bot.telegram, 'createForumTopic', async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error(`transient forum-topic error ${callCount}`);
      }
      return { message_thread_id: 42 } as any;
    });

    const threadId = await createForumTopic('title');

    assert.equal(threadId, 42);
    assert.equal(callCount, 3);
    assert.equal(createForumTopicMock.mock.callCount(), 3);
  });

  test('a createForumTopic call that fails on ALL retry attempts rethrows the original error', async () => {
    const bot = getBot()!;
    const originalError = new Error('permanent forum-topic failure');
    const createForumTopicMock = mock.method(bot.telegram, 'createForumTopic', async () => {
      throw originalError;
    });

    await assert.rejects(() => createForumTopic('title'), originalError);
    assert.equal(createForumTopicMock.mock.callCount(), 4);
  });
});
