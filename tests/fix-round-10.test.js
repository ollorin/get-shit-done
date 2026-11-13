'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const spikeCheck = require('../get-shit-done/bin/spike-check.js');
const reviewGate = require('../get-shit-done/bin/review-gate.js');
const budget = require('../get-shit-done/bin/phase-budget.js');

const root = path.join(__dirname, '..');
const doc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-r10-')); });
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('R10-B: only yes is exempt from a root cause or search', () => {
  const TABLE = (rows) => `# R\n\n| Question | Answer | Capture | Probe | Root cause or search |\n|---|---|---|---|---|\n${rows.join('\n')}\n`;
  const errs = (rows) => {
    const pd = path.join(tmpDir, 'pd');
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, 'SPIKE-RESULT.md'), TABLE(rows));
    return spikeCheck.answerTableErrors(tmpDir, pd, ['SPIKE-RESULT.md']);
  };
  test('inconclusive without a root cause or search is an error; with an existing capture it passes; yes needs none', () => {
    assert.strictEqual(errs(['| Q | inconclusive | | | |']).length, 1);
    assert.strictEqual(errs(['| Q | Inconclusive (cause untraced) | | | |']).length, 1);
    assert.deepStrictEqual(errs(['| Q | yes | | | |']), []);
    fs.mkdirSync(path.join(tmpDir, 'pd', 'captures'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pd', 'captures', 's.txt'), 'out');
    assert.deepStrictEqual(errs(['| Q | inconclusive | | | `captures/s.txt` |']), []);
  });
});

describe('R10-C: criteria_decided at spike', () => {
  const v = (data, closed = false) => reviewGate.verificationReviewErrors({ exists: true, fileName: '01-VERIFICATION.md', data }, true, closed);
  test('the field is required at an open spike phase; closed phases are exempt', () => {
    assert.strictEqual(v({ open_critical_high: 0 }).length, 1);
    assert.deepStrictEqual(v({ open_critical_high: 0 }, true), []);
    assert.deepStrictEqual(v({ open_critical_high: 0, criteria_decided: '2/3' }), []);
  });
  test('malformed values and n greater than m are errors', () => {
    for (const bad of ['two', '4/3', '-1/3', '1/0']) assert.strictEqual(v({ open_critical_high: 0, criteria_decided: bad }).length, 1, bad);
  });
  test('0 decided requires headline: undecided', () => {
    assert.strictEqual(v({ open_critical_high: 0, criteria_decided: '0/3' }).length, 1);
    assert.strictEqual(v({ open_critical_high: 0, criteria_decided: '0/3', headline: 'route B' }).length, 1);
    assert.deepStrictEqual(v({ open_critical_high: 0, criteria_decided: '0/3', headline: 'undecided' }), []);
  });
  test('a standard-rigour VERIFICATION never needs the field', () => {
    assert.deepStrictEqual(reviewGate.verificationReviewErrors({ exists: true, fileName: 'v', data: { open_critical_high: 0 } }, false), []);
  });
});

describe('R10-G: cumulative budget totals across windows', () => {
  const t = (m) => new Date(Date.parse('2026-01-01T00:00:00Z') + m * 60000).toISOString();
  test('spend reports totals that survive a park-and-retry reset and a completion', () => {
    const ev = [
      { type: 'phase_start', phase: '1', timestamp: t(0) },
      { type: 'phase_spend', phase: '1', timestamp: t(10) },
      { type: 'phase_spend', phase: '1', timestamp: t(30) },
      { type: 'phase_parked', phase: '1', reason: 'gaps_after_closure_cycle', timestamp: t(40) },
      { type: 'phase_start', phase: '1', timestamp: t(1000) },
      { type: 'phase_spend', phase: '1', timestamp: t(1020) },
    ];
    const s = budget.spend(ev, '1');
    assert.deepStrictEqual([s.wall_minutes_spent, s.dispatches_spent, s.total_wall_minutes, s.total_dispatches], [20, 1, 60, 3]);
    const st = budget.status({ cwd: tmpDir, phase: '1', cls: 'spike', events: ev });
    assert.deepStrictEqual([st.total_wall_minutes, st.total_dispatches], [60, 3]);
  });
  test('status of a completed phase and its phase_complete event carry the totals', () => {
    const ev = [
      { type: 'phase_start', phase: '1', timestamp: t(0) },
      { type: 'phase_spend', phase: '1', timestamp: t(10) },
      { type: 'phase_complete', phase: '1', timestamp: t(12), wall_minutes_spent: 12, dispatches_spent: 1, total_wall_minutes: 12, total_dispatches: 1, budget_wall_minutes: 45, budget_dispatches: 10 },
    ];
    const st = budget.status({ cwd: tmpDir, phase: '1', cls: 'spike', events: ev });
    assert.deepStrictEqual([st.final, st.total_wall_minutes, st.total_dispatches], [true, 12, 1]);
    for (const f of ['get-shit-done/bin/gsd-tools.js']) assert.ok((doc(f).match(/total_wall_minutes: b\.total_wall_minutes/g) || []).length >= 2, 'both phase_complete writers carry the totals');
  });
});

describe('R10 prose: rules named in the audit are in the files', () => {
  test('A: Dimension 16 and plan-phase name the refuting observation', () => {
    assert.match(doc('agents/gsd-plan-checker.md'), /refuting observation/);
    assert.match(doc('get-shit-done/workflows/plan-phase.md'), /refuting observation/);
  });
  test('C/D/E/F/H: rigour, verifier and execute-phase carry the new rules', () => {
    const r = doc('get-shit-done/references/rigour.md');
    assert.match(r, /criteria_decided/);
    assert.match(r, /fix re-check/);
    assert.match(r, /new budget window/);
    const v = doc('agents/gsd-verifier.md');
    assert.match(v, /criteria_decided/);
    assert.match(v, /literal success code/);
    assert.match(v, /recorded command/);
    const e = doc('get-shit-done/workflows/execute-phase.md');
    assert.match(e, /fix re-check/);
    assert.match(e, /names the file that must carry it/);
  });
});
