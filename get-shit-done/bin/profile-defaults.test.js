/**
 * profile-defaults.test.js — WP18
 *
 * Pure checks of the one defaults table: its shape, the default gates it feeds to init and sync,
 * the fill init applies, the findings profile doctor reads, and the rule text against the known keys.
 * The doctor CLI runs in project-profile.test.js.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { STACK_DEFAULTS, stackFreeGateIds, gateDefaults, withTableDefaults, doctorFindings } = require('./profile-defaults.js');
const { KNOWN_COMMAND_KEYS } = require('./project-profile.js');

const GATE_IDS = ['hook-canaries', 'hook-patch-trailer', 'guard-canaries', 'guard-registry', 'style', 'flake-patterns', 'dependency-scan', 'adr', 'assertion-quality'];
const SEVERITIES = ['error', 'warn', 'info'];
const SCOPES = ['all projects', 'needs runner config', 'allocated per project'];

describe('profile-defaults table', () => {
  test('frozen; every entry names a default, a severity, a scope and a one-line why', () => {
    assert.ok(Object.isFrozen(STACK_DEFAULTS));
    for (const [key, e] of Object.entries(STACK_DEFAULTS)) {
      assert.ok('default' in e, `${key} has no default`);
      assert.ok(SEVERITIES.includes(e.severity), `${key} severity`);
      assert.ok(SCOPES.includes(e.scope), `${key} scope`);
      assert.ok(typeof e.why === 'string' && e.why.length > 0 && !e.why.includes('\n'), `${key} why`);
    }
  });

  test('default gates declare needs_stack:false only where the script was read and uses no stack; guard-canaries stays unmarked', () => {
    const byId = Object.fromEntries(gateDefaults({ web_ui: {} }).map((g) => [g.id, g]));
    const free = Object.keys(byId).filter((id) => byId[id].needs_stack === false);
    assert.deepStrictEqual(free.sort(), ['adr', 'assertion-quality', 'flake-patterns', 'guard-registry', 'hook-canaries', 'hook-patch-trailer', 'style']);
    assert.deepStrictEqual(stackFreeGateIds().sort(), free.sort());
    assert.strictEqual('needs_stack' in byId['guard-canaries'], false);
    assert.strictEqual('needs_stack' in byId['dependency-scan'], false);
  });

  test('the nine default gates appear once in registry order; assertion-quality needs web_ui', () => {
    assert.deepStrictEqual(gateDefaults({ web_ui: {} }).map((g) => g.id), GATE_IDS);
    assert.deepStrictEqual(gateDefaults({ web_ui: false }).map((g) => g.id), GATE_IDS.slice(0, 8));
  });

  test('no test_bucket, coverage, test_cmd, test_env, timeout_s or project-level mutation pattern key', () => {
    const keys = Object.keys(STACK_DEFAULTS);
    assert.deepStrictEqual(keys.filter((k) => /test_bucket|coverage|test_cmd|test_env|timeout_s|error_pattern/.test(k)), []);
  });

  test('the preset rule cites only command keys the profile knows', () => {
    const rule = fs.readFileSync(path.join(__dirname, '..', 'presets', 'base', 'rules', 'pre-pr-gates.md'), 'utf8');
    const cited = [...rule.matchAll(/stack\.commands\.(\w+)/g)].map((m) => m[1]);
    assert.deepStrictEqual(cited.filter((k) => !KNOWN_COMMAND_KEYS.includes(k)), []);
  });
});

describe('withTableDefaults (init fill)', () => {
  test('fills absent defaults, keeps values the project set, and fills no runner-specific key', () => {
    const filled = withTableDefaults({ capabilities: { web_ui: {} }, isolation: { lock_dir: 'mine' }, mutation: { timeout_s: 300 } });
    assert.strictEqual(filled.isolation.lock_dir, 'mine');
    assert.strictEqual(filled.mutation.timeout_s, 300);
    assert.strictEqual(filled.commands, undefined);
  });

  test('an empty stack writes neither timeout_s nor test_env', () => {
    assert.strictEqual(withTableDefaults({}).mutation, undefined);
  });

  test('lock_dir is filled only when locked_commands is non-empty', () => {
    assert.strictEqual(withTableDefaults({}).isolation, undefined);
    assert.strictEqual(withTableDefaults({ locked_commands: [] }).isolation, undefined);
    assert.strictEqual(withTableDefaults({ locked_commands: ['npm test'] }).isolation.lock_dir, '.tmp/stack.lock.d');
  });

  test('a non-object parent is kept as it is, never replaced by an object', () => {
    assert.strictEqual(withTableDefaults({ mutation: 'oops' }).mutation, 'oops');
    assert.strictEqual(withTableDefaults({ locked_commands: ['npm test'], isolation: 'x' }).isolation, 'x');
  });
});

describe('doctorFindings (pure)', () => {
  test('a value other than the optimal one is DIFFERS, never MISSING', () => {
    const findings = doctorFindings({ locked_commands: ['npm test'], isolation: { lock_dir: 'other' } });
    assert.ok(findings.some((f) => f.kind === 'DIFFERS' && f.key === 'stack.isolation.lock_dir'));
    assert.ok(!findings.some((f) => f.kind === 'MISSING' && f.key === 'stack.isolation.lock_dir'));
  });

  test('a missing lock_dir is an error MISSING only when locked_commands is non-empty', () => {
    const missing = (stack) => doctorFindings(stack).filter((f) => f.key === 'stack.isolation.lock_dir');
    assert.deepStrictEqual(missing({ locked_commands: ['npm test'], isolation: {} }).map((f) => [f.kind, f.entry.severity]), [['MISSING', 'error']]);
    assert.deepStrictEqual(missing({ isolation: {} }), []);
  });

  test('no mutation pattern key is reported as missing', () => {
    const findings = doctorFindings({ mutation: { error_pattern: 'x' } });
    assert.deepStrictEqual(findings.filter((f) => /error_pattern/.test(f.key)), []);
  });
});
