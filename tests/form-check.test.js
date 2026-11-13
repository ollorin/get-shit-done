'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeProject, gsd, writeEvidence, git } = require('./helpers/roadmap-fixture.js');

const dirs = [];
const project = () => { const d = makeProject([{ n: '1', name: 'one' }], {}); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const plan = (n, { lines = 0, tasks = 1, files = ['src/a.js'] } = {}) => `---\nphase: 01\nplan: ${n}\nplan_stamp: abc\nfiles_modified:\n${files.map((f) => `  - ${f}`).join('\n')}\n---\n# Plan\n<tasks>\n${'<task type="auto"><model>haiku</model>x</task>\n'.repeat(tasks)}</tasks>\n${'\n'.repeat(lines)}`;
const setPlan = (dir, text, n = '01', executed = false) => { const pd = writeEvidence(dir, 1); fs.writeFileSync(path.join(pd, `01-${n}-PLAN.md`), text); if (!executed) fs.rmSync(path.join(pd, '01-01-SUMMARY.md'), { force: true }); return pd; };
const form = (dir, ...a) => gsd(dir, ['verify', 'form', '1', ...a]);
const checks = (r) => r.json.errors.map((e) => e.check);

describe('verify form', () => {
  test('plan line cap: 250 lines pass, 251 fail', () => {
    const dir = project();
    const base = plan('01', { lines: 0 }).split('\n').length - 1;
    setPlan(dir, plan('01', { lines: 250 - base }));
    assert.strictEqual(form(dir, '--plans-only').rc, 0);
    setPlan(dir, plan('01', { lines: 251 - base }));
    const r = form(dir, '--plans-only');
    assert.deepStrictEqual([r.rc, checks(r)], [1, ['plan_lines']]);
    assert.deepStrictEqual(Object.keys(r.json.errors[0]).sort(), ['check', 'file', 'message']);
  });
  test('standard rigour has no task or plan count cap', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01', { tasks: 9 }));
    for (const n of ['02', '03', '04']) fs.writeFileSync(path.join(pd, `01-${n}-PLAN.md`), plan(n));
    assert.strictEqual(form(dir, '--plans-only').rc, 0);
  });
  test('a spike phase uses the spike caps', () => {
    const dir = project();
    const rm = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(rm, fs.readFileSync(rm, 'utf8').replace('**Depends on:** None', '**Rigour**: spike (OG2)\n**Spike roots**: spike/'));
    fs.writeFileSync(path.join(dir, '.planning', 'OWNER-GATES.json'), JSON.stringify({ version: 1, gates: [{ id: 'roadmap@current', kind: 'roadmap', milestone: null, status: 'approved', rigour: { spike_phases: ['1'], spike_roots: ['spike/'] } }] }));
    setPlan(dir, plan('01', { tasks: 5 }));
    assert.deepStrictEqual(checks(form(dir, '--plans-only')), ['plan_tasks']);
  });
  test('an evidence-only plan and a missing stamp are blocking plan-time errors', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01', { files: ['.planning/phases/01-p1/x.md'] }));
    for (const n of ['02', '03', '04']) fs.writeFileSync(path.join(pd, `01-${n}-PLAN.md`), plan(n));
    fs.writeFileSync(path.join(pd, '01-05-PLAN.md'), plan('05').replace('plan_stamp: abc\n', ''));
    const r = form(dir, '--plans-only');
    assert.deepStrictEqual([r.rc, checks(r).sort()], [1, ['evidence_only_plan', 'plan_stamp_missing']]);
  });
  test('an executed plan (SUMMARY on disk) is never reported for caps', () => {
    const dir = project();
    setPlan(dir, plan('01', { lines: 400, tasks: 9 }), '01', true);
    assert.strictEqual(form(dir, '--plans-only').rc, 0);
  });
  const gateForm = (dir) => gsd(dir, ['verify', 'phase-gate', '1', '--pre-verifier']).json.form_errors;
  test('line cites to DECISIONS.md / ROADMAP.md in the phase PLAN/SUMMARY fail; ids pass; ledger rows, VERIFICATION and REVIEW quotes are not scanned', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01'));
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n\nSee D-34 and src/a.ts:12.\n\n## Self-Check: PASSED\n');
    assert.deepStrictEqual(gateForm(dir), []);
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n\nper DECISIONS.md:248\n\n## Self-Check: PASSED\n');
    const errs = gateForm(dir);
    assert.deepStrictEqual(errs.map((e) => e.check), ['line_cite']);
    assert.match(errs[0].message, /DECISIONS\.md:248/);
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n\n## Self-Check: PASSED\n');
    fs.writeFileSync(path.join(pd, '01-VERIFICATION.md'), '---\nstatus: passed\n---\nfinding: DECISIONS.md:12\n');
    fs.writeFileSync(path.join(pd, '01-REVIEW-1.md'), 'ROADMAP.md:9\n');
    fs.writeFileSync(path.join(dir, '.planning', 'DECISIONS.jsonl'), JSON.stringify({ id: 'D-01', kind: 'decision', phases: ['1'], answer: 'see ROADMAP.md:12' }) + '\n');
    assert.deepStrictEqual(gateForm(dir), []);
  });
  test('a SUMMARY without the Self-Check section is a form error of phase-gate; verify form (plan-time) does not report it', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01'));
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n');
    assert.ok(gateForm(dir).some((e) => e.check === 'self_check'));
    assert.strictEqual(form(dir, '--plans-only').rc, 0);
  });
});

describe('phase-gate separates form from missing work; phase complete --form-debt', () => {
  const finish = (dir) => { gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '--allow-empty', '-m', 'chk'); };
  test('a form error is in form_errors and not in failures or work_errors', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01'));
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n');
    const r = gsd(dir, ['verify', 'phase-gate', '1']);
    assert.ok(!r.json.failures.includes('missing_evidence'));
    assert.strictEqual(r.json.passed, false);
    assert.ok(r.json.form_errors.some((e) => e.check === 'self_check'));
    assert.deepStrictEqual(r.json.work_errors, []);
    const miss = writeEvidence(dir, 1, { summary: false });
    fs.rmSync(path.join(miss, '01-01-SUMMARY.md'), { force: true });
    assert.ok(gsd(dir, ['verify', 'phase-gate', '1']).json.failures.includes('missing_evidence'));
  });
  test('--form-debt accepts form errors, records form_debt in VERIFICATION frontmatter, exits 0; without it exit 1', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01'));
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'feat(01-01): x');
    finish(dir);
    assert.strictEqual(gsd(dir, ['phase', 'complete', '1']).rc, 1);
    const r = gsd(dir, ['phase', 'complete', '1', '--form-debt']);
    assert.strictEqual(r.rc, 0, r.out + (r.err || ''));
    assert.ok(r.json.form_debt.length > 0);
    assert.match(fs.readFileSync(path.join(pd, '01-VERIFICATION.md'), 'utf8'), /^form_debt:\n  - "/m);
    const rec = gsd(dir, ['roadmap', 'record', '--phase', '1', '--result', '{"status":"completed"}']).json
    assert.deepStrictEqual([rec.action, rec.form_debt.length > 0], ['complete', true]);
  });
  test('--form-debt never accepts missing work', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01'));
    fs.writeFileSync(path.join(pd, '01-VERIFICATION.md'), '---\nstatus: gaps_found\n---\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'feat(01-01): x');
    finish(dir);
    assert.strictEqual(gsd(dir, ['phase', 'complete', '1', '--form-debt']).rc, 1);
  });
});
