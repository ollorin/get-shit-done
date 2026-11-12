'use strict';

/**
 * Reset-literal matcher for the UI-QA lock hook (agnostic-M-02, review round 5, ruling A).
 *
 * A command matches a literal when ANY lane matches (union): the raw lane (761e757, no quote handling, heredoc
 * bodies can be code), the tokenizer lane (ui-qa-shell.js, quotes removed, substitution bodies and data skipped),
 * and last the frozen hook's five shapes (ui-qa-legacy-lane.js, round 6). The whole match runs under MATCH_BUDGET_MS.
 */

const { runInNewContext } = require('vm');
const { commandSegments } = require('./ui-qa-shell.js');
const { legacyLaneMatches } = require('./ui-qa-legacy-lane.js');

const INPUT_CAP = 8 * 1024;
const TASK_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'deno', 'nx']);
const SEGMENT_SPLIT = /[;&|\n(`{]|\$\(|\b(?:then|do|else)\s|-c\s+["']|(?:^|\s)-[a-z]*c\s*["'$]|eval\s+["']/;
// `-[\w-]+` accepts exactly the language of `-{1,2}[\w-]+` (a second dash is itself in [\w-]); the old form had two parses
// per dash run, so a run of N flags backtracked 2^N ways (round 7).
const FLAGS = String.raw`(?:-[\w-]+(?:=\S+)?\s+)*`;
// Wrapper commands that may stand in front of the reset command (run, env, timeout, npx, shell -c, ...).
const WRAPPER = new RegExp(String.raw`^(?:(?:\S*/)?(?:npx|pnpx|bunx|sudo|exec|time|command|nohup|eval|xargs|(?:ba|z)?sh)\s+${FLAGS}|(?:\S*/)?g?timeout\s+${FLAGS}\d+[smhd]?\s+|(?:\S*/)?nice\s+(?:-n\s*)?(?:-?\d+\s+)?|(?:pnpm|yarn|npm)\s+(?:exec\s+|dlx\s+)?${FLAGS}|(?:\S*/)?env\s+${FLAGS}(?:\w+=\S*\s+)*|\w+=\S*\s+)`);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
const baseName = (w) => w.replace(/@\S*$/, '');
const isCmd = (w, name) => baseName(w) === name || baseName(w).endsWith(`/${name}`);
const tailHasSequence = (tail, tokens) => new RegExp(`(?:^|\\s)${escapeRe(tokens.join(' ')).replace(/ /g, '\\s+')}(?![A-Za-z0-9_])`).test(tail);
const tailHasWord = (tail, word) => new RegExp(`(?:^|\\s)(?:["'\\\\]*[\\w:.-]*[^A-Za-z0-9\\s/])?${escapeRe(word)}(?![A-Za-z0-9_])`).test(tail);

// Legacy lane: the raw command split at command boundaries, and at each ` -- ` after a lock wrapper (stacked
// wrappers each take one `--`). A loop, not recursion: a deep chain must not overflow the stack.
function legacySegments(command, lockWrappers) {
  const segments = command.split(SEGMENT_SPLIT);
  const names = lockWrappers.map(escapeRe).join('|');
  if (!names) return segments;
  const afterWrapper = new RegExp(`^(.*?(?:${names})\\b.*?)\\s--\\s(.*)$`);
  const splitAfterWrappers = (s) => {
    const parts = [];
    let rest = s;
    for (let m = rest.match(afterWrapper); m; m = rest.match(afterWrapper)) {
      parts.push(m[1]);
      rest = m[2];
    }
    return [...parts, rest];
  };
  return segments.flatMap(splitAfterWrappers);
}

// The segment itself, then the segment after each leading wrapper is stripped. Past MAX_WRAPPERS stacked
// wrappers the segment is not inspected further and counts as a match (fail closed).
const MAX_WRAPPERS = 200;
function segmentMatches(segment, tokens) {
  let rest = segment.trimStart();
  for (let i = 0; rest; i += 1) {
    if (matchesCandidate(rest, tokens)) return true;
    const m = rest.match(WRAPPER);
    if (!m) return false;
    if (i === MAX_WRAPPERS) return true;
    rest = rest.slice(m[0].length).trimStart();
  }
  return false;
}

// A quote, paren, brace, backtick or trailing backslash glued to the command word (`bash -c "x"`, `$(x)`, `"x"`) is not part of its name.
function matchesCandidate(candidate, tokens) {
  const [head, ...words] = candidate.split(/\s+/);
  const first = head.replace(/^["'`]+/, '').replace(/["')}`\\]+$/, '');
  const tail = words.join(' ');
  if (isCmd(first, tokens[0])) return tokens.length === 1 || tailHasSequence(tail, tokens.slice(1));
  return tokens.length === 1 && TASK_RUNNERS.has(baseName(first).split('/').pop()) && tailHasWord(tail, tokens[0]);
}

// A literal is a token sequence, matched at a command start (any position in its segment after wrappers).
// A single `--flag` literal matches as a whole word anywhere. Quoted data (echo, git commit -m) is not a command.
// An unterminated quote or substitution cannot be segmented reliably, so it matches (fails closed).
function matchUnbounded(command, { resetPatterns, lockWrappers }) {
  if (typeof command !== 'string' || !command) return false;
  // Over the input cap nothing is parsed: the command blocks (fail closed), whatever it says.
  if (Buffer.byteLength(command, 'utf8') > INPUT_CAP) return resetPatterns.length > 0;
  const { segments, closed } = commandSegments(command, lockWrappers);
  const legacy = legacySegments(command, lockWrappers);
  return resetPatterns.some((literal) => {
    const tokens = literal.trim().split(/\s+/);
    if (!closed) return true;
    if (tokens.length === 1 && tokens[0].startsWith('--')) {
      const flag = new RegExp(`(?:^|\\s)${escapeRe(tokens[0])}\\b`);
      return flag.test(command) || segments.some((segment) => flag.test(segment));
    }
    if (legacy.some((segment) => segmentMatches(segment, tokens))) return true;
    return segments.some((segment) => segmentMatches(segment, tokens));
  }) || legacyLaneMatches(command, { resetPatterns, lockWrappers });
}

// One shared deadline over every lane (tokenizer, segment regexes, wrappers, legacy shapes). The installer wraps the hook in
// `timeout 10s` (bin/install.js wrapWithTimeout). The Bash path spends up to 2 s in `git rev-parse` (gsd-ui-qa-lock.js
// resolveProjectRoot); 10 - 2 - 2.5 (node startup, stdin, lock reads) = 5.5 s, so 5 s for the matcher. A timeout blocks
// (exit 2): a match that cannot finish cannot be told from a hang, and the host would allow a hung command.
const MATCH_BUDGET_MS = 5000;

function matchesResetPattern(command, capability) {
  try {
    return runInNewContext('match(command, capability)', { match: matchUnbounded, command, capability }, { timeout: MATCH_BUDGET_MS }) === true;
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return true;
    throw e;
  }
}

module.exports = { matchesResetPattern, MATCH_BUDGET_MS, WRAPPER };
