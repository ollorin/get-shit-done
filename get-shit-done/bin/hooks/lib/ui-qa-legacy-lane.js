'use strict';

/**
 * Legacy reset-literal lane of the UI-QA lock hook (agnostic-M-02, review round 6, binding Fable ruling R6).
 *
 * Third lane of lib/ui-qa-match.js: a command is blocked when ANY lane blocks, and this lane runs last. Its five shapes
 * are the frozen hook's (0b9c35a, tests/fixtures/agnostic/gsd-charlotte-lock.0b9c35a.js:27-38). FLAGS, TASK_FLAGS, RUNNER
 * and prefix() are copied from fixture lines 27-30 and the test re-extracts them from the fixture text. Literal parts are
 * escaped alternations in positive positions only, so the profile's literals give a superset of what the old hook gave
 * its own literals (one alternation over the single literals is the same language as one shape per literal).
 *
 * Time budget: this lane runs inside the matcher's shared MATCH_BUDGET_MS deadline (ui-qa-match.js, round 7). It keeps
 * its own LANE_BUDGET_MS = 1500 as an inner box: the frozen flag runs `-{1,2}[\w-]+` are fixture text and ambiguous, so
 * `npm ` + 40x `--a ` takes minutes unbounded. A timeout (ERR_SCRIPT_EXECUTION_TIMEOUT) or any throw blocks: fail closed.
 */

const vm = require('vm');

const LANE_BUDGET_MS = 1500;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Fixture :28, :30, :29 (RUNNER interpolates FLAGS, as the fixture does).
const FLAGS = String.raw`(?:-{1,2}[\w-]+(?:=\S+)?\s+)*`;
const TASK_FLAGS = String.raw`(?:-{1,2}[\w-]+(?:[= ](?!run\b|task\b)[^\s-]\S*)?\s+)*`;
const RUNNER = String.raw`(?:(?:\S*/)?(?:npx|pnpx|bunx|sudo|exec|time|command|nohup|eval|xargs)\s+${FLAGS}|(?:\S*/)?g?timeout\s+${FLAGS}\d+[smhd]?\s+|(?:\S*/)?nice\s+(?:-n\s*)?(?:-?\d+\s+)?|(?:pnpm|yarn|npm)\s+(?:exec\s+|dlx\s+)?${FLAGS}|(?:\S*/)?env\s+${FLAGS}(?:\w+=\S*\s+)*|\w+=\S*\s+)*`;

// Fixture :27. The lock-wrapper alternative comes from the profile's lock_wrappers (null: the alternative is omitted).
const prefix = (wrapperAlt) => String.raw`(?:^|[;&|\n(\x60{]|\$\(|\b(?:then|do|else)\s|(?:-c|eval)\s+["']` +
  (wrapperAlt ? String.raw`|${wrapperAlt}\b(?:(?!\s--\s)[^;&|\n])*\s--\s` : '') + String.raw`)\s*`;

// Fixture :32 (multi-token): first token, optional @version, a gap, the remaining tokens.
const multiBody = (tokens) => esc(tokens[0]) + String.raw`(?:@\S+)?\s+(?:[^;&|\n]*?\s)?` +
  tokens.slice(1).map(esc).join(String.raw`\s+`) + String.raw`\b`;
const shapeMulti = (wrapperAlt, tokens) => new RegExp(prefix(wrapperAlt) + RUNNER + String.raw`(?:\S*/)?` + multiBody(tokens));
// Fixture :33 (nx run ...), :34 (npm/pnpm/yarn/bun/deno run|task ...), :37 (script path), :36 (position-free flag).
const shapeNx = (wrapperAlt, alt) => new RegExp(prefix(wrapperAlt) + RUNNER + String.raw`(?:\S*/)?nx\s+[^;&|\n]*?\b${alt}\b`);
const shapeTask = (wrapperAlt, alts) => new RegExp(prefix(wrapperAlt) + RUNNER +
  String.raw`(?:npm|pnpm|yarn|bun|deno)\s+${TASK_FLAGS}(?:run|task)\s+${TASK_FLAGS}(?:${alts.join('|')})\b`);
const shapeScript = (wrapperAlt, alt) => new RegExp(prefix(wrapperAlt) + String.raw`(?:(?:ba)?sh\s+)?(?:\S*/)?${alt}\b`);
const shapeFlag = (flag) => new RegExp(String.raw`(?:^|\s)${esc(flag)}\b`);

// The five shape kinds in the fixture's order (:32, :33, :34, :36, :37), each present only when it has an alternation.
function buildLegacyShapes({ wrapperAlt = null, multi = [], nxAlt = null, taskAlts = null, flags = [], scriptAlt = null }) {
  return [
    ...multi.map((tokens) => shapeMulti(wrapperAlt, tokens)),
    ...(nxAlt ? [shapeNx(wrapperAlt, nxAlt)] : []),
    ...(taskAlts ? [shapeTask(wrapperAlt, taskAlts)] : []),
    ...flags.map(shapeFlag),
    ...(scriptAlt ? [shapeScript(wrapperAlt, scriptAlt)] : []),
  ];
}

// Profile literals -> shape spec. A `--flag` literal gets the position-free flag shape; a literal with whitespace is a
// token sequence; every other literal is a single token and joins one alternation for the script, nx and task shapes.
function legacySpec({ resetPatterns = [], lockWrappers = [] }) {
  const literals = resetPatterns.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
  const names = lockWrappers.filter((s) => typeof s === 'string' && s).map(esc);
  const flags = literals.filter((l) => l.startsWith('--') && !/\s/.test(l));
  const multi = literals.filter((l) => /\s/.test(l)).map((l) => l.split(/\s+/));
  const singles = literals.filter((l) => !l.startsWith('--') && !/\s/.test(l));
  const union = singles.length ? `(?:${singles.map(esc).join('|')})` : null;
  return {
    wrapperAlt: names.length ? `(?:${names.join('|')})` : null,
    multi,
    nxAlt: union,
    taskAlts: union ? [String.raw`[\w:.-]*\b${union}`] : null,
    flags,
    scriptAlt: union,
  };
}

function legacyPatterns(capability) {
  return buildLegacyShapes(legacySpec(capability));
}

// Runs in a fresh context so the time budget can interrupt a regex (the flag runs backtrack exponentially).
function legacyLaneMatches(command, capability) {
  if (typeof command !== 'string' || !command) return false;
  const patterns = legacyPatterns(capability);
  if (patterns.length === 0) return false;
  try {
    return vm.runInNewContext('patterns.some((re) => re.test(command))', { patterns, command }, { timeout: LANE_BUDGET_MS }) === true;
  } catch {
    return true;
  }
}

module.exports = {
  LANE_BUDGET_MS,
  FLAGS,
  TASK_FLAGS,
  RUNNER,
  prefix,
  buildLegacyShapes,
  legacySpec,
  legacyPatterns,
  legacyLaneMatches,
};
