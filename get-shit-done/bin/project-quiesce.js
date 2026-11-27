'use strict';

// Read-only check whether a phase is live in a project root: an open dispatch lease, a held stack lock, or a recent
// EXECUTION_LOG event. Nothing is written (leases are read with load, never reaped).

const fs = require('fs');
const path = require('path');
const { load, WINDOW_CLOSE } = require('./dispatch-lease.js');

const FRESH_MS = 45 * 60 * 1000;
const LOG_TAIL_BYTES = 256 * 1024;
const DEFAULT_LOCK_DIR = '.tmp/stack.lock.d';

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const readJson = (file) => {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

function leaseReasons(root, now, alive) {
  return load(root)
    .filter((l) => !l.end)
    .filter((l) => (l.owner ? alive(l.owner.pid) : now - Date.parse(l.last_event ?? l.begin) < FRESH_MS))
    .map((l) => `open dispatch lease ${l.id} (phase ${l.phase})`);
}

function lockReasons(root, alive) {
  const config = readJson(path.join(root, '.planning', 'config.json'));
  const configured = config?.stack?.isolation?.lock_dir;
  const lockDir = typeof configured === 'string' && configured.length > 0 ? configured : DEFAULT_LOCK_DIR;
  const owner = readJson(path.join(path.resolve(root, lockDir), 'owner.txt'));
  return Number.isInteger(owner?.pid) && alive(owner.pid) ? [`stack lock held by pid ${owner.pid}`] : [];
}

function newestEvent(root) {
  const text = readText(path.join(root, '.planning', 'EXECUTION_LOG.md'));
  if (text === null) return null;
  const events = text.slice(-LOG_TAIL_BYTES).split('\n').filter((line) => line.startsWith('{')).flatMap((line) => {
    try {
      const e = JSON.parse(line);
      return Number.isNaN(Date.parse(e.timestamp)) ? [] : [{ type: e.type, at: Date.parse(e.timestamp) }];
    } catch {
      return [];
    }
  });
  return events.reduce((newest, e) => (newest === null || e.at > newest.at ? e : newest), null);
}

function logReasons(root, now) {
  const e = newestEvent(root);
  return e !== null && now - e.at < FRESH_MS && !WINDOW_CLOSE.has(e.type) ? [`log event ${e.type} younger than 45 minutes`] : [];
}

// Reasons the project is live; an empty list means the framework files may change.
function liveReasons(root, { now = Date.now(), alive = pidAlive } = {}) {
  return [...leaseReasons(root, now, alive), ...lockReasons(root, alive), ...logReasons(root, now)];
}

module.exports = { liveReasons, FRESH_MS };
