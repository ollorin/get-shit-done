#!/usr/bin/env node
// Assertion-quality lint: a static, phrasing-based lint over the SOURCE TEXT of UI QA scenarios. It flags the five anti-patterns
// .claude/rules/e2e-assertions.md lists (conditional bypass, status-only checks, submit-and-skip, existence-without-value, a bare
// "renders without error" as the sole assertion), a conditional-state phrasing with no seeded fixture, and a floor: every scenario
// needs at least one assertion whose language implies behaviour or a round trip ("after step N", "persists", "re-renders",
// "new value", "state change", "changed from").
//
// HONEST LIMITATION, read before trusting this gate's silence: it reasons about the WORDS an assertion uses, never about whether the
// assertion verifies what it claims. A scenario can satisfy every rule by using the right vocabulary while the check underneath is
// trivial, wrong or unrelated to the prose. This lint makes "write a test that always passes" harder: a FLOOR, not a proof. A clean
// run is evidence only that the assertions are not one of the known-cheap shapes; mutation drills back it up.
//
// Scenario shape read: a source file holding `steps: \`...\`` (a string or template literal) and `assertions: [ "...", ... ]`
// (an array of string literals), and optionally a `prepare:` block (the seeded-fixture detector).
// The scan root is stack.paths.e2e_scenarios of .planning/config.json (unset: "no e2e scenarios path (stack.paths.e2e_scenarios)",
// exit 0). Scenario files are *.ts, *.mts, *.js, *.mjs; files starting with `_` and index files are helpers, not scenarios.
// Usage: node scripts/validation/check-assertion-quality.mjs [--scenarios-dir <dir>] [--file <scenario>] [--json]
// Exit: 0 clean, 1 one or more issues, 2 unreadable input (a missing dir, file or config is never read as "no issues").
import fs from 'node:fs';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCENARIO_EXT = /\.(?:ts|mts|js|mjs)$/;
const INDEX_FILE = /^index\.(?:ts|mts|js|mjs)$/;
const EXCLUDED_DIRS = new Set(['node_modules', '.git']);

// ── Scanning primitives (quote-aware, so a bracket or slash inside a string literal is not code) ──

// Index just past the closing quote of the string literal starting at source[start], honouring backslash escapes.
export function skipStringLiteral(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

const REGEX_PREFIX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|await|yield)$/;

// Index just past the closing `/` of the regex literal at source[start], or -1 when it is a division, a comment opener or unterminated.
export function skipRegexLiteral(source, start) {
  if (source[start] !== '/' || source[start + 1] === '/' || source[start + 1] === '*') return -1;
  let p = start - 1;
  while (p >= 0 && /\s/.test(source[p])) p -= 1;
  if (p >= 0 && /[\w$)\]"'`]/.test(source[p]) && !REGEX_PREFIX_KEYWORDS.test(source.slice(Math.max(0, p - 8), p + 1))) return -1;
  let k = start + 1;
  let inClass = false;
  while (k < source.length && source[k] !== '\n') {
    if (source[k] === '\\') k += 1;
    else if (source[k] === '[') inClass = true;
    else if (source[k] === ']') inClass = false;
    else if (source[k] === '/' && !inClass) return k + 1;
    k += 1;
  }
  return -1;
}

// The source with every line and block comment blanked (offsets and newlines kept). A `//` inside a string is not a comment.
export function stripComments(source) {
  const chars = source.split('');
  const blank = (from, to) => { for (let k = from; k < to && k < chars.length; k += 1) if (chars[k] !== '\n') chars[k] = ' '; };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipStringLiteral(source, i); continue; }
    if (ch === '/') {
      const regexEnd = skipRegexLiteral(source, i);
      if (regexEnd > 0) { i = regexEnd; continue; }
    }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      const end = nl === -1 ? source.length : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

// Index of the `]` matching the `[` at source[openIndex], skipping string literals and line comments; -1 when unterminated.
function findMatchingBracket(source, openIndex) {
  let depth = 1;
  let i = openIndex + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipStringLiteral(source, i); continue; }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
    i += 1;
  }
  return depth === 0 ? i - 1 : -1;
}

// The contents of the first `fieldName: [ ... ]` array literal, or null.
export function extractBracketedField(source, fieldName) {
  const m = new RegExp(`\\b${fieldName}\\s*:\\s*\\[`).exec(source);
  if (!m) return null;
  const openIndex = m.index + m[0].length - 1;
  const closeIndex = findMatchingBracket(source, openIndex);
  return closeIndex === -1 ? null : source.slice(openIndex + 1, closeIndex);
}

// Every quoted string literal in `text`, in order, line comments skipped; escapes kept verbatim.
export function extractQuotedStrings(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      let buf = '';
      while (j < text.length) {
        if (text[j] === '\\') { buf += text[j] + (text[j + 1] ?? ''); j += 2; continue; }
        if (text[j] === ch) { j += 1; break; }
        buf += text[j];
        j += 1;
      }
      out.push(buf);
      i = j;
      continue;
    }
    i += 1;
  }
  return out;
}

