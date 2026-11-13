'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeProject, gsd, git, phaseDir, events } = require('./helpers/roadmap-fixture.js');

const dirs = [];
const project = (phases = [{ n: '1', name: 'one' }], config = {}) => { const d = makeProject(phases, config); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

describe('N10 commit --files is path-limited', () => {
  test('an unrelated staged file stays staged and uncommitted', () => {
    const dir = project();
    write(dir, 'other.txt', 'x');
    git(dir, 'add', 'other.txt');
    write(dir, '.planning/a.md', 'a');
    const r = gsd(dir, ['commit', 'scoped', '--files', '.planning/a.md']);
    assert.strictEqual(r.rc, 0);
    const files = git(dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n');
    assert.deepStrictEqual(files, ['.planning/a.md']);
    assert.strictEqual(git(dir, 'diff', '--cached', '--name-only').trim(), 'other.txt');
  });
});

describe('N5 risk_addons: one init boolean for the risk-domain add-ons', () => {
  const setRisk = (dir, line) => {
    const f = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\*\*Risk domains:\*\*[^\n]*/, line));
  };
  const plan = (dir, extra = '') => write(dir, '.planning/phases/01-one/01-01-PLAN.md', `---\nphase: 01-one\nplan: 01\nfiles_modified: [docs/a.md]\n${extra}---\n# p\n`);
  test('a phase declaring risk domains reports true although no plan is flagged high_risk', () => {
    const dir = project();
    setRisk(dir, '**Risk domains:** auth');
    plan(dir);
    for (const cmd of ['plan-phase', 'execute-phase']) assert.strictEqual(gsd(dir, ['init', cmd, '1']).json.risk_addons, true, cmd);
  });
  test('none and no flagged plan is false; an explicit high_risk plan is true', () => {
    const dir = project();
    plan(dir);
    for (const cmd of ['plan-phase', 'execute-phase']) assert.strictEqual(gsd(dir, ['init', cmd, '1']).json.risk_addons, false, cmd);
    plan(dir, 'high_risk: true\n');
    for (const cmd of ['plan-phase', 'execute-phase']) assert.strictEqual(gsd(dir, ['init', cmd, '1']).json.risk_addons, true, cmd);
  });
  test('prose keys the add-ons on risk_addons, never on high_risk alone', () => {
    const root = path.join(__dirname, '..');
    const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(rd('get-shit-done/workflows/execute-phase.md'), /`risk_addons`/);
    assert.ok(!/plans with `high_risk: true` loop/.test(rd('get-shit-done/workflows/execute-phase.md')));
    assert.match(rd('agents/gsd-verifier.md'), /`risk_addons`/);
    assert.ok(!/Risk-domain plans \(`high_risk: true`\)/.test(rd('agents/gsd-verifier.md')));
    assert.match(rd('get-shit-done/workflows/plan-phase.md'), /`risk_addons`/);
    assert.match(rd('get-shit-done/references/rigour.md'), /`risk_addons`/);
  });
});

describe('N7 prose: blockers that survive the plan-check cap on a risk_addons phase go to one top-model ruling', () => {
  test('plan-phase cap path and rigour table name the ruling; non-risk keeps the OVERRIDE path', () => {
    const root = path.join(__dirname, '..');
    const pp = fs.readFileSync(path.join(root, 'get-shit-done/workflows/plan-phase.md'), 'utf8');
    assert.match(pp, /`risk_addons` is true it goes[^\n]*ONE ruling on `\{ruling_model\}` before execution[^\n]*an OVERRIDE line alone never closes it/);
    assert.match(pp, /Otherwise it goes to the owner \(interactive\) or into the OVERRIDE line/);
    assert.match(fs.readFileSync(path.join(root, 'get-shit-done/references/rigour.md'), 'utf8'), /survives goes to ONE ruling on `ruling_model` before execution/);
  });
});
