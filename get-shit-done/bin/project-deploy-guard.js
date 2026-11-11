'use strict';

// Hooks defined only in .claude/settings.local.json are never read (design 4.4), so a script
// run only by such a hook is not guarded. Clauses (a)-(d) of referencesDest widen matching for
// hooks that are read, so a script named in another spelling is still caught.
// Limits, left unguarded on purpose: a path assembled at run time (`NAME=gate; bash ./$NAME.sh`,
// `node -e` with split strings) is not visible statically, and an option carrying a path
// (`--config=scripts/`) is not a path token. The boundary there is human confirmation (identity
// guard, typed APPLY) and the PreToolUse deny Phase H recommends.

const { fsFold, isPlainObject } = require('./project-deploy-fs.js');
const { detectSession, guardFailures } = require('./project-deploy-session.js');

const GUARDED_TOPS = new Set(['.husky', '.githooks']);
const TOKEN_SPLIT_RE = /[\s"'`/;&|$()]+/;
const PATH_SPLIT_RE = /[\s"'`;&|()]+/;
const GLOB_RE = /[*?[]/;
const LITERAL_RE = /[^*?[\]]/;
const ROOT_PREFIX_RE = /^(?:\.\/|\$\{?\w+\}?\/)+/;

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

// Matched by dynamic programming, not a regex: a regex for `*a*a*…` backtracks exponentially
// (30 groups against a 70-char path ran past 3 s). Globs over GLOB_MAX chars match nothing.
const GLOB_MAX = 256;

function classItem(chars, i) {
  const end = chars.indexOf(']', i + 1);
  if (end < 0) return null;
  try {
    return { item: { t: 'c', re: new RegExp(`^[${chars.slice(i + 1, end).join('')}]$`) }, next: end };
  } catch {
    return null;
  }
}

function parseGlob(glob) {
  const chars = [...glob];
  const items = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '*') items.push({ t: '*' });
    else if (c === '?') items.push({ t: '?' });
    else if (c === '[') {
      const cls = classItem(chars, i);
      if (cls === null) return null;
      items.push(cls.item);
      i = cls.next;
    } else items.push({ t: 'l', c });
  }
  return items;
}

function stepDp(item, dp, s) {
  const next = new Array(dp.length).fill(false);
  for (let j = 0; j < dp.length; j++) {
    if (item.t === '*') next[j] = dp[j] || (j > 0 && s[j - 1] !== '/' && next[j - 1]);
    else if (j > 0 && dp[j - 1]) {
      const ch = s[j - 1];
      next[j] = item.t === '?' ? ch !== '/'
        : item.t === 'l' ? ch === item.c
          : item.re.test(ch);
    }
  }
  return next;
}

// Matches `glob` against `path` as the whole path or a `/`-aligned suffix of it (same meaning as the former regex).
function globMatch(glob, path) {
  const items = glob.length > GLOB_MAX ? null : parseGlob(glob.replace(/^\/+/, ''));
  if (items === null) return false;
  const s = [...path];
  const starts = Array.from({ length: s.length + 1 }, (_, j) => j === 0 || s[j - 1] === '/');
  return items.reduce((dp, item) => stepDp(item, dp, s), starts).at(-1);
}

// Command tokens keep their directories; a project-root prefix (`./`, `$CLAUDE_PROJECT_DIR/`) is dropped.
const pathTokensOf = (cmd) => cmd.split(PATH_SPLIT_RE).map((t) => t.replace(ROOT_PREFIX_RE, ''));

function referencesDest(command, canon) {
  const cmd = fsFold(command).replace(/\\/g, '/');
  const dest = fsFold(canon);
  const slash = dest.lastIndexOf('/');
  const base = dest.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : null;
  const dir = slash < 0 ? null : dest.slice(0, slash + 1);
  const words = cmd.split(TOKEN_SPLIT_RE);
  const paths = pathTokensOf(cmd);
  return cmd.includes(dest)
    || (dir !== null && paths.some((t) => t.startsWith(dir)))
    || words.includes(base)
    || (stem !== null && words.includes(stem))
    || paths.some((t) => GLOB_RE.test(t) && LITERAL_RE.test(t) && globMatch(t, dest));
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

module.exports = { hookCommandsOf, triplesCommands, guardedSet, refusalOf, globMatch, GLOB_MAX };
