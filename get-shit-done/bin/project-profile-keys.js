'use strict';

// Shape checks for the stack keys added by agnostic-M-03: branch, locked_commands, flake_patterns,
// deploy, style, cve, host and mutation. project-profile.js registers them; an absent key is not checked.

const DEPLOY_SLOTS = 5;
// Values rendered into generated Perl, shell and JSON files (decision 3 of the M index).
const RENDERED_TEXT_RE = /^[A-Za-z0-9 ._/-]+$/;
const RENDERED_TEXT_MAX = 80;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isRenderedText = (v) => isNonEmptyString(v) && v.length <= RENDERED_TEXT_MAX && RENDERED_TEXT_RE.test(v);
const isListOfNonEmpty = (v) => Array.isArray(v) && v.every(isNonEmptyString);
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const isBoolean = (v) => typeof v === 'boolean';
const isRegex = (v) => {
  try {
    RegExp(v);
    return true;
  } catch {
    return false;
  }
};
const problem = (key, reason) => ({ key, reason });

// spec rows: [name, predicate, description, required?]. An absent optional field passes.
function fieldProblems(key, obj, spec) {
  return spec.flatMap(([name, ok, what, required = false]) => {
    const value = obj[name];
    if (value === undefined) return required ? [problem(`${key}.${name}`, `is required: ${what}`)] : [];
    return ok(value) ? [] : [problem(`${key}.${name}`, `must be ${what}`)];
  });
}

const objectShape = (spec, extra = () => []) => (key, v) => (isObject(v)
  ? [...fieldProblems(key, v, spec), ...extra(key, v)]
  : [problem(key, 'must be an object')]);

const LIST = 'an array of non-empty strings';
const optionalRegex = (p, field) => (p[field] === undefined || (isNonEmptyString(p[field]) && isRegex(p[field]))
  ? []
  : [problem('stack.flake_patterns.patterns', `pattern ${p.id}: ${field} must be a valid regular expression`)]);

function patternProblems(p) {
  if (!isObject(p)) return [problem('stack.flake_patterns.patterns', 'each pattern must be an object')];
  return [
    ...(isNonEmptyString(p.id) ? [] : [problem('stack.flake_patterns.patterns', 'each pattern needs a non-empty id')]),
    ...(isNonEmptyString(p.message) ? [] : [problem('stack.flake_patterns.patterns', `pattern ${p.id}: message must be a non-empty string`)]),
    ...(isNonEmptyString(p.match) && isRegex(p.match)
      ? []
      : [problem('stack.flake_patterns.patterns', `pattern ${p.id}: match must be a valid regular expression`)]),
    ...optionalRegex(p, 'requires_before'),
    ...optionalRegex(p, 'unless_nearby'),
    ...(p.window === undefined || isPositiveInt(p.window)
      ? []
      : [problem('stack.flake_patterns.patterns', `pattern ${p.id}: window must be a positive integer`)]),
  ];
}

const DEPLOY_FIELDS = [
  ['never_touch', (x) => Array.isArray(x) && x.length <= DEPLOY_SLOTS && x.every(isRenderedText),
    `an array of at most ${DEPLOY_SLOTS} command prefixes matching ^[A-Za-z0-9 ._/-]+$`],
  ...Array.from({ length: DEPLOY_SLOTS }, (_, i) => [`slot_${i + 1}`, isRenderedText, 'rendered text matching ^[A-Za-z0-9 ._/-]+$']),
];

const FLAKE_FIELDS = [
  ['test_globs', isListOfNonEmpty, LIST, true],
  ['patterns', Array.isArray, 'an array of pattern objects', true],
];

const STYLE_FIELDS = [
  ['rule_set', isNonEmptyString, 'a non-empty string', true],
  ['roots', isListOfNonEmpty, LIST, true],
  ['exclude_globs', isListOfNonEmpty, LIST],
  ['edge_globs', isListOfNonEmpty, LIST],
  ['max_file_lines', isPositiveInt, 'a positive integer'],
  ['dup_min_lines', isPositiveInt, 'a positive integer'],
];

const CVE_FIELDS = [
  ['lockfiles', isListOfNonEmpty, LIST],
  ['severity_floor', isNonEmptyString, 'a non-empty string'],
  ['allow_missing_scanner', isBoolean, 'a boolean'],
];

const MUTATION_FIELDS = [
  ['build_error_pattern', (v) => isNonEmptyString(v) && isRegex(v), 'a valid regular expression'],
];

// The engine catalogue of known runners with captured output fixtures (references/mutation-runners.json).
function loadRunnerCatalogue() {
  try {
    return require('../references/mutation-runners.json');
  } catch {
    return {};
  }
}

