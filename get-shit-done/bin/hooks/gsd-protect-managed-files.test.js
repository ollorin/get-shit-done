'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'gsd-protect-managed-files.js');
const { isProtectedConfigPath, bashConfigViolation } = require('./gsd-protect-managed-files.js');

function runHook(payload, home) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home || os.tmpdir() },
  });
  return { exitCode: r.status, stderr: r.stderr || '' };
}

describe('isProtectedConfigPath', () => {
  for (const p of ['/p/.claude/settings.json', '/p/.claude/settings.local.json', '/h/.claude/hooks/x.sh', '/h/.claude/hooks', '.claude/hooks/a/b.js']) {
    test(`protected: ${p}`, () => assert.strictEqual(isProtectedConfigPath(p), true));
  }
  for (const p of ['/p/.claude/agents/x.md', '/p/.claude/rules/fp.md', '/p/claude/settings.json', '/p/hooks/x.js', '/p/.claude/settingsx/a.json']) {
    test(`not protected: ${p}`, () => assert.strictEqual(isProtectedConfigPath(p), false));
  }
});

describe('bashConfigViolation', () => {
  const blocked = [
    'echo "{}" > ~/.claude/settings.json',
    'echo x >> .claude/settings.local.json',
    'jq ".hooks={}" .claude/settings.json > /tmp/s && mv /tmp/s .claude/settings.json',
    'sed -i "" "s/a/b/" .claude/settings.json',
    'sed --in-place s/a/b/ $HOME/.claude/settings.json',
    'perl -pi -e "s/a/b/" .claude/hooks/guard.sh',
    'rm -rf .claude/hooks',
    'rm ~/.claude/hooks/redirect-recursive-search.sh',
    'echo x | tee -a /Users/u/.claude/hooks/a.sh',
    'cp /tmp/evil.json .claude/settings.json',
    'git checkout -- .claude/settings.json',
    'node -e "require(\'fs\').writeFileSync(\'.claude/settings.json\', \'{}\')"',
    'claude config set disableAllHooks true',
    'echo \'{"disableAllHooks": true}\' > /tmp/x.json',
    'rm -rf .claude',
    'rm -rf ~/.claude/',
    'mv .claude .claude.bak',
    'cd .claude && echo {} > settings.json',
    'cd ~/.claude && rm settings.json',
    'cd ~/.claude/hooks && echo x > guard.sh',
    'touch .claude/settings.json',
    'dd if=/tmp/x of=.claude/settings.json',
  ];
  for (const c of blocked) {
    test(`blocks: ${c}`, () => assert.ok(bashConfigViolation(c), c));
  }
  const allowed = [
    'cat ~/.claude/settings.json',
    'jq .hooks .claude/settings.json',
    'grep -rn guard .claude/hooks',
    'ls .claude/hooks/',
    'cp .claude/settings.json /tmp/backup.json',
    'git diff .claude/settings.json',
    'rm -rf node_modules && cat .claude/settings.json',
    'echo x > .claude/rules/notes.md',
    'npm test',
    'echo x > .claude/settings.json.new',
    'grep -rn disableAllHooks docs/',
    'cd .claude && cat settings.json',
    'cd .claude/rules && echo x > a.md',
    'rm -rf .claude-backup',
    'ls ~/.claude',
  ];
  for (const c of allowed) {
    test(`allows: ${c}`, () => assert.strictEqual(bashConfigViolation(c), null, c));
  }
});

