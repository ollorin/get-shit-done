'use strict';

// agnostic-M-03 (base preset), the check-denied-command hook and its mutants. Split from preset-base.test.js so the files run in parallel.
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

describe('base preset: check-denied-command hook (agnostic-M-03 3.8 C5)', () => {
  const hooksDir = (root) => path.join(root, '.claude', 'hooks');
  const CORPUS_SRC = path.join(BASE, 'canaries', 'canaries.jsonl');
  const HOOK = 'check-denied-command.sh';
  const deploy = () => {
    const root = gitRepo({ project: { slug: 'demo', owner_title: 'Founder' }, stack: { capabilities: {} } });
    assert.strictEqual(runInit(root, mkTmp('gsd-base-home-')).status, 0);
    return root;
  };
  const run = (root, command, raw) => spawnSync('bash', [path.join(hooksDir(root), HOOK)], {
    input: raw ?? JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root }),
    encoding: 'utf8',
    cwd: root,
  });
  const ownRows = () => fs.readFileSync(CORPUS_SRC, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)).filter((r) => r.hook === HOOK);

  test('3.8 R1 sudo and doas are denied behind env, command, a path, xargs and bash -c; a data mention is allowed', () => {
    const root = deploy();
    for (const c of ['sudo ls', 'env sudo ls', 'command sudo -n true', '/usr/bin/sudo ls', 'xargs sudo rm', 'bash -c "sudo ls"', 'doas ls']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['echo sudo', 'grep -n sudo README.md', 'X=sudo ls']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('3.8 R2 recursive rm of the root, home, cwd or a bare glob is denied in every flag spelling; a named directory and a non-recursive glob are allowed', () => {
    const root = deploy();
    for (const c of ['rm -rf /', 'rm -rf ~/', 'rm -fr *', 'rm -r -f ./*', 'rm -rf -- *', 'rm -rf "$HOME"', 'rm -rf .', 'rm --recursive --force ../*']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['rm -rf dist', 'rm -rf ./build/*', 'rm *', 'rm -f *.log', 'rm -rf /tmp/scratch/x']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('3.8 R3 force push, reset --hard and a forced clean are denied behind -C, -c, a late flag and bash -c; the safe neighbours are allowed', () => {
    const root = deploy();
    for (const c of ['git push origin x --force', 'git push -uf origin x', 'git push origin +x', 'git -C wt push origin x:y --force', 'bash -c "git push --force"',
      'git -c a.b=c reset --hard', 'git -C /tmp/x reset --hard HEAD~1', 'git clean -xdf', 'git clean -d --force']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['git push --force-with-lease origin x', 'git push -u origin feature', 'git reset --soft HEAD~1', 'git clean -n -f -d', 'git clean --dry-run -fd', 'git clean -fdxn']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('3.8 R4 rebase and pull --rebase answer ask with the rendered owner title; a deny in the same command wins', () => {
    const root = deploy();
    for (const c of ['git rebase main', 'git -C wt rebase -i HEAD~3', 'git pull --rebase', 'git pull -r origin main']) {
      const r = run(root, c);
      assert.strictEqual(r.status, 0, c);
      const out = JSON.parse(r.stdout);
      assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'ask', c);
      assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('Founder approval required'), r.stdout);
    }
    assert.strictEqual(run(root, 'git pull origin main').stdout, '');
    assert.strictEqual(run(root, 'git rebase main && git reset --hard').status, 2);
  });

  test('3.8 R6 a reader command given a .env file, a redirect from one or a path under secrets/ is denied; templates and other names are allowed', () => {
    const root = deploy();
    for (const c of ['cat .env', 'cat ./app/server/.env.local', 'grep -n KEY .env', 'head -3 config/secrets/prod.json', 'jq . secrets/token.json', 'tr a b < .env', 'cut -d= -f1 .env.production']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['cat .env.example', 'grep -c . apps/web/.env.sample', 'cp .env.example .env', 'ls -la .env', 'test -f .env', 'cat src/secretsmanager/client.ts', 'grep -n secrets README.md']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('F3 sudo with no command after it, and su in every form, are denied', () => {
    const root = deploy();
    for (const c of ['sudo', 'sudo -i', 'sudo -s', 'sudo --login', 'env sudo -i', '/usr/bin/sudo -s', 'bash -c "sudo -i"', 'doas -s', 'su', 'su -', 'su root']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['echo su', 'echo sudo -i']) assert.strictEqual(run(root, c).status, 0, c);
    for (const c of ['su -c "id" root', 'su -c id']) assert.strictEqual(run(root, c).status, 2, c);    // R2 L3: su is denied like sudo
    assert.strictEqual(run(root, 'su -c "git push --force" root').status, 2);
  });

  test('F2 git grep -O and every abbreviation of --open-files-in-pager are denied; git -c with a command-running key or a ! value is denied; other -c keys are allowed', () => {
    const root = deploy();
    for (const c of ['git grep -Ovim x', 'git grep -nOvim x', 'git grep --open-files-in-pager=vim x', 'git grep --op x', 'git grep --ope=vim x', 'git -C wt grep -O vim x',
      'git -c core.pager=sh log', 'git -c Core.Pager=sh log', 'git -c alias.x=!sh x', 'git -c core.fsmonitor=sh status', 'git -c core.sshCommand=sh fetch', 'git --config-env=core.pager=V log', 'git -c a.b=!ls status']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['git grep -n foo', 'git grep --only-matching foo', 'git grep --or -e a -e b', 'git grep --o foo', 'git grep -e x -- -O', 'git -c user.name=x status', 'git -c color.ui=never log']) {
      assert.strictEqual(run(root, c).status, 0, c);
    }
    assert.ok(run(root, 'git grep -Ovim x').stderr.includes('git grep -O'));
    assert.ok(run(root, 'git -c core.pager=sh log').stderr.includes('can make git run a command'));
  });

  test('F5 rm -r of $PWD, $HOME, ~user and their globs is denied in every spelling; a named child is allowed', () => {
    const root = deploy();
    for (const c of ['rm -rf $PWD', 'rm -rf "$PWD"', 'rm -rf ${PWD}', 'rm -rf $HOME', 'rm -rf "${HOME}"', 'rm -rf ~root', 'rm -rf $PWD/*', 'rm -rf $OLDPWD', 'rm -r -f ${HOME}/.']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['rm -rf $PWD/build', 'rm -rf "$HOME/.cache/x"', 'rm $PWD']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('F4 and F9 key material, credential files and key directories are not read, in any letter case; look-alike names are', () => {
    const root = deploy();
    for (const c of ['cat ~/.ssh/id_rsa', 'cat ~/.aws/credentials', 'cat ~/.config/gh/hosts.yml', 'head .npmrc', 'cat .git-credentials', 'base64 server.pem', 'xxd tls.key', 'cat id_rsa', 'cat id_ed25519',
      'grep -r x ~/.gnupg', 'cp ~/.ssh/id_rsa /tmp/x', 'source ~/.aws/config', 'jq . ~/.aws/config', 'less ~/.SSH/config', 'cat .ENV', 'cat .Env.Local', 'cat SECRETS/x', 'cat config/Secrets/prod.json', 'cat ./KEYS/ID_RSA.old', 'tr a b < .ENV']) assert.strictEqual(run(root, c).status, 2, c);
    for (const c of ['cat keyboard.md', 'cat ~/.config/other', 'cat docs/pem.md', 'cat .npmrc.example', 'cat .ENV.EXAMPLE', 'cat .env.example', 'ls ~/.ssh', 'test -f ~/.aws/credentials']) assert.strictEqual(run(root, c).status, 0, c);
  });

  test('R2 L1 every Bash wrapper resolves its own directory when called by a bare name and exits 2 when lib/run-perl.sh is missing; without the `|| exit 2` it would exit 1', () => {
    const root = deploy();
    const WRAPPERS = ['block-push-without-local-tests', 'check-denied-command', 'check-git-merge-target', 'check-test-command', 'redirect-recursive-search'];
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sudo ls' }, cwd: root });
    const calm = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, cwd: root });
    for (const w of WRAPPERS) {
      const bare = spawnSync('bash', [`${w}.sh`], { input: calm, encoding: 'utf8', cwd: hooksDir(root) });
      assert.strictEqual(bare.status, 0, `${w} by bare name: ${bare.stderr}`);
      const copy = mkTmp('gsd-base-wrapper-');
      fs.cpSync(hooksDir(root), copy, { recursive: true });
      fs.rmSync(path.join(copy, 'lib', 'run-perl.sh'));
      const gone = spawnSync('bash', [path.join(copy, `${w}.sh`)], { input, encoding: 'utf8' });
      assert.strictEqual(gone.status, 2, `${w} with no lib: ${gone.stderr}`);
      const goneBare = spawnSync('bash', [`${w}.sh`], { input, encoding: 'utf8', cwd: copy });
      assert.strictEqual(goneBare.status, 2, `${w} bare with no lib: ${goneBare.stderr}`);
      const loose = fs.readFileSync(path.join(copy, `${w}.sh`), 'utf8');
      assert.ok(loose.includes(' || exit 2'), 'mutation site present');
      fs.writeFileSync(path.join(copy, `${w}.sh`), loose.replace(' || exit 2', ''));
      assert.strictEqual(spawnSync('bash', [path.join(copy, `${w}.sh`)], { input, encoding: 'utf8' }).status, 1, `${w} mutant: the missing lib is rc 1 without the guard`);
    }
  });

  test('R2 M1 a quoted sentence given to an option of an arbitrary program is data; a first argument, an evaluator and a bare command word are still judged; a 28 KB chain of finds passes', () => {
    const root = deploy();
    for (const c of ['deno test --filter "denies sudo"', 'npm test -- -t "blocks git reset --hard"', 'gh pr create --title "feat: deny sudo ls"', 'python3 x.py --msg "sudo reboot"',
      'git commit -m "fix sudo handling"', 'gh issue create --body "git reset --hard docs"', 'find . -name x;'.repeat(1900)]) assert.strictEqual(run(root, c).status, 0, c.slice(0, 80));
    for (const c of ['foo "git push --force"', 'foo bash -c "git push --force"', 'foo --x sh -c "git push -f"', 'foo timeout 5 "git push -f"', 'foo xargs "sudo ls"', 'foo env -S "git push -f"',
      'foo nohup "git push -f"', 'foo exec "rm -rf /"', 'foo watch "git reset --hard"', 'foo --flag git clean -f']) assert.strictEqual(run(root, c).status, 2, c);
    assert.strictEqual(run(root, 'find . -name x;'.repeat(2400)).status, 2, 'over the 32 KB input cap');
  });

  test('3.8 malformed stdin and a non-object tool_input fail closed', () => {
    const root = deploy();
    const a = run(root, '', '{not json');
    assert.strictEqual(a.status, 2);
    assert.ok(a.stderr.includes('not valid JSON'), a.stderr);
    const b = run(root, '', JSON.stringify({ tool_name: 'Bash', tool_input: 'x', cwd: root }));
    assert.strictEqual(b.status, 2);
    assert.ok(b.stderr.includes('crashed'), b.stderr);
  });

  const runnerOf = (root) => path.join(root, 'scripts', 'validation', 'hook-canaries', 'run-canaries.sh');
  const runnerEnv = (extra) => {
    const env = { ...process.env, ...extra };
    if (!extra.CORPUS) delete env.CORPUS;
    if (!extra.HOOKS_DIR) delete env.HOOKS_DIR;
    return env;
  };

  test('3.8 the corpus holds 80 rows of this hook (78 matrix + 2 fail-closed); a flipped row of the hook fails the runner', () => {
    const rows = ownRows();
    assert.strictEqual(rows.length, 301);
    assert.deepStrictEqual(['allow', 'ask', 'deny'].map((e) => rows.filter((r) => r.expect === e).length), [88, 5, 208]);
    const root = deploy();
    const flipped = rows.slice(0, 10).map((r, i) => (i === 0 ? { ...r, expect: 'allow' } : r));
    const corpus = path.join(mkTmp('gsd-base-corpus-'), 'canaries.jsonl');
    fs.writeFileSync(corpus, `${flipped.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const r = spawnSync('bash', [runnerOf(root)], { cwd: root, encoding: 'utf8', env: runnerEnv({ CORPUS: corpus }) });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.ok(r.stdout.includes(`FAIL [${HOOK}] expect=allow got=deny :: ${rows[0].label}`), r.stdout);
  });

  test('3.8 the hook is the fifth Bash command and every file of it is guarded', () => {
    const frag = JSON.parse(fs.readFileSync(path.join(BASE, 'settings.fragment.json'), 'utf8'));
    const bash = frag.hooks.PreToolUse.find((g) => g.matcher === 'Bash');
    assert.strictEqual(bash.hooks[4].command, '"$CLAUDE_PROJECT_DIR"/.claude/hooks/check-denied-command.sh');
    const preset = JSON.parse(fs.readFileSync(path.join(BASE, 'preset.json'), 'utf8'));
    const mine = preset.files.filter((x) => x.dest.includes('check-denied-command'));
    assert.strictEqual(mine.length, 2);
    for (const f of mine) assert.strictEqual(f.guarded, true, f.dest);
  });

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

  const MUTANTS = [
    ['R1 sudo prefix check removed', "if grep { base($_) eq 'sudo' } @prefix;", 'if 0;'],
    ['R1 doas removed', "if $h eq 'doas';", 'if 0;'],
    ['R2 recursive forced on (kills rm *)', 'if $recursive && @bad;', 'if @bad;'],
    ['R2 root_like narrowed to /', "return (grep { $_ !~ /^(?:\\.|\\.\\.|\\.\\*|\\*\\*?)$/ } @seg) ? 0 : 1;", "return $_[0] eq '/' ? 1 : 0;"],
    ['R2 split flag cluster not recognised', '$a =~ /^-[A-Za-z0-9]*[rR]/', '$a =~ /^-[rR]/'],
    ['R3 push checks only the first argument', '/^\\+./ } @a;', '/^\\+./ } ($a[0]);'],
    ['R3 +refspec removed', '|| /^\\+./ } @a;', '} @a;'],
    ['R3 -f cluster removed', "|| /^-[A-Za-z]*f[A-Za-z]*$/", ''],
    ['R3 reset --hard removed', "$g->{sub} eq 'reset' && grep", '0 && grep'],
    ['R3 forced clean removed', 'my $force = grep { /^--f(?:o(?:r(?:c(?:e)?)?)?)?$/ || /^-[A-Za-z]*f/ } @a;', 'my $force = 0;'],
    ['R3 clean dry-run exemption removed', 'if $force && !$dry;', 'if $force;'],
    ['R4 ask turned into exit 0', 'sub ask { print', 'sub ask { exit 0; print'],
    ['R4 pull --rebase removed', "$g->{sub} eq 'pull' &&", '0 &&'],
    ['R6 template exemption removed', '$b !~ /^\\.env[^\\/]*\\.(?:example|sample|template|dist)$/', '1'],
    ['R6 redirect targets ignored', ', map { /^<([^<].*)$/ ? $1 : () } @{ $e->{redirs} }', ''],
    ['R6 secrets directory removed', "return 1 if grep { $_ eq 'secrets' } @seg;", 'return 0;'],
    ['R6 bare .env removed', "return 1 if $b eq '.env';", 'return 0 if 0;'],
    ['R6 .env.<name> removed', '($b =~ /^\\.env\\./ &&', '(0 &&'],
    ['R6 reader grep removed', 'qw(cat head tail less more grep egrep', 'qw(cat head tail less more egrep'],
    ['F3 sudo with no command is skipped again', 'my @r = @{ $e->{rest} };\n  my @w', 'my @r = @{ $e->{rest} }; next unless @r;\n  my @w'],
    ['F3 su removed', "if $h eq 'su';", 'if 0;'],
    ['F2 git grep pager option ignored', 'if grep { is_pager_opt($_) } @opts;', 'if 0;'],
    ['F2 pager abbreviation narrowed to the full name', 'index($PAGER_LONG, $x) == 0', '$x eq $PAGER_LONG'],
    ['F2 git -c command keys ignored', 'if ($k =~ $RUNS_COMMAND && !$reset) ||', 'if'],
    ['F2 git -c ! value ignored', '|| (defined $v && $v =~ /^!/);', ';'],
    ['F5 $PWD not a whole-tree target', '(?:HOME|PWD|OLDPWD)', '(?:HOME)'],
    ['F5 ~user not a whole-tree target', '~\\w*|', '~|'],
    ['F4 key directories removed', "return 1 if grep { /^\\.(?:ssh|a[w]s|gnupg)$/ } @seg, $b;", 'return 0 if 0;'],
    ['F4 .config/gh removed', "eq '.config' && ($seg[$_ + 1] // $b) eq 'gh'", "eq '.config' && 0"],
    ['F4 .npmrc and .git-credentials removed', '/^\\.(?:npmrc|git-credentials)$/ ||', '0 ||'],
    ['F4 .pem and .key removed', '$b =~ /\\.(?:pem|key)$/ ||', '0 ||'],
    ['F4 id_rsa-style names removed', '$b =~ /^id_(?:rsa|dsa|ecdsa|ed25519)/;', '0;'],
    ['F9 comparison made case-sensitive', 'map { lc } grep { length }', 'grep { length }'],
  ];
  for (const [name, needle, replacement] of MUTANTS) {
    test(`3.8 mutant killed: ${name}`, () => {
      const root = deploy();
      const mutated = mkTmp('gsd-base-mutant-');
      fs.cpSync(hooksDir(root), mutated, { recursive: true });
      const pl = path.join(mutated, 'lib', 'check-denied-command.pl');
      const source = fs.readFileSync(pl, 'utf8');
      assert.ok(source.includes(needle), `mutation site present: ${needle}`);
      fs.writeFileSync(pl, source.replace(needle, () => replacement));
      const r = firstFailingChunk(root, ownRows(), mutated);
      assert.notStrictEqual(r.status, 0, `mutant survived: ${name}\n${r.stdout}`);
      assert.ok(r.stdout.includes(`FAIL [${HOOK}]`), r.stdout);
    });
  }
});
