#!/usr/bin/env node
'use strict';

// Upgrade record for a user-scope install. openRecord copies the pre-install bytes of every file the install may
// write; closeRecord stores post-install fingerprints (and deletes the record when nothing changed); rollback restores
// the newest finished record and leaves alone any file edited since. Paths are absolute. homeDir is a parameter so
// tests run against a temp home.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const path = require('path');
const { refusalOf } = require('../get-shit-done/bin/project-deploy-guard.js');
const { detectSession } = require('../get-shit-done/bin/project-deploy-session.js');

const RECORD_FILE = 'record.json';
const PRE_DIR = 'pre';
const KEEP_RECORDS = 5;
const SCOPE_DIRS = ['get-shit-done', 'commands', 'command', 'agents', 'hooks', 'gsd-local-patches', 'skills'];
// .claude.json is written by install:gsd step 4 (scripts/install-mcp.js) after install.js exits; noteLateWrite records it.
const SCOPE_FILES = ['settings.json', 'settings.local.json', 'gsd-file-manifest.json', 'gsd-source-path.txt', '.claude.json'];
const OWNED_FILES = ['settings.json', 'gsd-file-manifest.json', 'gsd-source-path.txt'];
// Written by install() into the live get-shit-done tree after the swap (and by installHookDependencies).
const OWNED_SKILL_FILES = ['CHANGELOG.md', 'VERSION', 'hook-config.json', 'package.json', 'package-lock.json'];
const MANIFEST_NAME = 'gsd-file-manifest.json';
const PATCHES_DIR = 'gsd-local-patches';
const SKIPPED_DIRS = new Set(['node_modules']);
const CLOSING_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const STAGING_DIR = '.gsd-staging';

// Hook dependencies sit beside the skill files but are not recorded (SKIPPED_DIRS). The marker lists the targets that had them.
const depsOf = (targetDir) => path.join(targetDir, 'get-shit-done', 'node_modules');
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

// The directory and every directory below it (node_modules excluded).
function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  const below = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIPPED_DIRS.has(entry.name))
    .flatMap((entry) => listDirs(path.join(dir, entry.name)));
  return [dir, ...below];
}

function scopeOf(targetDir) {
  return [
    ...SCOPE_DIRS.flatMap((dir) => listFiles(path.join(targetDir, dir))),
    ...SCOPE_FILES.map((file) => path.join(targetDir, file)),
  ];
}

const scopeDirsOf = (targetDir) => SCOPE_DIRS.flatMap((dir) => listDirs(path.join(targetDir, dir)));

// The three trees install() replaces by stage-and-swap. Stage and prev copies live under <target>/.gsd-staging, on the
// same filesystem but outside every directory Claude Code discovers from (commands/, agents/, skills/).
const TREES = [{ name: 'get-shit-done', rel: ['get-shit-done'] }, { name: 'agents', rel: ['agents'] }, { name: 'commands-gsd', rel: ['commands', 'gsd'] }];

function stagePathsOf(liveDir, { stagingRoot = path.join(path.dirname(liveDir), STAGING_DIR), name = path.basename(liveDir) } = {}) {
  return { stagingRoot, stageDir: path.join(stagingRoot, `${name}.next`), prevDir: path.join(stagingRoot, `${name}.prev`) };
}

function treesOf(targetDir) {
  return TREES.map(({ name, rel }) => {
    const liveDir = path.join(targetDir, ...rel);
    return { name, liveDir, stagingRoot: path.join(targetDir, STAGING_DIR), ...stagePathsOf(liveDir, { stagingRoot: path.join(targetDir, STAGING_DIR), name }) };
  });
}

