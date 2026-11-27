'use strict';
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./plan-overlap.js');

const TOOL = path.join(__dirname, 'gsd-tools.js');
let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const plan = (rel, { n = 1, files = [], deps = [] }) => write(rel, `---\nphase: 1\nplan: ${n}\ndepends_on: [${deps.join(', ')}]\nfiles_modified: [${files.join(', ')}]\n---\nbody\n`);
const run = (args) => spawnSync('node', [TOOL, ...args], { cwd: dir, encoding: 'utf8' });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-overlap-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('plan overlap', () => {
  const reasons = (a, b) => { plan('a.md', { n: 1, ...a }); plan('b.md', { n: 2, ...b }); return P.cmdOverlap(dir, 'a.md', 'b.md'); };
  test('disjoint files pass', () => assert.deepStrictEqual(reasons({ files: ['src/a.js'] }, { files: ['src/b.js', 'docs/x.md'] }), { disjoint: true, reasons: [] }));
  test('a shared file', () => assert.match(reasons({ files: ['src/a.js'] }, { files: ['src/a.js'] }).reasons[0], /shared file src\/a\.js/));
  test('a directory prefix covers a file, at a path boundary only', () => {
    assert.match(reasons({ files: ['src/lib/'] }, { files: ['src/lib/x.js'] }).reasons[0], /directory prefix src\/lib covers src\/lib\/x\.js/);
    assert.strictEqual(reasons({ files: ['src/lib'] }, { files: ['src/library/x.js'] }).disjoint, true);
  });
  test('two migrations', () => assert.deepStrictEqual(reasons({ files: ['db/migrations/1_a.sql'] }, { files: ['db/migrations/2_b.sql'] }).reasons, ['both plans add migrations']));
  test('two UI specs', () => assert.deepStrictEqual(reasons({ files: ['tests/a.spec.ts'] }, { files: ['e2e/b.ts'] }).reasons, ['both plans touch UI specs']));
  test('a dependency, either direction, with or without leading zeros', () => {
    assert.deepStrictEqual(reasons({ files: ['a.js'] }, { files: ['b.js'], deps: ['"1-01"'] }).reasons, ['one plan depends on the other']);
    assert.strictEqual(reasons({ files: ['a.js'], deps: ['"1-02"'] }, { files: ['b.js'] }).disjoint, false);
  });
  describe('verdicts that must not say disjoint', () => {
    const raw = (rel, n, filesLine) => write(rel, `---\nphase: 1\nplan: ${n}\ndepends_on: []\n${filesLine}\n---\nbody\n`);
    const pair = (a, b) => { raw('a.md', 1, `files_modified: [${a}]`); raw('b.md', 2, `files_modified: [${b}]`); return P.cmdOverlap(dir, 'a.md', 'b.md'); };
    test('a glob is refused, not compared with a file', () => assert.match(pair('src/*.js', 'src/a.js').error, /glob/));
    test('an absolute path equals its repo-relative form', () => assert.match(pair(`${dir}/src/a.js`, 'src/a.js').reasons[0], /shared file src\/a\.js/));
    test('paths compare in lower case', () => assert.strictEqual(pair('Src/A.js', 'src/a.js').disjoint, false));
    test('src/../src/a.js is src/a.js', () => assert.strictEqual(pair('src/../src/a.js', 'src/a.js').disjoint, false));
    test('a backslash path equals the slash path', () => assert.strictEqual(pair('"src\\\\a.js"', 'src/a.js').disjoint, false));
    test('package.json and package-lock.json always overlap', () => assert.match(pair('package.json', 'package-lock.json').reasons[0], /shared files/));
    test('STATE.md, ROADMAP.md and config.json under .planning always overlap', () => {
      assert.strictEqual(pair('.planning/STATE.md', 'x/a.js').disjoint, true);
      assert.strictEqual(pair('.planning/STATE.md', '.planning/ROADMAP.md').disjoint, false);
      assert.strictEqual(pair('.planning/REQUIREMENTS.md', '.planning/config.json').disjoint, false);
      assert.strictEqual(pair('.github/workflows/ci.yml', 'yarn.lock').disjoint, false);
    });
    test('a comma string, a nested map and an empty list are refused', () => {
      raw('b.md', 2, 'files_modified: [src/b.js]');
      raw('a.md', 1, 'files_modified: src/a.js, src/c.js');
      assert.match(P.cmdOverlap(dir, 'a.md', 'b.md').error, /flat list/);
      raw('a.md', 1, 'files_modified:\n  create:\n    - src/a.js');
      assert.match(P.cmdOverlap(dir, 'a.md', 'b.md').error, /flat list/);
      raw('a.md', 1, 'files_modified: []');
      assert.match(P.cmdOverlap(dir, 'a.md', 'b.md').error, /empty/);
      raw('a.md', 1, 'depends_on: []');
      assert.match(P.cmdOverlap(dir, 'a.md', 'b.md').error, /empty/);
    });
    test('two real dispatch begin --plan calls on a plan without files_modified are refused', () => {
      raw('a.md', 1, 'files_modified: [src/a.js]'); raw('b.md', 2, 'depends_on: []');
      const begin = (id, p) => run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', id, '--plan', p]);
      assert.strictEqual(begin('a', 'a.md').status, 0);
      const second = begin('b', 'b.md');
      assert.strictEqual(second.status, 1);
      assert.match(second.stdout + second.stderr, /files_modified/);
    });
  });
  test('CLI exits 1 with the reasons on overlap, 0 when disjoint', () => {
    plan('a.md', { n: 1, files: ['x.js'] }); plan('b.md', { n: 2, files: ['x.js'] }); plan('c.md', { n: 3, files: ['y.js'] });
    const bad = run(['plan', 'overlap', 'a.md', 'b.md']);
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stdout, /shared file x\.js/);
    assert.strictEqual(run(['plan', 'overlap', 'a.md', 'c.md']).status, 0);
  });
});

