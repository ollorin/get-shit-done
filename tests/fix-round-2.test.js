'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeProject, gsd, git, phaseDir, events } = require('./helpers/roadmap-fixture.js');

const dirs = [];
const project = (phases = [{ n: '1', name: 'one' }], config = {}) => { const d = makeProject(phases, config); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

describe('N10 commit --files is path-limited', () => {
  test('an unrelated staged file stays staged and uncommitted', () => {
    const dir = project();
    write(dir, 'other.txt', 'x');
    git(dir, 'add', 'other.txt');
    write(dir, '.planning/a.md', 'a');
    const r = gsd(dir, ['commit', 'scoped', '--files', '.planning/a.md']);
    assert.strictEqual(r.rc, 0);
    const files = git(dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n');
    assert.deepStrictEqual(files, ['.planning/a.md']);
    assert.strictEqual(git(dir, 'diff', '--cached', '--name-only').trim(), 'other.txt');
  });
});
