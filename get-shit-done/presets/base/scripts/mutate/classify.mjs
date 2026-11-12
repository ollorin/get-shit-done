// mutate/classify: the pure decision layer. No I/O; every function is unit-tested directly.
// Verdicts come from the test command's exit status, not from parsing one runner's summary text:
//   exit 0 -> survived; non-zero -> killed; timeout -> timeout (inconclusive); the command did not run -> errored.
// With an error pattern, a non-zero exit whose output matches it is errored: a mutant that fails to build is not a kill.
import { createHash } from 'node:crypto';

export const ok = (value) => ({ ok: true, value });
export const fail = (error) => ({ ok: false, error });

export const NO_PATTERN_NOTICE = 'no error pattern: a mutant that fails to build counts as killed';
export const EXPECTS = ['killed', 'survived'];
const MAX_LINE = 200;
// sh reports a command it could not run as 126 (not executable) or 127 (not found).
const NOT_RUN = new Set([126, 127]);

export const sha256Hex = (data) => createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest('hex');

/** The status query is scoped to one file, so any output line (modified, untracked, staged, ignored) is dirty. */
export const isDirtyPorcelain = (stdout) => stdout.split('\n').some((line) => line.trim() !== '');

/** Counts overlapping occurrences, so `aa` in `aaa` is 2 and never passes the uniqueness check. */
export function countOccurrences(src, needle, from = 0) {
  const at = needle === '' ? -1 : src.indexOf(needle, from);
  return at === -1 ? 0 : 1 + countOccurrences(src, needle, at + 1);
}

export const applySnippet = (src, old, neu) => src.replace(old, () => neu);

/** A repository-relative path with no escape: not absolute, no backslash, no `..` and no empty segment. */
export const pathError = (p) => (p.startsWith('/') || p.includes('\\') || p.split('/').some((seg) => seg === '..' || seg === '') ? `unsafe path: ${p}` : null);

/**
 * killed / survived / timeout / errored from a finished test command.
 * run: { exitCode (number or null when killed by a signal), timedOut, spawnFailed, output }; errorPattern: RegExp or null.
 */
export function classify(run, errorPattern = null) {
  if (run.timedOut) return 'timeout';
  if (run.spawnFailed || run.exitCode === null || NOT_RUN.has(run.exitCode)) return 'errored';
  if (run.exitCode === 0) return 'survived';
  return errorPattern !== null && errorPattern.test(run.output) ? 'errored' : 'killed';
}

/** The first output line that looks like a failure (the error pattern when set), trimmed to 200 characters; null if none. */
export function firstFailingLine(output, errorPattern = null) {
  const looksBad = errorPattern ?? /\b(?:error|fail(?:ed|ure)?|assert\w*)\b/i;
  const hit = output.split('\n').map((l) => l.trim()).find((l) => l !== '' && looksBad.test(l));
  return hit === undefined ? null : hit.slice(0, MAX_LINE);
}

/** A kill is confirmed when a second run of the same mutant is also a kill; one red run of a flaky test is not proof. */
export const killReproduced = (secondOutcome) => secondOutcome === 'killed';

function mutantProblem(raw, index) {
  const where = `mutant[${index}]`;
  if (raw === null || typeof raw !== 'object') return `${where}: not an object`;
  const bad = ['id', 'file', 'old', 'new', 'test'].filter((k) => typeof raw[k] !== 'string');
  if (bad.length > 0) return `${where}: missing or non-string ${bad.join(', ')}`;
  if (raw.id === '' || raw.old === '') return `${where}: id and old must be non-empty`;
  if (raw.old === raw.new) return `${where}: old equals new (no-op mutant)`;
  if (raw.expect !== undefined && !EXPECTS.includes(raw.expect)) return `${where}: expect must be one of ${EXPECTS.join(', ')}`;
  const path = pathError(raw.file) ?? pathError(raw.test);
  return path === null ? null : `${where}: ${path}`;
}

/** Validates a parsed mutants file: an array of { id, file, old, new, test, expect? } with unique ids. */
export function parseMutants(input) {
  if (!Array.isArray(input)) return fail('mutants file must be a JSON array');
  const problems = input.map(mutantProblem).filter((p) => p !== null);
  if (problems.length > 0) return fail(problems.join('; '));
  const ids = input.map((m) => m.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  return dupes.length > 0 ? fail(`duplicate mutant ids: ${[...new Set(dupes)].join(', ')}`) : ok(input);
}

/** A canary fails when its outcome differs from `expect`. */
export const canaryMismatches = (records) => records.filter((r) => r.expect !== undefined && r.outcome !== r.expect);

/** Outcomes that mean the mutant was never conclusively tested (a timeout proves nothing). */
export const inconclusive = (records) => records.filter((r) => r.outcome === 'invalid-snippet' || r.outcome === 'errored' || r.outcome === 'timeout');

export function renderMarkdown(records) {
  const rows = records.map((r) => `| ${r.id} | ${r.file} | ${r.outcome}${r.expect && r.outcome !== r.expect ? ` (expect ${r.expect})` : ''} | ${r.duration_ms} | ${(r.first_failing_line ?? r.detail ?? '').replaceAll('|', '\\|')} |`);
  return ['| id | file | outcome | ms | first failing line |', '|---|---|---|---|---|', ...rows].join('\n');
}
