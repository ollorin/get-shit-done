/**
 * project-registry-store.js — agnostic-M-02 registry storage (review round 4 split of project-registry.js)
 *
 * Reads and validates projects.json under GSD_HOME. planUnderLock plans from one read and re-plans once if the
 * file changed before the write. The lock itself lives in project-lock.js.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REGISTRY_FILE = 'projects.json';
const EMPTY_REGISTRY = Object.freeze({ version: 1, projects: Object.freeze({}) });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const refuse = (reason) => ({ ok: false, reason });
const isValidPort = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535;

function registryDir(env) {
  return env.GSD_HOME || path.join(os.homedir(), '.gsd');
}

function registryDirFor(env) {
  const dir = registryDir(env);
  return path.isAbsolute(dir) ? { ok: true, dir } : refuse(`GSD_HOME must be an absolute path, got "${dir}"`);
}

// Runs fn and turns any filesystem error into { ok:false, reason }: no stack trace reaches the CLI.
function safely(fn) {
  try {
    return fn();
  } catch (e) {
    return refuse(`registry write failed: ${e.message}`);
  }
}

function registryProblem(parsed) {
  if (!isObject(parsed) || parsed.version !== 1 || !isObject(parsed.projects)) {
    return 'projects.json must be {"version":1,"projects":{...}}';
  }
  const bad = Object.entries(parsed.projects).find(([, e]) => !isObject(e)
    || typeof e.root !== 'string' || e.root.length === 0 || !isValidPort(e.port_base));
  return bad ? `projects.json entry ${bad[0]} needs a root and a valid port_base` : null;
}

function readRegistry(dir) {
  const file = path.join(dir, REGISTRY_FILE);
  if (!fs.existsSync(file)) return { ok: true, data: EMPTY_REGISTRY };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return refuse('projects.json is not valid JSON; it is left unchanged');
  }
  const problem = registryProblem(parsed);
  return problem === null ? { ok: true, data: parsed } : refuse(`${problem}; it is left unchanged`);
}

const registryDigest = (dir) => {
  const file = path.join(dir, REGISTRY_FILE);
  return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
};

// Read and plan under the lock, then compare the registry digest before the write. A registry that changed since the
// read is planned once more from its new bytes; a second change is refused, so the loop is bounded.
function planUnderLock(dir, makePlan, betweenPlanAndCheck = () => {}) {
  for (let pass = 0; pass < 2; pass += 1) {
    const digest = registryDigest(dir);
    const read = readRegistry(dir);
    if (!read.ok) return read;
    const plan = makePlan(read.data);
    betweenPlanAndCheck();
    if (registryDigest(dir) === digest) return plan;
  }
  return refuse('the registry changed during the allocation; run project init again');
}

module.exports = {
  REGISTRY_FILE, EMPTY_REGISTRY, isObject, refuse, isValidPort, registryDir, registryDirFor, safely,
  readRegistry, registryDigest, planUnderLock,
};
