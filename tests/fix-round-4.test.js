'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeProject, gsd, git, phaseDir, events } = require('./helpers/roadmap-fixture.js');
const spikeCheck = require('../get-shit-done/bin/spike-check.js');
const reviewGate = require('../get-shit-done/bin/review-gate.js');
const box = require('../get-shit-done/bin/roadmap-box.js');

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-r4-')); dirs.push(d); return d; };
const project = () => { const d = makeProject([{ n: '1', name: 'one' }], {}); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const root = path.join(__dirname, '..');
const doc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('R3-1: "closed earlier" is the phase_complete event, never the ROADMAP box', () => {
  const executed = () => {
    const dir = project();
    const pd = phaseDir(dir, 1);
    const b = path.basename(pd);
    write(dir, `.planning/phases/${b}/01-01-PLAN.md`, '---\nphase: 01\nplan: "01"\nfiles_modified: [src/a.js]\n---\n# Plan\n');
    write(dir, `.planning/phases/${b}/01-01-SUMMARY.md`, '# Summary\n\n## Self-Check: PASSED\n');
    write(dir, `.planning/phases/${b}/01-VERIFICATION.md`, '---\nstatus: passed\n---\n# V\n');
    write(dir, 'src/a.js', 'x');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat(01-01): work');
    return { dir, pd };
  };
  const gate = (dir) => gsd(dir, ['verify', 'phase-gate', '1']).json;
  test('a hand-checked box with open_critical_high: 2 and no ruling still fails', () => {
    const { dir, pd } = executed();
    fs.writeFileSync(path.join(pd, '01-VERIFICATION.md'), '---\nstatus: passed\nopen_critical_high: 2\n---\n# V\n');
    const f = path.join(dir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/- \[ \] (\*\*)?Phase 1:/, '- [x] $1Phase 1:'));
    assert.ok(gate(dir).work_errors.some((e) => /open_critical_high 2 and no ruling id/.test(e)));
  });
  test('event + open_critical_high: 2 without ruled_by still fails; with ruled_by it passes', () => {
    const { dir, pd } = executed();
    write(dir, '.planning/EXECUTION_LOG.md', '{"timestamp":"2026-01-01T00:00:00.000Z","type":"phase_complete","phase":"1"}\n');
    fs.writeFileSync(path.join(pd, '01-VERIFICATION.md'), '---\nstatus: passed\nopen_critical_high: 2\n---\n# V\n');
    assert.ok(gate(dir).work_errors.some((e) => /no ruling id/.test(e)));
    fs.writeFileSync(path.join(pd, '01-VERIFICATION.md'), '---\nstatus: passed\nopen_critical_high: 2\nruled_by: [D-3]\n---\n# V\n');
    assert.ok(!gate(dir).work_errors.some((e) => /REVIEW|ruling id/.test(e)));
  });
  test('`phase complete` writes the phase_complete event the gate then recognises', () => {
    const { dir, pd } = executed();
    fs.writeFileSync(path.join(pd, '01-REVIEW-1.md'), '---\nround: 1\nreviewer_role: reviewer\nopen_critical_high: 0\n---\n# R\n');
    gsd(dir, ['phase', 'checkpoint', '1', '--step', 'verify', '--status', 'passed']);
    const r = gsd(dir, ['phase', 'complete', '1']);
    assert.strictEqual(r.rc, 0, r.out);
    assert.ok(events(dir).some((e) => e.type === 'phase_complete' && String(e.phase) === '1'));
  });
});

describe('R3-2 / R3-10: one anchored ROADMAP checkbox helper', () => {
  const rm = '- [x] Phase 4: Foo (unblocks Phase 5 work)\n- [ ] Phase 5: Bar\n- [x] **Phase 03: Pad**\n- [x] Phase 1: One\n- [ ] Phase 10: Ten\n- [ ] Phase 2.1: Dec\n';
  test('a checked line mentioning another phase does not check it; padding, bold and prefixes behave', () => {
    assert.strictEqual(box.checkboxState(rm, 4), true);
    assert.strictEqual(box.checkboxState(rm, 5), false);
    assert.strictEqual(box.checkboxState(rm, 3), true);
    assert.strictEqual(box.checkboxState(rm, '03'), true);
    assert.strictEqual(box.checkboxState(rm, 1), true);
    assert.strictEqual(box.checkboxState(rm, 10), false);
    assert.strictEqual(box.checkboxState(rm, 2), null);
    assert.strictEqual(box.checkboxState(rm, '2.1'), false);
  });
  test('ticking touches only the phase\'s own line', () => {
    const out = box.tickCheckbox(rm, 5, ' (completed D)');
    assert.strictEqual(out, rm.replace('- [ ] Phase 5: Bar', '- [x] Phase 5: Bar (completed D)'));
  });
});

