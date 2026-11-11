'use strict';

const { isPlainObject } = require('./project-deploy-fs.js');

const PERM_KEYS = ['allow', 'deny', 'ask'];
const isStr = (v) => typeof v === 'string';
const strArray = (v) => Array.isArray(v) && v.every(isStr);

const hookOk = (t) => isPlainObject(t) && isStr(t.event) && isStr(t.command) && (t.matcher === undefined || isStr(t.matcher));

function settingsOk(s) {
  if (s === undefined || s === null) return true;
  if (!isPlainObject(s)) return false;
  if (s.hooks !== undefined && !(Array.isArray(s.hooks) && s.hooks.every(hookOk))) return false;
  if (s.permissions === undefined) return true;
  return isPlainObject(s.permissions) && PERM_KEYS.every((k) => s.permissions[k] === undefined || strArray(s.permissions[k]));
}

function manifestShapeError(manifest) {
  const { files } = manifest;
  if (files !== undefined && !(isPlainObject(files) && Object.values(files).every(isPlainObject))) return 'files';
  if (!settingsOk(manifest.settings)) return 'settings';
  return null;
}

module.exports = { manifestShapeError };
