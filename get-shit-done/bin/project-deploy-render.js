'use strict';

const fs = require('fs');
const path = require('path');

const PLACEHOLDER_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\}\}/g;
const PRESET_KEYS = new Set(['name', 'version', 'description', 'files', 'settings_fragment']);
const FILE_KEYS = new Set(['src', 'dest', 'kind', 'render', 'capability']);
const FRAGMENT_KEYS = new Set(['permissions', 'hooks']);
const PERMISSION_KEYS = new Set(['allow', 'deny', 'ask']);
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const NEVER_MANAGED = new Set([
  '.claude/settings.local.json',
  '.mcp.json',
  '.planning/config.json',
  '.planning/gsd-project-manifest.json',
]);

const destKey = (dest) => dest.normalize('NFC').toLowerCase();
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isStringArray = (v) => Array.isArray(v) && v.every(isNonEmptyString);
const hasOwnEnumerable = (obj, key) => isPlainObject(obj) && Object.prototype.propertyIsEnumerable.call(obj, key);
const ownValue = (obj, key) => (hasOwnEnumerable(obj, key) ? obj[key] : undefined);
const isScalar = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

function validateDest(dest) {
  if (!isNonEmptyString(dest)) return 'dest must be a non-empty string';
  if (dest.includes('\\')) return 'dest contains a backslash';
  if (dest.startsWith('/') || /^[A-Za-z]:/.test(dest)) return 'dest is absolute';
  const key = destKey(dest);
  const segments = key.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return 'dest has an empty, . or .. segment';
  if (key === '.claude/settings.json') return 'set-managed: use the settings fragment';
  if (NEVER_MANAGED.has(key)) return 'never-managed path';
  const base = segments[segments.length - 1];
  if (base.startsWith('.env') && base !== '.env.example') return 'never-managed path';
  if (key.startsWith('.planning/.gsd-preset-base/') || segments[0] === '.git') return 'never-managed path';
  return null;
}

function lookup(node, [key, ...rest]) {
  if (key === undefined) return { found: true, value: node };
  return hasOwnEnumerable(node, key) ? lookup(node[key], rest) : { found: false };
}

function renderText(text, config) {
  const missing = new Set();
  const invalid = new Set();
  const out = text.replace(PLACEHOLDER_RE, (match, dotted) => {
    const found = lookup(config, dotted.split('.'));
    if (!found.found) {
      missing.add(dotted);
      return match;
    }
    if (isScalar(found.value)) return String(found.value);
    invalid.add(dotted);
    return match;
  });
  return { text: out, missing: [...missing].sort(), invalid: [...invalid].sort() };
}

function renderTree(node, config) {
  if (typeof node === 'string') {
    const r = renderText(node, config);
    return { value: r.text, missing: r.missing, invalid: r.invalid };
  }
  if (Array.isArray(node)) {
    const kids = node.map((c) => renderTree(c, config));
    return {
      value: kids.map((k) => k.value),
      missing: kids.flatMap((k) => k.missing),
      invalid: kids.flatMap((k) => k.invalid),
    };
  }
  if (isPlainObject(node)) {
    const kids = Object.keys(node).map((k) => [k, renderTree(node[k], config)]);
    return {
      value: Object.fromEntries(kids.map(([k, c]) => [k, c.value])),
      missing: kids.flatMap(([, c]) => c.missing),
      invalid: kids.flatMap(([, c]) => c.invalid),
    };
  }
  return { value: node, missing: [], invalid: [] };
}

function readJsonFile(file, label) {
  try {
    if (!fs.lstatSync(file).isFile()) return { error: `${label} is not a regular file` };
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { error: `${label} missing or not valid JSON` };
  }
}

function checkSource(presetDir, realRoot, rel) {
  const shapeOk = isNonEmptyString(rel) && !rel.includes('\\') && !rel.startsWith('/') && !/^[A-Za-z]:/.test(rel)
    && rel.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
  if (!shapeOk) return `invalid path: ${String(rel)}`;
  const abs = path.join(presetDir, rel);
  try {
    if (!fs.lstatSync(abs).isFile()) return `not a regular file: ${rel}`;
  } catch {
    return `source missing: ${rel}`;
  }
  return fs.realpathSync(abs).startsWith(realRoot + path.sep) ? null : `escapes preset directory: ${rel}`;
}

