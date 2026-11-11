'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./project-deploy-render.js');

const tmps = [];

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deploy-render-'));
  tmps.push(dir);
  return dir;
}

afterEach(() => {
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});

function writeFileIn(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function writeManifest(dir, obj) {
  writeFileIn(dir, 'preset.json', JSON.stringify(obj));
}

function makePreset(entries, extra = {}) {
  const dir = mkTmp();
  const files = entries.map(({ content = '', mode, ...entry }) => {
    const abs = writeFileIn(dir, entry.src, content);
    if (mode !== undefined) fs.chmodSync(abs, mode);
    return entry;
  });
  writeManifest(dir, { name: 'demo', version: '1', files, ...extra });
  return dir;
}

function fragmentDir(body) {
  const dir = makePreset([], { settings_fragment: 'settings.fragment.json' });
  writeFileIn(dir, 'settings.fragment.json', typeof body === 'string' ? body : JSON.stringify(body));
  return dir;
}

const CONFIG = { stack: { name: 'web', capabilities: { ui_qa: {} } } };

describe('renderText', () => {
  test('1 substitutes distinct, repeated, number and boolean values', () => {
    const r = R.renderText('{{a.b}} {{a.c}} {{a.b}} {{n.x}} {{t.y}}', {
      a: { b: 'B', c: 'C' },
      n: { x: 42 },
      t: { y: false },
    });
    assert.deepStrictEqual(r, { text: 'B C B 42 false', missing: [], invalid: [] });
  });

  test('2 absent key is missing and kept; null, array, object are invalid; prototype names are missing', () => {
    const src = '{{a.gone}} {{a.n}} {{a.arr}} {{a.obj}} {{a.toString}} {{__proto__.polluted}} {{constructor.name}}';
    const r = R.renderText(src, { a: { n: null, arr: [1], obj: {} } });
    assert.strictEqual(r.text, src);
    assert.deepStrictEqual(r.missing, ['__proto__.polluted', 'a.gone', 'a.toString', 'constructor.name']);
    assert.deepStrictEqual(r.invalid, ['a.arr', 'a.n', 'a.obj']);
  });

  test('3 literal forms stay literal and are reported nowhere', () => {
    const src = '{{ spaced.key }} ${{ secrets.X }} {{single}} {dot.path} {{#if a.b}}x{{/if}}';
    const config = { a: { b: 1 }, spaced: { key: 'S' }, single: 'Z', dot: { path: 'D' } };
    assert.deepStrictEqual(R.renderText(src, config), { text: src, missing: [], invalid: [] });
  });
});

describe('loadPreset', () => {
  test('4 minimal and full presets load with defaults applied', () => {
    const minimal = makePreset([]);
    assert.deepStrictEqual(R.loadPreset(minimal), {
      ok: true,
      errors: [],
      preset: { name: 'demo', version: '1', files: [], settings_fragment: null },
    });

    const full = makePreset(
      [
        { src: 'a.md', dest: '.claude/rules/a.md', content: 'A' },
        {
          src: 'b.bin',
          dest: '.claude/rules/b.bin',
          content: 'B',
          kind: 'block',
          render: false,
          capability: 'ui_qa',
        },
      ],
      { description: 'd', settings_fragment: 'fragment.json' },
    );
    writeFileIn(full, 'fragment.json', '{}');
    const r = R.loadPreset(full);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.preset.files, [
      { src: 'a.md', dest: '.claude/rules/a.md', kind: 'whole', render: true, capability: null, guarded: false },
      { src: 'b.bin', dest: '.claude/rules/b.bin', kind: 'block', render: false, capability: 'ui_qa', guarded: false },
    ]);
    assert.strictEqual(r.preset.settings_fragment, 'fragment.json');
  });

  test('5a shape violations are each reported', () => {
    const cases = [
      [{ name: 'Bad Name', version: '1', files: [] }, 'invalid name'],
      [{ name: 'demo', files: [] }, 'version must be a non-empty string'],
      [{ name: 'demo', version: '1', files: [{ src: 'absent.md', dest: 'a.md' }] }, 'source missing: absent.md'],
      [{ name: 'demo', version: '1', files: [{ src: '../x', dest: 'a.md' }] }, 'invalid path: ../x'],
      [
        { name: 'demo', version: '1', files: [{ src: 'a1.md', dest: 'a.md' }, { src: 'a2.md', dest: 'a.md' }] },
        'duplicate dest: a.md',
      ],
      [{ name: 'demo', version: '1', files: [{ src: 'a1.md', dest: 'a.md', kind: 'partial' }] }, 'invalid kind: partial'],
      [{ name: 'demo', version: '1', files: [], extends: 'base' }, 'unsupported preset key: extends'],
      [{ name: 'demo', version: '1', files: [], packs: ['x'] }, 'unsupported preset key: packs'],
      [{ name: 'demo', version: '1', files: [], foo: 1 }, 'unknown preset key: foo'],
    ];
    for (const [manifest, expected] of cases) {
      const dir = mkTmp();
      writeFileIn(dir, 'a1.md', 'x');
      writeFileIn(dir, 'a2.md', 'x');
      writeManifest(dir, manifest);
      const r = R.loadPreset(dir);
      assert.strictEqual(r.ok, false, expected);
      assert.ok(r.errors.includes(expected), `${expected} not in ${JSON.stringify(r.errors)}`);
    }
  });

  test('5b dest rejections: every listed dest is rejected', () => {
    const bad = [
      '/abs/x',
      'a/../b',
      'a\\b',
      '.claude/settings.json',
      '.claude/settings.local.json',
      '.mcp.json',
      '.env',
      'sub/.env.local',
      '.env.example.local',
      '.planning/config.json',
      '.planning/gsd-project-manifest.json',
      '.planning/.gsd-preset-base/x',
      '.git/hooks/x',
    ];
    for (const d of bad) assert.notStrictEqual(R.validateDest(d), null, d);
  });

  test('5b two violations in one preset are both reported', () => {
    const dir = makePreset([
      { src: 'a.md', dest: '.mcp.json', content: 'x' },
      { src: 'b.md', dest: '.env', content: 'y' },
    ]);
    const r = R.loadPreset(dir);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.errors.length, 2);
  });

  test('5c case and normalisation variants are rejected', () => {
    const bad = [
      '.claude/Settings.json',
      '.claude/settings.LOCAL.json',
      '.MCP.json',
      '.ENV',
      'sub/.Env.local',
      '.GIT/hooks/x',
      '.Planning/Config.json',
    ];
    for (const d of bad) assert.notStrictEqual(R.validateDest(d), null, d);

    const byCase = makePreset([
      { src: 'a1.md', dest: '.claude/rules/A.md', content: '1' },
      { src: 'a2.md', dest: '.claude/rules/a.md', content: '2' },
    ]);
    assert.ok(R.loadPreset(byCase).errors.some((e) => e.startsWith('duplicate dest')));

    const byNfc = makePreset([
      { src: 'a1.md', dest: 'café.md', content: '1' },
      { src: 'a2.md', dest: 'café.md', content: '2' },
    ]);
    assert.ok(R.loadPreset(byNfc).errors.some((e) => e.startsWith('duplicate dest')));
  });

  test('5d allowed dests return null', () => {
    for (const d of ['.env.example', 'sub/.env.example', '.claude/Hooks/x.js', '.claude/rules/Style.md']) {
      assert.strictEqual(R.validateDest(d), null, d);
    }
  });

  test('5e symlinked sources and fragments are rejected and their target is never read', () => {
    const MARK = 'OUTSIDE-MARKER-7f3a';
    const outside = mkTmp();
    writeFileIn(outside, 'secret.md', MARK);
    writeFileIn(outside, 'secret.json', `{"permissions":{"allow":["${MARK}"]}}`);
    const cases = [
      {
        name: 'symlink to a file outside',
        setup: (dir) => fs.symlinkSync(path.join(outside, 'secret.md'), path.join(dir, 'link.md')),
        files: [{ src: 'link.md', dest: '.claude/rules/link.md' }],
        expect: 'not a regular file: link.md',
      },
      {
        name: 'symlink to a file inside the preset',
        setup: (dir) => {
          writeFileIn(dir, 'real.md', 'R');
          fs.symlinkSync(path.join(dir, 'real.md'), path.join(dir, 'link2.md'));
        },
        files: [{ src: 'link2.md', dest: '.claude/rules/link2.md' }],
        expect: 'not a regular file: link2.md',
      },
      {
        name: 'file reached through a symlinked directory',
        setup: (dir) => fs.symlinkSync(outside, path.join(dir, 'linkdir')),
        files: [{ src: 'linkdir/secret.md', dest: '.claude/rules/x.md' }],
        expect: 'escapes preset directory: linkdir/secret.md',
      },
      {
        name: 'settings fragment symlink to a file outside',
        setup: (dir) => fs.symlinkSync(path.join(outside, 'secret.json'), path.join(dir, 'link.json')),
        files: [],
        extra: { settings_fragment: 'link.json' },
        expect: 'not a regular file: link.json',
      },
    ];
    for (const c of cases) {
      const dir = mkTmp();
      c.setup(dir);
      writeManifest(dir, { name: 'demo', version: '1', files: c.files, ...(c.extra ?? {}) });
      const r = R.renderPreset(dir, CONFIG);
      assert.strictEqual(r.ok, false, c.name);
      assert.ok(r.errors.some((e) => e.reason === c.expect), `${c.name}: ${JSON.stringify(r.errors)}`);
      assert.ok(!JSON.stringify(r).includes(MARK), `${c.name}: outside content leaked`);
    }
  });
});