describe('R3-3 / R3-4 / R3-5: spike answer table', () => {
  const TABLE = (rows) => `# R\n\n| Question | Answer | Capture | Probe | Root cause or search |\n|---|---|---|---|---|\n${rows.join('\n')}\n`;
  const setup = (rows) => { const d = tmp(); const pd = path.join(d, 'pd'); write(pd, 'SPIKE-RESULT.md', TABLE(rows)); return { d, pd }; };
  const errs = (rows) => { const { d, pd } = setup(rows); return spikeCheck.answerTableErrors(d, pd, ['SPIKE-RESULT.md']); };
  test('no recognised table is an error only when required (spike)', () => {
    const d = tmp(); const pd = path.join(d, 'pd'); write(pd, 'SPIKE-RESULT.md', '# R\n\n| Q | Result |\n|---|---|\n| a | b |\n');
    assert.strictEqual(spikeCheck.answerTableErrors(d, pd, ['SPIKE-RESULT.md']).length, 0);
    assert.match(spikeCheck.answerTableErrors(d, pd, ['SPIKE-RESULT.md'], { requireTable: true })[0], /No answer table/);
    assert.deepStrictEqual(spikeCheck.answerTableErrors(d, pd, [], { requireTable: true }).length, 1);
  });
  test('only yes or inconclusive need no root cause; every other answer does', () => {
    for (const a of ['negative', 'false', 'unsupported', 'impossible', 'not feasible', 'disproved', 'no', '']) {
      assert.strictEqual(errs([`| Q ${a} | ${a} | | | |`]).length, 1, `"${a}"`);
    }
    for (const a of ['yes', 'Yes - with caveat', '**YES**', '`inconclusive`', 'Inconclusive (no capture)']) {
      assert.deepStrictEqual(errs([`| Q | ${a} | | | |`]), [], a);
    }
  });
  test('a non-empty Probe cell that resolves to no file is an error; a command resolves its file token', () => {
    const { d, pd } = setup(['| Q | yes | | `node spike/nope.js` | |']);
    assert.ok(spikeCheck.answerTableErrors(d, pd, ['SPIKE-RESULT.md']).some((e) => /probe .*not found on disk/.test(e)));
    write(d, 'spike/probe.js', '1');
    write(pd, 'SPIKE-RESULT.md', TABLE(['| Q | yes | `captures/a.txt` | `node spike/probe.js` | |']));
    write(pd, 'captures/a.txt', 'out');
    const old = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(path.join(pd, 'captures/a.txt'), old, old);
    assert.ok(spikeCheck.answerTableErrors(d, pd, ['SPIKE-RESULT.md']).some((e) => /stale capture/.test(e)));
  });
});

describe('R3-8: open_critical_high is a whole count, ruled_by lists D-ids', () => {
  const v = (data, spike = false) => reviewGate.verificationReviewErrors({ exists: true, fileName: '01-VERIFICATION.md', data }, spike);
  test('non-integer counts and non-D ruling ids are rejected', () => {
    assert.strictEqual(v({ open_critical_high: '2 high' }).length, 1);
    assert.strictEqual(v({ open_critical_high: 1.5 }).length, 1);
    assert.strictEqual(v({ open_critical_high: -1 }).length, 1);
    assert.strictEqual(v({ open_critical_high: 1, ruled_by: 'none' }).length, 1);
    assert.strictEqual(v({ open_critical_high: 1, ruled_by: ['D-12', 'x'] }).length, 1);
    assert.deepStrictEqual(v({ open_critical_high: 1, ruled_by: ['D-12'] }), []);
    assert.deepStrictEqual(v({ open_critical_high: '0' }), []);
    assert.deepStrictEqual(v({}), []);
  });
  test('the spike must-carry rule is skipped only for a phase closed earlier; a present field is always judged', () => {
    const verification = { exists: true, fileName: 'V', data: {} };
    assert.strictEqual(reviewGate.verificationReviewErrors(verification, true).length, 1);
    assert.deepStrictEqual(reviewGate.verificationReviewErrors(verification, true, true), []);
    assert.strictEqual(reviewGate.verificationReviewErrors({ ...verification, data: { open_critical_high: 2 } }, true, true).length, 1);
  });
});

describe('R3-6 / R3-7 prose', () => {
  test('the closing rule is stated, and the "no second top-model dispatch" dead end is gone', () => {
    for (const f of ['get-shit-done/references/rigour.md', 'get-shit-done/workflows/execute-phase.md', 'agents/gsd-verifier.md']) {
      assert.doesNotMatch(doc(f), /no second top-model dispatch|never a second top-model dispatch/, f);
    }
    assert.match(doc('get-shit-done/references/rigour.md'), /fixed_by/);
    assert.match(doc('get-shit-done/references/rigour.md'), /ONE ruling dispatch on `ruling_model` \(allowed at `breach`/);
  });
  test('traceability is its own plan-checker dimension, run at every rigour', () => {
    const c = doc('agents/gsd-plan-checker.md');
    assert.match(c, /^## Dimension 16: Traceability/m);
    assert.match(c, /Dimensions 1-7, 12, 15 and 16 \(traceability\) only/);
    assert.doesNotMatch(c.slice(c.indexOf('## Dimension 13'), c.indexOf('## Dimension 14')), /Traceability/);
    assert.match(doc('get-shit-done/references/rigour.md'), /Dimensions 1-7, 12, 15, 16 \(traceability, every rigour\)/);
  });
});
