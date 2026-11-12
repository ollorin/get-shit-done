'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./project-deploy-render.js');
const { effectiveRiskDomains } = require('./project-context.js');
const { validateProfile } = require('./project-profile.js');
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
const META = ['preset.json', 'README.md', 'golden.sha256', 'settings.fragment.json', 'settings.snapshot.json', 'project.block.json', 'lessons-stack.md'];
const UNDEPLOYED_DIRS = ['memory/'];
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
    assert.deepStrictEqual(preset.files.map((f) => f.src).sort(), walk(PRESET).filter((p) => !META.includes(p) && !UNDEPLOYED_DIRS.some((d) => p.startsWith(d))));
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

describe('igaming project block (agnostic-M-06 6.1)', () => {
  const block = JSON.parse(fs.readFileSync(path.join(PRESET, 'project.block.json'), 'utf8'));
  const terms = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'agnostic', 'risk-terms.json'), 'utf8'));

  test('R-g risk_domains is a superset of the former hard-coded terms and the effective source is the brief', () => {
    for (const t of terms) assert.ok(block.project.risk_domains.includes(t), `missing risk domain ${t}`);
    const eff = effectiveRiskDomains(block);
    assert.strictEqual(eff.risk_domains_source, 'brief');
    for (const t of [...terms, 'security']) assert.ok(eff.risk_domains.includes(t), t);
  });

  test('R-h the stack object passes the profile shape checks for its five keys and its flake patterns flag the three incident shapes', async () => {
    const report = validateProfile({ found: true, project: block.project, stack: block.stack });
    const keys = ['stack.locked_commands', 'stack.flake_patterns', 'stack.style', 'stack.host', 'stack.deploy'];
    assert.deepStrictEqual(report.invalid.filter((p) => keys.some((k) => p.key.startsWith(k))), []);
    assert.deepStrictEqual(block.stack.deploy.never_touch, []);
    const { scanFlakePatterns } = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'presets', 'base', 'hooks', 'lib', 'flake-gate.mjs')).href);
    const ids = (c) => scanFlakePatterns(c, block.stack.flake_patterns.patterns).map((v) => v.id);
    const shared = '  .from("queue_shared_rounds")\n';
    assert.deepStrictEqual(ids(`${shared}  .insert({ round_number: 800011 })\n`), ['hardcoded-round-number']);
    assert.deepStrictEqual(ids(`${shared}  .insert({ venue_id: 12 })\n`), ['hardcoded-id']);
    assert.deepStrictEqual(ids('const w = { start_hour: 0, end_hour: 23 };\n'), ['absolute-time-window']);
    assert.deepStrictEqual(ids(`${shared}  .insert({ round_number: 800011 })\n  // retry on 23505\n`), []);
  });
});

