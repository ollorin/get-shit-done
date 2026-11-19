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

// Fills the keys a project left out (agent, tool_prefix, lock_file, recording) from its adapter; never overwrites.
// Returns the input untouched when the driver is unknown: validation reports that, sync does not guess.
function fillContract(uiQa) {
  if (!isObject(uiQa) || !listDrivers().includes(uiQa.driver)) return uiQa;
  const adapter = loadAdapter(uiQa.driver);
  const defaults = { agent: defaultAgent(), tool_prefix: adapter.tool_prefix, lock_file: adapter.lock_file, recording: adapter.recording, agent_aliases: agentAliases() };
  return { ...Object.fromEntries(Object.entries(defaults).filter(([k]) => uiQa[k] === undefined)), ...uiQa };
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
        const next = isObject(current) ? fillContract(current) : newContract(wanted);
        const written = JSON.stringify(next) !== JSON.stringify(current);
        if (written) {
          const stack = isObject(config.stack) ? config.stack : {};
          const capabilities = isObject(stack.capabilities) ? stack.capabilities : {};
          fs.writeFileSync(file, `${JSON.stringify({ ...config, stack: { ...stack, capabilities: { ...capabilities, ui_qa: next } } }, null, 2)}\n`);
        }
        return { result: { written, ui_qa: next }, exitCode: 0 };
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
  listDrivers, defaultDriver, defaultAgent, agentAliases, loadAdapter, resolveContract, fullToolName, fillContract, newContract, readUiQa,
};
