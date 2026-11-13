'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeProject, gsd } = require('./helpers/roadmap-fixture.js');

const root = path.join(__dirname, '..');
const doc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const dirs = [];
const project = (cfg = {}) => { const d = makeProject([{ n: '1', name: 'one' }], cfg); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

// Backticked snake_case names on the lines where a workflow lists the init fields it reads.
const namedFields = (rel, markers) => doc(rel).split('\n')
  .filter(l => markers.some(m => l.startsWith(m)))
  .flatMap(l => [...l.matchAll(/`([a-z][a-z0-9_]*)`/g)].map(m => m[1]));

describe('R13-1: init fields named in workflow prose exist in the JSON', () => {
  const cases = [
    ['plan-phase', 'get-shit-done/workflows/plan-phase.md', ['Parse JSON for:', '**File paths']],
    ['execute-phase', 'get-shit-done/workflows/execute-phase.md', ['Parse JSON for: `auto_mode`']],
    ['execute-phase', 'get-shit-done/workflows/execute-plan.md', ['Extract from init JSON:']],
  ];
  for (const [init, rel, markers] of cases) {
    test(`${rel} fields are present in init ${init}`, () => {
      const dir = project();
      const pd = path.join(dir, '.planning', 'phases', '01-one');
      fs.mkdirSync(pd, { recursive: true });
      fs.writeFileSync(path.join(pd, '01-CONTEXT.md'), '# c\n');
      const r = gsd(dir, ['init', init, '1']);
      assert.strictEqual(r.rc, 0, r.out + r.err);
      const names = namedFields(rel, markers);
      assert.ok(names.length > 10, `parsed ${names.length} names from ${rel}`);
      const missing = names.filter(n => !(n in r.json));
      assert.deepStrictEqual(missing, [], `named in ${rel} but absent from init ${init}`);
    });
  }
  test('plan-phase path fields point at existing files, null otherwise', () => {
    const dir = project();
    const pd = path.join(dir, '.planning', 'phases', '01-one');
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, '01-CONTEXT.md'), '# c\n');
    const j = gsd(dir, ['init', 'plan-phase', '1']).json;
    assert.strictEqual(j.context_path, '.planning/phases/01-one/01-CONTEXT.md');
    assert.strictEqual(j.state_path, '.planning/STATE.md');
    assert.strictEqual(j.roadmap_path, '.planning/ROADMAP.md');
    assert.strictEqual(j.requirements_path, null);
    assert.strictEqual(j.research_path, null);
  });
});

describe('R13-2: one wording for the adversarial round and the delta round', () => {
  const pp = doc('get-shit-done/workflows/plan-phase.md');
  test('round 1 adversarial on ruling_model; later rounds delta on checker_model; verdicts deleted only before a new round 1', () => {
    assert.match(pp, /`adversarial` \(round 1 only/);
    assert.match(pp, /only before a NEW round 1/);
    assert.match(pp, /Round 2 and later are delta rounds on `checker_model`/);
    assert.doesNotMatch(pp, /Before EVERY such spawn/);
  });
});

describe('R13-6: no per-plan high_risk decision', () => {
  test('assess-risk reports containment only; a high_risk flag changes nothing', () => {
    const dir = project();
    const pd = path.join(dir, '.planning', 'phases', '01-one');
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, '01-01-PLAN.md'), '---\nphase: 01-one\nplan: 01\nhigh_risk: true\nfiles_modified: [src/auth/login.ts]\n---\n# p\n');
    const j = gsd(dir, ['quality', 'assess-risk', '.planning/phases/01-one/01-01-PLAN.md']).json;
    assert.strictEqual(j.rigour, 'standard');
    assert.ok(!('high_risk' in j));
    assert.strictEqual(gsd(dir, ['init', 'execute-phase', '1']).json.risk_addons, false);
  });
  test('planner and checker no longer carry the per-plan flag', () => {
    assert.doesNotMatch(doc('agents/gsd-planner.md'), /high_risk/);
    assert.doesNotMatch(doc('agents/gsd-plan-checker.md'), /high_risk/);
    assert.doesNotMatch(doc('get-shit-done/workflows/plan-phase.md'), /high_risk/);
  });
});

describe('R13-7: tier tag follows the task, both directions', () => {
  test('planner and checker say so and split mixed tasks', () => {
    for (const f of ['agents/gsd-planner.md', 'agents/gsd-plan-checker.md']) {
      const d = doc(f);
      assert.match(d, /follows the TASK's nature|does not fit the TASK's nature/, f);
      assert.match(d, /stays `haiku`/, f);
      assert.match(d, /mixes mechanical steps and a deciding step/, f);
    }
    assert.match(doc('agents/gsd-plan-checker.md'), /`sonnet` on a plainly mechanical task/);
  });
});

describe('R13-8: task-context skill and routing match machinery are gone', () => {
  test('files and subcommands deleted; classify-failure stays', () => {
    assert.ok(!fs.existsSync(path.join(root, 'skills')));
    assert.ok(!fs.existsSync(path.join(root, 'routing-rules.md')));
    const dir = project();
    for (const sub of ['match', 'match-with-quota', 'context', 'full', 'index-build', 'index-refresh']) {
      const r = gsd(dir, ['routing', sub, 'x']);
      assert.notStrictEqual(r.rc, 0, sub);
    }
    assert.strictEqual(gsd(dir, ['routing', 'classify-failure', 'syntax error']).rc, 0);
  });
});

describe('R13-9: the adversarial pass attacks the product, six fixed questions', () => {
  test('one list in the checker, referenced from Dimension 14', () => {
    const d = doc('agents/gsd-plan-checker.md');
    const i = d.indexOf('## Product lens');
    assert.ok(i > 0);
    const lens = d.slice(i, d.indexOf('\n## ', i + 5));
    assert.strictEqual((lens.match(/^\d\. /gm) || []).length, 6);
    for (const k of ['Privileges', 'Ignored results', 'State-changing reads', 'Guard coverage', 'Secrets and residue', 'False passes']) assert.match(lens, new RegExp(k));
    assert.match(d, /Product lens below/);
    assert.match(lens, /PRESCRIBES a defect[^\n]*blocker/);
  });
});