describe('renderPreset', () => {
  test('6 render, render:false bytes, capability gate, mode and order', () => {
    const rawBytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{{a.b}}')]);
    const dir = makePreset([
      { src: 'b.md', dest: '.claude/rules/b.md', content: 'B {{stack.name}}' },
      { src: 'raw.bin', dest: '.claude/rules/raw.bin', content: rawBytes, render: false },
      { src: 'cap.md', dest: '.claude/rules/cap.md', content: 'C', capability: 'ui_qa' },
      { src: 'nocap.md', dest: '.claude/rules/nocap.md', content: 'N', capability: 'missing_cap' },
      { src: 'exec.sh', dest: '.claude/hooks/exec.sh', content: '#!/bin/sh', mode: 0o755 },
    ]);
    const r = R.renderPreset(dir, CONFIG);
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(
      r.files.map((f) => f.dest),
      ['.claude/rules/b.md', '.claude/rules/raw.bin', '.claude/rules/cap.md', '.claude/hooks/exec.sh'],
    );
    const [b, raw, , exec] = r.files;
    assert.strictEqual(b.content.toString('utf8'), 'B web');
    assert.ok(raw.content.equals(rawBytes));
    assert.strictEqual(exec.mode, 0o755);
  });

  test('7 settings fragment: leaves rendered after parse, quote-safe, shape-checked', () => {
    const config = { stack: { name: 'web', q: 'a"b\\c', capabilities: { ui_qa: {} } } };
    const dir = fragmentDir({
      permissions: { allow: ['Bash(echo {{stack.q}})'], deny: [], ask: [] },
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'node {{stack.name}}/x.js', timeout: 5 }] },
        ],
      },
    });
    const r = R.renderPreset(dir, config);
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
    assert.strictEqual(r.settings.permissions.allow[0], 'Bash(echo a"b\\c)');
    assert.strictEqual(r.settings.hooks.PreToolUse[0].hooks[0].command, 'node web/x.js');
    assert.strictEqual(r.settings.hooks.PreToolUse[0].hooks[0].timeout, 5);

    const shapeCases = [
      [{ env: {} }, 'unsupported settings fragment key: env'],
      [{ disableAllHooks: true }, 'unsupported settings fragment key: disableAllHooks'],
      [{ permissions: { allow: 'Bash(x)' } }, 'invalid permissions.allow'],
      [{ hooks: { PreToolUse: [{ hooks: [{ type: 'command', timeout: 5 }] }] } }, 'invalid hook command: PreToolUse'],
    ];
    for (const [body, expected] of shapeCases) {
      const bad = R.renderPreset(fragmentDir(body), CONFIG);
      assert.strictEqual(bad.ok, false, expected);
      assert.ok(bad.errors.some((e) => e.reason === expected), `${expected}: ${JSON.stringify(bad.errors)}`);
    }

    const unparseable = R.renderPreset(fragmentDir('{bad'), CONFIG);
    assert.strictEqual(unparseable.ok, false);
    assert.ok(unparseable.errors.some((e) => e.reason.includes('not valid JSON')));

    const none = R.renderPreset(makePreset([]), CONFIG);
    assert.strictEqual(none.ok, true);
    assert.strictEqual(none.settings, null);
  });

  test('8 a missing or non-scalar key fails the preset with the file and key named', () => {
    const dir = makePreset([{ src: 'x.md', dest: '.claude/rules/x.md', content: 'X {{stack.none}}' }]);
    assert.deepStrictEqual(R.renderPreset(dir, CONFIG).errors, [
      { file: 'x.md', reason: 'missing config key: stack.none' },
    ]);

    const dir2 = makePreset([{ src: 'y.md', dest: '.claude/rules/y.md', content: 'Y {{stack.capabilities}}' }]);
    assert.deepStrictEqual(R.renderPreset(dir2, CONFIG).errors, [
      { file: 'y.md', reason: 'config key is not a scalar: stack.capabilities' },
    ]);
  });

  test('9 a missing preset directory returns one error on preset.json', () => {
    const dir = mkTmp();
    fs.rmSync(dir, { recursive: true, force: true });
    const r = R.renderPreset(dir, CONFIG);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].file, 'preset.json');
  });
});
