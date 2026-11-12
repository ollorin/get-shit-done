'use strict';

const fs = require('fs');
const path = require('path');
const { renderPreset, loadPreset } = require('./project-deploy-render.js');
const { resolvePaths } = require('./project-deploy-canon.js');
const { hookCommandsOf, triplesCommands, guardedSet, refusalOf } = require('./project-deploy-guard.js');
const { sha256, planWholeFile, planBlockFile } = require('./project-deploy-files.js');
const { scanText } = require('./project-deploy-scan.js');
const { settingsReport } = require('./project-deploy-redact.js');
const { shownFiles, confirmed } = require('./project-deploy-confirm.js');
const { mergeSettings, serializeSettings } = require('./project-deploy-settings.js');
const { applyPlan, applyFailure } = require('./project-deploy-apply.js');
const { isPlainObject, exists, contained, isDirectory, readRegular, readJsonObject } = require('./project-deploy-fs.js');
const { manifestShapeError } = require('./project-deploy-manifest.js');

const CONFIG = '.planning/config.json';
const MANIFEST = '.planning/gsd-project-manifest.json';
const BASE_DIR = '.planning/.gsd-preset-base';
const SETTINGS = '.claude/settings.json';
const GITIGNORE = '.gitignore';
const WRITE_ACTIONS = new Set(['create', 'overwrite', 'merge', 'update']);
// An adopt is a change: it records the file in the manifest, though it writes no content.
const CHANGE_ACTIONS = new Set([...WRITE_ACTIONS, 'adopt']);
const PRESET_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_PRESETS = path.join(__dirname, '..', 'presets');
const EMPTY_OPS = Object.freeze({ files: [], bases: [], settingsText: null, manifest: null });

const newReport = (command) => ({
  command,
  ok: false,
  preset: null,
  errors: [],
  secret_hits: [],
  refused: null,
  files: [],
  settings: null,
  guarded_changes: [],
  changes: 0,
  conflicts: 0,
});

const stop = (command, reason, file) => ({
  report: { ...newReport(command), errors: [file === undefined ? { reason } : { file, reason }] },
  ops: EMPTY_OPS,
});

const sortKeys = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

function planFile(root, f, prev) {
  const cur = readRegular(path.join(root, f.dest));
  if (cur.error) return { dest: f.dest, error: { file: f.dest, reason: cur.error } };
  let plan;
  if (f.kind === 'whole') {
    const base = readRegular(path.join(root, BASE_DIR, f.dest));
    if (base.error) return { dest: f.dest, error: { file: f.dest, reason: base.error } };
    plan = planWholeFile({
      current: cur.bytes,
      base: base.bytes,
      manifestHash: prev && prev.kind === 'whole' ? prev.sha256 : null,
      next: f.content,
    });
  } else {
    plan = planBlockFile({
      current: cur.bytes === null ? null : cur.bytes.toString('utf8'),
      next: f.content.toString('utf8'),
      prevBlocks: prev && prev.blocks ? prev.blocks : null,
    });
  }
  if (plan.action === 'error') return { dest: f.dest, error: { file: f.dest, reason: plan.reason } };
  // An unmanaged file already byte-equal to the rendered output (a crashed init, say) is adopted, not conflicting.
  // Adopt writes no content: a different mode is an update, so apply sets the rendered mode.
  const byteEqual = prev === undefined && cur.bytes !== null && cur.bytes.equals(f.content);
  const modeDiffers = byteEqual && (fs.statSync(path.join(root, f.dest)).mode & 0o777) !== f.mode;
  const action = byteEqual ? (modeDiffers ? 'update' : 'adopt') : plan.action;
  const content = byteEqual ? f.content : plan.content;
  const entry = { kind: f.kind, sha256: sha256(f.content), ...(plan.blocks ? { blocks: plan.blocks } : {}) };
  const conflict = action === 'conflict';
  return {
    dest: f.dest,
    report: {
      path: f.dest,
      kind: f.kind,
      action,
      ...(conflict ? { reason: plan.reason } : {}),
      ...(plan.warnings && plan.warnings.length > 0 ? { warnings: plan.warnings } : {}),
    },
    write: WRITE_ACTIONS.has(action) ? { dest: f.dest, content: Buffer.from(content), mode: f.mode } : null,
    base: conflict ? null : { dest: f.dest, content: f.content },
    manifestEntry: conflict ? prev : entry,
    old: cur.bytes,
  };
}

