'use strict';

// WP9: stack.mutation.runners[], the build error pattern refusal (exit 5), the refused old key, the profile shape check.
// Node and POSIX shell only.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'presets', 'base', 'scripts', 'mutate', 'mutate.mjs');
const keys = require('./project-profile-keys.js');
const checks = require('./profile-doctor-checks.js');
const catalogue = require('../references/mutation-runners.json');

const tmps = [];
afterEach(() => { while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true }); });
const git = (root, ...args) => {
  const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
};

const SRC = 'exports.add = (a, b) => a + b;\n';
const CRASH_CHECK = "if (require('./add.js').add(1, 2) !== 3) { console.error('SyntaxError: boom'); process.exit(1); }\n";
const KILL_CHECK = "if (require('./add.js').add(1, 2) !== 3) { console.error('AssertionError: wrong sum'); process.exit(1); }\n";
const mutant = (id, extra = {}) => ({ id, file: 'src/add.js', old: 'a + b', new: 'a - b', test: 'src/kill.check.js', expect_failing_test: 'adds', ...extra });
const SELFTEST = {
  dir: 'src',
  ext: '.check.js',
  pass: "console.log('passed 1');\n",
  kill: "console.error('FAIL __mutate_selftest_kill__ AssertionError'); process.exit(1);\n",
  build: 'const = ;\n',
};

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
const RUNNERS = [
  { id: 'crashy', test_cmd: 'node {file}', build_error_pattern: 'SyntaxError' },
  { id: 'plain', test_cmd: 'node {file}' },
];
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

  test('F4: a runner with a selftest and no pattern cannot tell a crash from a kill: refused (exit 2), no mutant runs', () => {
    const root = project({ runners: [{ id: 'plain', test_cmd: 'node {file}', selftest: SELFTEST }] });
    const r = run(root, [mutant('M-kill', { runner: 'plain', test: 'src/crash.check.js' })]);
    assert.strictEqual(r.code, 2, r.output);
    assert.match(r.output, /harness fault: the classifier labels a known build failure as killed/);
    assert.deepStrictEqual(r.records, []);
    assert.strictEqual(source(root), SRC);
  });

  test('a runner with neither pattern nor selftest is unguarded: the same crash is a kill and the run prints the notice', () => {
    const root = project({ runners: RUNNERS });
    const r = run(root, [mutant('M-kill', { runner: 'plain', test: 'src/crash.check.js' })]);
    assert.strictEqual(r.code, 0, r.output);
    assert.deepStrictEqual(r.records.map((x) => [x.outcome, x.kill_confirmed]), [['killed', true]]);
    assert.match(r.output, /no error pattern/);
  });

  test('a runner pattern does not touch a kill whose output does not match it', () => {
    const root = project({ runners: RUNNERS });
    const r = run(root, [mutant('M-kill', { runner: 'crashy' })]);
    assert.strictEqual(r.code, 0, r.output);
    assert.strictEqual(r.records[0].outcome, 'killed');
  });

  test('an unknown runner id, a missing id among several runners and malformed runners[] exit 2 before any mutation', () => {
    const root = project({ runners: RUNNERS });
    assert.strictEqual(run(root, [mutant('M1', { runner: 'nope' })]).code, 2);
    assert.strictEqual(run(root, [mutant('M1')]).code, 2);
    assert.strictEqual(source(root), SRC);
    for (const bad of [[], [{ id: 'a' }], [{ id: 'a', test_cmd: 'node x' }], [{ id: 'a', test_cmd: 'node {file}', build_error_pattern: '(' }], [RUNNERS[1], RUNNERS[1]]]) {
      const r = run(project({ runners: bad }), [mutant('M1', { runner: 'a' })]);
      assert.strictEqual(r.code, 2, JSON.stringify(bad) + r.output);
    }
  });

  test('the old stack.mutation.error_pattern key is refused with exit 2', () => {
    const root = project({ runners: RUNNERS, error_pattern: 'SyntaxError' });
    const r = run(root, [mutant('M1', { runner: 'plain' })]);
    assert.strictEqual(r.code, 2, r.output);
    assert.match(r.output, /renamed: use stack\.mutation\.build_error_pattern/);
    assert.strictEqual(source(root), SRC);
  });
});

