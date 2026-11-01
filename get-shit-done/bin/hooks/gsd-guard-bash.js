#!/usr/bin/env node
/**
 * GSD Bash guard (PreToolUse, Bash).
 *
 * Deny (exit 2, reason names the rule):
 *   no-verify      git commit|push --no-verify, git commit -n
 *   no-check       deno test|task --no-check
 *   hooks-path     core.hooksPath set via git -c, --config-env, `git config`, or
 *                  GIT_CONFIG_COUNT/KEY_n / GIT_CONFIG_PARAMETERS assignments (hook bypass)
 *   In a GSD project's PRIMARY worktree only (git toplevel has .planning/, not a linked worktree):
 *   git-stash      git stash (except list|show)
 *   git-reset-hard git reset --hard
 *   git-clean      git clean -f*
 *   git-rebase     git rebase
 * Log only (never deny): wait-loop, ping-sleep, tail-follow.
 *
 * The command is tokenised quote-aware (heredoc bodies, quoted text, comments and
 * redirect targets are never command words), `$(..)`, backticks and `sh -c` strings are
 * parsed recursively. Fails open: any error allows and logs one line.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { runHook, clip } = require('./gsd-hook-lib.js');

// ---- shell tokeniser -------------------------------------------------------

// Returns { cmds: string[][], end }. Each command is its list of unquoted words.
function parseShell(s, start = 0, inSub = false) {
  const cmds = [];
  let cur = [];
  let word = '';
  let has = false;
  let skipNext = false;
  const heredocs = [];
  let i = start;

  const endWord = () => {
    if (has) {
      if (skipNext) skipNext = false;
      else cur.push(word);
    }
    word = '';
    has = false;
  };
  const endCmd = () => {
    endWord();
    skipNext = false;
    if (cur.length) cmds.push(cur);
    cur = [];
  };
  const sub = (from) => {
    const r = parseShell(s, from, true);
    for (const c of r.cmds) cmds.push(c);
    return r.end;
  };
  const backtick = (from) => {
    let j = from;
    while (j < s.length && s[j] !== '`') j += s[j] === '\\' ? 2 : 1;
    for (const c of parseShell(s.slice(from, j)).cmds) cmds.push(c);
    return j + 1;
  };
  const readHeredocBodies = () => {
    while (heredocs.length) {
      const { delim, strip } = heredocs.shift();
      while (i < s.length) {
        let nl = s.indexOf('\n', i);
        if (nl === -1) nl = s.length;
        let line = s.slice(i, nl);
        i = Math.min(nl + 1, s.length);
        if (strip) line = line.replace(/^\t+/, '');
        if (line === delim) break;
      }
    }
  };

  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      if (s[i + 1] === '\n') { i += 2; continue; }
      if (i + 1 < s.length) { word += s[i + 1]; has = true; }
      i += 2;
    } else if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j === -1 ? s.length : j;
      word += s.slice(i + 1, end);
      has = true;
      i = end + 1;
    } else if (c === '"') {
      i++;
      has = true;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) { word += s[i + 1]; i += 2; }
        else if (s[i] === '$' && s[i + 1] === '(') { word += '$SUB'; i = sub(i + 2); }
        else if (s[i] === '`') { word += '$SUB'; i = backtick(i + 1); }
        else { word += s[i]; i++; }
      }
      i++;
    } else if (c === '$' && s[i + 1] === '(') {
      word += '$SUB';
      has = true;
      i = sub(i + 2);
    } else if (c === '`') {
      word += '$SUB';
      has = true;
      i = backtick(i + 1);
    } else if (c === ' ' || c === '\t') {
      endWord();
      i++;
    } else if (c === '\n') {
      endCmd();
      i++;
      readHeredocBodies();
    } else if (c === '#' && !has) {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (c === ';' || c === '|' || c === '&') {
      if (c === '&' && s[i + 1] === '>') { endWord(); skipNext = true; i += s[i + 2] === '>' ? 3 : 2; continue; }
      endCmd();
      i += (s[i + 1] === c || (c === '|' && s[i + 1] === '&')) ? 2 : 1;
    } else if (c === '(') {
      endCmd();
      i++;
    } else if (c === ')') {
      endCmd();
      i++;
      if (inSub) return { cmds, end: i };
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      endWord();
      i += 2;
      const strip = s[i] === '-';
      if (strip) i++;
      while (s[i] === ' ' || s[i] === '\t') i++;
      let delim = '';
      while (i < s.length && !/[\s;|&<>()]/.test(s[i])) {
        if (s[i] === "'" || s[i] === '"') {
          const q = s[i];
          const j = s.indexOf(q, i + 1);
          const end = j === -1 ? s.length : j;
          delim += s.slice(i + 1, end);
          i = end + 1;
        } else if (s[i] === '\\') { delim += s[i + 1] || ''; i += 2; }
        else { delim += s[i]; i++; }
      }
      heredocs.push({ delim, strip });
    } else if (c === '<' || c === '>') {
      if (c === '<' && s[i + 1] === '(') { endWord(); i += 2; continue; }
      if (c === '>' && s[i + 1] === '(') { endWord(); i += 2; continue; }
      if (has && /^\d+$/.test(word)) { word = ''; has = false; } else endWord();
      i++;
      if (s[i] === c || s[i] === '|') i++;
      if (c === '<' && s[i] === '<') i++;
      if (s[i] === '&') i++;
      skipNext = true;
    } else {
      word += c;
      has = true;
      i++;
    }
  }
  endCmd();
  return { cmds, end: i };
}

// ---- command classification ------------------------------------------------

const KEYWORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'time', 'while', 'until', 'for', 'case', 'esac']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);

// Strips env assignments and wrappers (rtk, env, sudo, timeout, ...). Returns the real
// command words plus facts about the wrappers. Shell `-c STR` and eval are returned as
// `inner` strings for recursive analysis.
function unwrap(words) {
  let i = 0;
  const facts = { timeout: false, keywordHead: null, inner: [], assigns: [] };
  for (let guard = 0; guard < 20 && i < words.length; guard++) {
    const w = words[i];
    const base = path.basename(w);
    if (KEYWORDS.has(w)) { if (!facts.keywordHead) facts.keywordHead = w; i++; continue; }
    if (/^[A-Za-z_]\w*=/.test(w)) { facts.assigns.push(w); i++; continue; }
    if (base === 'export' || base === 'declare' || base === 'typeset' || base === 'local') {
      for (i++; i < words.length; i++) if (/^[A-Za-z_]\w*=/.test(words[i])) facts.assigns.push(words[i]);
      break;
    }
    if (base === 'rtk') { i++; if (words[i] === 'proxy') i++; continue; }
    if (['command', 'exec', 'nohup', 'sudo', 'builtin', 'noglob'].includes(base)) { i++; continue; }
    if (base === 'env') {
      i++;
      while (i < words.length && (words[i].startsWith('-') || /^\w+=/.test(words[i]))) {
        if (/^\w+=/.test(words[i])) facts.assigns.push(words[i]);
        i += words[i] === '-u' || words[i] === '-C' ? 2 : 1;
      }
      continue;
    }
    if (base === 'nice') { i++; if (words[i] === '-n') i += 2; else if (/^-\d+$/.test(words[i] || '')) i++; continue; }
    if (base === 'timeout' || base === 'gtimeout') {
      facts.timeout = true;
      i++;
      while (i < words.length && words[i].startsWith('-')) i += /^(-k|-s|--kill-after|--signal)$/.test(words[i]) ? 2 : 1;
      i++; // duration
      continue;
    }
    if (SHELLS.has(base)) {
      const ci = words.findIndex((x, k) => k > i && /^-[a-z]*c[a-z]*$/.test(x));
      if (ci !== -1 && words[ci + 1] !== undefined) facts.inner.push(words[ci + 1]);
      return { rest: [], facts };
    }
    if (base === 'eval') { facts.inner.push(words.slice(i + 1).join(' ')); return { rest: [], facts }; }
    break;
  }
  return { rest: words.slice(i), facts };
}

// Expand a command list with the commands of every nested `sh -c` / eval string.
function flatten(cmds, depth = 0) {
  const out = [];
  for (const words of cmds) {
    const { rest, facts } = unwrap(words);
    out.push({ words, rest, facts });
    if (depth < 4) {
      for (const inner of facts.inner) out.push(...flatten(parseShell(inner).cmds, depth + 1));
    }
  }
  return out;
}

const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);

// Splits `git [global opts] sub args...` -> { dirs, configs, sub, args } (rest[0] must be git).
// configs: the `name=value` strings given via -c / --config-env.
function parseGit(rest) {
  const dirs = [];
  const configs = [];
  let i = 1;
  while (i < rest.length && rest[i].startsWith('-')) {
    const o = rest[i];
    if (o === '-C') { dirs.push(rest[i + 1] || ''); i += 2; }
    else if (o === '-c' || o === '--config-env') { configs.push(rest[i + 1] || ''); i += 2; }
    else if (o.startsWith('--config-env=')) { configs.push(o.slice('--config-env='.length)); i++; }
    else if (o.startsWith('-c') && o.length > 2 && o[2] !== '-') { configs.push(o.slice(2)); i++; }
    else if (GIT_OPTS_WITH_VALUE.has(o)) i += 2;
    else i++;
  }
  return { dirs, configs, sub: rest[i], args: rest.slice(i + 1) };
}

const COMMIT_VALUE_SHORT = new Set(['m', 'F', 'C', 'c', 't', 'S', 'u']);
const COMMIT_VALUE_LONG = new Set(['--message', '--file', '--author', '--date', '--cleanup', '--template', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--trailer', '--pathspec-from-file']);

function commitHasShortN(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return false;
    if (COMMIT_VALUE_LONG.has(a)) { i++; continue; }
    if (/^-[A-Za-z]/.test(a) && !a.startsWith('--')) {
      for (let k = 1; k < a.length; k++) {
        if (a[k] === 'n') return true;
        if (COMMIT_VALUE_SHORT.has(a[k])) { if (k === a.length - 1) i++; break; }
      }
    }
  }
  return false;
}

const PUSH_VALUE_LONG = new Set(['--push-option', '--repo', '--receive-pack', '--exec']);

// Option values (`-m "--no-verify"`) are data, not flags.
function hasNoVerify(args, sub) {
  const push = sub === 'push';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return false;
    if (push ? (PUSH_VALUE_LONG.has(a) || a === '-o') : COMMIT_VALUE_LONG.has(a)) { i++; continue; }
    if (a.length >= 8 && a.startsWith('--no-ver') && '--no-verify'.startsWith(a)) return true;
    if (/^-[A-Za-z]+$/.test(a)) {
      const last = a[a.length - 1];
      if (push ? last === 'o' : COMMIT_VALUE_SHORT.has(last)) i++;
    }
  }
  return false;
}

const HOOKS_PATH_RE = /^core\.hookspath(?:=|$)/i;
const HOOKS_PATH_REASON = 'core.hooksPath redirects git hooks and bypasses the pre-commit/pre-push checks. Fix the failing hook instead; never bypass it.';

function configSetsHooksPath(rest) {
  const { sub, args, configs } = parseGit(rest);
  if (configs.some(c => HOOKS_PATH_RE.test(c))) return true;
  if (sub !== 'config') return false;
  if (args.some(a => ['--get', '--get-all', '--get-regexp', '--list', '-l', '--unset', '--unset-all', '--get-urlmatch'].includes(a))) return false;
  const pos = args.filter(a => !a.startsWith('-'));
  if (pos[0] === 'set') pos.shift();
  return HOOKS_PATH_RE.test(pos[0] || '') && (pos.length >= 2 || args.some(a => a === '--add' || a === '--replace-all'));
}

// Assignment words (`VAR=val` before a command, env, export) that inject core.hooksPath.
function assignsHooksPath(assigns) {
  return assigns.some(a => {
    const eq = a.indexOf('=');
    const name = a.slice(0, eq);
    const val = a.slice(eq + 1);
    if (/^GIT_CONFIG_KEY_\d+$/.test(name)) return HOOKS_PATH_RE.test(val);
    return name === 'GIT_CONFIG_PARAMETERS' && /core\.hookspath/i.test(val);
  });
}

// Rules needing no repository context.
function contextFreeRule(rest, facts) {
  const head = path.basename(rest[0] || '');
  if (assignsHooksPath((facts && facts.assigns) || []) || (head === 'git' && configSetsHooksPath(rest))) {
    return { rule: 'hooks-path', reason: HOOKS_PATH_REASON };
  }
  if (head === 'git') {
    const { sub, args } = parseGit(rest);
    if ((sub === 'commit' || sub === 'push') && hasNoVerify(args, sub)) {
      return { rule: 'no-verify', reason: `git ${sub} --no-verify skips the pre-commit/pre-push checks. Fix the failing hook instead; never bypass it.` };
    }
    if (sub === 'commit' && commitHasShortN(args)) {
      return { rule: 'no-verify', reason: 'git commit -n is --no-verify and skips the pre-commit checks. Fix the failing hook instead; never bypass it.' };
    }
  }
  if (head === 'deno') {
    let i = 1;
    while (i < rest.length && rest[i].startsWith('-')) i++;
    const sub = rest[i];
    if ((sub === 'test' || sub === 'task') && rest.slice(i + 1).some(a => a === '--no-check' || a.startsWith('--no-check='))) {
      return { rule: 'no-check', reason: `deno ${sub} --no-check skips type checking. Run it without --no-check and fix the type errors.` };
    }
  }
  return null;
}

// Rules that apply only in a GSD project's primary worktree.
function destructiveGitRule(rest) {
  if (path.basename(rest[0] || '') !== 'git') return null;
  const { sub, args } = parseGit(rest);
  const gitAdvice = 'On a shared branch other agents write to the same files. Compare against a base with `git worktree add .tmp/<name> <sha>` and work there, or ask the user.';
  if (sub === 'stash' && !['list', 'show'].includes(args[0])) {
    return { rule: 'git-stash', reason: `git stash rewrites files under other agents and the live runtime. ${gitAdvice}` };
  }
  if (sub === 'reset' && args.some(a => a.length >= 3 && '--hard'.startsWith(a) && a.startsWith('--h'))) {
    return { rule: 'git-reset-hard', reason: `git reset --hard discards uncommitted work of other agents. ${gitAdvice}` };
  }
  if (sub === 'clean') {
    const force = args.some(a => a === '--force' || (/^-[A-Za-z]+$/.test(a) && a.includes('f')));
    const dry = args.some(a => a === '--dry-run' || (/^-[A-Za-z]+$/.test(a) && a.includes('n')));
    if (force && !dry) return { rule: 'git-clean', reason: `git clean -f deletes untracked files other agents may be writing. ${gitAdvice}` };
  }
  if (sub === 'rebase') {
    return { rule: 'git-rebase', reason: `git rebase rewrites history under other agents. ${gitAdvice}` };
  }
  return null;
}

function waitPatterns(entries) {
  const found = [];
  const loop = entries.some(e => e.words[0] === 'until' || e.words[0] === 'while');
  const sleeps = entries.some(e => path.basename(e.rest[0] || '') === 'sleep');
  if (loop && sleeps) found.push({ rule: 'wait-loop', detail: 'until/while loop with sleep' });
  for (const e of entries) {
    const head = path.basename(e.rest[0] || '');
    if (head === 'ping' && e.rest.some(a => a === '-c' || /^-c\d+$/.test(a))) found.push({ rule: 'ping-sleep', detail: 'ping -c used as a sleep' });
    if (head === 'tail' && e.rest.some(a => a === '-f' || a === '-F' || a === '--follow' || /^-[A-Za-z]*[fF][A-Za-z]*$/.test(a)) && !e.facts.timeout) {
      found.push({ rule: 'tail-follow', detail: 'tail -f without timeout' });
    }
  }
  return found;
}

// ---- repository context ----------------------------------------------------

function resolveDir(base, target) {
  if (!target) return base;
  if (target === '~' || target.startsWith('~/')) return path.join(os.homedir(), target.slice(1));
  if (target.includes('$')) return null;
  return path.resolve(base, target);
}

function repoInfo(dir, cache) {
  if (cache.has(dir)) return cache.get(dir);
  let info = null;
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n');
    const [top, gitDir, common] = out;
    const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
    info = {
      top,
      gsd: fs.existsSync(path.join(top, '.planning')),
      primary: real(gitDir) === real(common),
    };
  } catch { info = null; }
  cache.set(dir, info);
  return info;
}

// ---- entry point -----------------------------------------------------------

function evaluate(command, cwd) {
  if (typeof command !== 'string' || !command.trim()) return {};
  const entries = flatten(parseShell(command).cmds);
  const logs = waitPatterns(entries).map(w => ({ ...w, detail: clip(command) }));
  const cache = new Map();
  let dir = cwd || process.cwd();
  for (const e of entries) {
    const head = path.basename(e.rest[0] || '');
    if (head === 'cd' && e.rest.length >= 2) {
      // An unresolvable target ($VAR) makes the repo unknown: the repo-scoped rules then allow.
      dir = dir ? resolveDir(dir, e.rest[1]) : null;
      continue;
    }
    const free = contextFreeRule(e.rest, e.facts);
    if (free) return { deny: `GSD guard [${free.rule}]: ${free.reason}`, rule: free.rule, detail: clip(command), logs };
    const hit = destructiveGitRule(e.rest);
    if (hit) {
      let gitDir = dir;
      for (const d of parseGit(e.rest).dirs) {
        const next = gitDir && resolveDir(gitDir, d);
        gitDir = next;
      }
      const info = gitDir ? repoInfo(gitDir, cache) : null;
      if (info && info.gsd && info.primary) {
        return { deny: `GSD guard [${hit.rule}]: ${hit.reason}`, rule: hit.rule, detail: clip(command), logs };
      }
    }
  }
  return { logs };
}

module.exports = { parseShell, flatten, evaluate };

if (require.main === module) {
  runHook('gsd-guard-bash', data => {
    if (data.tool_name !== 'Bash') return null;
    return evaluate((data.tool_input || {}).command, data.cwd);
  });
}
