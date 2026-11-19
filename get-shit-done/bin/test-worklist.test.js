const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const W = require('./test-worklist.js');
const TOOL = path.join(__dirname, 'gsd-tools.js');

const BODY_A = `const r = await call(input, 1); assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, items: [1, 2, 3] }); assert.ok(r.headers.etag);`;
const BODY_B = `const out = await run(arg, 2); assert.equal(out.code, 404); assert.deepEqual(out.data, { ok: false, items: [4, 5, 6] }); assert.ok(out.meta.tag);`;
const BODY_C = `for (const k of Object.keys(cfg)) { if (!k.startsWith('x')) continue; seen.add(k); } assert.strictEqual(seen.size, 3); assert.ok(seen.has('xa'));`;

describe('extractCases', () => {
  test('finds test, it, Deno.test and the object form with title, line and body tokens', () => {
    const src = [
      `test('first one', () => { ${BODY_A} });`,
      `it("second", async () => { ${BODY_B} });`,
      `Deno.test("third", () => { ${BODY_C} });`,
      `Deno.test({ name: "fourth", fn: () => { ${BODY_A} } });`,
      `test.skip('skipped', () => {});`,
    ].join('\n');
    const cases = W.extractCases(src);
    assert.deepStrictEqual(cases.map((c) => [c.title, c.line]), [['first one', 1], ['second', 2], ['third', 3], ['fourth', 4], ['skipped', 5]]);
    assert.ok(cases[0].tokens.length > 20);
  });

  test('strings, comments, template literals and regexes holding parens or the word test do not derail the scan', () => {
    const src = "// test('in comment', () => {})\n" +
      "test('a ) tricky ( title', () => { const s = `x ${ `(${1})` } )`; /* test('no') */ const re = /\\)+/g; assert.ok(s && re); });\n" +
      "test('after', () => { assert.ok(1); });";
    const cases = W.extractCases(src);
    assert.deepStrictEqual(cases.map((c) => c.title), ['a ) tricky ( title', 'after']);
    assert.strictEqual(cases[1].line, 3);
  });

  test('a member call named test (t.test) is not a case', () => {
    assert.deepStrictEqual(W.extractCases(`test('outer', async (t) => { await t.test('inner', () => {}); });`).map((c) => c.title), ['outer']);
  });
});

describe('duplicateCandidates', () => {
  const file = (name, src) => ({ file: name, in_diff: true, ext: path.extname(name), source: src });

  test('literal-only and identifier-only variants of one body are same_body, across and within files', () => {
    const f1 = file('a.test.js', `test('case one', () => { ${BODY_A} });\ntest('case two', () => { ${BODY_B} });`);
    const f2 = file('b.test.js', `test('other name', () => { ${BODY_A.replace('200', '201')} });`);
    const r = W.duplicateCandidates([f1, f2]);
    assert.strictEqual(r.unsupported.length, 0);
    const kinds = r.candidates.map((c) => `${c.a.file}:${c.a.line}~${c.b.file}:${c.b.line}:${c.kind}`);
    assert.ok(kinds.includes('a.test.js:1~a.test.js:2:same_body'), kinds.join(' '));
    assert.ok(kinds.includes('a.test.js:1~b.test.js:1:same_body'), kinds.join(' '));
    assert.deepStrictEqual(r.candidates.map((c) => c.id), r.candidates.map((_, i) => `D${i + 1}`));
  });

  test('structurally different bodies are not candidates', () => {
    const f = file('a.test.js', `test('x', () => { ${BODY_A} });\ntest('y', () => { ${BODY_C} });`);
    assert.strictEqual(W.duplicateCandidates([f]).candidates.length, 0);
  });

  test('tiny bodies are never candidates on body alone', () => {
    const f = file('a.test.js', `test('x', () => { assert.ok(a); });\ntest('y', () => { assert.ok(b); });`);
    assert.strictEqual(W.duplicateCandidates([f]).candidates.length, 0);
  });

  test('same normalized title with a similar body is a same_title candidate', () => {
    const body = BODY_A.replace('assert.ok(r.headers.etag);', 'assert.ok(r.headers.etag); assert.ok(r.id);');
    const f = file('a.test.js', `test('Returns the Item!', () => { ${BODY_A} });\ntest('returns the item', () => { ${body} });`);
    const c = W.duplicateCandidates([f]).candidates;
    assert.strictEqual(c.length, 1);
    assert.ok(['same_title', 'similar_body', 'same_body'].includes(c[0].kind));
  });

  test('a pair of two files that are both not in the diff is not reported', () => {
    const a = { ...file('a.test.js', `test('x', () => { ${BODY_A} });`), in_diff: false };
    const b = { ...file('b.test.js', `test('y', () => { ${BODY_A} });`), in_diff: false };
    assert.strictEqual(W.duplicateCandidates([a, b]).candidates.length, 0);
  });

  test('other languages: empty list and the extension named', () => {
    const r = W.duplicateCandidates([file('t_test.py', 'def test_a():\n  pass\n'), file('x.test.ts', `test('q', () => { ${BODY_A} });`)]);
    assert.deepStrictEqual(r.unsupported, ['.py']);
    assert.strictEqual(r.candidates.length, 0);
  });
});

