'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeProject, gsd } = require('./helpers/roadmap-fixture.js');
const tools = require('../get-shit-done/bin/gsd-tools.js');

const root = path.join(__dirname, '..');
const doc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const dirs = [];
const project = (cfg = {}) => { const d = makeProject([{ n: '1', name: 'one' }], cfg); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const cap = { capability_related: true, matched_pattern: null };

describe('R12-1: one top-model debugger rescue after a sonnet task fails twice', () => {
  test('decideEscalation: exhausted sonnet returns the rescue on the top alias', () => {
    const r = tools.decideEscalation('sonnet', cap, 1, 'zeta');
    assert.strictEqual(r.escalate, false);
    assert.strictEqual(r.rescue, true);
    assert.strictEqual(r.to, 'zeta');
  });
  test('no rescue for haiku escalation, non-capability failure, or opus', () => {
    assert.notStrictEqual(tools.decideEscalation('haiku', cap, 0, 'zeta').rescue, true);
    assert.notStrictEqual(tools.decideEscalation('sonnet', { capability_related: false }, 1, 'zeta').rescue, true);
    assert.notStrictEqual(tools.decideEscalation('opus', cap, 0, 'zeta').rescue, true);
  });
  test('CLI resolves the alias through models.top', () => {
    const dir = project({ models: { top: 'zeta' } });
    const r = gsd(dir, ['routing', 'escalation-decision', '--current-tier', 'sonnet', '--error-summary', 'logic wrong', '--escalations-used', '1', '--raw']);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    const j = JSON.parse(r.out);
    assert.strictEqual(j.rescue, true);
    assert.strictEqual(j.to, 'zeta');
    assert.strictEqual(j.escalate, false);
  });
  test('prose names the rung in routing, execute-phase and models; tags stay haiku|sonnet', () => {
    assert.match(doc('get-shit-done/references/task-routing.md'), /rescue/);
    assert.match(doc('get-shit-done/workflows/execute-phase.md'), /rescue/);
    assert.match(doc('get-shit-done/references/models.md'), /rescue/);
    assert.doesNotMatch(doc('get-shit-done/references/models.md'), /never to an opus executor/);
  });
});
