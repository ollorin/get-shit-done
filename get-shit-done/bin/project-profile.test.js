/**
 * project-profile.test.js — agnostic-A2
 *
 * Unit tests (1-9) for the project/stack profile validator and reader, and CLI
 * tests (10-13) that run gsd-tools.js against a scratch project directory.
 */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const profile = require('./project-profile.js');

const GSD_TOOLS = path.join(__dirname, 'gsd-tools.js');
const tmpDirs = [];

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-project-profile-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

function validProfile() {
  return {
    project: {
      slug: 'demo-app',
      owner_title: 'owner',
      risk_domains: ['auth', 'billing'],
      ruling_topics: ['rate-limits'],
    },
    stack: {
      preset: 'node',
      preset_version: '1',
      paths: {
        backend: 'src',
        migrations: ['db/migrations'],
        api_globs: ['src/api/**'],
        e2e_scenarios: 'e2e',
        frontends: ['web'],
      },
      commands: {
        test_file: 'npm test -- {file}',
        test_all: 'npm test',
        typecheck: 'tsc --noEmit',
        lint: 'eslint {paths}',
        format: 'prettier {root}',
        frontend_test: 'vitest {project}',
        pre_pr_gate: 'npm run gate',
        search: 'rg {file}',
      },
      test_command_shapes: ['npm test -- <file>'],
      gates: [{ id: 'lint', run: 'npm run lint' }],
      services: [{ name: 'api', url: 'http://127.0.0.1:3000', health: '/health', launch: 'npm start', ready: 'ready' }],
      capabilities: { ui_qa: { driver: 'browser', agent: 'qa-agent', tool_prefix: 'qa_', reset_patterns: ['reset*'] } },
      isolation: { port_base: 54320, container_suffix: 'demo', lock_dir: '.locks', machine_locks: ['db'] },
    },
  };
}

function minimalProfile() {
  return {
    project: { slug: 'demo', owner_title: 'owner', risk_domains: ['auth'], ruling_topics: [] },
    stack: { commands: { test_file: 'npm test -- {file}' } },
  };
}

// Wraps a plain config object the way loadProfile does, without touching disk.
function loaded(config) {
  return { found: true, error: null, project: config.project, stack: config.stack };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function invalidKeys(report) {
  return report.invalid.map((i) => i.key);
}

describe('project-profile', () => {
  test('1 full valid profile is ok with no missing, invalid or warnings', () => {
    const r = profile.validateProfile(loaded(validProfile()));
    assert.deepStrictEqual(r, { ok: true, config_found: true, missing: [], invalid: [], warnings: [] });
  });

  test('2 minimal profile with only the required keys is ok', () => {
    const r = profile.validateProfile(loaded(minimalProfile()));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.missing, []);
  });

  test('3 each required key removed in turn is reported as exactly that missing key', () => {
    const specKeys = [
      'project.slug',
      'project.owner_title',
      'project.risk_domains',
      'project.ruling_topics',
      'stack.commands.test_file',
    ];
    for (const key of specKeys) {
      const config = clone(validProfile());
      const parts = key.split('.');
      const parent = parts.slice(0, -1).reduce((node, p) => node[p], config);
      delete parent[parts[parts.length - 1]];
      const r = profile.validateProfile(loaded(config));
      assert.strictEqual(r.ok, false, key);
      assert.deepStrictEqual(r.missing, [key], key);
    }
  });

  test('4 required keys with a wrong shape are invalid, never missing', () => {
    const cases = [
      ['project.slug', (c) => { c.project.slug = 'Has Space'; }],
      ['project.risk_domains', (c) => { c.project.risk_domains = 'auth'; }],
      ['project.risk_domains', (c) => { c.project.risk_domains = ['auth', 'auth']; }],
      ['stack.commands.test_file', (c) => { c.stack.commands.test_file = ''; }],
    ];
    for (const [key, mutate] of cases) {
      const config = validProfile();
      mutate(config);
      const r = profile.validateProfile(loaded(config));
      assert.ok(invalidKeys(r).includes(key), key);
      assert.deepStrictEqual(r.missing, [], key);
    }
  });

  test('5 command placeholders: unknown token invalid, allowed tokens valid', () => {
    const bad = validProfile();
    bad.stack.commands.lint = 'x {files}';
    assert.ok(invalidKeys(profile.validateProfile(loaded(bad))).includes('stack.commands.lint'));

    const good = validProfile();
    good.stack.commands.lint = 'x {paths} {root}';
    assert.strictEqual(profile.validateProfile(loaded(good)).ok, true);
  });

  test('6 duplicate gate ids and services without url or name are invalid', () => {
    const dupGate = validProfile();
    dupGate.stack.gates = [{ id: 'a', run: 'x' }, { id: 'a', run: 'y' }];
    assert.ok(invalidKeys(profile.validateProfile(loaded(dupGate))).includes('stack.gates'));

    const gateNoRun = validProfile();
    gateNoRun.stack.gates = [{ id: 'a' }];
    assert.ok(invalidKeys(profile.validateProfile(loaded(gateNoRun))).includes('stack.gates'));

    const dupService = validProfile();
    dupService.stack.services = [{ name: 'api', url: 'http://127.0.0.1:1' }, { name: 'api', url: 'http://127.0.0.1:2' }];
    assert.ok(invalidKeys(profile.validateProfile(loaded(dupService))).includes('stack.services'));

    const serviceNoUrl = validProfile();
    serviceNoUrl.stack.services = [{ name: 'api' }];
    assert.ok(invalidKeys(profile.validateProfile(loaded(serviceNoUrl))).includes('stack.services'));
  });

  test('7 capabilities.ui_qa needs agent; isolation.port_base must be an integer port', () => {
    const noAgent = validProfile();
    noAgent.stack.capabilities = { ui_qa: { driver: 'browser' } };
    assert.ok(invalidKeys(profile.validateProfile(loaded(noAgent))).includes('stack.capabilities.ui_qa'));

    const emptyCaps = validProfile();
    emptyCaps.stack.capabilities = {};
    assert.strictEqual(profile.validateProfile(loaded(emptyCaps)).ok, true);

    for (const port of [80, '54320']) {
      const config = validProfile();
      config.stack.isolation.port_base = port;
      assert.ok(invalidKeys(profile.validateProfile(loaded(config))).includes('stack.isolation.port_base'), String(port));
    }
    const validPort = validProfile();
    validPort.stack.isolation.port_base = 54320;
    assert.strictEqual(profile.validateProfile(loaded(validPort)).ok, true);
  });

  test('8 unknown keys are warnings and never fail validation', () => {
    const config = validProfile();
    config.stack.commands.deploy = 'x';
    config.project.extra = 1;
    const r = profile.validateProfile(loaded(config));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.warnings, ['unknown key: project.extra', 'unknown key: stack.commands.deploy']);
  });

  test('9 getProfileValue reads project/stack keys only and never reaches prototypes', () => {
    const config = minimalProfile();
    config.workflow = { research: true };
    assert.strictEqual(profile.getProfileValue(config, 'project.owner_title'), 'owner');
    assert.strictEqual(profile.getProfileValue(config, 'stack.commands.test_file'), 'npm test -- {file}');
    assert.strictEqual(profile.getProfileValue(config, 'stack.commands.lint'), undefined);
    assert.strictEqual(profile.getProfileValue(config, 'workflow.research'), undefined);
    assert.strictEqual(profile.getProfileValue(config, 'stack.__proto__'), undefined);
  });
});

