'use strict';
// WP3: adversarial plan-check is 3 lens checkers per phase, 2 in flight, delta round only on BLOCKER.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const doc = fs.readFileSync(path.join(__dirname, '..', 'get-shit-done', 'workflows', 'plan-phase.md'), 'utf8');

test('plan-phase.md: three lens checkers per phase, at most 2 in flight, delta only on BLOCKER', () => {
  assert.match(doc, /three adversarial `ruling_model` checkers per phase, one per lens, at most 2 in flight/);
  assert.match(doc, /at most 2 in flight at a time \(the first two together, the third when one returns\)/);
  assert.match(doc, /A delta round follows only when a lens returned a BLOCKER: ONE `checker_model` checker/);
  for (const lens of ['`goal`', '`risk`', '`overlap`']) assert.ok(doc.includes(lens), lens);
});

test('plan-phase.md no longer states the per-plan checker rule', () => {
  assert.doesNotMatch(doc, /PER PLAN/);
  assert.doesNotMatch(doc, /one checker per plan id/);
  assert.doesNotMatch(doc, /one adversarial `ruling_model` dispatch per plan/);
});
