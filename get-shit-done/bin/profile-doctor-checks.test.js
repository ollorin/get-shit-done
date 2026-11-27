'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const checks = require('./profile-doctor-checks.js');
const { doctorFindings, isBlocking, gateDefaults } = require('./profile-defaults.js');
const { renderPreset } = require('./project-deploy-render.js');
const { sha256 } = require('./project-deploy-files.js');
const { CONFIG, MANIFEST, BASE_DIR } = require('./project-deploy.js');

const { HOOK_DOC, writeCompleteHome } = require('./profile-doctor-test-home.js');

const GSD_TOOLS = path.join(__dirname, 'gsd-tools.js');
const RULE = '# Style\n\nline one\nline two\nline three\nline four\n';
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
const readText = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function treeHashes(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out.push([r, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, r))).digest('hex')]);
    }
  };
  walk('');
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// A preset root holding one preset `demo` with one whole file and one script; the project is deployed from it.
function makePresetsRoot(rule = RULE) {
  const presetsRoot = mkTmp('gsd-dc-presets-');
  const dir = path.join(presetsRoot, 'demo');
  writeAt(dir, 'rules/style.md', rule);
  writeAt(dir, 'scripts/gate.sh', 'echo gate\n');
  writeAt(dir, 'preset.json', JSON.stringify({
    name: 'demo',
    version: '1',
    files: [
      { src: 'rules/style.md', dest: '.claude/rules/style.md', kind: 'whole' },
      { src: 'scripts/gate.sh', dest: 'scripts/gate.sh', kind: 'whole' },
    ],
  }));
  return presetsRoot;
}

function deployedProject(presetsRoot) {
  const root = mkTmp('gsd-dc-proj-');
  const config = { project: { slug: 'demo' }, stack: { preset: 'demo' } };
  writeAt(root, CONFIG, JSON.stringify(config));
  const rendered = renderPreset(path.join(presetsRoot, 'demo'), config);
  const files = Object.fromEntries(rendered.files.map((f) => {
    writeAt(root, f.dest, f.content);
    writeAt(root, `${BASE_DIR}/${f.dest}`, f.content);
    return [f.dest, { kind: f.kind, sha256: sha256(f.content), guarded: false }];
  }));
  writeAt(root, MANIFEST, JSON.stringify({ manifest_version: 1, preset: { name: 'demo', version: '1' }, files }));
  return { root, stack: config.stack };
}

const makeHome = () => writeCompleteHome(mkTmp('gsd-dc-home-'));

const blockingOf = (findings) => findings.filter(checks.isBlockingFinding);
const kinds = (findings) => findings.map((f) => `${f.kind} ${f.key}`);

