'use strict';

// WP9 review: the run-start self-test (F4), the baseline count (F5), the errored breaker (F6), the required
// expect_failing_test (F9), the db-lane lock refusal and the build-error exit on a second run.
// Node and POSIX shell only.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MUTATE = path.join(__dirname, '..', 'presets', 'base', 'scripts', 'mutate');
const CLI = path.join(MUTATE, 'mutate.mjs');
const load = (name) => import(path.join(MUTATE, name));

const tmps = [];
afterEach(() => { while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true }); });
const git = (root, ...args) => {
  const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
};

const SRC = 'exports.add = (a, b) => a + b;\n';
const KILL_CHECK = "if (require('./add.js').add(1, 2) !== 3) { console.error('FAIL f.js > adds'); console.error('AssertionError: wrong sum'); process.exit(1); }\nconsole.log('passed 1');\n";
const FAULT_CHECK = "if (require('./add.js').add(1, 2) !== 3) process.exit(127);\nconsole.log('passed 1');\n";
const FLIP_CHECK = [
  "const fs = require('fs'); const path = require('path');",
  "if (require('./add.js').add(1, 2) === 3) { console.log('passed 1'); process.exit(0); }",
  "const marker = path.join(__dirname, '..', '.marker');",
  "if (fs.existsSync(marker)) { console.error('FAIL f.js > adds'); console.error('SyntaxError: boom'); process.exit(1); }",
  "fs.writeFileSync(marker, '1'); console.error('FAIL f.js > adds'); console.error('AssertionError: wrong sum'); process.exit(1);",
  '',
].join('\n');
const SELFTEST = {
  dir: 'src',
  ext: '.check.js',
  pass: "console.log('passed 1');\n",
  kill: "console.error('FAIL __mutate_selftest_kill__ AssertionError'); process.exit(1);\n",
  build: 'const = ;\n',
};
const mutant = (id, extra = {}) => ({ id, file: 'src/add.js', old: 'a + b', new: 'a - b', test: 'src/kill.check.js', expect_failing_test: 'adds', ...extra });

function project(mutation) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-wp9h-')));
  tmps.push(root);
  git(root, 'init', '-q');
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.planning'));
  fs.writeFileSync(path.join(root, 'src', 'add.js'), SRC);
  fs.writeFileSync(path.join(root, 'src', 'kill.check.js'), KILL_CHECK);
  fs.writeFileSync(path.join(root, 'src', 'fault.check.js'), FAULT_CHECK);
  fs.writeFileSync(path.join(root, 'src', 'flip.check.js'), FLIP_CHECK);
  fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ stack: { mutation } }));
  git(root, 'add', 'src');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
function run(root, list, { args = [], env = {} } = {}) {
  const mutants = path.join(root, '.mutants.json');
  const out = path.join(root, '.out.jsonl');
  fs.writeFileSync(mutants, JSON.stringify(list));
  const { STACK_LOCK_HELD: _held, ...base } = process.env;
  const r = spawnSync(process.execPath, [CLI, '--mutants', mutants, '--out', out, '--root', root, ...args], { encoding: 'utf8', timeout: 120000, cwd: root, env: { ...base, ...env } });
  const records = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const summaryFile = `${out}.run.json`;
  const summary = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null;
  return { code: r.status, output: r.stdout + r.stderr, records, summary };
}
const source = (root) => fs.readFileSync(path.join(root, 'src', 'add.js'), 'utf8');
const guarded = (extra = {}) => ({ id: 'guarded', test_cmd: 'node {file} -t {name}', build_error_pattern: 'SyntaxError', pass_pattern: 'passed (\\d+)', selftest: SELFTEST, ...extra });

describe('F4: the run-start self-test (selftest.mjs)', () => {
  const stub = (verdicts) => async (root, testFile) => {
    const kind = /__mutate_selftest_(pass|kill|build)__/.exec(testFile)[1];
    assert.ok(fs.existsSync(path.join(root, testFile)), 'the self-test file exists while it runs');
    return verdicts[kind];
  };
  const GOOD = {
    pass: { outcome: 'survived', output: 'passed 2', buildError: false },
    kill: { outcome: 'killed', output: 'FAIL __mutate_selftest_kill__', buildError: false },
    build: { outcome: 'errored', output: 'SyntaxError', buildError: true },
  };
  const config = { selftest: SELFTEST, passPattern: 'passed (\\d+)' };
  const check = async (verdicts, cfg = config) => {
    const { selfTestError } = await load('selftest.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-wp9st-'));
    tmps.push(root);
    fs.mkdirSync(path.join(root, 'src'));
    const problem = await selfTestError(stub(verdicts), root, 1000, cfg);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, 'src')), [], 'the self-test files are removed');
    return problem;
  };

  test('a harness that classifies the three canaries right passes', async () => {
    assert.strictEqual(await check(GOOD), null);
  });

  test('a known kill classified errored is a harness fault naming the label (stub runTest, F7b)', async () => {
    const problem = await check({ ...GOOD, kill: { outcome: 'errored', output: '', buildError: false } });
    assert.match(problem, /harness fault: the classifier labels a known kill as errored/);
  });

  test('a crash that never ran tests is not a kill: no failing-test evidence in the output', async () => {
    const problem = await check({ ...GOOD, kill: { outcome: 'killed', output: 'segfault', buildError: false } });
    assert.match(problem, /known kill/);
  });

  test('a build failure the runner cannot tell from a kill, and a pass with no test count, are refused', async () => {
    assert.match(await check({ ...GOOD, build: { outcome: 'killed', output: 'SyntaxError', buildError: false } }), /known build failure as killed/);
    assert.match(await check({ ...GOOD, pass: { outcome: 'survived', output: 'passed 0', buildError: false } }), /known passing test/);
    assert.match(await check({ ...GOOD, pass: { outcome: 'errored', output: '', buildError: false } }), /known passing test as errored/);
  });
});

