'use strict';

// The upgrade commits of the last runs, kept beside the registry so rollback can print the `git revert` lines.
// Outside ~/.gsd/upgrades on purpose: that directory holds only framework records.

const fs = require('fs');
const path = require('path');

const LOG_FILE = 'project-upgrades.json';
const KEEP_RUNS = 20;

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

// The newest run that made at least one commit, as instructions; the commands are never run.
function revertLines(dir) {
  const run = readRuns(dir).filter((r) => Array.isArray(r.commits) && r.commits.length > 0).at(-1);
  if (run === undefined) return [];
  return [
    `project upgrade commits of ${run.at}; to undo one, run:`,
    ...run.commits.map((c) => `  git -C ${JSON.stringify(c.root)} revert ${c.sha}`),
  ];
}

module.exports = { appendRun, readRuns, revertLines };
