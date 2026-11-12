'use strict';

// agnostic-M-03 (base preset), the review-round-2 mutants. Split from preset-base.test.js so the files run in parallel.
// Every test runs `project init --preset base` in a tmp git repo with GSD_HOME set to a tmp directory, so no test writes ~/.gsd.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
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

describe('base preset: review round 2 mutants of the shared guard and the hooks (agnostic-M-03 3.8 C5)', () => {
  const hooksDir = (root) => path.join(root, '.claude', 'hooks');
  const CORPUS_SRC = path.join(BASE, 'canaries', 'canaries.jsonl');
  const deploy = () => {
    const root = gitRepo({ project: { slug: 'demo', owner_title: 'Founder' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, mkTmp('gsd-base-home-')).status, 0);
    return root;
  };
  const runnerOf = (root) => path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh');
  const runnerEnv = (extra) => {
    const env = { ...process.env, ...extra };
    if (!extra.CORPUS) delete env.CORPUS;
    if (!extra.HOOKS_DIR) delete env.HOOKS_DIR;
    return env;
  };
  // A mutant is killed by its first failing row, so the rows run in chunks and the run stops at the first chunk that fails.
  const firstFailingChunk = (root, rows, hooks) => {
    const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
    let r = { status: 0, stdout: '', stderr: 'no rows' };
    for (let at = 0; at < rows.length && r.status === 0; at += 40) {
      fs.writeFileSync(corpus, `${rows.slice(at, at + 40).map((x) => JSON.stringify(x)).join('\n')}\n`);
      r = spawnSync('bash', [runnerOf(root)], { cwd: root, encoding: 'utf8', env: runnerEnv({ HOOKS_DIR: hooks, CORPUS: corpus }) });
    }
    return r;
  };

  // Review round 2: mutants of the shared guard and of the other hooks, killed by the review-r2 rows (own rows of this hook plus the shared ones).
  const R2_MUTANTS = [
    ['M1 any quoted word with a space is a command line again', "elsif ($w[$k] =~ /\\s/ && ($k == 1 || $eval))", "elsif ($w[$k] =~ /\\s/)", 'HookGuard.pm'],
    ['M2 rm flag cluster with a digit not recognised', '$a =~ /^-[A-Za-z0-9]*[rR]/', '$a =~ /^-[A-Za-z]*[rR]/', 'check-denied-command.pl'],
    ['M2 grep cluster stops at a digit', "last if $c =~ /^[ABCmDef]$/;", "last if $c =~ /^[ABCmDef0-9]$/;", 'redirect-recursive-search.pl'],
    ['M2 grep -d value ignored', "$recursive = 1 if $v =~ /^rec(?:u(?:r(?:s(?:e)?)?)?)?$/; last }", "last }", 'redirect-recursive-search.pl'],
    ['L5 find: -maxdepth after -exec counts', "{ $exec = 1; last }", "{ $exec = 1 }", 'redirect-recursive-search.pl'],
    ['L5 find: a value of -name counts as the option', "elsif ($FIND_VAL{ $r[$k] }) { $k++ }", "", 'redirect-recursive-search.pl'],
    ['L5 ag and ack are not searches', "pcre2grep|rg|ag|ack|ack-grep|ugrep", "pcre2grep|rg|ugrep", 'redirect-recursive-search.pl'],
    ['M3 literal match is case-sensitive', "$word = lc norm_word($word); $lit = lc norm_word($lit);", "$word = norm_word($word); $lit = norm_word($lit);", 'check-test-command.pl'],
    ['M3 the cd directory is not tracked', "return 0 unless defined $d && $d ne $cwd && $word !~ /^[-~]/;", "return 0;", 'check-test-command.pl'],
    ['M3 flake globs are case-sensitive', "return new RegExp(`^${re}$`, 'i');", "return new RegExp(`^${re}$`);", 'flake-gate.mjs'],
    ['M3 flake-ignore marker is case-sensitive', "flake-ignore\\b(.*)$/i;", "flake-ignore\\b(.*)$/;", 'flake-gate.mjs'],
    ['L2 new readers removed', 'source . bat rev paste column fold fmt comm join pr ag ack ug ugrep zgrep pcregrep', 'source .', 'check-denied-command.pl'],
    ['L2 template suffix .dist and middle part not accepted', '$b !~ /^\\.env[^\\/]*\\.(?:example|sample|template|dist)$/', '$b !~ /^\\.env\\.(?:example|sample|template)$/', 'check-denied-command.pl'],
    ['L2 empty credential value not exempt', '($k =~ $RUNS_COMMAND && !$reset)', '($k =~ $RUNS_COMMAND)', 'check-denied-command.pl'],
    ['L3 command substitution target not denied', '|| m{^\\$SUB(?:/|$)}', '', 'check-denied-command.pl'],
    ['L3 control characters not denied', '$c =~ /([\\x00-\\x08\\x0b-\\x1f\\x7f])/', '0', 'HookGuard.pm'],
    ['L4 sed --in-place is not a writer', '/^--i(?:n(?:-(?:p(?:l(?:a(?:c(?:e)?)?)?)?)?)?)?(?:=|$)/', '0', 'block-push-without-local-tests.pl'],
    ['L4 find -exec writers are not denied', 'if ($r[$k] =~ /^-(?:exec|execdir|ok|okdir)$/) { my $x', 'if (0) { my $x', 'block-push-without-local-tests.pl'],
    ['L4 reading the marker age is denied again', '($hit && !read_only_code($h, @hitw) && !read_only_awk($h, \\@r, @hitw))', '$hit', 'block-push-without-local-tests.pl'],
    ['L4 code that writes the marker passes the read exemption', 'return 0 if $w =~ /(?:write|append|', 'return 0 if 0 && $w =~ /(?:write|append|', 'block-push-without-local-tests.pl'],
    ['L4 awk write syntax passes the exemption', '{ /[>|]|system\\s*\\(|getline|close\\s*\\(/ }', '{ /(?!)/ }', 'block-push-without-local-tests.pl'],
    // R2-MUTANTS-END
  ];
  for (const [name, needle, replacement, file] of R2_MUTANTS) {
    test(`R2 mutant killed: ${name}`, () => {
      const root = deploy();
      const mutated = mkTmp('gsd-base-mutant-');
      fs.cpSync(hooksDir(root), mutated, { recursive: true });
      const target = path.join(mutated, 'lib', file);
      const source = fs.readFileSync(target, 'utf8');
      assert.ok(source.includes(needle), `mutation site present: ${needle}`);
      fs.writeFileSync(target, source.replace(needle, () => replacement));
      const all = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
      const r = firstFailingChunk(root, all.filter((x) => x.class === 'review-r2'), mutated);
      assert.notStrictEqual(r.status, 0, `mutant survived: ${name}\n${r.stdout}`);
      assert.ok(/FAIL \[/.test(r.stdout), r.stdout);
    });
  }
});
