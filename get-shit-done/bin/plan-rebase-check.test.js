'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./plan-overlap.js');

let dir;
let base;
const git = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' }).stdout.trim();
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const plan = (rel, files, sha = base) => write(rel, `---\nphase: 2\nplan: 1\nfiles_modified: [${files.join(', ')}]\n${sha ? `plan_base_sha: ${sha}\n` : ''}---\nbody\n`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-rebase-'));
  git('init', '-q');
  write('src/a.js', '1');
  write('src/b.js', '1');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  base = git('rev-parse', 'HEAD');
  write('src/a.js', '2');
  git('commit', '-q', '-am', 'phase N changes a');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('plan rebase-check', () => {
  test('a plan whose files_modified intersects the diff since plan_base_sha is flagged', () => {
    plan('p.md', ['src/a.js']);
    assert.deepStrictEqual(P.cmdRebaseCheck(dir, 'p.md'), { clean: false, conflicts: ['src/a.js'] });
  });
  test('a directory entry covering a changed file is flagged', () => {
    plan('p.md', ['src']);
    assert.deepStrictEqual(P.cmdRebaseCheck(dir, 'p.md').conflicts, ['src/a.js']);
  });
  test('a disjoint plan passes', () => {
    plan('p.md', ['src/b.js']);
    assert.deepStrictEqual(P.cmdRebaseCheck(dir, 'p.md'), { clean: true, conflicts: [] });
  });
  test('a missing or unknown plan_base_sha is an error, never clean', () => {
    plan('p.md', ['src/b.js'], '');
    assert.match(P.cmdRebaseCheck(dir, 'p.md').error, /plan_base_sha/);
    plan('p.md', ['src/b.js'], 'deadbeef');
    assert.match(P.cmdRebaseCheck(dir, 'p.md').error, /plan_base_sha/);
  });
  test('gsd-tools routes plan rebase-check and exits 1 when flagged', () => {
    plan('p.md', ['src/a.js']);
    const r = spawnSync('node', [path.join(__dirname, 'gsd-tools.js'), 'plan', 'rebase-check', 'p.md'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
  });
});
