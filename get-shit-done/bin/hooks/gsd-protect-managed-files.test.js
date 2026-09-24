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

  test('malformed stdin fails open', () => {
    assert.strictEqual(runHook('not json').exitCode, 0);
  });
});