function planFiles(root, rendered, prevFiles) {
  const results = rendered.files.map((f) => planFile(root, f, prevFiles.get(f.dest)));
  const dests = new Set(rendered.files.map((f) => f.dest));
  const orphans = [...prevFiles].filter(([dest]) => !dests.has(dest));
  const manifestFiles = Object.fromEntries(
    [...results.filter((r) => r.manifestEntry !== undefined && r.manifestEntry !== null).map((r) => [r.dest, r.manifestEntry]),
      ...orphans],
  );
  return {
    errors: results.filter((r) => r.error).map((r) => r.error),
    files: [
      ...results.filter((r) => r.report).map((r) => r.report),
      ...orphans.map(([dest, e]) => ({ path: dest, kind: e.kind, action: 'orphan' })),
    ],
    writes: results.filter((r) => r.write).map((r) => r.write),
    bases: results.filter((r) => r.base).map((r) => r.base),
    olds: new Map(results.map((r) => [r.dest, r.old ?? null])),
    manifestFiles: sortKeys(manifestFiles),
  };
}

function planSettings(root, rendered, prevSettings) {
  const cur = readRegular(path.join(root, SETTINGS));
  if (cur.error) return { error: { file: SETTINGS, reason: cur.error } };
  let current = null;
  if (cur.bytes !== null) {
    try {
      current = JSON.parse(cur.bytes.toString('utf8'));
    } catch {
      current = undefined;
    }
    if (current === undefined || current === null) return { error: { file: SETTINGS, reason: 'not valid JSON' } };
  }
  const m = mergeSettings(current, prevSettings, rendered.settings);
  if (!m.ok) return { error: { file: SETTINGS, reason: m.reason } };
  const action = !m.changed ? 'unchanged' : current === null ? 'create' : 'update';
  return {
    action,
    added: m.added,
    removed: m.removed,
    text: action === 'unchanged' ? null : serializeSettings(m.settings),
    deployed: m.deployed,
    old: cur.bytes,
  };
}

const NOT_INITIALISED_NOTE = 'not initialised: .planning/config.json is absent; preview lists the preset files that do not depend on stack capabilities, all as would-create. Run /gsd:init-project to write the config.';

// Preview before the interview has written config.json: nothing is rendered (placeholders need config), so every
// capability-free preset file is reported as a create and nothing is written. Only `diff` previews.
function previewUninitialised(root, dir, command) {
  const loaded = loadPreset(dir);
  if (!loaded.ok) return { report: { ...newReport(command), errors: loaded.errors.map((reason) => ({ file: 'preset.json', reason })) }, ops: EMPTY_OPS };
  const { preset } = loaded;
  const files = preset.files
    .filter((f) => f.capability === null)
    .map((f) => ({ path: f.dest, kind: f.kind, action: exists(path.join(root, f.dest)) ? 'exists' : 'create' }));
  return {
    report: {
      ...newReport(command),
      ok: true,
      not_initialised: true,
      note: NOT_INITIALISED_NOTE,
      preset: { name: preset.name, version: preset.version },
      files,
    },
    ops: EMPTY_OPS,
  };
}

