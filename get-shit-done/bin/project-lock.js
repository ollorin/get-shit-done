/**
 * project-lock.js — agnostic-M-02 registry lock (review round 4, R4 L-registry)
 *
 * The lock file `projects.lock` holds { token, pid }. It is created by writing a temp file and linking it into place,
 * so it is never seen empty. It is unlinked only by the holder of `projects.lock.<T>.takeover` (created with wx), after
 * that holder re-reads the owner and finds T. Release and takeover both go through unlinkLockInstance. The lock path
 * is never renamed. A lock is stale when its mtime is over LOCK_STALE_MS old AND its pid is dead (ESRCH); a live slow
 * owner is never taken over. A malformed lock is refused with a message naming the file.
 *
 * Residual (R4): a taker that dies between creating `projects.lock.<T>.takeover` and unlinking the stale lock leaves
 * both files. The next acquirer is refused, naming both files; no second port_base is ever allocated.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOCK_FILE = 'projects.lock';
const LOCK_RETRIES = 40;
const LOCK_WAIT_MS = 50;
const LOCK_STALE_MS = 30000;

const refuse = (reason) => ({ ok: false, reason });

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const lockPaths = (dir, token) => ({
  lock: path.join(dir, LOCK_FILE),
  marker: path.join(dir, `${LOCK_FILE}.${token}.takeover`),
});

// { state: 'absent' } | { state: 'malformed' } | { state: 'owner', token, pid, mtimeMs }
function readOwner(lock) {
  let text;
  let mtimeMs;
  try {
    text = fs.readFileSync(lock, 'utf8');
    mtimeMs = fs.statSync(lock).mtimeMs;
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'absent' };
    throw e;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'malformed' };
  }
  const valid = parsed !== null && typeof parsed === 'object' && typeof parsed.token === 'string' && Number.isInteger(parsed.pid);
  return valid ? { state: 'owner', token: parsed.token, pid: parsed.pid, mtimeMs } : { state: 'malformed' };
}

// ESRCH means no such process. EPERM means it exists under another user, so it is alive.
function pidIsDead(pid) {
  if (!(pid > 0)) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === 'ESRCH';
  }
}

const isStale = (owner) => Date.now() - owner.mtimeMs > LOCK_STALE_MS && pidIsDead(owner.pid);

// The only unlink of a lock file. Returns false when the marker stays held for the whole wait.
function unlinkLockInstance(dir, token) {
  const { lock, marker } = lockPaths(dir, token);
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    let fd;
    try {
      fd = fs.openSync(marker, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      sleepSync(LOCK_WAIT_MS);
      continue;
    }
    fs.closeSync(fd);
    try {
      const owner = readOwner(lock);
      if (owner.state === 'owner' && owner.token === token) fs.rmSync(lock, { force: true });
    } finally {
      fs.rmSync(marker, { force: true });
    }
    return true;
  }
  return false;
}

// Returns { ok: true } once this token holds the lock, or a refusal. seams.beforeMarker (tests) runs after a stale
// owner is observed and before its takeover marker is taken.
function acquireLock(dir, token, seams = {}) {
  const { lock } = lockPaths(dir, token);
  const tmp = `${lock}.${token}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ token, pid: process.pid }));
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
      try {
        fs.linkSync(tmp, lock);
        return { ok: true };
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
      const owner = readOwner(lock);
      if (owner.state === 'malformed') return refuse(`the registry lock ${lock} is malformed; remove it by hand`);
      if (owner.state === 'owner' && isStale(owner)) {
        if (seams.beforeMarker) seams.beforeMarker(owner);
        if (!unlinkLockInstance(dir, owner.token)) {
          const { marker } = lockPaths(dir, owner.token);
          return refuse(`the registry lock ${lock} is stale and its takeover marker ${marker} was left behind; remove both files by hand`);
        }
        continue;
      }
      sleepSync(LOCK_WAIT_MS);
    }
    return refuse(`the registry is locked by another project init (${LOCK_FILE})`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Runs fn under the lock. A failed release is left for the next acquirer: the lock is ours until it is stale.
function withLock(dir, fn) {
  const token = crypto.randomUUID();
  let acquired;
  try {
    acquired = acquireLock(dir, token);
  } catch (e) {
    return refuse(`cannot lock the registry: ${e.message}`);
  }
  if (!acquired.ok) return acquired;
  try {
    return fn();
  } finally {
    try {
      unlinkLockInstance(dir, token);
    } catch {
      // The lock stays until it is stale; the next acquirer refuses or takes it over.
    }
  }
}

module.exports = { LOCK_FILE, acquireLock, unlinkLockInstance, withLock, readOwner };
