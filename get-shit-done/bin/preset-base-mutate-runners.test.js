'use strict';

// WP9: stack.mutation.runners[] (the only config path), the build error pattern refusal (exit 5), the refused old key,
// the profile shape check and the catalogue self-test. Node and POSIX shell only.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'presets', 'base', 'scripts', 'mutate', 'mutate.mjs');
const keys = require('./project-profile-keys.js');
const catalogue = require('../references/mutation-runners.json');

const tmps = [];
afterEach(() => { while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true }); });
const git = (root, ...args) => {
  const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
};

const SRC = 'exports.add = (a, b) => a + b;\n';
const CRASH_CHECK = "if (require('./add.js').add(1, 2) !== 3) { console.error('FAIL f.js > adds'); console.error('SyntaxError: boom'); process.exit(1); }\nconsole.log('passed 1');\n";
const KILL_CHECK = "if (require('./add.js').add(1, 2) !== 3) { console.error('FAIL f.js > adds'); console.error('AssertionError: wrong sum'); process.exit(1); }\nconsole.log('passed 1');\n";
const mutant = (id, extra = {}) => ({ id, file: 'src/add.js', old: 'a + b', new: 'a - b', test: 'src/kill.check.js', expect_failing_test: 'adds', ...extra });
const SELFTEST = {
  dir: 'src',
  ext: '.check.js',
  pass: "console.log('passed 1');\n",
  kill: "console.error('FAIL __mutate_selftest_kill__ AssertionError'); process.exit(1);\n",
  build: 'const = ;\n',
};
const runner = (extra = {}) => ({ id: 'crashy', test_cmd: 'node {file} -t {name}', build_error_pattern: 'SyntaxError', pass_pattern: 'passed (\\d+)', selftest: SELFTEST, ...extra });
const RUNNERS = [runner(), runner({ id: 'plain', build_error_pattern: 'SyntaxError|NeverPrinted' })];

function project(mutation) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-wp9-')));
  tmps.push(root);
  git(root, 'init', '-q');
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.planning'));
  fs.writeFileSync(path.join(root, 'src', 'add.js'), SRC);
  fs.writeFileSync(path.join(root, 'src', 'crash.check.js'), CRASH_CHECK);
  fs.writeFileSync(path.join(root, 'src', 'kill.check.js'), KILL_CHECK);
  fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ stack: { mutation } }));
  git(root, 'add', 'src');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
function run(root, list) {
  const mutants = path.join(root, '.mutants.json');
  const out = path.join(root, '.out.jsonl');
  fs.writeFileSync(mutants, JSON.stringify(list));
  const r = spawnSync(process.execPath, [CLI, '--mutants', mutants, '--out', out, '--root', root], { encoding: 'utf8', timeout: 120000, cwd: root });
  const records = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { code: r.status, output: r.stdout + r.stderr, records };
}
const source = (root) => fs.readFileSync(path.join(root, 'src', 'add.js'), 'utf8');

describe('WP9 mutation runners: the harness', () => {
  test('a run whose output matches the runner error pattern is refused with exit 5, counts no kill and leaves the source restored', () => {
    const root = project({ runners: RUNNERS });
    const r = run(root, [mutant('M-crash', { runner: 'crashy', test: 'src/crash.check.js' })]);
    assert.strictEqual(r.code, 5, r.output);
    assert.deepStrictEqual(r.records.map((x) => x.outcome), ['errored']);
    assert.ok(!r.records.some((x) => x.outcome === 'killed'));
    assert.strictEqual(source(root), SRC);
  });

  test('a runner pattern does not touch a kill whose output does not match it', () => {
    const root = project({ runners: RUNNERS });
    const r = run(root, [mutant('M-kill', { runner: 'crashy' })]);
    assert.strictEqual(r.code, 0, r.output);
    assert.strictEqual(r.records[0].outcome, 'killed');
  });

  test('an unknown runner id, a missing id among several runners, no runners and malformed runners[] exit 2 before any mutation', () => {
    const root = project({ runners: RUNNERS });
    assert.strictEqual(run(root, [mutant('M1', { runner: 'nope' })]).code, 2);
    assert.strictEqual(run(root, [mutant('M1')]).code, 2);
    assert.strictEqual(source(root), SRC);
    const none = run(project({}), [mutant('M1')]);
    assert.strictEqual(none.code, 2, none.output);
    assert.match(none.output, /stack\.mutation\.runners is required/);
    const { build_error_pattern: _p, ...noPattern } = runner();
    const { pass_pattern: _c, ...noCount } = runner();
    const { selftest: _s, ...noSelftest } = runner();
    for (const bad of [[], [{ id: 'a' }], [runner({ test_cmd: 'node x' })], [runner({ build_error_pattern: '(' })], [noPattern], [noCount], [noSelftest], [RUNNERS[1], RUNNERS[1]]]) {
      const r = run(project({ runners: bad }), [mutant('M1', { runner: 'a' })]);
      assert.strictEqual(r.code, 2, JSON.stringify(bad) + r.output);
    }
    const refused = run(project({ runners: [noPattern] }), [mutant('M1', { runner: 'crashy' })]);
    assert.match(refused.output, /build_error_pattern must be a non-empty string/);
  });

  test('the old stack.mutation.error_pattern key is refused with exit 2', () => {
    const root = project({ runners: RUNNERS, error_pattern: 'SyntaxError' });
    const r = run(root, [mutant('M1', { runner: 'plain' })]);
    assert.strictEqual(r.code, 2, r.output);
    assert.match(r.output, /stack\.mutation\.error_pattern is renamed/);
    assert.strictEqual(source(root), SRC);
  });
});

