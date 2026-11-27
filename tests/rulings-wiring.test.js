'use strict';
// WP14: a redone ruling is not patched; open probes reach the planner and checker.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const exec = read('get-shit-done', 'workflows', 'execute-phase.md');
const researcher = read('agents', 'gsd-phase-researcher.md');
const template = read('get-shit-done', 'templates', 'research.md');

test('redo rule, lease bracket, fail-closed probe default and planner consumer', () => {
  assert.match(exec, /is redone, not patched/);
  assert.match(exec, /dispatch begin --phase \{N\} --role ruling/);
  assert.match(researcher, /an unsettled probe is treated as FALSE/);
  assert.match(template, /an unsettled probe is treated as FALSE/);
  assert.match(read('agents', 'gsd-planner.md'), /every `## Open Probes` row of RESEARCH\.md becomes a first-task probe/);
  assert.match(read('agents', 'gsd-plan-checker.md'), /`## Open Probes` row of the phase's RESEARCH\.md with no probe task/);
});
