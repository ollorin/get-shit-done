'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeProject, gsd, git, phaseDir } = require('./helpers/roadmap-fixture.js');
const tools = require('../get-shit-done/bin/gsd-tools.js');
const dispatch = require('../get-shit-done/bin/roadmap-dispatch.js');
const budget = require('../get-shit-done/bin/phase-budget.js');

const dirs = [];
const project = (cfg = {}) => { const d = makeProject([{ n: '1', name: 'one' }], cfg); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const root = path.join(__dirname, '..');
const doc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const spikeProject = (cfg = {}) => {
  const dir = project(cfg);
  const rm = path.join(dir, '.planning', 'ROADMAP.md');
  fs.writeFileSync(rm, fs.readFileSync(rm, 'utf8').replace('**Depends on:** None', '**Rigour**: spike (OG2)\n**Spike roots**: spike/\n**Depends on:** None'));
  write(dir, '.planning/OWNER-GATES.json', JSON.stringify({ version: 1, gates: [{ id: 'roadmap@current', kind: 'roadmap', milestone: null, status: 'approved', rigour: { spike_phases: ['1'], spike_roots: ['spike/'] } }] }));
  phaseDir(dir, 1);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'spike setup');
  return dir;
};

describe('R5-1: the self-check verdict is the first word after "Self-Check:"', () => {
  const v = (t) => tools.evaluateSummarySelfCheck(t).status;
  test('free text after the verdict is never read as a failure', () => {
    assert.strictEqual(v('## Self-Check: PASSED (3 probe FAIL rows are results)\n'), 'passed');
    assert.strictEqual(v('## Self-Check: **PASSED** - FAIL rows below\n'), 'passed');
  });
  test('a FAILED verdict still fails, and the last heading still wins', () => {
    assert.strictEqual(v('## Self-Check: FAILED (PASSED earlier)\n'), 'failed');
    assert.strictEqual(v('## Self-Check: FAILED\n\n## Self-Check: PASSED (FAIL rows)\n'), 'passed');
  });
  test('the spike execution prompt says a FAIL probe row is not a failed self-check', () => {
    assert.match(doc('get-shit-done/workflows/execute-phase.md'), /probe row that records FAIL is a result, not a failed self-check/);
    assert.match(doc('get-shit-done/workflows/execute-plan.md'), /first word after `Self-Check:`/);
  });
});

describe('R5-2: init run outside the project root names the real problem', () => {
  test('from a subdirectory the error says no .planning/, names the root and --cwd, not a key list', () => {
    const dir = project({});
    fs.mkdirSync(path.join(dir, 'sub', 'x'), { recursive: true });
    const r = gsd(path.join(dir, 'sub', 'x'), ['init', 'plan-phase', '1'], { GSD_LEGACY: '' });
    assert.strictEqual(r.rc, 1);
    assert.match(r.err, /has no \.planning\/: run from the project root/);
    assert.match(r.err, /--cwd/);
    assert.ok(!/project\.slug/.test(r.err));
    assert.ok(r.json.not_project_root.nearest_root === null || typeof r.json.not_project_root.cwd === 'string');
  });
  test('an absent required key is named with the file to add it to, and the check command is named', () => {
    const dir = project({ project: { slug: 'x' } });
    const r = gsd(dir, ['init', 'plan-phase', '1'], { GSD_LEGACY: '' });
    assert.strictEqual(r.rc, 1);
    assert.match(r.err, /project\.owner_title \(add it to \.planning\/config\.json\)/);
    assert.match(r.err, /gsd-tools profile check/);
  });
  test('the workflow names the one config check and tells agents to pass --cwd', () => {
    assert.match(doc('get-shit-done/workflows/plan-phase.md'), /`gsd-tools profile check`[^]*--cwd <root>/);
  });
});

describe('R5-3: plan-checker run-state files and spike wave layout', () => {
  const checker = doc('agents/gsd-plan-checker.md');
  test('CHECKPOINT.json and TASK-CHECKPOINT.json are never a finding', () => {
    assert.match(checker, /Run-state files \(`CHECKPOINT\.json`, `TASK-CHECKPOINT\.json`[^)]*\) are never a finding of any dimension/);
  });
  test('at spike the checker applies no wave arithmetic and plan-phase mandates wave 1 with depends_on as run order', () => {
    assert.match(checker, /At `spike` every plan is `wave: 1`[^\n]*never a finding/);
    assert.match(doc('get-shit-done/workflows/plan-phase.md'), /all `wave: 1` \(`depends_on` only sets their serial run order\)/);
  });
});

