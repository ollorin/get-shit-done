'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeProject, gsd, git, phaseDir, events } = require('./helpers/roadmap-fixture.js');
const formCheck = require('../get-shit-done/bin/form-check.js');
const budget = require('../get-shit-done/bin/phase-budget.js');
const dispatch = require('../get-shit-done/bin/roadmap-dispatch.js');

const dirs = [];
const project = (cfg = {}) => { const d = makeProject([{ n: '1', name: 'one' }], cfg); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const FM = '---\nphase: 01\nplan: "01"\nplan_stamp: abc\nfiles_modified: [src/a.js]\n---\n# Plan\n';
const plan = (tasks) => `${FM}<tasks>\n${tasks}\n</tasks>\n`;
const tierErrors = (dir, files) => formCheck.checkPlans(dir, files, 'standard').filter((e) => e.check === 'task_tier_missing');

describe('R7-1: a task tier tag is mandatory in a plan that has not run', () => {
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-r7-')); dirs.push(d); return d; };
  test('one error per plan names every untagged task; element and attribute syntax, any case, pass', () => {
    const d = tmp();
    write(d, '01-01-PLAN.md', plan([
      '<task type="auto"><name>Task 1: tagged element</name><model>Sonnet</model></task>',
      '<task type="auto" tier="HAIKU"><name>Task 2: tagged attribute</name></task>',
      '<task type="auto"><name>Task 3: nothing</name></task>',
      '<task type="auto"><name>Task 4: bad value</name><model>gpt</model></task>',
    ].join('\n')));
    const errs = tierErrors(d, ['01-01-PLAN.md']);
    assert.strictEqual(errs.length, 1);
    assert.strictEqual(errs[0].file, '01-01-PLAN.md');
    assert.match(errs[0].message, /Task 3: nothing/);
    assert.match(errs[0].message, /Task 4: bad value/);
    assert.doesNotMatch(errs[0].message, /Task 1|Task 2/);
  });
  test('a fully tagged plan and a plan with a SUMMARY report nothing', () => {
    const d = tmp();
    write(d, '01-01-PLAN.md', plan('<task type="auto"><name>a</name><model>sonnet</model></task>'));
    write(d, '01-02-PLAN.md', plan('<task type="auto"><name>b</name></task>'));
    write(d, '01-02-SUMMARY.md', '# S\n');
    assert.deepStrictEqual(tierErrors(d, ['01-01-PLAN.md', '01-02-PLAN.md', '01-02-SUMMARY.md']), []);
  });
  test('verify form --plans-only fails on it', () => {
    const dir = project();
    const pd = phaseDir(dir, 1);
    write(pd, '01-01-PLAN.md', plan('<task type="auto"><name>Task 1: x</name></task>'));
    const r = gsd(dir, ['verify', 'form', '1', '--plans-only']);
    assert.strictEqual(r.rc, 1);
    assert.ok(r.json.errors.some((e) => e.check === 'task_tier_missing'));
  });
});

describe('R7-2: spike runs one executor per plan on its highest tag (floor sonnet); standard has none', () => {
  const spike = (tasks) => {
    const dir = project();
    const rm = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(rm, fs.readFileSync(rm, 'utf8').replace('**Depends on:** None', '**Rigour**: spike (OG2)\n**Spike roots**: spike/\n**Depends on:** None'));
    write(dir, '.planning/OWNER-GATES.json', JSON.stringify({ version: 1, gates: [{ id: 'roadmap@current', kind: 'roadmap', milestone: null, status: 'approved', rigour: { spike_phases: ['1'], spike_roots: ['spike/'] } }] }));
    write(phaseDir(dir, 1), '01-01-PLAN.md', plan(tasks));
    return dir;
  };
  const model = (dir) => gsd(dir, ['phase-plan-index', '1']).json.plans[0].executor_model;
  const t = (tag) => `<task type="auto"><name>n</name><model>${tag}</model></task>`;
  test('haiku-only is raised to the sonnet floor; the highest tag wins', () => {
    assert.strictEqual(model(spike(t('haiku') + t('haiku'))), 'sonnet');
    assert.strictEqual(model(spike(t('haiku') + t('sonnet'))), 'sonnet');
    assert.strictEqual(model(spike(t('haiku') + '<task type="auto" tier="Sonnet"><name>n</name></task>')), 'sonnet');
  });
  test('standard rigour: null (per-task routing)', () => {
    const dir = project();
    write(phaseDir(dir, 1), '01-01-PLAN.md', plan(t('sonnet')));
    assert.strictEqual(model(dir), null);
  });
});

describe('R7-3: wall budgets', () => {
  test('defaults: 45 / 90 / 150 wall minutes', () => {
    const dir = project();
    assert.deepStrictEqual(budget.budgetFields(dir, 'spike'), { budget_class: 'spike', budget_wall_minutes: 45 });
    assert.deepStrictEqual(budget.budgetFields(dir, 'standard'), { budget_class: 'standard', budget_wall_minutes: 90 });
    assert.deepStrictEqual(budget.budgetFields(dir, 'risk'), { budget_class: 'risk', budget_wall_minutes: 150 });
  });
});

describe('R7-4: per-task routing is the standard path', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  test('execute-phase and task-routing no longer gate routing on the auto profile', () => {
    assert.doesNotMatch(read('get-shit-done/workflows/execute-phase.md'), /is `auto` and/);
    assert.doesNotMatch(read('get-shit-done/references/task-routing.md'), /model_profile auto|quota status|task_dispatch/);
  });
});

describe('R7-5: `roadmap next --retry-parked` on a parked phase with a CHECKPOINT is always resumed', () => {
  test('unit: a retried parked phase resumes only when it has a checkpoint', () => {
    const phases = [{ number: '1', name: 'one', depends_on: 'None' }];
    const run = (hasCheckpoint) => dispatch.next({ phases, events: [{ type: 'phase_parked', phase: '1' }], truth: () => false, retryParked: true, hasCheckpoint, config: {} });
    assert.strictEqual(run(() => true).resumed, true);
    assert.strictEqual(run(() => false).resumed, false);
  });
  test('CLI: the same state answers resumed true on the first and the second call', () => {
    const dir = project();
    write(phaseDir(dir, 1), 'CHECKPOINT.json', JSON.stringify({ phase: '1', last_step: 'execute' }));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'cp');
    write(dir, '.planning/EXECUTION_LOG.md', `${JSON.stringify({ type: 'phase_parked', phase: '1', timestamp: new Date().toISOString() })}\n`);
    const a = gsd(dir, ['roadmap', 'next', '--retry-parked']).json;
    const b = gsd(dir, ['roadmap', 'next', '--retry-parked']).json;
    assert.deepStrictEqual([a.phase, a.resumed, b.phase, b.resumed], ['1', true, '1', true], JSON.stringify([a, b, events(dir)]));
  });
});