// The text of a `fieldName: "..."` / template-literal field, or null.
export function extractTemplateField(source, fieldName) {
  const m = new RegExp(`\\b${fieldName}\\s*:\\s*(["'\`])`).exec(source);
  if (!m) return null;
  const quoteIndex = m.index + m[0].length - 1;
  const end = skipStringLiteral(source, quoteIndex);
  return { text: source.slice(quoteIndex + 1, Math.max(quoteIndex + 1, end - 1)), index: quoteIndex + 1 };
}

// The assertions of a scenario source: the string literals of its `assertions: [...]` array (comments stripped first, so a comment
// that mentions the field cannot shadow the real declaration).
export function parseAssertions(source) {
  const raw = extractBracketedField(stripComments(source), 'assertions');
  return raw ? extractQuotedStrings(raw) : [];
}

// ── Pure detectors, one per forbidden pattern ──

const CONDITIONAL_BYPASS_RE = /\bIF(?:\s+NOT)?\b[^\n]{0,100}\b(present|is visible)\b/i;
// Flags "IF X is present: verify..." phrasing. A genuinely non-deterministic UI state may legitimately use conditional prose; this
// lint flags the SHAPE and a human triages the intent.
export const detectConditionalBypass = (stepsText) => CONDITIONAL_BYPASS_RE.test(stepsText);

const CONDITIONAL_STATE_RE = /\b[Ss]tate\s+[AB]\b|\beither\s+state\b|\bexactly\s+one\s+(?:of\s+the\s+)?states?\b/;
const CONDITIONAL_RENDER_RE = /\bwhen\b[^\n]{0,60}\brendered\b|\b(?:is|are)\s+rendered\b/i;
const FIXTURE_CALL_RE = /\b(?:provisionAccount|seed[A-Z]\w*|create[A-Z]\w*|credit[A-Z]\w*|play[A-Z]\w*|refresh[A-Z]\w*|prime[A-Z]\w*|decline[A-Z]\w*|expire[A-Z]\w*)\s*\(/;

// The `prepare:` body of a scenario source, or "".
export function prepareBlock(source) {
  const start = source.search(/\bprepare\s*:/);
  if (start < 0) return '';
  const rest = source.slice(start);
  const end = rest.search(/\b(?:teardown|toScenarioData)\s*:/);
  return end < 0 ? rest : rest.slice(0, end);
}

export const hasPairedFixture = (source) => FIXTURE_CALL_RE.test(prepareBlock(source));

// State A/B or "when rendered" phrasing with no fixture seeded in prepare(). With a seeded fixture the state is deterministic.
export const detectConditionalStatePhrasing = (texts, source) =>
  !hasPairedFixture(source) && texts.some((t) => CONDITIONAL_STATE_RE.test(t) || CONDITIONAL_RENDER_RE.test(t));

const STATUS_VOCAB_RE = /\b(loaded|is visible|renders|present|active)\b/i;
const SPECIFIC_ASSERTION_RE = /textContent|toMatch|match(?:es)?\s*\/|toContain|not\.?(?:to)?contain|NaN|undefined|\d/i;

// Every assertion is status/visibility language and none is more specific (a value comparison, numeric pattern or "not contain").
export function detectStatusOnlyAssertions(assertions) {
  if (assertions.length === 0) return false;
  if (assertions.some((a) => SPECIFIC_ASSERTION_RE.test(a))) return false;
  return assertions.every((a) => STATUS_VOCAB_RE.test(a));
}

// Steps click Cancel and never mention Submit or Save: the form was never tested.
export const detectSubmitAndSkip = (stepsText) => /\bcancel\b/i.test(stepsText) && !/\b(submit|save)\b/i.test(stepsText);

const EXISTENCE_ONLY_RE = /toBeInTheDocument\(\)|(?:^|\s)is visible$/i;
const VALUE_PATTERN_RE = /textContent|not\.?(?:to)?contain|match(?:es)?\s*\/|NaN|undefined/i;

// Every assertion checks existence or visibility only and none checks an actual value.
export function detectExistenceWithoutValue(assertions) {
  if (assertions.length === 0) return false;
  return assertions.every((a) => EXISTENCE_ONLY_RE.test(a)) && !assertions.some((a) => VALUE_PATTERN_RE.test(a));
}

// The scenario's ENTIRE claim is one bare "renders without error"; the same phrase as one of several assertions is not flagged.
export const detectRendersWithoutError = (assertions) => assertions.length === 1 && /renders?\s+without\s+error/i.test(assertions[0]);

// Up to 3 words between "after" and its trigger term ("after page reload", "after the save completes").
const TIER_3_PLUS_RE = /after\s+(?:\S+\s+){0,3}(step\s*\d+|sav(?:e|ing)|submit(?:ting)?|reload)|persists?|re-?renders?|new value|state change|changed from/i;

// At least one assertion implies behaviour or a round trip: the required floor.
export const hasTier3PlusAssertion = (assertions) => assertions.some((a) => TIER_3_PLUS_RE.test(a));

// ── Evaluation ──

export function evaluateScenarioAssertionQuality(scenarioId, source) {
  const assertions = parseAssertions(source);
  const stepsText = extractTemplateField(source, 'steps')?.text ?? '';
  const issue = (kind, detail) => ({ scenarioId, kind, detail });
  return [
    ...(detectConditionalBypass(stepsText) || assertions.some(detectConditionalBypass)
      ? [issue('conditional-bypass', 'steps or assertions use conditional-bypass phrasing ("IF ... present/is visible")')] : []),
    ...(detectConditionalStatePhrasing([stepsText, ...assertions], source)
      ? [issue('conditional-state', 'steps or assertions branch on "state A/B" or "when/is rendered" with no seeded fixture in prepare()')] : []),
    ...(detectStatusOnlyAssertions(assertions)
      ? [issue('status-only', 'every assertion is status/visibility language only: nothing says anything about correctness')] : []),
    ...(detectSubmitAndSkip(stepsText)
      ? [issue('submit-and-skip', 'steps click Cancel and never Submit/Save: the form is never actually tested')] : []),
    ...(detectExistenceWithoutValue(assertions)
      ? [issue('existence-without-value', 'every assertion checks existence/visibility only, never an actual value')] : []),
    ...(detectRendersWithoutError(assertions)
      ? [issue('renders-without-error', `sole assertion is a bare "renders without error" claim: "${assertions[0]}"`)] : []),
    ...(!hasTier3PlusAssertion(assertions)
      ? [issue('missing-tier-3-4', 'no assertion implies behaviour/round-trip (after-step outcome, persists, re-renders, new value, state change)')] : []),
  ];
}

export const isWeak = (issues) => issues.length > 0;

export const scenarioIdFromFilePath = (p) => (p.split('/').pop() ?? p).replace(/\.(?:ts|mts|js|mjs)$/, '');

// ── CLI ──

export function parseArgs(args) {
  const opts = { scenariosDir: undefined, file: undefined, json: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--scenarios-dir') { opts.scenariosDir = args[i + 1]; i += 1; } else if (args[i] === '--file') { opts.file = args[i + 1]; i += 1; } else if (args[i] === '--json') opts.json = true;
  }
  return opts;
}

function collectScenarioFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return EXCLUDED_DIRS.has(entry.name) ? [] : collectScenarioFiles(path.join(dir, entry.name), rel);
    if (!SCENARIO_EXT.test(entry.name) || INDEX_FILE.test(entry.name) || entry.name.startsWith('_')) return [];
    return [rel];
  }).sort();
}