describe('bashConfigViolation: managed hooks dir (RULING A15)', () => {
  const H = '~/.claude/get-shit-done/bin/hooks';
  const blocked = [
    `sed -i '' 's/x/y/' ${H}/gsd-protect-managed-files.js`,
    `sed -i.bak s/x/y/ $HOME/.claude/get-shit-done/bin/hooks/gsd-guard-bash.js`,
    `cp /dev/null ${H}/gsd-charlotte-lock.js`,
    `cp /tmp/evil.js /Users/u/.claude/get-shit-done/bin/hooks/gsd-charlotte-lock.js`,
    `mv /tmp/evil.js ${H}/gsd-protect-managed-files.js`,
    `mv ${H}/gsd-protect-managed-files.js /tmp/x.js`,
    `rm ${H}/gsd-protect-managed-files.js`,
    `rm -rf ${H}`,
    `echo x | tee ${H}/a.js`,
    `echo x > ${H}/a.js`,
    `echo x >> ${H}/a.js`,
    `: > ${H}/gsd-protect-managed-files.js`,
    `> ${H}/gsd-protect-managed-files.js`,
    `truncate -s 0 ${H}/gsd-protect-managed-files.js`,
    `chmod 000 ${H}/gsd-protect-managed-files.js`,
    `cd ${H} && sed -i '' s/a/b/ gsd-protect-managed-files.js`,
    `cd ~/.claude/get-shit-done/bin/hooks && : > gsd-charlotte-lock.js`,
    `cd ~/.claude && rm get-shit-done/bin/hooks/gsd-guard-bash.js`,
    `perl -pi -e 's/a/b/' ${H}/gsd-guard-bash.js`,
    `dd if=/dev/null of=${H}/gsd-guard-bash.js`,
    `ls && cat x; sed -i '' s/a/b/ ${H}/gsd-guard-bash.js`,
  ];
  for (const c of blocked) {
    test(`blocks: ${c}`, () => assert.ok(bashConfigViolation(c), c));
  }
  const allowed = [
    `cat ${H}/gsd-protect-managed-files.js`,
    `ls -la ${H}`,
    `ls ~/.claude/hooks`,
    `node --check ${H}/gsd-protect-managed-files.js`,
    `node ${H}/gsd-protect-managed-files.js`,
    `head -20 ${H}/gsd-charlotte-lock.js | grep -n require`,
    `grep -n foo ${H}/gsd-guard-bash.js`,
    `diff ${H}/a.js /tmp/b.js`,
    `cp ${H}/gsd-guard-bash.js /tmp/copy.js`,
    `cd ${H} && cat gsd-guard-bash.js`,
    `sed -i '' s/a/b/ ~/get-shit-done/get-shit-done/bin/hooks/gsd-guard-bash.js`,
    `sed -n 1,5p ${H}/gsd-guard-bash.js`,
  ];
  for (const c of allowed) {
    test(`allows: ${c}`, () => assert.strictEqual(bashConfigViolation(c), null, c));
  }
});

