// flake-gate: flags test code whose value is only correct by luck, driven by `stack.flake_patterns` in
// <project>/.planning/config.json. One implementation for the Write/Edit/MultiEdit hook (--hook) and the gate (--all).
// Patterns are compiled with `new RegExp` and never evaluated as code; flags are not supported (write
// `(?:^|\n)` where an anchor is needed, `[\s\S]` where a dot must cross lines).
// The config is read from the git toplevel of the edited file's repository (the cwd's when the call names no file), never from
// CLAUDE_PROJECT_DIR. A file outside any work tree is allowed with a note, and the --all gate scans tracked files only, so both leave it out;
// Write content, Edit new_string and every MultiEdit edits[].new_string are scanned. A cwd that does not exist or a git failure other than "not a work tree" denies.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export class ConfigError extends Error {}

const DEFAULT_WINDOW = 40;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

function compileRegex(id, field, source) {
  if (!isNonEmptyString(source)) throw new ConfigError(`pattern ${id}: ${field} must be a non-empty string`);
  try {
    return new RegExp(source);
  } catch (e) {
    throw new ConfigError(`pattern ${id}: ${field} is not a valid regular expression (${e.message})`);
  }
}

export function compilePatterns(patterns) {
  if (!Array.isArray(patterns)) throw new ConfigError('stack.flake_patterns.patterns must be an array');
  return patterns.map((p, n) => {
    if (!isObject(p)) throw new ConfigError(`pattern #${n + 1} must be an object`);
    if (!isNonEmptyString(p.id)) throw new ConfigError(`pattern #${n + 1} needs a non-empty id`);
    if (!isNonEmptyString(p.message)) throw new ConfigError(`pattern ${p.id}: message must be a non-empty string`);
    if (p.window !== undefined && !(Number.isInteger(p.window) && p.window > 0)) {
      throw new ConfigError(`pattern ${p.id}: window must be a positive integer`);
    }
    return {
      id: p.id,
      message: p.message,
      window: p.window ?? DEFAULT_WINDOW,
      match: compileRegex(p.id, 'match', p.match),
      requiresBefore: p.requires_before === undefined ? null : compileRegex(p.id, 'requires_before', p.requires_before),
      unlessNearby: p.unless_nearby === undefined ? null : compileRegex(p.id, 'unless_nearby', p.unless_nearby),
    };
  });
}

// `flake-ignore: <reason>` after a comment leader, on the line itself or the one above. A marker without a
// reason is found but not justified, so it still blocks.
const SUPPRESSION = /(?:\/\/|#|--|\/\*|;|<!--)\s*flake-ignore\b(.*)$/i;    // letter case never matters, like the globs below

export function parseSuppressionAt(lines, idx) {
  for (const line of [lines[idx], lines[idx - 1]]) {
    if (typeof line !== 'string') continue;
    const m = line.match(SUPPRESSION);
    if (!m) continue;
    const reason = m[1].replace(/\s*(?:\*\/|-->)\s*$/, '').match(/^\s*:\s*(\S.*)?$/);
    return { found: true, justified: Boolean(reason && reason[1] && reason[1].trim().length > 0) };
  }
  return { found: false, justified: false };
}

// A line that matches `match` is a violation when `requires_before` (if set) matches in the `window` lines above
// it (the line itself included) and `unless_nearby` (if set) matches nowhere within `window` lines either side.
export function scanFlakePatterns(content, patterns) {
  const compiled = compilePatterns(patterns);
  const lines = content.split('\n');
  const violations = [];
  lines.forEach((line, i) => {
    for (const p of compiled) {
      if (!p.match.test(line)) continue;
      const above = lines.slice(Math.max(0, i - p.window), i + 1).join('\n');
      if (p.requiresBefore && !p.requiresBefore.test(above)) continue;
      const around = lines.slice(Math.max(0, i - p.window), Math.min(lines.length, i + p.window + 1)).join('\n');
      if (p.unlessNearby && p.unlessNearby.test(around)) continue;
      const s = parseSuppressionAt(lines, i);
      const note = s.found && !s.justified ? ' (flake-ignore without a reason: add `flake-ignore: <reason>`)' : '';
      violations.push({ line: i + 1, id: p.id, message: `${p.message}${note}`, suppressed: s.found && s.justified });
    }
  });
  return violations;
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');    // the default macOS volume is case-insensitive: E2E/a.ts is the file e2e/a.ts
}

// A glob without a slash matches the basename, one with a slash the repository-relative path.
export function matchesGlobs(relPath, globs) {
  const base = path.posix.basename(relPath);
  return globs.some((g) => globToRegExp(g).test(g.includes('/') ? relPath : base));
}

// null = nothing configured (allow). Throws ConfigError for a config that is present but unusable.
export function loadFlakeConfig(root) {
  const file = path.join(root, '.planning', 'config.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new ConfigError(`cannot read ${file} (${e.code || e.message})`);
  }
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch {
    throw new ConfigError(`${file} is not valid JSON`);
  }
  if (!isObject(cfg)) throw new ConfigError(`${file} must hold a JSON object`);
  if (cfg.stack === undefined || cfg.stack === null) return null;
  if (!isObject(cfg.stack)) throw new ConfigError('stack in .planning/config.json must be an object');
  const fp = cfg.stack.flake_patterns;
  if (fp === undefined || fp === null) return null;
  if (!isObject(fp)) throw new ConfigError('stack.flake_patterns must be an object');
  if (!Array.isArray(fp.patterns)) throw new ConfigError('stack.flake_patterns.patterns must be an array');
  if (fp.patterns.length === 0) return null;
  if (!Array.isArray(fp.test_globs) || !fp.test_globs.every(isNonEmptyString)) {
    throw new ConfigError('stack.flake_patterns.test_globs must be an array of non-empty strings');
  }
  compilePatterns(fp.patterns);
  return { testGlobs: fp.test_globs, patterns: fp.patterns };
}

const GIT_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX'];
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !GIT_ENV.includes(k)));

