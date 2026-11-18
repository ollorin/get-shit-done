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
  test('closed rows pass in any severity when each names its proof: a commit sha or a captures/ path in the fix cell', () => {
    const header = '| id | sev | state | owner | fix |\n|---|---|---|---|---|\n';
    assert.deepStrictEqual(errorsFor('| F-1 | CRITICAL | closed | | d4453df |\n| F-2 | low | Closed | | captures/red-sc1.txt |\n', { header }), []);
    assert.deepStrictEqual(errorsFor('| F-1 | LOW | closed 62fa1b9 | | |\n'), []);
  });
  test('a closed row with no evidence cell, prose only, or no fix column is an error', () => {
    const header = '| id | sev | state | owner | fix |\n|---|---|---|---|---|\n';
    assert.match(errorsFor('| F-1 | HIGH | closed | | fixed in the last commit |\n', { header })[0], /closed findings without an evidence cell[^\n]*F-1/);
    assert.match(errorsFor('| F-1 | HIGH | closed | | decade |\n', { header })[0], /F-1/, 'a word of hex letters is not a sha');
    assert.match(errorsFor('| F-2 | LOW | closed | |\n')[0], /F-2/);
  });
  test('a ROADMAP line inside a code fence does not name a finding, and an escaped bar stays in its cell', () => {
    const fenced = { 408: '#### Phase 408: x\n**Success Criteria**\n```\n1. Closes F-9\n```\n' };
    assert.strictEqual(errorsFor('| F-9 | MED | open | 408 |\n', { phaseSection: (p) => fenced[p] || null }).length, 1);
    assert.deepStrictEqual(errorsFor('| F-7 | MED | open | 406 |\n', { header: '| id | sev | state | owner | what |\n|---|---|---|---|---|\n' }), []);
    assert.strictEqual(errorsFor('| F-1 | HIGH | open \\| partial | D-99 |\n').length, 1, 'the bar did not shift owner into another column');
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
    assert.match(stale(d, pd)[0], /src\/b\.js/, 'b.js is in the phase commits: its change is stale');
    rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')); commit(d, 'docs(01-01): restamp');
    put(d, 'other/z.js', '2'); commit(d, 'chore: untagged unrelated file');
    assert.deepStrictEqual(stale(d, pd), [], 'a path no phase commit touched');
    put(d, 'src/a.js', '2'); commit(d, 'fix(01-review): proven file');
    assert.match(stale(d, pd)[0], /01-REVIEW\.md is stale: src\/a\.js/);
    assert.ok(rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')).head);
    assert.deepStrictEqual(stale(d, pd), []);
  });
  test('an untagged commit on a path a plan declares in files_modified stales a stamped record; an undeclared path still does not', () => {
    const { d, pd } = repo();
    rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')); commit(d, 'docs(01-01): stamp');
    put(d, 'lib/c.js', '2'); commit(d, 'tweak without a phase tag');
    const withDecl = (declared) => rg.staleRecordErrors(execGit, d, pd, '01', ['01-REVIEW.md'], ['src/a.js'], declared);
    assert.deepStrictEqual(withDecl([]), [], 'undeclared: not proven (grandfathered behaviour)');
    assert.match(withDecl(['lib/'])[0], /01-REVIEW\.md is stale: lib\/c\.js/);
    assert.match(withDecl(['./lib/c.js'])[0], /lib\/c\.js/);
    assert.deepStrictEqual(withDecl(['.planning/x.md', 'docs/y.md']), [], '.planning/ and docs/ never stale a record');
  });
  test('declared-path proof ignores commits tagged for another phase and merge commits; untagged and own-phase commits still count', () => {
    const { d, pd } = repo();
    const decl = ['lib/'];
    const run = () => rg.staleRecordErrors(execGit, d, pd, '01', ['01-REVIEW.md'], ['src/a.js'], decl);
    rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')); commit(d, 'docs(01-01): stamp');
    put(d, 'lib/reg.json', '2'); commit(d, 'feat(02-03): other phase edits the shared registry');
    put(d, 'lib/reg.json', '3'); commit(d, 'fix(405.2-review): dotted other phase');
    assert.deepStrictEqual(run(), [], 'commits tagged for other phases do not stale this record');
    const main = git(d, 'rev-parse', '--abbrev-ref', 'HEAD').toString().trim();
    git(d, 'checkout', '-q', '-b', 'side'); put(d, 'lib/m.json', '1'); commit(d, 'feat(02-04): side work');
    git(d, 'checkout', '-q', main); put(d, 'other/q.js', '9'); commit(d, 'docs: unrelated main work');
    git(d, 'merge', '--no-ff', '-q', '-m', 'Merge branch side', 'side');
    assert.deepStrictEqual(run(), [], 'a merge commit, and the other-phase commit it brings in, do not stale it');
    put(d, 'lib/c.js', '1'); commit(d, 'tweak without a phase tag');
    assert.match(run()[0], /lib\/c\.js/, 'an untagged commit on a declared path still stales');
    rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')); commit(d, 'docs(01-01): restamp');
    put(d, 'lib/d.js', '1'); commit(d, 'fix(01-review): own phase');
    assert.match(run()[0], /lib\/d\.js/, 'a commit tagged for this phase still stales');
    rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')); commit(d, 'docs(01-01): restamp 2');
    put(d, 'lib-x/e.js', '1'); commit(d, 'untagged sibling dir');
    assert.deepStrictEqual(run(), [], 'directory-prefix boundary: lib/ does not match lib-x/');
  });
  test('a file first added by a fix(N-review) commit makes the record stale though no plan commit touched it', () => {
    const { d, pd } = repo();
    rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')); commit(d, 'docs(01-01): stamp');
    put(d, 'src/new.js', '1'); commit(d, 'fix(01-review): new file');
    assert.match(stale(d, pd)[0], /01-REVIEW\.md is stale: src\/new\.js/);
    rg.stampHead(execGit, d, path.join(pd, '01-REVIEW.md')); commit(d, 'docs(01-01): restamp');
    assert.deepStrictEqual(stale(d, pd), []);
    put(d, 'src/new.js', '2'); commit(d, 'fix(01-review): edit new file');
    assert.match(stale(d, pd)[0], /src\/new\.js/);
  });
  test('a renamed proven file is drift under both names; a stamp refuses untracked source; a CRLF record keeps one frontmatter block', () => {
    const { d, pd } = repo();
    const rec = path.join(pd, '01-REVIEW.md');
    rg.stampHead(execGit, d, rec); commit(d, 'docs(01-01): stamp');
    git(d, 'mv', 'src/a.js', 'src/a2.js'); commit(d, 'fix(01-review): rename');
    assert.match(stale(d, pd)[0], /src\/a\.js/);
    put(d, 'src/untracked.js', '1');
    assert.match(rg.stampHead(execGit, d, rec).error, /uncommitted source changes \(src\/untracked\.js\)/);
    fs.rmSync(path.join(d, 'src/untracked.js'));
    fs.writeFileSync(rec, '---\r\nformat: v2\r\n---\r\n# R\r\n');
    commit(d, 'docs(01-01): crlf');
    assert.ok(rg.stampHead(execGit, d, rec).head);
    const out = fs.readFileSync(rec, 'utf8');
    assert.strictEqual((out.match(/^---/gm) || []).length, 2);
    assert.match(out, /^---\r\nformat: v2\r\nhead: [0-9a-f]{40}\r\n---\r\n/);
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
  test('a "# gate=" line that does not parse is an error, not a silently unchecked section', () => {
    const { d, pd, gates } = repo();
    fs.mkdirSync(path.dirname(gates), { recursive: true });
    fs.writeFileSync(gates, '# gate=unit head=ABCDEF1234567 paths=src\nout\n# gate=lint head=abcdef1 paths=a, b\n');
    const errs = rg.staleRecordErrors(execGit, d, pd, '01', [], ['src/a.js']);
    assert.match(errs.join('\n'), /2 "# gate=" line\(s\) that do not parse/);
    fs.writeFileSync(gates, '# gate=unit head=abcdef1\r\nout\r\n');
    assert.ok(!/do not parse/.test(rg.staleRecordErrors(execGit, d, pd, '01', [], ['src/a.js']).join('\n')), 'a CRLF stamp line parses');
    fs.writeFileSync(gates, 'old unstamped capture\n');
    assert.deepStrictEqual(rg.staleRecordErrors(execGit, d, pd, '01', [], ['src/a.js']), []);
  });
  test('an unstamped record keeps the file-time rule', () => {
    const { d, pd } = repo();
    put(d, 'src/a.js', '2');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: d });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'fix(01-review): f'], { cwd: d, env: { ...process.env, GIT_COMMITTER_DATE: '2099-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2099-01-01T00:00:00Z' } });
    assert.match(stale(d, pd)[0], /older than the phase's last source commit/);
  });
});
