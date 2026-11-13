'use strict';
// Phase budget: class, wall-minute limits (config workflow.budget.<class>.wall_minutes), and spend from the execution log.
// Contract: references/rigour.md rule 7. Spend is `phase_spend` events (`budget spend --phase N`, one per dispatch at spawn, counted as a metric only; breach/warn use wall minutes alone);
const fs = require('fs');
const path = require('path');
const { evPhase, phaseKey } = require('./roadmap-dispatch.js');

const DEFAULTS = {
  spike: { wall_minutes: 45 },
  standard: { wall_minutes: 90 },
  risk: { wall_minutes: 150 },
};

const rawConfig = (cwd) => {
  try { return JSON.parse(fs.readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf8')) || {}; } catch { return {}; }
};

const budgetClass = ({ rigour, riskAddons }) => (rigour === 'spike' ? 'spike' : riskAddons ? 'risk' : 'standard');

function limits(cwd, cls) {
  const cfg = (((rawConfig(cwd).workflow || {}).budget || {})[cls]) || {};
  const pos = (v, d) => (typeof v === 'number' && v > 0 ? v : d);
  return { wall_minutes: pos(cfg.wall_minutes, DEFAULTS[cls].wall_minutes) };
}

function budgetFields(cwd, cls) {
  const l = limits(cwd, cls);
  return { budget_class: cls, budget_wall_minutes: l.wall_minutes };
}

// Wall time = closed work windows + the open one. A window opens at phase_start (or gap_cycle) and closes at the next
// record event of the phase (complete, parked, incomplete, retry, failed, death). A phase_start while a window
// is open closes the old one at the phase's last logged event. The open window is measured to the phase's last logged
// event (a spend at each spawn), never to the clock: a dead session must not keep spending.
// A window with no phase_start (standalone plan-phase / execute-phase) opens at the first spend event. Idle time never counts.
const OPEN = new Set(['phase_start', 'gap_cycle']);
const CLOSE = new Set(['phase_complete', 'phase_parked', 'phase_incomplete', 'phase_retry', 'phase_failed', 'phase_coordinator_death']);

function spend(events, phase) {
  const k = phaseKey(phase);
  let closedMs = 0;
  let start = null;
  let last = null;
  let dispatches = 0;
  let final = null;
  let parked = false;
  let bankedMs = 0;
  let bankedDispatches = 0;
  const bank = () => { bankedMs += closedMs + (start === null ? 0 : Math.max(0, (last === null ? start : last) - start)); bankedDispatches += dispatches; };
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || evPhase(e) !== k) continue;
    const t = Date.parse(e.timestamp);
    // A phase parked after its closure cycle ran out is retried only on the owner's word (`roadmap next --retry-parked`): that retry
    // is a new window. A park waiting on a human answer (human_needed) is a pause in the same window.
    const retry = parked && OPEN.has(e.type);
    if (e.type === 'phase_parked' && e.reason === 'gaps_after_closure_cycle') parked = true;
    if (retry) { bank(); closedMs = 0; dispatches = 0; start = null; parked = false; }
    const reset = e.type === 'phase_complete' || (e.type === 'phase_parked' && e.reason === 'budget_exceeded');
    if (OPEN.has(e.type) && !Number.isNaN(t)) {
      if (start !== null) closedMs += Math.max(0, (last === null ? t : last) - start);
      start = t;
    } else if (CLOSE.has(e.type) && start !== null && !Number.isNaN(t)) {
      closedMs += Math.max(0, t - start);
      start = null;
    }
    if (OPEN.has(e.type) || e.type === 'phase_spend') final = null;
    if (reset) {
      bank();
      closedMs = 0; dispatches = 0; start = null;
      final = e.type === 'phase_complete' && typeof e.dispatches_spent === 'number' ? e : null;
    } else if (e.type === 'phase_spend') {
      if (start === null && !Number.isNaN(t)) start = t;
      dispatches += 1;
    }
    if (!Number.isNaN(t)) last = t;
  }
  const ms = closedMs + (start === null ? 0 : Math.max(0, (last === null ? start : last) - start));
  const min = (x) => Math.round((x / 60000) * 10) / 10;
  return { wall_minutes_spent: min(ms), dispatches_spent: dispatches, total_wall_minutes: min(bankedMs + ms), total_dispatches: bankedDispatches + dispatches, final };
}

function status({ cwd, phase, cls, events, now }) {
  const l = limits(cwd, cls);
  const { final, ...s } = spend(events, phase);
  // After `phase complete` the window resets to zero; the numbers the phase ended on are in its phase_complete event.
  if (final) {
    return { phase: phaseKey(phase), budget_class: final.budget_class || cls, wall_minutes_spent: final.wall_minutes_spent, dispatches_spent: final.dispatches_spent, total_wall_minutes: final.total_wall_minutes === undefined ? final.wall_minutes_spent : final.total_wall_minutes, total_dispatches: final.total_dispatches === undefined ? final.dispatches_spent : final.total_dispatches, budget_wall_minutes: final.budget_wall_minutes, pct: final.pct, warn: final.warn === true, breach: final.breach === true, final: true };
  }
  const ratio = s.wall_minutes_spent / l.wall_minutes;
  const pct = Math.round(ratio * 1000) / 10;
  return { phase: phaseKey(phase), budget_class: cls, ...s, budget_wall_minutes: l.wall_minutes, pct, warn: ratio >= 0.8, breach: ratio >= 1 };
}

module.exports = { DEFAULTS, budgetClass, budgetFields, limits, spend, status };
