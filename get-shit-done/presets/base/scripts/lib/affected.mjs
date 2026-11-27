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

const expand = (template, match) => template.replace(/\$(\d)/g, (_, i) => match[Number(i)] ?? '');
const unique = (list) => [...new Set(list)].sort();

export function selectAffected({ changed, all, config }) {
  const candidates = all.filter((f) => config.filePattern.test(f));
  const known = new Set(candidates);
  const fallbackHit = changed.find((p) => config.fallback.some((re) => re.test(p)));
  if (fallbackHit !== undefined) return { full: true, files: unique(candidates), reason: `fallback path ${fallbackHit}` };
  const mapped = changed.flatMap((p) => config.map.flatMap((m) => {
    const match = m.re.exec(p);
    return match ? m.files.map((t) => expand(t, match)) : [];
  }));
  const files = unique([...config.always, ...changed.filter((p) => known.has(p)), ...mapped.filter((p) => known.has(p))]);
  return { full: false, files, reason: changed.length === 0 ? 'no changes: always-run set' : 'changed paths mapped' };
}

const git = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) return fail(`git ${args[0]} failed`);
  return done(r.stdout.split('\n').filter((l) => l !== ''));
};

export function readConfigKey(file, key) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fail(`${file} unreadable or not JSON`); }
  return done(parsed?.stack?.affected?.[key]);
}

// Edge: git and the config file are read here, the result is printed as one JSON line. base defaults to HEAD.
export function runAffected(key, base = 'HEAD') {
  const raw = readConfigKey('.planning/config.json', key);
  if (!raw.ok) return raw;
  const config = parseSelectorConfig(raw.value, `stack.affected.${key}`);
  if (!config.ok) return config;
  const diff = git(['diff', '--name-only', base]);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  const all = git(['ls-files']);
  const failed = [diff, untracked, all].find((r) => !r.ok);
  if (failed) return failed;
  return done(selectAffected({ changed: [...diff.value, ...untracked.value], all: all.value, config: config.value }));
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
