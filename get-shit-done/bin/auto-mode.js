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

// One rule for "no human is answering": the first matching source wins and is reported.
function resolveAutoMode(cwd, argv, env) {
  const args = Array.isArray(argv) ? argv : [];
  const e = env || {};
  if (args.includes(FLAG)) return { auto_mode: true, auto_mode_source: 'flag' };
  if (e.GSD_AUTONOMOUS === '1' || e.GSD_AUTONOMOUS === 'true') return { auto_mode: true, auto_mode_source: 'env' };
  const cfg = readConfig(cwd);
  if (cfg.mode === 'yolo') return { auto_mode: true, auto_mode_source: 'config_mode' };
  const wf = cfg.workflow && typeof cfg.workflow === 'object' ? cfg.workflow : {};
  if (isTrue(wf.auto_advance)) return { auto_mode: true, auto_mode_source: 'config_auto_advance' };
  if (isTrue(wf._auto_chain_active)) return { auto_mode: true, auto_mode_source: 'config_auto_chain' };
  return { auto_mode: false, auto_mode_source: null };
}

module.exports = { resolveAutoMode };
