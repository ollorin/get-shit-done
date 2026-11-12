#!/usr/bin/env node
// adr-reconcile: fails when an ADR referenced in the documentation has no file in the ADR directory.
// Two reference forms are detected, both form-based (any 4-digit number is extracted; existence is the diff's job):
//   prose  "ADR-0010 is the naming convention"   path  "<adr-dir>/0010-naming..." (a link or a comment).
// Scan targets: the docs tree (--docs, default docs) minus the ADR directory (--adr-dir, default docs/adr; self-references cannot
// dangle and a template's placeholder number would be a false positive), .claude/rules, and CLAUDE.md. Absent targets are skipped.
// An ADR file is named NNNN-<slug>.md. Justified false positives: --allow-missing NNNN#reason (repeatable; a reason is required).
// Usage: node scripts/validation/adr-reconcile.mjs [--docs <dir>] [--adr-dir <dir>] [--allow-missing NNNN#reason]
// Exit: 0 every reference has a file (also: no ADR directory and no reference), 1 a missing ADR (also: a reference and no ADR directory)
// or a bad argument.
import fs from 'node:fs';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXTRA_ROOTS = ['.claude/rules'];
const EXTRA_FILES = ['CLAUDE.md'];
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const PROSE_RE = /ADR-(\d{4})\b/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Pure. Every ADR mention of `text`, deduped per number: the first occurrence wins and carries its file:line context.
export function extractAdrMentions(text, sourcePath, adrDir = 'docs/adr') {
  const pathRe = new RegExp(`${escapeRe(adrDir)}/(\\d{4})[-_]`, 'g');
  const found = [];
  for (const re of [PROSE_RE, pathRe]) {
    for (const m of text.matchAll(re)) found.push({ index: m.index ?? 0, number: m[1] });
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set();
  const mentions = [];
  for (const { index, number } of found) {
    if (seen.has(number)) continue;
    seen.add(number);
    mentions.push({ number, context: `${sourcePath}:${text.slice(0, index).split('\n').length}` });
  }
  return mentions;
}

// Pure. Mentioned numbers with no file on disk and not allowlisted, ascending. Allowlist entries are "NNNN#reason".
export function findMissingAdrFiles(mentions, adrNumbersOnDisk, allowMissing) {
  const onDisk = new Set(adrNumbersOnDisk);
  const allowed = new Set(allowMissing.map((entry) => entry.split('#')[0]));
  return [...new Set(mentions.map((m) => m.number))].filter((n) => !onDisk.has(n) && !allowed.has(n)).sort();
}

export const allowMissingWithReason = (entry, reason) => `${entry}#${reason}`;

function walkMd(root, skip, onFile) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && path.normalize(p) !== path.normalize(skip)) walkMd(p, skip, onFile);
    } else if (entry.isFile() && entry.name.endsWith('.md')) onFile(p);
  }
}

function parseArgs(argv) {
  const opts = { docs: 'docs', adrDir: 'docs/adr', allow: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value` };
    if (flag === '--docs') opts.docs = value;
    else if (flag === '--adr-dir') opts.adrDir = value.replace(/\/+$/, '');
    else if (flag === '--allow-missing') {
      if (!/^\d{4}#\S.*$/.test(value)) return { error: '--allow-missing needs NNNN#reason (a reason is required)' };
      opts.allow.push(value);
    } else return { error: `unknown argument ${flag}` };
  }
  return { opts };
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`adr-reconcile: ${parsed.error}`);
    return 1;
  }
  const { docs, adrDir, allow } = parsed.opts;
  const mentions = [];
  let scanned = 0;
  const readFile = (p) => {
    scanned += 1;
    mentions.push(...extractAdrMentions(fs.readFileSync(p, 'utf8'), p, adrDir));
  };
  walkMd(docs, adrDir, readFile);
  for (const root of EXTRA_ROOTS) walkMd(root, adrDir, readFile);
  for (const file of EXTRA_FILES) if (fs.existsSync(file)) readFile(file);

  const adrDirExists = fs.existsSync(adrDir) && fs.statSync(adrDir).isDirectory();
  const onDisk = adrDirExists
    ? fs.readdirSync(adrDir, { withFileTypes: true }).flatMap((e) => {
      const m = e.isFile() ? e.name.match(/^(\d{4})-.*\.md$/) : null;
      return m ? [m[1]] : [];
    }).sort()
    : [];
  const missing = findMissingAdrFiles(mentions, onDisk, allow);
  console.log(`[adr-reconcile] files scanned: ${scanned}, unique ADR numbers mentioned: ${new Set(mentions.map((m) => m.number)).size}, ADRs on disk: ${onDisk.length}`);
  if (!adrDirExists && mentions.length > 0) console.log(`  ADR directory ${adrDir} does not exist`);
  for (const n of missing) {
    console.log(`  MISSING ADR-${n}: referenced but no ${adrDir}/${n}-*.md on disk: ${mentions.filter((m) => m.number === n).map((m) => m.context).join(', ')}`);
  }
  if (missing.length === 0) console.log('  OK: every ADR referenced in the documentation has a file.');
  return missing.length > 0 ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
