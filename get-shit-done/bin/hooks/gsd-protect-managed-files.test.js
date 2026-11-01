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