describe('WP9 mutation runners: the profile shape check and the doctor', () => {
  const problems = (mutation) => keys.NEW_SHAPE_CHECKS.find(([k]) => k === 'stack.mutation')[1]('stack.mutation', mutation);
  const keysOf = (mutation) => problems(mutation).map((p) => p.key);

  test('well-formed runners pass; malformed runners[] and the old key are rejected with the key named', () => {
    assert.deepStrictEqual(problems({ runners: RUNNERS, build_error_pattern: 'SyntaxError' }), []);
    assert.ok(keysOf({ runners: [] }).includes('stack.mutation.runners'));
    assert.ok(keysOf({ runners: 'x' }).includes('stack.mutation.runners'));
    assert.ok(keysOf({ runners: [{ test_cmd: 'x {file}' }] }).includes('stack.mutation.runners[0].id'));
    assert.ok(keysOf({ runners: [{ id: 'a', test_cmd: 'no placeholder' }] }).includes('stack.mutation.runners[0].test_cmd'));
    assert.ok(keysOf({ runners: [{ id: 'a', test_cmd: 'x {file}', build_error_pattern: '(' }] }).includes('stack.mutation.runners[0].build_error_pattern'));
    assert.ok(keysOf({ runners: [RUNNERS[1], RUNNERS[1]] }).includes('stack.mutation.runners'), 'duplicate ids');
    assert.ok(keysOf({ error_pattern: 'x' }).includes('stack.mutation.error_pattern'));
  });

  test('F3: a catalogued runner pattern must not match its kill output and must match its build failure', () => {
    const base = { id: 'js-runner-a', test_cmd: 'npm run test:file -- {file}' };
    const shipped = catalogue['js-runner-a'].build_error_pattern;
    assert.deepStrictEqual(problems({ runners: [{ ...base, build_error_pattern: shipped }] }), []);
    assert.ok(problems({ runners: [{ ...base, build_error_pattern: 'AssertionError' }] }).some((p) => /matches the normal kill output/.test(p.reason)));
    assert.ok(problems({ runners: [{ ...base, build_error_pattern: 'NeverPrinted' }] }).some((p) => /does not match the build failure/.test(p.reason)));
    assert.ok(problems({ build_error_pattern: 'FAIL', runners: [base] }).some((p) => /matches the normal kill output/.test(p.reason)), 'the project pattern is the effective one');
  });

  test('F3: the project pattern and every runner pattern are checked against every catalogue kill fixture; the build failure only for a known engine', () => {
    const custom = { id: 'custom', test_cmd: 'x {file}' };
    assert.ok(problems({ build_error_pattern: 'FAIL' }).some((p) => /matches the normal kill output/.test(p.reason)), 'project pattern, no runners');
    assert.ok(problems({ runners: [{ ...custom, build_error_pattern: 'AssertionError' }] }).some((p) => /matches the normal kill output/.test(p.reason)), 'unknown engine, own pattern');
    assert.deepStrictEqual(problems({ runners: [{ ...custom, build_error_pattern: 'ZZZ-never' }] }), [], 'unknown engine: no build_failure fixture to match');
    assert.deepStrictEqual(problems({ build_error_pattern: 'ZZZ-never' }), []);
  });

  test('runners: null is absent; selftest, pass_pattern and lane are shape-checked', () => {
    assert.deepStrictEqual(problems({ runners: null }), []);
    const base = { id: 'a', test_cmd: 'x {file}' };
    assert.ok(keysOf({ runners: [{ ...base, pass_pattern: '(' }] }).includes('stack.mutation.runners[0].pass_pattern'));
    assert.ok(keysOf({ runners: [{ ...base, lane: 'gpu' }] }).includes('stack.mutation.runners[0].lane'));
    assert.ok(keysOf({ runners: [{ ...base, selftest: { dir: 'src' } }] }).includes('stack.mutation.runners[0].selftest'));
    assert.deepStrictEqual(problems({ runners: [{ ...base, lane: 'db', pass_pattern: 'passed (\\d+)', selftest: SELFTEST }] }), []);
  });

  test('the shipped catalogue states the source of every fixture', () => {
    for (const entry of Object.values(catalogue)) assert.ok(['kill', 'build_failure'].every((k) => typeof entry.source[k] === 'string' && entry.source[k] !== ''));
    assert.match(catalogue['js-runner-a'].source.build_failure, /hand-written/);
  });

  test('the doctor constant is true and the old key is a blocking finding', () => {
    assert.strictEqual(checks.MUTATION_REFUSES_ERROR_PATTERN, true);
    assert.strictEqual(checks.migrationFindings({ mutation: { error_pattern: 'x' } }).filter(checks.isBlockingFinding).length, 1);
  });
});