// { root } in a work tree; { none: true } for an existing directory outside any work tree; { error } for every other failure
// (a directory that does not exist, git missing, a corrupt repository). The GIT_* variables that redirect git are dropped first.
function toplevelOf(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { error: `the directory ${dir} does not exist` };
  try {
    const root = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return root ? { root } : { error: `git printed no repository root for ${dir}` };
  } catch (e) {
    const err = String(e.stderr ?? '').trim();
    if (/not a git repository|must be run in a work tree/.test(err)) return { none: true };
    return { error: `git could not resolve the repository of ${dir} (${e.code ?? `status ${e.status}`}${err ? `: ${err.split('\n')[0]}` : ''})` };
  }
}

function nearestDir(p) {
  let d = path.dirname(p);
  while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d);
  return d;
}

function realish(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(realish(parent), path.basename(p));
  }
}

function relativeToRoot(root, cwd, file) {
  const abs = realish(path.resolve(cwd, file));
  const rel = path.relative(realish(root), abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel.split(path.sep).join('/');
}

const formatViolation = (file, v) => `${file}:${v.line}: [${v.id}] ${v.message}`;

function deny(message) {
  process.stderr.write(`BLOCKED: flake-gate (fail closed): ${message}\n`);
  process.exit(2);
}

// MultiEdit: every edits[].new_string is scanned on its own, like an Edit.
function multiEditContents(toolInput) {
  if (!Array.isArray(toolInput.edits) || !toolInput.edits.every(isObject)) deny('MultiEdit edits is not an array of objects');
  return toolInput.edits.map((e) => e.new_string ?? '');
}

// A Write, Edit or MultiEdit whose path or text is not a string has nothing the scan can judge: deny it before any config decides to allow.
function toolInputShapeError(tool, toolInput) {
  if (!isNonEmptyString(toolInput.file_path ?? toolInput.path)) return `${tool} file_path is not a non-empty string`;
  if (tool === 'Write') return typeof toolInput.content === 'string' ? '' : 'Write content is not a string';
  if (tool === 'Edit') return typeof toolInput.new_string === 'string' ? '' : 'Edit new_string is not a string';
  if (!Array.isArray(toolInput.edits) || !toolInput.edits.every(isObject)) return 'MultiEdit edits is not an array of objects';
  return toolInput.edits.every((e) => typeof e.new_string === 'string') ? '' : 'a MultiEdit edits[].new_string is not a string';
}

function hookMain() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    deny('hook input is not valid JSON');
  }
  if (!isObject(input)) deny('hook input is not a JSON object');
  if (input.tool_name !== 'Write' && input.tool_name !== 'Edit' && input.tool_name !== 'MultiEdit') process.exit(0);
  if (!isObject(input.tool_input)) deny('tool_input is not an object');
  const shape = toolInputShapeError(input.tool_name, input.tool_input);
  if (shape) deny(shape);
  const cwd = isNonEmptyString(input.cwd) ? input.cwd : process.cwd();
  const here = toplevelOf(cwd);
  if (here.error) deny(here.error);
  let root = here.root ?? null;
  const file = input.tool_input.file_path ?? input.tool_input.path;
  let rel = null;
  if (isNonEmptyString(file)) {
    // The repository that owns the edited file decides, not the cwd's: an absolute path into another repo is judged by that repo's config.
    const there = toplevelOf(nearestDir(realish(path.resolve(cwd, file))));
    if (there.error) deny(there.error);
    if (there.none) {
      process.stderr.write(`flake-gate: ${file} is outside any git work tree and is not scanned (the --all gate scans tracked files only)\n`);
      process.exit(0);
    }
    root = there.root;
    rel = relativeToRoot(root, cwd, file);
  }
  if (root === null) process.exit(0);
  // The edit that repairs an unusable config must get through, or the session cannot recover.
  if (rel === '.planning/config.json') process.exit(0);
  const config = loadFlakeConfig(root);
  if (config === null) process.exit(0);
  if (rel === null) process.exit(0);
  if (!matchesGlobs(rel, config.testGlobs)) process.exit(0);
  // A fragment can only under-detect: the Edit scan sees `new_string`, not the whole file.
  const contents = input.tool_name === 'MultiEdit' ? multiEditContents(input.tool_input) : [input.tool_input[input.tool_name === 'Write' ? 'content' : 'new_string'] ?? ''];
  if (!contents.every((c) => typeof c === 'string')) deny('the content to scan is not a string');
  const blocking = contents.flatMap((c) => scanFlakePatterns(c, config.patterns)).filter((v) => !v.suppressed);
  if (blocking.length === 0) process.exit(0);
  process.stderr.write([
    `BLOCKED: ${file} introduces a flake-prone pattern.`,
    '',
    ...blocking.map((v) => formatViolation(file, v)),
    '',
    'If this is a deliberate, justified exception, add a comment on the same line or the line above:',
    '  flake-ignore: <reason>',
    '',
  ].join('\n'));
  process.exit(2);
}

