'use strict';

// test-worklist: the machine-made input and the machine-checked return of the test steward (agents/gsd-test-writer.md).
//
//   gsd-tools test-worklist (--phase N | --dir <path>) [--no-run] [--out <file>]
//   gsd-tools verify steward-return (--phase N | --worklist <file>) --file <return.md>
//
// Profile keys (stack.commands): test_file runs once per in-diff file ({file} filled, never a bypass flag).
//   test_timing (optional): one command, run from the project root, that prints per-file durations as JSON, either
//     [{"file": "<path relative to the root>", "seconds": 1.2}, ...] or {"<path>": 1.2, ...}. When defined it replaces the per-file runs.
//   residue_check (optional): prints one integer, the rows or files tests left behind (0 is clean). Run before the timed
//     runs and after each file; a file after which the count rose is in residue.moved.
// --no-run never executes any profile command, so it also skips residue_check.
//
// Duplicate candidates (JS/TS test syntax only; `unsupported` lists the other extensions found): same normalized title,
// identical normalized body (identifiers, numbers and strings replaced), or 4-token-shingle Jaccard >= SIMILARITY.

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { splitRowCells } = require('./md-table.js');

const SIMILARITY = 0.95;
const MIN_BODY_TOKENS = 25;
const SHINGLE = 4;
const JS_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const CODE_EXT = new Set([...JS_EXT, '.py', '.go', '.rs', '.rb', '.java', '.kt', '.dart', '.swift', '.php', '.cs', '.sh']);
const NOT_TEST_DIR = /(^|\/)(fixtures?|helpers?|__snapshots__|mocks?|node_modules)(\/|$)/;
const KEYWORDS = new Set(['const', 'let', 'var', 'function', 'return', 'await', 'async', 'if', 'else', 'for', 'while', 'new', 'throw', 'try', 'catch', 'finally', 'typeof', 'this', 'null', 'undefined', 'of', 'in', 'switch', 'case', 'break', 'continue', 'class']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new', 'else', 'do']);

function isTestFile(rel) {
  if (NOT_TEST_DIR.test(rel) || !CODE_EXT.has(path.extname(rel))) return false;
  const base = path.basename(rel);
  return /\.(test|spec)\.[a-z]+$/.test(base) || /_test\.[a-z]+$/.test(base) || /^test_.+\.py$/.test(base) || /(^|\/)(tests?|__tests__)\//.test(rel);
}

function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const regexAllowed = () => {
    const p = toks[toks.length - 1];
    return !p || (p.t === 'p' && ![')', ']', '}'].includes(p.v)) || (p.t === 'i' && REGEX_AFTER_WORD.has(p.v));
  };
  // Returns the index just past the template literal that starts at `at`; ${ } holes nest strings, templates and braces.
  const skipTemplate = (at) => {
    let j = at + 1;
    while (j < n && src[j] !== '`') {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '\n') line++;
      if (src[j] === '$' && src[j + 1] === '{') {
        let depth = 1;
        j += 2;
        while (j < n && depth > 0) {
          const c = src[j];
          if (c === '`') { j = skipTemplate(j); continue; }
          if (c === '"' || c === "'") { j = skipQuoted(j); continue; }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '\n') line++;
          j++;
        }
        continue;
      }
      j++;
    }
    return j + 1;
  };
  const skipQuoted = (at) => {
    const q = src[at];
    let j = at + 1;
    while (j < n && src[j] !== q && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
    return j + 1;
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    const start = line;
    if (c === '"' || c === "'") { const e = skipQuoted(i); toks.push({ t: 's', v: src.slice(i + 1, e - 1), line: start }); i = e; continue; }
    if (c === '`') { const e = skipTemplate(i); const raw = src.slice(i + 1, e - 1); toks.push({ t: 's', v: raw, dynamic: raw.includes('${'), line: start }); i = e; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < n && /[\w$]/.test(src[j])) j++; toks.push({ t: 'i', v: src.slice(i, j), line: start }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++; toks.push({ t: 'n', v: src.slice(i, j), line: start }); i = j; continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== '\n' && (cls || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      j++;
      while (j < n && /[a-z]/.test(src[j])) j++;
      toks.push({ t: 'r', v: '', line: start });
      i = j;
      continue;
    }
    toks.push({ t: 'p', v: c, line: start });
    i++;
  }
  return toks;
}

function normToken(t) {
  if (t.t === 'i') return t.v === 'true' || t.v === 'false' ? 'N' : KEYWORDS.has(t.v) ? t.v : 'I';
  if (t.t === 'n') return 'N';
  if (t.t === 's') return 'S';
  if (t.t === 'r') return 'R';
  return t.v;
}

// A case is test(...), it(...) or <Namespace>.test(...) with a function or { name } argument (optionally .only/.skip/.todo) with a string title or a { name } object.
function extractCases(src) {
  const toks = tokenize(src);
  const cases = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'i') continue;
    const prev = toks[k - 1];
    let j = k + 1;
    let namespaced = false;
    if (/^[A-Z]/.test(t.v)) {
      if (!(toks[j] && toks[j].v === '.' && toks[j + 1] && toks[j + 1].v === 'test' && toks[j + 2] && toks[j + 2].v === '(')) continue;
      j += 2;
      namespaced = true;
    } else if ((t.v === 'test' || t.v === 'it') && !(prev && prev.v === '.')) {
      while (toks[j] && toks[j].v === '.' && toks[j + 1] && ['only', 'skip', 'todo', 'concurrent', 'serial'].includes(toks[j + 1].v)) j += 2;
    } else continue;
    if (!(toks[j] && toks[j].v === '(' && toks[j].t === 'p')) continue;
    let depth = 0;
    let end = j;
    for (; end < toks.length; end++) {
      if (toks[end].t !== 'p') continue;
      if ('([{'.includes(toks[end].v)) depth++;
      else if (')]}'.includes(toks[end].v) && --depth === 0) break;
    }
    const inner = toks.slice(j + 1, end);
    if (namespaced && !inner.some((x, q) => (x.v === '=' && inner[q + 1] && inner[q + 1].v === '>') || x.v === 'function' || x.v === 'name')) continue;
    let titleIdx = -1;
    if (inner[0] && inner[0].t === 's') titleIdx = 0;
    else if (inner[0] && inner[0].v === '{') {
      const q = inner.findIndex((x, p) => x.t === 'i' && x.v === 'name' && inner[p + 1] && inner[p + 1].v === ':' && inner[p + 2] && inner[p + 2].t === 's');
      if (q >= 0) titleIdx = q + 2;
    }
    const titleTok = titleIdx >= 0 ? inner[titleIdx] : null;
    const title = titleTok && !titleTok.dynamic ? titleTok.v : null;
    cases.push({ title, line: t.line, tokens: inner.filter((_, q) => q !== titleIdx).map(normToken) });
  }
  return cases;
}

