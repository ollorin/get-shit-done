'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCli, CONFIG, MANIFEST, BASE_DIR, SETTINGS } = require('./project-deploy.js');
const { initWithRegistration } = require('./project-registry.js');
const { renderPreset } = require('./project-deploy-render.js');
const { mergeSettings, serializeSettings } = require('./project-deploy-settings.js');

const PRESETS = path.join(__dirname, '..', 'presets');
const HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false });
const LOCAL_COUNT = 13;

const tmps = [];
afterEach(() => {
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});

const writeAt = (root, rel, content, mode) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
  if (mode !== undefined) fs.chmodSync(path.join(root, rel), mode);
};

// A repo shaped like the igaming project: every preset file present, LOCAL_COUNT of them edited, settings already merged.
function igamingShapedRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-adopt-'));
  tmps.push(root);
  const config = { project: { slug: 'igaming', root }, stack: { capabilities: { backend: {} } } };
  writeAt(root, CONFIG, JSON.stringify(config, null, 2));
  const rendered = renderPreset(path.join(PRESETS, 'igaming'), config);
  assert.strictEqual(rendered.ok, true);
  assert.strictEqual(rendered.files.length, 49);
  const edited = rendered.files.slice(0, LOCAL_COUNT).map((f) => f.dest);
  for (const f of rendered.files) {
    writeAt(root, f.dest, edited.includes(f.dest) ? Buffer.concat([f.content, Buffer.from('\nproject-local line\n')]) : f.content, f.mode);
  }
  const merged = mergeSettings(null, null, rendered.settings);
  writeAt(root, SETTINGS, serializeSettings(merged.settings));
  return { root, rendered, edited };
}

// Every file outside .planning, with its content.
function projectFiles(root) {
  const out = new Map();
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (!r.startsWith('.planning/')) out.set(r, fs.readFileSync(path.join(root, r)).toString('base64'));
    }
  };
  walk('');
  return out;
}

const adopt = (root, command) => runCli(root, [command, '--root', root, '--preset', 'igaming'], process.env, HUMAN);

describe('project adopt', () => {
  test('adopt-diff previews the LOCAL list and writes nothing', () => {
    const { root, edited } = igamingShapedRepo();
    const before = projectFiles(root);
    const r = adopt(root, 'adopt-diff');
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.result.adopt.equal, 49 - LOCAL_COUNT);
    assert.deepStrictEqual([...r.result.adopt.local].sort(), [...edited].sort());
    assert.deepStrictEqual(r.result.adopt.missing, []);
    assert.deepStrictEqual(r.result.written, []);
    assert.strictEqual(fs.existsSync(path.join(root, MANIFEST)), false);
    assert.deepStrictEqual(projectFiles(root), before);
  });

  test('adopt writes the manifest and the mirror only, keeps edited files, and a second adopt is a no-op', () => {
    const { root, rendered, edited } = igamingShapedRepo();
    const before = projectFiles(root);
    const r = adopt(root, 'adopt');
    assert.strictEqual(r.exitCode, 0, JSON.stringify(r.result.errors));
    assert.deepStrictEqual(projectFiles(root), before, 'no project file changed');
    assert.ok(r.result.written.every((p) => p === MANIFEST || p.startsWith(`${BASE_DIR}/`)), r.result.written.join('\n'));
    assert.strictEqual(r.result.written.length, 49 + 1);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
    assert.strictEqual(Object.keys(manifest.files).length, 49);
    for (const f of rendered.files) {
      assert.ok(fs.readFileSync(path.join(root, BASE_DIR, f.dest)).equals(f.content), `mirror holds the preset copy: ${f.dest}`);
    }
    assert.strictEqual(r.result.adopt.local.length, edited.length);

    const afterDiff = adopt(root, 'diff');
    assert.strictEqual(afterDiff.result.conflicts, 0);
    assert.strictEqual(afterDiff.exitCode, 0, JSON.stringify(afterDiff.result.files.filter((f) => f.action !== 'unchanged')));

    const manifestBytes =fs.readFileSync(path.join(root, MANIFEST));
    const again = adopt(root, 'adopt');
    assert.strictEqual(again.exitCode, 0);
    assert.strictEqual(again.result.already_adopted, true);
    assert.deepStrictEqual(again.result.written, []);
    assert.ok(fs.readFileSync(path.join(root, MANIFEST)).equals(manifestBytes));
  });

  test('a missing preset file is reported and left for sync to create', () => {
    const { root, rendered } = igamingShapedRepo();
    const gone = rendered.files[LOCAL_COUNT + 1].dest;
    fs.rmSync(path.join(root, gone));
    const r = adopt(root, 'adopt');
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(r.result.adopt.missing, [gone]);
    assert.strictEqual(fs.existsSync(path.join(root, gone)), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
    assert.strictEqual(manifest.files[gone], undefined);
  });

  test('adopt registers the project once and a second adopt keeps the registry entry', () => {
    const { root } = igamingShapedRepo();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-adopt-home-'));
    tmps.push(home);
    const env = { ...process.env, GSD_HOME: home };
    const args = ['adopt', '--root', root, '--preset', 'igaming'];
    const first = initWithRegistration(root, args, env, () => runCli(root, args, env, HUMAN));
    assert.strictEqual(first.exitCode, 0, JSON.stringify(first.result.errors));
    const entry = JSON.parse(fs.readFileSync(path.join(home, 'projects.json'), 'utf8')).projects.igaming;
    assert.strictEqual(typeof entry.port_base, 'number');
    const second = initWithRegistration(root, args, env, () => runCli(root, args, env, HUMAN));
    assert.strictEqual(second.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(home, 'projects.json'), 'utf8')).projects.igaming, entry);
  });
});