// Heals what a killed swap leaves: no live tree but a prev (killed between the two renames) is put back, then
// a node_modules stranded in the stage goes back into the live tree. Runs before any stage is wiped.
function repairTree(liveDir, { stageDir, prevDir }) {
  if (lstatOrNull(liveDir) === null && lstatOrNull(prevDir) !== null) fs.renameSync(prevDir, liveDir);
  const stagedModules = path.join(stageDir, 'node_modules');
  const liveModules = path.join(liveDir, 'node_modules');
  if (fs.existsSync(stagedModules) && !fs.existsSync(liveModules) && fs.existsSync(liveDir)) fs.renameSync(stagedModules, liveModules);
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
    ...OWNED_SKILL_FILES.map((file) => path.join(targetDir, 'get-shit-done', file)),
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
  const dirs_before = uniq(targetDirs.flatMap(scopeDirsOf));
  writeRecord(recordDir, { status: 'open', opened: now.toISOString(), targets: targetDirs, deps_before, dirs_before, entries });
  pruneRecords(root, recordDir);
  return recordDir;
}

const withoutTimestamp = (bytes) => {
  try {
    const { timestamp, ...rest } = JSON.parse(bytes);
    return JSON.stringify(rest);
  } catch {
    return null;
  }
};

// The file manifest carries the install time, so two identical installs differ in that one field only.
function isTimestampOnlyChange(recordDir, entry) {
  if (path.basename(entry.path) !== MANIFEST_NAME || entry.pre_sha256 === null || entry.post_sha256 === null) return false;
  const before = withoutTimestamp(fs.readFileSync(preImageOf(recordDir, entry.path)));
  return before !== null && before === withoutTimestamp(fs.readFileSync(entry.path));
}

// The manifest's fingerprint without the install time: a later identical install rewrites only the timestamp, and
// rollback must still see the file as the install left it.
function stableFingerprintOf(file) {
  if (path.basename(file) !== MANIFEST_NAME || lstatOrNull(file) === null) return null;
  const stable = withoutTimestamp(fs.readFileSync(file));
  return stable === null ? null : sha256(stable);
}