const normTitle = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function shingles(tokens) {
  const out = new Set();
  for (let i = 0; i + SHINGLE <= tokens.length; i++) out.add(tokens.slice(i, i + SHINGLE).join(' '));
  return out;
}

function jaccard(a, b) {
  let common = 0;
  for (const s of a) if (b.has(s)) common++;
  return common / (a.size + b.size - common);
}

// files: [{file, in_diff, ext, source}]. A pair is reported when at least one side is in the diff.
function duplicateCandidates(files) {
  const unsupported = [...new Set(files.filter((f) => !JS_EXT.has(f.ext)).map((f) => f.ext))].sort();
  const cases = [];
  for (const f of files.filter((x) => JS_EXT.has(x.ext))) {
    for (const c of extractCases(f.source)) {
      const long = c.tokens.length >= MIN_BODY_TOKENS;
      cases.push({ file: f.file, in_diff: f.in_diff, line: c.line, title: c.title, nt: c.title ? normTitle(c.title) : '', key: c.tokens.join(' '), long, sh: long ? shingles(c.tokens) : null });
    }
  }
  cases.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  // Each case is paired once, with its closest earlier case: a cluster of k look-alikes yields k-1 rows, not k(k-1)/2.
  const found = [];
  for (let j = 1; j < cases.length; j++) {
    const b = cases[j];
    if (!b.long) continue;
    let best = null;
    for (let i = 0; i < j; i++) {
      const a = cases[i];
      if (!a.long || (!a.in_diff && !b.in_diff)) continue;
      const s = a.key === b.key ? 1 : jaccard(a.sh, b.sh);
      const kind = a.key === b.key ? 'same_body' : s >= SIMILARITY ? 'similar_body' : a.nt && a.nt === b.nt && s >= 0.5 ? 'same_title' : null;
      if (kind && (!best || s > best.s)) best = { s, kind, a };
    }
    if (best) found.push({ kind: best.kind, similarity: Math.round(best.s * 100) / 100, a: { file: best.a.file, line: best.a.line, title: best.a.title }, b: { file: b.file, line: b.line, title: b.title } });
  }
  return { unsupported, candidates: found.map((c, i) => ({ id: `D${i + 1}`, ...c })) };
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
}

