'use strict';

// agnostic-M-09 (9.4 to 9.6): behaviour tests of the mutation tool the base preset deploys (scripts/mutate/). 9.4 is
// the safety half (guards, worktree, restore, options); the runner and the CLI are added by 9.5 and 9.6.
// Node and POSIX shell only.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const MUTATE = path.join(__dirname, '..', 'presets', 'base', 'scripts', 'mutate');
const FIXTURE = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'agnostic', 'mutate', 'signal-fixture.mjs');
const load = (name) => import(pathToFileURL(path.join(MUTATE, name)).href);

const tmps = [];
const spawned = [];
const recorded = [];
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// SIGKILLs every spawned CLI/fixture child and the whole process group of every test pid a run recorded, so a failing assertion cannot leave one running.
const reapAll = () => {
  while (recorded.length > 0) {
    const pid = recorded.pop();
    const pgid = Number(spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
    if (pgid > 1) { try { process.kill(-pgid, 'SIGKILL'); } catch { /* group gone */ } }
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  while (spawned.length > 0) { try { spawned.pop().kill('SIGKILL'); } catch { /* gone */ } }
};
afterEach(() => {
  reapAll();
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});
const mkTmp = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(d);
  return d;
};
const git = (root, ...args) => {
  const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
};
const ORIGINAL = 'export const add = (a, b) => a + b;\n';
// A tmp repo with one committed source file and one committed test file.
function repo() {
  const root = mkTmp('gsd-mutate-repo-');
  git(root, 'init', '-q');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), ORIGINAL);
  fs.writeFileSync(path.join(root, 'src', 'a.check.js'), 'x\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.js\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
const bytes = (root, rel = 'src/a.js') => fs.readFileSync(path.join(root, rel), 'utf8');

describe('mutation tool: run guards refuse and leave the target unchanged (agnostic-M-09 9.4)', () => {
  // Port of the source safety cases gsd-mutate.test.ts:131 (dirty), :294 (untracked), :340 (gitignored), :399 (primary).
  const mutants = (file) => [{ id: 'M1', file, old: 'a', new: 'b', test: 'src/a.check.js' }];

  test('dirty, untracked and ignored targets are named; a clean one is not', async () => {
    const { dirtyTargets } = await load('guards.mjs');
    const root = repo();
    assert.deepStrictEqual((await dirtyTargets(root, mutants('src/a.js'))).value, []);
    fs.appendFileSync(path.join(root, 'src', 'a.js'), '// local edit\n');
    const dirtyBytes = bytes(root);
    assert.deepStrictEqual((await dirtyTargets(root, mutants('src/a.js'))).value, ['src/a.js']);
    assert.strictEqual(bytes(root), dirtyBytes);
    fs.writeFileSync(path.join(root, 'src', 'new.js'), 'x\n');
    assert.deepStrictEqual((await dirtyTargets(root, mutants('src/new.js'))).value, ['src/new.js']);
    fs.writeFileSync(path.join(root, 'ignored.js'), 'x\n');
    assert.deepStrictEqual((await dirtyTargets(root, mutants('ignored.js'))).value, ['ignored.js']);
    assert.strictEqual((await dirtyTargets(path.join(root, 'nowhere'), mutants('src/a.js'))).ok, false);
  });

  test('the primary worktree is refused unless --allow-primary, --dry-run, a linked worktree or a temp copy', async () => {
    const { primaryError } = await load('guards.mjs');
    const root = repo();
    const opts = { root, dryRun: false, allowPrimary: false };
    assert.match(await primaryError(opts, []), /is the primary worktree of its repo/);
    assert.strictEqual(await primaryError({ ...opts, allowPrimary: true }, []), null);
    assert.strictEqual(await primaryError({ ...opts, dryRun: true }, []), null);
    assert.strictEqual(await primaryError(opts, [path.dirname(root)]), null, 'under a temp base');
    const linked = path.join(mkTmp('gsd-mutate-wt-'), 'wt');
    git(root, 'worktree', 'add', '-q', linked, 'HEAD');
    assert.strictEqual(await primaryError({ ...opts, root: linked }, []), null, 'a linked worktree');
    assert.match(await primaryError({ ...opts, root: mkTmp('gsd-mutate-notgit-') }, []), /not inside a git worktree/);
    assert.strictEqual(bytes(root), ORIGINAL);
  });

  test('a leftover <out>.restore/ is refused, an empty one is not', async () => {
    const { staleBackupError } = await load('guards.mjs');
    const dir = mkTmp('gsd-mutate-out-');
    const out = path.join(dir, 'm.jsonl');
    assert.strictEqual(await staleBackupError(out), null);
    fs.mkdirSync(`${out}.restore`);
    assert.strictEqual(await staleBackupError(out), null);
    fs.writeFileSync(path.join(`${out}.restore`, 'M1.a.js.orig'), 'bytes');
    assert.match(await staleBackupError(out), /holds backups from a run cut short/);
    assert.strictEqual(fs.readFileSync(path.join(`${out}.restore`, 'M1.a.js.orig'), 'utf8'), 'bytes');
  });

  test('a target outside --root (parent path, absolute path, symlink out) is refused; --out may not be a source file', async () => {
    const { outsideRootError, outPathError } = await load('guards.mjs');
    const root = repo();
    const outside = mkTmp('gsd-mutate-outside-');
    fs.writeFileSync(path.join(outside, 'secret.js'), 'x\n');
    fs.symlinkSync(path.join(outside, 'secret.js'), path.join(root, 'src', 'link.js'));
    assert.strictEqual(await outsideRootError(root, mutants('src/a.js')), null);
    assert.match(await outsideRootError(root, mutants('../x.js')), /unsafe path/);
    assert.match(await outsideRootError(root, mutants(path.join(outside, 'secret.js'))), /unsafe path/);
    assert.match(await outsideRootError(root, mutants('src/link.js')), /resolves outside --root/);
    assert.strictEqual(fs.readFileSync(path.join(outside, 'secret.js'), 'utf8'), 'x\n');
    const opts = { mutantsPath: path.join(root, 'm.json'), root, outPath: path.join(root, 'src', 'a.js') };
    assert.match(outPathError(opts, mutants('src/a.js')), /would overwrite/);
    assert.strictEqual(outPathError({ ...opts, outPath: path.join(root, 'out.jsonl') }, mutants('src/a.js')), null);
    assert.strictEqual(bytes(root), ORIGINAL);
  });

  test('baselineError names the first test that is not green and stops there', async () => {
    const { baselineError } = await load('guards.mjs');
    const seen = [];
    const runner = async (_root, t) => { seen.push(t); return { outcome: t === 'b' ? 'killed' : 'survived', durationMs: 1 }; };
    assert.strictEqual(await baselineError(runner, 'before', '/r', ['a'], 1, {}), null);
    assert.match(await baselineError(runner, 'after', '/r', ['a', 'b', 'c'], 1, {}), /baseline red after: b fails unmutated \(killed\)/);
    assert.deepStrictEqual(seen, ['a', 'a', 'b']);
  });
});

describe('mutation tool: restore (agnostic-M-09 9.4)', () => {
  // Port of classify_cases.ts:222-245 (restoreFile: sha mismatch and I/O failure raise RestoreError, a good restore returns the sha).
  test('restoreFile writes the original back, and raises on a hash mismatch or an I/O failure', async () => {
    const { restoreFile, RestoreError } = await load('restore.mjs');
    const { sha256Hex } = await load('classify.mjs');
    const dir = mkTmp('gsd-mutate-restore-');
    const file = path.join(dir, 'f.js');
    const original = Buffer.from(ORIGINAL);
    const sha = sha256Hex(original);
    fs.writeFileSync(file, 'mutated');
    await assert.rejects(() => restoreFile(file, original, sha, { write: async () => {}, read: async () => Buffer.from('garbage') }), (e) => e instanceof RestoreError && /restore mismatch/.test(e.message));
    await assert.rejects(() => restoreFile(file, original, sha, { write: async () => { throw new Error('EROFS'); }, read: async () => original }), (e) => e instanceof RestoreError && /EROFS/.test(e.message));
    assert.strictEqual(await restoreFile(file, original, sha), sha);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), ORIGINAL);
  });

  test('withActiveMutation clears the active record when the callback throws, and when it returns', async () => {
    const { withActiveMutation, restoreFile, activeCount } = await load('restore.mjs');
    const { sha256Hex } = await load('classify.mjs');
    const dir = mkTmp('gsd-mutate-active-');
    const file = path.join(dir, 'f.js');
    const original = Buffer.from(ORIGINAL);
    const sha = sha256Hex(original);
    fs.writeFileSync(file, ORIGINAL);
    const m = { path: file, original, sha, apply: async () => fs.writeFileSync(file, 'MUTATED\n'), restore: () => restoreFile(file, original, sha) };
    let during = -1;
    await assert.rejects(() => withActiveMutation(m, async () => { during = activeCount(); throw new Error('boom'); }), /boom/);
    assert.strictEqual(during, 1);
    assert.strictEqual(activeCount(), 0);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), ORIGINAL, 'restored on the throwing path');
    assert.strictEqual(await withActiveMutation(m, async () => 'ok'), 'ok');
    assert.strictEqual(activeCount(), 0);
  });
});

