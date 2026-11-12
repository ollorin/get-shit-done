#!/usr/bin/env node
// Dependency-vulnerability gate: scans each lockfile with osv-scanner and fails on any finding at or above the severity
// floor that is not in the accepted-findings baseline (.planning/cve-baseline.json, { "allowedFindings": ["<ecosystem>::<package>::<id>"] };
// absent means empty). FAIL-CLOSED: a scan that could not complete (no output, non-JSON, no "results" array) blocks.
// Facts come from .planning/config.json, key stack.cve (one JSON.parse; unreadable or non-JSON config is a failure):
//   lockfiles (default: every tracked file named package-lock.json, pnpm-lock.yaml, yarn.lock, poetry.lock, requirements.txt,
//   go.mod, Cargo.lock or Gemfile.lock), severity_floor (HIGH), allow_missing_scanner (false).
// Prerequisite: osv-scanner is an external binary GSD does not install. Without it the gate exits 1 (NOT INSTALLED) unless
// stack.cve.allow_missing_scanner is true, which turns that one case into a SKIPPED line and exit 0.
// The scanner command differs by version: v1 `osv-scanner --format json -L <lockfile>`, v2 `osv-scanner scan source -L <lockfile>
// --format json`; scannerArgs picks v2 when `osv-scanner --help` lists a `scan` command.
// Usage: node scripts/dependency-scan-gate.mjs        Exit: 0 pass or nothing to scan, 1 blocking finding or failure.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEVERITY_RANK = { LOW: 0, MODERATE: 1, UNKNOWN: 3, HIGH: 2, CRITICAL: 3 };
const LOCKFILE_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'requirements.txt', 'go.mod', 'Cargo.lock', 'Gemfile.lock'];
const BASELINE = '.planning/cve-baseline.json';
const CONFIG = '.planning/config.json';

export function normalizeSeverity(raw) {
  const s = String(raw ?? '').toUpperCase();
  return s === 'LOW' || s === 'MODERATE' || s === 'HIGH' || s === 'CRITICAL' ? s : 'UNKNOWN';
}

// UNKNOWN (no usable severity anywhere) is treated as at-floor: a missing score must not read as safe.
export const meetsFloor = (severity, floor) => severity === 'UNKNOWN' || SEVERITY_RANK[severity] >= SEVERITY_RANK[floor];

export const bandForScore = (score) => (!Number.isFinite(score) ? 'UNKNOWN' : score >= 9 ? 'CRITICAL' : score >= 7 ? 'HIGH' : score >= 4 ? 'MODERATE' : 'LOW');

const roundUp1 = (x) => { const i = Math.round(x * 100000); return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10; };

// CVSS v3.x base score from a vector string; NaN when the vector is not a complete v3 vector.
export function cvssV3Score(vector) {
  const m = Object.fromEntries(String(vector ?? '').split('/').slice(1).map((kv) => kv.split(':')));
  if (!/^CVSS:3\.[01]\//.test(String(vector ?? ''))) return NaN;
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV];
  const AC = { L: 0.77, H: 0.44 }[m.AC];
  const changed = m.S === 'C';
  const PR = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
  const UI = { N: 0.85, R: 0.62 }[m.UI];
  const cia = (k) => ({ H: 0.56, L: 0.22, N: 0 }[m[k]]);
  const [C, I, A] = [cia('C'), cia('I'), cia('A')];
  if ([AV, AC, PR, UI, C, I, A].some((v) => v === undefined) || (m.S !== 'U' && m.S !== 'C')) return NaN;
  const iss = 1 - (1 - C) * (1 - I) * (1 - A);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploit = 8.22 * AV * AC * PR * UI;
  return roundUp1(Math.min(changed ? 1.08 * (impact + exploit) : impact + exploit, 10));
}

