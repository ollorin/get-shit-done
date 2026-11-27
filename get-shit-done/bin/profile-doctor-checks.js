'use strict';

// The project-level checks of `profile doctor` beyond the stack.* defaults table: preset file drift, registered hooks,
// the deployed framework, config migrations. Everything here only reads; a finding is a value, never a throw.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { planDeploy, MANIFEST } = require('./project-deploy.js');
const { loadPreset } = require('./project-deploy-render.js');
const { parseBlocks } = require('./project-deploy-files.js');
const { parseJsonc } = require('./jsonc.js');

// Flipped to true by the mutation tool work (WP9) once the tool refuses stack.mutation.error_pattern.
const MUTATION_REFUSES_ERROR_PATTERN = false;

const PRESETS_ROOT = path.join(__dirname, '..', 'presets');
const PRESET_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_FRAMEWORK_LINES = 10;
const BLOCKING_KINDS = new Set(['MISSING', 'DRIFT']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finding = (kind, key, expected, severity, why) => Object.freeze({ kind, key, expected, severity, why });
const isBlockingFinding = (f) => BLOCKING_KINDS.has(f.kind) && f.severity === 'error';
const findingLine = (f) => `${f.kind} ${f.key} -> ${f.expected} (${f.severity}: ${f.why})`;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readBytes(abs) {
  try {
    return fs.readFileSync(abs);
  } catch (e) {
    return e.code === 'ENOENT' ? null : undefined;
  }
}


// 1. File drift: the project's managed files against the preset copy, from the read-only `project diff` plan.
const driftRow = (expected, why) => (p) => finding('DRIFT', p.path, expected, 'error', p.reason ?? why);
const FILE_ACTION = Object.freeze({
  create: (p) => finding('MISSING', p.path, 'create from the preset', 'error', 'the file is absent'),
  overwrite: driftRow('the preset copy', 'the preset changed since the last deploy'),
  update: driftRow('the preset copy', 'the preset changed since the last deploy'),
  merge: driftRow('the preset change merged into the local edit', 'the preset changed and the file has local edits'),
  conflict: driftRow('resolve the conflict', 'the local edit overlaps a preset change'),
  delete: driftRow('remove the file', 'the preset dropped it'),
  adopt: (p) => finding('INFO', p.path, 'record it in the manifest', 'info', 'byte-equal to the preset copy, not yet recorded'),
  orphan: (p) => finding('INFO', p.path, 'kept', 'info', p.reason ?? 'no longer in the preset'),
});
const unknownAction = (p) => finding('DRIFT', p.path, 'a known action', 'error', `unknown plan action ${p.action}`);

// A file the plan calls unchanged but whose bytes differ from the preset copy as last deployed is a local edit kept by the merge.
function localEdit(root, entry, manifestFile) {
  const bytes = readBytes(path.join(root, entry.path));
  if (!bytes || !isObject(manifestFile)) return [];
  if (manifestFile.kind === 'whole') return sha256(bytes) === manifestFile.sha256 ? [] : [entry.path];
  const parsed = parseBlocks(bytes.toString('utf8'));
  const blocks = isObject(manifestFile.blocks) ? manifestFile.blocks : {};
  const differs = parsed.ok && parsed.blocks.some((b) => blocks[b.id] !== undefined && blocks[b.id] !== sha256(Buffer.from(b.inner, 'utf8')));
  return differs ? [entry.path] : [];
}

const localFinding = (p) => finding('LOCAL', p, 'the preset copy', 'info', 'edited in the project; the merge keeps it');

function fileFindings(root, stack, presetsRoot = PRESETS_ROOT) {
  if (typeof stack.preset !== 'string') return [];
  const manifestBytes = readBytes(path.join(root, MANIFEST));
  if (manifestBytes === null) return [finding('INFO', MANIFEST, 'run project init', 'info', 'the project is not under the deploy engine; file drift is not checked')];
  const manifest = manifestBytes === undefined ? undefined : parseJsonc(manifestBytes.toString('utf8'));
  if (!manifest || !manifest.ok || !isObject(manifest.value)) return [finding('DRIFT', MANIFEST, 'valid JSON', 'error', 'the manifest cannot be read')];
  const files = isObject(manifest.value.files) ? manifest.value.files : {};
  let report;
  try {
    report = planDeploy({ root, command: 'diff', env: {}, presetsRoot }).report;
  } catch {
    return [finding('DRIFT', 'project diff', 'a plan', 'error', 'the deploy plan failed')];
  }
  const planned = report.files.flatMap((p) => (p.action === 'unchanged'
    ? localEdit(root, p, files[p.path]).map(localFinding)
    : [(FILE_ACTION[p.action] ?? unknownAction)(p)]));
  const errors = report.errors.map((e) => finding('DRIFT', e.file ?? 'preset', 'a plan without errors', 'error', e.reason));
  const settings = report.settings && ['create', 'update'].includes(report.settings.action)
    ? [finding('DRIFT', '.claude/settings.json', 'the preset settings fragment', 'error', 'the settings merge has pending changes')]
    : [];
  return [...planned, ...errors, ...settings];
}

// 2. Hooks the installer registers, wherever settings.json or settings.local.json (user or project) holds them.
const HOOKS = Object.freeze([
  { script: 'session-end-standalone.js', event: 'Stop' },
  { script: 'gsd-protect-managed-files.js', event: 'PreToolUse', matcher: 'Write' },
  { script: 'gsd-protect-managed-files.js', event: 'PreToolUse', matcher: 'Edit' },
  { script: 'gsd-protect-managed-files.js', event: 'PreToolUse', matcher: 'Bash' },
  { script: 'gsd-owner-approve.js', event: 'UserPromptSubmit' },
  { script: 'gsd-ui-qa-lock.js', event: 'PreToolUse', matcher: 'mcp__.*' },
  { script: 'gsd-ui-qa-lock.js', event: 'PreToolUse', matcher: 'Bash' },
  { script: 'gsd-ui-qa-lock.js', event: 'SubagentStart' },
  { script: 'gsd-ui-qa-lock.js', event: 'SubagentStop' },
]);

const groupsOf = (doc, event) => (isObject(doc) && isObject(doc.hooks) && Array.isArray(doc.hooks[event]) ? doc.hooks[event] : []);
const registered = (docs, row) => docs.some((doc) => groupsOf(doc, row.event).some((g) => isObject(g)
  && (row.matcher === undefined || g.matcher === row.matcher)
  && Array.isArray(g.hooks) && g.hooks.some((h) => isObject(h) && typeof h.command === 'string' && h.command.includes(row.script))));

function readSettingsFiles(files) {
  return files.map(({ abs, shown }) => {
    const bytes = readBytes(abs);
    if (bytes === null) return { shown, absent: true };
    const parsed = bytes === undefined ? { ok: false } : parseJsonc(bytes.toString('utf8'));
    return { shown, ...(parsed.ok ? { doc: parsed.value } : { corrupt: true }) };
  });
}

function hookFindings(root, home) {
  const read = readSettingsFiles([
    { abs: path.join(home, '.claude', 'settings.json'), shown: '~/.claude/settings.json' },
    { abs: path.join(home, '.claude', 'settings.local.json'), shown: '~/.claude/settings.local.json' },
    { abs: path.join(root, '.claude', 'settings.json'), shown: '.claude/settings.json' },
    { abs: path.join(root, '.claude', 'settings.local.json'), shown: '.claude/settings.local.json' },
  ]);
  const corrupt = read.filter((r) => r.corrupt).map((r) => finding('DRIFT', r.shown, 'valid JSON', 'error', 'the file cannot be parsed; hooks in it are not read'));
  const docs = read.filter((r) => r.doc !== undefined).map((r) => r.doc);
  const missing = HOOKS.filter((row) => !registered(docs, row)).map((row) => finding(
    'MISSING',
    `hooks.${row.event}${row.matcher === undefined ? '' : `[${row.matcher}]`}`,
    `register ${row.script}`,
    'error',
    'the framework installs this hook; run npm run install:gsd',
  ));
  return [...corrupt, ...missing];
}

// 3. Deployed framework against its install manifest, plus the local patches the installer set aside.
const shownHome = (rel) => `~/.claude/${rel}`;

function frameworkFindings(home) {
  const dir = path.join(home, '.claude');
  const manifestBytes = readBytes(path.join(dir, 'gsd-file-manifest.json'));
  if (manifestBytes === null) return [finding('MISSING', shownHome('gsd-file-manifest.json'), 'run npm run install:gsd', 'error', 'the framework is not installed')];
  const parsed = manifestBytes === undefined ? { ok: false } : parseJsonc(manifestBytes.toString('utf8'));
  if (!parsed.ok || !isObject(parsed.value) || !isObject(parsed.value.files)) {
    return [finding('DRIFT', shownHome('gsd-file-manifest.json'), 'valid JSON', 'error', 'the install manifest cannot be read')];
  }
  const checked = Object.entries(parsed.value.files)
    .filter(([rel]) => path.basename(rel) !== '.DS_Store')
    .map(([rel, hash]) => ({ rel, bytes: readBytes(path.join(dir, rel)), hash }));
  const missing = checked.filter((c) => c.bytes === null).map((c) => finding('MISSING', shownHome(c.rel), 'reinstall', 'error', 'a file the install manifest lists is gone'));
  const changed = checked.filter((c) => c.bytes && sha256(c.bytes) !== c.hash).map((c) => c.rel);
  const shown = changed.slice(0, MAX_FRAMEWORK_LINES).map((rel) => finding('LOCAL', shownHome(rel), 'the installed copy', 'info', 'changed since the install'));
  const more = changed.length > MAX_FRAMEWORK_LINES
    ? [finding('LOCAL', shownHome('get-shit-done'), 'the installed copy', 'info', `${changed.length - MAX_FRAMEWORK_LINES} more files changed since the install`)]
    : [];
  return [...missing, ...shown, ...more, ...patchFindings(dir)];
}

function patchFindings(dir) {
  const bytes = readBytes(path.join(dir, 'gsd-local-patches', 'backup-meta.json'));
  const parsed = bytes ? parseJsonc(bytes.toString('utf8')) : { ok: false };
  const files = parsed.ok && isObject(parsed.value) && Array.isArray(parsed.value.files) ? parsed.value.files : [];
  return files.length === 0
    ? []
    : [finding('INFO', shownHome('gsd-local-patches'), 'run /gsd:reapply-patches', 'info', `${files.length} backed-up local patches`)];
}

// 4. Config keys that must move. Blocking only once the mutation tool refuses the old key.
function migrationFindings(stack, refuses = MUTATION_REFUSES_ERROR_PATTERN) {
  const mutation = isObject(stack.mutation) ? stack.mutation : {};
  return Object.prototype.hasOwnProperty.call(mutation, 'error_pattern')
    ? [finding('DRIFT', 'stack.mutation.error_pattern', 'rename to stack.mutation.build_error_pattern', refuses ? 'error' : 'info', 'the mutation tool reads build_error_pattern')]
    : [];
}

// 5. The scripts a project's preset ships; a default gate whose script is not one of them does not apply.
function presetGateScripts(root, stack, presetsRoot = PRESETS_ROOT) {
  const name = stack.preset;
  if (typeof name !== 'string' || !PRESET_NAME_RE.test(name)) return undefined;
  const loaded = loadPreset(path.join(presetsRoot, name));
  if (!loaded.ok) return undefined;
  const dests = new Set(loaded.preset.files.map((f) => f.dest));
  return (script) => dests.has(script) || fs.existsSync(path.join(root, script));
}

function projectChecks(root, stack, { home = os.homedir(), presetsRoot = PRESETS_ROOT } = {}) {
  return [
    ...fileFindings(root, stack, presetsRoot),
    ...hookFindings(root, home),
    ...frameworkFindings(home),
    ...migrationFindings(stack),
  ];
}

module.exports = {
  MUTATION_REFUSES_ERROR_PATTERN,
  HOOKS,
  parseJsonc,
  fileFindings,
  hookFindings,
  frameworkFindings,
  migrationFindings,
  presetGateScripts,
  projectChecks,
  isBlockingFinding,
  findingLine,
};
