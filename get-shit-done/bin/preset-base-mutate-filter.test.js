'use strict';

// WP10: the test-name filter. {name} in a runner test_cmd (which carries its own `-t`) becomes the regex-escaped, shell-quoted title.
// Node and POSIX shell only.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MUTATE_DIR = path.join(__dirname, '..', 'presets', 'base', 'scripts', 'mutate');
const CLI = path.join(MUTATE_DIR, 'mutate.mjs');
const tmps = [];
afterEach(() => { while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true }); });
const tmpDir = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-wp10-'))); tmps.push(d); return d; };

const loadProcess = () => import(path.join(MUTATE_DIR, 'process.mjs'));
// printf prints each argument NUL-terminated: the second one is exactly what the shell handed the runner after -t.
const ARGS_CMD = "printf '%s\\0' -t {name}";
const argvOf = async (name, cwd) => {
  const { commandFor } = await loadProcess();
  const r = spawnSync('sh', ['-c', commandFor(ARGS_CMD, 'f.js', name)], { cwd, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.split('\0').slice(0, -1);
};

describe('WP10 name filter: commandFor', () => {
  test('regex metacharacters in the title are escaped and the title is anchored as a leaf', async () => {
    const [flag, pattern] = await argvOf('adds a.b*(c)[d]{1,2}^$|\\ \\x', tmpDir());
    assert.strictEqual(flag, '-t');
    assert.strictEqual(pattern, '(?:^| )adds a\\.b\\*\\(c\\)\\[d\\]\\{1,2\\}\\^\\$\\|\\\\ \\\\x$');
    const re = new RegExp(pattern);
    assert.ok(re.test('suite > adds a.b*(c)[d]{1,2}^$|\\ \\x'));
    assert.ok(!re.test('suite > adds a.b*(c)[d]{1,2}^$|\\ \\x more'));
  });

  test('a title with quotes, $(), backticks and a newline reaches the runner as one verbatim argument and runs nothing', async () => {
    const cwd = tmpDir();
    const names = ['it\'s "quoted"', '$(touch pwned1)', '`touch pwned2`', 'a; touch pwned3', 'two\nlines', "x' ; touch pwned4 ; '"];
    for (const name of names) {
      const [flag, pattern, ...rest] = await argvOf(name, cwd);
      assert.strictEqual(flag, '-t');
      assert.deepStrictEqual(rest, []);
      assert.ok(new RegExp(pattern).test(name), name);
      assert.ok(pattern.startsWith('(?:^| )') && pattern.endsWith('$'));
    }
    assert.deepStrictEqual(fs.readdirSync(cwd), []);
  });

  test('{name} without a title (baseline, self-test) expands to a match-everything regex', async () => {
    const { commandFor } = await loadProcess();
    assert.strictEqual(commandFor('node --test {file} --bail=1 -t {name}', 'a.js'), "node --test 'a.js' --bail=1 -t '.'");
  });
});

describe('WP10 name filter: a filter that matches no test is never a kill', () => {
  const SRC = 'exports.add = (a, b) => a + b;\n';
  const mutant = { id: 'M1', file: 'src/add.js', old: 'a + b', new: 'a - b', test: 'src/t.check.js', expect_failing_test: 'adds', runner: 'r' };
  const runOnce = (runner, checkSource, mutantOver = {}) => {
    const root = tmpDir();
    const git = (...args) => assert.strictEqual(spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' }).status, 0);
    git('init', '-q');
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, '.planning'));
    fs.writeFileSync(path.join(root, 'src', 'add.js'), SRC);
    fs.writeFileSync(path.join(root, 'src', 't.check.js'), checkSource);
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ stack: { mutation: { runners: [runner] } } }));
    git('add', 'src');
    git('commit', '-q', '-m', 'init');
    const mutants = path.join(root, '.mutants.json');
    const out = path.join(root, '.out.jsonl');
    fs.writeFileSync(mutants, JSON.stringify([{ ...mutant, ...mutantOver }]));
    const r = spawnSync(process.execPath, [CLI, '--mutants', mutants, '--out', out, '--root', root], { encoding: 'utf8', timeout: 120000, cwd: root });
    const records = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { r, records, source: fs.readFileSync(path.join(root, 'src', 'add.js'), 'utf8') };
  };
  const PASSED = "console.log('passed 1');\n";
  const failsWhenMutated = (message) => `if (require('./add.js').add(1, 2) !== 3) { console.error(${JSON.stringify(message)}); process.exit(1); }\n${PASSED}`;
  const FAILS_WITHOUT_TITLE = failsWhenMutated('AssertionError: boom');
  const FAILS_WITH_TITLE = failsWhenMutated('FAIL f.js > suite > adds\nAssertionError');
  const SELFTEST = {
    dir: 'src',
    ext: '.check.js',
    pass: PASSED,
    kill: "console.error('FAIL __mutate_selftest_kill__ AssertionError'); process.exit(1);\n",
    build: 'const = ;\n',
  };
  const filtered = { id: 'r', test_cmd: 'node {file} -t {name}', build_error_pattern: 'SyntaxError', pass_pattern: 'passed (\\d+)', selftest: SELFTEST };
  const MISS_DETAIL = /filter matched no test/;
  // npm echoes the command line (with the -t regex) before the runner's own output.
  const ECHO_NO_TEST = "console.log('> npm run test:file -- t.check.js -t (?:^| )adds$'); console.log('No test found'); process.exit(1);";
  const TITLE_FOR_BOTH_RUNS = 'FAIL f.js > suite > adds\nAssertionError';

  test('a failing run whose FAIL line does not end in the title is errored, not killed; naming it is a kill', () => {
    const miss = runOnce(filtered, FAILS_WITHOUT_TITLE);
    assert.deepStrictEqual(miss.records.map((x) => x.outcome), ['errored']);
    assert.match(miss.records[0].detail, MISS_DETAIL);
    assert.strictEqual(miss.source, SRC);
    const other = runOnce(filtered, failsWhenMutated('FAIL f.js > suite > adds more\nAssertionError'));
    assert.deepStrictEqual(other.records.map((x) => x.outcome), ['errored']);
    const hit = runOnce(filtered, FAILS_WITH_TITLE);
    assert.deepStrictEqual(hit.records.map((x) => [x.outcome, x.kill_confirmed]), [['killed', true]]);
  });

  test('only the first FAIL line is read: another test failing first and the title failing later is errored, not killed', () => {
    const r = runOnce(filtered, failsWhenMutated('FAIL f.js > suite > other\nFAIL f.js > suite > adds\nAssertionError'));
    assert.deepStrictEqual(r.records.map((x) => x.outcome), ['errored']);
    assert.match(r.records[0].detail, MISS_DETAIL);
  });

  test('H1: a run that echoes the command, prints "No test found" and exits 1 is errored, never killed (first run)', () => {
    const r = runOnce(filtered, `if (require('./add.js').add(1, 2) !== 3) { ${ECHO_NO_TEST} }\n${PASSED}`);
    assert.deepStrictEqual(r.records.map((x) => x.outcome), ['errored']);
    assert.match(r.records[0].detail, MISS_DETAIL);
    assert.strictEqual(r.source, SRC);
  });

  test('H1: the confirmation run is filtered and judged the same way: a first-run kill followed by "No test found" is not confirmed', () => {
    const second = `const fs = require('fs');\nif (require('./add.js').add(1, 2) !== 3) {\n  if (!fs.existsSync('.seen')) { fs.writeFileSync('.seen', '1'); console.error(${JSON.stringify(TITLE_FOR_BOTH_RUNS)}); process.exit(1); }\n  ${ECHO_NO_TEST}\n}\n${PASSED}`;
    const r = runOnce(filtered, second);
    assert.deepStrictEqual(r.records.map((x) => [x.outcome, x.kill_confirmed]), [['errored', false]]);
    assert.strictEqual(r.source, SRC);
  });

  test('a passing run with no passed-test count is errored, not survived', () => {
    const printsCountUnlessFiltered = "if (!process.argv.slice(2).some((a) => a.includes('adds'))) console.log('passed 1');\n";
    const r = runOnce(filtered, printsCountUnlessFiltered);
    assert.deepStrictEqual(r.records.map((x) => x.outcome), ['errored']);
    assert.match(r.records[0].detail, MISS_DETAIL);
  });

  test('a runner test_cmd without {name}, or with "{name}" inside double quotes, is refused at load (exit 2) before any mutation', () => {
    for (const test_cmd of ['node {file}', 'node {file} -t "{name}"']) {
      const r = runOnce({ ...filtered, test_cmd }, FAILS_WITH_TITLE);
      assert.strictEqual(r.r.status, 2, r.r.stderr);
      assert.match(r.r.stderr, /\{name\}/);
      assert.deepStrictEqual(r.records, []);
      assert.strictEqual(r.source, SRC);
    }
  });

  test('a title with a NUL byte or over 4096 characters is refused at load (exit 2) naming the mutant id, never thrown out of the spawn', () => {
    for (const expect_failing_test of ['ad\u0000ds', 'a'.repeat(4097)]) {
      const r = runOnce(filtered, FAILS_WITH_TITLE, { expect_failing_test });
      assert.strictEqual(r.r.status, 2, r.r.stderr);
      assert.match(r.r.stderr, /M1/);
      assert.match(r.r.stderr, /expect_failing_test/);
      assert.deepStrictEqual(r.records, []);
    }
  });
});
