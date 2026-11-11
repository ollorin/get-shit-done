'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./project-deploy-render.js');
const { mergeSettings } = require('./project-deploy-settings.js');

const PRESET = path.join(__dirname, '..', 'presets', 'igaming');
const IGAMING_ROOT = '/Users/ollorin/igaming-platform';
const PIN_SHA = '95a02959e5fa464f3bcce11378c803f7b86ec76d';
const GOLDEN_REPO = process.env.GSD_IGAMING_REPO || IGAMING_ROOT;
const pinnedGit = (root, args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 1 << 26 });

// Why the golden check cannot run, or null. Only a missing checkout or a missing pinned commit skips;
// any other probe failure throws, so a broken check never passes silently.
function goldenSkipReason(root, probe = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })) {
  if (!fs.existsSync(path.join(root, '.git'))) return `igaming checkout not found at ${root} (set GSD_IGAMING_REPO)`;
  const r = probe(['rev-parse', '--verify', '-q', `${PIN_SHA}^{commit}`]);
  if (r.error) throw r.error;
  if (r.status === 0) return null;
  if (r.status === 1) return `pinned commit ${PIN_SHA} is not in ${root}`;
  throw new Error(`git probe failed (status ${r.status}) for ${root}`);
}
const IGAMING_VALUES = { project: { slug: 'igaming', root: IGAMING_ROOT } };
const SETTINGS_DEST = '.claude/settings.json';
const META = ['preset.json', 'README.md', 'golden.sha256', 'settings.fragment.json', 'settings.snapshot.json'];
const SRC_RULES = [['.claude/', ''], ['scripts/validation/hook-canaries/', 'canaries/']];
const UNDEPLOYED = ['enableAllProjectMcpServers', 'enabledPlugins', 'env', 'sandbox'];

const tmps = [];
afterEach(() => {
  while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true });
});

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function golden() {
  const m = new Map();
  for (const line of fs.readFileSync(path.join(PRESET, 'golden.sha256'), 'utf8').split('\n')) {
    if (line === '') continue;
    const hit = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!hit) assert.fail(`bad golden line: ${line}`);
    m.set(hit[2], hit[1]);
  }
  return m;
}

function srcOf(dest) {
  const rule = SRC_RULES.find(([prefix]) => dest.startsWith(prefix));
  return rule ? rule[1] + dest.slice(rule[0].length) : dest;
}

function walk(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : [r];
  }).sort();
}

const readSnapshot = () => JSON.parse(fs.readFileSync(path.join(PRESET, 'settings.snapshot.json'), 'utf8'));
const readFragment = () => JSON.parse(fs.readFileSync(path.join(PRESET, 'settings.fragment.json'), 'utf8'));

