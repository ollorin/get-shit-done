'use strict';

// Ordered, idempotent config migrations that `project upgrade` applies to .planning/config.json. Pure: a config in, a
// config out; a value the project set is never changed except by a rename listed here.

const { withTableDefaults } = require('./profile-defaults.js');
const { MUTATION_REFUSES_ERROR_PATTERN } = require('./profile-doctor-checks.js');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function renameErrorPattern(config) {
  const mutation = config.stack.mutation;
  if (!isObject(mutation) || !Object.prototype.hasOwnProperty.call(mutation, 'error_pattern')) return config;
  const { error_pattern: oldValue, ...rest } = mutation;
  const next = Object.prototype.hasOwnProperty.call(rest, 'build_error_pattern') ? rest : { ...rest, build_error_pattern: oldValue };
  return { ...config, stack: { ...config.stack, mutation: next } };
}

const fillTableDefaults = (config) => ({ ...config, stack: withTableDefaults(config.stack) });

const MIGRATIONS = Object.freeze([
  { id: 'table-defaults', enabled: () => true, apply: fillTableDefaults },
  { id: 'mutation-build-error-pattern', enabled: (flags) => flags.refusesErrorPattern, apply: renameErrorPattern },
]);

function migrateConfig(config, flags = { refusesErrorPattern: MUTATION_REFUSES_ERROR_PATTERN }) {
  if (!isObject(config) || !isObject(config.stack)) return config;
  return MIGRATIONS.filter((m) => m.enabled(flags)).reduce((acc, m) => m.apply(acc), config);
}

module.exports = { MIGRATIONS, migrateConfig };