function walk(dir, root) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    return e.isDirectory() ? (e.name === 'node_modules' || e.name === '.git' ? [] : walk(rel, root)) : [rel];
  });
}

function listFiles({ cwd, base, dir }) {
  if (dir) {
    const rel = path.relative(cwd, path.resolve(cwd, dir)).split(path.sep).join('/') || '.';
    return walk(rel === '.' ? '' : rel, cwd).filter(isTestFile).sort().map((file) => ({ file, in_diff: true }));
  }
  const changed = git(cwd, ['diff', '--name-only', '--diff-filter=ACMR', `${base}..HEAD`, '--', '.', ':!.planning']).filter(isTestFile);
  const set = new Set(changed);
  const dirs = [...new Set(changed.map((f) => path.posix.dirname(f)))];
  const siblings = dirs.flatMap((d) => fs.readdirSync(path.join(cwd, d), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.posix.join(d, e.name)))
    .filter((f) => !set.has(f) && isTestFile(f));
  return [...changed.map((file) => ({ file, in_diff: true })), ...siblings.map((file) => ({ file, in_diff: false }))].sort((a, b) => (a.file < b.file ? -1 : 1));
}

const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
function fillFile(cmd, file) {
  let out = '';
  let inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    if (cmd.startsWith('{file}', i)) { out += inDouble ? file.replace(/[\\$"`]/g, '\\$&') : shellQuote(file); i += 5; continue; }
    if (cmd[i] === '\\') { out += cmd.slice(i, i + 2); i++; continue; }
    if (cmd[i] === '"') inDouble = !inDouble;
    out += cmd[i];
  }
  return out;
}

const sh = (cwd, cmd) => spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const round = (x) => Math.round(x * 100) / 100;
const real = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== 'none';

function readCount(cwd, cmd) {
  const r = sh(cwd, cmd);
  const n = Number.parseInt(String(r.stdout).trim().split('\n').pop(), 10);
  if (r.status !== 0 || !Number.isFinite(n)) throw new Error(`residue_check must exit 0 and print an integer (rc ${r.status}, output "${String(r.stdout).trim().slice(0, 80)}")`);
  return n;
}

function timingsFromCommand(cwd, cmd, files) {
  const r = sh(cwd, cmd);
  if (r.status !== 0) throw new Error(`test_timing exited ${r.status}`);
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch { throw new Error('test_timing must print JSON: [{"file","seconds"}] or {"<file>": seconds}'); }
  const rows = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([file, seconds]) => ({ file, seconds }));
  const want = new Set(files);
  return rows.filter((x) => want.has(x.file) && Number.isFinite(x.seconds)).map((x) => ({ file: x.file, seconds: round(x.seconds), rc: 0 }));
}

// opts: { cwd, base | dir, commands, run }. Throws on an unusable profile or git failure.
function buildWorklist(opts) {
  const { cwd, base, dir, commands = {}, run } = opts;
  const files = listFiles({ cwd, base, dir });
  const inDiff = files.filter((f) => f.in_diff).map((f) => f.file);
  const dup = duplicateCandidates(files.map((f) => ({ ...f, ext: path.extname(f.file), source: fs.readFileSync(path.join(cwd, f.file), 'utf8') })));
  const result = { source: dir ? { dir } : { base }, files, duplicate_candidates: dup.candidates, unsupported: dup.unsupported };
  const hasResidue = real(commands.residue_check);
  result.residue = hasResidue ? 'skipped (--no-run)' : 'not configured';
  if (!run) return result;
  if (!real(commands.test_file) && !real(commands.test_timing)) throw new Error('stack.commands.test_file is not configured: cannot measure (use --no-run to skip)');
  let timings;
  const residue = hasResidue ? { before: readCount(cwd, commands.residue_check), after: null, moved: [] } : null;
  if (real(commands.test_timing)) {
    timings = timingsFromCommand(cwd, commands.test_timing, inDiff);
  } else {
    timings = [];
    let last = residue ? residue.before : 0;
    for (const file of inDiff) {
      const t0 = process.hrtime.bigint();
      const r = sh(cwd, fillFile(commands.test_file, file));
      const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
      timings.push(r.status === 0 ? { file, seconds: round(seconds), rc: 0 } : { file, seconds: null, rc: r.status === null ? -1 : r.status });
      if (residue) {
        const now = readCount(cwd, commands.residue_check);
        if (now !== last) residue.moved.push({ file, before: last, after: now });
        last = now;
      }
    }
  }
  if (residue) { residue.after = readCount(cwd, commands.residue_check); result.residue = residue; }
  timings.sort((a, b) => (a.seconds === null) - (b.seconds === null) || (b.seconds || 0) - (a.seconds || 0) || (a.file < b.file ? -1 : 1));
  result.timings = timings;
  return result;
}

const FILE_DISPOSITIONS = ['kept', 'merged', 'deleted', 'sped up', 'cleanup fixed'];
const DUP_DISPOSITIONS = ['merged', 'deleted', 'kept'];
const RESIDUE_DISPOSITIONS = ['cleanup fixed', 'kept'];
const BLANK_REASON = /^(|-|n\/a|na|none|\.+)$/i;

// Tables are told apart by the first header cell: file | dup | residue.
function parseReturn(text) {
  const tables = { file: [], dup: [], residue: [] };
  let current = null;
  let header = null;
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) { current = null; continue; }
    const cells = splitRowCells(t);
    if (!current) {
      const first = (cells[0] || '').toLowerCase();
      if (tables[first]) { current = first; header = cells.map((c) => c.toLowerCase()); }
      else current = '';
      continue;
    }
    if (current === '' || /^[\s:|-]+$/.test(t)) continue;
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] === undefined ? '' : cells[i]; });
    tables[current].push({ key: cells[0], ...row });
  }
  return tables;
}

