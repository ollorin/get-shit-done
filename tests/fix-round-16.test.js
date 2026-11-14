'use strict';
// One matcher for "commits of phase N": the gate, has_ui, phase_base and freshness agree (subjects only, HEAD only, whole-token phase).
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeProject, gsd, git } = require('./helpers/roadmap-fixture.js');
const reviewGate = require('../get-shit-done/bin/review-gate.js');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const exec = (cwd, args) => { try { return { exitCode: 0, stdout: execFileSync('git', args, { cwd, encoding: 'utf8' }).trim() }; } catch (e) { return { exitCode: 1, stdout: '' }; } };
const commit = (dir, file, msg) => { write(dir, file, `x${Math.random()}`); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD').trim(); };
const head = (dir) => git(dir, 'rev-parse', 'HEAD').trim();
function phaseOne() {
  const dir = makeProject([{ n: '1', name: 'one' }]);
  dirs.push(dir);
  const pd = '.planning/phases/01-p1';
  write(dir, `${pd}/01-01-PLAN.md`, '---\nphase: "01"\nplan: "01"\n---\n# Plan\n');
  write(dir, `${pd}/01-01-SUMMARY.md`, '# Summary\n\n## Self-Check: PASSED\n');
  write(dir, `${pd}/01-VERIFICATION.md`, '---\nstatus: passed\n---\n# V\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'docs(01): plan');
  return dir;
}
const gate = (dir) => { const g = gsd(dir, ['verify', 'phase-gate', '1']).json; return { g, text: JSON.stringify(g) }; };

describe('a phase commit without the accepted subject tag fails loudly', () => {
  test('gate names the required form; phase_base errors instead of returning HEAD', () => {
    const dir = phaseOne();
    commit(dir, 'src/a.ts', 'feat: 01-01 add a');
    assert.match(gate(dir).text, /\(1-01\)|\(01-01\)/, 'gate must name the required (N-NN) form');
    assert.ok(/not tagged|required form/.test(gate(dir).text), gate(dir).text);
    const r = gsd(dir, ['init', 'execute-phase', '1']);
    assert.notStrictEqual(r.rc, 0, `init returned phase_base ${r.json && r.json.phase_base}`);
  });
});

describe('the gate and phase_base use the same matcher', () => {
  test('a body mention on another file does not make an API phase a UI phase', () => {
    const dir = phaseOne();
    commit(dir, 'src/a.ts', 'feat(01-01): api');
    commit(dir, 'src/App.tsx', 'chore(web): tweak\n\nfollow-up to 01-01');
    assert.strictEqual(gate(dir).g.has_ui, false);
  });
  test('a commit only on another branch does not satisfy the gate', () => {
    const dir = phaseOne();
    git(dir, 'checkout', '-q', '-b', 'abandoned');
    commit(dir, 'src/a.ts', 'feat(01-01): lost');
    git(dir, 'checkout', '-q', '-');
    assert.match(gate(dir).text, /no commits/);
  });
  test('an unpadded tag (1-01) is seen by the gate and by phase_base', () => {
    const dir = phaseOne();
    const before = head(dir);
    commit(dir, 'src/a.ts', 'feat(1-01): a');
    assert.doesNotMatch(gate(dir).text, /no commits|not tagged/);
    assert.strictEqual(gsd(dir, ['init', 'execute-phase', '1']).json.phase_base, before);
  });
  test('fix(N-review-r2) counts as a phase commit; decimals match exactly', () => {
    const dir = phaseOne();
    commit(dir, 'src/a.ts', 'fix(1-review-r2): f');
    commit(dir, 'src/b.ts', 'feat(1.5-01): decimal');
    commit(dir, 'src/c.ts', 'feat(11-01): other');
    assert.deepStrictEqual(reviewGate.phaseCommits(exec, dir, '1').map((c) => c.subject), ['fix(1-review-r2): f']);
    assert.deepStrictEqual(reviewGate.phaseCommits(exec, dir, '1.5').map((c) => c.subject), ['feat(1.5-01): decimal']);
    assert.deepStrictEqual(reviewGate.phaseCommits(exec, dir, '01', '01'), []);
  });
});

describe('phase_base in a shallow clone', () => {
  test('errors instead of returning the empty tree', () => {
    const src = phaseOne();
    commit(src, 'src/a.ts', 'feat(01-01): a');
    commit(src, 'src/b.ts', 'feat(01-01): b');
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-shallow-'));
    dirs.push(clone);
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${src}`, clone + '/c']);
    const r = gsd(clone + '/c', ['init', 'execute-phase', '1']);
    assert.notStrictEqual(r.rc, 0, `phase_base ${r.json && r.json.phase_base}`);
  });
});
