/**
 * project-profile.test.js — agnostic-A2
 *
 * Unit tests (1-9) for the project/stack profile validator and reader, CLI
 * tests (10-13) that run gsd-tools.js against a scratch project directory, and
 * doc-vs-schema tests (14-18) for the templates and the project-context reference.
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
        pre_pr_gate: 'scripts/gate.sh',
        search: 'git grep -n',
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

    const lockWrappers = (value) => {
      const config = validProfile();
      config.stack.capabilities = { ui_qa: { driver: 'browser', agent: 'qa-agent', lock_wrappers: value } };
      return invalidKeys(profile.validateProfile(loaded(config))).includes('stack.capabilities.ui_qa');
    };
    assert.strictEqual(lockWrappers(['stack-lock.sh', 'stack-lock.ts']), false);
    assert.strictEqual(lockWrappers(undefined), false);
    assert.strictEqual(lockWrappers('stack-lock.sh'), true);
    assert.strictEqual(lockWrappers(['']), true);

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

describe('validators', () => {
  const invalid = (config) => invalidKeys(profile.validateProfile(loaded(config)));

  test('19 paths: array-only keys reject strings, other keys accept string or array, empty items invalid', () => {
    for (const key of ['api_globs', 'frontends']) {
      const str = validProfile();
      str.stack.paths[key] = 'src/**';
      assert.ok(invalid(str).includes(`stack.paths.${key}`), `${key} string`);
      const arr = validProfile();
      arr.stack.paths[key] = ['ok'];
      assert.deepStrictEqual(invalid(arr), [], `${key} array`);
    }
    const scalarOk = validProfile();
    scalarOk.stack.paths.backend = 'src';
    scalarOk.stack.paths.migrations = ['db'];
    assert.deepStrictEqual(invalid(scalarOk), []);
    const emptyItem = validProfile();
    emptyItem.stack.paths.migrations = ['db', ''];
    assert.ok(invalid(emptyItem).includes('stack.paths.migrations'));
    const numeric = validProfile();
    numeric.stack.paths.backend = 7;
    assert.ok(invalid(numeric).includes('stack.paths.backend'));
  });

  test('20 test_command_shapes must be an array of non-empty strings', () => {
    const str = validProfile();
    str.stack.test_command_shapes = 'npm test -- <file>';
    assert.ok(invalid(str).includes('stack.test_command_shapes'));
    const emptyItem = validProfile();
    emptyItem.stack.test_command_shapes = ['npm test -- <file>', ''];
    assert.ok(invalid(emptyItem).includes('stack.test_command_shapes'));
  });

  test('21 preset and preset_version must be non-empty strings', () => {
    for (const key of ['preset', 'preset_version']) {
      const empty = validProfile();
      empty.stack[key] = '';
      assert.ok(invalid(empty).includes(`stack.${key}`), `${key} empty`);
      const numeric = validProfile();
      numeric.stack[key] = 1;
      assert.ok(invalid(numeric).includes(`stack.${key}`), `${key} number`);
    }
  });

  test('22 config.json root that is an array, null or a scalar is invalid as config.json', () => {
    for (const body of ['[]', 'null', '"text"', '42']) {
      const dir = mkTmp();
      fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.planning', 'config.json'), body);
      const r = profile.validateProfile(profile.loadProfile(dir));
      assert.strictEqual(r.ok, false, body);
      assert.deepStrictEqual(invalidKeys(r), ['config.json'], body);
    }
  });

  test('23 project or stack that is null, an array or a scalar is invalid', () => {
    for (const [section, value] of [['project', null], ['project', []], ['stack', 'x'], ['stack', [1]]]) {
      const config = validProfile();
      config[section] = value;
      assert.ok(invalid(config).includes(section), `${section}=${JSON.stringify(value)}`);
    }
  });

  test('24 port_base: 65536, 1.5 and 1023 invalid; 1024 and 65535 valid', () => {
    for (const port of [65536, 1.5, 1023]) {
      const config = validProfile();
      config.stack.isolation.port_base = port;
      assert.ok(invalid(config).includes('stack.isolation.port_base'), String(port));
    }
    for (const port of [1024, 65535]) {
      const config = validProfile();
      config.stack.isolation.port_base = port;
      assert.deepStrictEqual(invalid(config), [], String(port));
    }
  });

  test('25 service optional fields health, health_cmd, launch and ready must be non-empty when present', () => {
    for (const field of ['health', 'health_cmd', 'launch', 'ready']) {
      const config = validProfile();
      config.stack.services = [{ name: 'api', url: 'http://127.0.0.1:3000', [field]: '' }];
      assert.ok(invalid(config).includes('stack.services'), field);
    }
    const absent = validProfile();
    absent.stack.services = [{ name: 'api', url: 'http://127.0.0.1:3000' }];
    assert.deepStrictEqual(invalid(absent), []);
  });

  const reasonsOf = (config) => profile.validateProfile(loaded(config)).invalid.map((i) => i.reason);
  test('R4 a bad health_cmd names the key health_cmd and the expected form (a shell command that prints the HTTP status)', () => {
    const config = validProfile();
    config.stack.services = [{ name: 'api', url: 'http://127.0.0.1:3000', health_cmd: '' }];
    assert.ok(reasonsOf(config).some((r) => /health_cmd/.test(r) && /non-empty shell command that prints the HTTP status/.test(r)));
  });

  test('R4 a legacy health holding a shell pipeline or metacharacter is refused: move to health_cmd', () => {
    for (const health of ['curl -s localhost:3000 | grep ok', 'curl "$URL"', 'a; b', 'x && y', 'curl `x`']) {
      const config = validProfile();
      config.stack.services = [{ name: 'api', url: 'http://127.0.0.1:3000', health }];
      assert.ok(reasonsOf(config).some((r) => /health is a shell command; move to health_cmd/.test(r)), health);
    }
    const path = validProfile();
    path.stack.services = [{ name: 'api', url: 'http://127.0.0.1:3000', health: '/health?deep=1' }];
    assert.deepStrictEqual(invalid(path), []);
  });

  test('26 placeholders: awk and shell expansions pass; test_file must contain an unquoted {file}', () => {
    const awk = validProfile();
    awk.stack.commands.lint = "awk '{print $1}' {paths}";
    awk.stack.commands.format = 'echo ${home} {root}';
    assert.deepStrictEqual(invalid(awk), []);

    const unknown = validProfile();
    unknown.stack.commands.lint = 'x {files}';
    assert.ok(invalid(unknown).includes('stack.commands.lint'));

    const noFile = validProfile();
    noFile.stack.commands.test_file = 'npm test';
    assert.ok(invalid(noFile).includes('stack.commands.test_file'));

    const quotedFile = validProfile();
    quotedFile.stack.commands.test_file = "npm test -- '{file}'";
    assert.ok(invalid(quotedFile).includes('stack.commands.test_file'));
  });

  test('27 test_file reason names single quotes when {file} is only quoted; an unpaired quote hides no placeholder', () => {
    const quotedFile = validProfile();
    quotedFile.stack.commands.test_file = "npm test -- '{file}'";
    const reason = profile.validateProfile(loaded(quotedFile)).invalid.find((i) => i.key === 'stack.commands.test_file').reason;
    assert.match(reason, /only inside single quotes/);
    assert.match(reason, /unquoted or double-quoted/);

    const noFile = validProfile();
    noFile.stack.commands.test_file = 'npm test';
    const noFileReason = profile.validateProfile(loaded(noFile)).invalid.find((i) => i.key === 'stack.commands.test_file').reason;
    assert.strictEqual(noFileReason, 'must contain the {file} placeholder');

    const doubleQuoted = validProfile();
    doubleQuoted.stack.commands.test_file = 'npm test -- "{file}"';
    assert.deepStrictEqual(invalid(doubleQuoted), []);

    const unpaired = validProfile();
    unpaired.stack.commands.lint = "echo it's {bogus} 'x'";
    assert.ok(invalid(unpaired).includes('stack.commands.lint'));
    const unpairedReason = profile.validateProfile(loaded(unpaired)).invalid.find((i) => i.key === 'stack.commands.lint').reason;
    assert.strictEqual(unpairedReason, 'unknown placeholder {bogus}');
  });

  test('T2 P-j rendered text keys reject quote, backtick, $( and newline; safe values pass', () => {
    const RENDERED = [
      ['project.owner_title', ['project', 'owner_title']],
      ['stack.branch.default', ['stack', 'branch', 'default']],
      ['stack.commands.search', ['stack', 'commands', 'search']],
      ['stack.commands.pre_pr_gate', ['stack', 'commands', 'pre_pr_gate']],
    ];
    const setAt = (config, path, value) => {
      path.slice(0, -1).reduce((node, k) => {
        node[k] = node[k] ?? {};
        return node[k];
      }, config)[path[path.length - 1]] = value;
      return config;
    };
    for (const [key, path] of RENDERED) {
      for (const bad of ['a"b', 'a`b', 'a$(b', 'a\nb']) {
        assert.ok(invalid(setAt(validProfile(), path, bad)).includes(key), `${key} must reject ${JSON.stringify(bad)}`);
      }
      for (const good of ['release/1.x', 'scripts/pre-pr-gate.sh']) {
        assert.deepStrictEqual(invalid(setAt(validProfile(), path, good)), [], `${key} accepts ${good}`);
      }
    }
    assert.deepStrictEqual(invalid(setAt(validProfile(), ['stack', 'commands', 'search'], 'git grep -n')), []);
    assert.deepStrictEqual(invalid(setAt(validProfile(), ['project', 'owner_title'], 'git grep -n')), []);
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

describe('templates and reference', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');
  const REF = 'references/project-context.md';
  const BRIEF = 'templates/product-brief.md';
  const STACK = 'templates/stack-profile.md';
  const BRIEF_H2 = ['## Identity', '## Domain Glossary', '## Users and Roles', '## Risk Domains',
    '## Compliance and Regulation', '## Config Dimensions', '## Owner Policies', '## Out of Scope'];
  const STACK_H2 = ['## Commands', '## Test Command Shapes', '## Paths', '## Gates',
    '## Services', '## Capabilities', '## Isolation', '## Conventions'];

  const headingPositions = (text, headings) => headings.map((h) => text.indexOf(`\n${h}\n`));
  const assertOrdered = (positions, label) => {
    assert.ok(positions.every((p) => p > 0), `${label}: heading missing`);
    assert.ok(positions.every((p, i) => i === 0 || p > positions[i - 1]), `${label}: out of order`);
  };
  const lineCount = (text) => (text.match(/\n/g) || []).length;

  test('14 profile-example in project-context.md parses and validates with zero warnings', () => {
    const match = new RegExp('<!-- profile-example -->\\n```json\\n([\\s\\S]*?)\\n```').exec(read(REF));
    assert.ok(match, 'profile-example json block missing');
    const example = JSON.parse(match[1]);
    const result = profile.validateProfile({ found: true, error: null, project: example.project, stack: example.stack });
    assert.strictEqual(result.ok, true, JSON.stringify(result.missing.concat(result.invalid)));
    assert.deepStrictEqual(result.warnings, []);
  });

  test('15 pointer block carries the project_context tags and sentences verbatim', () => {
    const text = read(REF);
    [
      '<project_context>',
      '`.planning/PRODUCT-BRIEF.md`. Commands, paths, services and tools: `.planning/STACK-PROFILE.md`.',
      'Read the sections your role needs before acting. Every command, path and tool name comes from the profile.',
      'If a key you need is missing, stop and report the key. Never substitute a default stack.',
      '</project_context>',
    ].forEach((s) => assert.ok(text.includes(s), `pointer block missing: ${s}`));
  });

  test('16 product-brief.md has the 8 H2 headings in the design order', () => {
    assertOrdered(headingPositions(read(BRIEF), BRIEF_H2), 'product-brief');
  });

  test('17 stack-profile.md has the 8 H2 headings in order and a commands block matching KNOWN_COMMAND_KEYS', () => {
    const text = read(STACK);
    assertOrdered(headingPositions(text, STACK_H2), 'stack-profile');
    const begin = '<!-- gsd:begin commands -->';
    const end = '<!-- gsd:end commands -->';
    assert.strictEqual(text.split(begin).length, 2, 'exactly one begin marker');
    assert.strictEqual(text.split(end).length, 2, 'exactly one end marker');
    const block = text.slice(text.indexOf(begin), text.indexOf(end));
    const keys = block.split('\n')
      .filter((l) => l.startsWith('|') && !l.startsWith('|-'))
      .map((l) => l.split('|')[1].trim())
      .filter((k) => k !== 'Key');
    assert.deepStrictEqual([...keys].sort(), [...profile.KNOWN_COMMAND_KEYS].sort());
  });

  test('18 templates and reference stay within their line budgets', () => {
    [[BRIEF, 120], [STACK, 150], [REF, 90]].forEach(([rel, limit]) => {
      const n = lineCount(read(rel));
      assert.ok(n <= limit, `${rel}: ${n} lines exceeds ${limit}`);
    });
  });
});

describe('agnostic-M-03 3.1: shape checks for the base preset keys', () => {
  const NEW_VALID = {
    branch: { default: 'release/1.x' },
    locked_commands: ['test:e2e', 'run-all-suites.sh'],
    flake_patterns: {
      test_globs: ['**/*.test.js'],
      patterns: [{ id: 'shared-row', match: 'INSERT INTO shared_', requires_before: 'retry', unless_nearby: 'flake-ignore', window: 40, message: 'handle the collision' }],
    },
    deploy: { never_touch: ['gh workflow run deploy-prod', 'tools/release.sh prod'], slot_1: 'gsd-unused-deploy-entry-1' },
    style: { rule_set: 'generic', roots: ['.'], exclude_globs: ['vendor/**'], edge_globs: ['bin/**'], max_file_lines: 300, dup_min_lines: 8 },
    cve: { lockfiles: ['package-lock.json'], severity_floor: 'high', allow_missing_scanner: false },
    host: { worker_patterns: ['vitest'], protected_patterns: ['postgres'] },
    mutation: { error_pattern: 'SyntaxError|Cannot find module' },
    capabilities: { backend: {}, web_ui: false, ui_qa: { driver: 'browser', agent: 'qa-agent', lock_file: '.tmp/ui-qa.lock' } },
  };

  function checkStack(patch) {
    const base = validProfile();
    const stack = { ...base.stack, ...patch };
    return profile.validateProfile({ found: true, error: null, project: base.project, stack });
  }

  test('3.1 each new key with a valid value passes the check with no problem', () => {
    const report = checkStack(NEW_VALID);
    assert.deepStrictEqual(report.invalid, []);
    assert.deepStrictEqual(report.missing, []);
    assert.strictEqual(report.ok, true);
  });

  test('3.1 rejects the wrong shapes the plan names, each naming its key', () => {
    const cases = [
      [{ capabilities: { backend: true } }, 'stack.capabilities.backend'],
      [{ locked_commands: 'x' }, 'stack.locked_commands'],
      [{ deploy: { never_touch: ['a', 'b', 'c', 'd', 'e', 'f'] } }, 'stack.deploy.never_touch'],
      [{ style: { rule_set: 3, roots: ['.'] } }, 'stack.style.rule_set'],
      [{ flake_patterns: { test_globs: ['*.test.js'], patterns: [{ id: 'x', message: 'm' }] } }, 'stack.flake_patterns.patterns'],
    ];
    for (const [patch, key] of cases) {
      const report = checkStack(patch);
      assert.ok(report.invalid.some((p) => p.key === key), `${key}: ${JSON.stringify(report.invalid)}`);
    }
  });

  test('3.1 a flake pattern with an invalid regular expression, a zero window or no message is rejected', () => {
    const pattern = (extra) => ({ id: 'p', match: 'a', message: 'm', ...extra });
    const cases = [
      { match: '(' },
      { window: 0 },
      { message: '' },
      { requires_before: '[' },
    ];
    for (const extra of cases) {
      const report = checkStack({ flake_patterns: { test_globs: ['*.js'], patterns: [pattern(extra)] } });
      assert.ok(report.invalid.some((p) => p.key === 'stack.flake_patterns.patterns'), JSON.stringify(extra));
    }
  });
});