describe('preserved project material (agnostic-M-08 8.14)', () => {
  const { scanDir } = require('./project-deploy-scan.js');
  const MEMORY = path.join(PRESET, 'memory');
  const TOOLS = path.join(__dirname, '..', '..', '.planning', 'gsd-v2', 'tools');
  const EXPERIMENTS = path.join(__dirname, '..', '..', '.planning', 'gsd-v2', 'experiments', '16-ab2');
  const PERSONAL = /\/Users\/|ollorin|\bCEO\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/;
  const COPIED = [MEMORY, TOOLS, EXPERIMENTS];
  const STALE = ['SESSION_2026-02-08.md', 'SESSION_2026-02-09.md', 'SESSION_2026-02-10.md', 'baseline_integration_tests.md', 'iteration2_results.md', 'optimization_final_complete.md', 'phase1_optimization_complete.md', 'phase1_plus_iterations_final.md', 'phase1_results.md'];

  test('8.14 row 3: memory holds the copied notes without the 9 stale files, and lessons-stack.md has 17 entries', () => {
    const files = walk(MEMORY);
    assert.strictEqual(files.length, 71);
    for (const s of STALE) assert.ok(!files.includes(s), `stale file copied: ${s}`);
    const lessons = fs.readFileSync(path.join(PRESET, 'lessons-stack.md'), 'utf8');
    assert.strictEqual(lessons.split('\n').filter((l) => l.startsWith('**')).length, 17);
  });

  test('8.14 row 7: tools hold 37 root scripts, 82 agent-audit scripts plus roles.json, and the 6 hooks-flip-backup files; no pickle or stats data', () => {
    const files = walk(TOOLS);
    assert.strictEqual(files.filter((f) => !f.includes('/')).length, 37);
    assert.strictEqual(files.filter((f) => f.startsWith('agent-audit/')).length, 83);
    assert.strictEqual(files.filter((f) => f.startsWith('hooks-flip-backup/')).length, 6);
    assert.strictEqual(files.length, 126);
    assert.ok(!files.some((f) => /\.(pkl|log)$|stats\.json$/.test(f) && !f.startsWith('hooks-flip-backup/')), 'data file copied');
  });

  test('8.14 rows 8 and 9: experiments/16-ab2 holds the two A/B notes and the four run-data files', () => {
    assert.deepStrictEqual(walk(EXPERIMENTS), ['decisions.jsonl', 'fable-ab-inventory.md', 'fable-spawn-baseline.md', 'registry.json', 'runs-rp-pilot-void.jsonl', 'runs.jsonl']);
  });

  test('8.14 no copied file holds a secret-shaped value (the deploy scan over every copied tree is empty)', () => {
    for (const dir of COPIED) assert.deepStrictEqual(scanDir(dir).hits, [], dir);
  });

  // The fork is public: preserved memory must not point at an unresolved weakness or at where credentials sit in the
  // private repo's history. A line that names a commit hash together with a vulnerability or credential word is such a pointer.
  const SHA = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;
  const SENSITIVE = /credential|bypass|plaintext|leaked|vulnerab|auth[- ]bypass|replay|exploit|fail-open|auto-?pass|injection|unauthenticated|zero enforcement/i;
  const POINTER_LINES = (text) => text.split('\n').filter((l) => SHA.test(l) && SENSITIVE.test(l));

  test('8.14 positive control: the pointer scan flags a commit hash beside a credential or bypass word and passes a plain line', () => {
    assert.strictEqual(POINTER_LINES('keys were committed in plaintext since commit `56eebb8d`').length, 1);
    assert.strictEqual(POINTER_LINES('an auth bypass sits in middleware (commit c62c5026)').length, 1);
    assert.strictEqual(POINTER_LINES('a wallet-credit exploit was fixed in commit 2ff9c068').length, 1);
    assert.strictEqual(POINTER_LINES('merged in commit c62c5026, tag v0.1.22').length, 0);
    assert.strictEqual(POINTER_LINES('rotate the credentials, see the private repo tracker').length, 0);
  });

  test('8.14 preserved memory, lessons and tools hold no commit-hash pointer to a vulnerability or credential, and no named unresolved auth-bypass path', () => {
    const files = [...walk(MEMORY).map((f) => path.join(MEMORY, f)), path.join(PRESET, 'lessons-stack.md'), ...walk(TOOLS).map((f) => path.join(TOOLS, f))];
    const hits = files.flatMap((f) => POINTER_LINES(fs.readFileSync(f, 'utf8')).map((l) => `${path.relative(PRESET, f)}: ${l.slice(0, 100)}`));
    assert.deepStrictEqual(hits, []);
    const memory = walk(MEMORY).map((f) => fs.readFileSync(path.join(MEMORY, f), 'utf8')).join('\n');
    assert.doesNotMatch(memory, /service-role-key auth[- ]bypass|secrets-to-rotate|\.mcp\.json/);
  });

  test('8.14 no copied file holds an absolute user path, a contact address or the owner title', () => {
    const hits = COPIED.flatMap((dir) => walk(dir).filter((f) => PERSONAL.test(fs.readFileSync(path.join(dir, f), 'utf8'))).map((f) => path.join(dir, f)));
    assert.deepStrictEqual(hits, []);
  });
});
