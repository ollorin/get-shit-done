'use strict';
// Dispatch leases: `dispatch begin|end` (references/rigour.md rule 7). One lease per spawned agent, kept in
// <git common dir>/gsd-dispatch-leases.json (shared by worktrees; .planning/dispatch-leases.json outside git or when the common dir is not writable). A phase that never calls `dispatch` has no leases: its spend is unknown.
// Owner (executor leases): `begin` records { pid, start } of the process that owns the session. The tool's own pid is useless (it exits at once)
// and so is its parent (the per-command shell), so the owner is `--owner-pid`, else the nearest ancestor whose command is not a shell
// (normally the agent runtime), found with `ps`; `start` (ps lstart) guards against pid reuse. LIMITS: it proves the SESSION is gone, never that one
// executor inside a live session died; no `ps` or no non-shell ancestor = no owner = `unknown`, nothing reaped. `reapDead` closes a lease
// as stale only when the owner is gone AND no phase commit is newer than the lease's last heartbeat (events are folded into the heartbeat).
// Executor leases never expire by TTL (only `end`, `end --stale`, or the phase window closing); other roles close after the TTL.
// Wall time of a leased phase = the sum of lease spans. An open lease counts to the phase's LAST LOGGED EVENT, never the clock,
// and a lease closed as stale (`end --stale`, TTL, or the phase window closing) ends at that same event, so a dead session
// or a rate-limit pause adds nothing.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { evPhase, phaseKey } = require('./roadmap-dispatch.js');
const planOverlap = require('./plan-overlap.js');

// EXCLUSIVE_ROLES: leases that never expire by TTL and carry an owner. `window` is exclusive per phase; `executor` is exclusive
// unless both leases carry --plan and the plans are file-disjoint (D-279; at most MAX_EXECUTORS).
const EXCLUSIVE_ROLES = new Set(['executor', 'window']);
const DEFAULT_TTL_MIN = 120;
const WINDOW_CLOSE = new Set(['phase_complete', 'phase_parked', 'phase_incomplete', 'phase_retry', 'phase_failed', 'phase_coordinator_death']);
const ROLE_RE = /^[a-z][a-z0-9-]*$/;