function normalizeFile(entry, presetDir, realRoot) {
  if (!isPlainObject(entry)) return { entry: null, errors: ['file entry must be an object'] };
  const { src, dest, kind = 'whole', render = true, capability = null } = entry;
  const errors = [
    ...Object.keys(entry).filter((k) => !FILE_KEYS.has(k)).map((k) => `unknown file key: ${k}`),
    ...[checkSource(presetDir, realRoot, src)].filter(Boolean),
    ...[validateDest(dest)].filter(Boolean).map((r) => `invalid dest ${String(dest)}: ${r}`),
    ...(kind === 'whole' || kind === 'block' ? [] : [`invalid kind: ${String(kind)}`]),
    ...(typeof render === 'boolean' ? [] : [`render must be a boolean: ${String(src)}`]),
    ...(capability === null || isNonEmptyString(capability) ? [] : [`invalid capability: ${String(capability)}`]),
  ];
  return { entry: errors.length === 0 ? { src, dest, kind, render, capability } : null, errors };
}

function duplicateDestErrors(dests) {
  const seen = new Set();
  return dests.filter(isNonEmptyString).flatMap((d) => {
    const key = destKey(d);
    if (seen.has(key)) return [`duplicate dest: ${d}`];
    seen.add(key);
    return [];
  });
}

function fail(errors) {
  return { ok: false, errors, preset: null };
}

function loadPreset(presetDir) {
  const read = readJsonFile(path.join(presetDir, 'preset.json'), 'preset.json');
  if (read.error) return fail([read.error]);
  const doc = read.value;
  if (!isPlainObject(doc)) return fail(['preset.json must be an object']);
  const realRoot = fs.realpathSync(presetDir);
  const rawFiles = Array.isArray(doc.files) ? doc.files : [];
  const fileResults = rawFiles.map((e) => normalizeFile(e, presetDir, realRoot));
  const fragmentErr = doc.settings_fragment === undefined
    ? []
    : isNonEmptyString(doc.settings_fragment)
      ? [checkSource(presetDir, realRoot, doc.settings_fragment)].filter(Boolean)
      : ['settings_fragment must be a non-empty string'];
  const errors = [
    ...Object.keys(doc).filter((k) => !PRESET_KEYS.has(k)).map((k) => (
      k === 'extends' || k === 'packs' ? `unsupported preset key: ${k}` : `unknown preset key: ${k}`
    )),
    ...(isNonEmptyString(doc.name) && NAME_RE.test(doc.name) ? [] : ['invalid name']),
    ...(isNonEmptyString(doc.version) ? [] : ['version must be a non-empty string']),
    ...(doc.description === undefined || typeof doc.description === 'string' ? [] : ['description must be a string']),
    ...(Array.isArray(doc.files) ? [] : ['files must be an array']),
    ...fileResults.flatMap((r) => r.errors),
    ...duplicateDestErrors(rawFiles.map((e) => ownValue(e, 'dest'))),
    ...fragmentErr,
  ];
  if (errors.length > 0) return fail(errors);
  return {
    ok: true,
    errors: [],
    preset: {
      name: doc.name,
      version: doc.version,
      files: fileResults.map((r) => r.entry),
      settings_fragment: doc.settings_fragment === undefined ? null : doc.settings_fragment,
    },
  };
}

function permissionErrors(p) {
  if (!isPlainObject(p)) return ['invalid permissions'];
  return [
    ...Object.keys(p).filter((k) => !PERMISSION_KEYS.has(k)).map((k) => `unsupported settings fragment key: permissions.${k}`),
    ...Object.keys(p).filter((k) => PERMISSION_KEYS.has(k) && !isStringArray(p[k])).map((k) => `invalid permissions.${k}`),
  ];
}

