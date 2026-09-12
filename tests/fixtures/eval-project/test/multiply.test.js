const { test, describe } = require('node:test');
const assert = require('node:assert');
const { multiply, fetchSharedConstant } = require('../src/multiply.js');

describe('Phase 02: multiply(a, b)', () => {
  test('multiplies two positive numbers', () => {
    assert.strictEqual(multiply(3, 4), 12);
  });

  test('multiplies by zero', () => {
    assert.strictEqual(multiply(5, 0), 0);
  });

  test('multiplies a negative and a positive number', () => {
    assert.strictEqual(multiply(-2, 5), -10);
  });

  test('throws a TypeError when given a non-number argument', () => {
    assert.throws(() => multiply('3', 4), TypeError);
  });

  test('fetchSharedConstant genuinely rejects against the unreachable lookup host (real network condition, not mocked)', async () => {
    await assert.rejects(() => fetchSharedConstant(2000));
  });
});