describe('mutation tool: signal restore through a fixture process (agnostic-M-09 9.4)', () => {
  // Port of signal-fixture.ts and the source cases safety_cases.ts:204 (signal mid-mutation), :289 (in-flight write), :341 (failed restore).
  async function fixture(scenario, signal) {
    const dir = mkTmp('gsd-mutate-sig-');
    const child = spawn(process.execPath, [FIXTURE, scenario, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    spawned.push(child);
    let stdout = '';
    child.stdout.on('data', (c) => { stdout += c; });
    const exited = new Promise((resolve) => child.on('close', (code, sig) => resolve(code ?? sig)));
    const end = Date.now() + 10000;
    while (!fs.existsSync(path.join(dir, 'ready')) && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    assert.ok(fs.existsSync(path.join(dir, 'ready')), 'fixture never reached its signal window');
    await new Promise((r) => setTimeout(r, 100));
    child.kill(signal);
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => { child.kill('SIGKILL'); r('hung'); }, 15000))]);
    return { dir, code, stdout };
  }

  test('SIGTERM mid-mutation leaves the file byte-equal to the original and exits 143', async () => {
    const { dir, code, stdout } = await fixture('basic', 'SIGTERM');
    assert.strictEqual(code, 143);
    assert.match(stdout, /applied one/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'one.txt'), 'utf8'), 'ORIGINAL\n');
  });

  test('SIGINT waits for an in-flight mutation write, restores it, and parks the main flow (exit 130)', async () => {
    const { dir, code, stdout } = await fixture('race', 'SIGINT');
    assert.strictEqual(code, 130);
    assert.ok(stdout.includes('applied one') && stdout.includes('done one'));
    assert.ok(stdout.includes('applied decoy'), 'the handler exited before an in-flight write landed');
    assert.ok(!stdout.includes('apply two'), 'a new mutation started after the stop signal');
    for (const f of ['one', 'decoy']) assert.strictEqual(fs.readFileSync(path.join(dir, `${f}.txt`), 'utf8'), 'ORIGINAL\n', f);
    assert.ok(!fs.existsSync(path.join(dir, 'decoy.orig')), 'the backup of a verified restore is removed');
  });

  test('a restore that fails in the handler exits 3 and keeps the backup', { skip: process.getuid && process.getuid() === 0 }, async () => {
    const { dir, code } = await fixture('restore-fail', 'SIGTERM');
    try {
      assert.strictEqual(code, 3, 'RESTORE FAILED must not exit with the signal code');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'stuck.txt'), 'utf8'), 'MUTATED\n');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'stuck.orig'), 'utf8'), 'backup');
    } finally {
      fs.chmodSync(path.join(dir, 'stuck.txt'), 0o644);
    }
  });
});

