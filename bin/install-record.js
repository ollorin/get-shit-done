#!/usr/bin/env node
'use strict';

// Upgrade record for a user-scope install. openRecord copies the pre-install bytes of every file the
// install may write; closeRecord stores the post-install hashes; rollback restores the newest closed
// record and leaves alone any file edited since. Paths are absolute. homeDir is a parameter so tests
// run against a temp home.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refusalOf } = require('../get-shit-done/bin/project-deploy-guard.js');
const { detectSession } = require('../get-shit-done/bin/project-deploy-session.js');

const RECORD_FILE = 'record.json';
const PRE_DIR = 'pre';
const SCOPE_DIRS = ['get-shit-done', 'commands', 'command', 'agents', 'hooks'];
const SCOPE_FILES = ['settings.json', 'settings.local.json', 'gsd-file-manifest.json', 'gsd-source-path.txt'];

const upgradesRootOf = (homeDir) => path.join(homeDir, '.gsd', 'upgrades');
const preImageOf = (recordDir, file) => path.join(recordDir, PRE_DIR, file);
const readRecord = (recordDir) => JSON.parse(fs.readFileSync(path.join(recordDir, RECORD_FILE), 'utf8'));
const writeRecord = (recordDir, record) => fs.writeFileSync(path.join(recordDir, RECORD_FILE), JSON.stringify(record, null, 2) + '\n');
const uniq = (list) => [...new Set(list)];
const stampOf = (now) => now.toISOString().replace(/[:.]/g, '-');

function sha256OrNull(file) {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.isFile() ? [full] : [];
  });
}

function scopeOf(targetDir) {
  return [
    ...SCOPE_DIRS.flatMap((dir) => listFiles(path.join(targetDir, dir))),
    ...SCOPE_FILES.map((file) => path.join(targetDir, file)),
  ];
}

function backupEntry(recordDir, file) {
  const pre = sha256OrNull(file);
  if (pre !== null) {
    fs.mkdirSync(path.dirname(preImageOf(recordDir, file)), { recursive: true });
    fs.copyFileSync(file, preImageOf(recordDir, file));
  }
  return { path: file, pre_sha256: pre, post_sha256: null };
}

function openRecord({ targetDirs, homeDir = os.homedir(), now = new Date() }) {
  const root = upgradesRootOf(homeDir);
  fs.mkdirSync(root, { recursive: true });
  const recordDir = path.join(root, stampOf(now));
  fs.mkdirSync(recordDir);
  const entries = uniq(targetDirs.flatMap(scopeOf)).map((file) => backupEntry(recordDir, file));
  writeRecord(recordDir, { status: 'open', opened: now.toISOString(), targets: targetDirs, entries });
  return recordDir;
}

function closeRecord(recordDir) {
  const record = readRecord(recordDir);
  if (record.status !== 'open') return record;
  const known = new Map(record.entries.map((entry) => [entry.path, entry]));
  const files = uniq([...record.entries.map((entry) => entry.path), ...record.targets.flatMap(scopeOf)]);
  const entries = files.map((file) => ({
    path: file,
    pre_sha256: known.has(file) ? known.get(file).pre_sha256 : null,
    post_sha256: sha256OrNull(file),
  }));
  const closed = { ...record, status: 'closed', entries };
  writeRecord(recordDir, closed);
  return closed;
}

function newestRecordDir(homeDir) {
  const root = upgradesRootOf(homeDir);
  const names = fs.existsSync(root) ? fs.readdirSync(root).sort() : [];
  return names.length === 0 ? null : path.join(root, names.at(-1));
}

function restoreEntry(recordDir, entry) {
  if (entry.pre_sha256 === null) {
    fs.rmSync(entry.path, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(entry.path), { recursive: true });
  fs.copyFileSync(preImageOf(recordDir, entry.path), entry.path);
}

function rollbackNewest({ homeDir = os.homedir() }) {
  const recordDir = newestRecordDir(homeDir);
  if (recordDir === null) return { status: 'no-record' };
  const record = readRecord(recordDir);
  if (record.status === 'rolled_back') return { status: 'already-rolled-back', recordDir };
  if (record.status !== 'closed') return { status: 'incomplete', recordDir };
  const current = record.entries.map((entry) => ({ entry, now: sha256OrNull(entry.path) }));
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
  refused: (r) => `refused: ${r.refusal.reason} (${r.refusal.failed.join(', ')})`,
};

module.exports = { openRecord, closeRecord, rollbackNewest, rollbackWithGuard };

if (require.main === module) {
  const result = rollbackWithGuard({ env: process.env, session: detectSession() });
  console.log(SUMMARY[result.status](result));
  process.exit(OK_STATUSES.has(result.status) ? 0 : 1);
}
