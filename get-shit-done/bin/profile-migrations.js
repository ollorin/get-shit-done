'use strict';

// Ordered, idempotent config migrations that `project upgrade` applies to .planning/config.json. Pure: a config in, a
// config out; a value the project set is never changed except by a rename listed here.

const { withTableDefaults, stackFreeGateIds } = require('./profile-defaults.js');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function renameErrorPattern(config) {
  const mutation = config.stack.mutation;
  if (!isObject(mutation) || !Object.prototype.hasOwnProperty.call(mutation, 'error_pattern')) return config;
  const { error_pattern: oldValue, ...rest } = mutation;
  const next = Object.prototype.hasOwnProperty.call(rest, 'build_error_pattern') ? rest : { ...rest, build_error_pattern: oldValue };
  return { ...config, stack: { ...config.stack, mutation: next } };
}

const fillTableDefaults = (config) => ({ ...config, stack: withTableDefaults(config.stack) });

// A shipped stack-free gate the project already has, with no needs_stack, gets needs_stack:false; an explicit value stays.
function markStackFreeGates(config) {
  const gates = config.stack.gates;
  if (!Array.isArray(gates)) return config;
  const free = stackFreeGateIds();
  const mark = (g) => (isObject(g) && free.includes(g.id) && !Object.prototype.hasOwnProperty.call(g, 'needs_stack') ? { ...g, needs_stack: false } : g);
  return { ...config, stack: { ...config.stack, gates: gates.map(mark) } };
}

const MIGRATIONS = Object.freeze([
  { id: 'table-defaults', apply: fillTableDefaults },
  { id: 'gate-needs-stack', apply: markStackFreeGates },
  { id: 'mutation-build-error-pattern', apply: renameErrorPattern },
]);

function migrateConfig(config) {
  if (!isObject(config) || !isObject(config.stack)) return config;
  return MIGRATIONS.reduce((acc, m) => m.apply(acc), config);
}

// The ids of the migrations that would change this config, applied in order; empty once the config is migrated.
function neededMigrationIds(config) {
  if (!isObject(config) || !isObject(config.stack)) return [];
  const steps = MIGRATIONS.reduce((acc, m) => {
    const next = m.apply(acc.config);
    return { config: next, ids: JSON.stringify(next) === JSON.stringify(acc.config) ? acc.ids : [...acc.ids, m.id] };
  }, { config, ids: [] });
  return steps.ids;
}

module.exports = { MIGRATIONS, migrateConfig, neededMigrationIds };
