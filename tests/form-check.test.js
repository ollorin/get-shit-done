'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeProject, gsd, writeEvidence, git } = require('./helpers/roadmap-fixture.js');

const dirs = [];
const project = () => { const d = makeProject([{ n: '1', name: 'one' }], {}); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const plan = (n, { lines = 0, tasks = 1, files = ['src/a.js'] } = {}) => `---\nphase: 01\nplan: ${n}\nplan_stamp: abc\nfiles_modified:\n${files.map((f) => `  - ${f}`).join('\n')}\n---\n# Plan\n<tasks>\n${'<task type="auto">x</task>\n'.repeat(tasks)}</tasks>\n${'\n'.repeat(lines)}`;
const setPlan = (dir, text, n = '01') => { const pd = writeEvidence(dir, 1); fs.writeFileSync(path.join(pd, `01-${n}-PLAN.md`), text); return pd; };
const form = (dir, ...a) => gsd(dir, ['verify', 'form', '1', ...a]);
const checks = (r) => r.json.errors.map((e) => e.check);

describe('CLI-5: verify form', () => {
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
  test('7 tasks fail, 6 pass', () => {
    const dir = project();
    setPlan(dir, plan('01', { tasks: 6 }));
    assert.strictEqual(form(dir, '--plans-only').rc, 0);
    setPlan(dir, plan('01', { tasks: 7 }));
    assert.deepStrictEqual(checks(form(dir, '--plans-only')), ['plan_tasks']);
  });
  test('a spike phase uses the spike caps', () => {
    const dir = project();
    const rm = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(rm, fs.readFileSync(rm, 'utf8').replace('**Depends on:** None', '**Rigour**: spike (OG2)\n**Spike roots**: spike/'));
    fs.writeFileSync(path.join(dir, '.planning', 'OWNER-GATES.json'), JSON.stringify({ version: 1, gates: [{ id: 'roadmap@current', kind: 'roadmap', milestone: null, status: 'approved', rigour: { spike_phases: ['1'], spike_roots: ['spike/'] } }] }));
    setPlan(dir, plan('01', { tasks: 5 }));
    assert.deepStrictEqual(checks(form(dir, '--plans-only')), ['plan_tasks']);
  });
  test('an evidence-only plan is an error; plan count over the cap is a warning', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01', { files: ['.planning/phases/01-p1/x.md'] }));
    for (const n of ['02', '03', '04']) fs.writeFileSync(path.join(pd, `01-${n}-PLAN.md`), plan(n));
    const r = form(dir, '--plans-only');
    assert.deepStrictEqual(checks(r), ['evidence_only_plan']);
    assert.ok(r.json.warnings.some((w) => w.check === 'plan_count'));
  });
  test('line cites to DECISIONS.md / ROADMAP.md fail; ids and code cites pass; ledger rows mapped to the phase are scanned', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01'));
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n\nSee D-34 and src/a.ts:12.\n\n## Defect Classes\n\nNone found. (reviewed by: plan-check, verifier)\n\n## Self-Check: PASSED\n');
    assert.strictEqual(form(dir).rc, 0);
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n\nper DECISIONS.md:248\n\n## Defect Classes\n\nNone found. (reviewed by: plan-check, verifier)\n\n## Self-Check: PASSED\n');
    const r = form(dir);
    assert.deepStrictEqual(checks(r), ['line_cite']);
    assert.match(r.json.errors[0].message, /DECISIONS\.md:248/);
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n\n## Defect Classes\n\nNone found. (reviewed by: plan-check, verifier)\n\n## Self-Check: PASSED\n');
    fs.writeFileSync(path.join(dir, '.planning', 'DECISIONS.jsonl'), JSON.stringify({ id: 'D-01', kind: 'decision', phases: ['1'], answer: 'see ROADMAP.md:12' }) + '\n' + JSON.stringify({ id: 'D-02', phases: ['2'], answer: 'ROADMAP.md:9' }) + '\n');
    const r2 = form(dir);
    assert.deepStrictEqual([r2.rc, r2.json.errors.length, r2.json.errors[0].file], [1, 1, '.planning/DECISIONS.jsonl']);
  });
  test('summary form errors are reported (moved from the evidence logic) unless --plans-only', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01'));
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n\n## Self-Check: PASSED\n');
    assert.ok(checks(form(dir)).includes('defect_classes'));
    assert.strictEqual(form(dir, '--plans-only').rc, 0);
  });
});

describe('CLI-5: phase-gate separates form from missing work; phase complete --form-debt', () => {
  const finish = (dir) => { gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '--allow-empty', '-m', 'chk'); };
  test('a form error is in form_errors and not in failures; evidence_errors stays as an alias', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01'));
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n\n## Self-Check: PASSED\n');
    const r = gsd(dir, ['verify', 'phase-gate', '1']);
    assert.ok(!r.json.failures.includes('missing_evidence'));
    assert.strictEqual(r.json.passed, false);
    assert.ok(r.json.form_errors.some((e) => e.check === 'defect_classes'));
    assert.ok(r.json.evidence_errors.length > 0);
    const miss = writeEvidence(dir, 1, { summary: false });
    fs.rmSync(path.join(miss, '01-01-SUMMARY.md'), { force: true });
    assert.ok(gsd(dir, ['verify', 'phase-gate', '1']).json.failures.includes('missing_evidence'));
  });
  test('--form-debt accepts form errors, records form_debt in VERIFICATION frontmatter, exits 0; without it exit 1', () => {
    const dir = project();
    const pd = setPlan(dir, plan('01'));
    fs.writeFileSync(path.join(pd, '01-01-SUMMARY.md'), '# S\n\n## Self-Check: PASSED\n');
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
