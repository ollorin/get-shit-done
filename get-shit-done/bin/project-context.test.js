/**
 * project-context.test.js — agnostic-M-01
 *
 * Unit tests for the project context fields and the preset list, and CLI tests
 * that run gsd-tools.js against a scratch project. The CLI runs with
 * GSD_LEGACY=1 so the missing-brief gate (1.3) does not hide the fields under test.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { contextFields, availablePresets, effectiveRiskDomains, adoptBrief, contextGate } = require('./project-context.js');

const TOOLS = path.join(__dirname, 'gsd-tools.js');
const PRESETS = path.join(__dirname, '..', 'presets');

function withScratch(config, fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-ctx-')));
  try {
    fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
    if (config !== undefined) fs.writeFileSync(path.join(dir, '.planning', 'config.json'), config);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(args, cwd, env) {
  const r = spawnSync(process.execPath, [TOOLS, ...args], { cwd, encoding: 'utf8', env });
  return { status: r.status, json: r.stdout.trim() ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

// The D6 rows build their env without an inherited GSD_LEGACY (a CI job that exports it must not change them).
function d6Env(extra = {}) {
  const env = { ...process.env };
  delete env.GSD_LEGACY;
  return { ...env, ...extra };
}

function cli(args, cwd) {
  return run(args, cwd, { ...process.env, GSD_LEGACY: '1' });
}

const VALID_CONFIG = JSON.stringify({
  project: { slug: 'demo', owner_title: 'owner', risk_domains: ['money'], ruling_topics: ['x'] },
  stack: { commands: { test_file: 'node --test {file}' } },
});

function withFiles({ config = VALID_CONFIG, brief = false, profile = false }, fn) {
  return withScratch(config === null ? undefined : config, (dir) => {
    if (brief) fs.writeFileSync(path.join(dir, '.planning', 'PRODUCT-BRIEF.md'), '# brief\n');
    if (profile) fs.writeFileSync(path.join(dir, '.planning', 'STACK-PROFILE.md'), '# profile\n');
    return fn(dir);
  });
}

const PLAN = ['init', 'plan-phase', '1'];
const EXEC = ['init', 'execute-phase', '1'];

test('D6-a: no brief, no profile, no escape: exit 1 and both files listed as missing', () => {
  withFiles({ config: null }, (dir) => {
    const r = run(PLAN, dir, d6Env());
    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.json.error, 'project_context_missing');
    assert.ok(r.json.missing.includes('.planning/PRODUCT-BRIEF.md'));
    assert.ok(r.json.missing.includes('.planning/STACK-PROFILE.md'));
  });
});

test('D6-b: brief present, profile absent: exit 1 and only the profile file is missing', () => {
  withFiles({ brief: true }, (dir) => {
    const r = run(EXEC, dir, d6Env());
    assert.strictEqual(r.status, 1);
    assert.deepStrictEqual(r.json.missing, ['.planning/STACK-PROFILE.md']);
  });
});

test('D6-c: --legacy passes and reports project_context.legacy', () => {
  withFiles({ config: null }, (dir) => {
    const r = run([...PLAN, '--legacy'], dir, d6Env());
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.json.project_context.legacy, true);
  });
});

test('D6-d: GSD_LEGACY=1 passes and GSD_LEGACY=0 gates', () => {
  withFiles({ config: null }, (dir) => {
    assert.strictEqual(run(PLAN, dir, d6Env({ GSD_LEGACY: '1' })).status, 0);
    assert.strictEqual(run(PLAN, dir, d6Env({ GSD_LEGACY: '0' })).status, 1);
  });
});

test('D6-e: brief, profile and a valid config pass without legacy', () => {
  withFiles({ brief: true, profile: true }, (dir) => {
    const r = run(EXEC, dir, d6Env());
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.json.project_context.legacy, false);
  });
});

test('D6-f: an invalid key fails the gate and is listed in invalid, not missing', () => {
  const config = JSON.parse(VALID_CONFIG);
  config.stack.gates = 'x';
  withFiles({ config: JSON.stringify(config), brief: true, profile: true }, (dir) => {
    const r = run(PLAN, dir, d6Env());
    assert.strictEqual(r.status, 1);
    assert.deepStrictEqual(r.json.missing, []);
    assert.deepStrictEqual(r.json.invalid.map((p) => p.key), ['stack.gates']);
  });
});

test('D6-g: the env builder drops an inherited GSD_LEGACY', () => {
  const saved = process.env.GSD_LEGACY;
  process.env.GSD_LEGACY = '1';
  try {
    assert.strictEqual(d6Env().GSD_LEGACY, undefined);
    assert.strictEqual(d6Env({ GSD_LEGACY: '0' }).GSD_LEGACY, '0');
  } finally {
    if (saved === undefined) delete process.env.GSD_LEGACY;
    else process.env.GSD_LEGACY = saved;
  }
});

test('D6-h: both files present but a required profile key absent: exit 1 and the key in missing', () => {
  const config = JSON.parse(VALID_CONFIG);
  delete config.project.owner_title;
  withFiles({ config: JSON.stringify(config), brief: true, profile: true }, (dir) => {
    const r = run(PLAN, dir, d6Env());
    assert.strictEqual(r.status, 1);
    assert.deepStrictEqual(r.json.missing, ['project.owner_title']);
  });
});

for (const [label, write] of [
  ['zero-byte', (p) => fs.writeFileSync(p, '')],
  ['whitespace-only', (p) => fs.writeFileSync(p, '  \n\t\n')],
  ['directory', (p) => fs.mkdirSync(p)],
]) {
  test(`D6-i: ${label} brief and ${label} profile count as missing`, () => {
    withScratch(VALID_CONFIG, (dir) => {
      write(path.join(dir, '.planning', 'PRODUCT-BRIEF.md'));
      write(path.join(dir, '.planning', 'STACK-PROFILE.md'));
      const r = run(PLAN, dir, d6Env());
      assert.strictEqual(r.status, 1);
      assert.deepStrictEqual(r.json.missing, ['.planning/PRODUCT-BRIEF.md', '.planning/STACK-PROFILE.md']);
      const ctx = contextFields(dir);
      assert.strictEqual(ctx.brief_exists, false);
      assert.strictEqual(ctx.stack_profile_exists, false);
      assert.strictEqual(ctx.brief_path, null);
    });
  });
}

test('D6-j: --legacy is recognised in any position, so init plan-phase --legacy 1 reads phase 1', () => {
  withFiles({ config: null }, (dir) => {
    const before = run(['init', 'plan-phase', '1', '--legacy'], dir, d6Env());
    for (const args of [['init', 'plan-phase', '--legacy', '1'], ['init', '--legacy', 'plan-phase', '1']]) {
      const r = run(args, dir, d6Env());
      assert.strictEqual(r.status, 0);
      assert.strictEqual(r.json.project_context.legacy, true);
      assert.deepStrictEqual(r.json.phase_number, before.json.phase_number);
    }
  });
});

test('D6-k: --legacy=1 is not the escape and still gates', () => {
  withFiles({ config: null }, (dir) => {
    const r = run(['init', 'plan-phase', '1', '--legacy=1'], dir, d6Env());
    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.json.error, 'project_context_missing');
  });
});

test('D6-l: a gate failure also writes one human-readable stderr line naming the keys', () => {
  withFiles({ config: null }, (dir) => {
    const r = run(PLAN, dir, d6Env());
    assert.strictEqual(r.status, 1);
    const lines = r.stderr.trim().split('\n');
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(
      lines[0],
      'project_context_missing: .planning/PRODUCT-BRIEF.md, .planning/STACK-PROFILE.md, project.owner_title (add it to .planning/config.json), project.risk_domains (add it to .planning/config.json), project.ruling_topics (add it to .planning/config.json), project.slug (add it to .planning/config.json), stack.commands.test_file (add it to .planning/config.json); check with `gsd-tools profile check`, run /gsd:init-project, pass --legacy to this init call, or export GSD_LEGACY=1 (the flag does not reach spawned agents)',
    );
  });
});

test('M6: the gate hint names the flag (this call only) and the env variable (everything else)', () => {
  withFiles({ config: null }, (dir) => {
    const r = run(PLAN, dir, d6Env());
    assert.match(r.json.hint, /--legacy to this init call/);
    assert.match(r.json.hint, /does not reach spawned agents or other processes/);
    assert.match(r.json.hint, /export GSD_LEGACY=1/);
    assert.strictEqual(run([...PLAN, '--legacy'], dir, d6Env()).status, 0);
    assert.strictEqual(run(PLAN, dir, d6Env({ GSD_LEGACY: '1' })).status, 0);
  });
});

test('D6-m: GSD_LEGACY set to an empty string or to true still gates', () => {
  withFiles({ config: null }, (dir) => {
    assert.strictEqual(run(PLAN, dir, d6Env({ GSD_LEGACY: '' })).status, 1);
    assert.strictEqual(run(PLAN, dir, d6Env({ GSD_LEGACY: 'true' })).status, 1);
  });
});

test('regression: init new-project and init progress never gate', () => {
  withFiles({ config: null }, (dir) => {
    assert.strictEqual(run(['init', 'new-project'], dir, d6Env()).status, 0);
    assert.strictEqual(run(['init', 'progress'], dir, d6Env()).status, 0);
  });
});

test('CLI init new-project in an empty project: no brief, no profile, presets without packs', () => {
  withScratch(undefined, (dir) => {
    const out = cli(['init', 'new-project'], dir).json;
    assert.strictEqual(out.brief_exists, false);
    assert.strictEqual(out.stack_profile_exists, false);
    assert.ok(out.available_presets.includes('igaming'));
    assert.ok(!out.available_presets.includes('packs'));
  });
});

test('CLI init plan-phase 1 returns both paths and stack_commands with {root} replaced', () => {
  const config = JSON.stringify({ stack: { commands: { test_file: 'cd {root}/api && run {file}' } } });
  withScratch(config, (dir) => {
    fs.writeFileSync(path.join(dir, '.planning', 'PRODUCT-BRIEF.md'), '# brief\n');
    fs.writeFileSync(path.join(dir, '.planning', 'STACK-PROFILE.md'), '# profile\n');
    const out = cli(['init', 'plan-phase', '1'], dir).json;
    assert.strictEqual(out.brief_path, '.planning/PRODUCT-BRIEF.md');
    assert.strictEqual(out.stack_profile_path, '.planning/STACK-PROFILE.md');
    assert.strictEqual(out.brief_exists, true);
    assert.strictEqual(out.stack_commands.test_file, `cd ${dir}/api && run {file}`);
  });
});

test('CLI init plan-phase 1 carries the build command in stack_commands with {root} replaced, and the profile knows the key', () => {
  const config = JSON.stringify({ stack: { commands: { build: 'make -C {root} build' } } });
  withScratch(config, (dir) => {
    const out = cli(['init', 'plan-phase', '1'], dir).json;
    assert.strictEqual(out.stack_commands.build, `make -C ${dir} build`);
  });
  assert.ok(require('./project-profile.js').KNOWN_COMMAND_KEYS.includes('build'));
});

const INIT_CALLS = [
  ['execute-phase', '1'],
  ['plan-phase', '1'],
  ['new-project'],
  ['new-milestone'],
  ['milestone-branch'],
  ['quick', 'smoke test'],
  ['resume'],
  ['verify-work', '1'],
  ['phase-op', '1'],
  ['todos', 'general'],
  ['milestone-op'],
  ['map-codebase'],
  ['progress'],
  ['execute-roadmap'],
];

test('the init dispatch has exactly the subcommands listed in INIT_CALLS', () => {
  const src = fs.readFileSync(TOOLS, 'utf8');
  const block = src.slice(src.indexOf('switch (workflow) {'), src.indexOf('Unknown init workflow'));
  assert.strictEqual((block.match(/^\s+case '[a-z-]+':/gm) || []).length, INIT_CALLS.length);
});

for (const args of INIT_CALLS) {
  test(`CLI init ${args[0]} carries brief_path, stack_profile_path and stack_commands`, () => {
    withScratch(undefined, (dir) => {
      const out = cli(['init', ...args], dir).json;
      for (const key of ['brief_path', 'stack_profile_path', 'stack_commands']) {
        assert.ok(Object.prototype.hasOwnProperty.call(out, key), `missing ${key}`);
      }
    });
  });
}

test('contextFields with invalid config.json yields nulls and false, never throws', () => {
  withScratch('{not json', (dir) => {
    assert.deepStrictEqual(contextFields(dir), {
      brief_path: null,
      stack_profile_path: null,
      brief_exists: false,
      stack_profile_exists: false,
      stack_commands: null,
      commands_not_configured: [],
      owner_title: null,
      risk_domains: ['auth', 'security'],
      risk_domains_source: 'builtin',
      all_state_mutating: true,
      ruling_topics: ['auth', 'security'],
    });
  });
});

test('availablePresets lists preset directories sorted and never packs', () => {
  const names = availablePresets(PRESETS);
  assert.ok(names.includes('igaming'));
  assert.ok(!names.includes('packs'));
  assert.deepStrictEqual(names, [...names].sort());
});

describe('health is a URL or path, health_cmd is the shell command (agnostic-M-02 R3 M3)', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const INSTALLABLE = ['get-shit-done', 'agents'];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(md|js|json)$/.test(e.name) && !e.name.endsWith('.test.js') ? [p] : [];
  });

  test('no installable file evals the health field: an eval line that names health also names health_cmd', () => {
    const offenders = INSTALLABLE.flatMap((d) => walk(path.join(ROOT, d)))
      .flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, line, i })))
      .filter(({ line }) => /\beval\b/.test(line) && /health/i.test(line) && !/health_cmd|HEALTH_CMD/.test(line))
      .map(({ f, i }) => `${path.relative(ROOT, f)}:${i + 1}`);
    assert.deepStrictEqual(offenders, []);
  });
});

describe('effectiveRiskDomains (agnostic-M-06 6.1)', () => {
  const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'agnostic', 'risk-terms.json'), 'utf8'));

  test('R-a a brief list is appended to auth and security; source config', () => {
    const r = effectiveRiskDomains({ project: { risk_domains: FIXTURE } });
    assert.strictEqual(r.risk_domains_source, 'config');
    assert.strictEqual(r.all_state_mutating, false);
    for (const t of [...FIXTURE, 'security']) assert.ok(r.risk_domains.includes(t), t);
  });

  test('R-b no project block, or an empty list: exactly auth and security, source builtin, all state-mutating', () => {
    for (const profile of [{}, { project: undefined }, { project: { risk_domains: [] } }, undefined]) {
      assert.deepStrictEqual(effectiveRiskDomains(profile), { risk_domains: ['auth', 'security'], risk_domains_source: 'builtin', all_state_mutating: true });
    }
  });

  test('R-c case-insensitive de-duplication keeps one entry', () => {
    const r = effectiveRiskDomains({ project: { risk_domains: ['Auth', 'auth', 'KYC'] } });
    assert.deepStrictEqual(r.risk_domains, ['auth', 'security', 'KYC']);
  });

  test('R-d init plan-phase carries risk_domains, risk_domains_source and ruling_topics', () => {
    const config = JSON.stringify({ project: { slug: 'demo', risk_domains: ['ledger'], ruling_topics: ['ledger'] } });
    withScratch(config, (dir) => {
      const r = spawnSync('node', [TOOLS, 'init', 'plan-phase', '1', '--legacy'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GSD_LEGACY: '1' } });
      const out = JSON.parse(r.stdout);
      assert.deepStrictEqual(out.risk_domains, ['auth', 'security', 'ledger']);
      assert.strictEqual(out.risk_domains_source, 'config');
      assert.deepStrictEqual(out.ruling_topics, ['auth', 'security', 'ledger']);
    });
    withScratch(undefined, (dir) => {
      const r = spawnSync('node', [TOOLS, 'init', 'plan-phase', '1', '--legacy'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GSD_LEGACY: '1' } });
      const out = JSON.parse(r.stdout);
      assert.strictEqual(out.risk_domains_source, 'builtin');
      assert.strictEqual(out.all_state_mutating, true);
    });
  });
});

describe('interview half-state and order (Fable round 1 M5)', () => {
  const FOUR = JSON.stringify({
    project: { slug: 'demo', owner_title: 'owner', risk_domains: [], ruling_topics: [] },
    stack: {
      preset: 'base',
      capabilities: { backend: {}, web_ui: {} },
      commands: { test_file: 'npm test {file}', test_all: 'npm test', typecheck: 'true', lint: 'true' },
      locked_commands: [],
      deploy: { never_touch: [] },
    },
  });
  const project = (args, dir, home) => spawnSync(process.execPath, [TOOLS, 'project', ...args], {
    cwd: dir, encoding: 'utf8', env: { ...d6Env(), GSD_HOME: home },
  });

  test('a config with only the four mandatory commands: diff exits 1 before init, init fills the defaults, then diff and the context gate pass', () => {
    withScratch(FOUR, (dir) => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-m5-home-'));
      try {
        const before = project(['diff', '--preset', 'base'], dir, home);
        assert.strictEqual(before.status, 1);
        assert.match(before.stdout, /missing config key: stack\.branch\.default/);
        const init = project(['init', '--preset', 'base'], dir, home);
        assert.strictEqual(init.status, 0, init.stdout + init.stderr);
        assert.strictEqual(project(['diff', '--preset', 'base'], dir, home).status, 0);
        assert.strictEqual(run(PLAN, dir, d6Env()).status, 1, 'the gate still fails while the two md files are absent');
        fs.writeFileSync(path.join(dir, '.planning', 'PRODUCT-BRIEF.md'), '# brief\n');
        fs.writeFileSync(path.join(dir, '.planning', 'STACK-PROFILE.md'), '# profile\n');
        const gate = run(PLAN, dir, d6Env());
        assert.strictEqual(gate.status, 0, gate.stderr);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  test('F1 re-run after a deploy with no STACK-PROFILE.md: init exits 1 already initialised, sync continues', () => {
    withScratch(FOUR, (dir) => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-f1-home-'));
      try {
        assert.strictEqual(project(['init', '--preset', 'base'], dir, home).status, 0);
        assert.ok(!fs.existsSync(path.join(dir, '.planning', 'STACK-PROFILE.md')));
        const again = project(['init', '--preset', 'base'], dir, home);
        assert.strictEqual(again.status, 1);
        assert.match(again.stdout + again.stderr, /already initialised: run project sync/);
        const sync = project(['sync', '--preset', 'base'], dir, home);
        assert.ok([0, 2].includes(sync.status), sync.stdout + sync.stderr);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  test('init new-project reports the context gate, so existing md files over an incomplete config are not "nothing missing"', () => {
    withFiles({ config: null, brief: true, profile: true }, (dir) => {
      const out = cli(['init', 'new-project'], dir).json;
      assert.strictEqual(out.brief_exists, true);
      assert.strictEqual(out.stack_profile_exists, true);
      assert.strictEqual(out.context_gate.ok, false);
      assert.ok(out.context_gate.missing.includes('project.slug'));
      assert.ok(out.context_gate.missing.includes('stack.commands.test_file'));
    });
    withFiles({ brief: true, profile: true }, (dir) => {
      assert.strictEqual(cli(['init', 'new-project'], dir).json.context_gate.ok, true);
    });
  });

});

describe('adopting a root PRODUCT-BRIEF.md (init fixes B)', () => {
  const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-adopt-'));
  test('gate reports it adoptable; adoptBrief copies once and never overwrites', () => {
    const root = mk();
    try {
      fs.writeFileSync(path.join(root, 'PRODUCT-BRIEF.md'), '# brief\n');
      const gate = contextGate(root, { legacy: false });
      assert.ok(gate.missing.includes('.planning/PRODUCT-BRIEF.md'));
      assert.deepStrictEqual(gate.adoptable.brief, { from: 'PRODUCT-BRIEF.md', to: '.planning/PRODUCT-BRIEF.md' });
      const r = adoptBrief(root);
      assert.deepStrictEqual([r.ok, r.adopted, r.from], [true, true, 'PRODUCT-BRIEF.md']);
      assert.match(r.note, /two copies can drift/);
      const after = contextGate(root, { legacy: false });
      for (const name of ['Identity', 'Risk Domains', 'Config Dimensions', 'Owner Policies']) {
        assert.ok(after.warnings.includes(`.planning/PRODUCT-BRIEF.md: template section missing: ${name}`), name);
      }
      fs.writeFileSync(path.join(root, '.planning/PRODUCT-BRIEF.md'), '## Identity\n## Risk Domains\n## Config Dimensions\n## Owner Policies\n');
      assert.deepStrictEqual(contextGate(root, { legacy: false }).warnings.filter((w) => w.includes('template section')), []);
      fs.writeFileSync(path.join(root, '.planning/PRODUCT-BRIEF.md'), '# brief\n');
      assert.strictEqual(fs.readFileSync(path.join(root, '.planning/PRODUCT-BRIEF.md'), 'utf8'), '# brief\n');
      fs.writeFileSync(path.join(root, 'PRODUCT-BRIEF.md'), '# changed\n');
      assert.strictEqual(adoptBrief(root).adopted, false);
      assert.strictEqual(fs.readFileSync(path.join(root, '.planning/PRODUCT-BRIEF.md'), 'utf8'), '# brief\n');
      assert.strictEqual(contextGate(root, { legacy: false }).adoptable.brief, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('nothing to adopt without a root brief', () => {
    const root = mk();
    try {
      assert.strictEqual(contextGate(root, { legacy: false }).adoptable.brief, null);
      assert.strictEqual(adoptBrief(root).adopted, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('acknowledged none commands reach agents as null (init fixes C)', () => {
  test('contextFields nulls them and lists them; the gate passes with warnings', () => {
    withScratch(JSON.stringify({
      project: { slug: 'x', owner_title: 'o', risk_domains: [], ruling_topics: [] },
      stack: { commands: { test_file: 'none', test_all: null, typecheck: 'none', lint: null, format: 'fmt' } },
    }), (dir) => {
      fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
      const f = contextFields(dir);
      assert.deepStrictEqual(f.stack_commands, { test_file: null, test_all: null, typecheck: null, lint: null, format: 'fmt' });
      assert.deepStrictEqual(f.commands_not_configured, ['test_file', 'test_all', 'typecheck', 'lint']);
      const gate = contextGate(dir, { legacy: false });
      assert.deepStrictEqual(gate.invalid, []);
      assert.strictEqual(gate.warnings.length, 4);
    });
  });
});