function planDeploy(opts) {
  const { root, command, presetDir, presetName, presetsRoot = DEFAULT_PRESETS } = opts;
  const env = opts.env === undefined ? process.env : opts.env;

  if (!isDirectory(root)) return stop(command, 'root is not a directory');
  const config = exists(path.join(root, CONFIG)) ? readJsonObject(path.join(root, CONFIG)) : undefined;
  if (config === undefined && command !== 'diff') return stop(command, 'missing .planning/config.json');
  if (config === null) return stop(command, '.planning/config.json is not valid JSON');

  let dir = presetDir;
  if (dir === undefined) {
    const name = presetName ?? (isPlainObject(config?.stack) ? config.stack.preset : undefined);
    if (name === undefined) return stop(command, 'no preset: pass --preset or set stack.preset');
    if (typeof name !== 'string' || !PRESET_NAME_RE.test(name)) return stop(command, 'invalid preset name');
    dir = path.join(presetsRoot, name);
  }

  if (config === undefined) return previewUninitialised(root, dir, command);
  const rendered = renderPreset(dir, config);
  if (!rendered.ok) return { report: { ...newReport(command), errors: rendered.errors }, ops: EMPTY_OPS };
  const report = { ...newReport(command), preset: { name: rendered.name, version: rendered.version } };

  if (!contained(root, MANIFEST)) return stop(command, 'destination escapes project root', MANIFEST);
  const manifest = exists(path.join(root, MANIFEST)) ? readJsonObject(path.join(root, MANIFEST)) : null;
  if (exists(path.join(root, MANIFEST)) && manifest === null) return stop(command, 'manifest is not valid JSON');
  if (manifest && manifestShapeError(manifest)) return stop(command, 'manifest is malformed');
  if (command === 'init' && manifest) return stop(command, 'already initialised: run project sync');
  if (command === 'sync' && !manifest) return stop(command, 'not initialised: run project init');
  if (manifest && manifest.preset?.name !== rendered.name) {
    return stop(command, `manifest preset is ${manifest.preset?.name}, not ${rendered.name}`);
  }
  const prevFiles = new Map(Object.entries(manifest && isPlainObject(manifest.files) ? manifest.files : {}));
  const prevSettings = manifest && manifest.settings ? manifest.settings : null;

  const secretHits = [
    ...rendered.files.flatMap((f) => scanText(f.content).map((h) => ({ file: f.dest, ...h }))),
    ...(rendered.settings === null ? [] : scanText(JSON.stringify(rendered.settings, null, 2))
      .map((h) => ({ file: 'settings fragment', ...h }))),
  ];
  report.secret_hits = secretHits;
  const errors = secretHits.length > 0 ? [{ reason: 'secret-shaped string in rendered output' }] : [];

  const needSettings = rendered.settings !== null || prevSettings !== null;
  const escapes = [
    ...rendered.files.flatMap((f) => [f.dest, `${BASE_DIR}/${f.dest}`]),
    ...(needSettings ? [SETTINGS] : []),
    ...(command === 'init' ? [GITIGNORE] : []),
  ].filter((rel) => !contained(root, rel)).map((file) => ({ file, reason: 'destination escapes project root' }));
  if (escapes.length > 0) return { report: { ...report, errors: [...errors, ...escapes] }, ops: EMPTY_OPS };

  const resolved = resolvePaths(root, {
    dests: rendered.files.map((f) => f.dest),
    bases: rendered.files.map((f) => `${BASE_DIR}/${f.dest}`),
    extra: [...(needSettings ? [SETTINGS] : []), ...(command === 'init' ? [GITIGNORE] : [])],
  });
  if (resolved.errors.length > 0) return { report: { ...report, errors: [...errors, ...resolved.errors] }, ops: EMPTY_OPS };

  const planned = planFiles(root, rendered, prevFiles);
  errors.push(...planned.errors);
  const settingsPlan = needSettings ? planSettings(root, rendered, prevSettings) : null;
  if (settingsPlan && settingsPlan.error) errors.push(settingsPlan.error);

  const settingsWrites = settingsPlan && !settingsPlan.error && (settingsPlan.action === 'create' || settingsPlan.action === 'update');
  const guardedFiles = guardedSet({
    canonDests: resolved.canons.map((c) => ({ ...c, h1: resolved.guarded.has(c.file) })),
    hookCommands: [
      ...hookCommandsOf(readJsonObject(path.join(root, SETTINGS))),
      ...hookCommandsOf(rendered.settings),
      ...triplesCommands(prevSettings && prevSettings.hooks),
    ],
    presetFlags: new Set(rendered.files.filter((f) => f.guarded).map((f) => f.dest)),
  });
  const guarded = [
    ...planned.files.filter((f) => WRITE_ACTIONS.has(f.action) && guardedFiles.has(f.path)).map((f) => f.path),
    ...(settingsWrites ? [SETTINGS] : []),
  ].sort();
  Object.assign(report, {
    preset: { name: rendered.name, version: rendered.version },
    files: planned.files,
    settings: settingsPlan && !settingsPlan.error ? settingsReport(settingsPlan, secretHits.length > 0) : null,
    guarded_changes: guarded,
    changes: planned.files.filter((f) => CHANGE_ACTIONS.has(f.action)).length + (settingsWrites ? 1 : 0),
    conflicts: planned.files.filter((f) => f.action === 'conflict').length,
    errors,
  });
  if (errors.length > 0) return { report: { ...report, ok: false }, ops: EMPTY_OPS };

  const createOnly = planned.files.filter((f) => guarded.includes(f.path)).every((f) => f.action === 'create');
  const exempt = command === 'init' && !exists(path.join(root, SETTINGS)) && createOnly;
  const refused = refusalOf({ command, guarded, env, session: opts.session, presetFlag: opts.presetFlag === true, exempt });
  if (refused) return { report: { ...report, ok: false, refused }, ops: EMPTY_OPS };

  const manifestOut = {
    manifest_version: 1,
    preset: { name: rendered.name, version: rendered.version },
    files: planned.manifestFiles,
    ...(needSettings ? { settings: settingsPlan.deployed } : {}),
  };
  return {
    report: { ...report, ok: true },
    ops: {
      files: planned.writes,
      bases: planned.bases,
      settingsText: settingsWrites ? settingsPlan.text : null,
      manifest: manifestOut,
    },
    exempt,
    presetPath: fs.realpathSync.native(dir),
    shown: shownFiles({
      writes: planned.writes,
      files: planned.files,
      olds: planned.olds,
      guarded,
      settingsPlan: settingsWrites ? settingsPlan : null,
      settingsPath: SETTINGS,
    }),
  };
}

