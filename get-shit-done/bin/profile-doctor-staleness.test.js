'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const checks = require('./profile-doctor-checks.js');
const { HOOK_DOC, writeCompleteHome } = require('./profile-doctor-test-home.js');
const { MANIFEST } = require('./project-deploy.js');

const tmpDirs = [];
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});
const writeAt = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};
const kinds = (findings) => findings.map((f) => `${f.kind} ${f.key}`);

function homeWithSha(sha) {
  const home = writeCompleteHome(mkTmp('gsd-st-home-'));
  const manifestFile = path.join(home, '.claude/gsd-file-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, ...(sha === undefined ? {} : { source_git_sha: sha }) }));
  return home;
}

const writeRuns = (gsdDir, runs) => writeAt(gsdDir, 'project-upgrades.json', JSON.stringify({ runs }));

test('fork sha: the last upgrade of this project at another fork sha than the deployed framework is blocking DRIFT', () => {
  const root = mkTmp('gsd-st-proj-');
  const gsdDir = mkTmp('gsd-st-gsd-');
  writeRuns(gsdDir, [
    { at: 't1', fork_sha: 'old', roots: [root] },
    { at: 't2', fork_sha: 'other-project-only', roots: ['/elsewhere'] },
  ]);
  const found = checks.forkShaFindings(root, homeWithSha('new'), gsdDir);
  assert.deepStrictEqual(kinds(found), ['DRIFT project upgrade']);
  assert.strictEqual(checks.isBlockingFinding(found[0]), true);
  writeRuns(gsdDir, [{ at: 't1', fork_sha: 'old', roots: [root] }, { at: 't3', fork_sha: 'new', roots: [root] }]);
  assert.deepStrictEqual(checks.forkShaFindings(root, homeWithSha('new'), gsdDir), []);
});

test('fork sha: an unknown sha on either side is INFO, never blocking', () => {
  const root = mkTmp('gsd-st-proj-');
  const gsdDir = mkTmp('gsd-st-gsd-');
  const noLog = checks.forkShaFindings(root, homeWithSha('new'), gsdDir);
  writeRuns(gsdDir, [{ at: 't1', fork_sha: 'old', roots: [root] }]);
  const noDeployed = checks.forkShaFindings(root, homeWithSha(undefined), gsdDir);
  writeRuns(gsdDir, [{ at: 't1', fork_sha: 'unknown', roots: [root] }]);
  const unknownRun = checks.forkShaFindings(root, homeWithSha('new'), gsdDir);
  for (const found of [noLog, noDeployed, unknownRun]) {
    assert.deepStrictEqual(kinds(found), ['INFO project upgrade']);
    assert.strictEqual(checks.isBlockingFinding(found[0]), false);
  }
});

test('hook bytes: a registered script that differs from the framework copy is DRIFT, equal bytes are clean', () => {
  const home = writeCompleteHome(mkTmp('gsd-st-home-'));
  const root = mkTmp('gsd-st-proj-');
  const hooksRoot = mkTmp('gsd-st-hooks-');
  const registered = path.join(home, 'installed');
  writeAt(home, '.claude/settings.json', JSON.stringify(HOOK_DOC).split('/h/').join(`${registered}/`));
  writeAt(hooksRoot, 'gsd-owner-approve.js', 'new\n');
  writeAt(registered, 'gsd-owner-approve.js', 'old\n');
  const stale = checks.hookFindings(root, home, hooksRoot);
  assert.deepStrictEqual(kinds(stale), [`DRIFT ${registered}/gsd-owner-approve.js`]);
  assert.strictEqual(checks.isBlockingFinding(stale[0]), true);
  writeAt(registered, 'gsd-owner-approve.js', 'new\n');
  assert.deepStrictEqual(checks.hookFindings(root, home, hooksRoot), []);
});

const needsDefaults = { locked_commands: ['x'] };

test('migrations: a needed migration the manifest does not record is DRIFT; recording it, or having applied it, is clean and idempotent', () => {
  const root = mkTmp('gsd-st-proj-');
  writeAt(root, MANIFEST, JSON.stringify({ manifest_version: 1, files: {} }));
  const first = checks.migrationRecordFindings(root, needsDefaults);
  assert.deepStrictEqual(kinds(first), ['DRIFT migration table-defaults']);
  assert.strictEqual(checks.isBlockingFinding(first[0]), true);
  assert.deepStrictEqual(checks.migrationRecordFindings(root, needsDefaults), first);
  writeAt(root, MANIFEST, JSON.stringify({ manifest_version: 1, files: {}, migrations: ['table-defaults'] }));
  assert.deepStrictEqual(checks.migrationRecordFindings(root, needsDefaults), []);
  assert.deepStrictEqual(checks.migrationRecordFindings(root, { ...needsDefaults, isolation: { lock_dir: '.tmp/stack.lock.d' } }), []);
});

test('migrations: a project without a manifest is not under the engine and gets no migration finding', () => {
  assert.deepStrictEqual(checks.migrationRecordFindings(mkTmp('gsd-st-proj-'), needsDefaults), []);
});