describe('R5-4: a claimed directory is satisfied by any diffed file under it', () => {
  const touched = (claimed) => {
    const dir = project();
    write(dir, '.planning/phases/01-p1/captures/a.txt', 'x');
    write(dir, 'src/b.js', 'x');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(01-01): work');
    return tools.collectPhaseTouchedFiles(dir, '01', [{ planNum: '01', fm: { files_modified: claimed } }]).warnings;
  };
  test('trailing-slash and on-disk directories pass; a missing file and an empty directory still warn', () => {
    assert.deepStrictEqual(touched(['.planning/phases/01-p1/captures/']), []);
    assert.deepStrictEqual(touched(['.planning/phases/01-p1/captures']), []);
    assert.deepStrictEqual(touched(['nope/']).map((w) => w.file), ['nope/']);
    assert.deepStrictEqual(touched(['src/missing.js']).map((w) => w.file), ['src/missing.js']);
  });
});

describe('R5-5: at spike the executor resolves to sonnet', () => {
  const model = (dir) => gsd(dir, ['init', 'execute-phase', '1']).json.executor_model;
  test('spike raises haiku to sonnet; standard keeps haiku', () => {
    const s = spikeProject();
    assert.strictEqual(model(s), 'sonnet');
    fs.rmSync(path.join(s, '.planning', 'OWNER-GATES.json'));
    assert.strictEqual(model(s), 'haiku');
  });
});

describe('R5-6: the spike wall budget is 45', () => {
  test('default, rigour.md and no stale 8 in the spike rows', () => {
    assert.deepStrictEqual(budget.budgetFields(project(), 'spike'), { budget_class: 'spike', budget_wall_minutes: 45 });
    assert.match(doc('get-shit-done/references/rigour.md'), /\| 45 min \|/);
  });
});

describe('R5-7: a spike phase with an open CRITICAL/HIGH is ruled before it is parked', () => {
  const truth = { complete: false, errors: ['01-VERIFICATION.md has open_critical_high 2 and no ruling id in ruled_by'], work_errors: ['01-VERIFICATION.md has open_critical_high 2 and no ruling id in ruled_by'], form_errors: [] };
  const rec = (extra, events = []) => dispatch.record({ phase: '1', result: { status: 'gaps_found', gap_cycle_done: true }, truth, events, ...extra });
  test('no spike_ruling event: action ruling, nothing parked', () => {
    const r = rec({ spike: true });
    assert.strictEqual(r.action, 'ruling');
    assert.deepStrictEqual(r.events, []);
  });
  test('after the ruling is logged, or at standard rigour, the old park routing applies', () => {
    assert.strictEqual(rec({ spike: true }, [{ type: 'spike_ruling', phase: '1' }]).action, 'park');
    assert.strictEqual(rec({ spike: false }).action, 'park');
  });
  test('an event for another phase does not count; other gap errors still park', () => {
    assert.strictEqual(rec({ spike: true }, [{ type: 'spike_ruling', phase: '2' }]).action, 'ruling');
    const other = { complete: false, errors: ['x'], work_errors: ['x'], form_errors: [] };
    assert.strictEqual(dispatch.record({ phase: '1', result: { status: 'gaps_found', gap_cycle_done: true }, truth: other, events: [], spike: true }).action, 'park');
  });
  test('through the CLI: record returns ruling, then park once the event is logged', () => {
    const dir = spikeProject();
    const pd = phaseDir(dir, 1);
    write(dir, `.planning/phases/${path.basename(pd)}/01-01-PLAN.md`, '---\nphase: 01\nplan: "01"\nfiles_modified: []\n---\n# P\n');
    write(dir, `.planning/phases/${path.basename(pd)}/01-01-SUMMARY.md`, '# S\n\n## Self-Check: PASSED\n');
    write(dir, `.planning/phases/${path.basename(pd)}/01-VERIFICATION.md`, '---\nstatus: gaps_found\nopen_critical_high: 1\ncriteria_decided: 1/1\n---\n# V\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(01-01): work');
    const res = JSON.stringify({ status: 'gaps_found', gap_cycle_done: true });
    assert.strictEqual(gsd(dir, ['roadmap', 'record', '--phase', '1', '--result', res]).json.action, 'ruling');
    gsd(dir, ['execution-log', 'event', '--type', 'spike_ruling', '--data', '{"phase":"1"}']);
    assert.strictEqual(gsd(dir, ['roadmap', 'record', '--phase', '1', '--result', res]).json.action, 'park');
  });
});
