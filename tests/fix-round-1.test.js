'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeProject, gsd, git } = require('./helpers/roadmap-fixture.js');

const dirs = [];
const project = (phases = [{ n: '1', name: 'one' }]) => { const d = makeProject(phases, {}); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('commit', () => {
  test('H5: a repeat commit with untracked clutter elsewhere is exit 0 nothing_to_commit', () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.planning', 'a.md'), 'a');
    assert.notStrictEqual(gsd(dir, ['commit', 'first', '--files', '.planning/a.md']).out.trim(), 'nothing');
    fs.writeFileSync(path.join(dir, 'clutter.txt'), 'x');
    const again = gsd(dir, ['commit', 'again', '--files', '.planning/a.md']);
    assert.deepStrictEqual([again.rc, again.out.trim()], [0, 'nothing']);
  });
  test('H5: unrelated staged files are not committed under another path-scope', () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, 'other.txt'), 'x');
    git(dir, 'add', 'other.txt');
    const r = gsd(dir, ['commit', 'scoped', '--files', '.planning/ROADMAP.md']);
    assert.deepStrictEqual([r.rc, r.out.trim()], [0, 'nothing']);
  });
  test('L1: "-h" as a commit message and "--help" as a flag value are values, not help', () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.planning', 'a.md'), 'a');
    const r = gsd(dir, ['commit', '-h', '--files', '.planning/a.md']);
    assert.strictEqual(r.rc, 0);
    assert.strictEqual(git(dir, 'log', '-1', '--format=%s').trim(), '-h');
    const g = gsd(dir, ['owner-gate', 'request', '--kind', 'pr', '--summary', '--help']);
    assert.strictEqual(g.json.gate.summary, '--help');
  });
  test('L1: --help after the command still prints usage and does nothing', () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.planning', 'a.md'), 'a');
    const r = gsd(dir, ['commit', 'msg', '--files', '.planning/a.md', '--help']);
    assert.match(r.out, /Usage|usage/i);
    assert.strictEqual(git(dir, 'log', '--format=%s').includes('msg'), false);
  });
});

describe('config-set', () => {
  test('L2: models.top must be an alias', () => {
    const dir = project();
    assert.strictEqual(gsd(dir, ['config-set', 'models.top', 'claude-opus-4-1']).rc, 1);
    assert.strictEqual(gsd(dir, ['config-set', 'models.top', 'opus']).rc, 0);
    assert.strictEqual(gsd(dir, ['init', 'execute-roadmap']).rc, 0);
  });
});

describe('phase lookup is by exact number', () => {
  test('M9: phase 2 never resolves 2.1 or 20', () => {
    const dir = project([{ n: '2', name: 'two' }, { n: '2.1', name: 'hotfix' }, { n: '20', name: 'twenty' }]);
    for (const d of ['02.1-hotfix', '20-twenty']) { fs.mkdirSync(path.join(dir, '.planning', 'phases', d), { recursive: true }); fs.writeFileSync(path.join(dir, '.planning', 'phases', d, `${d.slice(0, d.indexOf('-'))}-01-PLAN.md`), '---\nphase: x\n---\n'); }
    const r = gsd(dir, ['init', 'plan-phase', '2']);
    assert.ok(!/02\.1-hotfix|20-twenty/.test(r.out), r.out);
    assert.strictEqual(gsd(dir, ['verify', 'phase-gate', '2']).json.type, 'phase_not_found');
    const hit = gsd(dir, ['init', 'plan-phase', '2.1']).json;
    assert.match(hit.phase_dir || hit.phase_directory || '', /02\.1-hotfix/);
  });
});
