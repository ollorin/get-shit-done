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

const CONFIG_MENTION_RE = /(?:^|[\s"'=:(<>])((?:~|\$\{?HOME\}?|[^\s"';&|<>]*)?\.claude\/(?:settings[^\s"';&|<>/]*\.json|hooks(?:\/[^\s"';&|<>]*)?)(?=$|[\s"';&|<>)]))/;
const WRITE_VERB_RE = /(?:^|[\s(])(?:rm|rmdir|unlink|mv|truncate|chmod|chown|tee|sponge)\b/;
// Copy-like verbs only write their last argument; copying config OUT is a read.
const COPY_VERB_RE = /(?:^|[\s(])(?:cp|ln|install|rsync)\b/;
const SED_INPLACE_RE = /\b(?:sed|gsed)\b[^|]*\s-(?:[a-zA-Z]*i|-in-place)/;
const PERL_INPLACE_RE = /\bperl\b[^|]*\s-[a-zA-Z]*i/;
const REDIRECT_TO_CONFIG_RE = />{1,2}\|?\s*["']?(?:~|\$\{?HOME\}?|[^\s"';&|<>]*)?\.claude\/(?:settings[^\s"';&|<>/]*\.json|hooks)/;
const GIT_WRITE_RE = /\bgit\b[^|]*\b(?:checkout|restore|rm|mv|apply|stash)\b/;
const SCRIPT_WRITE_RE = /\b(?:writeFile|appendFile|rmSync|unlinkSync|renameSync|copyFile|open\([^)]*["'][wa])/;

// Returns a reason string when a Bash command would write to protected
// config or disable hooks, else null. Read-only use (cat, jq ., grep) passes.
function bashConfigViolation(command) {
  if (typeof command !== 'string' || !command) return null;
  if (/disableAllHooks/.test(command)) return 'mentions disableAllHooks';
  if (REDIRECT_TO_CONFIG_RE.test(command)) return 'redirects output into a protected path';
  for (const seg of command.split(/&&|\|\||;|\n|\|(?!\|)/)) {
    if (!CONFIG_MENTION_RE.test(seg)) continue;
    if (SED_INPLACE_RE.test(seg) || PERL_INPLACE_RE.test(seg)) return 'edits a protected path in place';
    if (WRITE_VERB_RE.test(seg)) return 'modifies or removes a protected path';
    if (COPY_VERB_RE.test(seg)) {
      const args = seg.trim().split(/\s+/);
      if (CONFIG_MENTION_RE.test(' ' + args[args.length - 1])) return 'overwrites a protected path';
    }
    if (/\bdd\b[^|]*\bof=\S*\.claude\//.test(seg)) return 'overwrites a protected path';
    if (GIT_WRITE_RE.test(seg)) return 'rewrites a protected path via git';
    if (SCRIPT_WRITE_RE.test(seg)) return 'writes a protected path from a script';
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
    try {
      const data      = JSON.parse(raw);
      const toolInput = data.tool_input || {};

      if (data.tool_name === 'Bash') {
        const reason = bashConfigViolation(toolInput.command);
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