function configuredDir() {
  const config = JSON.parse(fs.readFileSync('.planning/config.json', 'utf8'));
  const dir = config?.stack?.paths?.e2e_scenarios;
  return typeof dir === 'string' && dir.length > 0 ? dir : null;
}

function report(issues, count) {
  if (issues.length === 0) return console.log(`[check-assertion-quality] No issues found across ${count} scenario(s).\n`);
  const byScenario = new Map();
  for (const i of issues) byScenario.set(i.scenarioId, [...(byScenario.get(i.scenarioId) ?? []), i]);
  for (const [id, list] of byScenario) {
    console.log(`${id}:`);
    for (const i of list) console.log(`  [${i.kind}] ${i.detail}`);
  }
  return console.log(`\n[check-assertion-quality] FAILED: ${issues.length} issue(s) across ${byScenario.size} of ${count} scenario(s).\n`);
}

function main(argv) {
  const opts = parseArgs(argv);
  try {
    let issues = [];
    let count = 0;
    if (opts.file) {
      issues = evaluateScenarioAssertionQuality(scenarioIdFromFilePath(opts.file), fs.readFileSync(opts.file, 'utf8'));
      count = 1;
    } else {
      const dir = opts.scenariosDir ?? configuredDir();
      if (dir === null) {
        console.log('no e2e scenarios path (stack.paths.e2e_scenarios)');
        return 0;
      }
      const ids = collectScenarioFiles(dir);
      count = ids.length;
      issues = ids.flatMap((rel) => evaluateScenarioAssertionQuality(rel.replace(SCENARIO_EXT, ''), fs.readFileSync(path.join(dir, rel), 'utf8')));
    }
    if (opts.json) console.log(JSON.stringify(issues, null, 2));
    else report(issues, count);
    return isWeak(issues) ? 1 : 0;
  } catch (err) {
    console.error(`[check-assertion-quality] ERROR: could not read input: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