describe('mutation tool: option parsing (agnostic-M-09 9.4)', () => {
  // Port of parse_cases.ts:150 (parseOptions: --mutants is required) and safety_cases.ts:242 (--test-env KEY=VALUE, unknown flags).
  // Dropped with the runner-specific flag list: --test-flag and its allow/deny cases.
  test('--mutants is required; unknown flags, a typo and stray positionals fail; the dropped --test-flag is unknown', async () => {
    const { parseOptions } = await load('options.mjs');
    assert.strictEqual(parseOptions([]).ok, false);
    assert.strictEqual(parseOptions(['--mutants=']).ok, false);
    assert.strictEqual(parseOptions(['--mutants', 'm.json', '--dryrun']).ok, false);
    assert.strictEqual(parseOptions(['--mutants', 'm.json', 'stray']).ok, false);
    assert.strictEqual(parseOptions(['--mutants', 'm.json', '--test-flag=--allow-all']).ok, false);
  });

  test('--timeout, --test-env, --test-cmd and --error-pattern are validated; defaults are stated', async () => {
    const { parseOptions } = await load('options.mjs');
    const base = ['--mutants', 'm.json'];
    for (const bad of ['0', '-1', 'abc', '2147484']) assert.strictEqual(parseOptions([...base, '--timeout', bad]).ok, false, bad);
    assert.strictEqual(parseOptions([...base, '--timeout', '2147483']).ok, true);
    assert.match(parseOptions([...base, '--test-env', 'NOEQUALS']).error, /KEY=VALUE/);
    assert.match(parseOptions([...base, '--test-cmd', 'node --test']).error, /\{file\}/);
    assert.match(parseOptions([...base, '--error-pattern', '(']).error, /regular expression/);
    const good = parseOptions([...base, '--root', '/r', '--test-cmd', 'node --test {file}', '--test-env', 'A=1', '--test-env', 'B=x=y', '--error-pattern', 'SyntaxError', '--dry-run'], '/cwd', new Date('2026-01-02T03:04:05.678Z'));
    assert.strictEqual(good.ok, true);
    assert.deepStrictEqual(good.value, {
      mutantsPath: 'm.json',
      outPath: path.join('/r', '.tmp', 'mutate', '2026-01-02T03-04-05-678Z.jsonl'),
      root: '/r',
      timeoutMs: 120000,
      dryRun: true,
      allowDirty: false,
      allowPrimary: false,
      config: { testCmd: 'node --test {file}', testEnv: { A: '1', B: 'x=y' }, errorPattern: 'SyntaxError' },
    });
    assert.strictEqual(parseOptions(base, '/cwd').value.root, '/cwd');
  });
});