describe('igaming preset snapshot (agnostic-C1)', () => {
  test('G1 loads as a flat preset with whole, non-rendered, unconditional entries', () => {
    const loaded = R.loadPreset(PRESET);
    assert.strictEqual(loaded.ok, true, loaded.errors.join('; '));
    assert.strictEqual(loaded.preset.name, 'igaming');
    assert.strictEqual(loaded.preset.version, '1');
    assert.strictEqual(loaded.preset.settings_fragment, 'settings.fragment.json');
    for (const f of loaded.preset.files) {
      assert.strictEqual(f.kind, 'whole');
      assert.strictEqual(f.render, false);
      assert.strictEqual(f.capability, null);
    }
    const readme = fs.readFileSync(path.join(PRESET, 'README.md'), 'utf8');
    assert.ok(readme.includes('95a02959e5fa464f3bcce11378c803f7b86ec76d'), 'README must name the full pinned SHA');
    assert.ok(!readme.includes('## Redactions') && !readme.includes('<redacted:'), 'README must not describe redactions');
  });

  test('G2 file list matches the snapshot: no stray file, no missing file, per-prefix counts', () => {
    const { preset } = R.loadPreset(PRESET);
    const g = golden();
    assert.strictEqual(g.size, 50, 'golden must have 50 unique lines');
    assert.deepStrictEqual(preset.files.map((f) => f.src).sort(), walk(PRESET).filter((p) => !META.includes(p)));
    assert.deepStrictEqual(
      preset.files.map((f) => f.dest).sort(),
      [...g.keys()].filter((d) => d !== SETTINGS_DEST).sort(),
    );
    for (const f of preset.files) assert.strictEqual(f.src, srcOf(f.dest), `src mapping: ${f.dest}`);
    const count = (prefix) => preset.files.filter((f) => f.dest.startsWith(prefix)).length;
    assert.deepStrictEqual(
      {
        rules: count('.claude/rules/'),
        hooks: count('.claude/hooks/'),
        skills: count('.claude/skills/'),
        canaries: count('scripts/validation/hook-canaries/'),
        claude: count('CLAUDE.md'),
      },
      { rules: 12, hooks: 19, skills: 15, canaries: 2, claude: 1 },
    );
  });

  test('G3 renders byte-equal to golden.sha256 for all 49 deployable files', () => {
    const r = R.renderPreset(PRESET, IGAMING_VALUES);
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.files.length, 49);
    const g = golden();
    for (const f of r.files) assert.strictEqual(sha(f.content), g.get(f.dest), `golden mismatch: ${f.dest}`);
  });

  test('G4 executable bits are exactly the 10 top-level hook scripts and run-canaries.sh', () => {
    const r = R.renderPreset(PRESET, IGAMING_VALUES);
    const exec = r.files.filter((f) => (f.mode & 0o111) !== 0).map((f) => f.dest).sort();
    const expected = [...golden().keys()]
      .filter((d) => /^\.claude\/hooks\/[^/]+\.sh$/.test(d) || d === 'scripts/validation/hook-canaries/run-canaries.sh')
      .sort();
    assert.strictEqual(expected.length, 11);
    assert.deepStrictEqual(exec, expected);
  });

  test('G5 settings: verbatim snapshot, fragment permission sets equal, hooks ordered, undeployed keys pinned', () => {
    const snapBuf = fs.readFileSync(path.join(PRESET, 'settings.snapshot.json'));
    assert.strictEqual(sha(snapBuf), golden().get(SETTINGS_DEST));
    const snap = readSnapshot();
    const frag = readFragment();
    assert.deepStrictEqual(Object.keys(frag).sort(), ['hooks', 'permissions']);
    const expectedSizes = { allow: 289, deny: 19, ask: 3 };
    for (const k of Object.keys(expectedSizes)) {
      assert.strictEqual(frag.permissions[k].length, expectedSizes[k], `size of permissions.${k}`);
      assert.strictEqual(new Set(frag.permissions[k]).size, frag.permissions[k].length, `duplicate in permissions.${k}`);
      assert.deepStrictEqual([...frag.permissions[k]].sort(), [...snap.permissions[k]].sort(), `permissions.${k} set differs`);
    }
    assert.deepStrictEqual(frag.hooks, snap.hooks, 'fragment hooks must equal snapshot hooks, order included');
    assert.deepStrictEqual(
      Object.keys(snap).filter((k) => k !== 'permissions' && k !== 'hooks').sort(),
      UNDEPLOYED,
      'undeployed settings keys changed: Phase H must carry env, enableAllProjectMcpServers, enabledPlugins, sandbox (README ## Settings)',
    );
    const merged = mergeSettings(null, null, R.renderPreset(PRESET, IGAMING_VALUES).settings);
    assert.strictEqual(merged.ok, true, merged.reason);
    for (const k of Object.keys(expectedSizes)) {
      assert.deepStrictEqual([...merged.settings.permissions[k]].sort(), [...snap.permissions[k]].sort(), `merged ${k}`);
    }
    assert.deepStrictEqual(merged.settings.hooks, snap.hooks, 'merged hooks must equal snapshot hooks in order');
  });

  test('G6 renders the project root into the fragment; a different or missing root is detected', () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-igaming-g6-'));
    tmps.push(copy);
    fs.cpSync(PRESET, copy, { recursive: true });
    const fragPath = path.join(copy, 'settings.fragment.json');
    const text = fs.readFileSync(fragPath, 'utf8');
    assert.strictEqual(text.split(IGAMING_ROOT).length - 1, 10, 'expected exactly 10 project-root occurrences');
    fs.writeFileSync(fragPath, text.split(IGAMING_ROOT).join('{{project.root}}'));
    const original = JSON.parse(text);
    const ok = R.renderPreset(copy, IGAMING_VALUES);
    assert.strictEqual(ok.ok, true, ok.errors.map((e) => e.reason).join('; '));
    assert.deepStrictEqual(ok.settings, original);
    assert.notDeepStrictEqual(R.renderPreset(copy, { project: { root: '/elsewhere' } }).settings, original);
    const missing = R.renderPreset(copy, {});
    assert.strictEqual(missing.ok, false);
    assert.ok(missing.errors.some((e) => e.reason === 'missing config key: project.root'));
  });

  test('G7 every golden entry and preset file is byte-equal to the pinned igaming archive (no exceptions)', (t) => {
    const reason = goldenSkipReason(GOLDEN_REPO);
    if (reason !== null) {
      t.skip(reason);
      return;
    }
    assert.strictEqual(pinnedGit(GOLDEN_REPO, ['rev-parse', '--verify', `${PIN_SHA}^{commit}`]).toString().trim(), PIN_SHA);
    const { preset } = R.loadPreset(PRESET);
    const srcByDest = new Map([...preset.files.map((f) => [f.dest, f.src]), [SETTINGS_DEST, 'settings.snapshot.json']]);
    assert.strictEqual(srcByDest.size, 50);
    for (const [dest, want] of golden()) {
      assert.strictEqual(sha(pinnedGit(GOLDEN_REPO, ['show', `${PIN_SHA}:${dest}`])), want, `golden differs from pin: ${dest}`);
      const src = srcByDest.get(dest);
      assert.strictEqual(sha(fs.readFileSync(path.join(PRESET, src))), want, `preset file differs from pin: ${src}`);
    }
  });
});

describe('G7 skip contract (B-FIX3 item 6)', () => {
  const tmpDir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-igaming-g7-'));
    tmps.push(d);
    return d;
  };

  test('G7-skip only a missing checkout or a missing pinned commit gives a skip reason', () => {
    assert.match(goldenSkipReason(tmpDir()), /igaming checkout not found/);
    const repo = tmpDir();
    execFileSync('git', ['init', '-q', repo]);
    assert.match(goldenSkipReason(repo), /is not in/);
    assert.strictEqual(goldenSkipReason(repo, () => ({ status: 0 })), null);
  });

  test('G7-skip any other probe failure throws instead of skipping', () => {
    const repo = tmpDir();
    fs.mkdirSync(path.join(repo, '.git'));
    assert.throws(() => goldenSkipReason(repo, () => ({ error: new Error('spawn git EACCES') })), /EACCES/);
    assert.throws(() => goldenSkipReason(repo, () => ({ status: 128 })), /status 128/);
    assert.throws(() => goldenSkipReason(repo, () => ({ status: null })), /status null/);
  });
});
