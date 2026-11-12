'use strict';

/**
 * Quote-aware command segmenter for the UI-QA lock hook (agnostic-M-02, review round 4).
 *
 * tokenize(command) -> { segments, closed }. Segments are split at ; & | and newline outside quotes. Each
 * $(…), `…`, (…), {…} and ${…} body is its own segment and the outer word gets `_`. Quoted whitespace and
 * operators become `_`; quotes are removed; a backslash escapes the next character. A quoted string in
 * command position (or a quoted argument of -c / eval) is also tokenised as code. Heredoc bodies and
 * word-initial # comments are data. closed is false on an unterminated quote, substitution or heredoc, past
 * MAX_NESTING or MAX_STEPS: the caller fails closed.
 */

const MAX_NESTING = 8;
// Total parser steps per command (every character visited, including re-scans of quoted code). Exhaustion
// reads as unclosed: the caller blocks.
const MAX_STEPS = 200000;
const KEYWORDS = new Set(['then', 'do', 'else']);
const COMMAND_PREFIX = new Set([
  'sudo', 'exec', 'time', 'command', 'nohup', 'eval', 'xargs', 'env', 'timeout', 'gtimeout', 'nice',
  'npx', 'pnpx', 'bunx', 'sh', 'bash', 'zsh', 'dash', 'fish', 'pnpm', 'yarn', 'npm', 'dlx',
]);