function repo(workMsg = 'work') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-wl-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'old.test.js'), `require('node:test').test('old', () => {});\n`);
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'module.exports = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'tests', 'new.test.js'), `test('x', () => { ${BODY_A} });\ntest('y', () => { ${BODY_B} });\n`);
  fs.writeFileSync(path.join(root, 'tests', 'slow.test.js'), `setTimeout(() => {}, 300);\n`);
  fs.writeFileSync(path.join(root, 'tests', 'bad.test.js'), `process.exit(3);\n`);
  fs.writeFileSync(path.join(root, 'tests', 'leak.test.js'), `require('fs').appendFileSync(require('path').join(__dirname, '..', 'residue.txt'), 'row\\n');\n`);
  fs.writeFileSync(path.join(root, 'src', 'b.js'), 'module.exports = 2;\n');
  git('add', '-A');
  git('commit', '-q', '-m', workMsg);
  return { root, base };
}

describe('buildWorklist', () => {
  test('files: diff files plus siblings, flagged in_diff; non-test source is not listed; no-run omits timings and never runs commands', () => {
    const { root, base } = repo();
    const marker = path.join(root, 'ran.txt');
    const commands = { test_file: `node -e "require('fs').writeFileSync('${marker}','x')" {file}`, residue_check: `node -e "require('fs').writeFileSync('${marker}','x')"` };
    const w = W.buildWorklist({ cwd: root, base, commands, run: false });
    assert.deepStrictEqual(w.files.map((f) => [f.file, f.in_diff]), [['tests/bad.test.js', true], ['tests/leak.test.js', true], ['tests/new.test.js', true], ['tests/old.test.js', false], ['tests/slow.test.js', true]]);
    assert.strictEqual(w.timings, undefined);
    assert.strictEqual(fs.existsSync(marker), false);
    assert.strictEqual(w.residue, 'skipped (--no-run)');
    assert.strictEqual(w.duplicate_candidates.length, 1);
  });

  test('residue absent key is "not configured"', () => {
    const { root, base } = repo();
    assert.strictEqual(W.buildWorklist({ cwd: root, base, commands: {}, run: false }).residue, 'not configured');
  });

  test('timings: slowest first, a failing file is listed with its rc and no seconds; residue names the file that moved the count', () => {
    const { root, base } = repo();
    const commands = {
      test_file: 'node {file}',
      residue_check: `node -e "const f='${root}/residue.txt';console.log(require('fs').existsSync(f)?require('fs').readFileSync(f,'utf8').split('\\n').filter(Boolean).length:0)"`,
    };
    const w = W.buildWorklist({ cwd: root, base, commands, run: true });
    const byFile = Object.fromEntries(w.timings.map((t) => [t.file, t]));
    assert.strictEqual(byFile['tests/bad.test.js'].rc, 3);
    assert.strictEqual(byFile['tests/bad.test.js'].seconds, null);
    assert.strictEqual(byFile['tests/slow.test.js'].rc, 0);
    assert.ok(byFile['tests/slow.test.js'].seconds >= 0.25);
    const secs = w.timings.filter((t) => t.seconds !== null).map((t) => t.seconds);
    assert.deepStrictEqual(secs, [...secs].sort((x, y) => y - x));
    assert.strictEqual(w.timings[w.timings.length - 1].seconds, null);
    assert.deepStrictEqual(w.residue, { before: 0, after: 1, moved: [{ file: 'tests/leak.test.js', before: 0, after: 1 }] });
  });

  test('test_timing, when defined, supplies the seconds instead of per-file runs', () => {
    const { root, base } = repo();
    const commands = { test_file: 'exit 9', test_timing: `node -e "console.log(JSON.stringify([{file:'tests/new.test.js',seconds:4.5},{file:'tests/slow.test.js',seconds:9},{file:'other.js',seconds:99}]))"` };
    const w = W.buildWorklist({ cwd: root, base, commands, run: true });
    assert.deepStrictEqual(w.timings.map((t) => [t.file, t.seconds]), [['tests/slow.test.js', 9], ['tests/new.test.js', 4.5]]);
  });

  test('run with test_file none is an error', () => {
    const { root, base } = repo();
    assert.throws(() => W.buildWorklist({ cwd: root, base, commands: { test_file: 'none' }, run: true }), /test_file/);
  });

  test('directory mode: every test file under the directory is in_diff', () => {
    const { root } = repo();
    const w = W.buildWorklist({ cwd: root, dir: 'tests', commands: {}, run: false });
    assert.strictEqual(w.files.length, 5);
    assert.ok(w.files.every((f) => f.in_diff));
  });
});

