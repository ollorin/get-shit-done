'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function gitMergeFile(current, base, next, opts = {}) {
  const tmpRoot = opts.tmpRoot ?? os.tmpdir();
  const gitBin = opts.gitBin ?? 'git';
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(tmpRoot, 'gsd-merge-'));
    const currentPath = path.join(dir, 'current');
    const basePath = path.join(dir, 'base');
    const nextPath = path.join(dir, 'next');
    fs.writeFileSync(currentPath, current);
    fs.writeFileSync(basePath, base);
    fs.writeFileSync(nextPath, next);
    const r = spawnSync(gitBin, ['merge-file', '-p', currentPath, basePath, nextPath]);
    if (r.status === 0) return { ok: true, content: r.stdout };
    if (Number.isInteger(r.status) && r.status >= 1 && r.status <= 127) return { ok: false, reason: 'merge conflict' };
    return { ok: false, reason: 'git merge-file failed' };
  } catch {
    return { ok: false, reason: 'git merge-file failed' };
  } finally {
    if (dir !== null) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function planWholeFile({ current, base, manifestHash, next, mergeFn = gitMergeFile }) {
  if (current === null) return { action: 'create', content: next };
  if (current.equals(next)) return { action: 'unchanged' };
  if (manifestHash && sha256(current) === manifestHash) return { action: 'overwrite', content: next };
  if (manifestHash && base) {
    const r = mergeFn(current, base, next);
    if (!r.ok) return { action: 'conflict', reason: r.reason };
    if (r.content.equals(current)) return { action: 'unchanged' };
    return { action: 'merge', content: r.content };
  }
  if (manifestHash) return { action: 'conflict', reason: 'merge base missing' };
  return { action: 'conflict', reason: 'exists and is not managed' };
}

const BEGIN_RE = /^<!-- gsd:begin ([a-z0-9][a-z0-9-]*) -->$/;
const END_RE = /^<!-- gsd:end ([a-z0-9][a-z0-9-]*) -->$/;

function markerOf(line) {
  const l = line.endsWith('\r') ? line.slice(0, -1) : line;
  const b = BEGIN_RE.exec(l);
  if (b) return { kind: 'begin', id: b[1] };
  const e = END_RE.exec(l);
  if (e) return { kind: 'end', id: e[1] };
  return null;
}

function parseBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  const seen = new Set();
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const m = markerOf(lines[i]);
    if (m === null) continue;
    if (m.kind === 'begin') {
      if (open !== null) return { ok: false, reason: `nested begin: ${m.id}` };
      if (seen.has(m.id)) return { ok: false, reason: `duplicate block id: ${m.id}` };
      seen.add(m.id);
      open = { id: m.id, beginLine: i };
    } else {
      if (open === null) return { ok: false, reason: `end without begin: ${m.id}` };
      if (m.id !== open.id) return { ok: false, reason: `mismatched end: ${m.id}` };
      blocks.push({ id: open.id, beginLine: open.beginLine, endLine: i, inner: lines.slice(open.beginLine + 1, i).join('\n') });
      open = null;
    }
  }
  if (open !== null) return { ok: false, reason: `unclosed block: ${open.id}` };
  return { ok: true, blocks };
}

const innerLines = (inner) => (inner === '' ? [] : inner.split('\n'));

// Inner text is compared as whole lines: `asText` adds the final newline git merge-file works on, `fromText` removes it.
const asText = (inner) => (inner === '' ? '' : `${inner}\n`);
const fromText = (text) => text.replace(/\n$/, '');

// base = the block as last deployed (the mirror), ours = the project's block, theirs = the new preset block.
function mergeBlock({ ours, base, theirs, mergeFn }) {
  if (ours === theirs) return { ok: true, inner: ours };
  if (base === undefined) return { ok: false, reason: 'merge base missing' };
  const r = mergeFn(asText(ours), asText(base), asText(theirs));
  return r.ok ? { ok: true, inner: fromText(r.content.toString('utf8')) } : { ok: false, reason: r.reason };
}

// `base` is the mirrored preset file text, or null. A block with no base and a differing project edit is a conflict.
function planBlockFile({ current, next, base = null, mergeFn = gitMergeFile }) {
  const parsedNext = parseBlocks(next);
  if (!parsedNext.ok || parsedNext.blocks.length === 0) {
    return { action: 'error', reason: `preset block file: ${parsedNext.ok ? 'no managed blocks' : parsedNext.reason}` };
  }
  const blocks = Object.fromEntries(parsedNext.blocks.map((b) => [b.id, sha256(Buffer.from(b.inner, 'utf8'))]));
  if (current === null) return { action: 'create', content: next, blocks };

  const parsedCur = parseBlocks(current);
  if (!parsedCur.ok) return { action: 'conflict', reason: `malformed markers: ${parsedCur.reason}`, conflicts: [], blocks };
  const parsedBase = base === null ? { ok: true, blocks: [] } : parseBlocks(base);
  if (!parsedBase.ok) return { action: 'conflict', reason: `merge base malformed: ${parsedBase.reason}`, conflicts: [], blocks };

  const nextInner = new Map(parsedNext.blocks.map((b) => [b.id, b.inner]));
  const baseInner = new Map(parsedBase.blocks.map((b) => [b.id, b.inner]));
  const curIds = new Set(parsedCur.blocks.map((b) => b.id));
  const merged = parsedCur.blocks.filter((b) => nextInner.has(b.id)).map((b) => ({
    block: b,
    result: mergeBlock({ ours: b.inner, base: baseInner.get(b.id), theirs: nextInner.get(b.id), mergeFn }),
  }));
  const conflicts = merged
    .filter((m) => !m.result.ok)
    .map((m) => ({ id: m.block.id, line: m.block.beginLine + 1, reason: m.result.reason }));
  if (conflicts.length > 0) return { action: 'conflict', reason: 'overlapping edit', conflicts, blocks };
  const mergedInner = new Map(merged.map((m) => [m.block.id, m.result.inner]));

  const curLines = current.split('\n');
  const curByBegin = new Map(parsedCur.blocks.map((b) => [b.beginLine, b]));
  const out = [];
  for (let i = 0; i < curLines.length; ) {
    const b = curByBegin.get(i);
    if (b && mergedInner.has(b.id)) {
      out.push(curLines[b.beginLine], ...innerLines(mergedInner.get(b.id)), curLines[b.endLine]);
      i = b.endLine + 1;
    } else {
      out.push(curLines[i]);
      i++;
    }
  }
  let text = out.join('\n');

  const nextLines = next.split('\n');
  for (const b of parsedNext.blocks.filter((nb) => !curIds.has(nb.id))) {
    const prefix = text.endsWith('\n') ? text : `${text}\n`;
    text = `${prefix}\n${[nextLines[b.beginLine], ...innerLines(b.inner), nextLines[b.endLine]].join('\n')}\n`;
  }

  if (text === current) return { action: 'unchanged', blocks };
  return { action: 'update', content: text, blocks };
}

function stripMarkerLines(text) {
  return text
    .split(/(?<=\n)/)
    .filter((piece) => markerOf(piece.endsWith('\n') ? piece.slice(0, -1) : piece) === null)
    .join('');
}

module.exports = { sha256, gitMergeFile, planWholeFile, parseBlocks, planBlockFile, stripMarkerLines };
