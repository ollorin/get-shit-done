'use strict';
// review-gate.js: the findings table is the record (open count computed from rows); each gate is shown failing on a bad fixture.
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rg = require('../get-shit-done/bin/review-gate.js');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
const ledger = new Map([['D-12', 'decision'], ['D-13', 'assumption'], ['A-5', 'assumption']]);
const sections = { 406: '#### Phase 406: next\n**Success Criteria**\n1. Closes F-7 and IR-2.', 407: '#### Phase 407: other\n#### F-7 heading only\nNothing here.' };
const phaseSection = (p) => sections[p] || null;

function errorsFor(rows, { frontmatter = 'format: v2\npasses: 1', header = '| id | sev | state | owner |\n|---|---|---|---|\n', ...opts } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rgf-'));
  dirs.push(d);
  fs.writeFileSync(path.join(d, '01-REVIEW.md'), `---\n${frontmatter}\n---\n# R\n\n${header}${rows}`);
  return rg.reviewErrors(d, ['01-REVIEW.md'], ['src/a.js'], { phaseNumber: '01', ledger, phaseSection, ...opts });
}

describe('findings table: the open count is computed from rows', () => {
  test('a typed open_critical_high: 0 cannot hide an open HIGH row', () => {
    const e = errorsFor('| F-1 | HIGH | open | |\n', { frontmatter: 'format: v2\npasses: 1\nopen_critical_high: 0' });
    assert.strictEqual(e.length, 1);
    assert.match(e[0], /CRITICAL\/HIGH[^\n]*F-1/);
  });
  test('no findings table is an error; the header alone (zero findings) passes', () => {
    assert.match(errorsFor('', { header: 'no table here\n' })[0], /no findings table/);
    assert.deepStrictEqual(errorsFor(''), []);
  });
  test('closed rows pass in any severity', () => {
    assert.deepStrictEqual(errorsFor('| F-1 | CRITICAL | closed | |\n| F-2 | low | Closed | |\n'), []);
  });
  test('CRITICAL/HIGH needs a D- ruling that is a decision row; A- ids and phase owners do not rule', () => {
    assert.deepStrictEqual(errorsFor('| F-1 | HIGH | open | D-12 |\n'), []);
    assert.strictEqual(errorsFor('| F-1 | HIGH | open | D-99 |\n').length, 1);
    assert.strictEqual(errorsFor('| F-1 | HIGH | open | D-13 |\n').length, 1);
    assert.strictEqual(errorsFor('| F-1 | CRITICAL | open | A-5 |\n').length, 1);
    assert.strictEqual(errorsFor('| F-7 | HIGH | open | 406 |\n').length, 1);
  });
  test('MED/LOW non-closed needs an owner: ledger D-/A- id, or a phase whose ROADMAP section names the finding id', () => {
    assert.deepStrictEqual(errorsFor('| F-2 | MED | open | A-5 |\n| F-3 | LOW | partial | D-12 |\n'), []);
    assert.deepStrictEqual(errorsFor('| F-7 | MED | open | 406 |\n'), []);
    assert.strictEqual(errorsFor('| F-2 | MED | open | |\n').length, 1);
    assert.strictEqual(errorsFor('| F-2 | MED | open | A-77 |\n').length, 1);
    assert.strictEqual(errorsFor('| F-7 | MED | open | 407 |\n').length, 1, 'a heading naming the id does not count');
    assert.strictEqual(errorsFor('| F-7 | MED | open | 999 |\n').length, 1, 'phase not in ROADMAP');
    assert.strictEqual(errorsFor('| IR-20 | MED | open | 406 |\n').length, 1, 'IR-2 in the section must not satisfy IR-20');
    assert.deepStrictEqual(errorsFor('| IR-2 | MED | open | 406 |\n'), []);
  });
  test('refuted needs a D- ruling; unknown severity and a row with no id are errors', () => {
    assert.strictEqual(errorsFor('| F-4 | MED | refuted | A-5 |\n').length, 1);
    assert.deepStrictEqual(errorsFor('| F-4 | MED | refuted | D-12 |\n'), []);
    assert.match(errorsFor('| F-5 | URGENT | open | D-12 |\n')[0], /unknown severity[^\n]*F-5/);
    assert.match(errorsFor('| | LOW | closed | |\n')[0], /no id/);
  });
  test('passes still required; risk add-ons still need pass 2', () => {
    assert.match(errorsFor('', { frontmatter: 'format: v2\nreviewer_role: final' })[0], /passes: 1 or 2/);
    assert.match(errorsFor('', { risk: true })[0], /needs pass 2/);
    assert.deepStrictEqual(errorsFor('', { risk: true, frontmatter: 'format: v2\npasses: 2' }), []);
  });
});

