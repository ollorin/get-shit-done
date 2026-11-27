'use strict';

// The one table of optimal stack.* defaults. project init fills absent keys from it, project sync appends the default
// gates a project lacks, and `profile doctor` reports each missing or differing key. A null default means the
// project sets the value itself; scope says whether one value fits every project, is set per runner, or is allocated per project.

const { isDeepStrictEqual } = require('util');

const ALL = 'all projects';
const RUNNER = 'needs runner config';
const PER_PROJECT = 'allocated per project';
const GATE_PREFIX = 'stack.gates.';

const entry = (fields) => Object.freeze(fields);
const lockedOnly = (stack) => Array.isArray(stack.locked_commands) && stack.locked_commands.length > 0;
const gate = (id, run, why, requires) => entry({ default: Object.freeze({ id, run }), severity: 'error', scope: ALL, why, requires });

const STACK_DEFAULTS = Object.freeze({
  'stack.affected.specs': entry({ default: null, severity: 'info', scope: RUNNER, why: 'selector config of scripts/affected-specs.mjs: file_pattern, always_run, fallback, map' }),
  'stack.affected.tests': entry({ default: null, severity: 'info', scope: RUNNER, why: 'selector config of scripts/affected-tests.mjs: file_pattern, always_run, fallback, map' }),
  'stack.commands.test_file': entry({ default: null, severity: 'error', scope: RUNNER, why: 'runs one test file; must contain {file}' }),
  'stack.commands.test_all': entry({ default: null, severity: 'error', scope: RUNNER, why: 'the full suite the pre-PR gate runs twice' }),
  'stack.commands.test_unit': entry({ default: null, severity: 'info', scope: RUNNER, why: 'optional hook-free unit lane for the selector and mutants' }),
  'stack.commands.typecheck': entry({ default: null, severity: 'error', scope: RUNNER, why: 'type check stage of the pre-PR gate; none acknowledges no code yet' }),
  'stack.commands.lint': entry({ default: null, severity: 'error', scope: RUNNER, why: 'lint stage of the pre-PR gate; none acknowledges no code yet' }),
  'stack.commands.format': entry({ default: null, severity: 'warn', scope: RUNNER, why: 'formatter of the before-PR checklist' }),
  'stack.locked_commands': entry({ default: null, severity: 'warn', scope: RUNNER, why: 'commands that run only under the stack lock; without them the lock guards nothing' }),
  'stack.test_command_shapes': entry({ default: null, severity: 'warn', scope: RUNNER, why: 'the only test commands agents may run; written by hand, no generator' }),
  'stack.isolation.lock_dir': entry({
    default: '.tmp/stack.lock.d', severity: 'error', scope: ALL, when: lockedOnly,
    why: 'stack lock directory holding owner.txt (project scripts/stack-lock.mjs:46); applies only with stack.locked_commands',
  }),
  'stack.isolation.port_base': entry({ default: null, severity: 'error', scope: PER_PROJECT, why: 'allocated by project init in projects.json; absent means the project never registered' }),
  'stack.mutation.build_error_pattern': entry({
    default: null, severity: 'info', scope: RUNNER, why: 'regex that marks a build failure errored, not killed; the mutation tool does not read this key yet',
  }),
  'stack.host.worker_patterns': entry({ default: null, severity: 'error', scope: RUNNER, why: 'test-runner process names the reaper matches' }),
  'stack.paths.backend': entry({ default: null, severity: 'error', scope: RUNNER, requires: 'backend', why: 'backend source root; scopes the edge-source freeze' }),
  'stack.paths.migrations': entry({ default: null, severity: 'error', scope: RUNNER, requires: 'backend', why: 'migrations directory; scopes the edge-source freeze' }),
  'stack.paths.frontends': entry({ default: null, severity: 'error', scope: RUNNER, requires: 'web_ui', why: 'frontend roots; scope the UI rules' }),
  'stack.gates.hook-canaries': gate('hook-canaries', 'scripts/validation/hook-canaries/run-canaries.sh', 'hook canaries: the hook guards still refuse their canary input'),
  'stack.gates.hook-patch-trailer': gate('hook-patch-trailer', 'scripts/validation/hook-patch-trailer-check.sh', 'checks the trailer on hook patches'),
  'stack.gates.guard-canaries': gate('guard-canaries', 'node scripts/validation/canary-gate.mjs', 'guard canaries: each guard still refuses its canary input'),
  'stack.gates.guard-registry': gate('guard-registry', 'node scripts/validation/guard-registry-reconcile.mjs', 'the guard registry matches the guards on disk'),
  'stack.gates.style': gate('style', 'node scripts/style-gate.mjs', 'style gate: rule set and module size limits'),
  'stack.gates.flake-patterns': gate('flake-patterns', 'node .claude/hooks/lib/flake-gate.mjs --all', 'flake pattern scan over the test globs'),
  'stack.gates.dependency-scan': gate('dependency-scan', 'node scripts/dependency-scan-gate.mjs', 'dependency scan over the lockfiles'),
  'stack.gates.adr': gate('adr', 'node scripts/validation/adr-reconcile.mjs', 'decisions and their records agree'),
  'stack.gates.assertion-quality': gate('assertion-quality', 'node scripts/validation/check-assertion-quality.mjs', 'assertion quality of the UI scenarios', 'web_ui'),
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isGateKey = (key) => key.startsWith(GATE_PREFIX);
const pathOf = (key) => key.split('.').slice(1);
const applies = (e, capabilities) => e.requires === undefined || isObject(capabilities?.[e.requires]);
const applicable = (e, stack) => applies(e, stack.capabilities) && (e.when === undefined || e.when(stack));

function readKey(stack, key) {
  if (isGateKey(key)) {
    const id = key.slice(GATE_PREFIX.length);
    return Array.isArray(stack.gates) ? stack.gates.find((g) => isObject(g) && g.id === id) : undefined;
  }
  return pathOf(key).reduce((node, part) => (isObject(node) && hasOwn(node, part) ? node[part] : undefined), stack);
}

// A parent that exists and is not an object (`mutation: "oops"`) is kept as it is; the key is not written under it.
function withKey(node, [head, ...rest], value) {
  if (node !== undefined && !isObject(node)) return node;
  const base = isObject(node) ? node : {};
  return { ...base, [head]: rest.length === 0 ? value : withKey(base[head], rest, value) };
}

// The default gates that apply to these capabilities, in table order.
function gateDefaults(capabilities) {
  return Object.entries(STACK_DEFAULTS)
    .filter(([key, e]) => isGateKey(key) && applies(e, capabilities))
    .map(([, e]) => ({ ...e.default }));
}

// Fills the absent non-gate keys that have a default; a value the project set is never changed.
function withTableDefaults(stack) {
  return Object.entries(STACK_DEFAULTS)
    .filter(([key, e]) => !isGateKey(key) && e.default !== null && applicable(e, stack) && readKey(stack, key) === undefined)
    .reduce((acc, [key, e]) => withKey(acc, pathOf(key), e.default), stack);
}

const finding = (kind, key, e, value) => Object.freeze({ kind, key, entry: e, value });

// The script a gate runs: the first word that is a path or has an extension ("node scripts/x.mjs" -> scripts/x.mjs).
const scriptOf = (run) => run.split(/\s+/).find((word) => word.includes('/') || /\.\w+$/.test(word));

// A default gate with no script in the project's preset cannot be satisfied there: an absent one is information, not a block.
const noScript = (key, e, hasScript) => typeof hasScript === 'function' && isGateKey(key) && !hasScript(scriptOf(e.default.run) ?? e.default.run);
const asInfo = (e) => ({ ...e, severity: 'info', why: `no script in the project's preset; ${e.why}` });

// opts.hasScript(path) says whether a gate script exists in the project's preset (or on disk); absent means every gate applies.
function doctorFindings(stack, opts = {}) {
  return Object.entries(STACK_DEFAULTS).flatMap(([key, e]) => {
    if (!applicable(e, stack)) return [];
    const value = readKey(stack, key);
    if (value === undefined) return [noScript(key, e, opts.hasScript) ? finding('INFO', key, asInfo(e), value) : finding('MISSING', key, e, value)];
    return e.default !== null && !isDeepStrictEqual(value, e.default) ? [finding('DIFFERS', key, e, value)] : [];
  });
}

// A DIFFERS line is information; a missing key with severity error blocks.
const isBlocking = (f) => f.kind === 'MISSING' && f.entry.severity === 'error';

const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const defaultText = (e) => (e.default === null ? `(none: ${e.scope})` : show(e.default));
const LINE = Object.freeze({
  MISSING: ({ key, entry: e }) => `MISSING ${key} -> ${defaultText(e)} (${e.severity}: ${e.why})`,
  INFO: ({ key, entry: e }) => `INFO ${key} -> ${defaultText(e)} (${e.severity}: ${e.why})`,
  DIFFERS: ({ key, value, entry: e }) => `DIFFERS ${key} = ${show(value)} (optimal ${show(e.default)})`,
});
const doctorLines = (findings) => findings.map((f) => LINE[f.kind](f));

module.exports = { STACK_DEFAULTS, gateDefaults, withTableDefaults, doctorFindings, doctorLines, isBlocking };