const isPrefixWord = (w) => /^-|^\d+[a-z]*$|^[A-Za-z_]\w*=/.test(w) || COMMAND_PREFIX.has(w.split('/').pop());
const asQuoted = (text) => text.replace(/[\s;&|()<>{}`]/g, '_');
// A word after which a quoted argument is code (`bash -c "…"`, `bash -o pipefail -c '…'`, `eval '…'`).
const isCodeFlag = (w) => (/^-[A-Za-z]*$/.test(w) && w.includes('c')) || w === 'eval';
// A quoted word is code at a command position, after a code flag, or glued to one (`-c"…"`).
const codeContext = (word, cmdPos, codeArg) => (cmdPos && (word === '' || word.startsWith('-'))) || (word === '' && codeArg) || isCodeFlag(word);

function parse(src, start, closer, depth, ctx) {
  if (depth > MAX_NESTING) return null;
  const segments = [];
  let words = [];
  let word = '';
  let cmdPos = true;
  let codeArg = false;
  let pendingHeredocs = [];

  const flushSegment = () => {
    flushWord();
    if (words.length > 0) segments.push(words.join(' '));
    words = [];
    cmdPos = true;
    codeArg = false;
  };
  function flushWord() {
    const w = word;
    word = '';
    if (w === '') return;
    if (KEYWORDS.has(w)) return flushSegment();
    if (cmdPos && !isPrefixWord(w)) cmdPos = false;
    codeArg = isCodeFlag(w);
    words.push(w);
  }
  const pushCode = (code) => {
    const sub = parse(code, 0, null, depth + 1, ctx);
    if (!sub) return false;
    for (const s of sub.segments) segments.push(s);
    return true;
  };
  const pushSub = (sub) => {
    for (const s of sub.segments) segments.push(s);
  };

  let i = start;
  while (i < src.length) {
    ctx.steps += 1;
    if (ctx.steps > MAX_STEPS) return null;
    const c = src[i];
    if (closer !== null && c === closer) {
      flushSegment();
      return { end: i + 1, segments };
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      flushWord();
      i += 1;
    } else if (c === '\n' && pendingHeredocs.length > 0) {
      flushSegment();
      const next = skipHeredocBodies(src, i + 1, pendingHeredocs);
      if (next === null) return null;
      pendingHeredocs = [];
      i = next;
    } else if (c === '\n' || c === ';' || c === '&' || c === '|' || c === ')' || c === '}') {
      flushSegment();
      i += 1;
    } else if (c === '\\') {
      if (i + 1 < src.length && src[i + 1] !== '\n') word += asQuoted(src[i + 1]);
      i += i + 1 < src.length ? 2 : 1;
    } else if (c === '$' && src[i + 1] === '"') {
      i += 1;
    } else if (c === "'" || (c === '$' && src[i + 1] === "'")) {
      const ansi = c === '$';
      const q = scanSingle(src, i + (ansi ? 2 : 1), ansi);
      if (!q) return null;
      const atCmd = codeContext(word, cmdPos, codeArg);
      word += asQuoted(q.text);
      if (atCmd && !pushCode(q.text)) return null;
      i = q.end;
    } else if (c === '"') {
      const q = scanDouble(src, i + 1, depth, ctx);
      if (!q) return null;
      const atCmd = codeContext(word, cmdPos, codeArg);
      word += asQuoted(q.text);
      pushSub(q);
      if (atCmd && !pushCode(q.text)) return null;
      i = q.end;
    } else if (c === '`' || c === '(' || c === '{' || (c === '$' && (src[i + 1] === '(' || src[i + 1] === '{'))) {
      const kind = c === '$' ? src[i + 1] : c;
      const close = kind === '{' ? '}' : kind === '`' ? '`' : ')';
      const sub = parse(src, i + (c === '$' ? 2 : 1), close, depth + 1, ctx);
      if (!sub) return null;
      pushSub(sub);
      word += '_';
      i = sub.end;
    } else if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      flushWord();
      const op = readHeredocOp(src, i + 2);
      if (!op) return null;
      pendingHeredocs = [...pendingHeredocs, op.spec];
      i = op.end;
    } else if (c === '#' && word === '' && (i === start || /[\s;&|()]/.test(src[i - 1]))) {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else {
      word += c;
      i += 1;
    }
  }
  if (closer !== null) return null;
  flushSegment();
  return { end: src.length, segments };
}

// The `<<` / `<<-` operator and its delimiter word (quotes removed). Null when the delimiter is missing or unclosed.
function readHeredocOp(src, start) {
  let j = start;
  const strip = src[j] === '-';
  if (strip) j += 1;
  while (src[j] === ' ' || src[j] === '\t') j += 1;
  const quote = src[j];
  if (quote === "'" || quote === '"') {
    const close = src.indexOf(quote, j + 1);
    if (close < 0) return null;
    return { spec: { delim: src.slice(j + 1, close), strip }, end: close + 1 };
  }
  let k = j;
  while (k < src.length && !/[\s;&|()<>]/.test(src[k])) k += 1;
  return k === j ? null : { spec: { delim: src.slice(j, k).replace(/\\/g, ''), strip }, end: k };
}

// Skips the bodies of the heredocs opened on the line just ended, from `start`. Returns the index after the
// last terminator line, or null when a terminator is missing (bash would read to EOF: fail closed).
function skipHeredocBodies(src, start, specs) {
  let j = start;
  for (const { delim, strip } of specs) {
    let terminated = false;
    while (!terminated) {
      if (j >= src.length) return null;
      const eol = src.indexOf('\n', j);
      const line = src.slice(j, eol < 0 ? src.length : eol);
      j = eol < 0 ? src.length : eol + 1;
      terminated = (strip ? line.replace(/^\t+/, '') : line) === delim;
    }
  }
  return j;
}

// Single-quoted text is literal; $'…' (ansi) also honours a backslash escape. Returns { end, text } or null.
function scanSingle(src, start, ansi) {
  let text = '';
  let j = start;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "'") return { end: j + 1, text };
    if (ansi && ch === '\\' && j + 1 < src.length) {
      text += src[j + 1];
      j += 2;
    } else {
      text += ch;
      j += 1;
    }
  }
  return null;
}

// Double-quoted text: \x is x, $(…), ${…} and `…` are substitutions (their bodies are returned as segments).
function scanDouble(src, start, depth, ctx) {
  const segments = [];
  let text = '';
  let j = start;
  while (j < src.length) {
    const ch = src[j];
    ctx.steps += 1;
    if (ctx.steps > MAX_STEPS) return null;
    if (ch === '"') return { end: j + 1, text, segments };
    if (ch === '\\' && j + 1 < src.length) {
      if (src[j + 1] !== '\n') text += src[j + 1];
      j += 2;
    } else if (ch === '$' && (src[j + 1] === '(' || src[j + 1] === '{')) {
      const sub = parse(src, j + 2, src[j + 1] === '(' ? ')' : '}', depth + 1, ctx);
      if (!sub) return null;
      for (const s of sub.segments) segments.push(s);
      text += '_';
      j = sub.end;
    } else if (ch === '`') {
      const sub = parse(src, j + 1, '`', depth + 1, ctx);
      if (!sub) return null;
      for (const s of sub.segments) segments.push(s);
      text += '_';
      j = sub.end;
    } else {
      text += ch;
      j += 1;
    }
  }
  return null;
}

// Each segment is also split at each ` -- ` after a lock wrapper (stacked wrappers each take one `--`).
// A loop, not recursion: a deep chain must not overflow the stack (the hook fails open on a throw).
function commandSegments(command, lockWrappers) {
  const r = parse(command, 0, null, 0, { steps: 0 });
  if (!r) return { segments: [], closed: false };
  const names = lockWrappers.map((n) => n.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')).join('|');
  if (!names) return { segments: r.segments, closed: true };
  const afterWrapper = new RegExp(`^(.*?(?:${names})\\b.*?)\\s--\\s(.*)$`);
  const split = (s) => {
    const parts = [];
    let rest = s;
    for (let m = rest.match(afterWrapper); m; m = rest.match(afterWrapper)) {
      parts.push(m[1]);
      rest = m[2];
    }
    return [...parts, rest];
  };
  return { segments: r.segments.flatMap(split), closed: true };
}

module.exports = { commandSegments };
