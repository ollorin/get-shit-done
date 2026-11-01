'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'gsd-guard-bash.js');

let tmp;
let logFile;
let primary;
let linked;
let plain;

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  assert.strictEqual(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`);
}

function initRepo(dir, withPlanning) {
  fs.mkdirSync(dir, { recursive: true });
  sh('git', ['init', '-q', '-b', 'main'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  if (withPlanning) {
    fs.mkdirSync(path.join(dir, '.planning'));
    fs.writeFileSync(path.join(dir, '.planning', 'STATE.md'), 's\n');
  }
  sh('git', ['add', '-A'], dir);
  sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], dir);
}

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-guard-bash-')));
  logFile = path.join(tmp, 'hook.jsonl');
  primary = path.join(tmp, 'primary');
  plain = path.join(tmp, 'plain');
  linked = path.join(tmp, 'linked');
  initRepo(primary, true);
  initRepo(plain, false);
  sh('git', ['worktree', 'add', '-q', linked, '-b', 'wt'], primary);
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function runRaw(stdin, extra = {}) {
  fs.rmSync(logFile, { force: true });
  const r = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, GSD_HOOK_LOG: logFile, ...extra },
  });
  const log = fs.existsSync(logFile)
    ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
  return { rc: r.status, stderr: r.stderr, log };
}

function run(command, cwd = plain, tool = 'Bash') {
  return runRaw(JSON.stringify({ tool_name: tool, cwd, session_id: 's1', tool_input: { command } }));
}

function assertDeny(command, rule, cwd) {
  const r = run(command, cwd);
  assert.strictEqual(r.rc, 2, `expected deny: ${command}\n${r.stderr}`);
  assert.match(r.stderr, new RegExp(`\\[${rule}\\]`), command);
  const deny = r.log.find(l => l.event === 'deny');
  assert.ok(deny && deny.rule === rule, `deny log line with rule ${rule}: ${JSON.stringify(r.log)}`);
}

function assertAllow(command, cwd) {
  const r = run(command, cwd);
  assert.strictEqual(r.rc, 0, `expected allow: ${command}\n${r.stderr}`);
  assert.ok(!r.log.some(l => l.event === 'deny'), command);
}

describe('no-verify', () => {
  for (const c of [
    'git commit --no-verify -m x',
    'git commit -m x --no-verify',
    'git push --no-verify',
    'git push origin HEAD --no-verify',
    'git commit -n -m x',
    'git commit -an -m x',
    'git commit --no-ver -m x',
    'git commit -m x -n',
    'git -C /tmp commit --no-verify',
    'git -c user.name=x commit --no-verify',
    '/usr/bin/git commit --no-verify',
    'git commit -o --no-verify',
    'git merge --no-verify x',
    'git merge x --no-verify',
    'git merge --no-ff --no-verify x',
    'git merge -s ours --no-verify x',
    'git -C /tmp merge x --no-verify',
    'git merge --no-ver x',
  ]) test(`denies: ${c}`, () => assertDeny(c, 'no-verify'));

  for (const c of [
    'git commit -m x -- path',
    'git commit -m "-n"',
    'git commit -m "--no-verify"',
    'git commit -m x --amend --no-edit',
    'git push -o --no-verify origin',
    'git commit --no-edit',
    'git merge x',
    'git merge --no-ff x',
    'git merge -m "--no-verify" x',
    'git merge -s ours -X theirs x',
  ]) test(`allows: ${c}`, () => assertAllow(c));
});

describe('no-check', () => {
  for (const c of [
    'deno test --no-check x.test.ts',
    'deno test x.test.ts --no-check',
    'deno task test --no-check x.test.ts',
    'cd apps/api && deno test --no-check file',
    'deno test --no-check=remote file',
  ]) test(`denies: ${c}`, () => assertDeny(c, 'no-check'));

  for (const c of ['deno test file', 'cd apps/api && deno task test file', 'deno check x.ts', 'deno lint', 'deno fmt']) {
    test(`allows: ${c}`, () => assertAllow(c));
  }
});

describe('hooks-path (RULING R7)', () => {
  for (const c of [
    'git -c core.hooksPath=/dev/null commit -m x',
    'git -c core.hooksPath=/dev/null commit',
    'git -c core.hookspath=/dev/null push',
    'git -c core.hooksPath= status',
    'git -C . -c core.hooksPath=/x log',
    'git --config-env=core.hooksPath=HP commit -m x',
    'git --config-env core.hooksPath=HP commit -m x',
    'git config core.hooksPath /dev/null',
    'git config --local core.hooksPath /dev/null',
    'git config --global core.hooksPath /dev/null',
    'git config set core.hooksPath /dev/null',
    'git config --add core.hooksPath /x',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
    'GIT_CONFIG_KEY_3=core.hooksPath git commit -m x',
    'env GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/x git commit -m x',
    'export GIT_CONFIG_KEY_0=core.hooksPath; git commit -m x',
    'GIT_CONFIG_PARAMETERS="\'core.hooksPath=/dev/null\'" git commit -m x',
    'bash -c "git -c core.hooksPath=/dev/null commit"',
    'true && git -c core.hooksPath=/dev/null commit',
  ]) test(`denies: ${c}`, () => assertDeny(c, 'hooks-path'));

  for (const c of [
    'git config --get core.hooksPath',
    'git config core.hooksPath',
    'git config --list',
    'git config --unset core.hooksPath',
    'git -c user.name=x commit -m y',
    'git config user.name x',
    'git commit -m "set core.hooksPath later"',
    'echo "git -c core.hooksPath=/dev/null commit"',
    'GIT_CONFIG_KEY_0=user.name git status',
  ]) test(`allows: ${c}`, () => assertAllow(c));
});

describe('quoting traps', () => {
  test('commit message that merely mentions --no-verify is allowed', () => {
    assertAllow('git commit -m "docs: explain why --no-verify is banned"');
    assertAllow("git commit -m 'never use --no-verify or --no-check or git stash'");
  });
  test('heredoc body mentioning banned flags is allowed', () => {
    assertAllow('git commit -m "$(cat <<\'EOF\'\nfix: stop using git commit --no-verify\n\ngit stash and git reset --hard are banned\nEOF\n)"', primary);
    assertAllow('cat <<EOF\ngit commit --no-verify\ngit -c core.hooksPath=/x commit\nEOF', primary);
    assertAllow('cat <<-EOF\n\tgit rebase main\n\tEOF\nls', primary);
  });
  test('a command after a heredoc is still checked', () => {
    assertDeny('cat <<EOF\nhello\nEOF\ngit commit --no-verify -m x', 'no-verify');
    assertDeny('git commit -F - <<EOF\nmsg\nEOF\ngit push --no-verify', 'no-verify');
  });
  test('echo / grep / comments mentioning banned commands are allowed', () => {
    assertAllow('echo "git commit --no-verify"');
    assertAllow('echo deno test --no-check');
    assertAllow('grep -rn -- "--no-verify" docs/');
    assertAllow('git log --grep=--no-verify');
    assertAllow('ls # git commit --no-verify');
    assertAllow('echo "git stash" "git reset --hard"', primary);
  });
  test('redirect targets are not command words', () => {
    assertAllow('echo hi > git', primary);
    assertAllow('echo ok 2>&1', primary);
    assertDeny('echo hi > /tmp/x; git commit --no-verify', 'no-verify');
  });
  test('quoted and escaped command words are still commands', () => {
    assertDeny("'git' commit --no-verify", 'no-verify');
    assertDeny('git "commit" "--no-verify"', 'no-verify');
    assertDeny('git commit --no\\-verify', 'no-verify');
  });
});

describe('nested shells and substitutions', () => {
  test('bash -c / sh -c / zsh -lc, nested twice', () => {
    assertDeny('bash -c "git commit --no-verify"', 'no-verify');
    assertDeny("sh -c 'git commit --no-verify -m x'", 'no-verify');
    assertDeny('zsh -lc "git push --no-verify"', 'no-verify');
    assertDeny("bash -c 'bash -c \"git commit --no-verify\"'", 'no-verify');
    assertDeny('sh -c "cd apps/api && deno test --no-check file"', 'no-check');
  });
  test('eval, $(...) and backticks', () => {
    assertDeny('eval "git commit --no-verify"', 'no-verify');
    assertDeny('echo $(git commit --no-verify)', 'no-verify');
    assertDeny('echo `git push --no-verify`', 'no-verify');
    assertDeny('x="$(git commit -n -m y)"', 'no-verify');
  });
  test('wrappers: rtk, env, timeout, sudo, nohup, command', () => {
    assertDeny('rtk git commit --no-verify -m x', 'no-verify');
    assertDeny('env FOO=1 git commit --no-verify', 'no-verify');
    assertDeny('timeout 5 git commit -n -m x', 'no-verify');
    assertDeny('FOO=1 git push --no-verify', 'no-verify');
    assertDeny('nohup deno test --no-check x', 'no-check');
    assertDeny('command git commit --no-verify', 'no-verify');
  });
  test('bash -c with a harmless string is allowed', () => {
    assertAllow('bash -c "git status"');
    assertAllow("bash -c 'echo --no-verify'");
  });
});

describe('compound commands', () => {
  for (const c of [
    'git add -A && git commit --no-verify -m x',
    'true; git push --no-verify',
    'ls || git commit -n',
    'git status | cat; git commit --no-verify',
    'git add . &\ngit commit --no-verify',
    'if true; then git commit --no-verify; fi',
    '(git push --no-verify)',
    'for i in 1 2; do deno test --no-check x; done',
  ]) {
    test(`denies: ${c.replace(/\n/g, ' <nl> ')}`, () => assertDeny(c, c.includes('deno') ? 'no-check' : 'no-verify'));
  }
  test('allows a clean compound command', () => {
    assertAllow('git add -A && git commit -m x -- path && git push origin HEAD');
  });
});

describe('destructive git in a throwaway repo (primary vs linked worktree)', () => {
  const rules = [
    ['git stash', 'git-stash'],
    ['git stash push -m x', 'git-stash'],
    ['git stash pop', 'git-stash'],
    ['git stash drop', 'git-stash'],
    ['git reset --hard', 'git-reset-hard'],
    ['git reset --hard HEAD~1', 'git-reset-hard'],
    ['git clean -fd', 'git-clean'],
    ['git clean -f', 'git-clean'],
    ['git clean --force', 'git-clean'],
    ['git rebase main', 'git-rebase'],
    ['git rebase --abort', 'git-rebase'],
    ['bash -c "git stash"', 'git-stash'],
    ['true && git rebase main', 'git-rebase'],
  ];
  for (const [c, rule] of rules) {
    test(`denies in primary GSD worktree: ${c}`, () => assertDeny(c, rule, primary));
    test(`allows in linked worktree: ${c}`, () => assertAllow(c, linked));
    test(`allows in a repo without .planning: ${c}`, () => assertAllow(c, plain));
  }
  test('cd into the primary tree from elsewhere is judged by the target', () => {
    assertDeny(`cd ${primary} && git stash`, 'git-stash', plain);
    assertAllow(`cd ${linked} && git stash`, primary);
  });
  test('git -C targets the named repo', () => {
    assertDeny(`git -C ${primary} reset --hard`, 'git-reset-hard', plain);
    assertAllow(`git -C ${linked} reset --hard`, primary);
  });
  test('read-only and safe shapes are allowed in the primary worktree', () => {
    for (const c of [
      'git stash list',
      'git stash show',
      'git stash show -p',
      'git clean -n',
      'git clean -nfd',
      'git clean --dry-run -f',
      'git reset --soft HEAD~1',
      'git reset HEAD file',
      'git worktree add .tmp/x sha',
      'git worktree add .tmp/x abc123',
      'git commit -m x -- path',
      'git status',
      'git log --oneline',
      'git checkout -b feature/x',
      'deno test file',
      'cd apps/api && deno task test file',
    ]) assertAllow(c, primary);
  });
  test('the rules never fire when the repo is not resolvable', () => {
    assertAllow('git stash', path.join(tmp, 'does-not-exist'));
    assertAllow('cd $SOMEWHERE && git stash', primary);
  });
});

describe('logging and fail-open behaviour', () => {
  test('a deny writes one JSONL line with hook, rule, session and detail', () => {
    const r = run('git commit --no-verify -m x');
    const lines = r.log.filter(l => l.event === 'deny');
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].hook, 'gsd-guard-bash');
    assert.strictEqual(lines[0].rule, 'no-verify');
    assert.strictEqual(lines[0].session_id, 's1');
    assert.match(lines[0].detail, /no-verify/);
    assert.ok(lines[0].ts);
  });
  test('wait-loop / ping-sleep / tail-follow are logged, never denied', () => {
    for (const [c, rule] of [
      ['until test -f x; do sleep 1; done', 'wait-loop'],
      ['while true; do sleep 2; done', 'wait-loop'],
      ['ping -c 5 127.0.0.1', 'ping-sleep'],
      ['tail -f out.log', 'tail-follow'],
    ]) {
      const r = run(c);
      assert.strictEqual(r.rc, 0, c);
      assert.ok(r.log.some(l => l.event === 'log' && l.rule === rule), `${c}: ${JSON.stringify(r.log)}`);
    }
    const r = run('timeout 5 tail -f out.log');
    assert.ok(!r.log.some(l => l.rule === 'tail-follow'));
  });
  test('non-Bash tools and empty commands are allowed', () => {
    assert.strictEqual(run('git commit --no-verify', plain, 'Write').rc, 0);
    assert.strictEqual(run('').rc, 0);
    assert.strictEqual(runRaw(JSON.stringify({ tool_name: 'Bash', tool_input: {} })).rc, 0);
  });
  test('unparseable stdin fails open and logs an error line', () => {
    const r = runRaw('{not json');
    assert.strictEqual(r.rc, 0);
    assert.ok(r.log.some(l => l.event === 'error'));
  });
  test('an unwritable log path never changes the decision', () => {
    const r = runRaw(JSON.stringify({ tool_name: 'Bash', cwd: plain, tool_input: { command: 'git commit --no-verify' } }), { GSD_HOOK_LOG: '/dev/null/x/y.jsonl' });
    assert.strictEqual(r.rc, 2);
  });
});
