// style-gate scan: the pure, per-file layer. No process state; every function takes text and returns data.
// One comment stripper serves every extraction (the view is comment-free and string-content-free, newlines and offsets
// preserved, so a line number in the view is the line number in the file).
// Stated limits: a regular-expression literal holding a quote or `//` can confuse the stripper; a single-quote
// character that is not a string start (a lifetime in Rust) blanks the rest of its line; an unterminated block comment
// swallows the rest of the file.
import { inputMutations } from './input-mutation.mjs';

const EDGE_TAG = /style-gate:edge[ \t]+(?!\*\/)\S/;
const IGNORE_TAG = /style-gate:ignore[ \t]+(?!\*\/)\S/;
const ROUTE_IF = /\b(?:else\s+)?if\s*\(/;
const ROUTE_SWITCH = /\bswitch\s*\(/;

/** 'hash' for languages whose line comment is #, else 'slash'. */
export const commentStyleFor = (relPath) => (/\.(?:py|rb|sh|pl)$/.test(relPath) ? 'hash' : 'slash');

const blank = (s) => s.replace(/[^\n]/g, ' ');

/** Pure: text with comments and string contents replaced by spaces (delimiters kept, newlines kept); keepStrings keeps contents. */
export function stripComments(text, style = 'slash', keepStrings = false) {
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    if (style === 'slash' && two === '//') { const e = text.indexOf('\n', i); const end = e === -1 ? n : e; out.push(blank(text.slice(i, end))); i = end; continue; }
    if (style === 'slash' && two === '/*') { const e = text.indexOf('*/', i + 2); const end = e === -1 ? n : e + 2; out.push(blank(text.slice(i, end))); i = end; continue; }
    if (style === 'hash' && c === '#') { const e = text.indexOf('\n', i); const end = e === -1 ? n : e; out.push(blank(text.slice(i, end))); i = end; continue; }
    if (style === 'hash' && (text.startsWith("'''", i) || text.startsWith('"""', i))) {
      const q = text.slice(i, i + 3);
      const e = text.indexOf(q, i + 3);
      const closed = e !== -1;
      out.push(q, blank(text.slice(i + 3, closed ? e : n)), closed ? q : '');
      i = closed ? e + 3 : n;
      continue;
    }
    if (c === '"' || c === "'" || (c === '`' && style === 'slash')) {
      let j = i + 1;
      while (j < n && text[j] !== c && !(text[j] === '\n' && c !== '`')) j += text[j] === '\\' ? 2 : 1;
      const closed = j < n && text[j] === c;
      const body = text.slice(i + 1, Math.min(j, n));
      out.push(c, keepStrings ? body : blank(body), closed ? c : '');
      i = closed ? j + 1 : Math.min(j, n);
      continue;
    }
    out.push(c);
    i += 1;
  }
  return out.join('');
}

/** Pure: glob to anchored RegExp. `**` crosses `/`, `**` + `/` may match nothing, `*` stays inside a segment. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const matchesAnyGlob = (relPath, globs) => globs.some((g) => globToRegExp(g).test(relPath));

/** Pure: a file is an edge when an edge glob matches or the raw text carries `style-gate:edge <reason>`. */
export const isEdge = (relPath, rawText, edgeGlobs) => matchesAnyGlob(relPath, edgeGlobs) || EDGE_TAG.test(rawText);

/** Pure: true when the line, or the one before it, carries `style-gate:ignore <reason>` (raw text). */
export const isIgnored = (rawLines, line) => IGNORE_TAG.test(rawLines[line - 1] ?? '') || IGNORE_TAG.test(rawLines[line - 2] ?? '');

/** Pure: physical line count; a trailing newline does not start a line. */
export const countLines = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

function routerViolation(lines, threshold) {
  let ifs = 0;
  let first = 0;
  let switchLine = 0;
  lines.forEach((l, i) => {
    if (ROUTE_IF.test(l) && /\bmethod\b/.test(l) && /\b(?:pathname|path|route|url)\b/.test(l)) { ifs += 1; if (first === 0) first = i + 1; }
    if (ROUTE_SWITCH.test(l) && /\b(?:pathname|method|route)\b/.test(l) && switchLine === 0) switchLine = i + 1;
  });
  if (ifs < threshold && switchLine === 0) return [];
  return [{ line: ifs >= threshold ? first : switchLine, rule: 'ifElseRouters', message: 'request dispatch by an if/else or switch chain; use a match or a table', lineLevel: false }];
}

/**
 * Pure: every violation of one file as { line, rule, message }.
 * ruleSet: { regexRules: [{ id, re, message, edgeExempt }], structural: [id], threshold }.
 * opts: { edgeGlobs, maxLines }.
 */
export function scanText(text, relPath, ruleSet, opts) {
  const stripped = stripComments(text, commentStyleFor(relPath));
  const lines = stripped.split('\n');
  const rawLines = text.split('\n');
  const edge = isEdge(relPath, text, opts.edgeGlobs);
  const found = [];
  for (const rule of ruleSet.regexRules) {
    if (rule.edgeExempt && edge) continue;
    lines.forEach((l, i) => { if (rule.re.test(l)) found.push({ line: i + 1, rule: rule.id, message: rule.message, lineLevel: true }); });
  }
  if (ruleSet.structural.includes('inputMutation')) {
    for (const m of inputMutations(stripped)) found.push({ line: m.line, rule: 'inputMutation', message: m.message, lineLevel: true });
  }
  if (ruleSet.structural.includes('ifElseRouters')) found.push(...routerViolation(lines, ruleSet.threshold));
  const kept = found.filter((v) => !(v.lineLevel && isIgnored(rawLines, v.line)));
  const total = countLines(text);
  if (total > opts.maxLines) kept.push({ line: opts.maxLines + 1, rule: 'oversizeFiles', message: `file has ${total} lines (limit ${opts.maxLines})`, lineLevel: false });
  return kept.map(({ line, rule, message }) => ({ line, rule, message }));
}
