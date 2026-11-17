'use strict';
// Dispatch leases: `dispatch begin|end` (references/rigour.md rule 7). One lease per spawned agent, kept in
// .planning/dispatch-leases.json. A phase that never calls `dispatch` has no leases and keeps the legacy `budget spend` accounting.
// Executor leases never expire by TTL (only `end`, `end --stale`, or the phase window closing); other roles close after the TTL.
// Wall time of a leased phase = the sum of lease spans. An open lease counts to the phase's LAST LOGGED EVENT, never the clock,
// and a lease closed as stale (`end --stale`, TTL, or the phase window closing) ends at that same event, so a dead session
// or a rate-limit pause adds nothing.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { evPhase, phaseKey } = require('./roadmap-dispatch.js');

const EXCLUSIVE_ROLES = new Set(['executor']);
const DEFAULT_TTL_MIN = 120;
const WINDOW_CLOSE = new Set(['phase_complete', 'phase_parked', 'phase_incomplete', 'phase_retry', 'phase_failed', 'phase_coordinator_death']);
const ROLE_RE = /^[a-z][a-z0-9-]*$/;

// The file lives in the repo's git common dir, so every worktree of one repo shares one exclusivity record and the working tree
// stays clean. Outside a git repo it falls back to .planning/.
function leasePath(cwd) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' });
  const common = r.status === 0 ? r.stdout.trim() : '';
  return common ? path.join(common, 'gsd-dispatch-leases.json') : path.join(cwd, '.planning', 'dispatch-leases.json');
}
const ms = (iso) => Date.parse(iso);

// Read-only view: an unreadable file reads as no leases here; begin/end quarantine it instead (loadOrQuarantine).
function load(cwd) {
  try { const j = JSON.parse(fs.readFileSync(leasePath(cwd), 'utf8')); return Array.isArray(j.leases) ? j.leases : []; } catch { return []; }
}

// Under the lock: a missing file is empty; a corrupt one is renamed to <file>.corrupt-<n> (never overwritten) and reported.
function loadOrQuarantine(cwd) {
  const file = leasePath(cwd);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { leases: [], quarantined: null }; throw e; }
  try { const j = JSON.parse(text); if (Array.isArray(j.leases)) return { leases: j.leases, quarantined: null }; } catch { /* corrupt */ }
  let n = 1;
  while (fs.existsSync(`${file}.corrupt-${n}`)) n += 1;
  fs.renameSync(file, `${file}.corrupt-${n}`);
  return { leases: [], quarantined: path.basename(`${file}.corrupt-${n}`) };
}

function save(cwd, leases) {
  fs.mkdirSync(path.dirname(leasePath(cwd)), { recursive: true });
  const tmp = `${leasePath(cwd)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ leases }, null, 2) + '\n');
  fs.renameSync(tmp, leasePath(cwd));
}

// Serialises read-modify-write so two parallel `begin executor` calls cannot both pass the check.
function withLock(cwd, fn) {
  const lock = `${leasePath(cwd)}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const sleep = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 5000;
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(lock, 'wx'); } catch (e) {
      if (e.code !== 'EEXIST' || Date.now() > deadline) {
        if (e.code === 'EEXIST') { try { fs.unlinkSync(lock); } catch { /* raced */ } continue; }
        throw e;
      }
      Atomics.wait(sleep, 0, 0, 25);
    }
  }
  try { return fn(); } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch { /* gone */ } }
}

// Heartbeats are real activity of the phase; the tool's own automatic closes are not.
const isHeartbeat = (e) => !(e.type === 'dispatch_end' && (e.stale === true || e.auto === true));

function lastEventMs(events, phase, beginMs) {
  const k = phaseKey(phase);
  let last = beginMs;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || evPhase(e) !== k || !isHeartbeat(e)) continue;
    const t = ms(e.timestamp);
    if (!Number.isNaN(t) && t > last) last = t;
  }
  return last;
}

// Closes open leases of the phase whose window ended (a close-type event after their begin) or that had no event for the TTL.
function reconcile(leases, events, phase, now, ttlMin) {
  const k = phaseKey(phase);
  const closed = [];
  const out = leases.map((l) => {
    if (l.end || l.phase !== k) return l;
    const b = ms(l.begin);
    const win = (Array.isArray(events) ? events : []).find((e) => e && evPhase(e) === k && WINDOW_CLOSE.has(e.type) && ms(e.timestamp) >= b);
    const last = lastEventMs(events, k, b);
    if (win) { const c = { ...l, end: win.timestamp, closed: 'window', reason: `phase window closed by ${win.type}` }; closed.push(c); return c; }
    // An executor lease is closed only by `dispatch end` / `end --stale --reason`: a quiet long executor is not a dead one.
    if (!EXCLUSIVE_ROLES.has(l.role) && now - last > ttlMin * 60000) {
      const c = { ...l, end: new Date(last).toISOString(), closed: 'ttl', reason: `no event for ${Math.round((now - last) / 60000)} min (ttl ${ttlMin})` };
      closed.push(c);
      return c;
    }
    return l;
  });
  return { leases: out, closed };
}

