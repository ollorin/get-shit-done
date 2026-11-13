'use strict';
// Phase budget: class, limits (config workflow.budget.<class>), and spend from the execution log.
// Contract: references/rigour.md rule 7. Spend is `phase_spend` events (`budget spend --phase N`, one per dispatch at spawn);
// `phase_spend_done` (`--done`, at the child's return) only extends the wall window and is not a dispatch.
const fs = require('fs');
const path = require('path');
const { evPhase, phaseKey } = require('./roadmap-dispatch.js');

const DEFAULTS = {
  spike: { wall_minutes: 45, dispatches: 6 },
  standard: { wall_minutes: 90, dispatches: 12 },
  risk: { wall_minutes: 150, dispatches: 20 },
};

const rawConfig = (cwd) => {
  try { return JSON.parse(fs.readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf8')) || {}; } catch { return {}; }
};

const budgetClass = ({ rigour, riskAddons }) => (rigour === 'spike' ? 'spike' : riskAddons ? 'risk' : 'standard');

function limits(cwd, cls) {
  const cfg = (((rawConfig(cwd).workflow || {}).budget || {})[cls]) || {};
  const pos = (v, d) => (typeof v === 'number' && v > 0 ? v : d);
  return { wall_minutes: pos(cfg.wall_minutes, DEFAULTS[cls].wall_minutes), dispatches: pos(cfg.dispatches, DEFAULTS[cls].dispatches) };
}

function budgetFields(cwd, cls) {
  const l = limits(cwd, cls);
  return { budget_class: cls, budget_wall_minutes: l.wall_minutes, budget_dispatches: l.dispatches };
}

// Wall time = closed work windows + the open one. A window opens at phase_start (or gap_cycle) and closes at the next
// record event of the phase (complete, parked, incomplete, retry, failed, death). A phase_start while a window
// is open closes the old one at the phase's last logged event. The open window is measured to the phase's last logged
// event (a spend at each spawn, a spend_done at each return), never to the clock: a dead session must not keep spending.
// A window with no phase_start (standalone plan-phase / execute-phase) opens at the first spend event. Idle time never counts.
const OPEN = new Set(['phase_start', 'gap_cycle']);
const CLOSE = new Set(['phase_complete', 'phase_parked', 'phase_incomplete', 'phase_retry', 'phase_failed', 'phase_coordinator_death']);

function spend(events, phase) {
  const k = phaseKey(phase);
  let closedMs = 0;
  let start = null;
  let last = null;
  let dispatches = 0;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || evPhase(e) !== k) continue;
    const t = Date.parse(e.timestamp);
    const reset = e.type === 'phase_complete' || (e.type === 'phase_parked' && e.reason === 'budget_exceeded');
    if (OPEN.has(e.type) && !Number.isNaN(t)) {
      if (start !== null) closedMs += Math.max(0, (last === null ? t : last) - start);
      start = t;
    } else if (CLOSE.has(e.type) && start !== null && !Number.isNaN(t)) {
      closedMs += Math.max(0, t - start);
      start = null;
    }
    if (reset) { closedMs = 0; dispatches = 0; start = null; }
    else if (e.type === 'phase_spend' || e.type === 'phase_spend_done') {
      if (start === null && !Number.isNaN(t)) start = t;
      if (e.type === 'phase_spend') dispatches += 1;
    }
    if (!Number.isNaN(t)) last = t;
  }
  const ms = closedMs + (start === null ? 0 : Math.max(0, (last === null ? start : last) - start));
  return { wall_minutes_spent: Math.round((ms / 60000) * 10) / 10, dispatches_spent: dispatches };
}

function status({ cwd, phase, cls, events, now }) {
  const l = limits(cwd, cls);
  const s = spend(events, phase);
  const ratio = Math.max(s.wall_minutes_spent / l.wall_minutes, s.dispatches_spent / l.dispatches);
  const pct = Math.round(ratio * 1000) / 10;
  return { phase: phaseKey(phase), budget_class: cls, ...s, budget_wall_minutes: l.wall_minutes, budget_dispatches: l.dispatches, pct, warn: ratio >= 0.8, breach: ratio >= 1 };
}

module.exports = { DEFAULTS, budgetClass, budgetFields, limits, spend, status };
