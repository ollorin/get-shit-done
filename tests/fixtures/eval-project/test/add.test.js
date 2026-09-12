const { test, describe } = require('node:test');
const assert = require('node:assert');
const { add } = require('../src/add.js');

describe('Phase 01: add(a, b)', () => {
  test('adds two positive numbers', () => {
    assert.strictEqual(add(2, 3), 5);
  });

  test('adds a negative and a positive number', () => {
    assert.strictEqual(add(-2, 5), 3);
  });

  test('adds two negative numbers', () => {
    assert.strictEqual(add(-2, -3), -5);
  });

  test('throws a TypeError when given a non-number argument', () => {
    assert.throws(() => add('2', 3), TypeError);
  });
});
