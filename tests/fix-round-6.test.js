'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeProject, gsd, git, phaseDir, writeEvidence, completePhaseLikeWorkflow, events } = require('./helpers/roadmap-fixture.js');
const tools = require('../get-shit-done/bin/gsd-tools.js');
const spikeCheck = require('../get-shit-done/bin/spike-check.js');
const box = require('../get-shit-done/bin/roadmap-box.js');
const dispatch = require('../get-shit-done/bin/roadmap-dispatch.js');

const dirs = [];
const project = (cfg = {}) => { const d = makeProject([{ n: '1', name: 'one' }], cfg); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const tick = (dir) => {
  const f = path.join(dir, '.planning', 'ROADMAP.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/- \[ \] (\*\*)?Phase 1:/, '- [x] $1Phase 1:'));
};
const executed = (dir, verification = '---\nstatus: passed\n---\n# V\n') => {
  const b = path.basename(phaseDir(dir, 1));
  write(dir, `.planning/phases/${b}/01-01-PLAN.md`, '---\nphase: 01\nplan: "01"\nfiles_modified: [src/a.js]\n---\n# Plan\n');
  write(dir, `.planning/phases/${b}/01-01-SUMMARY.md`, '# Summary\n\n## Self-Check: PASSED\n');
  write(dir, `.planning/phases/${b}/01-VERIFICATION.md`, verification);
  write(dir, 'src/a.js', 'x');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat(01-01): work');
};
const reviewErrs = (dir) => gsd(dir, ['verify', 'phase-gate', '1']).json.work_errors.filter((e) => /REVIEW/.test(e));

describe('R4-1: a one-time gate_baseline keeps phases finished by older builds closed', () => {
  test('boxes checked and no events: not re-gated, not re-dispatched; one baseline, never rewritten', () => {
    const dir = project();
    executed(dir);
    tick(dir);
    assert.deepStrictEqual(reviewErrs(dir), []);
    assert.ok(!fs.existsSync(path.join(dir, '.planning', 'EXECUTION_LOG.md')), 'a gate read does not create the log');
    const r = gsd(dir, ['roadmap', 'next']).json;
    assert.notStrictEqual(r.action, 'spawn_coordinator');
    assert.ok(!events(dir).some((e) => e.type === 'phase_start'));
    gsd(dir, ['roadmap', 'next']);
    const base = events(dir).filter((e) => e.type === 'gate_baseline');
    assert.strictEqual(base.length, 1);
    assert.deepStrictEqual(base[0].phases, ['1']);
  });
  test('a box ticked after the baseline does not skip the gates', () => {
    const dir = project();
    executed(dir);
    assert.strictEqual(gsd(dir, ['roadmap', 'next']).json.action, 'spawn_coordinator');
    tick(dir);
    assert.strictEqual(reviewErrs(dir).length, 1);
  });
  test('a baselined phase with open_critical_high and no ruling still fails', () => {
    const dir = project();
    executed(dir, '---\nstatus: passed\nopen_critical_high: 2\n---\n# V\n');
    tick(dir);
    assert.ok(gsd(dir, ['verify', 'phase-gate', '1']).json.work_errors.some((e) => /open_critical_high 2 and no ruling id/.test(e)));
  });
});

const spikeProject = () => {
  const dir = project();
  const rm = path.join(dir, '.planning', 'ROADMAP.md');
  fs.writeFileSync(rm, fs.readFileSync(rm, 'utf8').replace('**Depends on:** None', '**Rigour**: spike (OG2)\n**Spike roots**: spike/\n**Depends on:** None'));
  write(dir, '.planning/OWNER-GATES.json', JSON.stringify({ version: 1, gates: [{ id: 'roadmap@current', kind: 'roadmap', milestone: null, status: 'approved', rigour: { spike_phases: ['1'], spike_roots: ['spike/'] } }] }));
  phaseDir(dir, 1);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'spike setup');
  return dir;
};

describe('R4-2: the answer table is not required before the verifier', () => {
  test('--pre-verifier at spike does not demand it; the final gate does', () => {
    const dir = spikeProject();
    writeEvidence(dir, 1, { verification: null });
    const pre = gsd(dir, ['verify', 'phase-gate', '1', '--pre-verifier']).json;
    assert.ok(!pre.work_errors.some((e) => /No answer table/.test(e)), JSON.stringify(pre.work_errors));
    const fin = gsd(dir, ['verify', 'phase-gate', '1']).json;
    assert.ok(fin.work_errors.some((e) => /No answer table/.test(e)));
  });
});

describe('R4-3: a retried parked spike phase gets its own ruling', () => {
  const rec = (dir, status = 'gaps_found') => gsd(dir, ['roadmap', 'record', '--phase', '1', '--result', JSON.stringify({ status, gap_cycle_done: true })]).json;
  test('park -> retry -> ruling again, then park', () => {
    const dir = spikeProject();
    executed(dir, '---\nstatus: passed\nopen_critical_high: 2\n---\n# V\n');
    assert.strictEqual(gsd(dir, ['roadmap', 'next']).json.action, 'spawn_coordinator');
    assert.strictEqual(rec(dir).action, 'ruling');
    gsd(dir, ['execution-log', 'event', '--type', 'spike_ruling', '--data', '{"phase":"1"}']);
    assert.strictEqual(rec(dir).action, 'park');
    assert.strictEqual(gsd(dir, ['roadmap', 'next', '--retry-parked']).json.action, 'spawn_coordinator');
    assert.strictEqual(rec(dir).action, 'ruling');
    gsd(dir, ['execution-log', 'event', '--type', 'spike_ruling', '--data', '{"phase":"1"}']);
    assert.strictEqual(rec(dir).action, 'park');
  });
  test('the gap-cycle count restarts at the retry phase_start', () => {
    const ev = [{ type: 'phase_start', phase: '1' }, { type: 'gap_cycle', phase: '1' }, { type: 'phase_parked', phase: '1', reason: 'gaps_after_closure_cycle' }, { type: 'phase_start', phase: '1' }];
    assert.strictEqual(dispatch.foldEvents(ev).get('1').gap_cycles, 0);
  });
});

describe('R4-5: roadmap analyze reads the checkbox through the shared helper', () => {
  test('a checked line that mentions another phase does not check it', () => {
    const dir = project();
    write(dir, '.planning/ROADMAP.md', '# Roadmap\n\n- [x] Phase 4: Foo (unblocks Phase 5 work)\n- [ ] Phase 5: Bar\n\n### Phase 4: Foo\n**Goal:** a\n\n### Phase 5: Bar\n**Goal:** b\n');
    const phases = gsd(dir, ['roadmap', 'analyze']).json.phases;
    assert.strictEqual(phases.find((p) => p.number === '4').roadmap_complete, true);
    assert.strictEqual(phases.find((p) => p.number === '5').roadmap_complete, false);
  });
});

describe('R4-7: phase complete then roadmap record completed writes one phase_complete', () => {
  test('the duplicate is skipped', () => {
    const dir = project();
    writeEvidence(dir, 1);
    assert.strictEqual(completePhaseLikeWorkflow(dir, 1).rc, 0);
    gsd(dir, ['roadmap', 'record', '--phase', '1', '--result', '{"status":"completed"}']);
    assert.strictEqual(events(dir).filter((e) => e.type === 'phase_complete').length, 1);
  });
});

describe('R4-8 / R4-9 / R4-10', () => {
  test('a parenthesised PASSED heading is not failed by a FAILED word in the body', () => {
    assert.strictEqual(tools.evaluateSummarySelfCheck('## Self-Check (PASSED)\n\nFAILED probe row\n').status, 'passed');
  });
  test('a directory is not a probe file; "manual" names no probe', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-r6-')); dirs.push(d);
    write(d, 'spike/p.js', 'x');
    write(d, 'pd/captures/a.txt', 'out');
    const t = (probe) => `| Question | Answer | Capture | Probe | Root cause or search |\n|---|---|---|---|---|\n| Q | yes | \`captures/a.txt\` | ${probe} | |\n`;
    write(d, 'pd/SPIKE-RESULT.md', t('manual'));
    assert.deepStrictEqual(spikeCheck.answerTableErrors(d, path.join(d, 'pd'), ['SPIKE-RESULT.md']), []);
    write(d, 'pd/SPIKE-RESULT.md', t('`cd spike && node spike/p.js`'));
    assert.deepStrictEqual(spikeCheck.answerTableErrors(d, path.join(d, 'pd'), ['SPIKE-RESULT.md']), []);
  });
  test('the box helper reads "Phase 3." and rejects Phase 10 / 3a; phase complete reports a missing box line', () => {
    assert.strictEqual(box.checkboxState('- [x] Phase 3. Foo\n', 3), true);
    assert.strictEqual(box.checkboxState('- [x] Phase 10: Foo\n', 1), null);
    assert.strictEqual(box.checkboxState('- [x] Phase 3a: Foo\n', 3), null);
    const dir = project();
    writeEvidence(dir, 1);
    write(dir, '.planning/ROADMAP.md', fs.readFileSync(path.join(dir, '.planning', 'ROADMAP.md'), 'utf8').replace(/^- \[ \].*$/m, '* [ ] Phase 1 one'));
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    const r = gsd(dir, ['phase', 'complete', '1']);
    assert.match(r.json.roadmap_checkbox_missing, /no checkbox line for phase 1/);
  });
});

describe('R4-4 / R4-6 prose: one actor, one place', () => {
  const doc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  test('the phase coordinator spawns the ruling, allowed at breach; tier tag sentence only in execute-phase', () => {
    assert.match(doc('get-shit-done/references/rigour.md'), /The phase coordinator spawns it, inside the phase before it returns/);
    assert.match(doc('get-shit-done/references/rigour.md'), /and the one ruling for what the fix left open: none is ever skipped for budget/);
    assert.match(doc('agents/gsd-phase-coordinator.md'), /you spawn that ruling before you return/);
    assert.match(doc('get-shit-done/workflows/execute-roadmap.md'), /re-enter that phase's coordinator/);
    assert.doesNotMatch(doc('get-shit-done/references/rigour.md'), /tier tag below/);
    assert.match(doc('get-shit-done/workflows/execute-phase.md'), /ignore a task's `<model>` tier tag/);
    assert.match(doc('get-shit-done/references/rigour.md'), /Retried parked spike phase/);
  });
});