// Files under gsd-local-patches are written only by the installer's patch backup, whatever their names.
const isPatchFile = (targets, file) => targets.some((target) => file.startsWith(path.join(target, PATCHES_DIR) + path.sep));

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
      post_stable_sha256: stableFingerprintOf(file),
    }))
    .filter((entry) => entry.pre_sha256 !== null || created.has(entry.path) || isPatchFile(record.targets, entry.path));
  const changed = entries.filter((entry) => entry.pre_sha256 !== entry.post_sha256 && !isTimestampOnlyChange(recordDir, entry));
  if (changed.length === 0) {
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

// Removes the directories the install created that are now empty; directories that existed at open stay.
function pruneCreatedDirs(record) {
  if (record.dirs_before === undefined) return;
  const before = new Set(record.dirs_before);
  const created = record.targets.flatMap(scopeDirsOf).filter((dir) => !before.has(dir)).sort().reverse();
  for (const dir of created) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

const skillPackageOf = (targetDir) => path.join(targetDir, 'get-shit-done', 'package.json');

function reinstallDeps(cwd) {
  try {
    execFileSync('npm', ['install', '--prefer-offline', '--silent'], { cwd, stdio: 'pipe', timeout: 120000 });
    return true;
  } catch {
    return false;
  }
}

// node_modules is not restored from a pre-image, so restored pins can disagree with it: one npm install brings them together.
function syncDeps(record, restored, runNpm) {
  const pinned = record.targets.filter((target) => restored.some((entry) => entry.path === skillPackageOf(target) && entry.pre_sha256 !== null));
  return pinned.map((target) => ({ target, ok: runNpm(path.join(target, 'get-shit-done')) }));
}

// The newest record decides. An open newest record is a crashed install: rollback does not reach past it to an older
// record (that would revert two versions back, mixed with the crash); re-running the install repairs the trees.
function rollbackNewest({ homeDir = os.homedir(), runNpm = reinstallDeps }) {
  const dirs = recordDirsNewestFirst(homeDir);
  if (dirs.length === 0) return { status: 'no-record' };
  const recordDir = dirs[0];
  if (statusOf(recordDir) === 'open') return { status: 'incomplete', recordDir };
  const record = readRecord(recordDir);
  if (record.status === 'rolled_back') return { status: 'already-rolled-back', recordDir };
  for (const target of record.targets) {
    for (const tree of treesOf(target)) repairTree(tree.liveDir, tree);
  }
  const lostDeps = (record.deps_before ?? []).filter((dir) => !fs.existsSync(depsOf(dir)));
  if (lostDeps.length > 0) return { status: 'deps-missing', recordDir, left: lostDeps };
  const atPost = (entry, now) => now === entry.post_sha256
    || (entry.post_stable_sha256 != null && stableFingerprintOf(entry.path) === entry.post_stable_sha256);
  const current = record.entries.map((entry) => ({ entry, now: fingerprintOf(entry.path) }));
  const toRestore = current
    .filter(({ entry, now }) => now !== entry.pre_sha256 && atPost(entry, now))
    .map(({ entry }) => entry);
  const left = current
    .filter(({ entry, now }) => now !== entry.pre_sha256 && !atPost(entry, now))
    .map(({ entry }) => entry.path);
  for (const entry of toRestore) restoreEntry(recordDir, entry);
  for (const target of record.targets) fs.rmSync(path.join(target, STAGING_DIR), { recursive: true, force: true });
  pruneCreatedDirs(record);
  const deps = syncDeps(record, toRestore, runNpm);
  if (left.length === 0) writeRecord(recordDir, { ...record, status: 'rolled_back' });
  return {
    status: left.length === 0 ? 'rolled-back' : 'partial',
    recordDir,
    restored: toRestore.map((entry) => entry.path),
    left,
    deps,
  };
}

// install:gsd step 4 writes <configDir>/.claude.json after install.js closed its record. The newest closed record takes
// the file's new fingerprint so rollback restores it. With no closed newest record (the install changed nothing else)
// there is nothing to amend and the write stays unrecorded.
function noteLateWrite({ homeDir = os.homedir(), file }) {
  const [recordDir] = recordDirsNewestFirst(homeDir);
  if (recordDir === undefined || statusOf(recordDir) !== 'closed') return false;
  const record = readRecord(recordDir);
  if (!record.targets.some((target) => path.dirname(file) === target)) return false;
  const known = record.entries.find((entry) => entry.path === file);
  const entry = { path: file, pre_sha256: known ? known.pre_sha256 : null, post_sha256: fingerprintOf(file) };
  writeRecord(recordDir, { ...record, entries: [...record.entries.filter((e) => e.path !== file), entry] });
  return true;
}

function rollbackWithGuard({ homeDir = os.homedir(), env = process.env, session, runNpm = reinstallDeps }) {
  const refusal = refusalOf({ command: 'rollback', guarded: [upgradesRootOf(homeDir)], env, session });
  return refusal ? { status: 'refused', refusal } : rollbackNewest({ homeDir, runNpm });
}

const depsLine = (deps = []) => deps
  .map(({ target, ok }) => (ok ? `; reinstalled hook dependencies in ${target}` : `; npm install failed in ${target}, run it by hand`))
  .join('');
const OK_STATUSES = new Set(['rolled-back', 'already-rolled-back']);
const SUMMARY = {
  'rolled-back': (r) => `rolled back ${r.recordDir}: ${r.restored.length} file(s) restored${depsLine(r.deps)}`,
  'already-rolled-back': (r) => `${r.recordDir} was already rolled back; nothing changed`,
  'no-record': () => 'no upgrade record under ~/.gsd/upgrades; nothing to roll back',
  incomplete: (r) => `${r.recordDir} never closed (the install did not finish); nothing changed. Re-run \`npm run install:gsd\`, which repairs the trees`,
  partial: (r) => `restored ${r.restored.length}; left alone, edited since the install: ${r.left.join(', ')}`,
  'deps-missing': (r) => `node_modules missing under: ${r.left.join(', ')}; nothing changed`,
  refused: (r) => `refused: ${r.refusal.reason} (${r.refusal.failed.join(', ')})`,
};

module.exports = { openRecord, closeRecord, closeOnExit, ownedFilesOf, rollbackNewest, rollbackWithGuard, noteLateWrite, stagePathsOf, treesOf, repairTree };

if (require.main === module) {
  const result = rollbackWithGuard({ env: process.env, session: detectSession() });
  console.log(SUMMARY[result.status](result));
  process.exit(OK_STATUSES.has(result.status) ? 0 : 1);
}