describe('project-profile CLI', () => {
  function writeConfig(dir, content) {
    fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), typeof content === 'string' ? content : JSON.stringify(content));
  }

  function runGsd(cwd, args) {
    return spawnSync(process.execPath, [GSD_TOOLS, ...args], { cwd, encoding: 'utf-8' });
  }

  test('10 profile check exit codes and JSON output for valid, invalid, absent and corrupt configs', () => {
    const valid = mkTmp();
    writeConfig(valid, validProfile());
    const ok = runGsd(valid, ['profile', 'check']);
    assert.strictEqual(ok.status, 0);
    assert.strictEqual(JSON.parse(ok.stdout).ok, true);

    const invalid = mkTmp();
    const broken = validProfile();
    delete broken.stack.commands.test_file;
    writeConfig(invalid, broken);
    const bad = runGsd(invalid, ['profile', 'check']);
    assert.strictEqual(bad.status, 1);
    assert.deepStrictEqual(JSON.parse(bad.stdout).missing, ['stack.commands.test_file']);

    const absent = mkTmp();
    const none = runGsd(absent, ['profile', 'check']);
    assert.strictEqual(none.status, 1);
    assert.strictEqual(JSON.parse(none.stdout).config_found, false);

    const corrupt = mkTmp();
    writeConfig(corrupt, '{not json');
    const cor = runGsd(corrupt, ['profile', 'check']);
    assert.strictEqual(cor.status, 1);
    assert.strictEqual(JSON.parse(cor.stdout).invalid[0].key, 'config.json');
  });

  test('11 profile get prints the raw string, the raw JSON of arrays, or {key,value} without --raw', () => {
    const dir = mkTmp();
    writeConfig(dir, validProfile());
    const owner = runGsd(dir, ['profile', 'get', 'project.owner_title', '--raw']);
    assert.strictEqual(owner.status, 0);
    assert.strictEqual(owner.stdout, 'owner');

    const domains = runGsd(dir, ['profile', 'get', 'project.risk_domains', '--raw']);
    assert.strictEqual(domains.stdout, JSON.stringify(['auth', 'billing']));

    const json = runGsd(dir, ['profile', 'get', 'project.owner_title']);
    assert.deepStrictEqual(JSON.parse(json.stdout), { key: 'project.owner_title', value: 'owner' });
  });

  test('12 profile get on an absent key fails loudly and substitutes no default', () => {
    const dir = mkTmp();
    writeConfig(dir, minimalProfile());
    const r = runGsd(dir, ['profile', 'get', 'stack.commands.lint']);
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes('profile key not set: stack.commands.lint'));
    assert.strictEqual(r.stdout, '');
  });

  test('13 existing config get still works and bare profile prints usage', () => {
    const dir = mkTmp();
    writeConfig(dir, validProfile());
    const cfg = runGsd(dir, ['config', 'get', 'project.slug', '--raw']);
    assert.strictEqual(cfg.status, 0);
    assert.strictEqual(cfg.stdout, 'demo-app');

    const bare = runGsd(dir, ['profile']);
    assert.strictEqual(bare.status, 1);
    assert.ok(bare.stderr.includes('Usage: profile'));
  });
});