describe('profile doctor checks (WP22d)', () => {
  test('a complete project and home have no blocking finding', () => {
    const presetsRoot = makePresetsRoot();
    const { root, stack } = deployedProject(presetsRoot);
    const found = checks.projectChecks(root, stack, { home: makeHome(), presetsRoot, gsdDir: mkTmp('gsd-dc-gsd-') });
    assert.deepStrictEqual(kinds(found), ['INFO project upgrade']);
    assert.deepStrictEqual(blockingOf(found), []);
  });

  test('file drift: a preset change is DRIFT, an absent file MISSING, a kept local edit LOCAL and not blocking', () => {
    const presetsRoot = makePresetsRoot();
    const { root, stack } = deployedProject(presetsRoot);
    writeAt(presetsRoot, 'demo/rules/style.md', `${RULE}line five\n`);
    fs.rmSync(path.join(root, 'scripts/gate.sh'));
    const found = checks.fileFindings(root, stack, presetsRoot);
    assert.deepStrictEqual(kinds(found), ['DRIFT .claude/rules/style.md', 'MISSING scripts/gate.sh']);
    assert.strictEqual(blockingOf(found).length, 2);

    const local = deployedProject(makePresetsRoot());
    writeAt(local.root, 'scripts/gate.sh', 'echo gate\necho local\n');
    const kept = checks.fileFindings(local.root, local.stack, makePresetsRoot());
    assert.deepStrictEqual(kinds(kept), ['LOCAL scripts/gate.sh']);
    assert.deepStrictEqual(blockingOf(kept), []);
  });

  test('file drift: an overlapping local and preset edit is a blocking conflict', () => {
    const presetsRoot = makePresetsRoot();
    const { root, stack } = deployedProject(presetsRoot);
    writeAt(root, '.claude/rules/style.md', RULE.replace('line two', 'local two'));
    writeAt(presetsRoot, 'demo/rules/style.md', RULE.replace('line two', 'preset two'));
    const found = checks.fileFindings(root, stack, presetsRoot);
    assert.deepStrictEqual(kinds(found), ['DRIFT .claude/rules/style.md']);
    assert.strictEqual(blockingOf(found).length, 1);
  });

  test('file drift: a project with a preset but no manifest is information, not a block', () => {
    const root = mkTmp('gsd-dc-proj-');
    const found = checks.fileFindings(root, { preset: 'demo' }, makePresetsRoot());
    assert.deepStrictEqual(kinds(found), [`INFO ${MANIFEST}`]);
    assert.deepStrictEqual(checks.fileFindings(root, {}, makePresetsRoot()), []);
  });

  test('hooks: an unregistered hook is a blocking MISSING; a project settings.local.json registration counts', () => {
    const home = makeHome();
    const root = mkTmp('gsd-dc-proj-');
    const withoutOwner = { hooks: { ...HOOK_DOC.hooks, UserPromptSubmit: [] } };
    writeAt(home, '.claude/settings.json', JSON.stringify(withoutOwner));
    const missing = checks.hookFindings(root, home);
    assert.deepStrictEqual(kinds(missing), ['MISSING hooks.UserPromptSubmit']);
    assert.strictEqual(blockingOf(missing).length, 1);
    writeAt(root, '.claude/settings.local.json', JSON.stringify({ hooks: { UserPromptSubmit: HOOK_DOC.hooks.UserPromptSubmit } }));
    assert.deepStrictEqual(checks.hookFindings(root, home), []);
  });

  test('hooks: a matcher-bound hook registered under another matcher is still missing', () => {
    const home = makeHome();
    const wrong = { hooks: { ...HOOK_DOC.hooks, PreToolUse: HOOK_DOC.hooks.PreToolUse.filter((g) => g.matcher !== 'Edit' || g.hooks[0].command.includes('qa-lock')) } };
    writeAt(home, '.claude/settings.json', JSON.stringify(wrong));
    assert.deepStrictEqual(kinds(checks.hookFindings(mkTmp('gsd-dc-proj-'), home)), ['MISSING hooks.PreToolUse[Edit]']);
  });

  test('hooks: settings with comments and trailing commas are read; a corrupt file is a blocking finding naming it', () => {
    const home = makeHome();
    const root = mkTmp('gsd-dc-proj-');
    writeAt(home, '.claude/settings.json', `// user settings\n${JSON.stringify(HOOK_DOC, null, 2).replace(/\}\s*$/, ',}')}`);
    assert.deepStrictEqual(checks.hookFindings(root, home), []);
    writeAt(root, '.claude/settings.local.json', '{ "hooks": ');
    const found = checks.hookFindings(root, home);
    assert.deepStrictEqual(kinds(found), ['DRIFT .claude/settings.local.json']);
    assert.strictEqual(blockingOf(found).length, 1);
  });

  test('framework: a modified deployed file is LOCAL, a missing install manifest or file is blocking, patches are INFO', () => {
    const home = makeHome();
    writeAt(home, '.claude/get-shit-done/VERSION', '1.0.1\n');
    writeAt(home, '.claude/gsd-local-patches/backup-meta.json', JSON.stringify({ files: ['agents/x.md'] }));
    const found = checks.frameworkFindings(home);
    assert.deepStrictEqual(kinds(found), ['LOCAL ~/.claude/get-shit-done/VERSION', 'INFO ~/.claude/gsd-local-patches']);
    assert.deepStrictEqual(blockingOf(found), []);

    fs.rmSync(path.join(home, '.claude/get-shit-done/VERSION'));
    assert.deepStrictEqual(kinds(checks.frameworkFindings(home)).slice(0, 1), ['MISSING ~/.claude/get-shit-done/VERSION']);
    fs.rmSync(path.join(home, '.claude/gsd-file-manifest.json'));
    assert.deepStrictEqual(kinds(checks.frameworkFindings(home)), ['MISSING ~/.claude/gsd-file-manifest.json']);
  });

  test('migrations: stack.mutation.error_pattern is information while the tool accepts it, blocking once it refuses', () => {
    const stack = { mutation: { error_pattern: 'x' } };
    const off = checks.migrationFindings(stack, false);
    const on = checks.migrationFindings(stack, true);
    assert.deepStrictEqual([blockingOf(off).length, blockingOf(on).length], [0, 1]);
    assert.strictEqual(checks.MUTATION_REFUSES_ERROR_PATTERN, false);
    assert.deepStrictEqual(checks.migrationFindings({ mutation: { build_error_pattern: 'x' } }, true), []);
  });

  test('gates: an igaming-shaped project gets no MISSING gate for scripts its preset does not ship', () => {
    const presetsRoot = makePresetsRoot();
    const root = mkTmp('gsd-dc-proj-');
    const stack = { preset: 'demo', gates: [] };
    const gateKeys = (findings) => findings.filter((f) => f.key.startsWith('stack.gates.'));
    const all = gateKeys(doctorFindings(stack));
    assert.ok(all.length >= 8 && all.every((f) => f.kind === 'MISSING'));
    const scoped = gateKeys(doctorFindings(stack, { hasScript: checks.presetGateScripts(root, stack, presetsRoot) }));
    assert.ok(scoped.every((f) => f.kind === 'INFO' && !isBlocking(f)));
    assert.strictEqual(scoped.length, all.length);
  });

  test('gates: a default gate whose script the preset ships, or the project has on disk, still applies', () => {
    const presetsRoot = makePresetsRoot();
    const root = mkTmp('gsd-dc-proj-');
    writeAt(root, 'scripts/style-gate.mjs', '');
    const stack = { preset: 'demo', gates: [] };
    const hasScript = checks.presetGateScripts(root, stack, presetsRoot);
    assert.strictEqual(hasScript('scripts/gate.sh'), true);
    const style = doctorFindings(stack, { hasScript }).find((f) => f.key === 'stack.gates.style');
    assert.deepStrictEqual([style.kind, isBlocking(style)], ['MISSING', true]);
  });

  test('read-only: the checks and the CLI change no byte of the project or the home', () => {
    const presetsRoot = makePresetsRoot();
    const { root, stack } = deployedProject(presetsRoot);
    const home = makeHome();
    writeAt(root, 'scripts/gate.sh', 'echo local\n');
    writeAt(root, '.claude/settings.local.json', '{ "hooks": ');
    writeAt(root, CONFIG, JSON.stringify({ project: { slug: 'demo' }, stack: { ...stack, mutation: { error_pattern: 'x' } } }));
    const before = [treeHashes(root), treeHashes(home)];
    checks.projectChecks(root, stack, { home, presetsRoot });
    spawnSync(process.execPath, [GSD_TOOLS, 'profile', 'doctor'], { cwd: root, encoding: 'utf-8', env: { ...process.env, HOME: home } });
    assert.deepStrictEqual([treeHashes(root), treeHashes(home)], before);
  });

  test('CLI: a complete project exits 0 with the summary line, a missing hook exits 1 with a MISSING line', () => {
    const root = mkTmp('gsd-dc-proj-');
    const home = makeHome();
    const stack = {
      commands: { test_file: 'npm test -- {file}', test_all: 'npm test', typecheck: 'tsc', lint: 'eslint .', format: 'p', test_unit: 'u' },
      mutation: { build_error_pattern: 'x' },
      host: { worker_patterns: ['vitest'] },
      isolation: { port_base: 55000 },
      gates: gateDefaults(undefined),
    };
    writeAt(root, CONFIG, JSON.stringify({ stack }));
    const env = { ...process.env, HOME: home };
    const ok = spawnSync(process.execPath, [GSD_TOOLS, 'profile', 'doctor'], { cwd: root, encoding: 'utf-8', env });
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /doctor: up to date \(0 blocking, \d+ other\)\n$/);

    writeAt(home, '.claude/settings.json', JSON.stringify({ hooks: {} }));
    const bad = spawnSync(process.execPath, [GSD_TOOLS, 'profile', 'doctor'], { cwd: root, encoding: 'utf-8', env });
    assert.strictEqual(bad.status, 1);
    assert.match(bad.stdout, /^MISSING hooks\.Stop -> register session-end-standalone\.js \(error: /m);
    assert.match(bad.stdout, /doctor: NOT up to date \(\d+ blocking, \d+ other\)\n$/);
  });
});
