'use strict';

// WP10: the opt-in test-name filter. {filter} in a runner test_cmd becomes `-t <regex-escaped, shell-quoted title>`.
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
const ARGS_CMD = "printf '%s\\0' {filter}";
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

  test('a runner without the placeholder runs unfiltered, and the placeholder without a title expands to nothing', async () => {
    const { commandFor } = await loadProcess();
    assert.strictEqual(commandFor('node --test {file}', 'a b.js', 'adds'), commandFor('node --test {file}', 'a b.js'));
    assert.strictEqual(commandFor('node --test {file} --bail=1 {filter}', 'a.js'), "node --test 'a.js' --bail=1 ");
  });
});

describe('WP10 name filter: a filter that matches no test is never a kill', () => {
  const SRC = 'exports.add = (a, b) => a + b;\n';
  const mutant = { id: 'M1', file: 'src/add.js', old: 'a + b', new: 'a - b', test: 'src/t.check.js', expect_failing_test: 'adds', runner: 'r' };
  const runOnce = (runner, checkSource) => {
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
    fs.writeFileSync(mutants, JSON.stringify([mutant]));
    const r = spawnSync(process.execPath, [CLI, '--mutants', mutants, '--out', out, '--root', root], { encoding: 'utf8', timeout: 120000, cwd: root });
    const records = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { r, records, source: fs.readFileSync(path.join(root, 'src', 'add.js'), 'utf8') };
  };
  const failsWhenMutated = (message) => `if (require('./add.js').add(1, 2) !== 3) { console.error(${JSON.stringify(message)}); process.exit(1); }\n`;
  const FAILS_WITHOUT_TITLE = failsWhenMutated('AssertionError: boom');
  const FAILS_WITH_TITLE = failsWhenMutated('FAIL suite > adds AssertionError');

  test('a failing run that never names the title is errored, not killed; naming it is a kill', () => {
    const filtered = { id: 'r', test_cmd: 'node {file} {filter}' };
    const miss = runOnce(filtered, FAILS_WITHOUT_TITLE);
    assert.deepStrictEqual(miss.records.map((x) => x.outcome), ['errored']);
    assert.match(miss.records[0].detail, /filter matched no test/);
    assert.strictEqual(miss.source, SRC);
    const hit = runOnce(filtered, FAILS_WITH_TITLE);
    assert.deepStrictEqual(hit.records.map((x) => [x.outcome, x.kill_confirmed]), [['killed', true]]);
  });

  test('a passing run with no passed-test count is errored, not survived', () => {
    const printsCountOnlyUnfiltered = "if (process.argv.length <= 2) console.log('passed 1');\n";
    const r = runOnce({ id: 'r', test_cmd: 'node {file} {filter}', pass_pattern: 'passed (\\d+)' }, printsCountOnlyUnfiltered);
    assert.deepStrictEqual(r.records.map((x) => x.outcome), ['errored']);
    assert.match(r.records[0].detail, /filter matched no test/);
  });

  test('an unfiltered runner keeps today\'s verdict: a failing run that names no title is still a kill', () => {
    const r = runOnce({ id: 'r', test_cmd: 'node {file}' }, FAILS_WITHOUT_TITLE);
    assert.deepStrictEqual(r.records.map((x) => x.outcome), ['killed']);
  });
});
