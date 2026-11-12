#!/usr/bin/env node
// guard-registry-reconcile: the registry (guard-registry.mjs) and its one document (docs/gsd/guard-estate.md) must agree.
// Fails on: a registry row with no document row, a table row with the wrong cell count, a document row with no registry row, a differing cell, an
// implementedIn that is not an existing file (a directory fails), a `guard:<id>` reference in the document that names no registry row, a
// missing document, a missing table (an empty table under its heading is the accepted empty-registry state), or a registry that validateRegistry rejects.
// The table sits under the exact heading "## Machine-enforced guards", header row starting "| ID", four cells per row:
// id, guard, prevents, implemented in. Cell text must equal the registry strings exactly.
// Usage: node scripts/validation/guard-registry-reconcile.mjs      Exit: 0 agree, 1 any failure.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARD_REGISTRY, validateRegistry } from './guard-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const DOC_PATH = 'docs/gsd/guard-estate.md';
export const TABLE = { heading: '## Machine-enforced guards', idHeaderPrefix: '| ID', cellCount: 4 };

/** Pure: locates a pipe table by its exact trimmed heading, finds the header row after it, skips the separator row and
 *  reads rows until the first line that does not start with `|`. Rows with the wrong cell count are skipped here (scanTable
 *  lists them; the CLI reports each). [] for a missing heading or header. Row: { id, cells } (cells include the id cell). */
export function parseTableByHeading(markdown, opts) {
  return scanTable(markdown, opts).rows;
}

/** Pure: { found, rows, malformed }. `found` is true when the heading and the header row exist (a table with no data
 *  rows is found and empty); `malformed` lists the table lines whose cell count differs. */
export function scanTable(markdown, opts) {
  const lines = markdown.split('\n');
  const headingIdx = lines.findIndex((l) => l.trim() === opts.heading);
  if (headingIdx === -1) return { found: false, rows: [], malformed: [] };
  const headerIdx = lines.findIndex((l, i) => i > headingIdx && l.trim().startsWith(opts.idHeaderPrefix));
  if (headerIdx === -1) return { found: false, rows: [], malformed: [] };
  const rows = [];
  const malformed = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) break;
    const cells = lines[i].split('|').map((c) => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cells.length !== opts.cellCount) { malformed.push(lines[i].trim()); continue; }
    rows.push({ id: cells[0], cells });
  }
  return { found: true, rows, malformed };
}

/** Pure: the guard table as { id, guard, prevents, implementedIn } rows. The id is kept as written (not lower-cased). */
export function parseGuardTable(markdown) {
  return parseTableByHeading(markdown, TABLE).map((r) => ({ id: r.id, guard: r.cells[1], prevents: r.cells[2], implementedIn: r.cells[3] }));
}

const FIELDS = ['guard', 'prevents', 'implementedIn'];

/** Pure: the registry against the document rows. */
export function reconcile(docRows, registry) {
  const docById = new Map(docRows.map((r) => [r.id, r]));
  const regById = new Map(registry.map((r) => [r.id, r]));
  const phantomDocRows = docRows.filter((r) => !regById.has(r.id)).map((r) => r.id);
  const missingDocRows = registry.filter((r) => !docById.has(r.id)).map((r) => r.id);
  const divergentFields = [];
  for (const reg of registry) {
    const doc = docById.get(reg.id);
    if (!doc) continue;
    for (const field of FIELDS) {
      if (doc[field] !== reg[field]) divergentFields.push({ id: reg.id, field, docValue: doc[field], registryValue: reg[field] });
    }
  }
  return { phantomDocRows, missingDocRows, divergentFields };
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Registry ids whose implementedIn is not an existing file under root (a directory does not count; applies to every id). */
export function missingImplementations(root, registry, exists = isFile) {
  return registry.filter((r) => !exists(path.resolve(root, r.implementedIn))).map((r) => ({ id: r.id, path: r.implementedIn }));
}

export function exitCodeFor(result) {
  const clean = result.phantomDocRows.length === 0 && result.missingDocRows.length === 0 && result.divergentFields.length === 0
    && (result.missingPaths ?? []).length === 0 && (result.phantomReferences ?? []).length === 0;
  return clean ? 0 : 1;
}

/** `guard:<id>` in backticks is the convention for naming a guard in the document. Only backticked tokens count; the id
 *  shape is loose on purpose, so an id that is not in the registry is reported, never skipped. */
const GUARD_REF_RE = /`guard:([a-z0-9][a-z0-9-]*)`/g;

/** Pure: backticked guard references in text, and those the registry does not list. */
export function scanGuardIdReferences(text, registryIds) {
  const referenced = [...new Set([...text.matchAll(GUARD_REF_RE)].map((m) => m[1]))].sort();
  const known = new Set(registryIds);
  return { referenced, phantom: referenced.filter((id) => !known.has(id)) };
}

function report(result, problems) {
  for (const p of problems) console.log(`  ${p}`);
  for (const id of result.missingDocRows) console.log(`  MISSING DOC ROW ${id}: in the registry, not in ${DOC_PATH}`);
  for (const id of result.phantomDocRows) console.log(`  PHANTOM DOC ROW ${id}: in ${DOC_PATH}, not in the registry`);
  for (const d of result.divergentFields) console.log(`  DIVERGENT ${d.id}.${d.field}: doc "${d.docValue}" registry "${d.registryValue}"`);
  for (const m of result.missingPaths) console.log(`  MISSING PATH ${m.id}: ${m.path} does not exist or is not a file`);
  for (const id of result.phantomReferences) console.log(`  PHANTOM REFERENCE guard:${id}: named in ${DOC_PATH}, not in the registry`);
}

function main() {
  const problems = validateRegistry(GUARD_REGISTRY).map((p) => `REGISTRY INVALID: ${p}`);
  const registry = problems.length === 0 ? GUARD_REGISTRY : [];
  const docFile = path.join(ROOT, DOC_PATH);
  let text = null;
  try { text = fs.readFileSync(docFile, 'utf8'); } catch { problems.push(`DOCUMENT MISSING: ${DOC_PATH} cannot be read`); }
  const scan = text === null ? { found: false, rows: [], malformed: [] } : scanTable(text, TABLE);
  const docRows = scan.rows.map((r) => ({ id: r.id, guard: r.cells[1], prevents: r.cells[2], implementedIn: r.cells[3] }));
  for (const line of scan.malformed) problems.push(`MALFORMED DOC ROW: expected ${TABLE.cellCount} cells, got another count: ${line}`);
  if (text !== null && !scan.found) problems.push(`TABLE NOT FOUND: no "${TABLE.heading}" table with header "${TABLE.idHeaderPrefix}" and ${TABLE.cellCount} cells per row in ${DOC_PATH}`);
  const refs = text === null ? { phantom: [] } : scanGuardIdReferences(text, registry.map((r) => r.id));
  const result = {
    ...reconcile(docRows, registry),
    missingPaths: missingImplementations(ROOT, registry),
    phantomReferences: refs.phantom,
  };
  console.log(`[guard-registry-reconcile] ${registry.length} registry row(s), ${docRows.length} document row(s)`);
  report(result, problems);
  const code = problems.length > 0 ? 1 : exitCodeFor(result);
  if (code === 0 && registry.length === 0) console.log(`  OK: nothing registered; the registry and the table in ${DOC_PATH} are both empty.`);
  else if (code === 0) console.log(`  OK: registry and ${DOC_PATH} agree; every implementedIn path is an existing file.`);
  process.exit(code);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
