#!/usr/bin/env node
'use strict';

// Upgrade record for a user-scope install. openRecord copies the pre-install bytes of every file the install may
// write; closeRecord stores post-install fingerprints (and deletes the record when nothing changed); rollback restores
// the newest finished record and leaves alone any file edited since. Paths are absolute. homeDir is a parameter so
// tests run against a temp home.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refusalOf } = require('../get-shit-done/bin/project-deploy-guard.js');
const { detectSession } = require('../get-shit-done/bin/project-deploy-session.js');

const RECORD_FILE = 'record.json';
const PRE_DIR = 'pre';
const KEEP_RECORDS = 5;
const SCOPE_DIRS = ['get-shit-done', 'commands', 'command', 'agents', 'hooks', 'gsd-local-patches', 'skills'];
const SCOPE_FILES = ['settings.json', 'settings.local.json', 'gsd-file-manifest.json', 'gsd-source-path.txt'];
const OWNED_FILES = ['settings.json', 'gsd-file-manifest.json', 'gsd-source-path.txt'];
const SKIPPED_DIRS = new Set(['node_modules']);
const CLOSING_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

// Hook dependencies sit beside the skill files but are not recorded (SKIPPED_DIRS). The marker lists the targets that had them.
const depsOf = (targetDir) => path.join(targetDir, 'get-shit-done', 'node_modules');
const depsPrevOf = (targetDir) => path.join(targetDir, 'get-shit-done.prev', 'node_modules');
const upgradesRootOf = (homeDir) => path.join(homeDir, '.gsd', 'upgrades');
const preImageOf = (recordDir, file) => path.join(recordDir, PRE_DIR, file);
const recordFileOf = (recordDir) => path.join(recordDir, RECORD_FILE);
const readRecord = (recordDir) => JSON.parse(fs.readFileSync(recordFileOf(recordDir), 'utf8'));
const writeRecord = (recordDir, record) => fs.writeFileSync(recordFileOf(recordDir), JSON.stringify(record, null, 2) + '\n');
const uniq = (list) => [...new Set(list)];
const stampOf = (now) => now.toISOString().replace(/[:.]/g, '-');
const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');

function lstatOrNull(file) {
  try {
    return fs.lstatSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// A symlink is fingerprinted by its target, so a link replaced by a file (or retargeted) counts as edited.
function fingerprintOf(file) {
  const st = lstatOrNull(file);
  if (st === null) return null;
  return st.isSymbolicLink() ? sha256(`symlink:${fs.readlinkSync(file)}`) : sha256(fs.readFileSync(file));
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : listFiles(full);
    return entry.isFile() || entry.isSymbolicLink() ? [full] : [];
  });
}

function scopeOf(targetDir) {
  return [
    ...SCOPE_DIRS.flatMap((dir) => listFiles(path.join(targetDir, dir))),
    ...SCOPE_FILES.map((file) => path.join(targetDir, file)),
  ];
}

// Files one install writes under a target, mirrored from the package. closeRecord treats a file as created by the
// install only when it is listed here, so a foreign file that appears during the install is never rolled back.
function ownedFilesOf(targetDir, pkgRoot) {
  const mirrored = (from, to) => listFiles(path.join(pkgRoot, from))
    .map((file) => path.join(targetDir, to, path.relative(path.join(pkgRoot, from), file)));
  return [
    ...mirrored('get-shit-done', 'get-shit-done'),
    ...mirrored(path.join('commands', 'gsd'), path.join('commands', 'gsd')),
    ...mirrored('agents', 'agents'),
    ...mirrored(path.join('hooks', 'dist'), 'hooks'),
    ...OWNED_FILES.map((file) => path.join(targetDir, file)),
  ];
}

