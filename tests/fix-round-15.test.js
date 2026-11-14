'use strict';
// Defects from a real host run: phase_base / stale-record commit matching, ui_qa on a no-UI phase, phase complete vs requirement status.
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeProject, gsd, git, writeEvidence, completePhaseLikeWorkflow } = require('./helpers/roadmap-fixture.js');
const reviewGate = require('../get-shit-done/bin/review-gate.js');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const project = (phases, cfg) => { const d = makeProject(phases, cfg); dirs.push(d); return d; };
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const commit = (dir, msg, date) => {
  write(dir, `src/${Math.random().toString(36).slice(2)}.js`, 'x');
  git(dir, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir, env: { ...process.env, ...(date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {}) } });
  return git(dir, 'rev-parse', 'HEAD').trim();
};
const exec = (cwd, args) => { try { return { exitCode: 0, stdout: execFileSync('git', args, { cwd, encoding: 'utf8' }).trim() }; } catch (e) { return { exitCode: 1, stdout: '' }; } };

describe('phase commits are matched by exact subject tag on HEAD only', () => {
  function decoys() {
    const dir = project([{ n: '365', name: 'big' }]);
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    git(dir, 'checkout', '-q', '-b', 'other');
    commit(dir, 'fix(other): thing', '2024-01-01T00:00:00Z');
    commit(dir, 'feat(365-01): on another branch', '2024-01-02T00:00:00Z');
    git(dir, 'checkout', '-q', '-');
    git(dir, 'checkout', '-q', '-b', 'main2');
    const prose = commit(dir, 'fix(player-web): hold result\n\nthe handler at lines 365-367 had no minimum', '2023-01-01T00:00:00Z');
    commit(dir, 'feat(365.1-01): decimal phase', '2023-02-01T00:00:00Z');
    commit(dir, 'feat(36-01): phase 36', '2023-03-01T00:00:00Z');
    return { dir, base, prose };
  }
  test('phase_base ignores other branches, body prose, decimal and shorter phases', () => {
    const { dir, prose } = decoys();
    const first = commit(dir, 'feat(365-01): real work', '2022-01-01T00:00:00Z');
    commit(dir, 'fix(365-review): f', '2022-01-02T00:00:00Z');
    assert.notStrictEqual(prose, '');
    const parent = git(dir, 'rev-parse', `${first}^`).trim();
    assert.strictEqual(gsd(dir, ['init', 'execute-phase', '365']).json.phase_base, parent);
  });
  test('before the phase has a commit, phase_base is HEAD', () => {
    const { dir } = decoys();
    assert.strictEqual(gsd(dir, ['init', 'execute-phase', '365']).json.phase_base, git(dir, 'rev-parse', 'HEAD').trim());
  });
  test('the stale-record source time counts only exact tagged commits on HEAD', () => {
    const { dir } = decoys();
    commit(dir, 'feat(365-01): real work', '2022-01-01T00:00:00Z');
    assert.strictEqual(reviewGate.lastSourceCommitTs(exec, dir, '365'), Date.parse('2022-01-01T00:00:00Z') / 1000);
  });
});

function executedPhase(file) {
  const dir = project([{ n: '1', name: 'one' }]);
  const pd = '.planning/phases/01-p1';
  write(dir, `${pd}/01-01-PLAN.md`, '---\nphase: "01"\nplan: "01"\n---\n# Plan\n');
  write(dir, `${pd}/01-01-SUMMARY.md`, '# Summary\n\n## Self-Check: PASSED\n');
  write(dir, `${pd}/01-VERIFICATION.md`, '---\nstatus: passed\n---\n# V\n');
  write(dir, file, 'export {};\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat(01-01): work');
  return dir;
}

describe('ui_qa is never required for a phase without UI', () => {
  test('API-only phase in legacy mode: has_ui false, ui_qa not required, no missing_charlotte_qa', () => {
    const dir = executedPhase('apps/api/functions/x/index.ts');
    const g = gsd(dir, ['verify', 'phase-gate', '1']).json;
    assert.strictEqual(g.has_ui, false);
    assert.strictEqual(g.ui_qa_mode, 'legacy');
    assert.strictEqual(g.has_api, true);
    assert.strictEqual(g.ui_qa_required, false, JSON.stringify(g.failures));
    assert.ok(!g.failures.includes('missing_charlotte_qa'));
  });
  test('a UI phase still requires it', () => {
    const dir = executedPhase('src/App.tsx');
    const g = gsd(dir, ['verify', 'phase-gate', '1']).json;
    assert.strictEqual(g.has_ui, true);
    assert.ok(g.failures.includes('missing_charlotte_qa'));
  });
});

describe('phase complete leaves requirement status alone', () => {
  test('a requirement the review fix set to Pending stays Pending', () => {
    const dir = project([{ n: '1', name: 'one' }]);
    write(dir, '.planning/ROADMAP.md', '# Roadmap\n\n- [ ] **Phase 1: one** - x\n\n### Phase 1: one\n**Goal:** g\n**Requirements:** MILE-13\n');
    const reqs = '# R\n\n- [ ] **MILE-13** partly delivered\n\n| ID | Phase | Status |\n|---|---|---|\n| MILE-13 | Phase 1 | Pending |\n';
    write(dir, '.planning/REQUIREMENTS.md', reqs);
    writeEvidence(dir, 1);
    const r = completePhaseLikeWorkflow(dir, 1);
    assert.strictEqual(r.rc, 0, r.out + r.err);
    assert.strictEqual(fs.readFileSync(path.join(dir, '.planning/REQUIREMENTS.md'), 'utf8'), reqs);
  });
});
