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
const { STACK_DEFAULTS, gateDefaults, withTableDefaults, doctorFindings } = require('./profile-defaults.js');
const { KNOWN_COMMAND_KEYS } = require('./project-profile.js');

const GATE_IDS = ['hook-canaries', 'hook-patch-trailer', 'guard-canaries', 'guard-registry', 'style', 'flake-patterns', 'dependency-scan', 'adr', 'assertion-quality'];
const SEVERITIES = ['error', 'warn'];
const SCOPES = ['all projects', 'needs runner config'];

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

  test('the nine default gates appear once in registry order; assertion-quality needs web_ui', () => {
    assert.deepStrictEqual(gateDefaults({ web_ui: {} }).map((g) => g.id), GATE_IDS);
    assert.deepStrictEqual(gateDefaults({ web_ui: false }).map((g) => g.id), GATE_IDS.slice(0, 8));
  });

  test('no test_bucket or coverage key; the old error_pattern is refused in favour of build_error_pattern', () => {
    const keys = Object.keys(STACK_DEFAULTS);
    assert.deepStrictEqual(keys.filter((k) => /test_bucket|coverage/.test(k)), []);
    assert.ok(keys.includes('stack.mutation.build_error_pattern'));
    assert.strictEqual(STACK_DEFAULTS['stack.mutation.error_pattern'].refused, true);
    assert.strictEqual(STACK_DEFAULTS['stack.mutation.error_pattern'].replacement, 'stack.mutation.build_error_pattern');
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
    assert.deepStrictEqual(filled.mutation.test_env, {});
    assert.strictEqual(filled.mutation.build_error_pattern, undefined);
    assert.strictEqual(filled.commands, undefined);
  });

  test('an empty stack gets the lock directory default', () => {
    assert.strictEqual(withTableDefaults({}).isolation.lock_dir, '.tmp/stack.lock.d');
  });
});

describe('doctorFindings (pure)', () => {
  test('a value other than the optimal one is DIFFERS, never MISSING; a stale refused key is STALE', () => {
    const findings = doctorFindings({ isolation: { lock_dir: 'other' }, mutation: { error_pattern: 'x' } });
    assert.ok(findings.some((f) => f.kind === 'DIFFERS' && f.key === 'stack.isolation.lock_dir'));
    assert.ok(!findings.some((f) => f.kind === 'MISSING' && f.key === 'stack.isolation.lock_dir'));
    assert.ok(findings.some((f) => f.kind === 'STALE' && f.key === 'stack.mutation.error_pattern'));
  });
});