// The file lives in the repo's git common dir, so every worktree of one repo shares one exclusivity record and the working tree
// stays clean. Events (EXECUTION_LOG.md) are per worktree while leases are shared, so each lease also carries `last_event`, the
// last activity any worktree saw. Outside a git repo, or when the common dir cannot be written (a sandbox may block `.git/`), it
// falls back to .planning/ with a notice on stderr.
function gitCommonDir(cwd) {
  for (const flag of ['--git-common-dir', '--git-dir']) {
    const r = spawnSync('git', ['rev-parse', flag], { cwd, encoding: 'utf8' });
    if (r.status !== 0) continue;
    const line = r.stdout.split('\n').map((x) => x.trim()).filter(Boolean).pop();
    if (!line || line.startsWith('-')) continue;
    const dir = path.resolve(cwd, line);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}
const resolved = new Map();
function leasePath(cwd) {
  if (resolved.has(cwd)) return resolved.get(cwd);
  const fallback = path.join(cwd, '.planning', 'dispatch-leases.json');
  const common = gitCommonDir(cwd);
  let out = fallback;
  if (common) {
    const probe = path.join(common, `gsd-dispatch-leases.json.${process.pid}.probe`);
    try { fs.closeSync(fs.openSync(probe, 'w')); fs.unlinkSync(probe); out = path.join(common, 'gsd-dispatch-leases.json'); } catch {
      process.stderr.write(`dispatch: ${common} is not writable; leases kept in .planning/dispatch-leases.json (not shared with other worktrees)\n`);
    }
  }
  resolved.set(cwd, out);
  return out;
}
const ms = (iso) => Date.parse(iso);

// The file a reader looks at, found without writing anything (leasePath probes the git dir with a write): the shared
// file when it exists, else the .planning fallback.
function readPath(cwd) {
  const common = gitCommonDir(cwd);
  const shared = common ? path.join(common, 'gsd-dispatch-leases.json') : null;
  return shared && fs.existsSync(shared) ? shared : path.join(cwd, '.planning', 'dispatch-leases.json');
}

// Read-only view: an unreadable file reads as no leases here; begin/end quarantine it instead (loadOrQuarantine).
function load(cwd) {
  try { const j = JSON.parse(fs.readFileSync(readPath(cwd), 'utf8')); return Array.isArray(j.leases) ? j.leases : []; } catch { return []; }
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

// Last activity of a lease: the later of what any worktree recorded on the lease and this worktree's own events.
const leaseLast = (l, events) => Math.max(lastEventMs(events, l.phase, ms(l.begin)), ms(l.last_event) || 0);
// Records the phase's latest local activity on its open leases, so another worktree (with its own log) can read it.
const touch = (leases, events, k) => leases.map((l) => (l.end || l.phase !== k ? l : { ...l, last_event: new Date(leaseLast(l, events)).toISOString() }));

// Closes open leases of the phase whose window ended (a close-type event after their begin) or that had no event for the TTL.
function reconcile(leases, events, phase, now, ttlMin) {
  const k = phaseKey(phase);
  const closed = [];
  const out = leases.map((l) => {
    if (l.end || l.phase !== k) return l;
    const b = ms(l.begin);
    const win = (Array.isArray(events) ? events : []).find((e) => e && evPhase(e) === k && WINDOW_CLOSE.has(e.type) && ms(e.timestamp) >= b);
    const last = leaseLast(l, events);
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

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'tcsh', 'csh']);
const ps = (pid, field) => { const r = spawnSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
function ownerOf(pid) {
  const start = ps(pid, 'lstart');
  return Number.isInteger(pid) && pid > 1 && start ? { pid, start } : null;
}
function detectOwner() {
  let pid = process.ppid;
  for (let i = 0; i < 12 && pid > 1; i += 1) {
    const comm = path.basename(ps(pid, 'comm')).replace(/^-/, '');
    if (comm && !SHELLS.has(comm)) return ownerOf(pid);
    pid = Number(ps(pid, 'ppid')) || 0;
  }
  return null;
}
const ownerGone = (o) => { try { process.kill(o.pid, 0); } catch (e) { return e.code === 'ESRCH'; } const s = ps(o.pid, 'lstart'); return s !== '' && s !== o.start; };

const MAX_EXECUTORS = 2;
const endHint = (l) => `end it, or close it with \`dispatch end --stale ${l.id} --reason "<text>"\` when that agent is dead`;

// A second executor in one phase needs `--plan` on both leases, file-disjoint plans (plan-overlap.js), and at most MAX_EXECUTORS open.
// Open executor leases of other phases (cross-phase lanes) are checked for file overlap too.
function executorRefusal(cwd, k, open, plan, others) {
  const mine = open.filter((l) => l.role === 'executor');
  if (mine.length === 0) return plan && others.length > 0 ? overlapRefusal(cwd, plan, others) : null;
  const first = mine[0];
  if (!plan || mine.some((l) => !l.plan)) return `phase ${k} already has an open executor lease (${first.id}): a second executor needs --plan on both leases; ${endHint(first)}`;
  if (mine.length >= MAX_EXECUTORS) return `phase ${k} already has ${MAX_EXECUTORS} open executor leases (${mine.map((l) => l.id).join(', ')}): ${endHint(first)}`;
  return overlapRefusal(cwd, plan, [...mine, ...others]);
}
const overlapRefusal = (cwd, plan, mine) => { const c = planOverlap.leaseConflict(cwd, plan, mine.map((l) => l.plan)); return c ? `${c}; ${endHint(mine[0])}` : null; };

function begin({ cwd, phase, role, id, events, now = Date.now(), ttlMin = DEFAULT_TTL_MIN, ownerPid, reason, plan }) {
  const k = phaseKey(phase);
  if (!k) return { error: 'dispatch begin: --phase required' };
  if (!ROLE_RE.test(role || '')) return { error: 'dispatch begin: --role required (lowercase word, e.g. executor, reviewer)' };
  if (!id) return { error: 'dispatch begin: --id required' };
  return withLock(cwd, () => {
    const q = loadOrQuarantine(cwd);
    const r = reconcile(touch(q.leases, events, k), events, k, now, ttlMin);
    const open = r.leases.filter((l) => !l.end && l.phase === k);
    const execRefusal = role === 'executor' ? executorRefusal(cwd, k, open, plan, r.leases.filter((l) => !l.end && l.phase !== k && l.role === 'executor' && l.plan)) : null;
    const refuse = open.find((l) => l.id === id) ? `lease ${id} is already open in phase ${k}`
      : execRefusal ? execRefusal
        : role === 'window' && open.find((l) => l.role === role) ? `phase ${k} already has an open ${role} lease (${open.find((l) => l.role === role).id}): ${endHint(open.find((l) => l.role === role))}`
        : role === 'window' && !reason && r.leases.find((l) => l.role === 'window' && l.phase === k) ? `phase ${k} already had a window (${r.leases.find((l) => l.role === 'window' && l.phase === k).id}); a second window needs --reason "<why the first could not cover it>"`
          : null;
    if (r.closed.length > 0 || refuse) save(cwd, r.leases);
    if (refuse) return { error: `dispatch begin refused: ${refuse}`, auto_closed: r.closed.map(closeEvent), quarantined: q.quarantined };
    const owner = EXCLUSIVE_ROLES.has(role) ? (ownerPid ? ownerOf(ownerPid) : detectOwner()) : null;
    const lease = { id, role, phase: k, begin: new Date(now).toISOString(), end: null, ...(owner ? { owner } : {}), ...(role === 'window' && reason ? { begin_reason: reason } : {}), ...(role === 'executor' && plan ? { plan: planOverlap.repoRelative(cwd, plan) } : {}) };
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
    const at = stale ? leaseLast(l, events) : now;
    const done = { ...l, end: new Date(at).toISOString(), closed: stale ? 'stale' : 'end', ...(stale ? { reason } : {}) };
    save(cwd, touch(leases.map((x) => (x === l ? done : x)), events, l.phase));
    return { lease: done, quarantined };
  });
}

// lastCommitMs: newest commit time (ms) of the phase, or 0. Returns one { id, status } per open executor lease of the phase:
// reaped | alive | unknown (no owner recorded) | recent_activity (owner gone but a phase commit is newer than the heartbeat).
function reapDead({ cwd, phase, events, lastCommitMs = 0 }) {
  const k = phaseKey(phase);
  if (!k) return { error: 'dispatch reap-dead: --phase required' };
  return withLock(cwd, () => {
    const { leases, quarantined } = loadOrQuarantine(cwd);
    const out = [];
    const closed = [];
    const next = leases.map((l) => {
      if (l.end || l.phase !== k || !EXCLUSIVE_ROLES.has(l.role)) return l;
      if (!l.owner) { out.push({ id: l.id, status: 'unknown' }); return l; }
      if (!ownerGone(l.owner)) { out.push({ id: l.id, status: 'alive' }); return l; }
      const beat = leaseLast(l, events);
      if (lastCommitMs > beat) { out.push({ id: l.id, status: 'recent_activity' }); return l; }
      const c = { ...l, end: new Date(beat).toISOString(), closed: 'stale', reason: `owner pid ${l.owner.pid} is gone` };
      closed.push(c);
      out.push({ id: l.id, status: 'reaped' });
      return c;
    });
    if (closed.length > 0) save(cwd, touch(next, events, k));
    return { leases: out, closed, quarantined };
  });
}

// Lease-based spend for a phase, or null when the phase never used `dispatch` (spend unknown).
function spend(cwd, events, phase) {
  const k = phaseKey(phase);
  const mine = load(cwd).filter((l) => l.phase === k);
  if (mine.length === 0) return null;
  let reset = -Infinity;
  for (const e of Array.isArray(events) ? events : []) {
    if (e && evPhase(e) === k && (e.type === 'phase_complete' || (e.type === 'phase_parked' && e.reason === 'budget_exceeded'))) reset = Math.max(reset, ms(e.timestamp) || -Infinity);
  }
  const span = (l) => { const b = ms(l.begin); return Math.max(0, (l.end ? ms(l.end) : leaseLast(l, events)) - b); };
  const cur = mine.filter((l) => ms(l.begin) > reset);
  const min = (x) => Math.round((x / 60000) * 10) / 10;
  return { wall_minutes_spent: min(cur.reduce((a, l) => a + span(l), 0)), dispatches_spent: cur.length, total_wall_minutes: min(mine.reduce((a, l) => a + span(l), 0)), total_dispatches: mine.length };
}

// Spawn events with no lease behind them: a phase with no lease counts every spawn event; otherwise only `model_selected` (one per spawn)
// beyond the lease count. `task_outcome`/`tier_escalation` are per task, not per agent, so they only count for a phase with no lease at all.
const SPAWN_EVENTS = new Set(['model_selected', 'task_outcome', 'tier_escalation']);
function unleasedSpawns(cwd, events, phase) {
  const k = phaseKey(phase);
  const mine = (Array.isArray(events) ? events : []).filter((e) => e && evPhase(e) === k);
  const leaseCount = load(cwd).filter((l) => l.phase === k).length;
  const spawns = mine.filter((e) => SPAWN_EVENTS.has(e.type)).length;
  const per = mine.filter((e) => e.type === 'model_selected').length;
  const unleased = leaseCount === 0 ? spawns : Math.max(0, per - leaseCount);
  return unleased > 0 ? [{ type: 'spawns_without_lease', phase: k, spawn_events: leaseCount === 0 ? spawns : per, leases: leaseCount, message: `phase ${k}: ${unleased} spawn event(s) with no \`dispatch begin\` lease; its time is not measured (rigour.md rule 7)` }] : [];
}

// Live windows of a phase: count, minutes (lease spans) and the reasons recorded on second-or-later windows.
function windows(cwd, events, phase) {
  const mine = load(cwd).filter((l) => l.phase === phaseKey(phase) && l.role === 'window');
  const span = mine.reduce((a, l) => a + Math.max(0, (l.end ? ms(l.end) : leaseLast(l, events)) - ms(l.begin)), 0);
  return { count: mine.length, minutes: Math.round((span / 60000) * 10) / 10, reasons: mine.map((l) => l.begin_reason).filter(Boolean) };
}

// Earliest lease begin (ms) of the phase, or null.
const firstBegin = (cwd, phase) => { const b = load(cwd).filter((l) => l.phase === phaseKey(phase)).map((l) => ms(l.begin)).filter((t) => !Number.isNaN(t)); return b.length ? Math.min(...b) : null; };

module.exports = { windows, unleasedSpawns, firstBegin, begin, end, reapDead, spend, load, leasePath, closeEvent, DEFAULT_TTL_MIN, WINDOW_CLOSE };
