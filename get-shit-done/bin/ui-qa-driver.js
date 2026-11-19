'use strict';

// UI QA driver contract: stack.capabilities.ui_qa in .planning/config.json names a driver; the adapter data for each
// driver lives in presets/drivers/<driver>.json. The resolved contract is the adapter with every key the project sets
// laid over it. An unknown driver is an error, never a fallback.

const fs = require('fs');
const path = require('path');

const DRIVERS_DIR = path.join(__dirname, '..', 'presets', 'drivers');
const DRIVER_RE = /^[a-z0-9][a-z0-9-]*$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const settings = () => readJson(path.join(DRIVERS_DIR, 'index.json'));

function listDrivers() {
  return fs.readdirSync(DRIVERS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

const defaultDriver = () => settings().default;
const defaultAgent = () => settings().agent;
const agentAliases = () => settings().agent_aliases ?? [];

// Per-role op allowlists (logical op names) and the agent -> role map; a project's ui_qa.roles / ui_qa.role_agents win per key.
const roleTables = (uiQa) => ({
  roles: { ...(settings().roles ?? {}), ...(isObject(uiQa?.roles) ? uiQa.roles : {}) },
  roleAgents: { ...(settings().role_agents ?? {}), ...(isObject(uiQa?.role_agents) ? uiQa.role_agents : {}) },
});

const roleOf = (agentType, uiQa) => {
  if (typeof agentType !== 'string') return null;
  const role = roleTables(uiQa).roleAgents[agentType.split(':').pop()];
  return typeof role === 'string' ? role : null;
};

// Tool prefixes of every known adapter: a call to one that is not the configured driver's is a wrong-driver call.
const knownPrefixes = () => listDrivers().map((d) => readJson(path.join(DRIVERS_DIR, `${d}.json`)).tool_prefix).filter((p) => typeof p === 'string' && p !== '');

function unknownDriverError(driver) {
  return new Error(`unknown ui_qa driver "${driver}": known drivers are ${listDrivers().join(', ')} (stack.capabilities.ui_qa.driver in .planning/config.json)`);
}

function loadAdapter(driver) {
  if (typeof driver !== 'string' || !DRIVER_RE.test(driver) || !listDrivers().includes(driver)) throw unknownDriverError(driver);
  return readJson(path.join(DRIVERS_DIR, `${driver}.json`));
}

// Config values win; ops merge per op name so a project can override one op without restating the rest.
function resolveContract(uiQa) {
  if (!isObject(uiQa)) throw new Error('no ui_qa capability: declare stack.capabilities.ui_qa (with a driver) in .planning/config.json');
  const adapter = loadAdapter(uiQa.driver);
  const { description: _description, ...base } = adapter;
  return {
    ...base,
    agent: defaultAgent(),
    ...uiQa,
    roles: roleTables(uiQa).roles,
    role_agents: roleTables(uiQa).roleAgents,
    ops: { ...adapter.ops, ...(isObject(uiQa.ops) ? uiQa.ops : {}) },
    recording: { ...adapter.recording, ...(isObject(uiQa.recording) ? uiQa.recording : {}) },
    reset_patterns: Array.isArray(uiQa.reset_patterns) ? uiQa.reset_patterns : [],
  };
}

const fullToolName = (contract, op) => {
  const entry = contract.ops[op];
  if (!entry) throw new Error(`ui_qa driver "${contract.driver}" has no op "${op}"`);
  return entry.tool === null || entry.tool === undefined ? null : `${contract.tool_prefix}${entry.tool}`;
};

// Why a call to the configured driver is outside the role's op allowlist, or null. One driver bundles ops inside `act`,
// so an `act` call is matched on its `action` argument; every other tool is matched on its name.
function roleViolation(contract, role, tool, toolInput) {
  const allowed = contract.roles?.[role];
  if (!Array.isArray(allowed) || !tool.startsWith(contract.tool_prefix)) return null;
  const bare = tool.slice(contract.tool_prefix.length);
  const action = isObject(toolInput) ? toolInput.action : undefined;
  const hit = allowed.some((op) => {
    const entry = contract.ops[op];
    if (!entry || entry.tool !== bare) return false;
    return entry.args?.action === undefined || entry.args.action === action;
  });
  if (hit) return null;
  const what = action === undefined ? bare : `${bare} action=${action}`;
  return `role "${role}" may not call ${what} (allowed ops: ${allowed.join(', ')})`;
}

// Fills the keys a project left out (agent, tool_prefix, lock_file, recording) from its adapter; never overwrites.
// Returns the input untouched when the driver is unknown: validation reports that, sync does not guess.
function fillContract(uiQa) {
  if (!isObject(uiQa) || !listDrivers().includes(uiQa.driver)) return uiQa;
  const adapter = loadAdapter(uiQa.driver);
  const defaults = { agent: defaultAgent(), tool_prefix: adapter.tool_prefix, lock_file: adapter.lock_file, recording: adapter.recording, agent_aliases: agentAliases() };
  return { ...Object.fromEntries(Object.entries(defaults).filter(([k]) => uiQa[k] === undefined)), ...uiQa };
}

// The keys that belong to one adapter: a switch replaces them and keeps everything the project set (lock_file, reset_patterns, agent, ...).
const DRIVER_KEYS = ['driver', 'tool_prefix', 'ops', 'recording'];
function switchDriver(current, driver) {
  const kept = Object.fromEntries(Object.entries(current).filter(([k]) => !DRIVER_KEYS.includes(k)));
  return fillContract({ ...kept, driver });
}

const newContract = (driver) => fillContract({ driver: driver ?? defaultDriver() });

function readUiQa(root) {
  const config = readJson(path.join(root, '.planning', 'config.json'));
  return config?.stack?.capabilities?.ui_qa;
}

const flag = (args, name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

// gsd-tools ui-qa drivers | contract [--root d] | apply [--driver name] [--root d]
// apply --driver X on a project already using another driver switches it: driver-specific keys are replaced, project-set keys kept.
function runCli(args, cwd) {
  const root = path.resolve(cwd, flag(args, '--root') ?? '.');
  const fail = (message) => ({ result: { error: message }, exitCode: 1 });
  try {
    switch (args[0]) {
      case 'drivers':
        return { result: { default: defaultDriver(), drivers: listDrivers(), agent: defaultAgent(), agent_aliases: agentAliases() }, exitCode: 0 };
      case 'contract':
        return { result: resolveContract(readUiQa(root)), exitCode: 0 };
      case 'apply': {
        const file = path.join(root, '.planning', 'config.json');
        const config = readJson(file);
        const current = config?.stack?.capabilities?.ui_qa;
        const wanted = flag(args, '--driver');
        if (wanted !== undefined) loadAdapter(wanted);
        if (isObject(current)) loadAdapter(current.driver);
        const switching = isObject(current) && wanted !== undefined && wanted !== current.driver;
        const next = switching ? switchDriver(current, wanted) : isObject(current) ? fillContract(current) : newContract(wanted);
        const written = JSON.stringify(next) !== JSON.stringify(current);
        if (written) {
          const stack = isObject(config.stack) ? config.stack : {};
          const capabilities = isObject(stack.capabilities) ? stack.capabilities : {};
          fs.writeFileSync(file, `${JSON.stringify({ ...config, stack: { ...stack, capabilities: { ...capabilities, ui_qa: next } } }, null, 2)}\n`);
        }
        const changed = switching ? Object.keys({ ...current, ...next }).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(next[k])).sort() : [];
        return { result: { written, ...(switching ? { switched: { from: current.driver, to: wanted }, changed } : {}), ui_qa: next }, exitCode: 0 };
      }
      default:
        return fail('usage: ui-qa <drivers | contract [--root dir] | apply [--driver name] [--root dir]>');
    }
  } catch (e) {
    return fail(e.message);
  }
}

module.exports = {
  runCli,
  roleOf, knownPrefixes, roleViolation,
  listDrivers, defaultDriver, defaultAgent, agentAliases, loadAdapter, resolveContract, fullToolName, fillContract, newContract, readUiQa,
};
