'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIR_REL = path.join('scripts', 'agnostic-lint');

const SCOPES = [
  { id: 'agents', match: (p) => /^agents\/[^/]+\.md$/.test(p) },
  { id: 'commands', match: (p) => p.startsWith('commands/') },
  { id: 'workflows', match: (p) => p.startsWith('get-shit-done/workflows/') },
  { id: 'references', match: (p) => p.startsWith('get-shit-done/references/') },
  { id: 'templates', match: (p) => p.startsWith('get-shit-done/templates/') },
  { id: 'bin', match: (p) => p.startsWith('get-shit-done/bin/') && !p.endsWith('.test.js') },
  { id: 'install', match: (p) => p === 'bin/install.js' },
  { id: 'hook-config', match: (p) => p === 'hook-config.json' },
  { id: 'hooks', match: (p) => /^hooks\/[^/]+\.js$/.test(p) },
  { id: 'skills', match: (p) => p.startsWith('skills/') },
  { id: 'routing', match: (p) => p === 'routing-rules.md' },
  { id: 'config', match: (p) => /^get-shit-done\/config\/[^/]+\.json$/.test(p) },
];

const scopeOf = (p) => (SCOPES.find((s) => s.match(p)) || { id: null }).id;
const skipped = (p) => p.split('/').some((seg) => seg === 'node_modules' || seg.startsWith('.'));
const isFile = (f) => {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
};

function walk(root, rel) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!e.isDirectory()) return [r];
    return skipped(r) ? [] : walk(root, r);
  });
}

function candidates(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return walk(root, '');
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0');
}

function listScopeFiles(root) {
  const out = Object.fromEntries(SCOPES.map((s) => [s.id, []]));
  for (const p of candidates(root)) {
    const scope = p && !skipped(p) && scopeOf(p);
    if (scope && isFile(path.join(root, p))) out[scope].push(p);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

function compileRe(file, pattern, flags) {
  if (/[gy]/.test(flags || '')) throw new Error(`agnostic-lint: bad flags in ${file}: g and y are stateful and not allowed`);
  try {
    return new RegExp(pattern, flags || '');
  } catch (e) {
    throw new Error(`agnostic-lint: bad pattern in ${file}: ${e.message}`);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`agnostic-lint: cannot read ${file}: ${e.message}`);
  }
}

function loadTerms(file) {
  const doc = readJson(file);
  if (!Array.isArray(doc.classes)) throw new Error(`agnostic-lint: ${file} has no classes array`);
  return doc.classes.map((c) => ({ id: c.id, label: c.label, re: compileRe(file, c.pattern, c.flags) }));
}

function loadAllowlist(file) {
  const doc = readJson(file);
  if (!Array.isArray(doc.entries)) throw new Error(`agnostic-lint: ${file} has no entries array`);
  return doc.entries;
}

function countLines(text, classes) {
  const out = {};
  for (const line of text.split('\n')) {
    for (const c of classes) if (c.re.test(line)) out[c.id] = (out[c.id] || 0) + 1;
  }
  return out;
}

const sortObj = (o) =>
  Object.fromEntries(Object.keys(o).sort().map((k) => [k, Object.fromEntries(Object.keys(o[k]).sort().map((c) => [c, o[k][c]]))]));

function put(obj, file, cls, n) {
  if (n > 0) obj[file] = { ...(obj[file] || {}), [cls]: n };
}

function scan(root, terms, allowlist) {
  const files = listScopeFiles(root);
  const caps = new Map(allowlist.map((e) => [`${e.file}\0${e.class}`, e.max]));
  const denied = {};
  const allowed = {};
  for (const s of SCOPES) {
    for (const rel of files[s.id]) {
      const counts = countLines(fs.readFileSync(path.join(root, rel), 'utf8'), terms);
      for (const [cls, n] of Object.entries(counts)) {
        const a = Math.min(n, caps.get(`${rel}\0${cls}`) || 0);
        put(denied, rel, cls, n - a);
        put(allowed, rel, cls, a);
      }
    }
  }
  return { denied: sortObj(denied), allowed: sortObj(allowed), files };
}

function inputsHash(termsFile, allowlistFile) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(termsFile));
  h.update(fs.readFileSync(allowlistFile));
  return h.digest('hex');
}

function flatten(byFile) {
  const out = {};
  for (const [file, byCls] of Object.entries(byFile)) {
    for (const [cls, n] of Object.entries(byCls)) out[`${file}\0${cls}`] = n;
  }
  return out;
}

function compare(current, baseline) {
  const rises = [];
  const drops = [];
  for (const kind of ['denied', 'allowed']) {
    const cur = flatten(current[kind] || {});
    const base = flatten(baseline[kind] || {});
    for (const k of [...new Set([...Object.keys(cur), ...Object.keys(base)])].sort()) {
      const [file, cls] = k.split('\0');
      const b = base[k] || 0;
      const c = cur[k] || 0;
      const row = { file, class: cls, kind, baseline: b, current: c };
      if (c > b) rises.push(row);
      else if (c < b) drops.push(row);
    }
  }
  return { rises, drops };
}