describe('claims check', () => {
  const claims = '## 2 - Other (CLAIMED 2026-01-01)\n\n| File | Plan | Note |\n|---|---|---|\n| `src/held/` | `2-01` | x |\n\n## 3 - Soon (PLANNED 2026-01-01)\n\n| `src/soon.js` | `3-01` | x |\n\n## 1 - Mine (CLAIMED 2026-01-01)\n\n| `src/mine.js` | `1-01` | x |\n';
  test('a CLAIMED row of another lane blocks; PLANNED rows and the own lane do not', () => {
    write('.tmp/phase-file-claims.md', claims);
    plan('p.md', { files: ['src/held/x.js', 'src/soon.js', 'src/mine.js', 'src/free.js'] });
    const r = P.cmdClaimsCheck(dir, 'p.md', '1', undefined);
    assert.deepStrictEqual(r.conflicts.map((c) => [c.file, c.lane]), [['src/held/x.js', '2 - Other']]);
    assert.strictEqual(run(['claims', 'check', 'p.md', '--lane', '1']).status, 1);
  });
  test('no claims file means clear', () => {
    plan('p.md', { files: ['src/a.js'] });
    assert.strictEqual(run(['claims', 'check', 'p.md']).status, 0);
  });
});

describe('per-plan task checkpoint', () => {
  const ck = '.planning/phases/01-x/TASK-CHECKPOINT';
  test('a per-plan file wins; the phase-scoped file is the fallback; an unrelated name never falls back', () => {
    write(`${ck}.json`, '{}');
    assert.strictEqual(P.resolveTaskCheckpoint(path.join(dir, `${ck}-1-02.json`), 1), path.join(dir, `${ck}.json`));
    write(`${ck}-1-02.json`, '{}');
    assert.strictEqual(P.resolveTaskCheckpoint(path.join(dir, `${ck}-1-02.json`), 1), path.join(dir, `${ck}-1-02.json`));
    assert.strictEqual(P.resolveTaskCheckpoint(path.join(dir, 'other.json'), 1), path.join(dir, 'other.json'));
  });
  test('the phase-scoped file is the fallback for one open executor lease only, not for two', () => {
    write(`${ck}.json`, '{}');
    const want = path.join(dir, `${ck}-1-02.json`);
    assert.strictEqual(P.resolveTaskCheckpoint(want, 1), path.join(dir, `${ck}.json`));
    assert.strictEqual(P.resolveTaskCheckpoint(want, 2), want);
  });
  test('resilience check-staleness does not read the phase-scoped file while two executors are open', () => {
    plan('a.md', { n: 1, files: ['a.js'] }); plan('b.md', { n: 2, files: ['b.js'] });
    write(`${ck}.json`, '{}');
    const begin = (id, p) => run(['dispatch', 'begin', '--phase', '1', '--role', 'executor', '--id', id, '--plan', p]);
    assert.strictEqual(begin('a', 'a.md').status, 0);
    assert.strictEqual(JSON.parse(run(['resilience', 'check-staleness', `${ck}-1-02.json`]).stdout).file_exists, true);
    assert.strictEqual(begin('b', 'b.md').status, 0);
    assert.strictEqual(JSON.parse(run(['resilience', 'check-staleness', `${ck}-1-02.json`]).stdout).file_exists, false);
  });
  test('resilience check-staleness reads the per-plan file, and the legacy one when absent', () => {
    write(`${ck}.json`, '{}');
    assert.strictEqual(JSON.parse(run(['resilience', 'check-staleness', `${ck}-1-02.json`]).stdout).file_exists, true);
    fs.rmSync(path.join(dir, `${ck}.json`));
    assert.strictEqual(JSON.parse(run(['resilience', 'check-staleness', `${ck}-1-02.json`]).stdout).file_exists, false);
  });
});