describe('mutation tool: runner seam, exit-status verdict (agnostic-M-09 9.5)', () => {
  const CMD = 'node --test {file}';
  const cfg = (extra = {}) => ({ testCmd: CMD, testEnv: {}, errorPattern: null, ...extra });
  const ADD_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\ntest('add', () => { assert.strictEqual(require('./add.js').add(1, 2), 3); });\n";
  // A project with a source file, a test that catches a change to it, and a second source no test reads.
  function project() {
    const root = mkTmp('gsd-mutate-proj-');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'add.js'), 'exports.add = (a, b) => a + b;\nexports.unused = 1;\n');
    fs.writeFileSync(path.join(root, 'src', 'add.check.js'), ADD_TEST);
    return root;
  }
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const gone = async (pid) => {
    for (let i = 0; i < 40 && alive(pid); i += 1) await new Promise((r) => setTimeout(r, 50));
    return !alive(pid);
  };

  test('a mutant its test catches is killed, one no test catches survives, the unmutated project survives', async () => {
    const { runTest } = await load('process.mjs');
    const root = project();
    assert.strictEqual((await runTest(root, 'src/add.check.js', 30000, cfg())).outcome, 'survived');
    fs.writeFileSync(path.join(root, 'src', 'add.js'), 'exports.add = (a, b) => a - b;\nexports.unused = 1;\n');
    const killed = await runTest(root, 'src/add.check.js', 30000, cfg());
    assert.strictEqual(killed.outcome, 'killed');
    assert.notStrictEqual(killed.exitCode, 0);
    fs.writeFileSync(path.join(root, 'src', 'add.js'), 'exports.add = (a, b) => a + b;\nexports.unused = 2;\n');
    assert.strictEqual((await runTest(root, 'src/add.check.js', 30000, cfg())).outcome, 'survived');
  });

  test('a test that hangs is a timeout and its whole process group is gone afterwards', async () => {
    const { runTest } = await load('process.mjs');
    const root = project();
    fs.writeFileSync(path.join(root, 'src', 'hang.check.js'), "const { spawn } = require('child_process');\nconst c = spawn('sleep', ['300'], { stdio: 'ignore' });\nrequire('fs').writeFileSync('pid.txt', String(c.pid));\nsetInterval(() => {}, 1000);\n");
    const run = await runTest(root, 'src/hang.check.js', 1500, cfg({ testCmd: 'node {file}' }));
    assert.strictEqual(run.outcome, 'timeout');
    const pid = Number(fs.readFileSync(path.join(root, 'pid.txt'), 'utf8'));
    assert.ok(await gone(pid), 'the sleep child outlived the timeout');
  });

  test('a process a test left running when it exits normally is swept with its group', async () => {
    const { runTest } = await load('process.mjs');
    const root = project();
    fs.writeFileSync(path.join(root, 'src', 'leave.check.js'), "const { spawn } = require('child_process');\nconst c = spawn('sleep', ['300'], { stdio: 'inherit' });\nc.unref();\nrequire('fs').writeFileSync('pid.txt', String(c.pid));\n");
    const run = await runTest(root, 'src/leave.check.js', 30000, cfg({ testCmd: 'node {file}' }));
    assert.strictEqual(run.outcome, 'survived');
    assert.ok(await gone(Number(fs.readFileSync(path.join(root, 'pid.txt'), 'utf8'))), 'the leftover process survived the run');
  });

  test('with an error pattern a syntactically broken mutant is errored; without one it is killed; the notice is exported', async () => {
    const { runTest } = await load('process.mjs');
    const { NO_PATTERN_NOTICE } = await load('classify.mjs');
    const root = project();
    fs.writeFileSync(path.join(root, 'src', 'add.js'), 'exports.add = (a, b) => a +;\n');
    const withPattern = await runTest(root, 'src/add.check.js', 30000, cfg({ errorPattern: 'SyntaxError' }));
    assert.strictEqual(withPattern.outcome, 'errored', withPattern.output);
    assert.strictEqual((await runTest(root, 'src/add.check.js', 30000, cfg())).outcome, 'killed');
    assert.strictEqual(NO_PATTERN_NOTICE, 'no error pattern: a mutant that fails to build counts as killed');
    fs.writeFileSync(path.join(root, 'src', 'add.js'), 'exports.add = (a, b) => a - b;\n');
    assert.strictEqual((await runTest(root, 'src/add.check.js', 30000, cfg({ errorPattern: 'SyntaxError' }))).outcome, 'killed', 'an assertion failure is still a kill');
  });

  test('a command that cannot run is errored; a test path with a space and a quote is passed as one argument', async () => {
    const { runTest, shellQuote, commandFor } = await load('process.mjs');
    const root = project();
    assert.strictEqual((await runTest(root, 'src/add.check.js', 30000, cfg({ testCmd: 'no-such-command-for-mutate {file}' }))).outcome, 'errored');
    const odd = "src/it's here.check.js";
    fs.copyFileSync(path.join(root, 'src', 'add.check.js'), path.join(root, odd));
    assert.strictEqual((await runTest(root, odd, 30000, cfg())).outcome, 'survived');
    assert.strictEqual(shellQuote("a'b"), "'a'\\''b'");
    assert.strictEqual(commandFor('x {file} y {file}', 'p q'), "x 'p q' y 'p q'");
  });

  test('a red baseline is reported before any edit: baselineError over runTest names the test and the outcome', async () => {
    const { runTest } = await load('process.mjs');
    const { baselineError } = await load('guards.mjs');
    const root = project();
    assert.strictEqual(await baselineError(runTest, 'before', root, ['src/add.check.js'], 30000, cfg()), null);
    fs.writeFileSync(path.join(root, 'src', 'add.js'), 'exports.add = (a, b) => a - b;\n');
    assert.match(await baselineError(runTest, 'before', root, ['src/add.check.js'], 30000, cfg()), /baseline red before: src\/add\.check\.js fails unmutated \(killed\)/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'src', 'add.js'), 'utf8'), 'exports.add = (a, b) => a - b;\n');
  });

  // Ports of classify_cases.ts that do not depend on the dropped summary parser: :38 and :57 (survived needs exit 0, a
  // non-zero exit is a kill), :92 (timeout wins), :124 (canaryMismatches, expect only), :173 (applySnippet), :181
  // (firstFailingLine), :189 (isDirtyPorcelain), :196 (pathError without the apps/libs rule), :206 (parseMutants), :417 (renderMarkdown).
  test('classify: survived needs exit 0, a non-zero exit is a kill, a timeout wins, nothing that did not run is a kill', async () => {
    const { classify } = await load('classify.mjs');
    const run = (over) => ({ exitCode: 0, timedOut: false, spawnFailed: false, output: '', ...over });
    assert.strictEqual(classify(run({})), 'survived');
    assert.strictEqual(classify(run({ exitCode: 1 })), 'killed');
    assert.strictEqual(classify(run({ exitCode: 1, timedOut: true })), 'timeout');
    assert.strictEqual(classify(run({ exitCode: 0, timedOut: true })), 'timeout');
    for (const over of [{ exitCode: null }, { spawnFailed: true, exitCode: 1 }, { exitCode: 127 }, { exitCode: 126 }]) assert.strictEqual(classify(run(over)), 'errored', JSON.stringify(over));
    const pattern = /SyntaxError/;
    assert.strictEqual(classify(run({ exitCode: 1, output: 'SyntaxError: x' }), pattern), 'errored');
    assert.strictEqual(classify(run({ exitCode: 1, output: 'AssertionError' }), pattern), 'killed');
    assert.strictEqual(classify(run({ exitCode: 0, output: 'SyntaxError printed by a passing test' }), pattern), 'survived');
    assert.strictEqual(classify(run({ exitCode: 1, output: 'mentions a type error' })), 'killed');
  });

  test('parseMutants, canaryMismatches, inconclusive and renderMarkdown on the source cases', async () => {
    const { parseMutants, canaryMismatches, inconclusive, renderMarkdown, killReproduced } = await load('classify.mjs');
    const mutant = (id, extra = {}) => ({ id, file: 'src/a.js', old: 'a', new: 'b', test: 'src/a.check.js', ...extra });
    assert.strictEqual(parseMutants([mutant('M1', { expect: 'killed' })]).ok, true);
    assert.strictEqual(parseMutants([{ id: 'M1', file: 'src/a.js', new: 'b', test: 't' }]).ok, false, 'missing old');
    assert.strictEqual(parseMutants([mutant('M1'), mutant('M1')]).ok, false, 'duplicate ids');
    assert.strictEqual(parseMutants([mutant('M1', { expect: 'maybe' })]).ok, false);
    assert.strictEqual(parseMutants([mutant('M1', { expect: 'killed-typecheck' })]).ok, false, 'the dropped outcome is not an expectation');
    assert.strictEqual(parseMutants([mutant('M1', { new: 'a' })]).ok, false, 'no-op mutant');
    assert.strictEqual(parseMutants([mutant('M1', { old: '' })]).ok, false);
    assert.strictEqual(parseMutants([mutant('M1', { file: '../x.js' })]).ok, false);
    assert.strictEqual(parseMutants([mutant('M1', { test: '/etc/passwd' })]).ok, false);
    assert.strictEqual(parseMutants(['str']).ok, false);
    assert.strictEqual(parseMutants({ a: 1 }).ok, false);
    assert.strictEqual(parseMutants([mutant('M1', { file: 'pkg/mod.py', test: 'tests/test_mod.py' })]).ok, true, 'no language is assumed');
    const rec = { id: 'M1', file: 'src/a.js', outcome: 'killed', duration_ms: 7, first_failing_line: 'error: a | b', expect: 'killed' };
    assert.strictEqual(canaryMismatches([rec]).length, 0);
    assert.strictEqual(canaryMismatches([{ ...rec, expect: 'survived' }]).length, 1);
    assert.deepStrictEqual(inconclusive([{ outcome: 'timeout' }, { outcome: 'errored' }, { outcome: 'invalid-snippet' }, { outcome: 'killed' }, { outcome: 'survived' }]).length, 3);
    assert.strictEqual(killReproduced('killed'), true);
    assert.strictEqual(killReproduced('survived'), false);
    const rows = renderMarkdown([{ ...rec, outcome: 'survived' }, { ...rec, id: 'M2', expect: 'survived', outcome: 'survived' }]).split('\n');
    assert.strictEqual(rows.length, 4);
    assert.ok(rows[2].includes('survived (expect killed)'));
    assert.ok(rows[2].includes('error: a \\| b'));
    assert.ok(!rows[3].includes('(expect'));
  });

  test('countOccurrences counts overlaps, applySnippet replaces literally, firstFailingLine trims, isDirtyPorcelain and pathError', async () => {
    const { countOccurrences, applySnippet, firstFailingLine, isDirtyPorcelain, pathError } = await load('classify.mjs');
    assert.strictEqual(countOccurrences('a b a', 'a'), 2);
    assert.strictEqual(countOccurrences('a b', 'z'), 0);
    assert.strictEqual(countOccurrences('aaa', 'aa'), 2);
    assert.strictEqual(countOccurrences('abc', ''), 0);
    assert.strictEqual(applySnippet('x = 1;', '1', '2'), 'x = 2;');
    assert.strictEqual(applySnippet('x = 1;', '1', '$&$&'), 'x = $&$&;', 'a replacement is literal');
    const got = firstFailingLine(`running 1 test\n  error: AssertionError: ${'x'.repeat(400)}\n`);
    assert.strictEqual(got.length, 200);
    assert.ok(got.startsWith('error: AssertionError'));
    assert.strictEqual(firstFailingLine('all fine\nnothing here\n'), null);
    assert.strictEqual(firstFailingLine('ok\nBoom happened\n', /Boom/), 'Boom happened');
    assert.strictEqual(isDirtyPorcelain(''), false);
    assert.strictEqual(isDirtyPorcelain('\n'), false);
    assert.strictEqual(isDirtyPorcelain('?? src/new.js\n'), true);
    assert.strictEqual(isDirtyPorcelain(' M src/a.js\n'), true);
    assert.strictEqual(pathError('src/x.js'), null);
    assert.strictEqual(pathError('apps/api/x.ts'), null, 'no apps/libs rule');
    for (const bad of ['apps/../scripts/x.js', '/etc/passwd', 'apps//x.js', 'apps\\api\\x.js']) assert.notStrictEqual(pathError(bad), null, bad);
  });
});