describe('grandfathering: a record without `format: v2` is judged by the legacy rule', () => {
  test('legacy frontmatter count passes with an open HIGH row in an unmarked table; v2 refuses the same body', () => {
    const legacy = 'passes: 1\nopen_critical_high: 0';
    assert.deepStrictEqual(errorsFor('| F-1 | HIGH | open | |\n', { frontmatter: legacy }), []);
    assert.strictEqual(errorsFor('| F-1 | HIGH | open | |\n', { frontmatter: `format: v2\n${legacy}` }).length, 1);
  });
  test('legacy rules still bite: an open count without ruled_by, a missing count, a count differing from VERIFICATION', () => {
    assert.match(errorsFor('', { frontmatter: 'passes: 1\nopen_critical_high: 2' })[0], /no ruling id/);
    assert.match(errorsFor('', { frontmatter: 'passes: 1' })[0], /open_critical_high/);
    assert.match(errorsFor('', { frontmatter: 'passes: 1\nopen_critical_high: 0', verificationOpen: 1 })[0], /differs from VERIFICATION/);
    assert.deepStrictEqual(errorsFor('', { frontmatter: 'passes: 1\nopen_critical_high: 1\nruled_by: [D-12]' }), []);
  });
});

describe('head stamps: freshness is git diff <head>..HEAD on the proven paths', () => {
  const { execFileSync } = require('child_process');
  const execGit = (cwd, args) => {
    try { return { exitCode: 0, stdout: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim() }; } catch (e) { return { exitCode: e.status || 1, stdout: String(e.stdout || '') }; }
  };
  const git = (d, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, stdio: 'pipe' });
  const put = (d, rel, text) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
  const commit = (d, msg) => { git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', msg); };
  const repo = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rgh-'));
    dirs.push(d);
    git(d, 'init', '-q');
    put(d, 'src/a.js', '1'); put(d, 'src/b.js', '1'); put(d, 'lint/x.js', '1'); put(d, '.planning/phases/01-p/01-REVIEW.md', '---\nformat: v2\n---\n# R\n');
    commit(d, 'feat(01-01): work');
    return { d, pd: path.join(d, '.planning/phases/01-p'), gates: path.join(d, '.planning/phases/01-p/captures/gates.txt') };
  };
  const stale = (d, pd, touched = ['src/a.js']) => rg.staleRecordErrors(execGit, d, pd, '01', ['01-REVIEW.md'], touched);

  test('a stamped record is stale only when a proven path changed after its head; re-stamping clears it', () => {
    const { d, pd } = repo();
    assert.ok(rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')).head);
    commit(d, 'docs(01-01): stamp');
    assert.deepStrictEqual(stale(d, pd), []);
    put(d, 'src/b.js', '2'); commit(d, 'fix(01-review): other file');
    assert.deepStrictEqual(stale(d, pd), [], 'a path the phase did not touch');
    put(d, 'src/a.js', '2'); commit(d, 'fix(01-review): proven file');
    assert.match(stale(d, pd)[0], /01-REVIEW\.md is stale: src\/a\.js/);
    assert.ok(rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')).head);
    assert.deepStrictEqual(stale(d, pd), []);
  });
  test('the stamp is not file time: touching the record does not refresh a stale one', () => {
    const { d, pd } = repo();
    rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')); commit(d, 'docs: stamp');
    put(d, 'src/a.js', '2'); commit(d, 'fix(01-review): f');
    fs.appendFileSync(path.join(pd, '01-REVIEW.md'), 'more\n'); commit(d, 'docs: append');
    assert.strictEqual(stale(d, pd).length, 1);
  });
  test('stamp refuses while tracked source is dirty and a bad head is an error', () => {
    const { d, pd } = repo();
    put(d, 'src/a.js', 'dirty');
    assert.match(rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')).error, /uncommitted source changes \(src\/a\.js\)/);
    git(d, 'checkout', '-q', 'src/a.js');
    put(d, '.planning/phases/01-p/01-REVIEW.md', '---\nhead: deadbeefdeadbeef\n---\n');
    assert.match(stale(d, pd)[0], /not a commit/);
  });
  test('gates.txt: each section is stale only for the paths it declares; the newest section per gate counts; unstamped is not checked', () => {
    const { d, pd, gates } = repo();
    rg.stampHead(execGit, d, gates, { gate: 'unit', paths: 'src' });
    fs.appendFileSync(gates, 'unit output rc=0\n');
    rg.stampHead(execGit, d, gates, { gate: 'lint', paths: 'lint' });
    fs.appendFileSync(gates, 'lint output rc=0\n');
    commit(d, 'docs: gates');
    const only = (rec) => rg.staleRecordErrors(execGit, d, pd, '01', [], ['src/a.js']).filter((e) => rec.test(e));
    assert.deepStrictEqual(only(/./), []);
    put(d, 'src/a.js', '2'); commit(d, 'fix(01-review): f');
    assert.strictEqual(only(/section unit is stale/).length, 1);
    assert.deepStrictEqual(only(/section lint/), [], 'lint section does not exercise src');
    rg.stampHead(execGit, d, gates, { gate: 'unit', paths: 'src' });
    commit(d, 'docs: rerun');
    assert.deepStrictEqual(only(/./), [], 'a newer unit section supersedes the stale one');
    fs.writeFileSync(gates, 'old unstamped capture\n');
    assert.deepStrictEqual(only(/./), []);
  });
  test('an unstamped record keeps the file-time rule', () => {
    const { d, pd } = repo();
    put(d, 'src/a.js', '2');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: d });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'fix(01-review): f'], { cwd: d, env: { ...process.env, GIT_COMMITTER_DATE: '2099-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2099-01-01T00:00:00Z' } });
    assert.match(stale(d, pd)[0], /older than the phase's last source commit/);
  });
});