function allMain() {
  const top = toplevelOf(process.cwd());
  const root = top.root;
  if (root === undefined) {
    process.stderr.write(`flake-gate: ${top.error ?? 'not inside a git repository'}\n`);
    process.exit(2);
  }
  const config = loadFlakeConfig(root);
  if (config === null) {
    process.stdout.write('flake-gate: no flake_patterns configured, nothing to scan\n');
    process.exit(0);
  }
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
  const files = tracked.filter((f) => matchesGlobs(f, config.testGlobs));
  let blocking = 0;
  for (const f of files) {
    let content;
    try {
      content = fs.readFileSync(path.join(root, f), 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw new ConfigError(`cannot read ${f} (${e.code || e.message})`);
    }
    for (const v of scanFlakePatterns(content, config.patterns)) {
      if (v.suppressed) process.stdout.write(`(suppressed) ${formatViolation(f, v)}\n`);
      else {
        blocking += 1;
        process.stderr.write(`${formatViolation(f, v)}\n`);
      }
    }
  }
  process.stdout.write(`flake-gate: scanned ${files.length} file(s), ${blocking} violation(s)\n`);
  process.exit(blocking > 0 ? 1 : 0);
}

// The mode flag, not a comparison of argv[1] with this module's URL, decides whether the CLI runs: a symlinked
// path (a tmp dir under /var on macOS) would make such a comparison false and the hook would silently allow.
const mode = process.argv[2];
if (mode === '--hook' || mode === '--all') {
  try {
    if (mode === '--hook') hookMain();
    else allMain();
  } catch (e) {
    const message = e instanceof ConfigError ? e.message : `unexpected error: ${e.message}`;
    if (mode === '--hook') deny(e instanceof ConfigError ? `${message} (repair .planning/config.json with the Edit or Write tool)` : message);
    process.stderr.write(`flake-gate: ${message}\n`);
    process.exit(2);
  }
}
