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

function listDrivers(kind) {
  return fs.readdirSync(DRIVERS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.slice(0, -'.json'.length))
    .filter((d) => kind === undefined || (readJson(path.join(DRIVERS_DIR, `${d}.json`)).kind === 'command' ? 'command' : 'mcp') === kind)
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

const isCommand = (adapter) => adapter?.kind === 'command';

function loadAdapter(driver) {
  if (typeof driver !== 'string' || !DRIVER_RE.test(driver) || !listDrivers().includes(driver)) throw unknownDriverError(driver);
  return readJson(path.join(DRIVERS_DIR, `${driver}.json`));
}

const kindOf = (driver) => (isCommand(loadAdapter(driver)) ? 'command' : 'mcp');

// Two tiers. Tier 1 "scripted": a command-kind driver that runs `command`. Tier 2 "mcp": an agent driving an MCP
// browser. ui_qa.driver names whichever tier the project already uses; the other tier is a nested object
// (ui_qa.mcp beside a command-kind driver, ui_qa.scripted beside an MCP one), so an existing config stays valid unedited.
const MCP_INHERITED = ['agent', 'agent_aliases', 'lock_file', 'lock_wrappers', 'reset_patterns', 'roles', 'role_agents'];
function mcpTier(uiQa) {
  if (!isObject(uiQa) || typeof uiQa.driver !== 'string') return null;
  if (kindOf(uiQa.driver) === 'mcp') return uiQa;
  if (!isObject(uiQa.mcp)) return null;
  const inherited = Object.fromEntries(MCP_INHERITED.filter((k) => uiQa.mcp[k] === undefined && uiQa[k] !== undefined && k !== 'agent').map((k) => [k, uiQa[k]]));
  return { ...inherited, ...uiQa.mcp };
}

function resolveTier(uiQa) {
  if (!isObject(uiQa)) throw new Error('no ui_qa capability: declare stack.capabilities.ui_qa (with a driver) in .planning/config.json');
  const adapter = loadAdapter(uiQa.driver);
  const { description: _description, ...base } = adapter;
  if (isCommand(adapter)) {
    if (typeof uiQa.command !== 'string' || uiQa.command.trim() === '') throw new Error(`ui_qa driver "${uiQa.driver}" is a command driver: set stack.capabilities.ui_qa.command`);
    return { ...base, agent: adapter.agent ?? defaultAgent(), ...uiQa, kind: 'command' };
  }
  return {
    ...base,
    kind: 'mcp',
    agent: defaultAgent(),
    agent_aliases: (uiQa.agent ?? defaultAgent()) === defaultAgent() ? agentAliases() : [],
    ...uiQa,
    roles: roleTables(uiQa).roles,
    role_agents: roleTables(uiQa).roleAgents,
    ops: { ...adapter.ops, ...(isObject(uiQa.ops) ? uiQa.ops : {}) },
    recording: { ...adapter.recording, ...(isObject(uiQa.recording) ? uiQa.recording : {}) },
    reset_patterns: Array.isArray(uiQa.reset_patterns) ? uiQa.reset_patterns : [],
  };
}

// Config values win; ops merge per op name so a project can override one op without restating the rest.
function resolveContract(uiQa) {
  const { mcp: nestedMcp, scripted: nestedScripted, ...own } = isObject(uiQa) ? uiQa : {};
  const top = resolveTier(isObject(uiQa) ? own : uiQa);
  if (top.kind === 'command') {
    const mcp = isObject(nestedMcp) ? resolveTier(mcpTier(uiQa)) : undefined;
    if (mcp && mcp.kind !== 'mcp') throw new Error('ui_qa.mcp must name an MCP-kind driver');
    return mcp ? { ...top, mcp } : top;
  }
  if (nestedScripted === undefined) return top;
  const scripted = resolveTier(nestedScripted);
  if (scripted.kind !== 'command') throw new Error('ui_qa.scripted must name a command-kind driver');
  return { ...top, scripted };
}

// The MCP tier fully resolved (agent, aliases, lock_file, roles, ...), or null when the project declares none. The lock hook and
// `contract --tier mcp` both read this, so they cannot disagree.
function resolveMcpTier(uiQa) {
  const contract = resolveContract(uiQa);
  return contract.kind === 'mcp' ? contract : (contract.mcp ?? null);
}

const fullToolName = (contract, op) => {
  if (contract.kind === 'command') throw new Error(`ui_qa driver "${contract.driver}" is a command driver: it has no MCP ops`);
  const entry = contract.ops[op];
  if (!entry) throw new Error(`ui_qa driver "${contract.driver}" has no op "${op}"`);
  return entry.tool === null || entry.tool === undefined ? null : `${contract.tool_prefix}${entry.tool}`;
};

// Logical ops a (tool, args) call performs. An op matches when its tool is the called tool and every constant arg it
// declares (not a {placeholder}) equals the call arg; the ops with the most constants win, ties are all returned
// (one bundled tool call can be several ops, e.g. fill is toggle and submit). The ops map is the only source, so a runner or hook can
// forbid logical ops for either driver.
//
// The result is never empty and never fails open: a call the ops map cannot place yields `unknown`. The adapter's optional `composite`
// block (a driver whose tools nest steps: batch, run, if/while, wait) makes the resolver return the union over every nested step, and `composite.js_guards`
// add the `js_op` (evaluate) to any call form that runs page JS without being the eval op (wait condition=js, if/while condition=js).
const UNKNOWN_OP = 'unknown';
const MAX_NESTING = 32;
const CHILD_KEYS = ['steps', 'then', 'else'];
const isPlaceholder = (v) => typeof v === "string" && /^\{[a-z_]+\}$/.test(v);
const nonEmptyString = (v) => typeof v === 'string' && v !== '';

function leafOps(contract, bare, input) {
  const scored = Object.entries(contract.ops)
    .filter(([, e]) => e.tool === bare)
    .map(([op, e]) => ({ op, constants: Object.entries(e.args ?? {}).filter(([, v]) => !isPlaceholder(v) && typeof v !== "object") }))
    .filter(({ constants }) => constants.every(([k, v]) => input[k] === v));
  const best = Math.max(0, ...scored.map((c) => c.constants.length));
  return scored.filter((c) => c.constants.length === best).map((c) => c.op);
}

const runsPageJs = (guards, bare, input) => (Array.isArray(guards) ? guards : []).some((g) => g.tool === bare
  && (g.actions === undefined || g.actions.includes(input.action))
  && ((g.condition_key !== undefined && input[g.condition_key] === 'js') || nonEmptyString(input[g.js_key])));

// A step inside batch/run as the (tool, args) call it stands for; null when it is not an object with a string action.
function stepCall(comp, step) {
  if (!isObject(step) || typeof step.action !== 'string') return null;
  const tool = comp.step_tools?.[step.action];
  if (tool !== undefined) return { bare: tool, input: step };
  if ((comp.state_actions ?? []).includes(step.action)) return { bare: comp.state_tool, input: { ...step, op: step.op ?? step.action } };
  return { bare: comp.step_tool, input: { ...step, action: comp.step_action_aliases?.[step.action] ?? step.action } };
}

function collectOps(contract, bare, input, depth, out) {
  const comp = isObject(contract.composite) ? contract.composite : undefined;
  const ops = leafOps(contract, bare, input);
  ops.forEach((op) => out.add(op));
  if (comp && runsPageJs(comp.js_guards, bare, input)) out.add(comp.js_op);
  const structural = comp && ((depth === 0 && (comp.container_tools ?? []).includes(bare))
    || (bare === comp.step_tool && (comp.structural_actions ?? []).includes(input.action)));
  if (!structural) {
    if (ops.length === 0) out.add(UNKNOWN_OP);
    return;
  }
  if (depth >= MAX_NESTING) { out.add(UNKNOWN_OP); return; }
  const present = CHILD_KEYS.filter((k) => input[k] !== undefined);
  if (present.length === 0 || present.some((k) => !Array.isArray(input[k]))) out.add(UNKNOWN_OP);
  for (const step of present.flatMap((k) => (Array.isArray(input[k]) ? input[k] : []))) {
    const call = stepCall(comp, step);
    if (call) collectOps(contract, call.bare, call.input, depth + 1, out);
    else out.add(UNKNOWN_OP);
  }
}

function opsOf(contract, tool, args) {
  if (contract.kind === "command") throw new Error(`ui_qa driver "${contract.driver}" is a command driver: it has no MCP ops`);
  if (args !== undefined && args !== null && !isObject(args)) return [UNKNOWN_OP];
  const prefix = contract.tool_prefix ?? "";
  const bare = prefix !== "" && String(tool).startsWith(prefix) ? String(tool).slice(prefix.length) : String(tool);
  const out = new Set();
  collectOps(contract, bare, args ?? {}, 0, out);
  return out.size === 0 ? [UNKNOWN_OP] : [...out].sort();
}

// Why a call to the configured driver is outside the role's op allowlist, or null. Every op the call resolves to (opsOf: nested
// batch/run steps and JS-running waits included) must be in the allowlist; `unknown` never is. One exception keeps the documented
// residual: an op of a tool with no action/op discriminator (a read-only `see`-style tool) passes when the role holds any op of that same tool.
function roleViolation(contract, role, tool, toolInput) {
  const allowed = contract.roles?.[role];
  if (!Array.isArray(allowed) || !tool.startsWith(contract.tool_prefix)) return null;
  const bare = tool.slice(contract.tool_prefix.length);
  const open = (op) => {
    const entry = contract.ops[op];
    return entry !== undefined && entry.args?.action === undefined && entry.args?.op === undefined
      && allowed.some((a) => contract.ops[a]?.tool === entry.tool);
  };
  const ops = opsOf(contract, tool, toolInput);
  const bad = ops.filter((op) => !allowed.includes(op) && !open(op));
  if (bad.length === 0) return null;
  const action = isObject(toolInput) ? toolInput.action : undefined;
  const what = action === undefined ? bare : `${bare} action=${action}`;
  return `role "${role}" may not call ${what} (ops outside the role: ${bad.join(', ')}; allowed ops: ${allowed.join(', ')})`;
}

// Per-instance environment: isolation.env with {instance} filled in. A driver whose isolation is launch_op has no env to set;
// its instances come from that op's tool.
const INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
function instanceEnv(contract, instance) {
  if (typeof instance !== "string" || !INSTANCE_RE.test(instance)) throw new Error("--instance must match [A-Za-z0-9][A-Za-z0-9_-]*");
  const iso = contract.isolation;
  if (!isObject(iso)) throw new Error(`ui_qa driver "${contract.driver}" declares no isolation`);
  const env = Object.fromEntries(Object.entries(iso.env ?? {}).map(([k, v]) => [k, String(v).replaceAll("{instance}", instance)]));
  const launch = iso.launch_op ? { op: iso.launch_op, tool: fullToolName(contract, iso.launch_op) } : undefined;
  return { driver: contract.driver, instance, env, ...(launch ? { launch } : {}) };
}

// The MCP-tier contract a CLI call addresses: --driver names an adapter, else the project at --root.
const cliContract = (args, root) => {
  const driver = flag(args, "--driver");
  const contract = driver === undefined ? resolveMcpTier(readUiQa(root)) : resolveContract({ driver });
  if (!contract) throw new Error("ui_qa declares no mcp tier");
  return contract;
};

// Fills the keys a project left out (agent, tool_prefix, lock_file, recording) from its adapter; never overwrites.
// The nested tier is filled the same way (an MCP tier is filled from its resolved form, so keys it inherits stay put).
// Returns the input untouched when the driver is unknown: validation reports that, sync does not guess.
function fillContract(uiQa) {
  if (!isObject(uiQa) || !listDrivers().includes(uiQa.driver)) return uiQa;
  const adapter = loadAdapter(uiQa.driver);
  const nestedKey = isCommand(adapter) ? 'mcp' : 'scripted';
  const nested = isObject(uiQa[nestedKey]) && listDrivers().includes(uiQa[nestedKey].driver) ? uiQa[nestedKey] : undefined;
  const { [nestedKey]: _nested, ...own } = uiQa;
  const filled = fillTier(own);
  if (!nested) return uiQa[nestedKey] === undefined ? filled : { ...filled, [nestedKey]: uiQa[nestedKey] };
  return { ...filled, [nestedKey]: fillTier(nestedKey === 'mcp' ? mcpTier(uiQa) : nested) };
}

function fillTier(tier) {
  const adapter = loadAdapter(tier.driver);
  if (isCommand(adapter)) return tier.agent === undefined ? { agent: adapter.agent ?? defaultAgent(), ...tier } : tier;
  const defaults = { agent: defaultAgent(), tool_prefix: adapter.tool_prefix, lock_file: adapter.lock_file, recording: adapter.recording, agent_aliases: (tier.agent ?? defaultAgent()) === defaultAgent() ? agentAliases() : [] };
  return { ...Object.fromEntries(Object.entries(defaults).filter(([k]) => tier[k] === undefined)), ...tier };
}

// The keys that belong to one adapter: a switch replaces them and keeps everything the project set (lock_file, reset_patterns, agent, ...).
// Between kinds the old top tier becomes the nested tier of the new shape (ui_qa.mcp / ui_qa.scripted); when the target is the
// driver already nested there, the two swap. A tier's own agent follows its own kind, never the other tier's.
const DRIVER_KEYS = ['driver', 'tool_prefix', 'ops', 'recording', 'command'];
const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
function switchDriver(current, driver, command) {
  const { mcp, scripted, ...own } = current;
  const oldKind = kindOf(current.driver);
  const nestedOld = oldKind === 'command' ? mcp : scripted;
  const cmd = command === undefined ? {} : { command };
  if (oldKind === kindOf(driver)) return fillContract({ ...without(current, DRIVER_KEYS), driver, ...cmd });
  const nested = isObject(nestedOld) ? nestedOld : undefined;
  const mcpOnly = MCP_INHERITED.filter((k) => k !== 'agent');
  const carried = oldKind === 'command' ? Object.fromEntries(mcpOnly.filter((k) => own[k] !== undefined).map((k) => [k, own[k]])) : {};
  const demoted = oldKind === 'command' ? without(own, mcpOnly) : own;
  const top = nested && nested.driver === driver ? { ...nested, ...cmd } : { ...without(nested ?? {}, DRIVER_KEYS), driver, ...cmd };
  return fillContract({ ...carried, ...top, [oldKind === 'command' ? 'scripted' : 'mcp']: demoted });
}

const newContract = (driver, command) => fillContract({ driver: driver ?? defaultDriver(), ...(command === undefined ? {} : { command }) });

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
      case "drivers": {
        const defaults = { agent: defaultAgent(), agent_aliases: agentAliases() };
        let project;
        try { const tier = resolveMcpTier(readUiQa(root)); if (tier) project = { driver: tier.driver, agent: tier.agent, agent_aliases: tier.agent_aliases }; } catch { /* no project ui_qa: adapter defaults only */ }
        return { result: { default: defaultDriver(), drivers: listDrivers(), kinds: Object.fromEntries(listDrivers().map((d) => [d, kindOf(d)])), defaults, ...(project ? { project } : {}) }, exitCode: 0 };
      }
      case "op-of": {
        const raw = flag(args, "--args");
        const tool = flag(args, "--tool");
        if (tool === undefined) return fail("op-of needs --tool <name> [--args <json>] [--driver name]");
        const contract = cliContract(args, root);
        let parsed;
        try { parsed = raw === undefined ? {} : JSON.parse(raw); } catch { parsed = null; }
        const ops = parsed === null ? [UNKNOWN_OP] : opsOf(contract, tool, parsed);
        const unknown = ops.includes(UNKNOWN_OP);
        return { result: { tool, ops, unknown }, exitCode: unknown ? 3 : 0 };
      }
      case "instance-env":
        return { result: instanceEnv(cliContract(args, root), flag(args, "--instance")), exitCode: 0 };
      case 'contract':
      {
        const contract = resolveContract(readUiQa(root));
        const tier = flag(args, '--tier');
        if (tier === undefined) return { result: contract, exitCode: 0 };
        const picked = tier === 'mcp' ? (contract.kind === 'mcp' ? contract : contract.mcp) : tier === 'scripted' ? (contract.kind === 'command' ? contract : contract.scripted) : undefined;
        if (!['mcp', 'scripted'].includes(tier)) return fail('--tier must be mcp or scripted');
        return picked ? { result: picked, exitCode: 0 } : fail(`ui_qa declares no ${tier} tier`);
      }
      case 'apply': {
        const file = path.join(root, '.planning', 'config.json');
        const config = readJson(file);
        const current = config?.stack?.capabilities?.ui_qa;
        const wanted = flag(args, '--driver');
        if (wanted !== undefined) loadAdapter(wanted);
        if (isObject(current)) loadAdapter(current.driver);
        const switching = isObject(current) && wanted !== undefined && wanted !== current.driver;
        const command = flag(args, '--command');
        const next = switching ? switchDriver(current, wanted, command) : isObject(current) ? fillContract(current) : newContract(wanted, command);
        if (isCommand(loadAdapter(next.driver)) && (typeof next.command !== 'string' || next.command === '')) throw new Error(`ui_qa driver "${next.driver}" is a command driver: pass --command "<cmd>"`);
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
        return fail('usage: ui-qa <drivers [--root dir] | op-of --tool name [--args json] [--driver name] | instance-env --instance id [--driver name] | contract [--tier mcp|scripted] [--root dir] | apply [--driver name] [--command cmd] [--root dir]>');
    }
  } catch (e) {
    return fail(e.message);
  }
}

module.exports = {
  runCli,
  roleOf, opsOf, UNKNOWN_OP, instanceEnv, knownPrefixes, kindOf, mcpTier, roleViolation,
  listDrivers, defaultDriver, defaultAgent, agentAliases, loadAdapter, resolveContract, resolveMcpTier, fullToolName, fillContract, newContract, readUiQa,
};
