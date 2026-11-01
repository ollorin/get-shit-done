#!/usr/bin/env node
/**
 * GSD Managed File Protection Hook
 *
 * PreToolUse hook (Write | Edit) that blocks direct edits to files
 * managed by the GSD installer inside ~/.claude/.
 *
 * Also (Write | Edit | Bash) blocks any agent write to a .claude/settings*.json
 * file or .claude/hooks/ tree at any depth, and any Bash command mentioning disableAllHooks:
 * hooks are the enforcement layer, so an agent must not be able to edit them.
 * Bash writes to the GSD-managed hooks directory (.claude/get-shit-done/bin/hooks/),
 * script-interpreter writes (python/node/perl) and `git apply` / `patch` of a patch
 * that targets those paths are blocked too.
 *
 * This is a guardrail for honest agents, NOT a security boundary: it matches command
 * text and does not chase shell variables, indirection or scripts it cannot read
 * (`D=.claude; echo x > $D/settings.json` passes). Unparseable stdin fails closed.
 *
 * The authoritative file list comes from ~/.claude/gsd-file-manifest.json,
 * which is rewritten on every `node bin/install.js` run. This means the
 * protection always reflects exactly what the installer owns — no manual
 * maintenance required.
 *
 * On a block, Claude receives a clear error message explaining:
 *   - which file was protected
 *   - where the source lives in the GSD project
 *   - the three steps to make the change correctly
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CLAUDE_DIR      = path.join(os.homedir(), '.claude');
const MANIFEST_PATH   = path.join(CLAUDE_DIR, 'gsd-file-manifest.json');
const SOURCE_PATH_FILE = path.join(CLAUDE_DIR, 'gsd-source-path.txt');

// .claude/settings*.json and .claude/hooks/ at any depth, in any project.
function isProtectedConfigPath(p) {
  if (typeof p !== 'string' || !p) return false;
  const norm = p.replace(/\\/g, '/');
  return /(^|\/)\.claude\/settings[^/]*\.json$/.test(norm) || /(^|\/)\.claude\/hooks(\/|$)/.test(norm);
}

// Resolves symlinks on the nearest existing ancestor so a link into .claude/
// cannot launder the path.
function realPathLoose(p) {
  let dir = p;
  const tail = [];
  for (let i = 0; i < 64; i++) {
    try {
      return path.join(fs.realpathSync(dir), ...tail.reverse());
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return p;
      tail.push(path.basename(dir));
      dir = parent;
    }
  }
  return p;
}

const END = String.raw`(?=$|[\s"';&|<>)])`;
const HOME_OR_PATH = String.raw`(?:~|\$\{?HOME\}?|[^\s"';&|<>]*)?`;
const CONFIG_TAIL = String.raw`(?:settings[^\s"';&|<>/]*\.json|(?:get-shit-done\/bin\/)?hooks(?:\/[^\s"';&|<>]*)?)`;
const CONFIG_MENTION_RE = new RegExp(String.raw`(?:^|[\s"'=:(<>])(${HOME_OR_PATH}\.claude\/${CONFIG_TAIL})` + END);
// The .claude directory itself: removing or renaming it takes settings and hooks with it.
const CLAUDE_DIR_RE = new RegExp(String.raw`(?:^|[\s"'=])${HOME_OR_PATH}\.claude\/?` + END);
// After "cd <...>/.claude", bare names refer to the protected files.
const BARE_CONFIG_RE = new RegExp(String.raw`(?:^|[\s"'=:(<>])(?:\.\/)?${CONFIG_TAIL}` + END);
const CD_INTO_CLAUDE_RE = new RegExp(String.raw`(?:^|[\s(])cd\s+["']?${HOME_OR_PATH}\.claude\/?["']?` + END);
const CD_INTO_HOOKS_RE = new RegExp(String.raw`(?:^|[\s(])cd\s+["']?${HOME_OR_PATH}\.claude\/(?:get-shit-done\/bin\/)?hooks(?:\/[^\s"';&|<>)]*)?["']?` + END);
const WRITE_VERB_RE = /(?:^|[\s(])(?:rm|rmdir|unlink|mv|truncate|chmod|chown|tee|sponge|touch)\b/;
// `patch` is a write only as the command word; prose such as "patch prepared by an agent" in a heredoc is not.
const PATCH_WORD_RE = /^\s*\(?\s*(?:(?:sudo|env|command|nohup)\s+)*patch\b/;
const DIR_VERB_RE = /(?:^|[\s(])(?:rm|rmdir|mv|chmod|chown)\b/;
// Copy-like verbs only write their last argument; copying config OUT is a read.
const COPY_VERB_RE = /(?:^|[\s(])(?:cp|ln|install|rsync)\b/;
// matches every string literal: used when the cwd itself is protected, so any relative write target is protected
const BARE_ANY_RE = /^ (?![\/~$])(?![rwax][bt+]*$)\S+/;
const SED_INPLACE_RE = /\b(?:sed|gsed)\b[^|]*\s-(?:[a-zA-Z]*i|-in-place)/;
const PERL_INPLACE_RE = /\bperl\b[^|]*\s-[a-zA-Z]*i/;
const REDIRECT_TO_CONFIG_RE = new RegExp(String.raw`>{1,2}\|?\s*["']?${HOME_OR_PATH}\.claude\/${CONFIG_TAIL}` + END);
const REDIRECT_BARE_RE = new RegExp(String.raw`>{1,2}\|?\s*["']?(?:\.\/)?${CONFIG_TAIL}` + END);
const ANY_REDIRECT_RE = /(?:^|[^>&0-9])>{1,2}\|?\s*[^\s&>]/;
const GIT_WRITE_RE = /\bgit\b[^|]*\b(?:checkout|restore|rm|mv|apply|stash)\b/;
const SCRIPT_WRITE_RE = new RegExp([
  String.raw`\b(?:writeFile|appendFile|rmSync|unlinkSync|renameSync|copyFile|cpSync|createWriteStream|truncateSync|chmodSync|symlinkSync)`,
  String.raw`\b(?:write_text|write_bytes|symlink_to|hardlink_to)\b`,
  String.raw`\b(?:shutil\.(?:copy\w*|move|rmtree)|os\.(?:remove|unlink|rename|replace|truncate))\(`,
  String.raw`\b(?:Path|pathlib\.Path)\([^)]*\)\.(?:unlink|rename|replace|touch|rmdir|chmod)\(`,
  // open(path, 'w'|'a'|'x'|'r+') and Path(...).open('w'); a bare open('a.json') is a read.
  String.raw`\bopen\((?:[^)]*,\s*(?:mode\s*=\s*)?)?["'](?:[wax]|r\+)`,
  String.raw`\bopen\s*\(?\s*\w+\s*,\s*["']\s*\+?>`,
].join('|'));
const INTERPRETER_RE = /(?:^|[\s(;&|])(?:python[\d.]*|node|nodejs|perl|ruby|deno|bun)\b/;
const PATCH_CMD_RE = /(?:^|[\s(;&|])(?:git\b[^|;&]*\bapply|patch)\b/;
const PATCH_TARGET_RE = /^(?:\+\+\+|---|diff --git)\s.*(?:\.claude\/(?:settings[^\s/]*\.json|hooks(?:\/|\s|$)|get-shit-done\/bin\/hooks(?:\/|\s|$)))/m;
const PATCH_READ_BYTES = 262144;
const READ_ONLY_CMD_RE = /^\s*(?:grep|egrep|rg|zg|cat|head|tail|less|wc|git\s+(?:log|grep|diff|show))\b/;

// A script write call counts only when it can target a protected path (09-hooks-audit REVIEW-ROUND-2 F4):
// literal arguments decide (`open('/tmp/x','w')` is safe, `open('.claude/hooks/a','w')` is protected); a call whose
// target is a variable or expression is unknown and counts when the text mentions a protected path anywhere.
// Variables are not chased across statements (guardrail, not a boundary).
const KWARG_RE = /\b(?:mode|encoding|newline|exist_ok|parents|flags|errors|buffering|True|False|None|utf-?8)\b/g;
function balancedArgs(text, openIdx) {
  let depth = 0;
  let q = '';
  const end = Math.min(text.length, openIdx + 600);
  for (let i = openIdx; i < end; i++) {
    const c = text[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return text.slice(openIdx + 1, i);
  }
  return text.slice(openIdx + 1, end);
}
function classifyArgs(args, mentionRe) {
  const lits = [...args.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2]);
  if (lits.some(l => mentionRe.test(' ' + l))) return 'protected';
  const rest = args.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '').replace(KWARG_RE, '').replace(/[\s,=+()]/g, '');
  return lits.length > 0 && rest === '' ? 'safe' : 'unknown';
}
function scriptWriteNearMention(text, mentionRe) {
  const re = new RegExp(SCRIPT_WRITE_RE.source, 'g');
  const anywhere = mentionRe.test(text);
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const rest = text.slice(m.index);
    const open = rest.search(/[\w.]*\(/) >= 0 && rest.slice(0, 48).indexOf('(') >= 0 ? m.index + rest.indexOf('(') : -1;
    let kind;
    if (/^(?:write_text|write_bytes|symlink_to|hardlink_to|unlink|rename|replace|touch|rmdir|chmod)/.test(m[0]) || /^\.?(?:write_text|write_bytes)/.test(m[0])) {
      // method on a receiver: classify the nearest `Path(...)` before the call
      const before = text.slice(Math.max(0, m.index - 200), m.index);
      const pi = before.lastIndexOf('Path(');
      kind = pi < 0 ? 'unknown' : classifyArgs(balancedArgs(before, pi + 4), mentionRe);
    } else if (open >= 0) {
      kind = classifyArgs(balancedArgs(text, open), mentionRe);
    } else {
      kind = classifyArgs(text.slice(m.index, m.index + 200), mentionRe);
    }
    if (kind === 'protected' || (kind === 'unknown' && anywhere)) return true;
  }
  return false;
}

// Top-level simple commands of `command` whose command word is an interpreter, each with its quoted
// arguments and heredoc bodies (they span ';' and newlines), so mentions elsewhere do not count.
function interpreterRegions(command) {
  const regions = [];
  let cur = '';
  let heredocs = [];
  const flush = () => { if (cur.trim()) regions.push(cur); cur = ''; };
  const n = command.length;
  for (let i = 0; i < n; i++) {
    const c = command[i];
    if (c === "'" ) { const j = command.indexOf("'", i + 1); const e = j < 0 ? n : j + 1; cur += command.slice(i, e); i = e - 1; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < n && command[j] !== '"') j += command[j] === '\\' ? 2 : 1;
      cur += command.slice(i, Math.min(j + 1, n)); i = Math.min(j, n - 1); continue;
    }
    if (c === '\\') { cur += command.slice(i, i + 2); i++; continue; }
    if (c === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      const m = /^<<-?\s*(["']?)([^\s"'|;&<>()]+)\1/.exec(command.slice(i));
      if (m) heredocs.push({ delim: m[2], strip: command[i + 2] === '-' });
      cur += '<<'; i++; continue;
    }
    if (c === '\n') {
      cur += c;
      if (heredocs.length) {
        for (const h of heredocs) {
          let body = '';
          while (i + 1 < n) {
            const nl = command.indexOf('\n', i + 1);
            const end = nl < 0 ? n : nl;
            const line = command.slice(i + 1, end);
            i = end;
            body += line + '\n';
            if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
          }
          cur += body;
        }
        heredocs = [];
      }
      flush(); continue;
    }
    if (c === ';' || c === '|' || c === '&') { flush(); continue; }
    cur += c;
  }
  flush();
  // wrappers (timeout 5 python3, env X=1 node, sudo perl) put the interpreter within the first few words
  return regions.filter(r => INTERPRETER_RE.test(' ' + r.trim().split(/\s+/).slice(0, 5).join(' ') + ' '));
}

function segmentWrites(seg, mentionRe) {
  if (!mentionRe.test(seg)) return null;
  if (SED_INPLACE_RE.test(seg) || PERL_INPLACE_RE.test(seg)) return 'edits a protected path in place';
  if (WRITE_VERB_RE.test(seg) || PATCH_WORD_RE.test(seg)) return 'modifies or removes a protected path';
  if (COPY_VERB_RE.test(seg)) {
    const args = seg.trim().split(/\s+/);
    if (mentionRe.test(' ' + args[args.length - 1])) return 'overwrites a protected path';
  }
  if (/\bdd\b[^|]*\bof=/.test(seg) && mentionRe.test(seg.replace(/.*\bof=/, ' '))) return 'overwrites a protected path';
  if (GIT_WRITE_RE.test(seg)) return 'rewrites a protected path via git';
  if (scriptWriteNearMention(seg, mentionRe)) return 'writes a protected path from a script';
  return null;
}

function expandHome(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

// Patch files named in a `git apply` / `patch` segment (plain args, -i/--input, `< file`).
function patchFileCandidates(seg) {
  const toks = seg.trim().split(/\s+/).map(t => t.replace(/^["']|["']$/g, ''));
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '<' || t === '-i' || t === '--input') { if (toks[i + 1]) out.push(toks[i + 1]); continue; }
    if (t.startsWith('<') && t.length > 1) { out.push(t.slice(1)); continue; }
    if (t.startsWith('--input=')) { out.push(t.slice(8)); continue; }
    if (!t.startsWith('-') && !/^(?:git|apply|patch)$/.test(t)) out.push(t);
  }
  return out;
}

function patchFileTargetsProtected(file, cwd) {
  try {
    const abs = path.resolve(cwd || process.cwd(), expandHome(file));
    const fd = fs.openSync(abs, 'r');
    try {
      const buf = Buffer.alloc(PATCH_READ_BYTES);
      const n = fs.readSync(fd, buf, 0, PATCH_READ_BYTES, 0);
      return PATCH_TARGET_RE.test(buf.toString('utf8', 0, n));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false; // unreadable or not a file: cannot tell
  }
}

// Returns a reason string when a Bash command would write to protected
// config or disable hooks, else null. Read-only use (cat, jq ., grep) passes.
function bashConfigViolation(command, cwd) {
  if (typeof command !== 'string' || !command) return null;
  const segments = command.split(/&&|\|\||;|\n|\|(?!\|)/);
  if (/disableAllHooks/.test(command)) {
    const readOnly = segments.every(seg => !seg.trim() || READ_ONLY_CMD_RE.test(seg)) && !ANY_REDIRECT_RE.test(command);
    if (!readOnly) return 'sets or writes disableAllHooks';
  }
  if (REDIRECT_TO_CONFIG_RE.test(command)) return 'redirects output into a protected path';
  // Interpreter one-liners and heredocs span ';' and newlines, so check each interpreter command as a whole region.
  if (interpreterRegions(command).some(r => CONFIG_MENTION_RE.test(r) && scriptWriteNearMention(r, CONFIG_MENTION_RE))) {
    return 'writes a protected path from a script';
  }
  // After `cd .../.claude/hooks[/sub]` a script write to a bare relative name lands in the protected tree.
  if (CD_INTO_HOOKS_RE.test(command) && interpreterRegions(command).some(r => scriptWriteNearMention(r, BARE_ANY_RE))) {
    return 'writes inside .claude/hooks after cd';
  }
  let cwdClaude = false;
  let cwdHooks = false;
  for (const seg of segments) {
    if (CD_INTO_HOOKS_RE.test(seg)) { cwdClaude = true; cwdHooks = true; continue; }
    if (CD_INTO_CLAUDE_RE.test(seg)) { cwdClaude = true; continue; }
    if (DIR_VERB_RE.test(seg) && CLAUDE_DIR_RE.test(seg)) return 'removes or renames the .claude directory';
    const direct = segmentWrites(seg, CONFIG_MENTION_RE);
    if (direct) return direct;
    if (PATCH_CMD_RE.test(seg) && patchFileCandidates(seg).some(f => patchFileTargetsProtected(f, cwd))) {
      return 'applies a patch that targets a protected path';
    }
    if (cwdHooks && (ANY_REDIRECT_RE.test(seg) || WRITE_VERB_RE.test(seg) || SED_INPLACE_RE.test(seg) || PERL_INPLACE_RE.test(seg) || COPY_VERB_RE.test(seg))) {
      return 'writes inside .claude/hooks after cd';
    }
    if (cwdClaude) {
      if (REDIRECT_BARE_RE.test(seg)) return 'redirects output into a protected path after cd';
      const rel = segmentWrites(seg, BARE_CONFIG_RE);
      if (rel) return rel + ' (after cd into .claude)';
    }
  }
  return null;
}

function configBlockMessage(target, reason) {
  return [
    '⛔  PROTECTED CLAUDE CONFIG — BLOCKED',
    '',
    `  Target: ${target}`,
    `  Reason: ${reason}`,
    '',
    'Claude settings (.claude/settings*.json) and hooks (.claude/hooks/**) are the enforcement',
    'layer and are human-owned; agents may read them but not change or disable them.',
    '',
    'Allowed path:',
    '  - GSD-managed hooks/registrations: change the GSD source (bin/install.js, get-shit-done/bin/hooks/)',
    '    and have the user run the installer.',
    '  - Anything else: stop and ask the user to apply the change themselves, with the exact diff.',
  ].join('\n');
}

function run() {
  let raw = '';
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      data = null;
    }
    if (!data || typeof data !== 'object') {
      process.stderr.write('[gsd-protect] BLOCKED: hook input is not valid JSON, so the command cannot be checked (fail closed)\n');
      process.exit(2);
    }
    try {
      const toolInput = data.tool_input || {};

      if (data.tool_name === 'Bash') {
        const reason = bashConfigViolation(toolInput.command, data.cwd);
        if (reason) {
          process.stderr.write(configBlockMessage(String(toolInput.command).slice(0, 200), reason) + '\n');
          process.exit(2);
        }
        process.exit(0);
      }

      // Both Write and Edit carry file_path
      let filePath = toolInput.file_path;
      if (!filePath) { process.exit(0); }

      // Normalise ~ and make absolute
      if (filePath.startsWith('~')) {
        filePath = path.join(os.homedir(), filePath.slice(1));
      }
      filePath = path.resolve(data.cwd || process.cwd(), filePath);

      if (isProtectedConfigPath(filePath) || isProtectedConfigPath(realPathLoose(filePath))) {
        process.stderr.write(configBlockMessage(filePath, `${data.tool_name || 'write'} to protected Claude config`) + '\n');
        process.exit(2);
      }

      // Only intercept paths inside ~/.claude/
      const claudePrefix = CLAUDE_DIR + path.sep;
      if (!filePath.startsWith(claudePrefix)) { process.exit(0); }

      // Load manifest — fail open if absent, but VISIBLY warn on corruption.
      // A silently-unparseable manifest disables ALL protection with zero
      // signal; the operator must know protection is off, not merely assume it.
      if (!fs.existsSync(MANIFEST_PATH)) { process.exit(0); }
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      } catch (parseErr) {
        process.stderr.write(
          '[gsd-protect] managed-file manifest is unreadable/corrupt (' +
          MANIFEST_PATH + '): ' + (parseErr && parseErr.message) +
          ' — file protection is DISABLED until it is regenerated (re-run install.js)\n'
        );
        process.exit(0); // fail open — never hard-block on a bad manifest
      }
      if (!manifest || !manifest.files) { process.exit(0); }

      // Relative path from ~/.claude/ — used as manifest key
      const relPath = path.relative(CLAUDE_DIR, filePath).replace(/\\/g, '/');

      // Not a managed file — allow
      if (!(relPath in manifest.files)) { process.exit(0); }

      // Resolve source project root strictly from gsd-source-path.txt — no
      // machine-specific hardcoded fallback (that silently misdirects edits on
      // any other machine). If the pointer is missing, say so honestly.
      let sourceRoot = null;
      if (fs.existsSync(SOURCE_PATH_FILE)) {
        const stored = fs.readFileSync(SOURCE_PATH_FILE, 'utf8').trim();
        if (stored) { sourceRoot = stored; }
      }
      const knownSource   = sourceRoot !== null;
      const displayRoot   = knownSource ? sourceRoot : '<GSD source root>';
      const sourceFile    = path.join(displayRoot, relPath);
      const installScript = path.join(displayRoot, 'bin', 'install.js');

      const message = [
        '⛔  GSD PROTECTED FILE — EDIT BLOCKED',
        '',
        'This file is managed by the GSD installer and cannot be edited directly.',
        'Changes made here are overwritten the next time install runs.',
        '',
        `  Protected:  ${filePath}`,
        '',
        'Make the change in the source project instead:',
        '',
        `  1. Edit source:  ${sourceFile}`,
        `  2. Commit:       git -C "${displayRoot}" add -A && git -C "${displayRoot}" commit -m "your message"`,
        `  3. Deploy:       node "${installScript}"`,
        '',
        'Nothing deploys until step 3 runs — the edit is NOT live until install.js is re-run.',
        ...(knownSource
          ? []
          : ['', '(source path unknown — check ~/.claude/gsd-source-path.txt)']),
      ].join('\n');

      process.stderr.write(message + '\n');
      process.exit(2); // exit 2 = block tool call and surface message to Claude

    } catch (_) {
      // Fail open — never block due to a hook bug
      process.exit(0);
    }
  });
}

module.exports = { isProtectedConfigPath, bashConfigViolation };

if (require.main === module) run();
