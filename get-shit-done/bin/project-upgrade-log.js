'use strict';

// The upgrade commits of the last runs, kept beside the registry so rollback can revert them. Each run carries the id of
// the framework upgrade record it belongs to (null when the framework itself did not change), so a rollback of that
// record reaches exactly its commits. Outside ~/.gsd/upgrades on purpose: that directory holds only framework records.

const fs = require('fs');
const path = require('path');

const LOG_FILE = 'project-upgrades.json';
const KEEP_RUNS = 20;
const RECORD_ID_RE = /^[0-9A-Za-z_-]{1,64}$/;

function readRuns(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, LOG_FILE), 'utf8'));
    return Array.isArray(parsed.runs) ? parsed.runs : [];
  } catch {
    return [];
  }
}

function appendRun(dir, run) {
  const file = path.join(dir, LOG_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify({ runs: [...readRuns(dir), run].slice(-KEEP_RUNS) }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// The commits of the runs tied to one framework record, newest first; nothing for an unknown or absent id.
function commitsOfRecord(dir, recordId) {
  if (typeof recordId !== 'string' || !RECORD_ID_RE.test(recordId)) return [];
  return readRuns(dir).filter((r) => r.record === recordId && Array.isArray(r.commits)).reverse().flatMap((r) => [...r.commits].reverse());
}

const revertCommand = (c) => `git -C ${JSON.stringify(c.root)} revert ${c.sha}`;

module.exports = { appendRun, readRuns, commitsOfRecord, revertCommand, RECORD_ID_RE };
