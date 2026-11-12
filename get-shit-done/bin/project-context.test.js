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
      'project_context_missing: .planning/PRODUCT-BRIEF.md, .planning/STACK-PROFILE.md, project.owner_title, project.risk_domains, project.ruling_topics, project.slug, stack.commands.test_file; run /gsd:init-project, pass --legacy to this init call, or export GSD_LEGACY=1 (the flag does not reach spawned agents)',
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

describe('no :3000 fallback in the service-startup files (agnostic-M-02 2.6, G4)', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const FILES = [
    'get-shit-done/references/service-health.md',
    'get-shit-done/references/coordinator-detail.md',
    'get-shit-done/workflows/execute-phase.md',
    'get-shit-done/presets/packs/charlotte/agents/gsd-charlotte-qa.md',
  ];

  test('none of the four files names localhost:3000 or :3000', () => {
    for (const rel of FILES) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.doesNotMatch(text, /:3000\b/, `${rel} must not hold a :3000 default`);
    }
  });

  test('service-health.md takes the service config from stack.services and stops when it is unset', () => {
    const text = fs.readFileSync(path.join(ROOT, 'get-shit-done/references/service-health.md'), 'utf8');
    assert.match(text, /stack\.services/);
    assert.match(text, /stack\.services is not set/);
  });
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

  test('health_cmd is documented next to health in the profile contract', () => {
    for (const rel of ['get-shit-done/references/project-context.md', 'get-shit-done/references/service-health.md']) {
      assert.match(fs.readFileSync(path.join(ROOT, rel), 'utf8'), /health_cmd/, rel);
    }
  });

  test('R4 docs: the charlotte QA agent has no defaults sentence that contradicts its stop rule', () => {
    const agent = fs.readFileSync(path.join(ROOT, 'get-shit-done/presets/packs/charlotte/agents/gsd-charlotte-qa.md'), 'utf8');
    assert.match(agent, /stack\.services is not set/);
    assert.doesNotMatch(agent, /use the defaults above/);
  });

  test('R4 docs: service-health.md assigns the CLAUDE.md Health check to QA_HEALTH_CMD, never a bare QA_HEALTH', () => {
    const text = fs.readFileSync(path.join(ROOT, 'get-shit-done/references/service-health.md'), 'utf8');
    assert.match(text, /^QA_HEALTH_CMD=/m);
    assert.doesNotMatch(text, /^QA_HEALTH=/m);
    assert.doesNotMatch(text, /\$QA_HEALTH\b(?!_)/);
  });
});

describe('effectiveRiskDomains (agnostic-M-06 6.1)', () => {
  const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'agnostic', 'risk-terms.json'), 'utf8'));

  test('R-a a brief list is appended to auth and security; source brief', () => {
    const r = effectiveRiskDomains({ project: { risk_domains: FIXTURE } });
    assert.strictEqual(r.risk_domains_source, 'brief');
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
      assert.strictEqual(out.risk_domains_source, 'brief');
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

describe('product brief step and command (agnostic-M-04 4.1, D2)', () => {
  const WF = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'new-project.md'), 'utf8');
  const CMD = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'gsd', 'new-project.md'), 'utf8');
  const sectionOf = (from, to) => WF.slice(WF.indexOf(from), WF.indexOf(to));

  test('## 4.5. Product Brief sits between section 4 and section 5', () => {
    const brief = WF.indexOf('## 4.5. Product Brief');
    assert.ok(brief > 0, 'heading present');
    assert.ok(WF.indexOf('## 4. Write PROJECT.md') < brief && brief < WF.indexOf('## 5. Workflow Preferences'));
  });

  test('the brief step names the template and records assumptions through the decisions CLI', () => {
    const step = sectionOf('## 4.5. Product Brief', '## 5. Workflow Preferences');
    assert.ok(step.includes('templates/product-brief.md'));
    assert.ok(step.includes('--kind assumption'));
    assert.ok(step.split('\n').length <= 45, 'the step is at most 45 lines');
  });

  test('every line that records the empty risk_domains default is costly, never cheap', () => {
    const lines = WF.split('\n').filter((l) => l.includes('--default "[]"'));
    assert.ok(lines.length >= 1, 'a risk_domains default line exists');
    for (const l of lines) assert.ok(l.includes('--reversibility costly'), l);
  });

  test('the new-project command lists both outputs and both templates', () => {
    assert.ok(CMD.includes('`.planning/PRODUCT-BRIEF.md`'));
    assert.ok(CMD.includes('`.planning/STACK-PROFILE.md`'));
    assert.ok(CMD.includes('@~/.claude/get-shit-done/templates/product-brief.md'));
    assert.ok(CMD.includes('@~/.claude/get-shit-done/templates/stack-profile.md'));
  });
});