describe('bashConfigViolation: script writes and patches (RULING A16)', () => {
  const blocked = [
    `python3 -c "import pathlib;pathlib.Path('.claude/settings.local.json').write_text('{}')"`,
    `python3 -c "from pathlib import Path; p=Path('.claude/hooks/x.sh'); p.write_text('exit 0')"`,
    `python3 -c "open('.claude/settings.json','w').write('{}')"`,
    `python3 -c "open('.claude/hooks/a.sh', mode='a').write('x')"`,
    `python3 -c "import shutil; shutil.copy('/tmp/x', '.claude/hooks/a.sh')"`,
    `python3 -c "import os; os.remove('.claude/hooks/a.sh')"`,
    `python3 -c "import pathlib; pathlib.Path('.claude/hooks/a.sh').unlink()"`,
    `python3 - <<'EOF'\nimport pathlib\npathlib.Path('.claude/settings.json').write_bytes(b'{}')\nEOF`,
    `node -e "require('fs').writeFileSync('.claude/hooks/a.sh','x')"`,
    `node -e "fs.createWriteStream('.claude/settings.json')"`,
    `node -e "fs.appendFileSync(process.env.HOME+'/.claude/settings.json','x')"`,
    `perl -e 'open(F, ">.claude/settings.json"); print F "{}"'`,
    `python3 -c "import pathlib;pathlib.Path('$HOME/.claude/get-shit-done/bin/hooks/gsd-guard-bash.js').write_text('')"`,
    `git apply .claude/hooks/fix.patch`,
    `git apply --3way x.patch .claude/settings.json`,
    `patch .claude/hooks/check.sh fix.diff`,
    `ls .claude/hooks; python3 -c "open('.claude/settings.json','w').write('{}')"`,
    `timeout 5 python3 -c "open('.claude/settings.json','w').write('{}')"`,
    `env X=1 node -e "require('fs').writeFileSync('.claude/hooks/a.sh','x')"`,
    `echo go && node -e "require('fs').writeFileSync('.claude/hooks/a.sh','x')"`,
    "grep -n X /tmp/y; python3 - <<'EOF'\nimport pathlib\np=pathlib.Path('.claude/hooks/a.sh')\np.write_text('x')\nEOF",
    `patch -p1 .claude/settings.json < /tmp/nonexistent.diff`,
  ];
  for (const c of blocked) {
    test(`blocks: ${c.replace(/\n/g, ' ')}`, () => assert.ok(bashConfigViolation(c), c));
  }
  const allowed = [
    `python3 -c "print(open('.claude/settings.json').read())"`,
    `python3 -c "import json;print(json.load(open('.claude/settings.json'))['hooks'])"`,
    `python3 -c "import pathlib;print(pathlib.Path('.claude/settings.json').read_text())"`,
    `python3 -c "import pathlib;pathlib.Path('/tmp/out.txt').write_text('x')"`,
    `node -e "console.log(require('fs').readFileSync('.claude/settings.json','utf8'))"`,
    `node -e "fs.writeFileSync('/tmp/out.json','{}')"`,
    `node scripts/build.js`,
    `git apply .tmp/harmless.patch`,
    `git apply --check src.patch`,
    `patch -p1 < /tmp/does-not-exist.diff`,
    // REVIEW-ROUND-2 F4: a protected path only READ elsewhere in the command, interpreter writes elsewhere
    `ls .claude/hooks; python3 -c "open('/tmp/x','w').write('1')"`,
    `git log --oneline -3 -- .claude/hooks; node -e "require('fs').writeFileSync('/tmp/x','1')"`,
    `ls .claude/settings.local.json && python3 -c "open('.tmp/a','a').write('x')"`,
    "cd ~/get-shit-done; grep -n X ~/.claude/get-shit-done/bin/hooks/compression-cache.js; python3 -I - \"$F\" <<'EOF'\nimport sys\np=sys.argv[1]\nopen(p,'w').write('x')\nEOF",
    "cat > scripts/x.sh <<'EOF'\n# patch prepared by an agent for .claude/hooks/** paths\necho ok\nEOF",
    `cat .claude/settings.json | python3 -c "import sys;open('/tmp/o','w').write(sys.stdin.read())"`,
    `git diff -- .claude/hooks`,
    `git log --stat -- .claude/settings.json`,
  ];
  for (const c of allowed) {
    test(`allows: ${c}`, () => assert.strictEqual(bashConfigViolation(c), null, c));
  }

  describe('patch file contents are read', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-protect-patch-'));
    const hookPatch = path.join(tmp, 'hookfix.patch');
    const settingsPatch = path.join(tmp, 'settings.patch');
    const managedPatch = path.join(tmp, 'managed.patch');
    const okPatch = path.join(tmp, 'ok.patch');
    fs.writeFileSync(hookPatch, 'diff --git a/.claude/hooks/x.sh b/.claude/hooks/x.sh\n--- a/.claude/hooks/x.sh\n+++ b/.claude/hooks/x.sh\n@@ -1 +1 @@\n-a\n+b\n');
    fs.writeFileSync(settingsPatch, '--- a/.claude/settings.local.json\n+++ b/.claude/settings.local.json\n@@ -1 +1 @@\n-{}\n+{"x":1}\n');
    fs.writeFileSync(managedPatch, '--- a/get-shit-done/bin/hooks/gsd-guard-bash.js\n+++ b/.claude/get-shit-done/bin/hooks/gsd-guard-bash.js\n@@ -1 +1 @@\n-a\n+b\n');
    fs.writeFileSync(okPatch, '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n');

    test('blocks git apply of a patch whose +++ names .claude/hooks', () => {
      assert.ok(bashConfigViolation(`git apply ${hookPatch}`));
    });
    test('blocks git apply of a patch naming .claude/settings (relative path + cwd)', () => {
      assert.ok(bashConfigViolation('git apply --index settings.patch', tmp));
    });
    test('blocks patch -p1 < file whose header names the managed hooks dir', () => {
      assert.ok(bashConfigViolation(`patch -p1 < ${managedPatch}`));
      assert.ok(bashConfigViolation(`patch -p1 -i ${managedPatch}`));
    });
    test('blocks git -C dir apply of a hook patch', () => {
      assert.ok(bashConfigViolation(`git -C /repo apply ${hookPatch}`));
    });
    test('allows git apply / patch of an unrelated patch', () => {
      assert.strictEqual(bashConfigViolation(`git apply ${okPatch}`), null);
      assert.strictEqual(bashConfigViolation(`patch -p1 < ${okPatch}`), null);
      assert.strictEqual(bashConfigViolation('git apply ok.patch', tmp), null);
    });
    test('process: Bash git apply of a hook patch exits 2 using payload cwd', () => {
      const r = runHook({ tool_name: 'Bash', cwd: tmp, tool_input: { command: 'git apply hookfix.patch' } });
      assert.strictEqual(r.exitCode, 2);
      assert.match(r.stderr, /patch/);
    });
  });
});