describe('F4: the self-test in the CLI', () => {
  test('a guarded runner passes it, runs the mutant, records self_test and leaves no self-test file', () => {
    const root = project({ runners: [guarded()] });
    const r = run(root, [mutant('M1')]);
    assert.strictEqual(r.code, 0, r.output);
    assert.strictEqual(r.summary.self_test, 'passed');
    assert.deepStrictEqual(r.records.map((x) => x.outcome), ['killed']);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, 'src')).filter((f) => f.includes('selftest')), []);
  });

  test('a runner whose build pattern does not match its build failure is refused (exit 2) before any mutant: its crash would count as a kill', () => {
    const root = project({ runners: [guarded({ build_error_pattern: 'NeverPrinted' })] });
    const r = run(root, [mutant('M1')]);
    assert.strictEqual(r.code, 2, r.output);
    assert.match(r.output, /known build failure as killed/);
    assert.deepStrictEqual(r.records, []);
    assert.strictEqual(r.summary.self_test, 'failed');
    assert.strictEqual(source(root), SRC);
  });

  test('--dry-run skips the self-test', () => {
    const root = project({ runners: [guarded({ build_error_pattern: 'NeverPrinted' })] });
    assert.strictEqual(run(root, [mutant('M1')], { args: ['--dry-run'] }).code, 0);
  });
});

describe('F5: the baseline must count', () => {
  test('a green baseline that shows no passed-test count is red', async () => {
    const { baselineError } = await load('guards.mjs');
    const ran = (output) => async () => ({ outcome: 'survived', output, durationMs: 1 });
    assert.match(await baselineError(ran('passed 0'), 'before', '/r', ['t'], 1, { passPattern: 'passed (\\d+)' }), /ran no tests/);
    assert.match(await baselineError(ran('nothing'), 'before', '/r', ['t'], 1, { passPattern: 'passed (\\d+)' }), /ran no tests/);
    assert.strictEqual(await baselineError(ran('passed 3'), 'before', '/r', ['t'], 1, { passPattern: 'passed (\\d+)' }), null);
  });
});

describe('F6: the errored breaker', () => {
  test('3 errored of 4 stops the run, restores, exits 5 and records harness_fault', () => {
    const root = project({ runners: [guarded({ id: 'plain' })] });
    const fault = (id, n) => mutant(id, { new: `a * ${n}`, test: 'src/fault.check.js' });
    const r = run(root, [mutant('M1'), fault('E1', 5), fault('E2', 7), fault('E3', 9), mutant('M5', { new: 'a / b' })]);
    assert.strictEqual(r.code, 5, r.output);
    assert.deepStrictEqual(r.records.map((x) => x.outcome), ['killed', 'errored', 'errored', 'errored']);
    assert.strictEqual(r.summary.harness_fault, true);
    assert.strictEqual(source(root), SRC);
  });
});

describe('F6 (R5): the breaker is a trailing streak of 3 errored or timeout rows', () => {
  const rows = (...outcomes) => outcomes.map((outcome) => ({ outcome }));

  test('3 errored rows with a killed row between do not trip it; an errored and timeout mix of 3 in a row does', async () => {
    const { harnessFault } = await load('classify.mjs');
    assert.strictEqual(harnessFault(rows('errored', 'errored', 'killed', 'errored', 'errored')), false);
    assert.strictEqual(harnessFault(rows('killed', 'errored', 'timeout', 'errored')), true);
  });
});

describe('F9: expect_failing_test is required', () => {
  test('parseMutants refuses a mutant without a non-empty expect_failing_test', async () => {
    const { parseMutants } = await load('classify.mjs');
    assert.strictEqual(parseMutants([mutant('M1')]).ok, true);
    const { expect_failing_test: _drop, ...without } = mutant('M1');
    assert.match(parseMutants([without]).error, /expect_failing_test/);
    assert.strictEqual(parseMutants([mutant('M1', { expect_failing_test: '' })]).ok, false);
    assert.strictEqual(parseMutants([mutant('M1', { expect_failing_test: 3 })]).ok, false);
  });
});

describe('the db lane needs the stack lock', () => {
  test('a runner with lane db is refused (exit 2) without STACK_LOCK_HELD=1, allowed with it', () => {
    const root = project({ runners: [guarded({ id: 'db', lane: 'db' })] });
    const refused = run(root, [mutant('M1')]);
    assert.strictEqual(refused.code, 2, refused.output);
    assert.match(refused.output, /STACK_LOCK_HELD/);
    assert.deepStrictEqual(refused.records, []);
    assert.strictEqual(run(root, [mutant('M1')], { env: { STACK_LOCK_HELD: '1' } }).code, 0);
  });
});

describe('records and voided runs', () => {
  test('a kill records the generic first failing line, never the build pattern line (F2)', () => {
    const root = project({ runners: [guarded({ id: 'crashy' })] });
    const r = run(root, [mutant('M1')]);
    assert.strictEqual(r.code, 0, r.output);
    assert.strictEqual(r.records[0].first_failing_line, 'FAIL f.js > adds');
  });

  test('a build error on the confirming second run exits 5, it is not hidden as an unreproduced kill', () => {
    const root = project({ runners: [guarded({ id: 'crashy' })] });
    const r = run(root, [mutant('M1', { test: 'src/flip.check.js' })]);
    assert.strictEqual(r.code, 5, r.output);
    assert.strictEqual(r.records[0].outcome, 'errored');
    assert.match(r.records[0].detail, /build error pattern matched/);
    assert.strictEqual(source(root), SRC);
  });
});