// Copies a file, or recreates a symlink as a symlink; never writes through an existing link at `to`.
function copyEntry(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.rmSync(to, { force: true });
  if (fs.lstatSync(from).isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
  else fs.copyFileSync(from, to);
}

function backupEntry(recordDir, file) {
  const pre = fingerprintOf(file);
  if (pre !== null) copyEntry(file, preImageOf(recordDir, file));
  return { path: file, pre_sha256: pre, post_sha256: null };
}

// Keeps the newest KEEP_RECORDS records (UTC stamps sort by time) and always keeps `keepDir`.
function pruneRecords(root, keepDir) {
  const older = fs.readdirSync(root)
    .filter((name) => path.join(root, name) !== keepDir)
    .sort()
    .reverse()
    .slice(KEEP_RECORDS - 1);
  for (const name of older) fs.rmSync(path.join(root, name), { recursive: true, force: true });
}

function openRecord({ targetDirs, homeDir = os.homedir(), now = new Date() }) {
  const root = upgradesRootOf(homeDir);
  fs.mkdirSync(root, { recursive: true });
  const recordDir = path.join(root, stampOf(now));
  fs.mkdirSync(recordDir);
  const entries = uniq(targetDirs.flatMap(scopeOf)).map((file) => backupEntry(recordDir, file));
  const deps_before = targetDirs.filter((dir) => fs.existsSync(depsOf(dir)));
  writeRecord(recordDir, { status: 'open', opened: now.toISOString(), targets: targetDirs, deps_before, entries });
  pruneRecords(root, recordDir);
  return recordDir;
}

// Returns the closed record, or { status: 'unchanged' } after deleting it when the install changed no file.
function closeRecord(recordDir, { owned = [] } = {}) {
  if (!fs.existsSync(recordFileOf(recordDir))) return null;
  const record = readRecord(recordDir);
  if (record.status !== 'open') return record;
  const known = new Map(record.entries.map((entry) => [entry.path, entry]));
  const created = new Set(owned);
  const files = uniq([...record.entries.map((entry) => entry.path), ...record.targets.flatMap(scopeOf)]);
  const entries = files
    .map((file) => ({
      path: file,
      pre_sha256: known.has(file) ? known.get(file).pre_sha256 : null,
      post_sha256: fingerprintOf(file),
    }))
    .filter((entry) => entry.pre_sha256 !== null || created.has(entry.path));
  if (entries.every((entry) => entry.pre_sha256 === entry.post_sha256)) {
    fs.rmSync(recordDir, { recursive: true, force: true });
    return { ...record, status: 'unchanged', entries: [] };
  }
  const closed = { ...record, status: 'closed', entries };
  writeRecord(recordDir, closed);
  return closed;
}

// Closes the record on a normal exit and on the signals that end an install. SIGKILL cannot be caught: that record
// stays open and rollback skips it.
function closeOnExit(recordDir, owned, proc = process) {
  const close = () => closeRecord(recordDir, { owned });
  proc.once('exit', close);
  for (const signal of CLOSING_SIGNALS) {
    proc.once(signal, () => {
      close();
      proc.exit(128 + os.constants.signals[signal]);
    });
  }
}

function recordDirsNewestFirst(homeDir) {
  const root = upgradesRootOf(homeDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort().reverse().map((name) => path.join(root, name));
}

// A record without a readable status is an install that died before it finished writing: treated as open.
function statusOf(recordDir) {
  try {
    return readRecord(recordDir).status;
  } catch {
    return 'open';
  }
}

function restoreEntry(recordDir, entry) {
  fs.rmSync(entry.path, { force: true });
  if (entry.pre_sha256 !== null) copyEntry(preImageOf(recordDir, entry.path), entry.path);
}

// An open record has no post fingerprints, so its pre-images cannot tell a file edited since the crash from one the
// install left in place. Rollback therefore uses the newest finished record and skips open ones.
function rollbackNewest({ homeDir = os.homedir() }) {
  const dirs = recordDirsNewestFirst(homeDir);
  if (dirs.length === 0) return { status: 'no-record' };
  const recordDir = dirs.find((dir) => statusOf(dir) !== 'open');
  if (recordDir === undefined) return { status: 'incomplete', recordDir: dirs[0] };
  const record = readRecord(recordDir);
  if (record.status === 'rolled_back') return { status: 'already-rolled-back', recordDir };
  const lostDeps = (record.deps_before ?? []).filter((dir) => !fs.existsSync(depsOf(dir)));
  const unrecoverable = lostDeps.filter((dir) => !fs.existsSync(depsPrevOf(dir)));
  if (unrecoverable.length > 0) return { status: 'deps-missing', recordDir, left: unrecoverable };
  for (const dir of lostDeps) fs.renameSync(depsPrevOf(dir), depsOf(dir));
  const current = record.entries.map((entry) => ({ entry, now: fingerprintOf(entry.path) }));
  const toRestore = current
    .filter(({ entry, now }) => now !== entry.pre_sha256 && now === entry.post_sha256)
    .map(({ entry }) => entry);
  const left = current
    .filter(({ entry, now }) => now !== entry.pre_sha256 && now !== entry.post_sha256)
    .map(({ entry }) => entry.path);
  for (const entry of toRestore) restoreEntry(recordDir, entry);
  if (left.length === 0) writeRecord(recordDir, { ...record, status: 'rolled_back' });
  return {
    status: left.length === 0 ? 'rolled-back' : 'partial',
    recordDir,
    restored: toRestore.map((entry) => entry.path),
    left,
  };
}

function rollbackWithGuard({ homeDir = os.homedir(), env = process.env, session }) {
  const refusal = refusalOf({ command: 'rollback', guarded: [upgradesRootOf(homeDir)], env, session });
  return refusal ? { status: 'refused', refusal } : rollbackNewest({ homeDir });
}

const OK_STATUSES = new Set(['rolled-back', 'already-rolled-back']);
const SUMMARY = {
  'rolled-back': (r) => `rolled back ${r.recordDir}: ${r.restored.length} file(s) restored`,
  'already-rolled-back': (r) => `${r.recordDir} was already rolled back; nothing changed`,
  'no-record': () => 'no upgrade record under ~/.gsd/upgrades; nothing to roll back',
  incomplete: (r) => `${r.recordDir} never closed (install did not finish); nothing changed`,
  partial: (r) => `restored ${r.restored.length}; left alone, edited since the install: ${r.left.join(', ')}`,
  'deps-missing': (r) => `node_modules missing and no .prev copy to restore under: ${r.left.join(', ')}; nothing changed`,
  refused: (r) => `refused: ${r.refusal.reason} (${r.refusal.failed.join(', ')})`,
};

module.exports = { openRecord, closeRecord, closeOnExit, ownedFilesOf, rollbackNewest, rollbackWithGuard };

if (require.main === module) {
  const result = rollbackWithGuard({ env: process.env, session: detectSession() });
  console.log(SUMMARY[result.status](result));
  process.exit(OK_STATUSES.has(result.status) ? 0 : 1);
}
