'use strict';

// `project upgrade`: brings every project in the registry up to the installed framework, in one process and with one
// confirmation. Everything that can refuse runs before the first write; a project then gets its config migrated, its
// preset files synced (the engine merges settings.json hooks), superseded hooks removed from settings.local.json and
// one commit that holds only the paths the upgrade touched. A second run changes nothing.

const fs = require('fs');
const path = require('path');
const { planDeploy, runCli: runDeploy, CONFIG, MANIFEST, BASE_DIR, SETTINGS } = require('./project-deploy.js');
const { confirmationText, readTtyLine } = require('./project-deploy-confirm.js');
const { refusalOf } = require('./project-deploy-guard.js');
const { detectSession } = require('./project-deploy-session.js');
const { withSyncDefaults } = require('./project-registry.js');
const { registryDirFor, readRegistry, REGISTRY_FILE } = require('./project-registry-store.js');
const { migrateConfig } = require('./profile-migrations.js');
const { liveReasons } = require('./project-quiesce.js');
const { dirtyLines, commitPaths } = require('./project-upgrade-git.js');
const { appendRun } = require('./project-upgrade-log.js');

const COMMIT_MESSAGE = 'chore(gsd): upgrade framework files';
const LOCAL_SETTINGS = '.claude/settings.local.json';
const WRITE_ACTIONS = new Set(['create', 'overwrite', 'merge', 'update', 'delete']);
// Script basenames whose hook entries settings.local.json loses because a framework hook replaces them.
const SUPERSEDED_HOOKS = Object.freeze([]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const asText = (value) => `${JSON.stringify(value, null, 2)}\n`;

function readJsonFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return e.code === 'ENOENT' ? { ok: true, absent: true } : { ok: false, reason: e.code ?? e.message };
  }
  try {
    const value = JSON.parse(text);
    return isObject(value) ? { ok: true, value, text } : { ok: false, reason: 'not a JSON object' };
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const mentions = (command, table) => typeof command === 'string' && table.some((script) => command.includes(script));

// Pure. Drops the hook entries of the table; an emptied group and an emptied event go too; everything else is kept in order.
function removeSuperseded(settings, table = SUPERSEDED_HOOKS) {
  if (table.length === 0 || !isObject(settings.hooks)) return settings;
  const hooks = Object.fromEntries(Object.entries(settings.hooks).flatMap(([event, groups]) => {
    if (!Array.isArray(groups)) return [[event, groups]];
    const kept = groups.flatMap((g) => {
      if (!isObject(g) || !Array.isArray(g.hooks)) return [g];
      const inner = g.hooks.filter((h) => !(isObject(h) && mentions(h.command, table)));
      return inner.length === g.hooks.length ? [g] : inner.length === 0 ? [] : [{ ...g, hooks: inner }];
    });
    return kept.length === 0 && kept.length !== groups.length ? [] : [[event, kept]];
  }));
  return { ...settings, hooks };
}

const problem = (name, reason) => `${name}: ${reason}`;

// One project's read-only plan, or its problems.
function planProject({ name, root }, ctx) {
  const config = readJsonFile(path.join(root, CONFIG));
  if (!config.ok || config.absent) return { problems: [problem(name, `${CONFIG} ${config.absent ? 'is missing' : config.reason}`)] };
  const settings = readJsonFile(path.join(root, SETTINGS));
  const local = readJsonFile(path.join(root, LOCAL_SETTINGS));
  const unreadable = [[SETTINGS, settings], [LOCAL_SETTINGS, local]].filter(([, r]) => !r.ok)
    .map(([file, r]) => problem(name, `${file} ${r.reason}`));
  if (unreadable.length > 0) return { problems: unreadable };
  const nextConfig = withSyncDefaults(migrateConfig(config.value));
  const plan = planDeploy({ root, command: 'sync', config: nextConfig, env: ctx.env, session: ctx.session, presetsRoot: ctx.presetsRoot });
  const { report } = plan;
  if (!report.ok) {
    const why = report.refused ? report.refused.reason : report.errors.map((e) => (e.file ? `${e.file}: ${e.reason}` : e.reason)).join('; ');
    return { problems: [problem(name, `sync refused: ${why}`)] };
  }
  if (report.conflicts > 0) return { problems: [problem(name, `${report.conflicts} file(s) conflict with local edits; resolve them first`)] };
  const nextLocal = local.absent ? null : removeSuperseded(local.value);
  const configChanged = !sameJson(config.value, nextConfig);
  const localChanged = nextLocal !== null && !sameJson(local.value, nextLocal);
  const engineRuns = report.changes > 0;
  const paths = [
    ...(configChanged ? [CONFIG] : []),
    ...(localChanged ? [LOCAL_SETTINGS] : []),
    ...(engineRuns ? [MANIFEST, BASE_DIR, ...report.files.filter((f) => WRITE_ACTIONS.has(f.action)).map((f) => f.path)] : []),
    ...(plan.ops.settingsText === null ? [] : [SETTINGS]),
  ];
  const dirty = dirtyLines(root, paths);
  if (dirty.length > 0) return { problems: [problem(name, `uncommitted changes in files the upgrade writes: ${dirty.join(', ')}`)] };
  return { problems: [], plan, paths, engineRuns, configText: configChanged ? asText(nextConfig) : null, localText: localChanged ? asText(nextLocal) : null };
}

function applyProject({ name, root }, planned, ctx) {
  const configFile = path.join(root, CONFIG);
  const before = fs.readFileSync(configFile);
  const restore = () => writeAtomic(configFile, before);
  try {
    if (planned.configText !== null) writeAtomic(configFile, planned.configText);
    const engine = planned.engineRuns
      ? runDeploy(root, ['sync', '--root', root], ctx.env, ctx.session, { confirm: () => 'APPLY', presetsRoot: ctx.presetsRoot })
      : { exitCode: 0 };
    if (engine.exitCode !== 0) {
      restore();
      return { error: problem(name, `sync failed (exit ${engine.exitCode}); nothing committed`) };
    }
    if (planned.localText !== null) writeAtomic(path.join(root, LOCAL_SETTINGS), planned.localText);
  } catch (e) {
    restore();
    return { error: problem(name, `write failed: ${e.message}`) };
  }
  const commit = commitPaths(root, planned.paths, COMMIT_MESSAGE);
  return commit.error === undefined ? { commit } : { error: problem(name, commit.error) };
}

const refusal = (lines) => ({ exitCode: 1, lines, commits: [] });

function readProjects(env) {
  const dirOf = registryDirFor(env);
  if (!dirOf.ok) return { error: dirOf.reason };
  const read = readRegistry(dirOf.dir);
  if (!read.ok) return { error: read.reason };
  const projects = Object.entries(read.data.projects).map(([name, e]) => ({ name, root: e.root })).sort((a, b) => (a.name < b.name ? -1 : 1));
  return { dir: dirOf.dir, projects };
}

// The reason an agent or a non-terminal session may not upgrade, or null.
function guardRefusal(env, session, dir) {
  const refused = refusalOf({ command: 'upgrade', guarded: [path.join(dir, REGISTRY_FILE)], env, session: session ?? detectSession() });
  return refused ? `refused: ${refused.reason} (${refused.failed.join(', ')})` : null;
}

// Names the registered projects with a live phase; read-only, so the installer can call it before it copies anything.
function liveProjects(env, opts = {}) {
  const read = readProjects(env);
  if (read.error) return { error: read.error };
  return {
    live: read.projects
      .map((p) => ({ name: p.name, reasons: liveReasons(p.root, opts) }))
      .filter((p) => p.reasons.length > 0),
  };
}

function upgradeAll(opts = {}) {
  const env = opts.env ?? process.env;
  const session = opts.session ?? detectSession();
  const ask = opts.confirm ?? readTtyLine;
  const doctor = opts.doctor;
  const ctx = { env, session, presetsRoot: opts.presetsRoot };
  const read = readProjects(env);
  if (read.error) return refusal([`refused: ${read.error}`]);
  const refused = guardRefusal(env, session, read.dir);
  if (refused) return refusal([refused]);
  const live = read.projects.map((p) => ({ name: p.name, reasons: liveReasons(p.root, opts) })).filter((p) => p.reasons.length > 0);
  if (live.length > 0) return refusal(['refused: a phase is live; rerun when it is done', ...live.map((p) => `  ${p.name}: ${p.reasons.join('; ')}`)]);
  const planned = read.projects.map((p) => ({ project: p, ...planProject(p, ctx) }));
  const problems = planned.flatMap((p) => p.problems);
  if (problems.length > 0) return refusal(['refused before any write:', ...problems.map((p) => `  ${p}`)]);
  const guarded = planned.filter((p) => p.plan.report.guarded_changes.length > 0);
  if (guarded.length > 0) {
    const text = guarded.map((p) => `project ${p.project.name} (${p.project.root})\n${confirmationText({ report: p.plan.report, presetPath: p.plan.presetPath, shown: p.plan.shown })}`).join('\n\n');
    if (ask(text) !== 'APPLY') return refusal(['refused: confirmation declined; nothing written']);
  }
  const results = planned.map((p) => ({ project: p.project, ...applyProject(p.project, p, ctx) }));
  const commits = results.filter((r) => r.commit?.committed).map((r) => ({ name: r.project.name, root: r.project.root, sha: r.commit.sha }));
  if (commits.length > 0) appendRun(read.dir, { at: new Date().toISOString(), commits });
  const checks = doctor === undefined ? [] : read.projects.map((p) => ({ project: p, ...doctor(p.root) }));
  const lines = [
    ...results.map((r) => (r.error ? `FAILED ${r.error}` : `${r.project.name}: ${r.commit.committed ? `committed ${r.commit.sha}` : r.commit.note}`)),
    ...checks.flatMap((c) => [`profile doctor ${c.project.name}:`, ...(c.text ?? '').split('\n').filter(Boolean).map((l) => `  ${l}`)]),
  ];
  const ok = results.every((r) => !r.error) && checks.every((c) => c.exitCode === 0);
  return { exitCode: ok ? 0 : 1, lines, commits };
}

// Zero flags: any argument is a usage error. Registry iteration happens here, so the one confirmation covers every project.
function runCli(args, opts = {}) {
  if (args.length > 0) return refusal(['Usage: project upgrade (takes no arguments; it upgrades every project in ~/.gsd/projects.json)']);
  return upgradeAll(opts);
}

module.exports = { upgradeAll, liveProjects, guardRefusal, removeSuperseded, runCli, SUPERSEDED_HOOKS, COMMIT_MESSAGE };
