/**
 * project-registry.js — agnostic-M-02 (G1)
 *
 * Slug and port registry for `project init`. Each project on a machine gets a
 * port_base in projects.json under GSD_HOME (default ~/.gsd). registerForInit
 * validates everything before the first write; initWithRegistration then runs
 * the engine (project-deploy.js, not edited here) and rolls the registration
 * back unless the engine wrote files.
 * Storage: project-registry-store.js. Lock: project-lock.js (its header states the residual, R4).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { loadProfile, getProfileValue, validateProfile } = require('./project-profile.js');
const {
  REGISTRY_FILE, isObject, refuse, isValidPort, registryDir, registryDirFor, safely, readRegistry, planUnderLock,
} = require('./project-registry-store.js');
const { withLock } = require('./project-lock.js');
const { DEPLOY_SLOTS } = require('./project-profile-keys.js');

const NEIGHBOUR_DISTANCE = 100;
const ENGINE_FLAGS = new Set(['--root', '--preset', '--preset-dir']);
const CANDIDATE_PORTS = Object.freeze(Array.from({ length: 100 }, (_, i) => 55000 + i * 100));
const CAPABILITIES_REASON = 'stack.capabilities is not set: declare it (interview step 5.6), e.g. {"backend":{},"web_ui":{}}';
const DELEGATE = Object.freeze({ delegate: true });
const MANUAL_EDIT_HINT = 'remove the entry from projects.json by hand to free it';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = (reason) => ({ ok: false, errors: [{ reason }] });
const without = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // The temp path is not a plain file, so there is nothing of ours to remove.
    }
    throw e;
  }
}

const writeJson = (file, value) => writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);

// Pure. Returns { ok, port_base, reused, data }; data is the registry to write when not reused.
function planAllocation(data, { slug, root, wanted }) {
  const entries = data.projects;
  if (hasOwn(entries, slug)) {
    const current = entries[slug];
    if (current.root !== root) return refuse(`slug already registered at ${current.root}`);
    if (wanted !== undefined && wanted !== current.port_base) {
      return refuse(`slug already registered with port_base ${current.port_base}`);
    }
    return { ok: true, port_base: current.port_base, reused: true, data };
  }
  const owner = Object.entries(entries).find(([, e]) => e.root === root);
  if (owner !== undefined) {
    return refuse(`root ${root} is already registered as slug "${owner[0]}", not "${slug}"; ${MANUAL_EDIT_HINT}`);
  }
  const near = (port) => Object.entries(entries).find(([, e]) => Math.abs(e.port_base - port) < NEIGHBOUR_DISTANCE);
  if (wanted !== undefined) {
    if (!isValidPort(wanted)) return refuse('port_base must be an integer from 1024 to 65535');
    const blocker = near(wanted);
    if (blocker !== undefined) return refuse(`port_base ${wanted} is within ${NEIGHBOUR_DISTANCE} of ${blocker[0]}`);
  }
  const port = wanted ?? CANDIDATE_PORTS.find((candidate) => near(candidate) === undefined);
  if (port === undefined) return refuse('no free port_base from 55000 to 64900');
  return {
    ok: true,
    port_base: port,
    reused: false,
    data: { ...data, projects: { ...entries, [slug]: { root, port_base: port } } },
  };
}

// The never-touch list is the source of the five slot_N values; an unused one holds an inert literal.
// Rewritten on every init, so a changed list cannot keep an old value.
function deploySlots(neverTouch) {
  return Object.fromEntries(Array.from({ length: DEPLOY_SLOTS }, (_, i) => [
    `slot_${i + 1}`,
    neverTouch[i] ?? `gsd-unused-deploy-entry-${i + 1}`,
  ]));
}

// Default gates appended to stack.gates by id when absent, in this order. assertion-quality needs the web_ui capability.
const DEFAULT_GATES = [
  { id: 'hook-canaries', run: 'scripts/validation/hook-canaries/run-canaries.sh' },
  { id: 'hook-patch-trailer', run: 'scripts/validation/hook-patch-trailer-check.sh' },
  { id: 'guard-canaries', run: 'node scripts/validation/canary-gate.mjs' },
  { id: 'guard-registry', run: 'node scripts/validation/guard-registry-reconcile.mjs' },
  { id: 'style', run: 'node scripts/style-gate.mjs' },
  { id: 'flake-patterns', run: 'node .claude/hooks/lib/flake-gate.mjs --all' },
  { id: 'dependency-scan', run: 'node scripts/dependency-scan-gate.mjs' },
  { id: 'adr', run: 'node scripts/validation/adr-reconcile.mjs' },
  { id: 'assertion-quality', run: 'node scripts/validation/check-assertion-quality.mjs', capability: 'web_ui' },
];
const DEFAULT_STYLE = { rule_set: 'generic', roots: ['.'] };
const SOURCE_EXT = { 'js-ts': ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'], python: ['.py'] };
const LANGUAGE_MARKERS = { 'js-ts': ['package.json', 'tsconfig.json'], python: ['pyproject.toml', 'requirements.txt', 'setup.py'] };
const DETECT_SKIP = new Set(['.git', '.planning', '.claude', '.tmp', 'node_modules', 'dist', 'build', 'scripts', '.venv', 'venv', '__pycache__']);
const DETECT_FILE_CAP = 5000;

// The style rule set for the language present in a project: js-ts or python by marker files and source counts (the deployed
// GSD scripts/ and .claude/ trees do not count), otherwise generic. A tie goes to js-ts.
function detectRuleSet(root) {
  const counts = { 'js-ts': 0, python: 0 };
  let seen = 0;
  const walk = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (seen++ > DETECT_FILE_CAP) return;
      if (e.isDirectory()) { if (depth < 4 && !DETECT_SKIP.has(e.name)) walk(path.join(dir, e.name), depth + 1); continue; }
      for (const [set, exts] of Object.entries(SOURCE_EXT)) if (exts.some((x) => e.name.endsWith(x))) counts[set] += 1;
      for (const [set, names] of Object.entries(LANGUAGE_MARKERS)) if (depth === 0 && names.includes(e.name)) counts[set] += 1;
    }
  };
  try { walk(root, 0); } catch { return 'generic'; }
  if (counts['js-ts'] === 0 && counts.python === 0) return 'generic';
  return counts.python > counts['js-ts'] ? 'python' : 'js-ts';
}

// An existing gate with the same id is never changed and none is removed; a non-array stack.gates is left for validation.
function withDefaultGates(gates, capabilities) {
  if (gates !== undefined && !Array.isArray(gates)) return gates;
  const current = gates ?? [];
  const wanted = DEFAULT_GATES
    .filter((g) => g.capability === undefined || isObject(capabilities?.[g.capability]))
    .filter((g) => !current.some((e) => isObject(e) && e.id === g.id))
    .map(({ id, run }) => ({ id, run }));
  return [...current, ...wanted];
}

// Adds slug, port_base and the base defaults where absent. Never creates stack.capabilities or adds ui_qa.
function applyToConfig(config, { slug, port_base: portBase, root }) {
  const fill = (node, defaults) => {
    if (node !== undefined && !isObject(node)) return node;
    const current = node ?? {};
    const missing = Object.fromEntries(Object.entries(defaults).filter(([k]) => current[k] === undefined));
    return { ...current, ...missing };
  };
  const { stack } = config;
  const neverTouch = Array.isArray(stack.deploy?.never_touch) ? stack.deploy.never_touch : [];
  const capabilities = fill(stack.capabilities, { backend: {}, web_ui: {} });
  return {
    ...config,
    project: fill(config.project, { owner_title: 'owner' }),
    stack: {
      ...stack,
      isolation: fill(stack.isolation, { port_base: portBase, container_suffix: slug }),
      branch: fill(stack.branch, { default: 'main' }),
      commands: fill(stack.commands, { search: 'git grep -n', pre_pr_gate: 'scripts/pre-pr-gate.sh' }),
      capabilities,
      style: stack.style === undefined ? { ...DEFAULT_STYLE, rule_set: root === undefined ? DEFAULT_STYLE.rule_set : detectRuleSet(root) } : stack.style,
      gates: withDefaultGates(stack.gates, capabilities),
      deploy: { ...(isObject(stack.deploy) ? stack.deploy : {}), ...deploySlots(neverTouch) },
    },
  };
}

// Mirrors the engine's parseArgs (project-deploy.js) so the wiring never writes for a call the engine rejects.
function parseInitRoot(rest) {
  if (rest.length % 2 !== 0) return null;
  let root = '.';
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (!ENGINE_FLAGS.has(flag) || value === undefined || value.startsWith('--')) return null;
    if (flag === '--root') root = value;
  }
  return root;
}

// Keys whose values the engine renders into hooks and settings. Checked on every engine command: the engine renders
// whatever the config holds, and `init` is the only command that validated it before.
const RENDERED_GUARD_KEYS = new Set(['project.owner_title', 'stack.branch.default', 'stack.commands.search', 'stack.commands.pre_pr_gate']);
const isRenderedGuardKey = (key) => RENDERED_GUARD_KEYS.has(key) || key === 'stack.deploy' || key.startsWith('stack.deploy.');
const SLOT_COMMANDS = new Set(['init', 'diff', 'sync']);

function renderedValueErrors(cwd, args) {
  if (!SLOT_COMMANDS.has(args[0])) return [];
  const rootArg = parseInitRoot(args.slice(1));
  if (rootArg === null) return [];
  const loaded = loadProfile(path.resolve(cwd, rootArg));
  if (loaded.error || !loaded.found) return [];
  return validateProfile(loaded).invalid
    .filter((i) => isRenderedGuardKey(i.key))
    .map((i) => ({ reason: `${i.key}: ${i.reason}` }));
}

// The slot_N values follow the never-touch list on every diff and sync, not only on init: the list can change after init.
function withRederivedSlots(config) {
  const deploy = config.stack.deploy;
  const neverTouch = Array.isArray(deploy?.never_touch) ? deploy.never_touch : [];
  if (!isObject(deploy) && neverTouch.length === 0) return config;
  const expected = deploySlots(neverTouch);
  if (Object.entries(expected).every(([k, v]) => deploy?.[k] === v)) return config;
  return { ...config, stack: { ...config.stack, deploy: { ...(isObject(deploy) ? deploy : {}), ...expected } } };
}

// Writes the re-derived slot_N values; returns the config bytes before the write, or null when nothing changed.
function syncSlots(root) {
  const file = path.join(root, '.planning', 'config.json');
  let before;
  let config;
  try {
    before = fs.readFileSync(file);
    config = JSON.parse(before.toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(config) || !isObject(config.stack)) return null;
  const next = withRederivedSlots(config);
  if (next === config) return null;
  writeJson(file, next);
  return before;
}

// Runs a diff or sync with the slot_N values re-derived first. The config bytes are restored when the engine refuses without writing.
function runEngineWithSlots(cwd, args, runEngine) {
  const root = args[0] === 'diff' || args[0] === 'sync' ? parseInitRoot(args.slice(1)) : null;
  const configFile = root === null ? null : path.join(path.resolve(cwd, root), '.planning', 'config.json');
  const before = root === null ? null : syncSlots(path.resolve(cwd, root));
  if (before === null) return runEngine();
  let engine;
  try {
    engine = runEngine();
  } catch (e) {
    writeAtomic(configFile, before);
    throw e;
  }
  if (engine.exitCode === 1 && (engine.result.written ?? []).length === 0) writeAtomic(configFile, before);
  return engine;
}

// Restores the config bytes and removes this run's registry entry. Keeps the registry file only if it existed before.
function undoRegistration({ dir, configFile, configBefore, slug, realRoot, portBase, reused, registryCreated }) {
  return safely(() => {
    writeAtomic(configFile, configBefore);
    if (reused) return { ok: true };
    const outcome = withLock(dir, () => {
      const read = readRegistry(dir);
      if (!read.ok) return read;
      const entry = read.data.projects[slug];
      if (!entry || entry.root !== realRoot || entry.port_base !== portBase) return { ok: true };
      const projects = without(read.data.projects, slug);
      if (registryCreated && Object.keys(projects).length === 0) {
        fs.rmSync(path.join(dir, REGISTRY_FILE), { force: true });
      } else {
        writeJson(path.join(dir, REGISTRY_FILE), { ...read.data, projects });
      }
      return { ok: true };
    });
    return outcome.ok ? { ok: true } : outcome;
  });
}

/**
 * Called before the `project` engine. Returns { delegate: true } when the engine runs unchanged;
 * { ok: false, errors } with config and registry untouched; or { ok: true, port_base, reused, undo } after
 * the config and registry were written. undo() restores the config bytes and removes the registry entry.
 */
