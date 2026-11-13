'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeProject, gsd, git, phaseDir, events, writeEvidence, TOOLS } = require('./helpers/roadmap-fixture.js');

// JSON-mode runner (the shared helper always passes --raw, which prints bare words for some commands).
const gsdJ = (dir, args, env = {}) => {
  const run = (out, rc, err = '') => { let json = null; try { json = JSON.parse(out); } catch { /* text */ } return { rc, out, err, json }; };
  try { return run(execFileSync('node', [TOOLS, ...args], { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GSD_LEGACY: '1', GSD_AUTONOMOUS: '', ...env } }), 0); } catch (e) { return run((e.stdout || '').toString(), e.status ?? 1, (e.stderr || '').toString()); }
};

const FIX = path.join(__dirname, 'fixtures', 'casino-mall');
const dirs = [];
const project = (phases = [{ n: '1', name: 'one' }], config = {}) => { const d = makeProject(phases, config); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const fixture = (dir, name, as) => write(dir, `.planning/${as}`, fs.readFileSync(path.join(FIX, name), 'utf8'));
const plans = (dir, n, plansN, summariesN) => {
  const pd = phaseDir(dir, n);
  const p = String(n).padStart(2, '0');
  for (let i = 1; i <= plansN; i++) {
    write(dir, path.relative(dir, path.join(pd, `${p}-0${i}-PLAN.md`)), `---\nphase: ${p}\nplan: 0${i}\n---\n# p\n`);
    if (i <= summariesN) write(dir, path.relative(dir, path.join(pd, `${p}-0${i}-SUMMARY.md`)), '# S\n\n## Self-Check: PASSED\n');
  }
  return pd;
};

describe('item 6: state and roadmap commands on the shapes this fork and its bench produce', () => {
  test('advance-plan on the "Plan: Not started" line that `phase complete` itself writes counts from disk', () => {
    const dir = project([{ n: '3', name: 'three' }, { n: '4', name: 'four' }]);
    fixture(dir, 'STATE.after-phase-3.md', 'STATE.md');
    plans(dir, 4, 2, 1);
    const r = gsdJ(dir, ['state', 'advance-plan']);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    assert.deepStrictEqual([r.json.advanced, r.json.current_plan, r.json.total_plans], [true, 2, 2]);
    assert.match(read(dir, '.planning/STATE.md'), /^Plan: 2 of 2/m);
  });
  test('advance-plan with every plan summarised reports the last plan and writes a parseable line', () => {
    const dir = project([{ n: '4', name: 'four' }]);
    fixture(dir, 'STATE.head.md', 'STATE.md');
    plans(dir, 4, 1, 1);
    const r = gsdJ(dir, ['state', 'advance-plan']);
    assert.deepStrictEqual([r.rc, r.json.advanced, r.json.reason], [0, false, 'last_plan']);
    assert.match(read(dir, '.planning/STATE.md'), /^Plan: 1 of 1/m);
  });
  test('--phase overrides a stale Phase line when counting from disk', () => {
    const dir = project([{ n: '3', name: 'three' }]);
    fixture(dir, 'STATE.mid-phase-3.md', 'STATE.md');
    plans(dir, 3, 2, 1);
    const r = gsdJ(dir, ['state', 'advance-plan', '--phase', '3']);
    assert.deepStrictEqual([r.rc, r.json.advanced, r.json.current_plan, r.json.total_plans], [0, true, 2, 2]);
  });
  test('an unparseable Plan line fails loudly: nonzero exit, the line is quoted', () => {
    const dir = project();
    write(dir, '.planning/STATE.md', '# S\n\nPhase: 1 of 1\nPlan: soon-ish\nStatus: x\n');
    const r = gsdJ(dir, ['state', 'advance-plan']);
    assert.notStrictEqual(r.rc, 0);
    assert.match(r.out + r.err, /Plan: soon-ish/);
  });
  test('record-metric on a Performance Metrics section without a table creates the table and counts the plan', () => {
    const dir = project();
    fixture(dir, 'STATE.head.md', 'STATE.md');
    const r = gsdJ(dir, ['state', 'record-metric', '--phase', '4', '--plan', '01', '--duration', '5min', '--tasks', '3', '--files', '4']);
    assert.deepStrictEqual([r.rc, r.json.recorded], [0, true]);
    const s = read(dir, '.planning/STATE.md');
    assert.match(s, /\| Phase 4 P01 \| 5min \| 3 tasks \| 4 files \|/);
    assert.match(s, /Total plans completed: 1/);
    assert.match(s, /## Accumulated Context/);
  });
  test('record-metric with no Performance Metrics section at all appends one; it never answers false silently', () => {
    const dir = project();
    write(dir, '.planning/STATE.md', '# S\n\nPhase: 1 of 1\n');
    const r = gsdJ(dir, ['state', 'record-metric', '--phase', '1', '--plan', '01', '--duration', '2min']);
    assert.deepStrictEqual([r.rc, r.json.recorded], [0, true]);
    assert.match(read(dir, '.planning/STATE.md'), /## Performance Metrics[\s\S]*\| Phase 1 P01 \| 2min \|/);
  });
  test('update-plan-progress keeps a verification score in the status cell and still updates the Plans cell', () => {
    const dir = project([{ n: '1', name: 'one' }]);
    fixture(dir, 'ROADMAP.head.md', 'ROADMAP.md');
    plans(dir, 1, 5, 5);
    const r = gsd(dir, ['roadmap', 'update-plan-progress', '1']);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    const row = read(dir, '.planning/ROADMAP.md').split('\n').find((l) => l.startsWith('| 1. Local base'));
    assert.match(row, /\| 5\/5 \|/);
    assert.match(row, /gaps_found 22\/24/);
  });
  test('phase complete does not stack "Complete" on an "Executed" status cell', () => {
    const dir = project([{ n: '1', name: 'one' }]);
    const rm = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(rm, `${fs.readFileSync(rm, 'utf8')}\n## Progress\n\n| Phase | Milestone | Plans Complete | Status | Completed |\n|---|---|---|---|---|\n| 1. one | v1.0 | 1/1 | Executed (1/1 plans) | - |\n`);
    writeEvidence(dir, 1);
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    const r = gsd(dir, ['phase', 'complete', '1']);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    const row = read(dir, '.planning/ROADMAP.md').split('\n').find((l) => l.startsWith('| 1. one'));
    assert.doesNotMatch(row, /Complete Executed/);
    assert.match(row, /\| Complete \(1\/1 plans\)/);
  });
});
