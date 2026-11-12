'use strict';

// agnostic-M-03 (base preset), the hook-change tooling. Split from preset-base.test.js so the files run in parallel.
// Every test runs `project init --preset base` in a tmp git repo with GSD_HOME set to a tmp directory, so no test writes ~/.gsd.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GSD_TOOLS = path.join(__dirname, 'gsd-tools.js');
const BASE = path.join(__dirname, '..', 'presets', 'base');

const tmps = [];
afterEach(() => {
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
};

function gitRepo(config) {
  const root = mkTmp('gsd-base-repo-');
  assert.strictEqual(spawnSync('git', ['init', '-q', root]).status, 0);
  fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify(config, null, 2));
  return root;
}

function runInit(root, home) {
  const r = spawnSync(process.execPath, [GSD_TOOLS, 'project', 'init', '--root', root, '--preset', 'base'], {
    encoding: 'utf8',
    env: { ...process.env, GSD_HOME: home },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('base preset: hook-change tooling (agnostic-M-03 3.10)', () => {
  const APPLY_SRC = path.join(BASE, 'scripts', 'hooks-apply.sh');
  const TRAILER_SRC = path.join(BASE, 'scripts', 'validation', 'hook-patch-trailer-check.sh');
  const applyOf = (root) => path.join(root, 'scripts', 'hooks-apply.sh');
  const trailerOf = (root) => path.join(root, 'scripts', 'validation', 'hook-patch-trailer-check.sh');
  const hookOf = (root) => path.join(root, '.claude', 'hooks', 'redirect-recursive-search.sh');
  const HOOK_REL = path.join('.claude', 'hooks', 'redirect-recursive-search.sh');
  const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
  // -c flags keep the fixture commits independent of the machine's git identity and global hooks.
  const git = (root, args) => spawnSync('git', ['-c', 'user.name=gsd-test', '-c', 'user.email=gsd-test@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  const gitOk = (root, args) => {
    const r = git(root, args);
    assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r;
  };
  // Deploys base into a fresh repo and commits the deployed tree as the first commit (the deploy commit).
  // `rows` keeps only the first N corpus rows in the project (the corpus is not a guarded file): for tests of the tooling, not of the corpus.
  function deployedRepo({ rows } = {}) {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const r = runInit(root, mkTmp('gsd-base-home-'));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    if (rows) {
      const corpus = path.join(root, 'scripts', 'validation', 'hook-canaries', 'canaries.jsonl');
      fs.writeFileSync(corpus, `${fs.readFileSync(corpus, 'utf8').split('\n').slice(0, rows).join('\n')}\n`);
    }
    gitOk(root, ['add', '-A']);
    gitOk(root, ['commit', '-q', '-m', 'chore: deploy base']);
    return root;
  }
  // The patch is a real `git diff` of an in-place edit, reverted before returning, so its context matches the commit.
  function patchFor(root, transform) {
    const target = hookOf(root);
    const original = fs.readFileSync(target, 'utf8');
    let diff;
    try {
      fs.writeFileSync(target, transform(original));
      diff = spawnSync('git', ['-C', root, 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--', HOOK_REL], { encoding: 'utf8' });
    } finally {
      fs.writeFileSync(target, original);
    }
    assert.strictEqual(diff.status, 0, diff.stderr);
    return diff.stdout;
  }
  // Writes the patch and a review file whose patch-sha256 matches the patch bytes, as hooks-apply requires.
  function writePatch(root, id, patch) {
    const dir = path.join(root, '.planning', 'hook-patches');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.patch`), patch);
    fs.writeFileSync(path.join(dir, `${id}.review.md`), `patch-sha256: ${sha256(patch)}\nsonnet-zero-findings: yes\nopus-review: not-needed\n`);
  }
  const runApply = (root, args) => spawnSync('bash', [applyOf(root), ...args], { cwd: root, encoding: 'utf8' });
  const runTrailer = (root, args = []) => spawnSync('bash', [trailerOf(root), ...args], { cwd: root, encoding: 'utf8' });
  function editHookAndCommit(root, message) {
    fs.appendFileSync(hookOf(root), '# fixture edit\n');
    gitOk(root, ['add', '-A']);
    gitOk(root, ['commit', '-q', '-m', message]);
  }

  test('3.10 both scripts are deployed by init, executable, and registered in preset.json as guarded whole files', () => {
    const root = deployedRepo();
    for (const p of [applyOf(root), trailerOf(root)]) assert.ok((fs.statSync(p).mode & 0o111) !== 0, `executable: ${p}`);
    const preset = JSON.parse(fs.readFileSync(path.join(BASE, 'preset.json'), 'utf8'));
    const mine = preset.files.filter((f) => /hooks-apply|hook-patch-trailer/.test(f.dest));
    assert.deepStrictEqual(mine.map((f) => [f.dest, f.kind, f.render, f.guarded]), [
      ['scripts/hooks-apply.sh', 'whole', false, true],
      ['scripts/validation/hook-patch-trailer-check.sh', 'whole', false, true],
    ]);
  });

  test('3.10 neither script names FLOOR_DEFAULT, a 40-hex commit literal or CEO, in the source or in the deployed copy', () => {
    const root = deployedRepo();
    for (const p of [APPLY_SRC, TRAILER_SRC, applyOf(root), trailerOf(root)]) {
      const text = fs.readFileSync(p, 'utf8');
      assert.doesNotMatch(text, /FLOOR_DEFAULT/, p);
      assert.doesNotMatch(text, /\b[0-9a-f]{40}\b/, p);
      assert.doesNotMatch(text, /CEO/, p);
    }
  });

  test('3.10 hooks-apply --dry-run on a patch that adds one comment line exits 0, names the copy, and leaves the deployed hook unchanged', () => {
    const root = deployedRepo();
    const before = fs.readFileSync(hookOf(root), 'utf8');
    writePatch(root, 'tooling-comment', patchFor(root, (s) => `${s}# comment added by fixture\n`));
    const r = runApply(root, ['tooling-comment', '--dry-run']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('dry-run: patched copy at .tmp/hook-try/tooling-comment'), r.stdout);
    assert.ok(r.stdout.includes('canaries: pass=892 fail=0'), r.stdout);
    assert.strictEqual(fs.readFileSync(hookOf(root), 'utf8'), before);
  });

  test('R2 L6 hooks-apply runs the canaries with a clean HOOKS_DIR and CORPUS: inherited values cannot redirect them; without the env -u a bogus CORPUS fails the run', () => {
    const root = deployedRepo({ rows: 40 });
    writePatch(root, 'tooling-comment', patchFor(root, (s) => `${s}# comment added by fixture\n`));
    const bogus = { ...process.env, HOOKS_DIR: path.join(mkTmp('gsd-base-nohooks-'), 'none'), CORPUS: path.join(mkTmp('gsd-base-nocorpus-'), 'none.jsonl') };
    const ok = spawnSync('bash', [applyOf(root), 'tooling-comment', '--dry-run'], { cwd: root, encoding: 'utf8', env: bogus });
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(ok.stdout.includes('canaries: pass=40 fail=0'), ok.stdout);
    const copy = path.join(root, 'scripts', 'hooks-apply-mutant.sh');
    const source = fs.readFileSync(applyOf(root), 'utf8');
    assert.ok(source.includes('env "${ev[@]}" "$1"'), 'mutation site present');
    fs.writeFileSync(copy, source.replace('env "${ev[@]}" "$1"', '"$1"'));
    const bad = spawnSync('bash', [copy, 'tooling-comment', '--dry-run'], { cwd: root, encoding: 'utf8', env: bogus });
    assert.notStrictEqual(bad.status, 0, bad.stdout);
  });

  test('3.10 hooks-apply --dry-run on a patch that makes the deny rows fail exits non-zero, names the failing hook, and leaves the deployed hook unchanged', () => {
    const root = deployedRepo({ rows: 40 });
    const before = fs.readFileSync(hookOf(root), 'utf8');
    const patch = patchFor(root, (s) => s.replace('PATH="$PATH:/usr/bin:/bin"\n', 'PATH="$PATH:/usr/bin:/bin"\nexit 0\n'));
    assert.ok(patch.includes('+exit 0'), 'fixture patch inserts the allow-all exit');
    writePatch(root, 'tooling-allow-all', patch);
    const r = runApply(root, ['tooling-allow-all', '--dry-run']);
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /FAIL \[redirect-recursive-search\.sh\] expect=deny got=allow/);
    assert.strictEqual(fs.readFileSync(hookOf(root), 'utf8'), before);
  });

  // A patch for new files, made by git itself so quoting and tab-suffixed headers are exactly what git emits.
  function newFilePatch(root, rel, text) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    gitOk(root, ['add', '-N', '--', rel]);
    const diff = spawnSync('git', ['-C', root, 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--', rel], { encoding: 'utf8' });
    gitOk(root, ['rm', '-q', '--cached', '--', rel]);
    fs.rmSync(abs);
    assert.strictEqual(diff.status, 0, diff.stderr);
    return diff.stdout;
  }
  const ROOT_DIR = ['.claude', 'hooks'].join('/');

  test('F8 a patch path with a space is kept whole: refused outside the hooks directory by its full name, applied in a dry run inside it', () => {
    const root = deployedRepo({ rows: 40 });
    writePatch(root, 'space-out', newFilePatch(root, 'scripts/my file.sh', 'x\n'));
    const out = runApply(root, ['space-out', '--dry-run']);
    assert.notStrictEqual(out.status, 0);
    assert.ok(out.stderr.includes("patch touches 'scripts/my file.sh'"), out.stderr);
    writePatch(root, 'space-in', newFilePatch(root, `${ROOT_DIR}/lib/a b.txt`, 'x\n'));
    const ok = runApply(root, ['space-in', '--dry-run']);
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.strictEqual(fs.readFileSync(path.join(root, '.tmp', 'hook-try', 'space-in', 'lib', 'a b.txt'), 'utf8'), 'x\n');
  });

  test('F8 a patch path holding a control character or a newline is refused naming the control character', () => {
    const root = deployedRepo();
    for (const [id, name] of [['ctl-tab', 'a\tb.txt'], ['ctl-nl', 'a\nb.txt']]) {
      writePatch(root, id, newFilePatch(root, `${ROOT_DIR}/lib/${name}`, 'x\n'));
      const r = runApply(root, [id, '--dry-run']);
      assert.notStrictEqual(r.status, 0, id);
      assert.ok(r.stderr.includes('control character or newline'), r.stderr);
    }
  });

  test('F8 the script never expands the path list unquoted', () => {
    const src = fs.readFileSync(APPLY_SRC, 'utf8');
    assert.doesNotMatch(src.replace(/\$\{PATHS\[[@*]\]\}/g, ''), /\$PATHS\b/);
    assert.ok(src.includes('PATHS+=("$f")'));
  });

  test('3.10 trailer check with no flag passes when the only commit touching the guarded paths is the deploy commit (floor = that commit)', () => {
    const root = deployedRepo();
    const r = runTrailer(root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /scanned 0 commit\(s\) in .*\.\.HEAD touching .*; 0 without a Hook-Patch trailer/);
  });

  test('3.10 trailer check with no flag fails naming an unreviewed hook commit after the deploy commit', () => {
    const root = deployedRepo();
    editHookAndCommit(root, 'fix(hooks): unreviewed edit');
    const r = runTrailer(root);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes('missing Hook-Patch:'), r.stderr);
    assert.ok(r.stderr.includes('fix(hooks): unreviewed edit'), r.stderr);
  });

  test('3.10 the same hook commit carrying a Hook-Patch trailer passes and is counted as scanned', () => {
    const root = deployedRepo();
    editHookAndCommit(root, 'fix(hooks): reviewed edit\n\nHook-Patch: tooling-reviewed');
    const r = runTrailer(root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /scanned 1 commit\(s\) .* 0 without a Hook-Patch trailer/);
  });

  test('3.10 an unresolvable --floor exits 1 and names the floor; a floor that is not an ancestor of HEAD exits 1 and names it', () => {
    const root = deployedRepo();
    const bogus = '0123456789abcdef0123456789abcdef01234567';
    const unresolved = runTrailer(root, ['--floor', bogus]);
    assert.strictEqual(unresolved.status, 1, unresolved.stdout);
    assert.ok(unresolved.stderr.includes(bogus), unresolved.stderr);

    gitOk(root, ['checkout', '-q', '-b', 'tooling-side']);
    gitOk(root, ['commit', '-q', '--allow-empty', '-m', 'side work']);
    const side = gitOk(root, ['rev-parse', 'HEAD']).stdout.trim();
    gitOk(root, ['checkout', '-q', '-']);
    gitOk(root, ['commit', '-q', '--allow-empty', '-m', 'main work']);
    const notAncestor = runTrailer(root, ['--floor', side]);
    assert.strictEqual(notAncestor.status, 1, notAncestor.stdout);
    assert.ok(notAncestor.stderr.includes('is not an ancestor of HEAD'), notAncestor.stderr);
  });

  const RUNNER = path.join('scripts', 'validation', 'hook-canaries', 'run-canaries.sh');
  const CORPUS = path.join('scripts', 'validation', 'hook-canaries', 'canaries.jsonl');
  test('3.8 C9 a commit that edits the canary runner without a trailer fails naming it; with the trailer it passes', () => {
    const root = deployedRepo();
    fs.appendFileSync(path.join(root, RUNNER), '# fixture edit\n');
    gitOk(root, ['add', '-A']);
    gitOk(root, ['commit', '-q', '-m', 'chore: runner edit']);
    const bare = runTrailer(root);
    assert.strictEqual(bare.status, 1, bare.stdout + bare.stderr);
    assert.ok(bare.stderr.includes('chore: runner edit'), bare.stderr);
    const other = deployedRepo();
    fs.appendFileSync(path.join(other, RUNNER), '# fixture edit\n');
    gitOk(other, ['add', '-A']);
    gitOk(other, ['commit', '-q', '-m', 'chore: runner edit\n\nHook-Patch: runner-reviewed']);
    assert.strictEqual(runTrailer(other).status, 0);
  });

  test('3.8 C9 a commit that deletes one canary row fails naming the removal; a commit that only appends a row passes', () => {
    const root = deployedRepo();
    const lines = fs.readFileSync(path.join(root, CORPUS), 'utf8').split('\n');
    fs.writeFileSync(path.join(root, CORPUS), lines.slice(1).join('\n'));
    gitOk(root, ['add', '-A']);
    gitOk(root, ['commit', '-q', '-m', 'chore: drop a canary row']);
    const removed = runTrailer(root);
    assert.strictEqual(removed.status, 1, removed.stdout + removed.stderr);
    assert.ok(removed.stderr.includes('chore: drop a canary row (removes or rewrites 1 canary row(s))'), removed.stderr);

    const appended = deployedRepo();
    fs.appendFileSync(path.join(appended, CORPUS), '{"hook":"check-denied-command.sh","expect":"allow","tool":"Bash","input":{"command":"true"},"cwd":"@repo-feature","label":"fixture","class":"fixture"}\n');
    gitOk(appended, ['add', '-A']);
    gitOk(appended, ['commit', '-q', '-m', 'chore: add a canary row']);
    assert.strictEqual(runTrailer(appended).status, 0, runTrailer(appended).stderr);
  });
});