// F3: a catalogued runner's effective build pattern must not match its normal kill output and must match its build failure.
function fixtureProblems(key, id, pattern, fixtures) {
  if (!isNonEmptyString(pattern) || !isRegex(pattern) || !isObject(fixtures)) return [];
  const re = new RegExp(pattern);
  return [
    ...(re.test(fixtures.kill) ? [problem(key, `build_error_pattern matches the normal kill output of runner ${id}: a kill would count as errored`)] : []),
    ...(re.test(fixtures.build_failure) ? [] : [problem(key, `build_error_pattern does not match the build failure output of runner ${id}`)]),
  ];
}

function runnerProblems(key, runner, mutation, catalogue) {
  if (!isObject(runner)) return [problem(key, 'must be an object')];
  const own = fieldProblems(key, runner, [
    ['id', isNonEmptyString, 'a non-empty string', true],
    ['test_cmd', (v) => isNonEmptyString(v) && v.includes('{file}'), 'a command containing {file}', true],
    ['build_error_pattern', (v) => isNonEmptyString(v) && isRegex(v), 'a valid regular expression'],
  ]);
  const known = Object.prototype.hasOwnProperty.call(catalogue, runner.id) ? catalogue[runner.id] : undefined;
  return known === undefined ? own : [...own, ...fixtureProblems(`${key}.build_error_pattern`, runner.id, runner.build_error_pattern ?? mutation.build_error_pattern, known.fixtures)];
}

function mutationExtra(key, v) {
  const renamed = Object.prototype.hasOwnProperty.call(v, 'error_pattern')
    ? [problem(`${key}.error_pattern`, 'is renamed: use build_error_pattern (the mutation tool refuses the old key)')]
    : [];
  if (v.runners === undefined) return renamed;
  if (!Array.isArray(v.runners) || v.runners.length === 0) return [...renamed, problem(`${key}.runners`, 'must be a non-empty array of runner objects')];
  const catalogue = loadRunnerCatalogue();
  const ids = v.runners.map((r) => (isObject(r) ? r.id : undefined));
  const dupes = [...new Set(ids.filter((id, i) => id !== undefined && ids.indexOf(id) !== i))];
  return [
    ...renamed,
    ...v.runners.flatMap((r, i) => runnerProblems(`${key}.runners[${i}]`, r, v, catalogue)),
    ...(dupes.length > 0 ? [problem(`${key}.runners`, `duplicate runner ids: ${dupes.join(', ')}`)] : []),
  ];
}

const HOST_FIELDS = [
  ['worker_patterns', isListOfNonEmpty, LIST],
  ['protected_patterns', isListOfNonEmpty, LIST],
];

const flakeExtra = (_key, o) => (Array.isArray(o.patterns) ? o.patterns.flatMap(patternProblems) : []);

// Without require(esm) (Node < 22.12) no problem is reported: the runtime scripts validate with parseSelectorConfig and exit 2.
function affectedShape(key, v) {
  if (!isObject(v)) return [problem(key, 'must be an object')];
  let parse;
  try {
    ({ parseSelectorConfig: parse } = require('../presets/base/scripts/lib/affected.mjs'));
  } catch {
    return [];
  }
  return ['specs', 'tests'].flatMap((name) => {
    if (v[name] === undefined) return [];
    const r = parse(v[name], `${key}.${name}`);
    return r.ok ? [] : [problem(`${key}.${name}`, r.error)];
  });
}

const NEW_STACK_KEYS = Object.freeze(['locked_commands', 'flake_patterns', 'deploy', 'style', 'cve', 'host', 'mutation', 'affected']);

const NEW_SHAPE_CHECKS = Object.freeze([
  ['stack.branch', objectShape([])],
  ['stack.locked_commands', (key, v) => (isListOfNonEmpty(v) ? [] : [problem(key, `must be ${LIST}`)])],
  ['stack.flake_patterns', objectShape(FLAKE_FIELDS, flakeExtra)],
  ['stack.deploy', objectShape(DEPLOY_FIELDS)],
  ['stack.style', objectShape(STYLE_FIELDS)],
  ['stack.cve', objectShape(CVE_FIELDS)],
  ['stack.host', objectShape(HOST_FIELDS)],
  ['stack.mutation', objectShape(MUTATION_FIELDS, mutationExtra)],
  ['stack.affected', affectedShape],
]);

module.exports = { NEW_STACK_KEYS, NEW_SHAPE_CHECKS, DEPLOY_SLOTS, RENDERED_TEXT_RE, RENDERED_TEXT_MAX, isRenderedText };