describe('mutation tool: the command line (agnostic-M-09 9.6)', () => {
  // Ports of the source safety cases gsd-mutate.test.ts:131 (dirty), :294 (untracked), :340 (gitignored), :399 (primary,
  // dry-run) and run_cases.ts:85 (mutants file problems), :106 (not a git worktree), :150 (--out), :197 (leftover restore directory).
  const CLI = path.join(MUTATE, 'mutate.mjs');
  const TEST_CMD = 'node --test {file}';
  const ADD_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\ntest('add', () => { assert.strictEqual(require('./add.js').add(1, 2), 3); });\n";
  const SRC = 'exports.add = (a, b) => a + b;\nexports.unused = 1;\n';
  const mutant = (id, extra = {}) => ({ id, file: 'src/add.js', old: 'a + b', new: 'a - b', test: 'src/add.check.js', ...extra });
  const KILL = mutant('M-kill');
  const SURVIVE = mutant('M-survive', { old: 'exports.unused = 1', new: 'exports.unused = 2' });

  // A committed tmp repo (a temp copy: not refused as a primary worktree) holding the source and a test that catches a change to add.
  function fixtureRepo() {
    const root = mkTmp('gsd-mutate-cli-');
    git(root, 'init', '-q');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'add.js'), SRC);
    fs.writeFileSync(path.join(root, 'src', 'add.check.js'), ADD_TEST);
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.js\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
    return root;
  }
  const writeMutants = (root, list) => { const f = path.join(root, '.mutants.json'); fs.writeFileSync(f, JSON.stringify(list)); return f; };
  const cli = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 120000, cwd: extra.cwd ?? os.tmpdir() });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const run = (root, list, args = [], extra = {}) => {
    const mutants = writeMutants(root, list);
    const out = path.join(root, '.out.jsonl');
    return { ...cli(['--mutants', mutants, '--out', out, '--root', root, '--test-cmd', TEST_CMD, ...args], extra), outFile: out };
  };
  const src = (root) => fs.readFileSync(path.join(root, 'src', 'add.js'), 'utf8');

  test('each refusal exits 2 and leaves the target byte-equal: dirty, untracked, ignored, outside --root, leftover restore directory, unknown flag, stray positional', () => {
    const dirty = fixtureRepo();
    fs.appendFileSync(path.join(dirty, 'src', 'add.js'), '// local edit\n');
    const dirtyBytes = src(dirty);
    const d = run(dirty, [KILL]);
    assert.strictEqual(d.code, 2, d.out);
    assert.match(d.out, /uncommitted or untracked src\/add\.js/);
    assert.strictEqual(src(dirty), dirtyBytes);

    const untracked = fixtureRepo();
    fs.writeFileSync(path.join(untracked, 'src', 'new.js'), SRC);
    const u = run(untracked, [mutant('M1', { file: 'src/new.js' })]);
    assert.strictEqual(u.code, 2, u.out);
    assert.strictEqual(fs.readFileSync(path.join(untracked, 'src', 'new.js'), 'utf8'), SRC);

    const ignored = fixtureRepo();
    fs.writeFileSync(path.join(ignored, 'ignored.js'), SRC);
    const i = run(ignored, [mutant('M1', { file: 'ignored.js' })]);
    assert.strictEqual(i.code, 2, i.out);
    assert.strictEqual(fs.readFileSync(path.join(ignored, 'ignored.js'), 'utf8'), SRC);

    const outside = fixtureRepo();
    const elsewhere = mkTmp('gsd-mutate-elsewhere-');
    fs.writeFileSync(path.join(elsewhere, 'x.js'), SRC);
    fs.symlinkSync(path.join(elsewhere, 'x.js'), path.join(outside, 'src', 'link.js'));
    git(outside, 'add', '-A');
    git(outside, 'commit', '-q', '-m', 'link');
    for (const file of ['../x.js', 'src/link.js']) {
      const o = run(outside, [mutant('M1', { file })]);
      assert.strictEqual(o.code, 2, `${file}: ${o.out}`);
    }
    assert.strictEqual(fs.readFileSync(path.join(elsewhere, 'x.js'), 'utf8'), SRC);

    const leftover = fixtureRepo();
    fs.mkdirSync(path.join(leftover, '.out.jsonl.restore'));
    fs.writeFileSync(path.join(leftover, '.out.jsonl.restore', 'M-kill.add.js.orig'), 'bytes');
    const l = run(leftover, [KILL]);
    assert.strictEqual(l.code, 2, l.out);
    assert.match(l.out, /holds backups from a run cut short/);
    assert.strictEqual(src(leftover), SRC);
    assert.strictEqual(fs.readFileSync(path.join(leftover, '.out.jsonl.restore', 'M-kill.add.js.orig'), 'utf8'), 'bytes');

    const flags = fixtureRepo();
    assert.strictEqual(run(flags, [KILL], ['--dryrun']).code, 2);
    assert.strictEqual(run(flags, [KILL], ['stray']).code, 2);
    assert.strictEqual(src(flags), SRC);
  });

  test('mutants file problems exit 2: missing, not JSON, empty, not an array; a root that is not a git worktree exits 2; --out may not be a target', () => {
    const root = fixtureRepo();
    const base = ['--out', path.join(root, '.out.jsonl'), '--root', root, '--test-cmd', TEST_CMD];
    assert.strictEqual(cli(['--mutants', path.join(root, 'absent.json'), ...base]).code, 2);
    const bad = path.join(root, 'bad.json');
    for (const text of ['{nope', '[]', '{"a":1}']) {
      fs.writeFileSync(bad, text);
      assert.strictEqual(cli(['--mutants', bad, ...base]).code, 2, text);
    }
    const nogit = mkTmp('gsd-mutate-nogit-');
    fs.mkdirSync(path.join(nogit, 'src'));
    fs.writeFileSync(path.join(nogit, 'src', 'add.js'), SRC);
    fs.writeFileSync(path.join(nogit, 'src', 'add.check.js'), ADD_TEST);
    const n = run(nogit, [KILL]);
    assert.strictEqual(n.code, 2, n.out);
    assert.strictEqual(src(nogit), SRC);
    const clash = cli(['--mutants', writeMutants(root, [KILL]), '--out', path.join(root, 'src', 'add.js'), '--root', root, '--test-cmd', TEST_CMD]);
    assert.strictEqual(clash.code, 2, clash.out);
    assert.match(clash.out, /would overwrite/);
    assert.strictEqual(src(root), SRC);
  });

  test('the primary worktree is refused (exit 2) unless it is a temp copy, --allow-primary, a linked worktree or --dry-run', async () => {
    const { main } = await load('mutate.mjs');
    const root = fixtureRepo();
    const mutants = writeMutants(root, [KILL]);
    const argv = ['--mutants', mutants, '--out', path.join(root, '.out.jsonl'), '--root', root, '--test-cmd', TEST_CMD];
    const quiet = async (fn) => { const e = console.error; const l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };
    assert.strictEqual(await quiet(() => main(argv, { tempBases: [] })), 2, 'primary refused');
    assert.strictEqual(src(root), SRC);
    assert.strictEqual(await quiet(() => main([...argv, '--dry-run'], { tempBases: [] })), 0, 'dry-run is always allowed');
    assert.strictEqual(await quiet(() => main(argv, { tempBases: [path.dirname(root)] })), 0, 'a temp copy is allowed');
    assert.strictEqual(src(root), SRC, 'restored');
    const linked = path.join(mkTmp('gsd-mutate-linked-'), 'wt');
    git(root, 'worktree', 'add', '-q', linked, 'HEAD');
    const linkedArgv = ['--mutants', mutants, '--out', path.join(linked, '.out.jsonl'), '--root', linked, '--test-cmd', TEST_CMD];
    assert.strictEqual(await quiet(() => main(linkedArgv, { tempBases: [] })), 0, 'a linked worktree is allowed');
    assert.strictEqual(fs.readFileSync(path.join(linked, 'src', 'add.js'), 'utf8'), SRC);
  });

  test('--dry-run never edits: valid snippets exit 0, an invalid snippet exits 1', () => {
    const root = fixtureRepo();
    const ok = run(root, [KILL, SURVIVE], ['--dry-run']);
    assert.strictEqual(ok.code, 0, ok.out);
    assert.strictEqual(src(root), SRC);
    const records = fs.readFileSync(ok.outFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepStrictEqual(records.map((r) => r.outcome), ['valid', 'valid']);
    const bad = run(root, [mutant('M1', { old: 'does not occur' })], ['--dry-run']);
    assert.strictEqual(bad.code, 1, bad.out);
    assert.strictEqual(JSON.parse(fs.readFileSync(bad.outFile, 'utf8').trim()).outcome, 'invalid-snippet');
    const dir = run(root, [mutant('M1', { test: 'src' })], ['--dry-run']);
    assert.strictEqual(dir.code, 1, 'a directory is not a test file');
    assert.strictEqual(src(root), SRC);
  });

  test('end to end in a linked worktree: a killed and a surviving mutant give two JSONL lines, exit 0, the target byte-equal; a canary mismatch exits 1', () => {
    const primary = fixtureRepo();
    const linked = path.join(mkTmp('gsd-mutate-e2e-'), 'wt');
    git(primary, 'worktree', 'add', '-q', linked, 'HEAD');
    const r = run(linked, [KILL, SURVIVE]);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /no error pattern: a mutant that fails to build counts as killed/);
    const records = fs.readFileSync(r.outFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepStrictEqual(records.map((x) => [x.id, x.outcome, x.kill_confirmed]), [['M-kill', 'killed', true], ['M-survive', 'survived', null]]);
    assert.strictEqual(records[1].first_failing_line, null, 'a survivor carries no failing line');
    assert.notStrictEqual(records[0].mutated_sha, records[0].source_sha_before);
    assert.strictEqual(records[0].source_sha_after, records[0].source_sha_before);
    assert.strictEqual(fs.readFileSync(path.join(linked, 'src', 'add.js'), 'utf8'), SRC);
    const summary = JSON.parse(fs.readFileSync(`${r.outFile}.run.json`, 'utf8'));
    assert.deepStrictEqual(summary, { exit_code: 0, mutants: 2, baseline_before: 'green', baseline_after: 'green' });
    assert.ok(!fs.existsSync(`${r.outFile}.restore`), 'a successful run leaves no backup directory');
    const canary = run(linked, [mutant('C1', { expect: 'survived' })]);
    assert.strictEqual(canary.code, 1, canary.out);
    assert.match(canary.out, /canary mismatch or inconclusive mutant: C1 \(expected survived, got killed\)/);
    assert.strictEqual(JSON.parse(fs.readFileSync(`${canary.outFile}.run.json`, 'utf8')).exit_code, 1);
    assert.strictEqual(fs.readFileSync(path.join(linked, 'src', 'add.js'), 'utf8'), SRC);
  });

  test('a red baseline exits 2 before any edit and writes the run summary; the profile supplies the test command and error pattern', () => {
    const root = fixtureRepo();
    fs.writeFileSync(path.join(root, 'src', 'add.check.js'), "require('node:test')('red', () => { throw new Error('red'); });\n");
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'red');
    const red = run(root, [KILL]);
    assert.strictEqual(red.code, 2, red.out);
    assert.match(red.out, /baseline red before/);
    assert.strictEqual(JSON.parse(fs.readFileSync(`${red.outFile}.run.json`, 'utf8')).baseline_before, 'red');
    assert.strictEqual(src(root), SRC);

    const proj = fixtureRepo();
    fs.mkdirSync(path.join(proj, '.planning'));
    fs.writeFileSync(path.join(proj, '.planning', 'config.json'), JSON.stringify({ stack: { commands: { test_file: TEST_CMD }, mutation: { error_pattern: 'SyntaxError' } } }));
    const broken = mutant('M-broken', { old: 'a + b', new: 'a +' });
    const fromProfile = cli(['--mutants', writeMutants(proj, [broken, KILL]), '--out', path.join(proj, '.out.jsonl'), '--root', proj], { cwd: proj });
    assert.strictEqual(fromProfile.code, 1, fromProfile.out);
    const records = fs.readFileSync(path.join(proj, '.out.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepStrictEqual(records.map((x) => [x.id, x.outcome]), [['M-broken', 'errored'], ['M-kill', 'killed']]);
    assert.ok(!fromProfile.out.includes('no error pattern'));
    assert.strictEqual(src(proj), SRC);
    const noConfig = cli(['--mutants', writeMutants(proj, [KILL]), '--root', proj], { cwd: mkTmp('gsd-mutate-empty-') });
    assert.strictEqual(noConfig.code, 2, noConfig.out);
    assert.match(noConfig.out, /config\.json unreadable or not JSON/);
  });
});

