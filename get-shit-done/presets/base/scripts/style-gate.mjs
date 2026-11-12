#!/usr/bin/env node
// style-gate: a per-directory violation ratchet for the clean-code and functional-style rule (.claude/rules/code-style.md).
// Project facts come from .planning/config.json, key stack.style (one JSON.parse; unreadable or non-JSON config fails):
//   rule_set (a file name under scripts/style-gate/rule-sets/), roots, exclude_globs, edge_globs, max_file_lines (500),
//   dup_min_lines (12), require_language_rules (default true: a failure when js/ts/py files are scanned by a rule set with no
//   rules (generic) or exist outside the active rule set's extensions; false only prints `no language rules active`). Every dest in .planning/gsd-project-manifest.json (the deployed GSD files) is always excluded.
// Rules: the chosen rule set's regex and structural rules, plus oversizeFiles and duplicateBlocks for every set.
// Ratchet: counts per (top directory under a root, rule) against .planning/style-baseline.json (absent = all 0). A count
// above its baseline exits 1 and prints each site as `file:line [rule] message`; a count below prints STALE.
// Tags (a reason is required): `style-gate:edge <reason>` exempts a file from the edge-exempt rules; `style-gate:ignore
// <reason>` on the same or previous line exempts that line from the line-level rules, never oversizeFiles/duplicateBlocks.
// Usage: node scripts/style-gate.mjs [--write-baseline | --seed-baseline]      Exit: 0 ok, 1 violation or failure, 2 usage.
// style-gate:edge process entry point: reports every failure as one message and an exit code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDuplicates, normalise } from './style-gate/dup.mjs';
import { globToRegExp, scanText } from './style-gate/scan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULE_SET_DIR = path.join(HERE, 'style-gate', 'rule-sets');
const BASELINE = '.planning/style-baseline.json';
const MANIFEST = '.planning/gsd-project-manifest.json';
const DEFAULT_EXCLUDES = ['**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/test_*.py', '**/__tests__/**', '**/node_modules/**', '**/dist/**', '**/build/**', '**/*.d.ts', '**/*.min.js'];
const ALWAYS_SKIP_DIRS = new Set(['.git', 'node_modules']);
const MIRROR_DIR = '.planning/.gsd-preset-base';
const STRUCTURAL = new Set(['inputMutation', 'ifElseRouters']);
const LANGUAGE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py'];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

class Fail extends Error {}
const posix = (p) => p.split(path.sep).join('/');

function readJson(file, what) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { throw new Fail(`${what} unreadable: ${err.code ?? err.message}`); }
  try { return JSON.parse(text); } catch (err) { throw new Fail(`${what} is not valid JSON: ${err.message}`); }
}

const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isCount = (v) => Number.isInteger(v) && v > 0;

export function loadConfig(root) {
  const cfg = readJson(path.join(root, '.planning', 'config.json'), '.planning/config.json');
  const s = cfg?.stack?.style;
  if (s === null || typeof s !== 'object' || Array.isArray(s)) throw new Fail('stack.style is missing from .planning/config.json');
  if (typeof s.rule_set !== 'string' || !SLUG.test(s.rule_set)) throw new Fail('stack.style.rule_set must be a rule set name');
  if (!isStrings(s.roots) || s.roots.length === 0) throw new Fail('stack.style.roots must be a non-empty array of paths');
  for (const r of s.roots) if (path.isAbsolute(r) || posix(path.normalize(r)).startsWith('..')) throw new Fail(`stack.style.roots entry outside the project: ${r}`);
  for (const key of ['exclude_globs', 'edge_globs']) if (s[key] !== undefined && !isStrings(s[key])) throw new Fail(`stack.style.${key} must be an array of strings`);
  if (s.require_language_rules !== undefined && typeof s.require_language_rules !== 'boolean') throw new Fail('stack.style.require_language_rules must be true or false');
  for (const key of ['max_file_lines', 'dup_min_lines']) if (s[key] !== undefined && !isCount(s[key])) throw new Fail(`stack.style.${key} must be a positive integer`);
  return { ruleSet: s.rule_set, roots: s.roots, excludes: s.exclude_globs ?? DEFAULT_EXCLUDES, edgeGlobs: s.edge_globs ?? [], maxLines: s.max_file_lines ?? 500, dupMin: s.dup_min_lines ?? 12, requireLanguageRules: s.require_language_rules !== false };
}