function registerForInit(cwd, args, env) {
  if (args[0] !== 'init') return DELEGATE;
  const rootArg = parseInitRoot(args.slice(1));
  if (rootArg === null) return DELEGATE;
  const root = path.resolve(cwd, rootArg);
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) return DELEGATE;
  const loaded = loadProfile(root);
  if (loaded.error) return DELEGATE;
  const profile = validateProfile(loaded);
  const slug = getProfileValue(loaded, 'project.slug');
  if (typeof slug !== 'string' || profile.invalid.some((i) => i.key === 'project.slug')) return DELEGATE;
  if (profile.invalid.length > 0) {
    return { ok: false, errors: profile.invalid.map((i) => ({ reason: `${i.key}: ${i.reason}` })) };
  }
  const configFile = path.join(root, '.planning', 'config.json');
  const configBefore = fs.readFileSync(configFile);
  const config = JSON.parse(configBefore.toString('utf8'));
  if (!isObject(config.stack) || !isObject(config.stack.capabilities)) return fail(CAPABILITIES_REASON);
  const dirOf = registryDirFor(env);
  if (!dirOf.ok) return fail(dirOf.reason);
  const { dir } = dirOf;
  const registryFile = path.join(dir, REGISTRY_FILE);
  const realRoot = fs.realpathSync.native(root);
  const wanted = getProfileValue(loaded, 'stack.isolation.port_base');
  const outcome = safely(() => {
    fs.mkdirSync(dir, { recursive: true });
    return withLock(dir, () => {
      const plan = planUnderLock(dir, (data) => planAllocation(data, { slug, root: realRoot, wanted }));
      if (!plan.ok) return plan;
      const registryCreated = !fs.existsSync(registryFile);
      try {
        writeJson(configFile, applyToConfig(config, { slug, port_base: plan.port_base, root }));
        if (!plan.reused) writeJson(registryFile, plan.data);
      } catch (e) {
        try {
          writeAtomic(configFile, configBefore);
        } catch (restoreError) {
          throw new Error(`${e.message}; the config could not be restored: ${restoreError.message}`);
        }
        throw e;
      }
      return { ok: true, port_base: plan.port_base, reused: plan.reused, registryCreated };
    });
  });
  if (outcome.ok === false) return fail(outcome.reason);
  const undo = () => undoRegistration({
    dir, configFile, configBefore, slug, realRoot, portBase: outcome.port_base, reused: outcome.reused, registryCreated: outcome.registryCreated,
  });
  return { ok: true, port_base: outcome.port_base, reused: outcome.reused, registryFile, undo };
}

