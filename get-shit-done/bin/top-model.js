'use strict';
// The one configured "best available model" alias (config models.top, optional models.top_fallback).
// Legacy ruling_model / ruling_model_fallback are read only while models.top is absent.
const fs = require('fs');
const path = require('path');

const ALIAS = /^[a-z][a-z0-9-]*$/;
const isAlias = (v) => typeof v === 'string' && ALIAS.test(v) && !v.startsWith('claude-');

function readConfig(cwd) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

// {ok:true, top, fallback, legacy} | {ok:false, error}
function resolveTop(cwd) {
  const cfg = readConfig(cwd);
  const models = cfg.models && typeof cfg.models === 'object' ? cfg.models : {};
  const legacy = models.top === undefined && cfg.ruling_model !== undefined;
  const top = models.top !== undefined ? models.top : legacy ? cfg.ruling_model : 'opus';
  const fb = legacy ? cfg.ruling_model_fallback : models.top_fallback;
  if (models.top !== undefined && !isAlias(top)) return { ok: false, error: 'models.top must be an alias' };
  if (models.top_fallback !== undefined && !isAlias(fb)) return { ok: false, error: 'models.top_fallback must be an alias' };
  const topValue = typeof top === 'string' && top ? top : 'opus';
  return { ok: true, top: topValue, fallback: typeof fb === 'string' && fb ? fb : topValue, legacy };
}

module.exports = { resolveTop, isAlias };
