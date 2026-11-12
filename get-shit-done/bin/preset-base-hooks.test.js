'use strict';

// agnostic-M-03 (base preset), the merge-target, push-gate, test-command and flake-pattern hooks. Split from preset-base.test.js so the files run in parallel.
// Every test runs `project init --preset base` in a tmp git repo with GSD_HOME set to a tmp directory, so no test writes ~/.gsd.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./project-deploy-render.js');

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

describe('base preset: merge-target and push-gate hooks (agnostic-M-03 3.5)', () => {
  const home = () => mkTmp('gsd-base-home-');
  const hookPath = (root, name) => path.join(root, '.claude', 'hooks', name);
  const runHook = (root, name, command) => spawnSync('bash', [hookPath(root, name)], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  const RELEASE = { project: { slug: 'demo', owner_title: 'Founder' }, stack: { capabilities: {}, branch: { default: 'release/1.x' }, commands: { pre_pr_gate: 'tools/gate.sh' } } };

  test('3.5 with branch release/1.x, owner Founder, gate tools/gate.sh rendered: the merge hook asks only for the literal branch', () => {
    const root = gitRepo(RELEASE);
    assert.strictEqual(runInit(root, home()).status, 0);
    const asked = runHook(root, 'check-git-merge-target.sh', 'git push origin release/1.x');
    assert.strictEqual(asked.status, 0, asked.stderr);
    assert.match(asked.stdout, /"permissionDecision":"ask"/);
    assert.ok(asked.stdout.includes('Founder approval required'), asked.stdout);
    for (const ref of ['release/1ax', 'feature/x']) {
      const r = runHook(root, 'check-git-merge-target.sh', `git push origin ${ref}`);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stdout, /permissionDecision/, `${ref} must not ask (the dot is literal)`);
    }
  });

  test('3.5 review round 1: fetch refspecs and update-ref into a branch named release/1.x ask; the dot is literal and the slash does not break the hook', () => {
    const root = gitRepo(RELEASE);
    assert.strictEqual(runInit(root, home()).status, 0);
    for (const c of ['git fetch origin x:release/1.x', 'git fetch origin +x:refs/heads/release/1.x', 'git update-ref refs/heads/release/1.x HEAD']) {
      const r = runHook(root, 'check-git-merge-target.sh', c);
      assert.strictEqual(r.status, 0, `${c}: ${r.stderr}`);
      assert.match(r.stdout, /"permissionDecision":"ask"/, c);
    }
    for (const c of ['git fetch origin x:release/1ax', 'git update-ref refs/heads/release/1ax HEAD']) {
      const r = runHook(root, 'check-git-merge-target.sh', c);
      assert.strictEqual(r.status, 0, `${c}: ${r.stderr}`);
      assert.doesNotMatch(r.stdout, /permissionDecision/, c);
    }
  });

  test('3.5 the push gate names the rendered gate script and blocks a push with no marker', () => {
    const root = gitRepo(RELEASE);
    assert.strictEqual(runInit(root, home()).status, 0);
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools', 'gate.sh'), '#!/bin/bash\n');
    const r = runHook(root, 'block-push-without-local-tests.sh', 'git push origin feature/x');
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('tools/gate.sh'), r.stderr);
  });

  test('3.8 C7 with the default main, a merge while the checkout is on master is asked, not granted', () => {
    const root = gitRepo({ project: { slug: 'demo', owner_title: 'Founder' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, home()).status, 0);
    assert.strictEqual(spawnSync('git', ['-C', root, 'symbolic-ref', 'HEAD', 'refs/heads/master']).status, 0);
    const r = runHook(root, 'check-git-merge-target.sh', 'git merge feature/x');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /"permissionDecision":"ask"/, r.stdout);
    assert.doesNotMatch(r.stdout, /"permissionDecision":"allow"/, 'a grant on master is the defect');
  });
});

