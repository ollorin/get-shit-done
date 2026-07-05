/**
 * Tests for withRetry()'s pure bounded-backoff behavior.
 *
 * All tests use an injected `sleepFn` that resolves instantly (and records
 * its arguments) -- no test in this file waits on real wall-clock delays.
 */

import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from './retry.js';

/** Build an injected sleepFn that resolves instantly and records call args. */
function makeFakeSleep() {
  const calls: number[] = [];
  const sleepFn = async (ms: number): Promise<void> => {
    calls.push(ms);
  };
  return { sleepFn, calls };
}

describe('withRetry()', () => {
  test('fn succeeds on the first try -> resolves immediately, fn called exactly once, no retries', async () => {
    const fn = mock.fn(async () => 'ok');
    const { sleepFn, calls } = makeFakeSleep();

    const result = await withRetry(fn, { sleepFn });

    assert.equal(result, 'ok');
    assert.equal(fn.mock.callCount(), 1);
    assert.equal(calls.length, 0);
  });

  test('fn fails twice then succeeds (default options) -> resolves with the eventual value, fn called 3 times, sleepFn called 2 times with default delays', async () => {
    let callCount = 0;
    const fn = mock.fn(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error(`transient failure ${callCount}`);
      }
      return 'eventual-success';
    });
    const { sleepFn, calls } = makeFakeSleep();

    const result = await withRetry(fn, { sleepFn, label: 'test-op' });

    assert.equal(result, 'eventual-success');
    assert.equal(fn.mock.callCount(), 3);
    assert.deepEqual(calls, [500, 1500]);
  });

  test('fn fails all attempts (default: 4 total) -> rejects with the original error, fn called 4 times, sleepFn called 3 times', async () => {
    const originalError = new Error('permanent failure');
    const fn = mock.fn(async () => {
      throw originalError;
    });
    const { sleepFn, calls } = makeFakeSleep();

    await assert.rejects(() => withRetry(fn, { sleepFn, label: 'test-op' }), originalError);

    assert.equal(fn.mock.callCount(), 4);
    assert.deepEqual(calls, [500, 1500, 4000]);
  });

  test('custom attempts/delaysMs overrides are respected (attempts: 2, delaysMs: [10] -> exactly 1 retry)', async () => {
    const originalError = new Error('custom-config failure');
    const fn = mock.fn(async () => {
      throw originalError;
    });
    const { sleepFn, calls } = makeFakeSleep();

    await assert.rejects(
      () => withRetry(fn, { sleepFn, attempts: 2, delaysMs: [10] }),
      originalError
    );

    assert.equal(fn.mock.callCount(), 2);
    assert.deepEqual(calls, [10]);
  });

  test('custom attempts/delaysMs: fn succeeds within the custom attempt budget', async () => {
    let callCount = 0;
    const fn = mock.fn(async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error('one transient failure');
      }
      return 'ok-within-budget';
    });
    const { sleepFn, calls } = makeFakeSleep();

    const result = await withRetry(fn, { sleepFn, attempts: 3, delaysMs: [5, 10] });

    assert.equal(result, 'ok-within-budget');
    assert.equal(fn.mock.callCount(), 2);
    assert.deepEqual(calls, [5]);
  });
});