// Severity of one advisory: a MAL-* id or alias always CRITICAL; else database_specific.severity, else the scanner group's
// max_severity, else a CVSS v3 vector score; UNKNOWN only when none of them is usable.
export function resolveSeverity(vuln, groups = []) {
  if ([vuln.id, ...(vuln.aliases ?? [])].some((i) => /^MAL-/i.test(String(i ?? '')))) return 'CRITICAL';
  const declared = normalizeSeverity(vuln.database_specific?.severity);
  if (declared !== 'UNKNOWN') return declared;
  const ids = new Set([vuln.id, ...(vuln.aliases ?? [])]);
  const scores = [];
  for (const g of groups) {
    if ((g.ids ?? []).some((i) => ids.has(i)) || (g.aliases ?? []).some((i) => ids.has(i))) scores.push(Number.parseFloat(g.max_severity));
  }
  const vectors = (vuln.severity ?? []).map((sev) => (/^CVSS:3/.test(String(sev.score)) ? cvssV3Score(sev.score) : Number.parseFloat(sev.score)));
  if (vectors.some((v) => !Number.isFinite(v))) return 'UNKNOWN';
  scores.push(...vectors);
  const best = Math.max(...scores.filter(Number.isFinite), -1);
  return best >= 0 ? bandForScore(best) : 'UNKNOWN';
}

export const findingKey = (f) => `${f.ecosystem}::${f.package}::${f.id}`;

export function dedupeFindings(findings) {
  const seen = new Map();
  for (const f of findings) {
    const key = `${findingKey(f)}::${f.source}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()].sort((a, b) => findingKey(a).localeCompare(findingKey(b)));
}

// Flattens osv-scanner's `--format json` output into findings.
export function extractFindings(output) {
  const findings = [];
  for (const result of output.results ?? []) {
    for (const pkg of result.packages ?? []) {
      for (const vuln of pkg.vulnerabilities ?? []) {
        findings.push({
          id: vuln.id,
          package: pkg.package.name,
          version: pkg.package.version,
          ecosystem: pkg.package.ecosystem,
          severity: resolveSeverity(vuln, pkg.groups),
          summary: vuln.summary ?? '',
          source: result.source?.path ?? 'unknown',
        });
      }
    }
  }
  return findings;
}

// Parse-or-fail for one scanner run: never returns a clean value for output it could not identify as a completed scan.
export function parseScannerOutput(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'osv-scanner produced no output on stdout' };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, reason: `osv-scanner stdout is not valid JSON (${err.message}) - first line: ${trimmed.split('\n')[0].slice(0, 200)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'osv-scanner stdout is valid JSON but not an object' };
  }
  if (!Array.isArray(parsed.results)) {
    return { ok: false, reason: `osv-scanner output has no "results" array (keys: ${Object.keys(parsed).slice(0, 8).join(', ') || '<none>'}) - the scan did not complete` };
  }
  return { ok: true, value: parsed };
}

// A non-zero exit is a failure only when the output was not positively identified as a completed scan.
export function scanFailureForExit(source, exitCode, stderr, parse) {
  if (parse.ok) return null;
  const first = stderr.trim().split('\n').filter((l) => l.length > 0)[0]?.slice(0, 200);
  return { source, reason: `${parse.reason} (exit ${exitCode}${first ? `, stderr: ${first}` : ''})` };
}