// Undoes the registration and reports the failure on the engine's result.
function rollBack(registration, engine) {
  const undone = registration.undo();
  if (undone.ok) return engine;
  const errors = [...(engine.result.errors ?? []), { reason: `registration not rolled back: ${undone.reason}` }];
  return { ...engine, result: { ...engine.result, errors } };
}

/**
 * Runs `project init` with the registration: the engine's result decides whether the config and registry
 * writes stand. runEngine returns { exitCode, result } as project-deploy.runCli does.
 */
function initWithRegistration(cwd, args, env, runEngine) {
  const errors = renderedValueErrors(cwd, args);
  if (errors.length > 0) return { exitCode: 1, result: { ok: false, errors } };
  const registration = registerForInit(cwd, args, env);
  if (registration.delegate === true) return runEngineWithSlots(cwd, args, runEngine);
  if (registration.ok === false) return { exitCode: 1, result: { ok: false, errors: registration.errors } };
  let engine;
  try {
    engine = runEngine();
  } catch (e) {
    return rollBack(registration, { exitCode: 1, result: { ok: false, errors: [{ reason: `engine error: ${e.message}` }] } });
  }
  // Keep the registration when the engine wrote files and exited 0/2 (partial conflict), or left a partial
  // write (rolled_back false): the files it wrote are on disk, so the config and registry entry must stay with them.
  const wrote = (engine.result.written ?? []).length > 0;
  const kept = wrote && (engine.exitCode === 0 || engine.exitCode === 2 || engine.result.rolled_back === false);
  if (!kept) return rollBack(registration, engine);
  const registry = { path: registration.registryFile, written: !registration.reused };
  return { ...engine, result: { ...engine.result, registry } };
}