describe('stack profile step, style section and init order (agnostic-M-04 4.2, D2)', () => {
  const WF = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'new-project.md'), 'utf8');
  const TPL = fs.readFileSync(path.join(__dirname, '..', 'templates', 'stack-profile.md'), 'utf8');
  const step = WF.slice(WF.indexOf('## 5.6. Stack Profile'), WF.indexOf('## 6. Research Decision'));

  test('the step exists after section 5.5, at most 75 lines', () => {
    assert.ok(step.length > 0, 'heading present');
    assert.ok(WF.indexOf('## 5.5.') < WF.indexOf('## 5.6.'));
    assert.ok(step.split('\n').length <= 75);
  });

  test('profile check, then project init --preset, then conflict and refused, then the project diff --preset review (M5: diff needs the defaulted keys)', () => {
    const at = (s) => step.indexOf(s);
    const seq = ['profile check', 'project init --preset', 'conflict', 'refused', 'project diff --preset'].map(at);
    seq.forEach((i) => assert.ok(i >= 0, 'every marker present'));
    assert.deepStrictEqual(seq, [...seq].sort((a, b) => a - b));
  });

  test('every project diff call in the step passes --preset', () => {
    const calls = step.split('\n').filter((l) => l.includes('project diff'));
    assert.ok(calls.length >= 1);
    for (const l of calls) assert.ok(l.includes('--preset'), l);
  });

  test('the step names every required stack key and none of the four former pack keys', () => {
    for (const key of ['stack.preset', 'stack.capabilities.backend', 'stack.capabilities.web_ui', 'stack.locked_commands',
      'stack.style.rule_set', 'stack.deploy.never_touch', 'stack.flake_patterns']) {
      assert.ok(step.includes(key), key);
    }
    for (const old of ['agent_ops', 'quality_gates', 'secure_backend', 'tdd_web']) assert.ok(!step.includes(old), old);
  });

  test('the step covers the dependency scanner prerequisite and its opt-out key', () => {
    assert.ok(step.includes('osv-scanner'));
    assert.ok(step.includes('allow_missing_scanner'));
  });

  test('the step writes no gate list and never makes the style gate optional', () => {
    assert.ok(!step.includes('stack.gates'));
    assert.doesNotMatch(step, /(skip|disable|without) the style gate/i);
    for (const set of ['js-ts', 'python', 'generic']) assert.ok(step.includes(set), set);
  });

  test('templates/stack-profile.md has a Style section with the four idiom lines before Conventions', () => {
    const s = TPL.indexOf('## Style');
    assert.ok(s > 0 && s < TPL.indexOf('## Conventions'));
    for (const idiom of ['- Errors:', '- Immutability:', '- Routing:', '- Purity:']) {
      assert.ok(TPL.slice(s, TPL.indexOf('## Conventions')).includes(idiom), idiom);
    }
  });
});

