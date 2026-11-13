'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const doc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('R14: planner binds rules to tasks with instance and positive control; checker verifies', () => {
  const planner = doc('agents/gsd-planner.md');
  const checker = doc('agents/gsd-plan-checker.md');
  assert.match(planner, /Rules applied:/);
  assert.match(planner, /positive control/);
  assert.match(checker, /Dimension 17: Rule Binding and Test Proof/);
  assert.match(checker, /positive control/);
  assert.match(checker, /14 and 17 are skipped/);
});
