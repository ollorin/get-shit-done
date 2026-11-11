'use strict';

// Hooks defined only in .claude/settings.local.json are never read (design 4.4), so a script
// run only by such a hook is not guarded. Clauses (b)-(d) of referencesDest widen matching for
// hooks that are read, so a script named in another spelling is still caught.

const { fsFold, isPlainObject } = require('./project-deploy-fs.js');
const { detectSession, guardFailures } = require('./project-deploy-session.js');

const GUARDED_TOPS = new Set(['.husky', '.githooks']);
const TOKEN_SPLIT_RE = /[\s"'`/;&|$()]+/;
const GLOB_SPLIT_RE = /[\s"'`;&|$()]+/;
const GLOB_RE = /[*?[]/;

const hookCommandsOf = (settings) => (isPlainObject(settings) && isPlainObject(settings.hooks)
  ? Object.values(settings.hooks)
    .flatMap((groups) => (Array.isArray(groups) ? groups.filter(isPlainObject) : []))
    .flatMap((g) => (Array.isArray(g.hooks) ? g.hooks.filter(isPlainObject) : []))
    .filter((h) => typeof h.command === 'string')
    .map((h) => h.command)
  : []);

const triplesCommands = (triples) => (Array.isArray(triples)
  ? triples.filter(isPlainObject).map((t) => t.command).filter((c) => typeof c === 'string')
  : []);

function globToRegExp(glob) {
  const src = [...glob.replace(/^\/+/, '')].map((c) => {
    if (c === '*') return '[^/]*';
    if (c === '?') return '[^/]';
    if (c === '[' || c === ']') return c;
    return c.replace(/[.+^${}()|\\]/g, '\\$&');
  }).join('');
  try {
    return new RegExp(`(^|/)${src}$`);
  } catch {
    return /$^/;
  }
}

function referencesDest(command, canon) {
  const cmd = fsFold(command);
  const dest = fsFold(canon);
  const slash = dest.lastIndexOf('/');
  const base = dest.slice(slash + 1);
  const dir = slash < 0 ? null : dest.slice(0, slash + 1);
  return cmd.includes(dest)
    || (dir !== null && cmd.includes(dir))
    || cmd.split(TOKEN_SPLIT_RE).includes(base)
    || cmd.split(GLOB_SPLIT_RE).some((t) => GLOB_RE.test(t) && globToRegExp(t).test(dest));
}

function guardedSet({ canonDests, hookCommands, presetFlags }) {
  return new Set(canonDests
    .filter(({ file, canon, h1 }) => h1
      || GUARDED_TOPS.has(fsFold(canon.split('/')[0]))
      || presetFlags.has(file)
      || hookCommands.some((c) => referencesDest(c, canon)))
    .map(({ file }) => file));
}

function refusalOf({ command, guarded, env, session, presetFlag, exempt }) {
  if (command === 'diff') return null;
  if (!presetFlag && (guarded.length === 0 || exempt)) return null;
  const failed = guardFailures(env, session === undefined ? detectSession() : session);
  if (failed.length === 0) return null;
  return presetFlag
    ? { reason: 'preset-dir requires a human terminal', paths: guarded, failed }
    : { reason: 'guardrail paths change only from a terminal outside an agent session', paths: guarded, failed };
}

module.exports = { hookCommandsOf, triplesCommands, guardedSet, refusalOf, globToRegExp };
