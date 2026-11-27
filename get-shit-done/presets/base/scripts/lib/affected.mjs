// Shared selector behind scripts/affected-specs.mjs and scripts/affected-tests.mjs.
// selectAffected is pure: changed paths + every candidate file + one selector config in, a result value out.
// The config (.planning/config.json, stack.affected.specs / stack.affected.tests) is the project's:
//   file_pattern  regex: which tracked files are candidates (specs or tests)
//   always_run    paths always selected
//   fallback      regexes: a changed path matching one selects every candidate
//   map           [{ match: regex, files: [path templates, $1..$9 from the match] }]: a changed path selects the files
// A changed candidate selects itself. Failures are { ok: false, error } values; nothing here throws.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fail = (error) => ({ ok: false, error });
const done = (value) => ({ ok: true, value });
const isStrings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

function compile(source, what) {
  if (typeof source !== 'string') return fail(`${what} must be a string`);
  try { return done(new RegExp(source)); } catch { return fail(`${what} is not a valid regex`); }
}

function compileAll(sources, what) {
  const results = sources.map((s, i) => compile(s, `${what}[${i}]`));
  const bad = results.find((r) => !r.ok);
  return bad ?? done(results.map((r) => r.value));
}

export function parseSelectorConfig(raw, key) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail(`${key} is not configured`);
  const { file_pattern: pattern, always_run: always = [], fallback = [], map = [] } = raw;
  if (!isStrings(always) || !isStrings(fallback)) return fail(`${key}.always_run and ${key}.fallback must be arrays of strings`);
  if (!Array.isArray(map) || !map.every((m) => m && typeof m.match === 'string' && isStrings(m.files))) {
    return fail(`${key}.map must be an array of { match, files }`);
  }
  const filePattern = compile(pattern, `${key}.file_pattern`);
  const fallbackRes = compileAll(fallback, `${key}.fallback`);
  const mapRes = compileAll(map.map((m) => m.match), `${key}.map.match`);
  const bad = [filePattern, fallbackRes, mapRes].find((r) => !r.ok);
  if (bad) return bad;
  return done({
    filePattern: filePattern.value,
    always,
    fallback: fallbackRes.value,
    map: map.map((m, i) => ({ re: mapRes.value[i], files: m.files })),
  });
}

// $1..$9 only: "$12" is group 1 followed by the character 2. Paths are git paths, always "/"-separated;
// Windows-style paths are not handled.
const expand = (template, match) => template.replace(/\$(\d)/g, (_, i) => match[Number(i)] ?? '');
const unique = (list) => [...new Set(list)].sort();

// Fail closed: a changed path that is not a candidate and expands (through the map) to no known file selects the full suite.
export function selectAffected({ changed, all, config }) {
  const candidates = all.filter((f) => config.filePattern.test(f));
  const known = new Set(candidates);
  const fallbackHit = changed.find((p) => config.fallback.some((re) => re.test(p)));
  if (fallbackHit !== undefined) return { full: true, files: unique(candidates), reason: `fallback path ${fallbackHit}` };
  const mappedFor = (p) => config.map.flatMap((m) => {
    const match = m.re.exec(p);
    return match ? m.files.map((t) => expand(t, match)).filter((f) => known.has(f)) : [];
  });
  const unmapped = changed.find((p) => !config.filePattern.test(p) && mappedFor(p).length === 0);
  if (unmapped !== undefined) return { full: true, files: unique(candidates), reason: `unmapped path ${unmapped}` };
  const files = unique([...config.always, ...changed.filter((p) => known.has(p)), ...changed.flatMap(mappedFor)]);
  return { full: false, files, reason: changed.length === 0 ? 'no changes: always-run set' : 'changed paths mapped' };
}

const gitRaw = (args, cwd) => {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd });
  if (r.error || r.status !== 0) return fail(`git ${args[0]} failed`);
  return done(r.stdout);
};
const gitLines = (args, cwd) => {
  const r = gitRaw(args, cwd);
  return r.ok ? done(r.value.split('\0').filter((l) => l !== '')) : r;
};

export function readConfigKey(file, key) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fail(`${file} unreadable or not JSON`); }
  return done(parsed?.stack?.affected?.[key]);
}

const unsafeAlways = (p) => p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..');

// always_run is printed, so each entry must be a repo-relative path of a known candidate.
function checkAlwaysRun(always, known) {
  const bad = always.find((p) => unsafeAlways(p) || !known.has(p));
  return bad === undefined ? done(always) : fail(`always_run entry ${JSON.stringify(bad)} is not a known candidate file`);
}

// Edge: git and the config file are read here, the result is printed as one JSON line.
// base is required: the diff runs from merge-base(base, HEAD) to the working tree (committed, staged, unstaged, untracked).
export function runAffected(key, base) {
  if (typeof base !== 'string' || base === '') return fail('a base ref argument is required');
  const top = gitRaw(['rev-parse', '--show-toplevel']);
  if (!top.ok) return top;
  const cwd = top.value.trim();
  const raw = readConfigKey(path.join(cwd, '.planning', 'config.json'), key);
  if (!raw.ok) return raw;
  const config = parseSelectorConfig(raw.value, `stack.affected.${key}`);
  if (!config.ok) return config;
  const tip = gitRaw(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], cwd);
  if (!tip.ok) return fail(`base ${JSON.stringify(base)} is not a known commit`);
  const mergeBase = gitRaw(['merge-base', tip.value.trim(), 'HEAD'], cwd);
  if (!mergeBase.ok) return fail('merge-base of the base ref and HEAD cannot be resolved');
  const diff = gitLines(['diff', '--name-only', '--no-renames', '-z', '--end-of-options', mergeBase.value.trim()], cwd);
  const untracked = gitLines(['ls-files', '-z', '--others', '--exclude-standard'], cwd);
  const tracked = gitLines(['ls-files', '-z'], cwd);
  const failed = [diff, untracked, tracked].find((r) => !r.ok);
  if (failed) return failed;
  const all = [...tracked.value, ...untracked.value];
  const always = checkAlwaysRun(config.value.always, new Set(all.filter((f) => config.value.filePattern.test(f))));
  if (!always.ok) return always;
  return done(selectAffected({ changed: [...diff.value, ...untracked.value], all, config: config.value }));
}

export function main(key, argv) {
  const result = runAffected(key, argv[2]);
  if (!result.ok) {
    process.stderr.write(`affected-${key}: ${result.error}\n`);
    return 2;
  }
  process.stdout.write(`${JSON.stringify(result.value)}\n`);
  return 0;
}
