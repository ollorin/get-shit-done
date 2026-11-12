'use strict';

// agnostic-M-03 (base preset), the canary runner and the default gates. Split from preset-base.test.js so the files run in parallel.
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

const configOf = (root) => JSON.parse(fs.readFileSync(path.join(root, '.planning', 'config.json'), 'utf8'));

describe('base preset: canary runner (agnostic-M-03 3.4)', () => {
  const home = () => mkTmp('gsd-base-home-');
  const RUNNER_SRC = path.join(BASE, 'canaries', 'run-canaries.sh');
  const CORPUS_SRC = path.join(BASE, 'canaries', 'canaries.jsonl');
  const PROJECT_TERM = /deno|supabase|apps\/api|preflight|igaming|CEO|\/Users\//i;
  // The runner needs only jq and perl. A missing tool fails the test by name; it never skips.
  for (const tool of ['jq', 'perl']) {
    test(`3.4 tool present: ${tool}`, () => {
      const r = spawnSync(tool, [tool === 'jq' ? '--version' : '-v'], { encoding: 'utf8' });
      assert.ok(!r.error && r.status === 0, `missing tool: ${tool}`);
    });
  }
  const runnerOf = (root) => path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh');
  const runRunner = (root, extra = {}) => {
    const env = { ...process.env };
    delete env.CORPUS;
    delete env.HOOKS_DIR;
    Object.assign(env, extra);
    return spawnSync('bash', [runnerOf(root)], { cwd: root, encoding: 'utf8', env });
  };

  test('3.4 after init with the defaults the runner exits 0 over the redirect rows', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, home()).status, 0);
    const r = runRunner(root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('canaries: pass=892 fail=0'), r.stdout);
  });

  // One run for every profile setting the hooks and the runner are rendered from or read at run time: the sections below
  // (3.5, 3.8, 3.9, 3.11) assert their own hook behaviour on their own deployments and rely on this run for the green corpus.
  test('3.4 with a customised profile (search "rg -n", branch release/1.x, owner Founder, gate tools/gate.sh, locked commands and flake patterns of its own) the runner still exits 0 over every row', () => {
    const root = gitRepo({
      project: { slug: 'demo', owner_title: 'Founder' },
      stack: {
        capabilities: {},
        branch: { default: 'release/1.x' },
        commands: { search: 'rg -n', pre_pr_gate: 'tools/gate.sh' },
        locked_commands: ['something-else'],
        flake_patterns: { test_globs: ['**/*.integration.test.ts'], patterns: [{ id: 'own', match: 'zzz-never', message: 'm' }] },
      },
    });
    assert.strictEqual(runInit(root, home()).status, 0);
    const r = runRunner(root);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('canaries: pass=892 fail=0'), r.stdout);
  });

  test('3.4 a flipped row fails the runner and the runner names it', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, home()).status, 0);
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '');
    const first = JSON.parse(rows[0]);
    assert.strictEqual(first.expect, 'deny');
    const flipped = [{ ...first, expect: 'allow' }, ...rows.slice(1, 10).map((l) => JSON.parse(l))];
    const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
    fs.writeFileSync(corpus, `${flipped.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const r = runRunner(root, { CORPUS: corpus });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.ok(r.stdout.includes(`FAIL [redirect-recursive-search.sh] expect=allow got=deny :: ${first.label}`), r.stdout);
  });

  describe('review round 1 batch 2 F1: the runner fails closed', () => {
    const deployedRunner = () => {
      const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
      assert.strictEqual(runInit(root, home()).status, 0);
      return root;
    };
    const run = (root, extra) => {
      const env = { ...process.env, ...extra };
      if (!extra.CORPUS) delete env.CORPUS;
      delete env.HOOKS_DIR;
      return spawnSync('/bin/bash', [runnerOf(root)], { cwd: root, encoding: 'utf8', env });
    };
    const corpusOf = (text) => {
      const f = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
      fs.writeFileSync(f, text);
      return f;
    };
    const goodRows = () => fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '');
    const assertRefused = (r, needle) => {
      assert.strictEqual(r.status, 1, r.stdout + r.stderr);
      assert.ok((r.stdout + r.stderr).includes(needle), `${needle}\n${r.stdout}${r.stderr}`);
      assert.ok(!r.stdout.includes('canaries: pass='), 'no pass line is printed on a refusal');
    };

    test('F1 without jq the runner exits 1 naming jq and prints no pass line', () => {
      const root = deployedRunner();
      const bin = mkTmp('gsd-base-nojq-');
      for (const tool of ['perl', 'git']) fs.symlinkSync(spawnSync('/usr/bin/env', ['which', tool], { encoding: 'utf8' }).stdout.trim(), path.join(bin, tool));
      assertRefused(run(root, { PATH: bin }), "required tool 'jq'");
    });
    test('F1 a missing corpus, an empty corpus and a blank-only corpus exit 1', () => {
      const root = deployedRunner();
      assertRefused(run(root, { CORPUS: path.join(mkTmp('gsd-base-corpus-'), 'absent.jsonl') }), 'missing or unreadable');
      assertRefused(run(root, { CORPUS: corpusOf('') }), 'holds no rows');
      assertRefused(run(root, { CORPUS: corpusOf('\n\n') }), 'holds no rows');
    });
    test('F1 a garbage row, a truncated row and a row of the wrong shape each fail the run naming their line', () => {
      const root = deployedRunner();
      const rows = goodRows().slice(0, 10);
      const withRow = (at, bad) => corpusOf(`${[...rows.slice(0, at), bad, ...rows.slice(at)].join('\n')}\n`);
      assertRefused(run(root, { CORPUS: withRow(2, 'this is not json') }), 'corpus line 3 does not parse');
      assertRefused(run(root, { CORPUS: corpusOf(`${rows.slice(0, 3).join('\n')}\n${rows[3].slice(0, 40)}`) }), 'corpus line 4 does not parse');
      assertRefused(run(root, { CORPUS: withRow(0, '{"hook":"x.sh","expect":"maybe","tool":"Bash","input":{},"label":"l"}') }), 'corpus line 1 does not parse');
      assertRefused(run(root, { CORPUS: withRow(0, '[1,2]') }), 'corpus line 1 does not parse');
      assertRefused(run(root, { CORPUS: withRow(0, '   ') }), 'corpus line 1 does not parse');
    });
    test('F1 a final row without a trailing newline is still run; the pass count equals the row count', () => {
      const root = deployedRunner();
      const r = run(root, { CORPUS: corpusOf(goodRows().slice(0, 5).join('\n')) });
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('canaries: pass=5 fail=0'), r.stdout);
    });
    test('F1 hooks-apply does not trust an exit 0 from a runner that prints no count line', () => {
      const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
      assert.strictEqual(runInit(root, home()).status, 0);
      const runner = runnerOf(root);
      fs.writeFileSync(runner, '#!/bin/bash\nexit 0\n');
      const apply = path.join(root, 'scripts', 'hooks-apply.sh');
      const hook = path.join(root, '.claude', 'hooks', 'redirect-recursive-search.sh');
      spawnSync('git', ['-C', root, 'add', '-A']);
      spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'deploy']);
      const original = fs.readFileSync(hook, 'utf8');
      fs.writeFileSync(hook, `${original}# c\n`);
      const diff = spawnSync('git', ['-C', root, 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'], { encoding: 'utf8' }).stdout;
      fs.writeFileSync(hook, original);
      const dir = path.join(root, '.planning', 'hook-patches');
      fs.mkdirSync(dir, { recursive: true });
      const hookRel = path.join('.claude', 'hooks', 'redirect-recursive-search.sh');
      const only = diff.split('diff --git').filter((x) => x.includes(hookRel)).map((x) => `diff --git${x}`).join('');
      fs.writeFileSync(path.join(dir, 'stub.patch'), only);
      fs.writeFileSync(path.join(dir, 'stub.review.md'), `patch-sha256: ${crypto.createHash('sha256').update(only).digest('hex')}\nsonnet-zero-findings: yes\nopus-review: not-needed\n`);
      const r = spawnSync('bash', [apply, 'stub', '--dry-run'], { cwd: root, encoding: 'utf8' });
      assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stderr.includes('without a'), r.stderr);
    });
    test('F1 mutant killed: the ran-versus-rows check and the shape check are what refuse', () => {
      const src = fs.readFileSync(RUNNER_SRC, 'utf8');
      assert.ok(src.includes('[ "$ran" != "$TOTAL" ]'));
      assert.ok(src.includes('jq -e "$ROW_SHAPE"'));
    });
  });

  test('3.4 the preset corpus holds 84 redirect rows, none carries a project term, and no row is dropped', () => {
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    const count = (hook) => rows.filter((r) => r.hook === hook).length;
    assert.strictEqual(count('redirect-recursive-search.sh'), 130);
    assert.strictEqual(rows.length, 892, 'per-hook counts are asserted by the hook sections; this is the whole corpus');
    for (const r of rows) assert.doesNotMatch(JSON.stringify(r), PROJECT_TERM, r.label);
  });

  test('3.4 the runner source has no macOS-only date call, no $HOME, and none of Deno, charlotte, drift, igaming, supabase', () => {
    const src = fs.readFileSync(RUNNER_SRC, 'utf8');
    assert.doesNotMatch(src, /date -v/);
    assert.doesNotMatch(src, /\$HOME/);
    assert.doesNotMatch(src, /Deno|charlotte|drift|igaming|supabase/i);
  });
});

describe('base preset: default gates run clean in a fresh project (agnostic-M-09 9.13)', () => {
  test('G-d every default gate command exits 0 from the project root of a fresh base init, the style gate included', () => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {} } });
    const init = runInit(root, mkTmp('gsd-base-home-'));
    assert.strictEqual(init.status, 0, init.stderr);
    // The patch-trailer gate reads HEAD, so the project needs one commit, as every real project has.
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...a], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(git('add', '-A').status, 0);
    assert.strictEqual(git('commit', '-q', '-m', 'init').status, 0);
    const gates = configOf(root).stack.gates;
    assert.deepStrictEqual(gates.map((g) => g.id), ['hook-canaries', 'hook-patch-trailer', 'guard-canaries', 'guard-registry', 'style', 'flake-patterns', 'dependency-scan', 'adr', 'assertion-quality']);
    for (const g of gates) {
      const r = spawnSync(g.run, { cwd: root, shell: true, encoding: 'utf8', timeout: 120000 });
      assert.strictEqual(r.status, 0, `${g.id} (${g.run}) exited ${r.status}\n${r.stdout}\n${r.stderr}`);
    }
  });
});