describe('checkReturn', () => {
  const worklist = {
    files: [{ file: 'tests/a.test.js', in_diff: true }, { file: 'tests/b.test.js', in_diff: true }, { file: 'tests/c.test.js', in_diff: false }],
    timings: [{ file: 'tests/a.test.js', seconds: 3, rc: 0 }, { file: 'tests/b.test.js', seconds: 1, rc: 0 }],
    duplicate_candidates: [{ id: 'D1' }, { id: 'D2' }, { id: 'D3' }],
    residue: { before: 0, after: 2, moved: [{ file: 'tests/b.test.js', before: 0, after: 2 }] },
  };
  const good = [
    '| file | disposition | reason | before_s | after_s |',
    '|---|---|---|---|---|',
    '| tests/a.test.js | sped up | shared fixture | 3.0 | 1.2 |',
    '| tests/b.test.js | cleanup fixed | teardown deletes rows | 1.0 | 1.1 |',
    '',
    '| dup | disposition | reason |',
    '|---|---|---|',
    '| D1 | merged | table-driven in a.test.js |',
    '| D2 | kept | different layer |',
    '',
    '| residue | disposition | reason |',
    '|---|---|---|',
    '| tests/b.test.js | cleanup fixed | afterEach removes rows |',
  ].join('\n');

  test('a complete return passes', () => assert.deepStrictEqual(W.checkReturn(good, worklist), []));

  test('names every missing row', () => {
    const bad = good.split('\n').filter((l) => !/tests\/b.test.js \| cleanup fixed \| teardown|D2|afterEach/.test(l)).join('\n');
    const e = W.checkReturn(bad, worklist).join('\n');
    assert.match(e, /missing file row: tests\/b\.test\.js/);
    assert.match(e, /missing residue row: tests\/b\.test\.js/);
    assert.doesNotMatch(e, /D2|D3/, 'candidates are advisory: no row is demanded');
  });

  test('touched file needs numeric before/after; a kept file does not; reason is required; bad disposition is named', () => {
    const bad = good
      .replace('| 3.0 | 1.2 |', '| - | - |')
      .replace('| D1 | merged | table-driven in a.test.js |', '| D1 | maybe |  |');
    const e = W.checkReturn(bad, worklist).join('\n');
    assert.match(e, /tests\/a\.test\.js: touched file needs numeric before_s and after_s/);
    assert.match(e, /D1: disposition "maybe"/);
    assert.match(e, /D1: reason is empty/);
    const kept = good.replace('| sped up | shared fixture | 3.0 | 1.2 |', '| kept | already table-driven | - | - |');
    assert.deepStrictEqual(W.checkReturn(kept, worklist), []);
  });

  test('a worklist without timings does not demand seconds', () => {
    const noRun = { ...worklist, timings: undefined, residue: 'skipped (--no-run)' };
    const r = good.replace('| 3.0 | 1.2 |', '| - | - |').split('\n').filter((l) => !/afterEach/.test(l)).join('\n');
    assert.deepStrictEqual(W.checkReturn(r, noRun), []);
  });

  test('a row for an unknown file or id is named', () => {
    const e = W.checkReturn(good + '\n| tests/zzz.test.js | kept | x |', worklist).join('\n');
    assert.ok(e.length > 0);
    const e2 = W.checkReturn(good.replace('| D2 |', '| D9 |'), worklist).join('\n');
    assert.match(e2, /unknown duplicate id: D9/);
  });
});

describe('CLI', () => {
  test('test-worklist --phase on a tagged repo and verify steward-return exit codes', () => {
    const { root } = repo('feat(07-01): work');
    fs.mkdirSync(path.join(root, '.planning', 'phases', '07-demo'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ stack: { commands: { test_file: 'node {file}' } } }));
    fs.writeFileSync(path.join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n\n### Phase 7: Demo\n**Goal**: x\n');
    const run = (...a) => spawnSync('node', [TOOL, ...a, '--cwd', root], { encoding: 'utf8' });
    const wl = run('test-worklist', '--phase', '7', '--no-run');
    assert.strictEqual(wl.status, 0, wl.stderr);
    const out = JSON.parse(wl.stdout);
    assert.ok(Array.isArray(out.files));
    const ret = path.join(root, 'return.md');
    fs.writeFileSync(ret, '| file | disposition | reason | before_s | after_s |\n|---|---|---|---|---|\n');
    const bad = run('verify', 'steward-return', '--phase', '7', '--file', ret);
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stderr + bad.stdout, /missing file row/);
  });
});