const closeEvent = (l) => ({ type: 'dispatch_end', phase: l.phase, role: l.role, id: l.id, stale: l.closed !== 'end', auto: l.closed !== 'end' && l.closed !== 'stale', reason: l.reason || null, at: l.end });

function begin({ cwd, phase, role, id, events, now = Date.now(), ttlMin = DEFAULT_TTL_MIN }) {
  const k = phaseKey(phase);
  if (!k) return { error: 'dispatch begin: --phase required' };
  if (!ROLE_RE.test(role || '')) return { error: 'dispatch begin: --role required (lowercase word, e.g. executor, reviewer)' };
  if (!id) return { error: 'dispatch begin: --id required' };
  return withLock(cwd, () => {
    const q = loadOrQuarantine(cwd);
    const r = reconcile(q.leases, events, k, now, ttlMin);
    const open = r.leases.filter((l) => !l.end && l.phase === k);
    const refuse = open.find((l) => l.id === id) ? `lease ${id} is already open in phase ${k}`
      : EXCLUSIVE_ROLES.has(role) && open.find((l) => l.role === role) ? `phase ${k} already has an open ${role} lease (${open.find((l) => l.role === role).id}): end it, or close it with \`dispatch end --stale <id> --reason "<text>"\` when that agent is dead`
        : null;
    if (r.closed.length > 0) save(cwd, r.leases);
    if (refuse) return { error: `dispatch begin refused: ${refuse}`, auto_closed: r.closed.map(closeEvent), quarantined: q.quarantined };
    const lease = { id, role, phase: k, begin: new Date(now).toISOString(), end: null };
    save(cwd, [...r.leases, lease]);
    return { lease, auto_closed: r.closed.map(closeEvent), quarantined: q.quarantined };
  });
}

function end({ cwd, id, stale, reason, events, now = Date.now() }) {
  if (!id) return { error: 'dispatch end: --id <agent> (or --stale <agent>) required' };
  if (stale && !reason) return { error: 'dispatch end --stale: --reason "<text>" required' };
  return withLock(cwd, () => {
    const { leases, quarantined } = loadOrQuarantine(cwd);
    const l = leases.find((x) => !x.end && x.id === id);
    if (!l) return { error: `dispatch end: no open lease with id ${id}`, quarantined };
    const at = stale ? lastEventMs(events, l.phase, ms(l.begin)) : now;
    const done = { ...l, end: new Date(at).toISOString(), closed: stale ? 'stale' : 'end', ...(stale ? { reason } : {}) };
    save(cwd, leases.map((x) => (x === l ? done : x)));
    return { lease: done, quarantined };
  });
}

// Lease-based spend for a phase, or null when the phase never used `dispatch` (legacy accounting applies).
function spend(cwd, events, phase) {
  const k = phaseKey(phase);
  const mine = load(cwd).filter((l) => l.phase === k);
  if (mine.length === 0) return null;
  let reset = -Infinity;
  for (const e of Array.isArray(events) ? events : []) {
    if (e && evPhase(e) === k && (e.type === 'phase_complete' || (e.type === 'phase_parked' && e.reason === 'budget_exceeded'))) reset = Math.max(reset, ms(e.timestamp) || -Infinity);
  }
  const span = (l) => { const b = ms(l.begin); return Math.max(0, (l.end ? ms(l.end) : lastEventMs(events, k, b)) - b); };
  const cur = mine.filter((l) => ms(l.begin) > reset);
  const min = (x) => Math.round((x / 60000) * 10) / 10;
  return { wall_minutes_spent: min(cur.reduce((a, l) => a + span(l), 0)), dispatches_spent: cur.length, total_wall_minutes: min(mine.reduce((a, l) => a + span(l), 0)), total_dispatches: mine.length };
}

// Earliest lease begin (ms) of the phase, or null.
const firstBegin = (cwd, phase) => { const b = load(cwd).filter((l) => l.phase === phaseKey(phase)).map((l) => ms(l.begin)).filter((t) => !Number.isNaN(t)); return b.length ? Math.min(...b) : null; };

module.exports = { firstBegin, begin, end, spend, load, leasePath, closeEvent, DEFAULT_TTL_MIN };
