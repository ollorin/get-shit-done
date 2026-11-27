'use strict';
// WP14: a ruling runs in the background and never idles the lane; researcher lists open probes.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const exec = read('get-shit-done', 'workflows', 'execute-phase.md');
const rigour = read('get-shit-done', 'references', 'rigour.md');
const coord = read('agents', 'gsd-phase-coordinator.md');
const researcher = read('agents', 'gsd-phase-researcher.md');
const template = read('get-shit-done', 'templates', 'research.md');

test('execute-phase.md: only the dependent task waits for a ruling', () => {
  assert.match(exec, /\*\*Rulings do not idle the lane\.\*\*/);
  assert.match(exec, /in the background and marks only the task \(and every task or plan that depends on it/);
  assert.match(exec, /Every other task, plan, gate and review step keeps running while the ruling runs/);
});

test('rigour.md and the coordinator agent restate it', () => {
  assert.match(rigour, /A ruling never idles the lane: spawn it in the background/);
  assert.match(coord, /A ruling runs in the background and never idles the lane/);
});

test('no serial wording: nothing waits idle on a ruling', () => {
  for (const doc of [exec, rigour, coord]) {
    assert.doesNotMatch(doc, /wait(s|ing)? (idle )?for the ruling|block(s|ed)? (the lane )?(until|on) the ruling|pause(s)? (the )?(phase|lane) (until|for) the ruling/i);
    assert.doesNotMatch(doc, /(stops?|idles?|halts?|waits?)[^.]{0,30}(until|for) the ruling/i);
  }
});

test('redo rule, lease bracket, fail-closed probe default and planner consumer', () => {
  assert.match(exec, /is redone, not patched/);
  assert.match(exec, /dispatch begin --phase \{N\} --role ruling/);
  assert.match(researcher, /an unsettled probe is treated as FALSE/);
  assert.match(template, /an unsettled probe is treated as FALSE/);
  assert.match(read('agents', 'gsd-planner.md'), /every `## Open Probes` row of RESEARCH\.md becomes a first-task probe/);
  assert.match(read('agents', 'gsd-plan-checker.md'), /`## Open Probes` row of the phase's RESEARCH\.md with no probe task/);
});

test('researcher agent and template carry an Open Probes section', () => {
  assert.match(researcher, /## Open Probes/);
  assert.match(researcher, /the exact probe \(command or file read\) that settles it/);
  assert.match(template, /<open_probes>[\s\S]*## Open Probes[\s\S]*Probe:/);
});