// allocate: locked read, plan, write. For callers that need only the port.
function allocate({ dir, slug, root, wanted }) {
  return safely(() => {
    fs.mkdirSync(dir, { recursive: true });
    return withLock(dir, () => {
      const plan = planUnderLock(dir, (data) => planAllocation(data, { slug, root, wanted }));
      if (!plan.ok) return plan;
      if (!plan.reused) writeJson(path.join(dir, REGISTRY_FILE), plan.data);
      return { ok: true, port_base: plan.port_base, reused: plan.reused };
    });
  });
}

// Removes a slug from the registry (for a manual re-registration). Refused when the slug is not registered.
function unregister({ dir, slug }) {
  return safely(() => withLock(dir, () => {
    const plan = planUnderLock(dir, (data) => (hasOwn(data.projects, slug)
      ? { ok: true, data: { ...data, projects: without(data.projects, slug) } }
      : refuse(`slug "${slug}" is not registered`)));
    if (!plan.ok) return plan;
    writeJson(path.join(dir, REGISTRY_FILE), plan.data);
    return { ok: true, removed: slug };
  }));
}

module.exports = {
  registryDir, readRegistry, planAllocation, allocate, unregister, applyToConfig, detectRuleSet, registerForInit, initWithRegistration,
  planUnderLock,
};
