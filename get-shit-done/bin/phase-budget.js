'use strict';
// Phase budget: class, wall-minute limits (config workflow.budget.<class>.wall_minutes), and spend from the execution log.
// Contract: references/rigour.md rule 7. Spend is measured from leases only; a phase that never called `dispatch` reports it unknown (null) and cannot warn or breach.
const fs = require('fs');
const path = require('path');
const { evPhase, phaseKey } = require('./roadmap-dispatch.js');
const leases = require('./dispatch-lease.js');

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

// Spend comes from dispatch leases only (dispatch-lease.js); a phase with no lease reports it as unknown (null), never zero.
// After `phase complete` the window resets; the numbers the phase ended on are in its last phase_complete event (`final`).
const REOPEN = new Set(['phase_start', 'gap_cycle', 'dispatch_begin']);
function finalOf(events, phase) {
  const k = phaseKey(phase);
  let final = null;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || evPhase(e) !== k) continue;
    if (REOPEN.has(e.type)) final = null;
    else if (e.type === 'phase_complete' && typeof e.dispatches_spent === 'number') final = e;
    else if (e.type === 'phase_complete' || (e.type === 'phase_parked' && e.reason === 'budget_exceeded')) final = null;
  }
  return final;
}

function status({ cwd, phase, cls, events }) {
  const l = limits(cwd, cls);
  const final = finalOf(events, phase);
  // After `phase complete` the window resets to zero; the numbers the phase ended on are in its phase_complete event.
  if (final) {
    return { phase: phaseKey(phase), budget_class: final.budget_class || cls, wall_minutes_spent: final.wall_minutes_spent, dispatches_spent: final.dispatches_spent, total_wall_minutes: final.total_wall_minutes === undefined ? final.wall_minutes_spent : final.total_wall_minutes, total_dispatches: final.total_dispatches === undefined ? final.dispatches_spent : final.total_dispatches, budget_wall_minutes: final.budget_wall_minutes, pct: final.pct, warn: final.warn === true, breach: final.breach === true, final: true };
  }
  const s = leases.spend(cwd, events, phase);
  if (!s) return { phase: phaseKey(phase), budget_class: cls, wall_minutes_spent: null, dispatches_spent: null, total_wall_minutes: null, total_dispatches: null, budget_wall_minutes: l.wall_minutes, pct: null, warn: false, breach: false, spend_known: false };
  const ratio = s.wall_minutes_spent / l.wall_minutes;
  const pct = Math.round(ratio * 1000) / 10;
  return { phase: phaseKey(phase), budget_class: cls, ...s, budget_wall_minutes: l.wall_minutes, pct, warn: ratio >= 0.8, breach: ratio >= 1 };
}

const ttlMinutes = (cwd) => { const v = ((rawConfig(cwd).workflow || {}).dispatch || {}).ttl_minutes; return typeof v === 'number' && v > 0 ? v : leases.DEFAULT_TTL_MIN; };

module.exports = { ttlMinutes, DEFAULTS, budgetClass, budgetFields, limits, status };