describe('bashConfigViolation: pre-flip fixes (OPUS-PREFLIP-CHECK N3, N5, N6, N7)', () => {
  const FLIP = '~/get-shit-done/.planning/gsd-v2/experiments/09-hooks-audit/flip.sh';
  const run = (cmds, cwd) => cmds.map(c => [c, bashConfigViolation(c, cwd)]);
  const blockedAll = (name, cmds, cwd) => {
    for (const c of cmds) test(`${name} blocks: ${c.replace(/\n/g, ' ')}`, () => assert.ok(bashConfigViolation(c, cwd), c));
  };
  const allowedAll = (name, cmds, cwd) => {
    for (const c of cmds) test(`${name} allows: ${c.replace(/\n/g, ' ')}`, () => assert.strictEqual(bashConfigViolation(c, cwd), null, c));
  };

  // N3: only a person in a terminal may run flip.sh --apply / --rollback once hooks are on
  blockedAll('N3', [
    `bash ${FLIP} --apply`,
    `bash ${FLIP} --rollback`,
    `bash ${FLIP} --rollback --approved-by-ceo "hook blocks my test"`,
    `bash ${FLIP} --apply --approved-by-ceo "ok, go on"`,
    `script -q /dev/null bash ${FLIP} --rollback`,
    `printf 'FLIP\\n' | script -q /dev/null bash ${FLIP} --apply`,
    `sudo bash flip.sh --rollback`,
    `env X=1 bash ./flip.sh --apply`,
    `./flip.sh --rollback --dry-run`,
    `./flip.sh --apply --rollback --dry-run`,
    `bash -c "${FLIP} --apply"`,
    `cd /tmp && bash "${FLIP}" --rollback`,
    `zsh flip.sh --smoke --apply`,
  ]);
  allowedAll('N3', [
    `bash ${FLIP} --smoke`,
    `bash ${FLIP} --smoke --dry-run`,
    `bash ${FLIP} --apply --dry-run`,
    `CLAUDE_HOME=/tmp/f/home PROJECT_DIR=/tmp/f/proj bash ${FLIP} --apply --dry-run 2>&1 | head -20`,
    `cat >> RESULT.md <<'EOF'\nbash ${FLIP} --apply\nbash ${FLIP} --rollback\nEOF`,
    `python3 - <<'EOF'\ns=s.replace("""#   flip.sh --apply""","x")\nEOF`,
    `cat ${FLIP}`,
    `sed -n 1,20p flip.sh`,
    `grep -n -- --apply flip.sh`,
    `git diff -- ${FLIP}`,
    `git commit -m "docs: flip.sh --apply is TTY-gated, flip.sh --rollback too"`,
    `echo "run flip.sh --apply in a terminal"`,
    `bash flip-test.sh`,
    `git add -f .planning/gsd-v2/experiments/09-hooks-audit/flip.sh`,
  ]);

  // N5: protect gaps
  blockedAll('N5 trailing redirect', [
    'cp /tmp/x .claude/settings.json 2>/dev/null',
    'cp /tmp/x .claude/settings.json 2>&1',
    'cp /tmp/x .claude/hooks/a.sh >/dev/null 2>&1',
    'cp /tmp/x .claude/hooks/a.sh 2> /dev/null',
    'ln -s /tmp/x .claude/settings.json 2>/dev/null',
    'install -m 644 /tmp/x ~/.claude/hooks/a.sh &>/dev/null',
    'cp /tmp/x .claude/hooks/a.sh --verbose',
    'cp -t .claude/hooks /tmp/x',
  ]);
  blockedAll('N5 directory target', [
    'cp /tmp/settings.json .claude/',
    'cp -R /tmp/hooks .claude/',
    'cp -r /tmp/hooks ~/.claude/',
    'cp -R /tmp/hooks .claude 2>/dev/null',
    'rsync -a /tmp/hooks .claude/',
    'install -m 644 /tmp/x .claude/',
    'sudo cp /tmp/x /repo/.claude/',
  ]);
  allowedAll('N5 reads and look-alikes', [
    'cp .claude/settings.json /tmp/backup.json 2>/dev/null',
    'cp -R .claude/hooks /tmp/hooks-copy',
    'rsync -a .claude/hooks /tmp/copy/',
    'cp /tmp/x .claude/rules/a.md',
    'cp /tmp/x .claude-backup/',
    'echo cp a .claude/',
    'grep -n "cp x .claude/" docs/a.md',
    'ls -la .claude/',
    'ln -sfn /tmp/rv2/cfg /tmp/rv2/ihome2/.claude',
    'cp /tmp/a.json /var/folders/xx/T/fixture/.claude/',
    'cp ~/.claude/settings.json $H/.claude/',
  ]);
  test('N5 persisted cwd: payload cwd inside .claude/hooks', () => {
    const cwd = '/repo/.claude/hooks';
    for (const c of ['echo 1 > check-test-command.sh', "sed -i '' s/a/b/ check-test-command.sh", 'rm check-test-command.sh', 'dd if=/tmp/x of=check-test-command.sh',
      `python3 -c "open('zz','w').write('x')"`]) {
      assert.ok(bashConfigViolation(c, cwd), c);
    }
    for (const c of ['cat check-test-command.sh', 'ls', 'bash check-test-command.sh < /dev/null'.replace(' < /dev/null', ''), 'git status']) {
      assert.strictEqual(bashConfigViolation(c, cwd), null, c);
    }
  });
  test('N5 persisted cwd: payload cwd is .claude itself', () => {
    const cwd = '/repo/.claude';
    assert.ok(bashConfigViolation('echo {} > settings.json', cwd));
    assert.ok(bashConfigViolation('rm settings.local.json', cwd));
    assert.strictEqual(bashConfigViolation('cat settings.json', cwd), null);
    assert.strictEqual(bashConfigViolation('echo x > rules/a.md', cwd), null);
  });
  test('N5 persisted cwd: other directories are unaffected', () => {
    for (const cwd of ['/repo', '/repo/.claude/rules', '/repo/.claude-backup', '/repo/hooks', '', undefined]) {
      assert.strictEqual(bashConfigViolation('echo 1 > check-test-command.sh', cwd), null, String(cwd));
    }
  });
  blockedAll('N5 chained cd', [
    'cd .claude; cd hooks; echo 1 > check-test-command.sh',
    "cd .claude && cd hooks && sed -i '' s/a/b/ x.sh",
    'cd .claude && cd ./hooks/lib && touch ShellParse.pm',
    'pushd .claude/hooks && echo 1 > a.sh',
    'pushd .claude; cd hooks; touch a',
    'cd .claude/hooks && dd if=/tmp/x of=a.sh',
    'cd ~/.claude/hooks/lib && dd if=/tmp/x of=y',
  ]);
  allowedAll('N5 chained cd', [
    'cd .claude; cd rules; echo x > a.md',
    'cd .claude && cd hooks && cat a.sh',
    'pushd .claude/rules && echo x > a.md',
    'cd hooks && echo 1 > a.sh',
  ]);
  blockedAll('N5 interpreter calls', [
    `deno eval "Deno.writeTextFileSync('.claude/hooks/a.sh','x')"`,
    `deno eval "await Deno.writeTextFile('.claude/settings.json','{}')"`,
    `deno eval "Deno.removeSync('.claude/hooks/a.sh')"`,
    `deno eval "Deno.writeFileSync('.claude/hooks/a.sh', new Uint8Array())"`,
    `bun -e "Bun.write('.claude/hooks/a.sh','x')"`,
    `ruby -e "File.write('.claude/hooks/a.sh','x')"`,
    `ruby -e "FileUtils.rm_rf('.claude/hooks')"`,
    `perl -e 'open(my $fh, ">", ".claude/settings.json"); print $fh "{}"'`,
    `perl -e "open(FH, '>>', '.claude/hooks/a.sh'); print FH 1"`,
  ]);
  allowedAll('N5 interpreter calls', [
    `deno eval "Deno.writeTextFileSync('/tmp/x','1')"`,
    `deno eval "console.log(Deno.readTextFileSync('.claude/settings.json'))"`,
    `bun -e "Bun.write('/tmp/x','1')"`,
    `ruby -e "puts File.read('.claude/settings.json')"`,
    `perl -e 'open(my $fh, "<", ".claude/settings.json"); print <$fh>'`,
  ]);

  // N6: git write verbs count only in the subcommand position
  allowedAll('N6', [
    'git diff A B -- .claude/hooks scripts/hooks-apply.sh',
    'git log --stat -- .claude/hooks scripts/hooks-apply.sh',
    'git show HEAD -- .claude/settings.json scripts/rm-old.sh',
    'git -C /repo diff -- .claude/hooks scripts/hooks-apply.sh',
    'git diff --stat -- .claude/hooks/lib/stash.pl',
  ]);
  blockedAll('N6', [
    'git checkout -- .claude/settings.json',
    'git -C /repo restore .claude/hooks/x',
    'git --no-pager checkout -- .claude/hooks',
    'git -c a=b apply .claude/hooks/p.patch',
    '/usr/bin/git rm .claude/hooks/x',
    'git stash push -- .claude/settings.json',
    'cd /repo && git mv .claude/hooks/a .claude/hooks/b',
  ]);

  // N7: F4 coverage restored for chdir, receiver Path and $D assignment
  blockedAll('N7', [
    `python3 -c "from pathlib import Path; y=Path('.claude/hooks/a'); x=Path('/tmp/a'); y.write_text('2')"`,
    `python3 -c "import os; os.chdir('.claude/hooks'); open('a','w').write('x')"`,
    `python3 - <<'EOF'\nimport os\nos.chdir('.claude/hooks')\nopen('a','w').write('x')\nEOF`,
    `node -e "process.chdir('.claude/hooks'); require('fs').writeFileSync('a','1')"`,
    `D=.claude/hooks; python3 -c "open('$D/a','w').write('x')"`,
    `D=.claude/hooks; python3 -c "import sys; open(sys.argv[1],'w').write('x')" $D/a`,
    `export D=~/.claude/settings.json; node -e "require('fs').writeFileSync(process.argv[1],'x')" $D`,
  ]);
  allowedAll('N7', [
    `python3 -c "open('/tmp/a','w').write(open('.claude/hooks/x').read())"`,
    `python3 -c "from pathlib import Path; Path('/tmp/a').write_text(Path('.claude/hooks/x').read_text())"`,
    `python3 -c "import os; os.chdir('/tmp'); open('a','w').write('x')"`,
    `D=/tmp; python3 -c "open('$D/a','w').write('x')"`,
    `D=/tmp; python3 -c "import sys; open(sys.argv[1],'w').write('x')" $D/a`,
    `python3 -c "from pathlib import Path; y=Path('/tmp/a'); y.write_text('2')"`,
  ]);
});

