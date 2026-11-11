'use strict';

// Loader and validator for the `project` and `stack` blocks of .planning/config.json.
// Pure apart from loadProfile's single read; errors are returned as data, never thrown.

const fs = require('fs');
const path = require('path');

const REQUIRED_KEYS = Object.freeze([
  'project.slug',
  'project.owner_title',
  'project.risk_domains',
  'project.ruling_topics',
  'stack.commands.test_file',
]);

const KNOWN_PROJECT_KEYS = ['slug', 'owner_title', 'risk_domains', 'ruling_topics'];
const KNOWN_STACK_KEYS = ['preset', 'preset_version', 'paths', 'commands', 'test_command_shapes', 'gates', 'services', 'capabilities', 'isolation'];
const KNOWN_COMMAND_KEYS = Object.freeze(['test_file', 'test_all', 'typecheck', 'lint', 'format', 'frontend_test', 'pre_pr_gate', 'search']);
const COMMAND_PLACEHOLDERS = Object.freeze(['{root}', '{file}', '{paths}', '{project}']);
const KNOWN_PATH_KEYS = Object.freeze(['backend', 'migrations', 'api_globs', 'e2e_scenarios', 'frontends']);
const ARRAY_PATH_KEYS = Object.freeze(['api_globs', 'frontends']);
const KNOWN_CAPABILITY_KEYS = Object.freeze(['ui_qa']);
const ISOLATION_KEYS = Object.freeze(['port_base', 'container_suffix', 'lock_dir', 'machine_locks']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const PLACEHOLDER_RE = /(?<!\$)\{[a-z_]+\}/g;
const SINGLE_QUOTED_RE = /'[^']*'/g;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isListOfNonEmpty = (v) => Array.isArray(v) && v.every(isNonEmptyString);
const problem = (key, reason) => ({ key, reason });

const nonEmptyCheck = (key, v) => (isNonEmptyString(v) ? [] : [problem(key, 'must be a non-empty string')]);
const listCheck = (key, v) => (isListOfNonEmpty(v) ? [] : [problem(key, 'must be an array of non-empty strings')]);
const uniqueCheck = (key, ids, label) => (new Set(ids).size === ids.length ? [] : [problem(key, `duplicate ${label}`)]);

const slugCheck = (key, v) => (typeof v === 'string' && SLUG_RE.test(v) ? [] : [problem(key, 'must match ^[a-z0-9][a-z0-9-]*$')]);

function uniqueStringsCheck(key, v) {
  if (!isListOfNonEmpty(v)) return [problem(key, 'must be an array of non-empty strings')];
  return uniqueCheck(key, v, 'value');
}

// Single-quoted text is shell literal (awk programs), so placeholders there are not read; `${NAME}` is shell expansion.
// With an odd number of quotes the pairing is unknowable, so nothing is stripped and every placeholder is read.
const isBalancedQuotes = (v) => (v.split("'").length - 1) % 2 === 0;
const placeholdersIn = (v) => (isBalancedQuotes(v) ? v.replace(SINGLE_QUOTED_RE, '') : v).match(PLACEHOLDER_RE) || [];

function commandValueProblems(key, v) {
  if (!isNonEmptyString(v)) return [problem(key, 'must be a non-empty string')];
  const unknown = placeholdersIn(v).find((t) => !COMMAND_PLACEHOLDERS.includes(t));
  return unknown ? [problem(key, `unknown placeholder ${unknown}`)] : [];
}

function testFileProblems(key, value) {
  if (!isNonEmptyString(value) || placeholdersIn(value).includes('{file}')) return [];
  const reason = value.includes('{file}')
    ? '{file} is present only inside single quotes; it must be unquoted or double-quoted'
    : 'must contain the {file} placeholder';
  return [problem(key, reason)];
}

