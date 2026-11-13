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
  test('none is false; a per-plan high_risk flag no longer changes it', () => {
    const dir = project();
    plan(dir);
    for (const cmd of ['plan-phase', 'execute-phase']) assert.strictEqual(gsd(dir, ['init', cmd, '1']).json.risk_addons, false, cmd);
    plan(dir, 'high_risk: true\n');
    for (const cmd of ['plan-phase', 'execute-phase']) assert.strictEqual(gsd(dir, ['init', cmd, '1']).json.risk_addons, false, cmd);
  });
});

describe('N6 the review is a disk check: {N}-REVIEW.md frontmatter', () => {
  const executed = (touchCode = true) => {
    const dir = project();
    const pd = phaseDir(dir, 1);
    write(dir, '.planning/phases/' + path.basename(pd) + '/01-01-PLAN.md', '---\nphase: 01\nplan: "01"\nfiles_modified: [src/a.js]\n---\n# Plan\n');
    write(dir, '.planning/phases/' + path.basename(pd) + '/01-01-SUMMARY.md', '# Summary\n\n## Self-Check: PASSED\n');
    write(dir, '.planning/phases/' + path.basename(pd) + '/01-VERIFICATION.md', '---\nstatus: passed\n---\n# V\n');
    if (touchCode) write(dir, 'src/a.js', 'x');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(01-01): work');
    return { dir, pd };
  };
  const review = (pd, fm) => fs.writeFileSync(path.join(pd, '01-REVIEW.md'), `---\n${fm}\n---\n# Review\n`);
  const gate = (dir) => gsd(dir, ['verify', 'phase-gate', '1']).json;
  const reviewErr = (j) => j.work_errors.filter((e) => /REVIEW/.test(e));

  const logComplete = (dir) => write(dir, '.planning/EXECUTION_LOG.md', '{"timestamp":"2026-01-01T00:00:00.000Z","type":"phase_complete","phase":"1"}\n');
  const checkBox = (dir) => {
    const f = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/- \[ \] (\*\*)?Phase 1:/, '- [x] $1Phase 1:'));
  };
  test('a phase with a phase_complete event in EXECUTION_LOG (closed by an earlier build) is not re-judged by the review gate', () => {
    const { dir } = executed();
    logComplete(dir);
    assert.deepStrictEqual(reviewErr(gate(dir)), []);
  });
  test('a ROADMAP box hand-checked after the gate_baseline does not skip the review gate', () => {
    const { dir } = executed();
    write(dir, '.planning/EXECUTION_LOG.md', '{"timestamp":"2026-01-01T00:00:00.000Z","type":"gate_baseline","phases":[]}\n');
    checkBox(dir);
    assert.strictEqual(reviewErr(gate(dir)).length, 1);
  });
  test('the event never skips an open CRITICAL/HIGH in VERIFICATION without a ruling id', () => {
    const { dir, pd } = executed();
    logComplete(dir);
    fs.writeFileSync(path.join(pd, '01-VERIFICATION.md'), '---\nstatus: passed\nopen_critical_high: 2\n---\n# V\n');
    assert.ok(gate(dir).work_errors.some((e) => /open_critical_high 2 and no ruling id/.test(e)));
  });
  test('code changed and no review file: work error, and phase complete refuses', () => {
    const { dir } = executed();
    const j = gate(dir);
    assert.strictEqual(reviewErr(j).length, 1, JSON.stringify(j.work_errors));
    assert.ok(j.failures.includes('missing_evidence'));
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    assert.strictEqual(gsd(dir, ['phase', 'complete', '1']).rc, 1);
  });
  test('open CRITICAL/HIGH without a ruling: work error', () => {
    const { dir, pd } = executed();
    review(pd, 'reviewer_role: final\npasses: 1\nopen_critical_high: 1');
    const e = reviewErr(gate(dir));
    assert.strictEqual(e.length, 1);
    assert.match(e[0], /REVIEW\.md[^\n]*open_critical_high 1/);
  });
  test('open CRITICAL/HIGH with a ruling id recorded: passes', () => {
    const { dir, pd } = executed();
    review(pd, 'reviewer_role: final\npasses: 1\nopen_critical_high: 1\nruled_by: [D-12]');
    assert.deepStrictEqual(reviewErr(gate(dir)), []);
  });
  test('clean record passes', () => {
    const { dir, pd } = executed();
    review(pd, 'reviewer_role: final\npasses: 1\nopen_critical_high: 0');
    assert.deepStrictEqual(reviewErr(gate(dir)), []);
  });
  test('a record without open_critical_high or without passes is a work error; a phase that changed nothing outside .planning needs none', () => {
    const a = executed();
    review(a.pd, 'reviewer_role: final\npasses: 1');
    assert.strictEqual(reviewErr(gate(a.dir)).length, 1);
    review(a.pd, 'reviewer_role: final\nopen_critical_high: 0');
    assert.strictEqual(reviewErr(gate(a.dir)).length, 1);
    const b = executed(false);
    assert.deepStrictEqual(reviewErr(gate(b.dir)), []);
  });
  test('risk add-ons: one recorded pass is a work error, a pass-2 record passes', () => {
    const rg = require('../get-shit-done/bin/review-gate.js');
    const d = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rg-'));
    fs.writeFileSync(path.join(d, '01-REVIEW.md'), '---\nreviewer_role: final\npasses: 1\nopen_critical_high: 0\n---\n');
    const files = ['01-REVIEW.md'];
    assert.strictEqual(rg.reviewErrors(d, files, ['src/a.js'], { risk: true }).length, 1);
    assert.deepStrictEqual(rg.reviewErrors(d, files, ['src/a.js']), []);
    fs.writeFileSync(path.join(d, '01-REVIEW.md'), '---\nreviewer_role: final\npasses: 2\nopen_critical_high: 0\n---\n');
    assert.deepStrictEqual(rg.reviewErrors(d, files, ['src/a.js'], { risk: true }), []);
  });
});

describe('N11 / E2 removed surfaces', () => {
  test('init output has no rigour_decision', () => {
    const dir = project();
    for (const cmd of ['plan-phase', 'execute-phase']) assert.ok(!('rigour_decision' in gsd(dir, ['init', cmd, '1']).json), cmd);
  });
  test('resolve-model has no utility/reviewer aliases (init fields carry those models)', () => {
    const dir = project([{ n: '1', name: 'one' }], { utility_model: 'u', reviewer_model: 'r' });
    assert.notStrictEqual(gsd(dir, ['resolve-model', 'utility']).out.trim(), 'u');
    assert.notStrictEqual(gsd(dir, ['resolve-model', 'reviewer']).out.trim(), 'r');
    assert.strictEqual(gsd(dir, ['init', 'execute-phase', '1']).json.utility_model, 'u');
  });
  test('verify form is the plan-time check only: no post-execution form list without --plans-only', () => {
    const dir = project();
    const pd = phaseDir(dir, 1);
    write(dir, '.planning/phases/' + path.basename(pd) + '/01-01-PLAN.md', '---\nphase: 01\nplan: "01"\nplan_stamp: abc\n---\n# Plan DECISIONS.md:12\n');
    write(dir, '.planning/phases/' + path.basename(pd) + '/01-01-SUMMARY.md', '# no self-check\n');
    const r = gsd(dir, ['verify', 'form', '1']);
    assert.deepStrictEqual([r.rc, r.json.errors], [0, []]);
  });
});