describe('hook process', () => {
  test('negative: Edit of a project .claude/settings.json exits 2 and names the allowed path', () => {
    const r = runHook({ tool_name: 'Edit', tool_input: { file_path: '/repo/.claude/settings.json' } });
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /PROTECTED CLAUDE CONFIG/);
    assert.match(r.stderr, /Allowed path:/);
    assert.match(r.stderr, /ask the user to apply the change themselves/);
  });

  test('negative: Write into ~/.claude/hooks/ exits 2', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-protect-home-'));
    try {
      const r = runHook({ tool_name: 'Write', tool_input: { file_path: path.join(home, '.claude', 'hooks', 'new.sh') } }, home);
      assert.strictEqual(r.exitCode, 2);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('negative: relative path resolves against the hook cwd', () => {
    const r = runHook({ tool_name: 'Write', cwd: '/repo', tool_input: { file_path: '.claude/settings.local.json' } });
    assert.strictEqual(r.exitCode, 2);
  });

  test('negative: symlinked directory into .claude/hooks is resolved and blocked', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-protect-link-'));
    try {
      fs.mkdirSync(path.join(base, '.claude', 'hooks'), { recursive: true });
      fs.symlinkSync(path.join(base, '.claude', 'hooks'), path.join(base, 'innocent'));
      const r = runHook({ tool_name: 'Write', tool_input: { file_path: path.join(base, 'innocent', 'x.sh') } });
      assert.strictEqual(r.exitCode, 2);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('negative: Bash disableAllHooks exits 2', () => {
    const r = runHook({ tool_name: 'Bash', tool_input: { command: 'claude config set disableAllHooks true' } });
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /disableAllHooks/);
  });

  test('allowed: unrelated Write and read-only Bash exit 0', () => {
    assert.strictEqual(runHook({ tool_name: 'Write', tool_input: { file_path: '/repo/src/a.ts' } }).exitCode, 0);
    assert.strictEqual(runHook({ tool_name: 'Bash', tool_input: { command: 'cat .claude/settings.json' } }).exitCode, 0);
  });

  test('malformed stdin fails closed with a reason (RULING A8)', () => {
    for (const bad of ['not json', '', '{not json deno task test', 'null', '42']) {
      const r = runHook(bad);
      assert.strictEqual(r.exitCode, 2, `stdin ${JSON.stringify(bad)}`);
      assert.match(r.stderr, /not valid JSON/);
    }
  });

  test('valid JSON for an unrelated tool still exits 0', () => {
    assert.strictEqual(runHook({ tool_name: 'Read', tool_input: {} }).exitCode, 0);
  });
});