describe('WP9 mutation runners: the profile shape check and the doctor', () => {
  const problems = (mutation) => keys.NEW_SHAPE_CHECKS.find(([k]) => k === 'stack.mutation')[1]('stack.mutation', mutation);
  const keysOf = (mutation) => problems(mutation).map((p) => p.key);

  test('well-formed runners pass; runners[] that the mutation tool refuses, and the old key, are rejected with the key named', () => {
    assert.deepStrictEqual(problems({ runners: RUNNERS }), []);
    const { selftest: _s, ...noSelftest } = runner();
    const { build_error_pattern: _p, ...noPattern } = runner();
    const { pass_pattern: _c, ...noCount } = runner();
    for (const bad of [null, undefined, [], 'x', [{ test_cmd: 'x {file} -t {name}' }], [runner({ test_cmd: 'no placeholder' })], [runner({ build_error_pattern: '(' })], [runner({ lane: 'gpu' })], [noSelftest], [noPattern], [noCount], [RUNNERS[1], RUNNERS[1]]]) {
      assert.ok(keysOf({ runners: bad }).includes('stack.mutation.runners'), JSON.stringify(bad));
    }
    assert.ok(keysOf({ error_pattern: 'x' }).includes('stack.mutation.error_pattern'));
  });

  test('F3: a catalogued runner pattern must not match its kill output and must match its build failure', () => {
    const base = runner({ id: 'js-runner-a', test_cmd: 'npm run test:file -- {file} -t {name}' });
    const shipped = catalogue['js-runner-a'].build_error_pattern;
    assert.deepStrictEqual(problems({ runners: [{ ...base, build_error_pattern: shipped }] }), []);
    assert.ok(problems({ runners: [{ ...base, build_error_pattern: 'AssertionError' }] }).some((p) => /matches the normal kill output/.test(p.reason)));
    assert.ok(problems({ runners: [{ ...base, build_error_pattern: 'NeverPrinted' }] }).some((p) => /does not match the build failure/.test(p.reason)));
  });

  test('F3: every runner pattern is checked against every catalogue kill fixture; the build failure only for a known engine', () => {
    assert.ok(problems({ runners: [runner({ build_error_pattern: 'AssertionError' })] }).some((p) => /matches the normal kill output/.test(p.reason)), 'unknown engine, own pattern');
    assert.deepStrictEqual(problems({ runners: [runner({ build_error_pattern: 'ZZZ-never' })] }), [], 'unknown engine: no build_failure fixture to match');
  });

  test('an unreadable runner catalogue is a blocking problem, never a silent skip of the F3 fixture checks', () => {
    const script = "const M = require('module'); const load = M._load; M._load = function (request, ...rest) { if (request.endsWith('mutation-runners.json')) throw new Error('EACCES: permission denied'); return load.call(this, request, ...rest); }; const k = require(process.argv[1]); console.log(k.NEW_SHAPE_CHECKS.find(([n]) => n === 'stack.mutation')[1]('stack.mutation', { runners: [] }).map((p) => p.reason).join('|'));";
    const r = spawnSync(process.execPath, ['-e', script, path.join(__dirname, 'project-profile-keys.js')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /cannot load references\/mutation-runners\.json: EACCES: permission denied/);
  });

  test('without require(esm) the runners and affected shape checks are blocking problems, never a pass', () => {
    const script = "const k = require(process.argv[1]); const s = (key, v) => k.NEW_SHAPE_CHECKS.find(([n]) => n === key)[1](key, v).map((p) => p.reason).join('|'); console.log(s('stack.mutation', { runners: [] }) + '#' + s('stack.affected', { specs: {} }));";
    const r = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', script, path.join(__dirname, 'project-profile-keys.js')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const [runnersOut, affectedOut] = r.stdout.trim().split('#');
    assert.match(runnersOut, /needs Node >= 20\.19 or >= 22\.12/);
    assert.match(affectedOut, /needs Node >= 20\.19 or >= 22\.12/);
  });

});
