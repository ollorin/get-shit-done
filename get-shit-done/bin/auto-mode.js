'use strict';
const fs = require('fs');
const path = require('path');

const FLAG = '--auto';

function readConfig(cwd) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const isTrue = (v) => v === true || v === 'true';

// The gates an unattended run stops at for the owner. Always required; config can only add
// strictness (`require_note`), and an attempt to switch a gate off is ignored and reported.
const OWNER_GATE_KINDS = ['composition', 'roadmap', 'pr'];
function ownerGates(cfg) {
  const wf = cfg.workflow && typeof cfg.workflow === 'object' ? cfg.workflow : {};
  const og = wf.owner_gates && typeof wf.owner_gates === 'object' ? wf.owner_gates : {};
  const ignored = OWNER_GATE_KINDS.filter((k) => og[k] === false || og[k] === 'false');
  const gates = {};
  for (const k of OWNER_GATE_KINDS) gates[k] = { required: true };
  return { gates, require_note: isTrue(og.require_note), ignored_overrides: ignored };
}

// One rule for "no human is answering": the first matching source wins and is reported.
function resolveAutoMode(cwd, argv, env) {
  const args = Array.isArray(argv) ? argv : [];
  const e = env || {};
  const cfg = readConfig(cwd);
  const owner_gates = ownerGates(cfg);
  const on = (source) => ({ auto_mode: true, auto_mode_source: source, owner_gates });
  if (args.includes(FLAG)) return on('flag');
  if (e.GSD_AUTONOMOUS === '1' || e.GSD_AUTONOMOUS === 'true') return on('env');
  if (cfg.mode === 'yolo') return on('config_mode');
  const wf = cfg.workflow && typeof cfg.workflow === 'object' ? cfg.workflow : {};
  if (isTrue(wf.auto_advance)) return on('config_auto_advance');
  if (isTrue(wf._auto_chain_active)) return on('config_auto_chain');
  return { auto_mode: false, auto_mode_source: null, owner_gates };
}

module.exports = { resolveAutoMode, OWNER_GATE_KINDS };