export function evaluateScan(findings, { floor, baseline, scanFailures = [] }) {
  const atFloor = findings.filter((f) => meetsFloor(f.severity, floor));
  const fresh = atFloor.filter((f) => !baseline.includes(findingKey(f)));
  return {
    floor,
    totalFindingsAtFloor: atFloor.length,
    newFindings: fresh
      .map((f) => ({ key: findingKey(f), detail: `${f.package}@${f.version} (${f.ecosystem}) - ${f.severity} - ${f.summary} [${f.source}]` }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    scanFailures,
    blocking: fresh.length > 0 || scanFailures.length > 0,
  };
}

export const exitCodeFor = (evaluation) => (evaluation.blocking ? 1 : 0);

// The `scan` command is listed under COMMANDS by v2 and absent from v1's help.
export function scannerArgs(helpText, lockfile) {
  const v2 = /^\s*scan\s{2,}\S/m.test(helpText) || /^\s*scan,/m.test(helpText);
  return v2 ? ['scan', 'source', '-L', lockfile, '--format', 'json'] : ['--format', 'json', '-L', lockfile];
}

class Fail extends Error {}

function readJson(file, what) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { throw new Fail(`${what} unreadable: ${err.code ?? err.message}`); }
  try { return JSON.parse(text); } catch (err) { throw new Fail(`${what} is not valid JSON: ${err.message}`); }
}

function readBaseline(root) {
  const file = path.join(root, BASELINE);
  if (!fs.existsSync(file)) return [];
  const parsed = readJson(file, BASELINE);
  if (!Array.isArray(parsed?.allowedFindings) || !parsed.allowedFindings.every((k) => typeof k === 'string')) {
    throw new Fail(`${BASELINE} needs allowedFindings: an array of strings`);
  }
  return parsed.allowedFindings;
}

function trackedLockfiles(root) {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Fail(`git ls-files failed, so tracked lockfiles are unknown: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout.split('\0').filter((f) => f.length > 0 && LOCKFILE_NAMES.includes(path.posix.basename(f))).sort();
}

function readSettings(root) {
  const config = readJson(path.join(root, CONFIG), CONFIG);
  const cve = config?.stack?.cve ?? {};
  const floor = cve.severity_floor === undefined ? 'HIGH' : String(cve.severity_floor).toUpperCase();
  if (floor === 'UNKNOWN' || !(floor in SEVERITY_RANK)) throw new Fail(`stack.cve.severity_floor ${cve.severity_floor} is not one of LOW, MODERATE, HIGH, CRITICAL`);
  const lockfiles = cve.lockfiles ?? trackedLockfiles(root);
  return { lockfiles, floor, allowMissing: cve.allow_missing_scanner === true };
}

function runScanner(root, lockfile, helpText) {
  const r = spawnSync('osv-scanner', scannerArgs(helpText, lockfile), { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return { ok: false, reason: `could not run osv-scanner against ${lockfile}: ${r.error.message}` };
  const parse = parseScannerOutput(r.stdout);
  const failure = scanFailureForExit(lockfile, r.status, r.stderr, parse);
  return failure ? { ok: false, reason: failure.reason } : parse;
}

function main() {
  const root = process.cwd();
  const { lockfiles, floor, allowMissing } = readSettings(root);
  if (lockfiles.length === 0) {
    console.log('no lockfile, nothing to scan');
    return 0;
  }
  const help = spawnSync('osv-scanner', ['--help'], { encoding: 'utf8' });
  if (help.error) {
    if (allowMissing) {
      console.log('SKIPPED: osv-scanner not installed (stack.cve.allow_missing_scanner)');
      return 0;
    }
    console.error('NOT INSTALLED: osv-scanner');
    console.error('Install it (https://google.github.io/osv-scanner/installation/), or set stack.cve.allow_missing_scanner to true in .planning/config.json to skip this gate.');
    return 1;
  }
  const helpText = `${help.stdout}\n${help.stderr}`;
  const baseline = readBaseline(root);
  const findings = [];
  const scanFailures = [];
  for (const lockfile of lockfiles) {
    const scan = runScanner(root, lockfile, helpText);
    if (scan.ok) findings.push(...extractFindings(scan.value));
    else scanFailures.push({ source: lockfile, reason: scan.reason });
  }
  const evaluation = evaluateScan(dedupeFindings(findings), { floor, baseline, scanFailures });
  console.log(`[${evaluation.blocking ? 'BLOCK' : 'PASS'}] ${evaluation.totalFindingsAtFloor} finding(s) at or above ${floor}, ${evaluation.newFindings.length} new (not in ${BASELINE})`);
  for (const f of evaluation.newFindings) console.log(`  - ${f.key}: ${f.detail}`);
  for (const f of evaluation.scanFailures) console.error(`  ! ${f.source}: ${f.reason}`);
  if (evaluation.scanFailures.length > 0) {
    console.error(`BLOCKING: ${evaluation.scanFailures.length} lockfile(s) could not be scanned, so their vulnerabilities are unknown, not absent.`);
  }
  return exitCodeFor(evaluation);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main();
  } catch (err) {
    if (!(err instanceof Fail)) throw err;
    console.error(`dependency-scan-gate: ${err.message}`);
    process.exitCode = 1;
  }
}