const isNum = (v) => /^\d+(\.\d+)?$/.test(String(v).trim());

// Returns the list of problems; empty means the return is complete.
function checkReturn(text, worklist) {
  const errors = [];
  const tables = parseReturn(text);
  const timed = Array.isArray(worklist.timings);
  const needFiles = worklist.files.filter((f) => f.in_diff).map((f) => f.file);
  const rowsOf = (list) => new Map(list.map((r) => [r.key, r]));
  const fileRows = rowsOf(tables.file);
  for (const f of needFiles) if (!fileRows.has(f)) errors.push(`missing file row: ${f}`);
  for (const [k, r] of fileRows) {
    if (!needFiles.includes(k)) { errors.push(`unknown file: ${k} (not an in-diff test file of the worklist)`); continue; }
    if (!FILE_DISPOSITIONS.includes(r.disposition)) errors.push(`${k}: disposition "${r.disposition}" is not one of ${FILE_DISPOSITIONS.join(' / ')}`);
    if (BLANK_REASON.test(r.reason || '')) errors.push(`${k}: reason is empty`);
    const touched = r.disposition !== 'kept';
    const before = r.before_s;
    const after = r.after_s;
    const afterOk = isNum(after) || (r.disposition === 'deleted' && String(after).trim() === '-');
    if (timed && touched && !(isNum(before) && afterOk)) errors.push(`${k}: touched file needs numeric before_s and after_s`);
    if (!timed && touched && ((before && before !== '-' && !isNum(before)) || (after && after !== '-' && !isNum(after)))) errors.push(`${k}: before_s and after_s must be numbers or -`);
  }
  const dups = worklist.duplicate_candidates || [];
  const dupRows = rowsOf(tables.dup);
  for (const d of dups) if (!dupRows.has(d.id)) errors.push(`missing duplicate row: ${d.id}`);
  for (const [k, r] of dupRows) {
    if (!dups.some((d) => d.id === k)) { errors.push(`unknown duplicate id: ${k}`); continue; }
    if (!DUP_DISPOSITIONS.includes(r.disposition)) errors.push(`${k}: disposition "${r.disposition}" is not one of ${DUP_DISPOSITIONS.join(' / ')}`);
    if (BLANK_REASON.test(r.reason || '')) errors.push(`${k}: reason is empty`);
  }
  const moved = worklist.residue && typeof worklist.residue === 'object' ? worklist.residue.moved : [];
  const resRows = rowsOf(tables.residue);
  for (const m of moved) if (!resRows.has(m.file)) errors.push(`missing residue row: ${m.file}`);
  for (const [k, r] of resRows) {
    if (!moved.some((m) => m.file === k)) { errors.push(`unknown residue file: ${k}`); continue; }
    if (!RESIDUE_DISPOSITIONS.includes(r.disposition)) errors.push(`${k}: disposition "${r.disposition}" is not one of ${RESIDUE_DISPOSITIONS.join(' / ')}`);
    if (BLANK_REASON.test(r.reason || '')) errors.push(`${k}: reason is empty`);
  }
  return errors;
}

module.exports = { isTestFile, tokenize, extractCases, duplicateCandidates, buildWorklist, parseReturn, checkReturn, SIMILARITY, MIN_BODY_TOKENS };
