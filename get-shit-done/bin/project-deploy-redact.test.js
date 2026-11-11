'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planDeploy, runCli, CONFIG, MANIFEST, SETTINGS } = require('./project-deploy.js');
const { redactShape } = require('./project-deploy-redact.js');

const HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false });
const TOKEN = 'gh' + 'p_' + 'a1B2'.repeat(9);
const HOOK_DEST = ['.claude', 'hooks', 'guard.js'].join('/');
const HOOK_CMD = `node ${HOOK_DEST}`;
const CONFIG_JSON = { project: { slug: 'demo' }, stack: { paths: { backend: 'srv' }, capabilities: {} } };
const FILES = [
  { src: 'rules/style.md', dest: '.claude/rules/style.md', kind: 'whole' },
  { src: 'hooks/guard.js', dest: HOOK_DEST, kind: 'whole' },
];
const FRAGMENT = (allow, command = HOOK_CMD) => ({
  permissions: { allow },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] },
});

const tmpDirs = [];
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

const writeAt = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};

function makePreset(fragment) {
  const dir = mkTmp('gsd-redact-preset-');
  writeAt(dir, 'rules/style.md', '# Style\n');
  writeAt(dir, 'hooks/guard.js', '// guard\n');
  writeAt(dir, 'settings.fragment.json', JSON.stringify(fragment));
  writeAt(dir, 'preset.json', JSON.stringify({ name: 'demo', version: '1', files: FILES, settings_fragment: 'settings.fragment.json' }));
  return dir;
}

function makeProject() {
  const root = mkTmp('gsd-redact-proj-');
  writeAt(root, CONFIG, JSON.stringify(CONFIG_JSON));
  return root;
}

const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const writeJson = (root, rel, value) => writeAt(root, rel, `${JSON.stringify(value, null, 2)}\n`);

describe('M3 redaction of report settings', () => {
  test('R1 redactShape replaces each secret-shaped string with its pattern id and leaves clean strings alone', () => {
    const shape = {
      permissions: { allow: [`Bash(curl -H ${TOKEN})`, 'Bash(ls:*)'], deny: [], ask: [] },
      hooks: [{ event: 'PreToolUse', matcher: 'Bash', command: `echo ${TOKEN}` }],
    };
    const out = redactShape(shape);
    assert.deepStrictEqual(out.permissions.allow, ['<redacted:vcs_token>', 'Bash(ls:*)']);
    assert.deepStrictEqual(out.hooks[0], { event: 'PreToolUse', matcher: 'Bash', command: '<redacted:vcs_token>' });
    assert.ok(!JSON.stringify(out).includes(TOKEN));
    assert.strictEqual(redactShape(shape.permissions.allow[1]), 'Bash(ls:*)');
  });

  test('R2 a secret in a rendered hook command is refused and never appears in the report', () => {
    const root = makeProject();
    const dir = makePreset(FRAGMENT(['Bash(ls:*)'], `curl -H ${TOKEN} ${HOOK_CMD}`));
    const { report } = planDeploy({ root, command: 'init', presetDir: dir, env: {}, session: HUMAN });
    assert.strictEqual(report.ok, false);
    assert.deepStrictEqual(report.settings, { action: 'create', added: null, removed: null, redacted: true });
    assert.ok(!JSON.stringify(report).includes(TOKEN));
  });

  test('R3 an existing allow rule holding a token, removed by sync, is redacted in report.settings.removed', () => {
    const root = makeProject();
    const dir = makePreset(FRAGMENT(['Bash(ls:*)']));
    assert.strictEqual(runCli(root, ['init', '--preset-dir', dir], {}, HUMAN, { confirm: () => 'APPLY' }).exitCode, 0);
    const settings = readJson(root, SETTINGS);
    settings.permissions.allow.push(`Bash(curl -H ${TOKEN})`);
    writeJson(root, SETTINGS, settings);
    const manifest = readJson(root, MANIFEST);
    manifest.settings.permissions.allow.push(`Bash(curl -H ${TOKEN})`);
    writeJson(root, MANIFEST, manifest);

    const { report } = planDeploy({ root, command: 'sync', presetDir: dir, env: {}, session: HUMAN });
    assert.strictEqual(report.ok, true);
    assert.deepStrictEqual(report.settings.removed.permissions.allow, ['<redacted:vcs_token>']);
    assert.ok(!JSON.stringify(report).includes(TOKEN));
  });
});