export function loadRuleSet(name, dir = RULE_SET_DIR) {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) throw new Fail(`unknown rule set "${name}" (no ${path.relative(process.cwd(), file)})`);
  const raw = readJson(file, `rule set ${name}`);
  if (!isStrings(raw.extensions) || !raw.extensions.every((e) => e.startsWith('.'))) throw new Fail(`rule set ${name}: extensions must be an array of .ext strings`);
  const structural = raw.structural ?? [];
  for (const id of structural) if (!STRUCTURAL.has(id)) throw new Fail(`rule set ${name}: unknown structural rule ${id}`);
  const regexRules = (raw.regex_rules ?? []).map((r) => {
    if (typeof r?.id !== 'string' || typeof r.pattern !== 'string' || typeof r.message !== 'string') throw new Fail(`rule set ${name}: a regex rule needs id, pattern and message`);
    try { return { id: r.id, re: new RegExp(r.pattern), message: r.message, edgeExempt: r.edge_exempt === true }; } catch (err) {
      throw new Fail(`rule set ${name}: rule ${r.id} has an invalid pattern: ${err.message}`);
    }
  });
  return { extensions: raw.extensions, structural, regexRules, threshold: raw.router_branch_threshold ?? 4 };
}

function manifestDests(root) {
  const file = path.join(root, MANIFEST);
  if (!fs.existsSync(file)) return new Set();
  const files = readJson(file, MANIFEST).files;
  const dests = Array.isArray(files) ? files.map((f) => (typeof f === 'string' ? f : f?.dest)) : Object.keys(files ?? {});
  return new Set(dests.filter((d) => typeof d === 'string'));
}

function walk(root, rel, out) {
  const abs = path.join(root, rel);
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = rel === '' || rel === '.' ? e.name : `${posix(rel)}/${e.name}`;
    if (e.isDirectory()) { if (!ALWAYS_SKIP_DIRS.has(e.name) && child !== MIRROR_DIR) walk(root, child, out); } else if (e.isFile()) out.push(child);
  }
}

/** Sorted, de-duplicated project-relative source files under the roots. */
export function listFiles(root, cfg, extensions) {
  const excludes = cfg.excludes.map(globToRegExp);
  const dests = manifestDests(root);
  const all = new Set();
  for (const r of cfg.roots) {
    const rel = posix(path.normalize(r)).replace(/\/$/, '');
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Fail(`stack.style.roots entry is not a directory: ${r}`);
    const found = [];
    walk(root, rel === '.' ? '' : rel, found);
    for (const f of found) all.add(f);
  }
  return [...all].filter((f) => extensions.some((x) => f.endsWith(x)) && !excludes.some((re) => re.test(f)) && !dests.has(f)).sort();
}

/** The ratchet bucket: the top directory under the root that holds the file. */
export function bucketOf(file, roots) {
  const root = roots.map((r) => posix(path.normalize(r)).replace(/\/$/, '')).filter((r) => r === '.' || file === r || file.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0] ?? '.';
  const rest = root === '.' ? file : file.slice(root.length + 1);
  const seg = rest.split('/');
  if (seg.length === 1) return root;
  return root === '.' ? seg[0] : `${root}/${seg[0]}`;
}

export function loadBaseline(root) {
  const file = path.join(root, BASELINE);
  if (!fs.existsSync(file)) return null;
  const doc = readJson(file, BASELINE);
  const d = doc?.domains;
  const ok = d !== null && typeof d === 'object' && Object.values(d).every((m) => m !== null && typeof m === 'object' && Object.values(m).every((n) => Number.isInteger(n) && n >= 0));
  if (!ok) throw new Fail(`${BASELINE} must be { "domains": { "<dir>": { "<rule>": <count> } } }`);
  return d;
}

/** Pure: measured counts per bucket and rule from violations [{ file, bucket, rule, ... }]. */
export function countBy(violations) {
  const out = {};
  for (const v of violations) { out[v.bucket] ??= {}; out[v.bucket][v.rule] = (out[v.bucket][v.rule] ?? 0) + 1; }
  return out;
}

/** Pure: { exceeded, stale } as lists of { bucket, rule, measured, baseline }. */
export function compare(measured, baseline) {
  const exceeded = [];
  const stale = [];
  const buckets = new Set([...Object.keys(measured), ...Object.keys(baseline)]);
  for (const bucket of [...buckets].sort()) {
    const rules = new Set([...Object.keys(measured[bucket] ?? {}), ...Object.keys(baseline[bucket] ?? {})]);
    for (const rule of [...rules].sort()) {
      const m = measured[bucket]?.[rule] ?? 0;
      const b = baseline[bucket]?.[rule] ?? 0;
      if (m > b) exceeded.push({ bucket, rule, measured: m, baseline: b });
      else if (m < b) stale.push({ bucket, rule, measured: m, baseline: b });
    }
  }
  return { exceeded, stale };
}

/** Pure: the baseline with each count lowered to the measured one and never raised; zero entries dropped. */
export function lowered(baseline, measured) {
  const out = {};
  for (const [bucket, rules] of Object.entries(baseline)) {
    for (const [rule, b] of Object.entries(rules)) {
      const v = Math.min(b, measured[bucket]?.[rule] ?? 0);
      if (v > 0) { out[bucket] ??= {}; out[bucket][rule] = v; }
    }
  }
  return out;
}

