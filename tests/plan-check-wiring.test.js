'use strict';
// WP3 probe: plan-phase.md does not restate the per-plan checker rule.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'get-shit-done', 'workflows', 'plan-phase.md'), 'utf8');

test('plan-phase.md no longer states the per-plan checker rule', () => {
  assert.doesNotMatch(doc, /PER PLAN/);
  assert.doesNotMatch(doc, /one checker per plan id/);
  assert.doesNotMatch(doc, /one adversarial `ruling_model` dispatch per plan/);
});