describe('base preset: check-test-command hook, profile-driven (agnostic-M-03 3.9)', () => {
  const home = () => mkTmp('gsd-base-home-');
  const hooksDir = (root) => path.join(root, '.claude', 'hooks');
  const CORPUS_SRC = path.join(BASE, 'canaries', 'canaries.jsonl');
  const PROJECT_TERM = /deno|supabase|apps\/api|preflight|igaming|CEO|\/Users\//i;
  const LOCKED = ['test:e2e', 'run-all-suites.sh'];
  const deploy = (extraStack = {}) => {
    const root = gitRepo({ project: { slug: 'demo' }, stack: { capabilities: {}, ...extraStack } });
    assert.strictEqual(runInit(root, home()).status, 0);
    return root;
  };
  const runCheck = (root, command, { cwd = root, projectDir, raw } = {}) => spawnSync('bash', [path.join(hooksDir(root), 'check-test-command.sh')], {
    input: raw ?? JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8',
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir ?? os.tmpdir() },
  });
  const WRAP = 'scripts/stack-lock.sh --label x --';

  test('3.9 a listed command run unwrapped is denied with the wrapped form; the same under the lock or supervisor is allowed; node stack-lock.mjs is not the wrapper', () => {
    const root = deploy({ locked_commands: LOCKED });
    const denied = runCheck(root, 'npm run test:e2e');
    assert.strictEqual(denied.status, 2, denied.stderr);
    assert.ok(denied.stderr.includes('scripts/stack-lock.sh --label <x> -- npm run test:e2e'), denied.stderr);
    assert.strictEqual(runCheck(root, './scripts/run-all-suites.sh').status, 2);
    assert.strictEqual(runCheck(root, `${WRAP} npm run test:e2e`).status, 0);
    assert.strictEqual(runCheck(root, 'bash scripts/session-supervisor.sh -- npm run test:e2e').status, 0);
    const viaNode = runCheck(root, 'node scripts/stack-lock.mjs --label x -- npm run test:e2e');
    assert.strictEqual(viaNode.status, 2, viaNode.stderr);
    assert.strictEqual(runCheck(root, 'npm test').status, 0, 'an unlisted command is allowed');
    assert.strictEqual(runCheck(root, 'npm run test:e2e:ci').status, 0, 'a literal is one token, not a prefix');
  });

  test('3.9 a listed literal that is only data is allowed: assignment value, echo, grep, git commit message', () => {
    const root = deploy({ locked_commands: LOCKED });
    for (const c of ['X=test:e2e other-command', 'echo "test:e2e"', 'grep -n test:e2e package.json', 'git commit -m "test:e2e"', 'cat scripts/run-all-suites.sh']) {
      assert.strictEqual(runCheck(root, c).status, 0, c);
    }
  });

  test('3.9 a multi-token literal matches as an ordered subsequence', () => {
    const root = deploy({ locked_commands: ['make integration'] });
    assert.strictEqual(runCheck(root, 'make integration').status, 2);
    assert.strictEqual(runCheck(root, 'make -j4 integration').status, 2, 'option words between the listed tokens are tolerated (review round 1 L7)');
    assert.strictEqual(runCheck(root, 'make clean integration').status, 2, 'locked literals match as an ordered subsequence (90ad823)');
    assert.strictEqual(runCheck(root, 'make clean').status, 0, 'an unrelated make target stays allowed');
    assert.strictEqual(runCheck(root, 'integration make').status, 0, 'not in order');
    assert.strictEqual(runCheck(root, `${WRAP} make integration`).status, 0);
  });

  test('3.9 no locked_commands, no stack block, an empty list or no git toplevel allows; a present config that is not JSON or has the wrong shape fails closed', () => {
    for (const stack of [{}, { locked_commands: [] }]) {
      assert.strictEqual(runCheck(deploy(stack), 'npm run test:e2e').status, 0, JSON.stringify(stack));
    }
    const noRepo = mkTmp('gsd-base-norepo-');
    assert.strictEqual(runCheck(deploy({ locked_commands: LOCKED }), 'npm run test:e2e', { cwd: noRepo }).status, 0, 'not a git repo: no config');
    const bad = deploy({ locked_commands: LOCKED });
    fs.writeFileSync(path.join(bad, '.planning', 'config.json'), '{not json');
    const r = runCheck(bad, 'echo hi');
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('fail closed'), r.stderr);
    for (const shape of [{ stack: { locked_commands: 'x' } }, { stack: { locked_commands: [''] } }, { stack: { locked_commands: [1] } }, { stack: 'x' }]) {
      fs.writeFileSync(path.join(bad, '.planning', 'config.json'), JSON.stringify(shape));
      const s = runCheck(bad, 'echo hi');
      assert.strictEqual(s.status, 2, JSON.stringify(shape));
      assert.ok(s.stderr.includes('fail closed'), s.stderr);
    }
  });

  test('3.9 malformed stdin and a non-object tool_input fail closed', () => {
    const root = deploy({ locked_commands: LOCKED });
    const notJson = runCheck(root, '', { raw: '{not json' });
    assert.strictEqual(notJson.status, 2);
    assert.ok(notJson.stderr.includes('BLOCKED'), notJson.stderr);
    const crash = runCheck(root, '', { raw: JSON.stringify({ tool_name: 'Bash', tool_input: 'npm run test:e2e', cwd: root }) });
    assert.strictEqual(crash.status, 2);
    assert.ok(crash.stderr.includes('crashed'), crash.stderr);
  });

  test('3.9 the config comes from the git toplevel of the tool call cwd, never from CLAUDE_PROJECT_DIR', () => {
    const listed = deploy({ locked_commands: LOCKED });
    const empty = gitRepo({ project: { slug: 'other' }, stack: { capabilities: {} } });
    assert.strictEqual(runCheck(listed, 'npm run test:e2e', { cwd: listed, projectDir: empty }).status, 2, 'cwd repo lists it');
    assert.strictEqual(runCheck(listed, 'npm run test:e2e', { cwd: empty, projectDir: listed }).status, 0, 'cwd repo lists nothing');
    const sub = path.join(listed, 'src');
    fs.mkdirSync(sub);
    assert.strictEqual(runCheck(listed, 'npm run test:e2e', { cwd: sub, projectDir: empty }).status, 2, 'a subdirectory finds the toplevel config');
  });

  test('3.9 the corpus rows are not vacuous: a hook that reads CLAUDE_PROJECT_DIR instead of the cwd toplevel fails the runner', () => {
    const root = deploy();
    const mutated = mkTmp('gsd-base-mutant-');
    fs.cpSync(hooksDir(root), mutated, { recursive: true });
    const pl = path.join(mutated, 'lib', 'check-test-command.pl');
    const source = fs.readFileSync(pl, 'utf8');
    const needle = 'my ($root, $why) = toplevel($cwd);';
    assert.ok(source.includes(needle), 'mutation site present');
    fs.writeFileSync(pl, source.replace(needle, "my ($root, $why) = ($ENV{CLAUDE_PROJECT_DIR} // '', '');"));
    const own = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '' && JSON.parse(l).hook === 'check-test-command.sh');
    assert.strictEqual(own.length, 175);
    const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
    fs.writeFileSync(corpus, `${own.join('\n')}\n`);
    const env = { ...process.env, HOOKS_DIR: mutated, CORPUS: corpus };
    const r = spawnSync('bash', [path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh')], { cwd: root, encoding: 'utf8', env });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.ok(r.stdout.includes('FAIL [check-test-command.sh] expect=deny got=allow'), r.stdout);
  });

  const writeFlipped = (mutate) => {
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    const target = rows.findIndex(mutate.pick);
    assert.ok(target >= 0, 'row to flip exists');
    const label = rows[target].label;
    rows[target] = { ...rows[target], expect: rows[target].expect === 'allow' ? 'deny' : 'allow', ...(rows[target].expect === 'allow' ? { reason: 'x' } : {}) };
    const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
    fs.writeFileSync(corpus, `${rows.slice(Math.max(0, target - 4), target + 5).map((r) => JSON.stringify(r)).join('\n')}\n`);
    return { corpus, label };
  };
  const runnerWith = (root, corpus) => {
    const env = { ...process.env, CORPUS: corpus };
    delete env.HOOKS_DIR;
    return spawnSync('bash', [path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh')], { cwd: root, encoding: 'utf8', env });
  };

  test('3.9 with a project list of its own, a flipped row of this hook and a flipped @bash-all row each fail the runner', () => {
    const root = deploy({ locked_commands: ['something-else'] });
    for (const pick of [(r) => r.hook === 'check-test-command.sh' && r.expect === 'deny', (r) => r.hook === '@bash-all']) {
      const { corpus, label } = writeFlipped({ pick });
      const r = runnerWith(root, corpus);
      assert.notStrictEqual(r.status, 0, r.stdout);
      assert.ok(r.stdout.includes(`:: ${label}`), r.stdout);
    }
  });

  test('3.9 the corpus holds 105 check-test-command rows and exactly 82 @bash-all rows, none with a project term; the hook is registered on Bash and every entry is guarded', () => {
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    assert.strictEqual(rows.filter((r) => r.hook === 'check-test-command.sh').length, 175);
    const shared = rows.filter((r) => r.hook === '@bash-all');
    assert.strictEqual(shared.length, 112);
    assert.ok(shared.every((r) => r.expect === 'allow'));
    for (const r of shared) assert.doesNotMatch(JSON.stringify(r), PROJECT_TERM, r.label);
    const frag = JSON.parse(fs.readFileSync(path.join(BASE, 'settings.fragment.json'), 'utf8'));
    const bash = frag.hooks.PreToolUse.find((g) => g.matcher === 'Bash');
    assert.ok(bash.hooks.some((h) => h.command === '"$CLAUDE_PROJECT_DIR"/.claude/hooks/check-test-command.sh'));
    const preset = JSON.parse(fs.readFileSync(path.join(BASE, 'preset.json'), 'utf8'));
    for (const f of preset.files.filter((x) => x.dest.includes('check-test-command'))) assert.strictEqual(f.guarded, true, f.dest);
  });

  // 3.8 C6: stack.deploy.never_touch read at run time from the config of the git toplevel
  const NEVER = ['gh workflow run deploy-prod', 'tools/release.sh prod', 'git push heroku'];
  const withStack = (root, stack) => {
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ project: { slug: 'demo' }, stack: { capabilities: {}, ...stack } }));
    return root;
  };
  const neverRoot = () => withStack(deploy(), { locked_commands: ['test:e2e'], deploy: { never_touch: NEVER } });

  test('3.8 C6 a never-touch command is denied wrapped, with a flag before the target, behind a ./ or absolute prefix, under the lock; its data forms and neighbours are allowed', () => {
    const root = neverRoot();
    for (const c of ['gh workflow run deploy-prod', 'gh workflow run --ref main deploy-prod', 'gh -R o/r workflow run deploy-prod -f x=1', '/opt/homebrew/bin/gh workflow run deploy-prod',
      './tools/release.sh prod', 'bash tools/release.sh prod', 'bash -c "./tools/release.sh --yes prod"', `${WRAP} tools/release.sh prod`, 'git -C . push heroku main']) {
      const r = runCheck(root, c);
      assert.strictEqual(r.status, 2, c);
      assert.ok(r.stderr.includes('never-touch deploy command'), r.stderr);
    }
    for (const c of ['gh workflow run deploy-staging', 'gh workflow view deploy-prod', 'tools/release.sh staging', 'echo gh workflow run deploy-prod', 'git commit -m "gh workflow run deploy-prod"',
      'grep -n "release.sh prod" README.md', 'git push origin main', `${WRAP} npm run test:e2e`]) assert.strictEqual(runCheck(root, c).status, 0, c);
    assert.strictEqual(runCheck(root, 'npm run test:e2e').status, 2, 'the locked list still applies');
  });

  test('3.8 C6 a changed list takes effect without a sync; a list that is not an array of strings, or a deploy that is not an object, fails closed; no never_touch behaves as before', () => {
    const root = deploy();
    withStack(root, { deploy: { never_touch: ['kubectl apply -f prod'] } });
    assert.strictEqual(runCheck(root, 'kubectl apply -f prod').status, 2);
    assert.strictEqual(runCheck(root, 'kubectl get pods').status, 0);
    for (const stack of [{ deploy: { never_touch: 'x' } }, { deploy: [] }, { deploy: { never_touch: [''] } }, { deploy: { never_touch: [7] } }]) {
      withStack(root, stack);
      const r = runCheck(root, 'ls');
      assert.strictEqual(r.status, 2, JSON.stringify(stack));
      assert.ok(r.stderr.includes('fail closed'), r.stderr);
    }
    withStack(root, { locked_commands: ['test:e2e'] });
    assert.strictEqual(runCheck(root, 'npm run test:e2e').status, 2);
    assert.strictEqual(runCheck(root, 'gh workflow run deploy-prod').status, 0);
    withStack(root, { deploy: { never_touch: [] } });
    assert.strictEqual(runCheck(root, 'gh workflow run deploy-prod').status, 0);
  });

  const NEVER_MUTANTS = [
    ['the never loop moved below the lock skip', "  my $data = $DATA{ base($r[0]) };\n", "  my $data = $DATA{ base($r[0]) };\n  next if $e->{wrapper} || $e->{locked};\n"],
    ['subsequence turned into adjacency', 'for my $w (@r) { $k++ if $k < @$lit && tok_eq($lit->[$k], $w, $e) }', 'for my $w (@r) { if ($k < @$lit) { if (tok_eq($lit->[$k], $w, $e)) { $k++ } else { $k = 0 } } }'],
    ['tok_eq path-suffix branch removed', 'return $lit =~ m{/} ? ($word =~ m{(?:^|/)\\Q$lit\\E$} ? 1 : 0) : (base($word) eq $lit ? 1 : 0);', 'return $lit =~ m{/} ? 0 : (base($word) eq $lit ? 1 : 0);'],
    ['the data-command exception removed', 'next if $data && !tok_eq($lit->[0], $r[0], $e);', ''],
  ];
  for (const [name, needle, replacement] of NEVER_MUTANTS) {
    test(`3.8 C6 mutant killed: ${name}`, () => {
      const root = deploy();
      const mutated = mkTmp('gsd-base-mutant-');
      fs.cpSync(hooksDir(root), mutated, { recursive: true });
      const pl = path.join(mutated, 'lib', 'check-test-command.pl');
      const source = fs.readFileSync(pl, 'utf8');
      assert.ok(source.includes(needle), `mutation site present: ${needle}`);
      fs.writeFileSync(pl, source.replace(needle, () => replacement));
      const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)).filter((r) => r.cwd === '@repo-never');
      assert.strictEqual(rows.length, 37);
      const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
      fs.writeFileSync(corpus, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
      const env = { ...process.env, HOOKS_DIR: mutated, CORPUS: corpus };
      const r = spawnSync('bash', [path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh')], { cwd: root, encoding: 'utf8', env });
      assert.notStrictEqual(r.status, 0, `mutant survived: ${name}\n${r.stdout}`);
      assert.ok(r.stdout.includes('FAIL [check-test-command.sh]'), r.stdout);
    });
  }
});

