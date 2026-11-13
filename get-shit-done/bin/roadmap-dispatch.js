'use strict';

// Pure state machine behind `gsd-tools roadmap next|record`. No I/O: the caller
// supplies parsed phases, the execution-log events and a disk-truth function,
// and appends the events these functions return. Disk is truth, the log is the
// audit trail (a phase counts as complete only when `truth(phase)` says so).

const GAP_CYCLE_LIMIT = 1;
const WAITING = 'waiting_owner_approval';

const DEATH_RE = /(rate[- ]limit|session limit|usage limit|hit your limit|limit reached|resets? (at|in)\b|context (window|limit|overflow)|stalled|unresponsive|died)/i;

const phaseKey = (p) => (p == null ? null : String(p).trim().replace(/^0+(?=\d)/, ''));
const evPhase = (e) => phaseKey(e && (e.phase != null ? e.phase : e.data && e.data.phase));

function parseDeps(depends) {
  if (!depends || /^\s*none\b/i.test(depends)) return [];
  return (String(depends).match(/\d+(?:\.\d+)?/g) || []).map(phaseKey);
}

// Fold the event stream into one state per phase.
function foldEvents(events) {
  const by = new Map();
  const get = (k) => {
    if (!by.has(k)) by.set(k, { state: 'none', gap_cycles: 0, started: false, dep_parked: false });
    return by.get(k);
  };
  for (const e of Array.isArray(events) ? events : []) {
    const k = evPhase(e);
    if (k == null || !e.type) continue;
    switch (e.type) {
      case 'phase_start': { const s = get(k); s.state = 'running'; s.started = true; s.dep_parked = false; break; }
      case 'gap_cycle': { const s = get(k); s.state = 'running'; s.gap_cycles += 1; s.started = true; break; }
      case 'phase_retry': get(k).state = 'running'; break;
      case 'phase_complete': { const s = get(k); s.state = 'complete'; s.dep_parked = false; break; }
      case 'phase_incomplete': get(k).state = e.action === 'gap_cycle' ? 'gap_pending' : 'parked'; break;
      // dependency_parked is derived from the dependency's current state, so it is an audit note, never a state.
      case 'phase_parked': { const s = get(k); if (e.reason === 'dependency_parked') s.dep_parked = true; else s.state = 'parked'; break; }
      case 'phase_failed': get(k).state = 'failed'; break;
      default: break;
    }
  }
  return by;
}

function hasEvent(events, type) {
  return (Array.isArray(events) ? events : []).some((e) => e && e.type === type);
}

// Phases the run touched (started or parked/failed) that are not proven complete.
function incompletePhases(events, truth) {
  const folded = foldEvents(events);
  const out = [];
  for (const [k, s] of folded) {
    const involved = s.started || s.state === 'parked' || s.state === 'failed' || s.state === 'gap_pending';
    if (!involved) continue;
    if (s.state === 'complete' && truth(k)) continue;
    out.push(k);
  }
  return out;
}

// blocked = phases parked/failed for their own reason (unless retrying parked) and every transitive
// dependent of one, recomputed from the current state on every call.
function blockedSet(phases, folded, done, retryParked) {
  const blocked = new Set();
  for (const p of phases) {
    const k = phaseKey(p.number);
    if (done.has(k)) continue;
    const st = (folded.get(k) || { state: 'none' }).state;
    if (st === 'failed' || (st === 'parked' && !retryParked)) blocked.add(k);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of phases) {
      const k = phaseKey(p.number);
      if (done.has(k) || blocked.has(k)) continue;
      if (parseDeps(p.depends_on).some((d) => blocked.has(d))) { blocked.add(k); grew = true; }
    }
  }
  return blocked;
}

function resumeState(events, phases, truth) {
  const folded = foldEvents(events);
  const completed = [];
  const doneAll = new Set(phases.map((p) => phaseKey(p.number)).filter((k) => truth(k)));
  const blockedNow = blockedSet(phases, folded, doneAll, false);
  const parked = [];
  const startedIncomplete = [];
  for (const p of phases) {
    const k = phaseKey(p.number);
    if (truth(k)) { completed.push(k); continue; }
    const s = folded.get(k);
    if (blockedNow.has(k)) { parked.push(k); continue; }
    if (!s) continue;
    if (s.state === 'parked' || s.state === 'failed') parked.push(k);
    else if (s.started) startedIncomplete.push(k);
  }
  return { completed_phases: completed, started_incomplete: startedIncomplete, parked };
}

