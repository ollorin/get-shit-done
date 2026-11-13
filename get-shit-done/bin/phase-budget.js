'use strict';
// Phase budget: class, limits (config workflow.budget.<class>), and spend from the execution log.
// Contract: references/rigour.md rule 7. Spend is `phase_spend` events carrying a phase; wall time runs
// from the first phase_start of the open window. A window closes on phase_complete or a budget_exceeded park.
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

const budgetClass = ({ rigour, riskDomains, highRiskPlan }) =>
  rigour === 'spike' ? 'spike' : (Array.isArray(riskDomains) && riskDomains.length > 0) || highRiskPlan ? 'risk' : 'standard';

function limits(cwd, cls) {
  const cfg = (((rawConfig(cwd).workflow || {}).budget || {})[cls]) || {};
  const pos = (v, d) => (typeof v === 'number' && v > 0 ? v : d);
  return { wall_minutes: pos(cfg.wall_minutes, DEFAULTS[cls].wall_minutes), dispatches: pos(cfg.dispatches, DEFAULTS[cls].dispatches) };
}

function budgetFields(cwd, cls) {
  const l = limits(cwd, cls);
  return { budget_class: cls, budget_wall_minutes: l.wall_minutes, budget_dispatches: l.dispatches };
}

function spend(events, phase, now) {
  const k = phaseKey(phase);
  let start = null;
  let dispatches = 0;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || evPhase(e) !== k) continue;
    if (e.type === 'phase_complete' || (e.type === 'phase_parked' && e.reason === 'budget_exceeded')) { start = null; dispatches = 0; }
    else if (e.type === 'phase_start' && start === null) { const t = Date.parse(e.timestamp); if (!Number.isNaN(t)) start = t; }
    else if (e.type === 'phase_spend') dispatches += 1;
  }
  return { wall_minutes_spent: start === null ? 0 : Math.max(0, Math.round(((now - start) / 60000) * 10) / 10), dispatches_spent: dispatches };
}

function status({ cwd, phase, cls, events, now }) {
  const l = limits(cwd, cls);
  const s = spend(events, phase, now == null ? Date.now() : now);
  const ratio = Math.max(s.wall_minutes_spent / l.wall_minutes, s.dispatches_spent / l.dispatches);
  const pct = Math.round(ratio * 1000) / 10;
  return { phase: phaseKey(phase), budget_class: cls, ...s, budget_wall_minutes: l.wall_minutes, budget_dispatches: l.dispatches, pct, warn: ratio >= 0.8, breach: ratio >= 1 };
}

module.exports = { DEFAULTS, budgetClass, budgetFields, limits, spend, status };