describe('base preset: check-flake-patterns hook and gate, profile-driven (agnostic-M-03 3.11)', () => {
  const { pathToFileURL } = require('url');
  const home = () => mkTmp('gsd-base-home-');
  const hooksDir = (root) => path.join(root, '.claude', 'hooks');
  const GATE_SRC = path.join(BASE, 'hooks', 'lib', 'flake-gate.mjs');
  const CORPUS_SRC = path.join(BASE, 'canaries', 'canaries.jsonl');
  const RUNNER_SRC = path.join(BASE, 'canaries', 'run-canaries.sh');
  const PROJECT_TERM = /deno|supabase|apps\/api|preflight|igaming|CEO|\/Users\//i;
  const gate = () => import(pathToFileURL(GATE_SRC).href);
  const Q = '["\']';
  const SHARED = `\\.from\\(\\s*${Q}[\\w.]*[Ss]hared[\\w.]*${Q}(?![\\s\\S]*\\.from\\()`;
  // The three source categories of the igaming flake gate as profile patterns: the worked example.
  const WORKED = [
    { id: 'hardcoded-round-number', match: `round_number\\s*:\\s*(?!${Q})\\d+\\b`, requires_before: SHARED, unless_nearby: '23505', message: 'round_number in a shared table, no retry' },
    { id: 'hardcoded-id', match: `(?:^|[^\\w.])(?:[A-Za-z_]\\w*_id|id)\\s*:\\s*(?!${Q})\\d+\\b`, requires_before: SHARED, unless_nearby: '23505', message: 'id in a shared table, no retry' },
    { id: 'absolute-time-window', match: `(?:end_hour|endHour)\\s*:\\s*(?!${Q})\\d+\\b`, requires_before: `(?:start_hour|startHour)\\s*:\\s*(?!${Q})\\d+\\b`, unless_nearby: 'getUTCHours', message: 'absolute hour window' },
  ];
  const flakeConfig = (extra = {}) => ({ stack: { capabilities: {}, flake_patterns: { test_globs: ['**/*.integration.test.ts'], patterns: WORKED, ...extra } } });
  const deploy = (cfg = flakeConfig()) => {
    const root = gitRepo({ project: { slug: 'demo' }, ...cfg });
    assert.strictEqual(runInit(root, home()).status, 0);
    return root;
  };
  const FILE = 'src/__tests__/x.integration.test.ts';
  const runFlake = (root, tool, toolInput, { cwd = root, projectDir, raw, env = {}, shell = 'bash' } = {}) => spawnSync(shell, [path.join(hooksDir(root), 'check-flake-patterns.sh')], {
    input: raw ?? JSON.stringify({ tool_name: tool, tool_input: toolInput, cwd }),
    encoding: 'utf8',
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir ?? os.tmpdir(), ...env },
  });
  const HOUR = 'const w = { start_hour: 0, end_hour: 23 };\n';
  const SHARED_INSERT = '  .from("queue_shared_rounds")\n  .insert({ round_number: 800011 })\n';
  const write = (root, content, file = FILE, opts) => runFlake(root, 'Write', { file_path: file, content }, opts);

  test('3.11 scanFlakePatterns on the three source incident shapes gives the three categories and nothing on the exempt shapes', async () => {
    const { scanFlakePatterns } = await gate();
    const ids = (c) => scanFlakePatterns(c, WORKED).map((v) => v.id);
    assert.deepStrictEqual(ids(SHARED_INSERT), ['hardcoded-round-number']);
    assert.deepStrictEqual(ids('  .from("queue_shared_rounds")\n  .insert({ venue_id: 12 })\n'), ['hardcoded-id']);
    assert.deepStrictEqual(ids(HOUR), ['absolute-time-window']);
    assert.deepStrictEqual(ids('  .from("session_rounds")\n  .insert({ round_number: 800011 })\n'), [], 'session-scoped table is exempt');
    assert.deepStrictEqual(ids(`${SHARED_INSERT}  // retry on 23505\n`), [], 'retry nearby');
    assert.deepStrictEqual(ids('  .from("queue_shared_rounds")\n  .from("session_rounds")\n  .insert({ round_number: 1 })\n'), [], 'the nearest table above decides');
    assert.deepStrictEqual(ids(`const now = new Date().getUTCHours();\n${HOUR}`), [], 'UTC anchor nearby');
    assert.deepStrictEqual(ids('const row = { round_number: "x1" };\n'), [], 'quoted value');
    assert.deepStrictEqual(ids('const row = { round_number: 800011 };\n'), [], 'requires_before absent');
  });

  test('3.11 the window: requires_before looks above, unless_nearby looks both sides, both bounded by the pattern window (default 40)', async () => {
    const { scanFlakePatterns } = await gate();
    const filler = (n) => Array.from({ length: n }, () => 'x;').join('\n');
    const P = (extra) => [{ id: 'p', match: 'TARGET', message: 'm', ...extra }];
    const count = (c, patterns) => scanFlakePatterns(c, patterns).length;
    const above = P({ requires_before: 'NEED', window: 2 });
    assert.strictEqual(count(`NEED\n${filler(1)}\nTARGET`, above), 1, 'evidence exactly 2 lines above');
    assert.strictEqual(count(`NEED\n${filler(2)}\nTARGET`, above), 0, 'evidence 3 lines above is outside');
    assert.strictEqual(count('TARGET NEED', above), 1, 'the line itself counts');
    assert.strictEqual(count(`TARGET\n${filler(1)}\nNEED`, above), 0, 'evidence below does not satisfy requires_before');
    const nearby = P({ unless_nearby: 'OK', window: 2 });
    assert.strictEqual(count(`OK\n${filler(1)}\nTARGET`, nearby), 0, 'exemption 2 above');
    assert.strictEqual(count(`TARGET\n${filler(1)}\nOK`, nearby), 0, 'exemption 2 below');
    assert.strictEqual(count(`OK\n${filler(2)}\nTARGET`, nearby), 1, 'exemption 3 above is outside');
    assert.strictEqual(count(`TARGET\n${filler(2)}\nOK`, nearby), 1, 'exemption 3 below is outside');
    const dflt = P({ requires_before: 'NEED' });
    assert.strictEqual(count(`NEED\n${filler(39)}\nTARGET`, dflt), 1, 'default window 40');
    assert.strictEqual(count(`NEED\n${filler(40)}\nTARGET`, dflt), 0);
  });

  test('3.11 suppression: flake-ignore with a reason on the line or the line above suppresses; without a reason it still blocks', async () => {
    const { scanFlakePatterns, parseSuppressionAt } = await gate();
    const P = [{ id: 'p', match: 'TARGET', message: 'm' }];
    const first = (c) => scanFlakePatterns(c, P)[0];
    assert.strictEqual(first('// flake-ignore: by design\nTARGET').suppressed, true);
    assert.strictEqual(first('TARGET // flake-ignore: by design').suppressed, true);
    assert.strictEqual(first('# flake-ignore: by design\nTARGET').suppressed, true);
    assert.strictEqual(first('/* flake-ignore: by design */\nTARGET').suppressed, true);
    assert.strictEqual(first('// flake-ignore\nTARGET').suppressed, false);
    assert.strictEqual(first('// flake-ignore:\nTARGET').suppressed, false);
    assert.strictEqual(first('// flake-ignore: \nTARGET').suppressed, false);
    assert.strictEqual(first('/* flake-ignore: */\nTARGET').suppressed, false);
    assert.match(first('// flake-ignore\nTARGET').message, /without a reason/);
    assert.strictEqual(first('// flake-ignore: by design\n\nTARGET').suppressed, false, 'two lines above is too far');
    assert.deepStrictEqual(parseSuppressionAt(['TARGET'], 0), { found: false, justified: false });
  });

  test('3.11 deployed hook: a violation in a test file is denied with file, line and pattern id; a justified ignore, a non-test file, an Edit of a clean fragment and other tools are allowed', () => {
    const root = deploy();
    const denied = write(root, HOUR);
    assert.strictEqual(denied.status, 2, denied.stderr);
    assert.ok(denied.stderr.includes(`${FILE}:1: [absolute-time-window]`), denied.stderr);
    assert.ok(denied.stderr.includes('flake-ignore: <reason>'), denied.stderr);
    assert.strictEqual(write(root, `// flake-ignore: by design\n${HOUR}`).status, 0);
    assert.strictEqual(write(root, `// flake-ignore\n${HOUR}`).status, 2);
    assert.strictEqual(write(root, HOUR, 'src/x.test.ts').status, 0, 'outside test_globs');
    assert.strictEqual(write(root, HOUR, path.join(root, 'src', '__tests__', 'y.integration.test.ts')).status, 2, 'an absolute path inside the repo matches the glob');
    assert.strictEqual(write(root, HOUR, 'top.integration.test.ts').status, 2, '**/ also matches the repo root');
    assert.strictEqual(runFlake(root, 'Bash', { command: 'echo hi' }).status, 0, 'other tools');
    assert.strictEqual(runFlake(root, 'Edit', { file_path: FILE, old_string: 'a', new_string: 'const ok = 1;\n' }).status, 0);
  });

  test('3.11 the hook runs when reached through a symlinked path (the CLI must not depend on argv[1] matching the module URL)', () => {
    const root = deploy();
    const link = path.join(mkTmp('gsd-base-link-'), 'hooks-link');
    fs.symlinkSync(hooksDir(root), link);
    const r = spawnSync('bash', [path.join(link, 'check-flake-patterns.sh')], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: FILE, content: HOUR }, cwd: root }),
      encoding: 'utf8',
      cwd: root,
    });
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  });

  test('3.11 Write scans content and Edit scans new_string only', () => {
    const root = deploy();
    assert.strictEqual(runFlake(root, 'Edit', { file_path: FILE, old_string: 'a', new_string: SHARED_INSERT }).status, 2, 'Edit fragment is scanned');
    assert.strictEqual(runFlake(root, 'Edit', { file_path: FILE, old_string: HOUR, new_string: 'const ok = 1;\n', content: HOUR }).status, 0, 'Edit ignores a content field');
    assert.strictEqual(runFlake(root, 'Write', { file_path: FILE, content: 'const ok = 1;\n', new_string: HOUR }).status, 0, 'Write ignores new_string');
  });

  test('3.11 no config, no flake_patterns, an empty pattern list, no stack block or no git toplevel allows', () => {
    for (const cfg of [{ stack: { capabilities: {} } }, flakeConfig({ patterns: [] })]) {
      const root = deploy(cfg);
      assert.strictEqual(write(root, HOUR).status, 0, JSON.stringify(cfg).slice(0, 80));
    }
    const inert = deploy();
    fs.writeFileSync(path.join(inert, '.planning', 'config.json'), JSON.stringify(flakeConfig({ patterns: [], test_globs: 'x' })));
    assert.strictEqual(write(inert, HOUR).status, 0, 'an empty pattern list is inert even beside unusable test_globs');
    const root = deploy();
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), '{}');
    assert.strictEqual(write(root, HOUR).status, 0, 'no stack block');
    fs.rmSync(path.join(root, '.planning', 'config.json'));
    assert.strictEqual(write(root, HOUR).status, 0, 'no config file');
    assert.strictEqual(write(deploy(), HOUR, FILE, { cwd: mkTmp('gsd-base-norepo-') }).status, 0, 'not a git repo');
  });

  test('3.11 fail closed: config not JSON or unreadable, a pattern with an invalid regex, wrong shapes, unparseable stdin, a non-string content', () => {
    const root = deploy();
    const cfgFile = path.join(root, '.planning', 'config.json');
    const expectDeny = (r, why) => {
      assert.strictEqual(r.status, 2, `${why}: ${r.stdout}${r.stderr}`);
      assert.ok(r.stderr.includes('fail closed'), `${why}: ${r.stderr}`);
    };
    fs.writeFileSync(cfgFile, '{not json');
    expectDeny(write(root, 'x'), 'not JSON, even for a harmless write');
    fs.rmSync(cfgFile);
    fs.mkdirSync(cfgFile);
    expectDeny(write(root, 'x'), 'config path is a directory (unreadable)');
    fs.rmdirSync(cfgFile);
    const shapes = [
      ['invalid regex', flakeConfig({ patterns: [{ id: 'bad', match: '(unclosed', message: 'm' }] })],
      ['invalid requires_before', flakeConfig({ patterns: [{ id: 'bad', match: 'x', requires_before: '[', message: 'm' }] })],
      ['invalid unless_nearby', flakeConfig({ patterns: [{ id: 'bad', match: 'x', unless_nearby: '*a', message: 'm' }] })],
      ['pattern without match', flakeConfig({ patterns: [{ id: 'bad', message: 'm' }] })],
      ['window 0', flakeConfig({ patterns: [{ id: 'bad', match: 'x', window: 0, message: 'm' }] })],
      ['test_globs not an array', flakeConfig({ test_globs: 'x' })],
      ['patterns not an array', flakeConfig({ patterns: 'x' })],
      ['stack not an object', { stack: 'x' }],
      ['config not an object', ['x']],
    ];
    for (const [why, cfg] of shapes) {
      fs.writeFileSync(cfgFile, JSON.stringify(cfg));
      expectDeny(write(root, 'x'), why);
    }
    fs.writeFileSync(cfgFile, JSON.stringify(flakeConfig()));
    expectDeny(runFlake(root, '', {}, { raw: '{not json' }), 'unparseable stdin');
    expectDeny(runFlake(root, '', {}, { raw: '[1]' }), 'stdin is not an object');
    expectDeny(runFlake(root, 'Write', 'text'), 'tool_input is not an object');
    expectDeny(runFlake(root, 'Write', { file_path: FILE, content: 42 }), 'non-string content');
  });

  test('3.11 the config comes from the git toplevel of the tool call cwd, never from CLAUDE_PROJECT_DIR', () => {
    const configured = deploy();
    const empty = gitRepo({ project: { slug: 'other' }, stack: { capabilities: {} } });
    assert.strictEqual(write(configured, HOUR, FILE, { cwd: configured, projectDir: empty }).status, 2);
    assert.strictEqual(write(configured, HOUR, FILE, { cwd: empty, projectDir: configured }).status, 0);
    const sub = path.join(configured, 'src');
    fs.mkdirSync(sub);
    assert.strictEqual(write(configured, HOUR, FILE, { cwd: sub, projectDir: empty }).status, 2, 'subdirectory finds the toplevel config');
  });

  test('3.11 a missing node is a deny that names the tool (the wrapper uses only builtins)', () => {
    const root = deploy();
    const noPath = mkTmp('gsd-base-nopath-');
    const r = runFlake(root, 'Write', { file_path: FILE, content: 'x' }, { shell: '/bin/bash', env: { PATH: noPath } });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(/node not found/.test(r.stderr), r.stderr);
  });

  const BACKTRACK = flakeConfig({ patterns: [{ id: 'bt', match: '^(a+)+$', message: 'never reached' }] });
  const BT_CONTENT = `${'a'.repeat(40)}!\n`;

  test('3.8 C8 a flake_patterns regex that backtracks is cut at 10 s and denied, fail closed, naming the limit; a normal edit is not delayed', () => {
    const root = deploy(BACKTRACK);
    const t0 = Date.now();
    const r = write(root, BT_CONTENT);
    assert.strictEqual(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('10 s'), r.stderr);
    assert.ok(Date.now() - t0 < 15000, `elapsed ${Date.now() - t0} ms`);
    const t1 = Date.now();
    assert.strictEqual(write(root, 'const ok = 1;\n').status, 0);
    assert.ok(Date.now() - t1 < 5000);
  });

  test('3.8 C8 mutant killed: the alarm removed lets a scan that outlives the limit finish instead of failing closed', () => {
    const root = deploy();
    const fakeBin = mkTmp('gsd-base-fakenode-');
    fs.writeFileSync(path.join(fakeBin, 'node'), '#!/bin/bash\nsleep 12\n', { mode: 0o755 });
    const env = { PATH: `${fakeBin}:${process.env.PATH}` };
    const input = { cwd: root, env };
    assert.strictEqual(write(root, 'x', FILE, input).status, 2, 'with the alarm a 12 s scan is cut at 10 s');
    const mutated = mkTmp('gsd-base-mutant-');
    fs.cpSync(hooksDir(root), mutated, { recursive: true });
    const sh = path.join(mutated, 'check-flake-patterns.sh');
    const source = fs.readFileSync(sh, 'utf8');
    const needle = "'alarm shift; exec @ARGV or exit 127'";
    assert.ok(source.includes(needle), 'mutation site present');
    fs.writeFileSync(sh, source.replace(needle, () => "'shift; exec @ARGV or exit 127'"));
    const r = spawnSync('bash', [sh], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: FILE, content: 'x' }, cwd: root }),
      encoding: 'utf8', cwd: root, env: { ...process.env, ...env },
    });
    assert.strictEqual(r.status, 0, 'the mutant lets the slow scan through');
  });

  test('3.11 --all in a tmp repo exits 1 naming file, line and pattern id, and 0 after a justified ignore; no patterns exits 0', () => {
    const root = deploy();
    const gateFile = path.join(hooksDir(root), 'lib', 'flake-gate.mjs');
    const file = path.join(root, 'src', 'a.integration.test.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `const ok = 1;\n${HOUR}`);
    assert.strictEqual(spawnSync('git', ['-C', root, 'add', 'src/a.integration.test.ts']).status, 0);
    const scan = () => spawnSync(process.execPath, [gateFile, '--all'], { cwd: root, encoding: 'utf8' });
    const red = scan();
    assert.strictEqual(red.status, 1, red.stdout + red.stderr);
    assert.ok(red.stderr.includes('src/a.integration.test.ts:2: [absolute-time-window]'), red.stderr);
    fs.writeFileSync(file, `const ok = 1;\n// flake-ignore: window fixed by design\n${HOUR}`);
    const green = scan();
    assert.strictEqual(green.status, 0, green.stdout + green.stderr);
    assert.ok(green.stdout.includes('(suppressed) src/a.integration.test.ts:3'), green.stdout);
    fs.writeFileSync(file, `const ok = 1;\n// flake-ignore\n${HOUR}`);
    assert.strictEqual(scan().status, 1, 'a marker without a reason still fails the gate');
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify(flakeConfig({ patterns: [] })));
    assert.strictEqual(scan().status, 0);
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), '{not json');
    assert.strictEqual(scan().status, 2, 'unusable config fails the gate');
  });

  test('3.11 glob matching: ** crosses directories, a slash-less glob matches the basename, * stays in one segment', async () => {
    const { globToRegExp, matchesGlobs } = await gate();
    assert.ok(matchesGlobs('a/b/x.integration.test.ts', ['**/*.integration.test.ts']));
    assert.ok(matchesGlobs('x.integration.test.ts', ['**/*.integration.test.ts']));
    assert.ok(matchesGlobs('deep/er/x.test.js', ['*.test.js']), 'basename glob');
    assert.ok(!matchesGlobs('a/b/x.test.js', ['b/*.test.js']), 'a glob with a slash is anchored to the repo path');
    assert.ok(matchesGlobs('src/b/x.js', ['src/**/x.js']));
    assert.ok(!globToRegExp('src/*.js').test('src/a/b.js'));
    assert.ok(globToRegExp('a?.js').test('ab.js'));
    assert.ok(!globToRegExp('a.js').test('axjs'), 'dot is literal');
    assert.ok(matchesGlobs('E2E/A.Integration.Test.ts', ['**/*.integration.test.ts']), 'letter case never matters');
  });

  test('3.11 the runner fixture config is the worked example; the source never evaluates a pattern as code', () => {
    const runner = fs.readFileSync(RUNNER_SRC, 'utf8');
    const blocks = [...runner.matchAll(/<<'JSON'\n(.*)\nJSON\n/g)].map((m) => JSON.parse(m[1]));
    assert.strictEqual(blocks.length, 2);
    assert.deepStrictEqual(blocks[0], flakeConfig().stack.flake_patterns && { stack: { flake_patterns: { test_globs: ['**/*.integration.test.ts'], patterns: WORKED.map((p) => ({ ...p, message: blocks[0].stack.flake_patterns.patterns.find((q) => q.id === p.id).message })) } } });
    const src = fs.readFileSync(GATE_SRC, 'utf8');
    assert.doesNotMatch(src, /\beval\s*\(|new Function|vm\./);
    assert.ok(src.includes('new RegExp(source)'));
  });

  test('3.11 with a pattern list of its own, a flipped own row and a flipped @edit-all row each fail the runner', () => {
    const root = deploy(flakeConfig({ patterns: [{ id: 'own', match: 'zzz-never', message: 'm' }] }));
    const runner = path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh');
    const runWith = (corpus) => {
      const env = { ...process.env, CORPUS: corpus };
      delete env.HOOKS_DIR;
      return spawnSync('bash', [runner], { cwd: root, encoding: 'utf8', env });
    };
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    for (const pick of [(r) => r.hook === 'check-flake-patterns.sh' && r.expect === 'deny' && r.label === 'absolute hour window', (r) => r.hook === '@edit-all']) {
      const i = rows.findIndex(pick);
      assert.ok(i >= 0);
      const flipped = rows.map((r, k) => (k === i ? { ...r, expect: r.expect === 'allow' ? 'deny' : 'allow', reason: 'x' } : r)).slice(Math.max(0, i - 4), i + 5);
      const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
      fs.writeFileSync(corpus, `${flipped.map((r) => JSON.stringify(r)).join('\n')}\n`);
      const r = runWith(corpus);
      assert.notStrictEqual(r.status, 0, r.stdout);
      assert.ok(r.stdout.includes(`:: ${rows[i].label}`), r.stdout);
    }
  });

  test('3.11 the corpus rows are not vacuous: a hook that reads CLAUDE_PROJECT_DIR instead of the cwd toplevel fails the runner', () => {
    const root = deploy(flakeConfig({ patterns: [] }));
    const mutated = mkTmp('gsd-base-mutant-');
    fs.cpSync(hooksDir(root), mutated, { recursive: true });
    const mjs = path.join(mutated, 'lib', 'flake-gate.mjs');
    const source = fs.readFileSync(mjs, 'utf8');
    const needle = '    root = there.root;';
    assert.ok(source.includes(needle), 'mutation site present');
    fs.writeFileSync(mjs, source.replace(needle, '    root = process.env.CLAUDE_PROJECT_DIR ?? null;'));
    const own = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '' && JSON.parse(l).hook === 'check-flake-patterns.sh');
    assert.strictEqual(own.length, 28);
    const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
    fs.writeFileSync(corpus, `${own.join('\n')}\n`);
    const env = { ...process.env, HOOKS_DIR: mutated, CORPUS: corpus };
    const r = spawnSync('bash', [path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh')], { cwd: root, encoding: 'utf8', env });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.ok(r.stdout.includes('FAIL [check-flake-patterns.sh] expect=deny got=allow'), r.stdout);
  });

  test('3.11 the corpus holds 13 own and exactly 12 @edit-all rows, none with a project term; the hook is registered on Write|Edit and guarded', () => {
    const rows = fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    assert.strictEqual(rows.filter((r) => r.hook === 'check-flake-patterns.sh').length, 28);
    const shared = rows.filter((r) => r.hook === '@edit-all');
    assert.strictEqual(shared.length, 13);
    assert.ok(shared.every((r) => r.expect === 'allow'));
    for (const r of [...shared, ...rows.filter((x) => x.hook === 'check-flake-patterns.sh')]) assert.doesNotMatch(JSON.stringify(r), PROJECT_TERM, r.label);
    const frag = JSON.parse(fs.readFileSync(path.join(BASE, 'settings.fragment.json'), 'utf8'));
    const group = frag.hooks.PreToolUse.find((g) => g.matcher === 'Write|Edit|MultiEdit');
    assert.deepStrictEqual(group.hooks, [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/check-flake-patterns.sh', timeout: 15 }]);
    const preset = JSON.parse(fs.readFileSync(path.join(BASE, 'preset.json'), 'utf8'));
    const mine = preset.files.filter((x) => /check-flake-patterns|flake-gate/.test(x.dest));
    assert.strictEqual(mine.length, 2);
    for (const f of mine) assert.strictEqual(f.guarded, true, f.dest);
  });
});