function commandsCheck(key, v) {
  if (!isObject(v)) return [problem(key, 'must be an object')];
  return Object.keys(v).flatMap((name) => {
    const k = `${key}.${name}`;
    const value = v[name];
    return [...commandValueProblems(k, value), ...(name === 'test_file' ? testFileProblems(k, value) : [])];
  });
}

function pathsCheck(key, v) {
  if (!isObject(v)) return [problem(key, 'must be an object')];
  return Object.keys(v).flatMap((name) => {
    const value = v[name];
    const ok = Array.isArray(value)
      ? value.every(isNonEmptyString)
      : !ARRAY_PATH_KEYS.includes(name) && isNonEmptyString(value);
    return ok ? [] : [problem(`${key}.${name}`, 'must be a non-empty string or an array of non-empty strings')];
  });
}

function gatesCheck(key, v) {
  if (!Array.isArray(v)) return [problem(key, 'must be an array of {id, run}')];
  const shape = v.flatMap((g, i) => (isObject(g) && isNonEmptyString(g.id) && isNonEmptyString(g.run)
    ? []
    : [problem(key, `entry ${i} needs non-empty id and run`)]));
  return shape.length ? shape : uniqueCheck(key, v.map((g) => g.id), 'gate id');
}

function servicesCheck(key, v) {
  if (!Array.isArray(v)) return [problem(key, 'must be an array of {name, url}')];
  const optional = ['health', 'launch', 'ready'];
  const shape = v.flatMap((s, i) => (isObject(s) && isNonEmptyString(s.name) && isNonEmptyString(s.url)
    && optional.every((f) => s[f] === undefined || isNonEmptyString(s[f]))
    ? []
    : [problem(key, `entry ${i} needs non-empty name and url`)]));
  return shape.length ? shape : uniqueCheck(key, v.map((s) => s.name), 'service name');
}

function capabilitiesCheck(key, v) {
  if (!isObject(v)) return [problem(key, 'must be an object')];
  if (v.ui_qa === undefined) return [];
  const u = v.ui_qa;
  const ok = isObject(u) && isNonEmptyString(u.driver) && isNonEmptyString(u.agent)
    && (u.tool_prefix === undefined || typeof u.tool_prefix === 'string')
    && (u.reset_patterns === undefined || isListOfNonEmpty(u.reset_patterns));
  return ok ? [] : [problem(`${key}.ui_qa`, 'needs non-empty driver and agent; tool_prefix string; reset_patterns non-empty strings')];
}

function isolationCheck(key, v) {
  if (!isObject(v)) return [problem(key, 'must be an object')];
  const fields = [
    ['port_base', (x) => Number.isInteger(x) && x >= 1024 && x <= 65535],
    ['container_suffix', isNonEmptyString],
    ['lock_dir', isNonEmptyString],
    ['machine_locks', isListOfNonEmpty],
  ];
  return fields.flatMap(([f, ok]) => (v[f] === undefined || ok(v[f]) ? [] : [problem(`${key}.${f}`, 'invalid value')]));
}

const SHAPE_CHECKS = Object.freeze([
  ['project.slug', slugCheck],
  ['project.owner_title', nonEmptyCheck],
  ['project.risk_domains', uniqueStringsCheck],
  ['project.ruling_topics', uniqueStringsCheck],
  ['stack.preset', nonEmptyCheck],
  ['stack.preset_version', nonEmptyCheck],
  ['stack.paths', pathsCheck],
  ['stack.commands', commandsCheck],
  ['stack.test_command_shapes', listCheck],
  ['stack.gates', gatesCheck],
  ['stack.services', servicesCheck],
  ['stack.capabilities', capabilitiesCheck],
  ['stack.isolation', isolationCheck],
]);

const UNKNOWN_KEY_SCOPES = Object.freeze([
  ['project', KNOWN_PROJECT_KEYS],
  ['stack', KNOWN_STACK_KEYS],
  ['stack.commands', KNOWN_COMMAND_KEYS],
  ['stack.paths', KNOWN_PATH_KEYS],
  ['stack.capabilities', KNOWN_CAPABILITY_KEYS],
  ['stack.isolation', ISOLATION_KEYS],
]);