const USAGE = 'Usage: project <init|diff|sync> [--root <dir>] [--preset <name>] [--preset-dir <dir>]';
const COMMANDS = new Set(['init', 'diff', 'sync']);
const FLAGS = new Set(['--root', '--preset', '--preset-dir']);

function parseArgs(args) {
  const [command, ...rest] = args;
  if (!COMMANDS.has(command) || rest.length % 2 !== 0) return null;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (!FLAGS.has(flag) || value === undefined || value.startsWith('--')) return null;
    opts[flag.slice(2)] = value;
  }
  return { command, opts };
}

function runCli(cwd, args, env, session, io = {}) {
  const parsed = parseArgs(args);
  if (parsed === null) return { exitCode: 1, result: { ok: false, errors: [{ reason: USAGE }] } };
  const { command, opts } = parsed;
  const root = path.resolve(cwd, opts.root ?? '.');
  const presetDir = opts['preset-dir'] === undefined ? undefined : path.resolve(cwd, opts['preset-dir']);
  const plan = planDeploy({ root, command, presetDir, presetName: opts.preset, env, session, presetFlag: presetDir !== undefined });
  const { report } = plan;
  if (!report.ok) return { exitCode: 1, result: { ...report, written: [] } };
  if (command === 'diff') {
    if (report.not_initialised) return { exitCode: 0, result: { ...report, written: [] } };
    return { exitCode: report.changes > 0 || report.conflicts > 0 ? 2 : 0, result: { ...report, written: [] } };
  }
  if (!confirmed(plan, io.confirm)) {
    return {
      exitCode: 1,
      result: { ...report, ok: false, refused: { reason: 'confirmation declined', paths: report.guarded_changes }, written: [] },
    };
  }
  const applied = applyPlan(root, plan, command);
  if (!applied.ok) return { exitCode: 1, result: applyFailure(report, applied) };
  return { exitCode: report.conflicts > 0 ? 2 : 0, result: { ...report, written: applied.written } };
}

module.exports = { planDeploy, runCli, CONFIG, MANIFEST, BASE_DIR, SETTINGS };
