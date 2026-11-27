'use strict';

// Read-only check whether work is running in a project root: an open dispatch lease whose owner still runs, a held
// stack lock, or a newest EXECUTION_LOG.md event younger than 45 minutes that is not a window close. A phase that was
// started and paused, with nothing running, is not live. Nothing is written (leases are read with load, never reaped).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { load, WINDOW_CLOSE } = require('./dispatch-lease.js');

const FRESH_MS = 45 * 60 * 1000;
const LOCK_FILE = '.tmp/stack.lock';
// lstart has one-second resolution and the lock's own `start` is taken a moment after the process began.
const START_SLACK_MS = 5000;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// `ps` lstart text of a pid, '' when unknown (no ps, no such process).
function psStart(pid) {
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

function parseEvents(root) {
  const text = readText(path.join(root, '.planning', 'EXECUTION_LOG.md'));
  if (text === null) return [];
  return text.split('\n').filter((line) => line.startsWith('{')).flatMap((line) => {
    try {
      const e = JSON.parse(line);
      return Number.isNaN(Date.parse(e.timestamp)) ? [] : [{ type: e.type, phase: String(e.phase), at: Date.parse(e.timestamp) }];
    } catch {
      return [];
    }
  });
}

// Same process: alive, and (when ps can say) started at the recorded time. An unknown start counts as alive.
const ownerRuns = (owner, alive, startOf) => alive(owner.pid) && [owner.start, ''].includes(startOf(owner.pid));

function leaseReasons(root, events, now, alive, startOf) {
  const closedAfter = (l) => events.some((e) => WINDOW_CLOSE.has(e.type) && e.phase === String(l.phase) && e.at >= Date.parse(l.begin));
  return load(root)
    .filter((l) => !l.end && !closedAfter(l))
    .filter((l) => (l.owner ? ownerRuns(l.owner, alive, startOf) : now - Date.parse(l.last_event ?? l.begin) < FRESH_MS))
    .map((l) => `open dispatch lease ${l.id} (phase ${l.phase})`);
}

// The lock file stack-lock.mjs writes: { pid, start, childPid }. A holder counts when its pid runs and began no later
// than the lock was taken; a recycled pid began after it.
function lockReasons(root, alive, startOf) {
  const text = readText(path.join(root, LOCK_FILE));
  let held;
  try {
    held = JSON.parse(text);
  } catch {
    return [];
  }
  const lockedAt = Date.parse(held?.start);
  const holders = [held?.pid, held?.childPid].filter((p) => Number.isInteger(p) && p > 0).filter((pid) => {
    if (!alive(pid)) return false;
    const began = Date.parse(startOf(pid));
    return Number.isNaN(began) || Number.isNaN(lockedAt) || began <= lockedAt + START_SLACK_MS;
  });
  return holders.length > 0 ? [`stack lock held by pid ${holders[0]}`] : [];
}

function logReasons(events, now) {
  const newest = events.reduce((n, e) => (n === null || e.at > n.at ? e : n), null);
  return newest !== null && now - newest.at < FRESH_MS && !WINDOW_CLOSE.has(newest.type) ? [`log event ${newest.type} younger than 45 minutes`] : [];
}

// Reasons the project is live; an empty list means the framework files may change.
function liveReasons(root, { now = Date.now(), alive = pidAlive, startOf = psStart } = {}) {
  const events = parseEvents(root);
  return [...leaseReasons(root, events, now, alive, startOf), ...lockReasons(root, alive, startOf), ...logReasons(events, now)];
}

module.exports = { liveReasons, FRESH_MS, psStart };