function hookEntryErrors(event, hook) {
  const ok = isPlainObject(hook) && hook.type === 'command' && isNonEmptyString(hook.command)
    && (hook.timeout === undefined || typeof hook.timeout === 'number');
  return ok ? [] : [`invalid hook command: ${event}`];
}

function hookGroupErrors(event, groups) {
  if (!Array.isArray(groups)) return [`invalid hooks entry: ${event}`];
  return groups.flatMap((group) => {
    if (!isPlainObject(group) || !Array.isArray(group.hooks)) return [`invalid hooks entry: ${event}`];
    const matcherErr = group.matcher === undefined || typeof group.matcher === 'string' ? [] : [`invalid hooks matcher: ${event}`];
    return [...matcherErr, ...group.hooks.flatMap((hook) => hookEntryErrors(event, hook))];
  });
}

function fragmentErrors(obj) {
  if (!isPlainObject(obj)) return ['settings fragment must be an object'];
  return [
    ...Object.keys(obj).filter((k) => !FRAGMENT_KEYS.has(k)).map((k) => `unsupported settings fragment key: ${k}`),
    ...(obj.permissions === undefined ? [] : permissionErrors(obj.permissions)),
    ...(obj.hooks === undefined ? [] : (isPlainObject(obj.hooks)
      ? Object.keys(obj.hooks).flatMap((event) => hookGroupErrors(event, obj.hooks[event]))
      : ['invalid hooks'])),
  ];
}

function renderFile(presetDir, entry, config) {
  const abs = path.join(presetDir, entry.src);
  const mode = fs.statSync(abs).mode & 0o777;
  if (!entry.render) {
    return { file: { dest: entry.dest, kind: entry.kind, content: fs.readFileSync(abs), mode }, errors: [] };
  }
  const r = renderText(fs.readFileSync(abs, 'utf8'), config);
  return {
    file: { dest: entry.dest, kind: entry.kind, content: Buffer.from(r.text, 'utf8'), mode },
    errors: [
      ...r.missing.map((k) => ({ file: entry.src, reason: `missing config key: ${k}` })),
      ...r.invalid.map((k) => ({ file: entry.src, reason: `config key is not a scalar: ${k}` })),
    ],
  };
}

function renderFragment(presetDir, rel, config) {
  const read = readJsonFile(path.join(presetDir, rel), rel);
  if (read.error) return { settings: null, errors: [{ file: rel, reason: read.error }] };
  const shape = fragmentErrors(read.value);
  if (shape.length > 0) return { settings: null, errors: shape.map((reason) => ({ file: rel, reason })) };
  const tree = renderTree(read.value, config);
  return {
    settings: tree.value,
    errors: [
      ...tree.missing.map((k) => ({ file: rel, reason: `missing config key: ${k}` })),
      ...tree.invalid.map((k) => ({ file: rel, reason: `config key is not a scalar: ${k}` })),
    ],
  };
}

function renderPreset(presetDir, config) {
  const loaded = loadPreset(presetDir);
  if (!loaded.ok) {
    return {
      ok: false,
      errors: loaded.errors.map((reason) => ({ file: 'preset.json', reason })),
      name: null,
      version: null,
      files: [],
      settings: null,
    };
  }
  const { preset } = loaded;
  const stackCaps = ownValue(ownValue(config, 'stack'), 'capabilities');
  const included = preset.files.filter((f) => f.capability === null || isPlainObject(ownValue(stackCaps, f.capability)));
  const fileResults = included.map((f) => renderFile(presetDir, f, config));
  const fragment = preset.settings_fragment === null
    ? { settings: null, errors: [] }
    : renderFragment(presetDir, preset.settings_fragment, config);
  const errors = [...fileResults.flatMap((r) => r.errors), ...fragment.errors];
  return {
    ok: errors.length === 0,
    errors,
    name: preset.name,
    version: preset.version,
    files: fileResults.map((r) => r.file),
    settings: fragment.settings,
  };
}

module.exports = { PLACEHOLDER_RE, renderText, destKey, validateDest, loadPreset, renderPreset };
