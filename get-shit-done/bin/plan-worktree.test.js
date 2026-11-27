'use strict';
// Walks the two-executor procedure of workflows/execute-phase.md in a temp repo: overlap check, two worktrees, a commit in each, two merges, removal.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL = path.join(__dirname, 'gsd-tools.js');
let repo;
const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' });
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
const plan = (rel, n, file) => write(rel, `---\nphase: 1\nplan: ${n}\ndepends_on: []\nfiles_modified: [${file}]\n---\nbody\n`);

beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-wt-')); git('init', '-q', '-b', 'phase'); plan('a.md', 1, 'src/a.js'); plan('b.md', 2, 'src/b.js'); git('add', '.'); git('commit', '-q', '-m', 'base'); });
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

test('two disjoint plans: worktrees, a commit in each, two --no-ff merges, removal', () => {
  assert.strictEqual(spawnSync('node', [TOOL, 'plan', 'overlap', 'a.md', 'b.md'], { cwd: repo }).status, 0);
  for (const id of ['1-01', '1-02']) assert.strictEqual(git('worktree', 'add', '-b', `wt/1-${id}`, `.tmp/wt-1-${id}`, 'HEAD').status, 0);
  assert.notStrictEqual(git('worktree', 'add', '-b', 'wt/1-1-01', '.tmp/wt-again', 'HEAD').status, 0, 'git refuses a second branch of the same name');
  for (const [id, file] of [['1-01', 'src/a.js'], ['1-02', 'src/b.js']]) {
    const wt = path.join(repo, '.tmp', `wt-1-${id}`);
    fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
    fs.writeFileSync(path.join(wt, file), id);
    assert.strictEqual(spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', file], { cwd: wt }).status, 0);
    assert.strictEqual(spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', id, '--', file], { cwd: wt }).status, 0);
  }
  for (const id of ['1-01', '1-02']) assert.strictEqual(git('merge', '--no-ff', '-m', `merge ${id}`, `wt/1-${id}`).status, 0);
  assert.strictEqual(fs.readFileSync(path.join(repo, 'src/a.js'), 'utf8'), '1-01');
  assert.strictEqual(fs.readFileSync(path.join(repo, 'src/b.js'), 'utf8'), '1-02');
  for (const id of ['1-01', '1-02']) {
    assert.strictEqual(git('worktree', 'remove', `.tmp/wt-1-${id}`).status, 0);
    assert.strictEqual(git('branch', '-d', `wt/1-${id}`).status, 0);
  }
  assert.strictEqual(git('worktree', 'list').stdout.trim().split('\n').length, 1);
});

test('overlapping plans never reach the worktree step', () => {
  plan('c.md', 3, 'src/a.js');
  assert.strictEqual(spawnSync('node', [TOOL, 'plan', 'overlap', 'a.md', 'c.md'], { cwd: repo }).status, 1);
});