describe('init-project command and the legacy pass-through in every init caller (agnostic-M-04 4.3, D3 D6)', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const CALL = /gsd-tools(\.js)?"? init (plan-phase|execute-phase)/;
  const walkMd = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return walkMd(rel);
    return e.name.endsWith('.md') ? [rel] : [];
  });
  const callers = () => ['get-shit-done', 'agents', 'commands'].flatMap(walkMd)
    .filter((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').some((l) => CALL.test(l)));

  test('commands/gsd/init-project.md exists with the gsd:init-project name, and no sync command exists', () => {
    const text = fs.readFileSync(path.join(ROOT, 'commands', 'gsd', 'init-project.md'), 'utf8');
    assert.ok(text.startsWith('---\nname: gsd:init-project\n'));
    assert.ok(text.split('\n').length < 50);
    assert.ok(!fs.existsSync(path.join(ROOT, 'commands', 'gsd', 'sync-project.md')));
  });

  test('every file that calls init plan-phase or init execute-phase stops on project_context_missing and passes the escape', () => {
    const files = callers();
    assert.ok(files.length >= 7, `expected at least the seven callers at f6f17bf, found ${files.length}: ${files.join(', ')}`);
    for (const rel of files) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.ok(text.includes('project_context_missing'), `${rel} stops on the gate error`);
      assert.ok(text.includes('--legacy') || text.includes('GSD_LEGACY'), `${rel} passes the escape`);
      assert.ok(!text.includes('${GSD_LEGACY:+'), `${rel} must not turn GSD_LEGACY=0 into the flag`);
    }
  });

  test('M6 every init plan-phase / execute-phase call line accepts LEGACY_FLAG and the orchestrators pass legacy: true to spawned agents', () => {
    const files = callers().filter((rel) => !rel.includes(`${path.sep}v2${path.sep}`));
    for (const rel of files) {
      const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').filter((l) => CALL.test(l) && l.includes('INIT=$('));
      for (const l of lines) assert.ok(/\$\{?LEGACY_FLAG\}?/.test(l), `${rel}: ${l}`);
    }
    for (const rel of ['get-shit-done/workflows/plan-phase.md', 'get-shit-done/workflows/execute-phase.md']) {
      assert.match(fs.readFileSync(path.join(ROOT, rel), 'utf8'), /put `legacy: true` in every spawned agent's prompt/, rel);
    }
  });

  test('execute-roadmap.md tells an unattended run to export GSD_LEGACY=1', () => {
    const text = fs.readFileSync(path.join(ROOT, 'get-shit-done', 'workflows', 'execute-roadmap.md'), 'utf8');
    assert.ok(text.includes('GSD_LEGACY=1'));
  });
});

describe('risk-rule wording present in the eight prompt files (agnostic-M-06 R-f)', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const SENTENCES = [
    'A risk-domain path is any path the product brief lists under Risk Domains (`risk_domains` in the init output); authentication/authorisation and security are always risk domains.',
    'When `risk_domains_source` is `builtin` (no brief, or a brief with an empty list), every path that mutates state is a risk-domain path.',
    'Tag every behaviour on a risk-domain path T0 (real-DB, mutation-proven).',
  ];
  const FILES = [
    'agents/gsd-planner.md', 'agents/gsd-plan-checker.md', 'agents/gsd-test-writer.md', 'agents/gsd-phase-coordinator.md',
    'get-shit-done/references/decisions-protocol.md', 'get-shit-done/workflows/plan-phase.md',
    'get-shit-done/workflows/prd.md', 'get-shit-done/workflows/new-milestone.md',
  ];

  for (const rel of FILES) {
    test(`R-f ${rel} carries the three canonical sentences`, () => {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const sentence of SENTENCES) assert.ok(text.includes(sentence), `${rel} lacks: ${sentence.slice(0, 50)}`);
    });
  }

  test('R-f the planner mandate keeps its obligations: threat model, adversary view, atomicity, no saga, REUSE only for the T0 test', () => {
    const text = fs.readFileSync(path.join(ROOT, 'agents/gsd-planner.md'), 'utf8');
    for (const must of [
      'threat-model task', 'adversary view', 'a partial failure leaves NO half-applied state', 'compensating saga',
      'every state mutation on a risk-domain path', 'REUSE satisfies it ONLY when the cited existing test is itself that T0 test',
      'Risk domains: <risk_domains> (source: <risk_domains_source>)',
    ]) assert.ok(text.includes(must), must);
  });

  test('R-f the product brief template has the Risk Domains heading', () => {
    assert.match(fs.readFileSync(path.join(ROOT, 'get-shit-done/templates/product-brief.md'), 'utf8'), /^## Risk Domains$/m);
  });
});

describe('pointer block in every top-level agent and the pack agent (agnostic-M-04 4.4-4.5, D5)', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const BLOCK = [
    '<project_context>',
    'Domain facts and risk domains: `.planning/PRODUCT-BRIEF.md`. Commands, paths, services and tools: `.planning/STACK-PROFILE.md`.',
    'Read the sections your role needs before acting. Every command, path and tool name comes from the profile.',
    'If a key you need is missing, stop and report the key. Never substitute a default stack.',
    '</project_context>',
  ].join('\n');
  const AGENTS = fs.readdirSync(path.join(ROOT, 'agents'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join('agents', e.name));
  const FILES = [...AGENTS, path.join('get-shit-done', 'presets', 'packs', 'charlotte', 'agents', 'gsd-charlotte-qa.md')];

  test('the checked set is every top-level agent plus the pack agent, and agents/v2 is outside it', () => {
    assert.ok(FILES.length >= 23, `found ${FILES.length}`);
    assert.ok(FILES.every((f) => !f.includes(`agents${path.sep}v2${path.sep}`)));
  });

  test('every file carries the block exactly once, directly after its frontmatter', () => {
    for (const rel of FILES) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.strictEqual(text.split(BLOCK).length - 1, 1, `${rel} carries the block once`);
      assert.ok(text.includes(`---\n\n${BLOCK}\n`), `${rel} places the block after the frontmatter`);
    }
  });

  test('the block matches no pattern of the lint term classes', () => {
    const classes = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'agnostic-lint', 'terms.json'), 'utf8')).classes;
    for (const c of classes) {
      assert.doesNotMatch(BLOCK, new RegExp(c.pattern, c.flags || ''), `class ${c.id}`);
    }
  });
});