function loadResult(found, error, parsed) {
  return {
    found,
    error,
    project: isObject(parsed) ? parsed.project : undefined,
    stack: isObject(parsed) ? parsed.stack : undefined,
  };
}

function loadProfile(cwd) {
  const file = path.join(cwd, '.planning', 'config.json');
  if (!fs.existsSync(file)) return loadResult(false, null, undefined);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return loadResult(true, 'config.json is not valid JSON', undefined);
  }
  if (!isObject(parsed)) return loadResult(true, 'config.json root is not an object', undefined);
  return loadResult(true, null, parsed);
}

function getProfileValue(profile, keyPath) {
  if (typeof keyPath !== 'string' || !isObject(profile)) return undefined;
  const [root, ...rest] = keyPath.split('.');
  if (root !== 'project' && root !== 'stack') return undefined;
  return rest.reduce(
    (node, part) => (isObject(node) && Object.prototype.propertyIsEnumerable.call(node, part) ? node[part] : undefined),
    Object.prototype.propertyIsEnumerable.call(profile, root) ? profile[root] : undefined,
  );
}

function unknownKeyWarnings(profile) {
  return UNKNOWN_KEY_SCOPES.flatMap(([scope, known]) => {
    const node = getProfileValue(profile, scope);
    return isObject(node)
      ? Object.keys(node).filter((k) => !known.includes(k)).map((k) => `unknown key: ${scope}.${k}`)
      : [];
  }).sort();
}

function report(configFound, missing, invalid, warnings) {
  const sortedMissing = [...missing].sort();
  const sortedInvalid = [...invalid].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    ok: sortedMissing.length === 0 && sortedInvalid.length === 0,
    config_found: configFound,
    missing: sortedMissing,
    invalid: sortedInvalid,
    warnings,
  };
}

function validateProfile(profile) {
  const configFound = profile.found === true;
  if (profile.error) {
    return report(configFound, REQUIRED_KEYS, [problem('config.json', profile.error)], []);
  }
  const topLevel = [['project', profile.project], ['stack', profile.stack]].flatMap(([k, v]) => (
    v === undefined || isObject(v) ? [] : [problem(k, 'must be an object')]
  ));
  const shape = SHAPE_CHECKS.flatMap(([key, check]) => {
    const value = getProfileValue(profile, key);
    return value === undefined ? [] : check(key, value);
  });
  const missing = REQUIRED_KEYS.filter((key) => getProfileValue(profile, key) === undefined);
  return report(configFound, missing, [...topLevel, ...shape], unknownKeyWarnings(profile));
}

function runCli(cwd, args) {
  const [sub, key] = args;
  if (sub === 'check') {
    const result = validateProfile(loadProfile(cwd));
    return { exitCode: result.ok ? 0 : 1, result };
  }
  if (sub === 'get') {
    if (typeof key !== 'string' || !/^(project|stack)(\.|$)/.test(key)) {
      return { exitCode: 1, error: 'profile keys start with project. or stack.' };
    }
    const profile = loadProfile(cwd);
    if (profile.error) return { exitCode: 1, error: profile.error };
    const value = getProfileValue(profile, key);
    if (value === undefined) return { exitCode: 1, error: `profile key not set: ${key}` };
    const rawValue = typeof value === 'string' ? value : JSON.stringify(value);
    return { exitCode: 0, result: { key, value }, rawValue };
  }
  return { exitCode: 1, error: 'Usage: profile <get <key>|check>' };
}

module.exports = {
  REQUIRED_KEYS,
  KNOWN_COMMAND_KEYS,
  COMMAND_PLACEHOLDERS,
  loadProfile,
  getProfileValue,
  validateProfile,
  runCli,
};
