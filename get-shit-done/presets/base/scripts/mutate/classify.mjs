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
  return buildErrorHit(run, errorPattern) ? 'errored' : 'killed';
}

/** True when a finished, failing run printed the runner's build-error pattern: the run crashed, it did not kill. */
export const buildErrorHit = (run, errorPattern) => errorPattern !== null && !run.timedOut && !run.spawnFailed && run.exitCode !== null && run.exitCode !== 0 && errorPattern.test(run.output);

export const BUILD_ERROR_DETAIL = 'build error pattern matched: a crash is never a kill';
export const BUILD_ERROR_EXIT = 5;

export const LANES = ['unit', 'db'];
export const SELFTEST_KEYS = ['dir', 'ext', 'pass', 'kill', 'build'];
const isSelfTest = (s) => s !== null && typeof s === 'object' && SELFTEST_KEYS.every((k) => typeof s[k] === 'string' && s[k] !== '');

function patternProblem(id, key, value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value === '') return `runner ${id}: ${key} must be a non-empty string`;
  try { new RegExp(value); } catch { return `runner ${id}: ${key} is not a valid regular expression`; }
  return null;
}

/** The passed-test count a runner's output shows under `pattern` (first capture group; a match without one counts 1); 0 when it shows none. */
export function passedCount(output, pattern) {
  const m = new RegExp(pattern).exec(output);
  if (m === null) return 0;
  return m[1] === undefined ? 1 : Number.parseInt(m[1], 10) || 0;
}

export const FILTER_MISS_DETAIL = 'filter matched no test: the named test never ran, so the run is neither a kill nor a survivor';

/** The last ` > ` segment of the first `FAIL` line of a runner's output (the failing test's own title), or null when there is none. */
export function firstFailTitle(output) {
  const line = output.split('\n').find((l) => /^\s*FAIL\b/.test(l));
  return line === undefined ? null : line.split(' > ').pop().trim();
}

/**
 * True when a run of a filtered command (config.testCmd has {name}, config.name is the title) proves nothing (R1.2b, R1.3): a kill
 * whose first FAIL line does not end in the title (the echoed command line never counts), or a pass without a passed-test count.
 */
export function filterMiss(config, outcome, output) {
  if (typeof config.name !== 'string' || !config.testCmd.includes('{name}')) return false;
  if (outcome === 'killed') return firstFailTitle(output) !== config.name;
  return outcome === 'survived' && (!config.passPattern || passedCount(output, config.passPattern) < 1);
}

export const MAX_TITLE = 4096;
/** The `{name}` shape of a runner command: present, and not inside double quotes (where the shell would expand the escaped regex). */
export const nameShapeProblem = (cmd) => {
  if (!cmd.includes('{name}')) return 'test_cmd must contain {name} (the runner carries its own -t before it)';
  return /"[^"]*\{name\}[^"]*"/.test(cmd) ? 'test_cmd must not put {name} inside double quotes' : null;
};

/** The breaker (F6, R5): the last 3 rows are all `errored` or `timeout`, so the harness, not the mutants, is at fault. */
const BREAKER_STREAK = 3;
const isBreakerRow = (r) => r.outcome === 'errored' || r.outcome === 'timeout';
export const harnessFault = (records) => {
  const tail = records.slice(-BREAKER_STREAK);
  return tail.length === BREAKER_STREAK && tail.every(isBreakerRow);
};

const runnerProblem = (r, i) => {
  if (r === null || typeof r !== 'object' || typeof r.id !== 'string' || r.id === '') return `runners[${i}]: id must be a non-empty string`;
  if (typeof r.test_cmd !== 'string' || !r.test_cmd.includes('{file}')) return `runner ${r.id}: test_cmd must contain {file}`;
  const shape = nameShapeProblem(r.test_cmd);
  if (shape !== null) return `runner ${r.id}: ${shape}`;
  const patterns = ['build_error_pattern', 'pass_pattern'].map((k) => patternProblem(r.id, k, r[k])).find((p) => p !== null);
  if (patterns !== undefined) return patterns;
  if (r.lane !== undefined && !LANES.includes(r.lane)) return `runner ${r.id}: lane must be one of ${LANES.join(', ')}`;
  return r.selftest === undefined || isSelfTest(r.selftest) ? null : `runner ${r.id}: selftest needs non-empty string ${SELFTEST_KEYS.join(', ')}`;
};

/** Validates stack.mutation.runners: a non-empty array of { id, test_cmd with {file}, build_error_pattern? } with unique ids. */
export function parseRunners(input) {
  if (!Array.isArray(input) || input.length === 0) return fail('stack.mutation.runners must be a non-empty array');
  const problem = input.map(runnerProblem).find((p) => p !== null);
  if (problem !== undefined) return fail(problem);
  const ids = input.map((r) => r.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  return dupes.length > 0 ? fail(`duplicate runner ids: ${[...new Set(dupes)].join(', ')}`) : ok(input);
}

/** A mutant id -> run config map. Without runners every mutant gets `config`; with them the mutant's `runner` (or the only runner) selects one, an unknown id is a failure. */
export function configsFor(mutants, config) {
  if (config.runners == null) return ok(new Map(mutants.map((m) => [m.id, config])));
  const byId = new Map(config.runners.map((r) => [r.id, {
    ...config, testCmd: r.test_cmd, errorPattern: r.build_error_pattern ?? config.errorPattern, passPattern: r.pass_pattern ?? null, selftest: r.selftest ?? null, lane: r.lane ?? 'unit',
  }]));
  const pairs = mutants.map((m) => {
    const id = m.runner ?? (config.runners.length === 1 ? config.runners[0].id : undefined);
    if (id === undefined) return fail(`mutant ${m.id}: runner is required when several runners are configured`);
    return byId.has(id) ? ok([m.id, byId.get(id)]) : fail(`mutant ${m.id}: unknown runner id ${id}`);
  });
  const bad = pairs.find((p) => !p.ok);
  return bad === undefined ? ok(new Map(pairs.map((p) => p.value))) : bad;
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
  if (typeof raw.expect_failing_test !== 'string' || raw.expect_failing_test === '') return `${where}: expect_failing_test is required (the name of the test that must fail)`;
  if (raw.expect_failing_test.includes('\u0000') || raw.expect_failing_test.length > MAX_TITLE) return `${where} ${raw.id}: expect_failing_test must not contain NUL or exceed ${MAX_TITLE} characters`;
  if (raw.old === raw.new) return `${where}: old equals new (no-op mutant)`;
  if (raw.runner !== undefined && (typeof raw.runner !== 'string' || raw.runner === '')) return `${where}: runner must be a non-empty string`;
  if (raw.expect !== undefined && !EXPECTS.includes(raw.expect)) return `${where}: expect must be one of ${EXPECTS.join(', ')}`;
  const path = pathError(raw.file) ?? pathError(raw.test);
  return path === null ? null : `${where}: ${path}`;
}

/** Validates a parsed mutants file: an array of { id, file, old, new, test, expect_failing_test, expect? } with unique ids. */
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