describe('agnostic-M-09 9.6: stack.mutation', () => {
  const check = (mutation) => profile.validateProfile({ found: true, error: null, project: validProfile().project, stack: { ...validProfile().stack, mutation } });

  test('9.6 stack.mutation.error_pattern is accepted as a regular expression string and rejected otherwise', () => {
    assert.deepStrictEqual(check({ error_pattern: 'SyntaxError' }).invalid, []);
    assert.deepStrictEqual(check({}).invalid, [], 'the key is optional');
    for (const bad of [5, true, null, ['SyntaxError'], '', '(']) {
      assert.ok(check({ error_pattern: bad }).invalid.some((p) => p.key === 'stack.mutation.error_pattern'), JSON.stringify(bad));
    }
    assert.ok(check('x').invalid.some((p) => p.key === 'stack.mutation'), 'not an object');
  });
});

describe('agnostic-M-03 3.8 C12: branch names and rendered length', () => {
  const keysOf = (project, stack) => profile.validateProfile({
    found: true,
    error: null,
    project: { slug: 'demo', owner_title: 'owner', risk_domains: [], ruling_topics: [], ...project },
    stack,
  }).invalid.map((p) => p.key);

  test('C12 a branch with a slash and a dot is accepted', () => {
    assert.deepStrictEqual(keysOf({}, { branch: { default: 'release/1.x' } }), []);
  });

  test('C12 a branch that is not a git ref is rejected, naming stack.branch.default', () => {
    for (const bad of ['my branch', '-x', 'a..b', 'x.lock', '/x', 'x/']) {
      assert.deepStrictEqual(keysOf({}, { branch: { default: bad } }), ['stack.branch.default'], bad);
    }
  });

  test('F6 the full git check-ref-format rules: //, /., a component ending .lock, a trailing dot, HEAD, @{ and the ref metacharacters are rejected; ordinary names are accepted', () => {
    for (const bad of ['a//b', 'a/.b', '.hidden', 'a/b.lock', 'a.lock/b', 'a.', 'a/b.', 'HEAD', 'a@{b', 'a\u0001b', 'a\tb', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', '/a', 'a/', 'a//', '@']) {
      assert.deepStrictEqual(keysOf({}, { branch: { default: bad } }), ['stack.branch.default'], JSON.stringify(bad));
    }
    for (const ok of ['main', 'master', 'release/1.x', 'feature/a-b_c', 'a.b/c.d', 'v1.2.3', 'HEAD2', 'heads/HEAD']) {
      assert.deepStrictEqual(keysOf({}, { branch: { default: ok } }), [], ok);
    }
  });

  test('C12 owner_title of 80 characters is accepted and 81 is rejected', () => {
    assert.deepStrictEqual(keysOf({ owner_title: 'a'.repeat(80) }, {}), []);
    assert.deepStrictEqual(keysOf({ owner_title: 'a'.repeat(81) }, {}), ['project.owner_title']);
  });
});