function next(input) {
  const { phases, events, truth } = input;
  const cfg = input.config || {};
  const folded = foldEvents(events);
  const log = [];
  const stateOf = (k) => (folded.get(k) || { state: 'none', gap_cycles: 0 });
  const done = new Set(phases.map((p) => phaseKey(p.number)).filter((k) => truth(k)));

  const blocked = blockedSet(phases, folded, done, input.retryParked);

  const base = { models: { coordinator: cfg.coordinator_model || 'sonnet' } };
  const og = input.ownerGate || {};
  const waiting = (kind, status) => ({ ...base, action: WAITING, status: WAITING, blocked_by_owner_gate: kind, gate_status: status || 'pending', log: [] });
  if (og.blocked_by && og.blocked_by !== 'pr') return waiting(og.blocked_by, og.status);
  for (const p of phases) {
    const k = phaseKey(p.number);
    if (done.has(k) || blocked.has(k)) continue;
    if (!parseDeps(p.depends_on).every((d) => done.has(d))) continue;
    const s = stateOf(k);
    const common = { ...base, phase: k, name: p.name, model: base.models.coordinator };
    if (s.state === 'gap_pending') {
      log.push({ type: 'gap_cycle', phase: k });
      return { ...common, action: 'gap_cycle', args: `${k} --gaps --auto`, log };
    }
    const resumed = s.state === 'running';
    log.push({ type: 'phase_start', phase: k, name: p.name, resumed });
    return { ...common, action: 'spawn_coordinator', args: `${k} --auto${cfg.legacy ? ' --legacy' : ''}`, resumed, log };
  }

  for (const p of phases) {
    const k = phaseKey(p.number);
    if (blocked.has(k) && stateOf(k).state !== 'parked' && stateOf(k).state !== 'failed' && !stateOf(k).dep_parked) {
      log.push({ type: 'phase_parked', phase: k, reason: 'dependency_parked' });
    }
  }
  const remaining = phases.map((p) => phaseKey(p.number)).filter((k) => !done.has(k));
  if (blocked.size > 0) {
    return { ...base, action: 'done', complete: false, parked: [...blocked], completed_phases: [...done], log };
  }
  if (remaining.length > 0) {
    return { ...base, action: 'done', complete: false, error: 'deadlock', parked: remaining, completed_phases: [...done], log };
  }
  if (!input.gateMarked) return { ...base, action: 'integration_gate', log };
  if (og.pr_waiting) return waiting('pr', og.status);
  if (!input.prRecorded) {
    return { ...base, action: 'pr', base_branch: cfg.base_branch || null, has_remote: input.hasRemote === true, log };
  }
  return { ...base, action: 'done', complete: true, completed_phases: [...done], log };
}

function incompleteEvent(k, truth, folded, reason) {
  const gaps = (folded.get(k) || { gap_cycles: 0 }).gap_cycles;
  const action = gaps < GAP_CYCLE_LIMIT ? 'gap_cycle' : 'park';
  const events = [{ type: 'phase_incomplete', phase: k, action, reason, errors: truth.errors || [] }];
  if (action === 'park') events.push({ type: 'phase_parked', phase: k, reason: 'gaps_after_closure_cycle' });
  return { action, events, errors: truth.errors || [] };
}

function record(input) {
  const k = phaseKey(input.phase);
  const truth = input.truth || { complete: false, errors: [] };
  const folded = foldEvents(input.events);
  let result = input.result;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch { /* keep text */ }
  }
  if (typeof result === 'string' || result == null) {
    const text = String(result == null ? '' : result);
    if (DEATH_RE.test(text)) {
      return { phase: k, action: 'respawn_death', events: [{ type: 'phase_coordinator_death', phase: k, reason: text.slice(0, 200) }] };
    }
    return failure(input, k, text || 'unparseable coordinator result');
  }
  switch (result.status) {
    case 'completed':
      if (truth.complete) return { phase: k, action: 'complete', events: [{ type: 'phase_complete', phase: k }] };
      return { phase: k, ...incompleteEvent(k, truth, folded, 'completed_without_disk_truth') };
    case 'gaps_found':
      return { phase: k, ...incompleteEvent(k, truth, folded, 'gaps_found') };
    case 'completed_with_deferrals':
      return { phase: k, action: 'spawn_deferred', deferred: result.deferred || [], events: [] };
    case 'human_needed':
    case 'blocked':
      return { phase: k, action: 'park', events: [{ type: 'phase_parked', phase: k, reason: result.reason || result.status }] };
    case 'failed':
      return failure(input, k, result.error || 'phase failed', result.step);
    default:
      return failure(input, k, `unknown coordinator status: ${result.status}`);
  }
}

function failure(input, k, error, step) {
  const ladder = typeof input.ladder === 'function' ? input.ladder(k, error, step) : { action: 'escalate' };
  if (ladder.action === 'retry' || ladder.action === 'debug') {
    return { phase: k, action: ladder.action, attempts: ladder.attempts, events: [{ type: 'phase_retry', phase: k, ladder: ladder.action, error }] };
  }
  return { phase: k, action: 'fail', attempts: ladder.attempts, events: [{ type: 'phase_failed', phase: k, error, ladder: ladder.action }] };
}

module.exports = { next, record, foldEvents, incompletePhases, resumeState, parseDeps, phaseKey, evPhase, hasEvent, GAP_CYCLE_LIMIT };
