'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeProject, gsd, writeEvidence, completePhaseLikeWorkflow } = require('./helpers/roadmap-fixture.js');
const rigour = require('../get-shit-done/bin/rigour.js');

const dirs = [];
const ROAD = [
  { n: '406', name: 'base' },
  { n: '406a', name: 'arena money', deps: 'Phase 406' },
  { n: '407', name: 'after letter', deps: 'Phase 406a' },
  { n: '416a', name: 'sweep' },
  { n: '416a.1', name: 'inserted', deps: 'Phase 416a' },
  { n: '416b', name: 'next sweep', deps: 'Phase 416a.1' },
];
const project = () => { const d = makeProject(ROAD, {}); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('lettered phase ids (406a, 416a.1)', () => {
  test('roadmap status lists every lettered id in ROADMAP order', () => {
    const r = gsd(project(), ['roadmap', 'status']).json;
    assert.deepStrictEqual(r.phases.map((p) => String(p.number)), ['406', '406a', '407', '416a', '416a.1', '416b']);
  });
  test('roadmap next returns the lettered phase in dependency order; its dependent stays blocked', () => {
    const dir = project();
    writeEvidence(dir, 406);
    assert.strictEqual(completePhaseLikeWorkflow(dir, 406).rc, 0);
    assert.strictEqual(gsd(dir, ['roadmap', 'next']).json.phase, '406a');
  });
  test('the directory resolver finds a lettered phase directory and not its integer sibling', () => {
    const dir = project();
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '406a-arena-money'));
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '406-base'));
    const r = gsd(dir, ['init', 'plan-phase', '406a']).json;
    assert.match(r.phase_dir || r.directory || '', /406a-arena-money$/);
    assert.strictEqual(gsd(dir, ['phase', 'checkpoint', '406a', '--step', 'discuss', '--status', 'skipped']).rc, 0);
  });
  test('phase directories sort 406 < 406a < 406b < 407 and 416a < 416a.1 < 416b', () => {
    const dir = project();
    for (const d of ['407-x', '416b-x', '416a.1-x', '406b-x', '406a-x', '416a-x', '406-x']) fs.mkdirSync(path.join(dir, '.planning', 'phases', d));
    assert.deepStrictEqual(gsd(dir, ['phases', 'list']).out.trim().split('\n'), ['406-x', '406a-x', '406b-x', '407-x', '416a-x', '416a.1-x', '416b-x']);
  });
  test('Risk domains of a lettered section are parsed from its own section', () => {
    const dir = project();
    fs.appendFileSync(path.join(dir, '.planning', 'ROADMAP.md'), '\n### Phase 418a: audit\n**Goal:** g\n**Depends on:** None\n**Risk domains:** money, games\n');
    assert.deepStrictEqual(rigour.phaseRiskDomains(dir, '418a', ['money', 'games', 'wallet']).domains, ['money', 'games']);
  });
});