function totals(res) {
  const acc = {};
  for (const kind of ['denied', 'allowed']) {
    for (const [file, byCls] of Object.entries(res[kind])) {
      const scope = scopeOf(file);
      for (const [cls, n] of Object.entries(byCls)) {
        acc[cls] = acc[cls] || {};
        const cell = (acc[cls][scope] = acc[cls][scope] || { lines: 0, files: new Set() });
        cell.lines += n;
        cell.files.add(file);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(acc).map(([cls, scopes]) => [
      cls,
      Object.fromEntries(Object.entries(scopes).map(([s, c]) => [s, { lines: c.lines, files: c.files.size }])),
    ]),
  );
}

const sum = (byFile) => Object.values(byFile).reduce((s, byCls) => s + Object.values(byCls).reduce((a, b) => a + b, 0), 0);

function report(res, terms) {
  const t = totals(res);
  const cell = (cls, scope) => (t[cls] && t[cls][scope] ? `${t[cls][scope].lines}/${t[cls][scope].files}` : '0');
  const rows = [['class', ...SCOPES.map((s) => s.id)], ...terms.map((c) => [c.id, ...SCOPES.map((s) => cell(c.id, s.id))])];
  const text = rows.map((r) => r.map((x) => x.padEnd(13)).join(' ').trimEnd()).join('\n');
  return `${text}\ndenied=${sum(res.denied)} allowed=${sum(res.allowed)}\n`;
}

const rise = (r) => `RISE ${r.kind} ${r.file} ${r.class} baseline=${r.baseline} current=${r.current}`;
const stale = (d) =>
  `STALE ${d.kind} ${d.file} ${d.class} baseline=${d.baseline} current=${d.current} (run: node scripts/agnostic-lint.js write-baseline)`;
const HASH_STALE = 'STALE inputs hash (terms.json or allowlist.json changed; run write-baseline)';

const USAGE = 'usage: agnostic-lint.js <check|report|write-baseline> [--root <dir>] [--allow-raise]\n'
  + 'check and write-baseline scan git-tracked files only: git add a new file before it is counted.\n';

function parseFlags(args) {
  const out = { root: null, allowRaise: false, error: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') {
      const dir = args[++i];
      if (dir === undefined || dir.startsWith('--')) return { error: '--root needs a directory' };
      out.root = dir;
    } else if (args[i] === '--allow-raise') out.allowRaise = true;
    else return { error: `unknown flag: ${args[i]}` };
  }
  return out;
}

function writeBaseline(res, files, allowRaise) {
  if (fs.existsSync(files.base)) {
    const { rises } = compare(res, readJson(files.base));
    if (rises.length && !allowRaise) {
      process.stderr.write(rises.map((r) => `${rise(r)}\n`).join(''));
      return 1;
    }
  }
  const doc = { version: 1, inputs_sha256: inputsHash(files.terms, files.allow), denied: res.denied, allowed: res.allowed };
  fs.writeFileSync(files.base, `${JSON.stringify(doc, null, 2)}\n`);
  return 0;
}

function check(res, files) {
  if (!fs.existsSync(files.base)) {
    process.stderr.write('MISSING baseline.json\n');
    return 1;
  }
  const base = readJson(files.base);
  const { rises, drops } = compare(res, base);
  const problems = [...rises.map(rise), ...drops.map(stale)];
  if (base.inputs_sha256 !== inputsHash(files.terms, files.allow)) problems.push(HASH_STALE);
  if (problems.length) {
    process.stderr.write(problems.map((p) => `${p}\n`).join(''));
    return 1;
  }
  process.stdout.write(`agnostic-lint: ok (${sum(res.denied)} denied, ${sum(res.allowed)} allowed)\n`);
  return 0;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!['check', 'report', 'write-baseline'].includes(cmd)) {
    process.stderr.write(USAGE);
    return 2;
  }
  const flags = parseFlags(rest);
  if (flags.error) {
    process.stderr.write(`${flags.error}\n${USAGE}`);
    return 2;
  }
  const root = flags.root ? path.resolve(flags.root) : ROOT;
  const dir = path.join(root, DIR_REL);
  const files = { terms: path.join(dir, 'terms.json'), allow: path.join(dir, 'allowlist.json'), base: path.join(dir, 'baseline.json') };
  try {
    const terms = loadTerms(files.terms);
    const res = scan(root, terms, loadAllowlist(files.allow));
    if (cmd === 'report') {
      process.stdout.write(report(res, terms));
      return 0;
    }
    return cmd === 'write-baseline' ? writeBaseline(res, files, flags.allowRaise) : check(res, files);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
}

module.exports = { SCOPES, listScopeFiles, loadTerms, loadAllowlist, countLines, scan, inputsHash, compare, totals, report, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