const writeBaseline = (root, domains) => {
  const sorted = Object.fromEntries(Object.keys(domains).sort().map((b) => [b, Object.fromEntries(Object.keys(domains[b]).sort().map((r) => [r, domains[b][r]]))]));
  fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(root, BASELINE), `${JSON.stringify({ domains: sorted }, null, 2)}\n`);
};

function collect(root, cfg, ruleSet) {
  const files = listFiles(root, cfg, ruleSet.extensions);
  const violations = [];
  const normalised = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const v of scanText(text, file, ruleSet, { edgeGlobs: cfg.edgeGlobs, maxLines: cfg.maxLines })) violations.push({ file, bucket: bucketOf(file, cfg.roots), ...v });
    normalised.push({ file, lines: normalise(text, file) });
  }
  for (const d of findDuplicates(normalised, cfg.dupMin)) violations.push({ file: d.file, bucket: bucketOf(d.file, cfg.roots), line: d.line, rule: 'duplicateBlocks', message: d.message });
  return { files, violations };
}

function run(argv, root) {
  const flags = argv.filter((a) => a.startsWith('--'));
  const unknown = argv.filter((a) => !['--write-baseline', '--seed-baseline'].includes(a));
  if (unknown.length > 0 || flags.length > 1) { console.error('usage: node scripts/style-gate.mjs [--write-baseline | --seed-baseline]'); return 2; }
  const cfg = loadConfig(root);
  const ruleSet = loadRuleSet(cfg.ruleSet);
  const baseline = loadBaseline(root);
  const { files, violations } = collect(root, cfg, ruleSet);
  const measured = countBy(violations);
  if (argv[0] === '--seed-baseline') {
    if (baseline !== null) throw new Fail(`${BASELINE} exists: --seed-baseline seeds once; use --write-baseline to lower it`);
    writeBaseline(root, measured);
    console.log(`style-gate: seeded ${BASELINE} from ${violations.length} existing violation(s)`);
    return 0;
  }
  if (argv[0] === '--write-baseline') {
    if (baseline === null) throw new Fail(`no ${BASELINE}: run --seed-baseline once first`);
    writeBaseline(root, lowered(baseline, measured));
    console.log(`style-gate: ${BASELINE} lowered to the measured counts (never raised)`);
  }
  const effective = argv[0] === '--write-baseline' ? lowered(baseline, measured) : (baseline ?? {});
  const { exceeded, stale } = compare(measured, effective);
  console.log(`style-gate: ${files.length} file(s), rule set ${cfg.ruleSet}, ${violations.length} violation(s)`);
  if (files.length === 0) console.log(`style-gate: scanned 0 files under ${cfg.roots.join(', ')} - nothing was checked`);
  const noRules = ruleSet.regexRules.length === 0 && ruleSet.structural.length === 0;
  if (noRules && files.length > 0) console.log(`style-gate: no language rules active for ${files.length} source files (rule set ${cfg.ruleSet} has no regex or structural rules; set stack.style.rule_set to js-ts or python)`);
  for (const s of stale) console.log(`STALE ${s.bucket}: ${s.rule} measured ${s.measured} < baseline ${s.baseline} (run --write-baseline)`);
  for (const e of exceeded) {
    console.log(`FAIL ${e.bucket}: ${e.rule} measured ${e.measured} > baseline ${e.baseline}`);
    for (const v of violations.filter((x) => x.bucket === e.bucket && x.rule === e.rule)) console.log(`  ${v.file}:${v.line} [${v.rule}] ${v.message}`);
  }
  const isLanguage = (f) => LANGUAGE_EXTENSIONS.some((x) => f.endsWith(x));
  const ruleless = noRules ? files.filter(isLanguage) : [];
  const unscanned = noRules ? [] : listFiles(root, cfg, LANGUAGE_EXTENSIONS).filter((f) => !ruleSet.extensions.some((x) => f.endsWith(x)));
  if (ruleless.length > 0 && cfg.requireLanguageRules) { console.log(`FAIL no language rules active for ${ruleless.length} source files (rule set ${cfg.ruleSet}; set stack.style.rule_set to js-ts or python, or require_language_rules to false)`); return 1; }
  if (unscanned.length > 0) {
    console.log(`${cfg.requireLanguageRules ? 'FAIL' : 'WARN'} ${unscanned.length} source file(s) are outside rule set ${cfg.ruleSet} and were not scanned: ${unscanned.slice(0, 5).join(', ')}`);
    if (cfg.requireLanguageRules) return 1;
  }
  return exceeded.length === 0 ? 0 : 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = run(process.argv.slice(2), process.cwd()); } catch (err) {
    if (!(err instanceof Fail)) throw err;
    console.error(`style-gate: ${err.message}`);
    process.exitCode = 1;
  }
}