describe('Fable round 1: legacy gates, ui_qa_mode carve-outs, review-tiering sentence (agnostic-M-04/05/06)', () => {
  const REPO = path.join(__dirname, '..', '..');
  const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

  test('H1 every machine-gate site carries a legacy clause and names config.json, not init output', () => {
    const verifier = read('agents/gsd-verifier.md');
    assert.match(verifier, /Legacy: no `stack\.gates` in `\.planning\/config\.json` => run the gate scripts the repo ships/);
    assert.match(verifier, /\(legacy: no `stack\.gates`\) the repo ships a tier-delta script/);
    const detail = read('get-shit-done/references/verifier-detail.md');
    assert.match(detail, /Legacy: a project with no `stack\.gates` at all runs\s+the\s+tier-delta and tier-assignment scripts the repo ships/);
    assert.doesNotMatch(detail, /stack\.gates\[\][^\n]*\(init output\)/);
    const exec = read('get-shit-done/workflows/execute-phase.md');
    assert.match(exec, /legacy: no `stack\.gates` => the repo's shipped FP gate script/);
  });

  test('M2 UI QA is skipped only on ui_qa_mode none; legacy resolves the configured QA agent', () => {
    for (const rel of ['agents/gsd-phase-coordinator.md', 'get-shit-done/references/coordinator-detail.md', 'get-shit-done/workflows/execute-roadmap.md']) {
      const text = read(rel);
      assert.match(text, /ui_qa_mode: none/, rel);
      assert.match(text, /legacy/, rel);
      assert.doesNotMatch(text, /if the profile declares (none|no `stack\.capabilities\.ui_qa`)/, rel);
    }
    assert.doesNotMatch(read('get-shit-done/references/coordinator-detail.md'), /MANDATORY for web projects that declare the UI QA capability/);
    assert.match(read('agents/gsd-phase-coordinator.md'), /legacy project .*uses the project's configured QA agent per the legacy gate/);
  });

  test('M3 the verifier skips UI QA coverage on ui_qa_mode none and keeps the rule for legacy', () => {
    for (const rel of ['agents/gsd-verifier.md', 'get-shit-done/references/verifier-detail.md']) {
      const text = read(rel);
      assert.match(text, /ui_qa_mode: none/, rel);
      assert.match(text, /`ui_qa_ran: false {2}# no ui_qa capability`/, rel);
      assert.match(text, /`ui_qa_mode: legacy`|`legacy` and/, rel);
    }
  });

  test('L8 the round-4 ruling cap attaches to "loop to zero"', () => {
    for (const rel of ['agents/gsd-phase-coordinator.md', 'get-shit-done/workflows/execute-phase.md']) {
      const text = read(rel);
      assert.doesNotMatch(text, /mutation-proven\)\., but/, rel);
      assert.match(text, /loop to zero, but after round 4 a fresh Opus ruling/, rel);
    }
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

  test('F1 re-run after a deploy with no STACK-PROFILE.md: init exits 1 already initialised, sync continues; step 3 names that branch', () => {
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
    const wf = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'new-project.md'), 'utf8');
    const sec = wf.slice(wf.indexOf('## 5.6. Stack Profile'), wf.indexOf('## 6. Research Decision'));
    assert.match(sec, /already initialised: run project sync.*\n?.*`project sync --preset <name>`.*exit code 2/s);
    assert.doesNotMatch(sec, /its existence means the profile check and the deploy both ran/);
  });

  test('F5 complete-milestone parses $ARGUMENTS for --legacy instead of a spawn prompt', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'complete-milestone.md'), 'utf8');
    assert.doesNotMatch(text, /spawn prompt/);
    assert.match(text, /\$ARGUMENTS " == \*" --legacy "\*/);
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

  test('L7 auto mode records an assumption when no UI QA driver is chosen', () => {
    const wf = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'new-project.md'), 'utf8');
    const auto = wf.slice(wf.indexOf('## 5.6. Stack Profile'), wf.indexOf('## 6. Research Decision'));
    assert.match(auto, /No UI QA driver \(no `ui_qa` key written\) → record an assumption:.*--question "UI QA driver: none/);
  });

  test('the interview text keys its skips and init-project step 1 on the gate and writes STACK-PROFILE.md after the deploy', () => {
    const wf = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'new-project.md'), 'utf8');
    const sec = wf.slice(wf.indexOf('## 5.6. Stack Profile'), wf.indexOf('## 6. Research Decision'));
    assert.match(wf, /\*\*Skip when `context_gate`/);
    assert.doesNotMatch(wf, /Skip when `(brief_exists|stack_profile_exists)` is true/);
    const order = ['Write the `stack` block', 'Run the profile check', 'Deploy:', 'Write `.planning/STACK-PROFILE.md`', 'Review the deployment'].map((t) => sec.indexOf(t));
    assert.ok(order.every((i) => i >= 0), `steps present: ${order}`);
    assert.deepStrictEqual([...order].sort((a, b) => a - b), order, 'steps are in this order');
    const cmd = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'gsd', 'init-project.md'), 'utf8');
    assert.match(cmd, /context_gate/);
    assert.doesNotMatch(cmd, /If `brief_exists` and `stack_profile_exists` are both true/);
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
