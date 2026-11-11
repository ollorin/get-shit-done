'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCli, CONFIG, SETTINGS, MANIFEST } = require('./project-deploy.js');
const { sha256 } = require('./project-deploy-files.js');

const HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false });
const HOOK_DEST = ['.claude', 'hooks', 'guard.js'].join('/');
const HOOK_CMD = `node ${HOOK_DEST}`;
const CONFIG_JSON = { project: { slug: 'demo' }, stack: { paths: { backend: 'srv' }, capabilities: {} } };
const RULE = '# Style\n\nrule body\n';
const HOOK = '// guard\nprocess.exit(0);\n';
const FILES = [
  { src: 'rules/style.md', dest: '.claude/rules/style.md', kind: 'whole' },
  { src: 'hooks/guard.js', dest: HOOK_DEST, kind: 'whole' },
];
const FRAGMENT = (allow = ['Bash(ls:*)'], hooks = true) => (hooks
  ? { permissions: { allow }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: HOOK_CMD }] }] } }
  : { permissions: { allow } });

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

function makeProject() {
  const root = mkTmp('gsd-confirm-proj-');
  writeAt(root, CONFIG, JSON.stringify(CONFIG_JSON));
  return root;
}

function makePreset({ rule = RULE, hook = HOOK, fragment = FRAGMENT() } = {}) {
  const dir = mkTmp('gsd-confirm-preset-');
  writeAt(dir, 'rules/style.md', rule);
  writeAt(dir, 'hooks/guard.js', hook);
  writeAt(dir, 'settings.fragment.json', JSON.stringify(fragment));
  writeAt(dir, 'preset.json', JSON.stringify({ name: 'demo', version: '1', files: FILES, settings_fragment: 'settings.fragment.json' }));
  return dir;
}

function snapshot(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out.push([r, sha256(fs.readFileSync(path.join(root, r)))]);
    }
  };
  walk('');
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const ask = (answer) => {
  const asked = [];
  return { asked, io: { confirm: (text) => { asked.push(text); return answer; } } };
};

const cli = (root, command, presetDir, io, session = HUMAN) => runCli(root, [command, '--preset-dir', presetDir], {}, session, io);

function initialised(fragment) {
  const root = makeProject();
  const dir = makePreset({ fragment });
  const init = ask('APPLY');
  assert.strictEqual(cli(root, 'init', dir, init.io).exitCode, 0);
  assert.strictEqual(init.asked.length, 0, 'fresh init is exempt and never prompts');
  return { root, dir };
}

describe('M4 typed confirmation', () => {
  test('C1 the exact answer APPLY writes the guarded change', () => {
    const { root, dir } = initialised();
    const HOOK2 = '// guard v2\nprocess.exit(0);\n';
    writeAt(dir, 'hooks/guard.js', HOOK2);
    const { asked, io } = ask('APPLY');
    const res = cli(root, 'sync', dir, io);
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(asked.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(root, HOOK_DEST), 'utf8'), HOOK2);
  });

  for (const answer of ['apply', '', 'APPLY ', 'yes']) {
    test(`C2 answer ${JSON.stringify(answer)} writes nothing and refuses with confirmation declined`, () => {
      const { root, dir } = initialised();
      writeAt(dir, 'hooks/guard.js', '// guard v2\n');
      const before = snapshot(root);
      const { asked, io } = ask(answer);
      const res = cli(root, 'sync', dir, io);
      assert.strictEqual(res.exitCode, 1);
      assert.strictEqual(res.result.refused.reason, 'confirmation declined');
      assert.deepStrictEqual(res.result.written, []);
      assert.strictEqual(asked.length, 1);
      assert.deepStrictEqual(snapshot(root), before);
    });
  }

  test('C3 diff never prompts, even with a guarded change', () => {
    const { root, dir } = initialised();
    writeAt(dir, 'hooks/guard.js', '// guard v2\n');
    const { asked, io } = ask('APPLY');
    const res = cli(root, 'diff', dir, io);
    assert.strictEqual(res.exitCode, 2);
    assert.strictEqual(asked.length, 0);
  });

  test('C4 an unguarded sync never prompts', () => {
    const { root, dir } = initialised();
    writeAt(dir, 'rules/style.md', '# Style v2\n');
    const { asked, io } = ask('');
    const res = cli(root, 'sync', dir, io);
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(asked.length, 0);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/rules/style.md'), 'utf8'), '# Style v2\n');
  });

  test('C5 an init over an existing settings file is not exempt and prompts', () => {
    const root = makeProject();
    writeAt(root, SETTINGS, '{}\n');
    const dir = makePreset();
    const { asked, io } = ask('APPLY');
    assert.strictEqual(cli(root, 'init', dir, io).exitCode, 0);
    assert.strictEqual(asked.length, 1);
  });

  test('C6 the text lists an added allow rule and a removed hook triple verbatim', () => {
    const { root, dir } = initialised();
    writeAt(dir, 'settings.fragment.json', JSON.stringify(FRAGMENT(['Bash(ls:*)', 'Bash(git:*)'], false)));
    const { asked, io } = ask('');
    cli(root, 'sync', dir, io);
    assert.strictEqual(asked.length, 1);
    assert.ok(asked[0].includes(`+ permission allow: ${JSON.stringify('Bash(git:*)')}`));
    const removed = { event: 'PreToolUse', matcher: 'Bash', command: HOOK_CMD };
    assert.ok(asked[0].includes(`- hook: ${JSON.stringify(removed)}`));
  });

  test('C7 an ESC byte in a guarded file is rendered as the escape text, not the raw byte', () => {
    const { root, dir } = initialised();
    writeAt(dir, 'hooks/guard.js', '// guard\u001b[2J\nprocess.exit(0);\n');
    const { asked, io } = ask('');
    cli(root, 'sync', dir, io);
    assert.strictEqual(asked.length, 1);
    assert.ok(asked[0].includes('\\u001b[2J'));
    assert.ok(!asked[0].includes('\u001b'));
  });

  test('C8 the sha256 shown is the sha256 of the bytes APPLY then writes', () => {
    const { root, dir } = initialised();
    const HOOK2 = '// guard v2\nprocess.exit(0);\n';
    writeAt(dir, 'hooks/guard.js', HOOK2);
    const { asked, io } = ask('APPLY');
    assert.strictEqual(cli(root, 'sync', dir, io).exitCode, 0);
    assert.ok(asked[0].includes(`new sha256: ${sha256(Buffer.from(HOOK2))}`));
    assert.strictEqual(sha256(fs.readFileSync(path.join(root, HOOK_DEST))), sha256(Buffer.from(HOOK2)));
  });

  test('C9 a sync that changes settings only (no hook) prompts, because settings is a guarded write', () => {
    const { root, dir } = initialised();
    writeAt(dir, 'settings.fragment.json', JSON.stringify(FRAGMENT(['Bash(ls:*)', 'Bash(git:*)'])));
    const { asked, io } = ask('APPLY');
    assert.strictEqual(cli(root, 'sync', dir, io).exitCode, 0);
    assert.strictEqual(asked.length, 1);
    assert.ok(fs.readFileSync(path.join(root, SETTINGS), 'utf8').includes('Bash(git:*)'));
    assert.ok(fs.existsSync(path.join(root, MANIFEST)));
  });
});