describe('mutation tool: signals through the command line (agnostic-M-09 9.6)', () => {
  // Port of the source signal cases safety_cases.ts:204 (a signal mid-mutation restores the source and kills the test tree)
  // and run_cases.ts:197 (a leftover <out>.restore/ from a run cut short is refused, so its original bytes are not overwritten).
  const CLI = path.join(MUTATE, 'mutate.mjs');
  const SRC = 'exports.add = (a, b) => a + b;\nexports.marker = "clean";\n';
  // The test passes on the clean source; on the mutated one it records its pid and waits.
  const CHECK = "const fs = require('fs');\nif (fs.readFileSync('src/add.js', 'utf8').includes('MUTATED')) { fs.writeFileSync('in-window.txt', String(process.pid)); setInterval(() => {}, 1000); }\nelse require('node:test')('clean', () => {});\n";
  function slowRepo() {
    const root = mkTmp('gsd-mutate-sig-cli-');
    git(root, 'init', '-q');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'add.js'), SRC);
    fs.writeFileSync(path.join(root, 'src', 'slow.check.js'), CHECK);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
    fs.writeFileSync(path.join(root, '.m.json'), JSON.stringify([{ id: 'S1', file: 'src/add.js', test: 'src/slow.check.js', old: '"clean"', new: '"MUTATED"' }]));
    return root;
  }
  const start = (root) => {
    const child = spawn(process.execPath, [CLI, '--mutants', path.join(root, '.m.json'), '--out', path.join(root, '.out.jsonl'), '--root', root, '--test-cmd', 'node {file}'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    spawned.push(child);
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    const exited = new Promise((resolve) => child.on('close', (code, sig) => resolve(code ?? sig)));
    return { child, exited, output: () => out };
  };
  const waitFile = async (file) => {
    const end = Date.now() + 30000;
    while (!fs.existsSync(file) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.existsSync(file), `no ${file}`);
    return fs.readFileSync(file, 'utf8');
  };
  const alive = pidAlive;
  const recordPid = (text) => { const pid = Number(text); recorded.push(pid); return pid; };

  test('SIGTERM between mutate and restore leaves the target byte-equal, kills the test and exits 143', async () => {
    const root = slowRepo();
    const run = start(root);
    const testPid = recordPid(await waitFile(path.join(root, 'in-window.txt')));
    assert.ok(fs.readFileSync(path.join(root, 'src', 'add.js'), 'utf8').includes('MUTATED'), 'the target is mutated in the window');
    run.child.kill('SIGTERM');
    assert.strictEqual(await run.exited, 143, run.output());
    assert.strictEqual(fs.readFileSync(path.join(root, 'src', 'add.js'), 'utf8'), SRC);
    for (let i = 0; i < 40 && alive(testPid); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(!alive(testPid), 'the test process survived the signal');
    assert.ok(!fs.existsSync(path.join(root, '.out.jsonl.restore', 'S1.add.js.orig')), 'the backup of a verified restore is removed');
  });

  test('a second run over the leftover restore directory of a killed run refuses with exit 2 and does not touch it', async () => {
    const root = slowRepo();
    const run = start(root);
    const testPid = recordPid(await waitFile(path.join(root, 'in-window.txt')));
    run.child.kill('SIGKILL');
    await run.exited;
    try { process.kill(-testPid, 'SIGKILL'); } catch { try { process.kill(testPid, 'SIGKILL'); } catch { /* gone */ } }
    const backup = path.join(root, '.out.jsonl.restore', 'S1.add.js.orig');
    assert.strictEqual(fs.readFileSync(backup, 'utf8'), SRC, 'the original bytes are kept for the SIGKILLed run');
    const mutatedBytes = fs.readFileSync(path.join(root, 'src', 'add.js'), 'utf8');
    assert.ok(mutatedBytes.includes('MUTATED'));
    const second = spawnSync(process.execPath, [CLI, '--mutants', path.join(root, '.m.json'), '--out', path.join(root, '.out.jsonl'), '--root', root, '--test-cmd', 'node {file}', '--allow-dirty'], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(second.status, 2, second.stdout + second.stderr);
    assert.match(second.stderr, /holds backups from a run cut short/);
    assert.strictEqual(fs.readFileSync(backup, 'utf8'), SRC);
    assert.strictEqual(fs.readFileSync(path.join(root, 'src', 'add.js'), 'utf8'), mutatedBytes);
  });
});

describe('mutation tool: no child outlives a test (leaked slow.check.js)', () => {
  test('reapAll kills a recorded slow test process and its group even when the test body fails before cleanup', async () => {
    const root = path.join(mkTmp('gsd-mutate-leak-'), 'r');
    fs.mkdirSync(root);
    const child = spawn('sh', ['-c', 'echo $$ > pid.txt; sleep 300 & wait'], { cwd: root, detached: true, stdio: 'ignore' });
    spawned.push(child);
    const end = Date.now() + 10000;
    while (!fs.existsSync(path.join(root, 'pid.txt')) && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    const pid = Number(fs.readFileSync(path.join(root, 'pid.txt'), 'utf8'));
    recorded.push(pid);
    const kids = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).map(Number);
    assert.ok(pidAlive(pid) && kids.length === 1 && pidAlive(kids[0]), 'precondition: group is running');
    reapAll();
    for (let i = 0; i < 60 && (pidAlive(pid) || pidAlive(kids[0])); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(!pidAlive(pid), 'the recorded leader survived reapAll');
    assert.ok(!pidAlive(kids[0]), 'the leader\'s child survived reapAll');
  });
});

describe('mutation tool: profile lookup (agnostic-M-09 9.6)', () => {
  test('withProfile takes flags first, then stack.commands.test_file and stack.mutation.error_pattern; every gap is a failure', async () => {
    const { withProfile } = await load('mutate.mjs');
    const cwd = mkTmp('gsd-mutate-profile-');
    fs.mkdirSync(path.join(cwd, '.planning'));
    const write = (cfg) => fs.writeFileSync(path.join(cwd, '.planning', 'config.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
    const opts = (config = {}) => ({ config: { testCmd: null, testEnv: {}, errorPattern: null, ...config } });
    assert.strictEqual(withProfile(opts(), cwd).ok, false, 'no config file');
    write('{ nope');
    assert.match(withProfile(opts(), cwd).error, /unreadable or not JSON/);
    write({ stack: { commands: { test_file: 'node --test {file}' }, mutation: { error_pattern: 'Boom' } } });
    assert.deepStrictEqual(withProfile(opts(), cwd).value.config, { testCmd: 'node --test {file}', testEnv: {}, errorPattern: 'Boom' });
    assert.strictEqual(withProfile(opts({ testCmd: 'x {file}', errorPattern: 'Mine' }), '/nowhere').value.config.errorPattern, 'Mine', 'flags only: no config read');
    assert.strictEqual(withProfile(opts({ testCmd: 'x {file}' }), cwd).value.config.errorPattern, 'Boom');
    assert.strictEqual(withProfile(opts({ testCmd: 'x {file}' }), '/nowhere').value.config.errorPattern, null, 'no config and a flag command: no pattern');
    write({ stack: {} });
    assert.match(withProfile(opts(), cwd).error, /no test command/);
    write({ stack: { commands: { test_file: 'no placeholder' } } });
    assert.match(withProfile(opts(), cwd).error, /must contain \{file\}/);
    write({ stack: { commands: { test_file: 'x {file}' }, mutation: { error_pattern: '(' } } });
    assert.match(withProfile(opts(), cwd).error, /not a valid regular expression/);
  });
});
