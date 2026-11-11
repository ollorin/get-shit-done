'use strict';

const { fsFold, isPlainObject } = require('./project-deploy-fs.js');
const { detectSession, guardFailures } = require('./project-deploy-session.js');

const GUARDED_TOPS = new Set(['.husky', '.githooks']);

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

function guardedSet({ canonDests, hookCommands, presetFlags }) {
  const commands = hookCommands.map(fsFold);
  return new Set(canonDests
    .filter(({ file, canon, h1 }) => h1
      || GUARDED_TOPS.has(fsFold(canon.split('/')[0]))
      || presetFlags.has(file)
      || commands.some((c) => c.includes(fsFold(canon))))
    .map(({ file }) => file));
}

function refusalOf({ command, guarded, env, session, presetFlag, exempt }) {
  if (command === 'diff' || guarded.length === 0) return null;
  if (!presetFlag && exempt) return null;
  const failed = guardFailures(env, session === undefined ? detectSession() : session);
  if (failed.length === 0) return null;
  return presetFlag
    ? { reason: 'preset-dir requires a human terminal', paths: guarded, failed }
    : { reason: 'guardrail paths change only from a terminal outside an agent session', paths: guarded, failed };
}

module.exports = { hookCommandsOf, triplesCommands, guardedSet, refusalOf };
