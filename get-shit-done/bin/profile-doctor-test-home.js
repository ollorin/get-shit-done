'use strict';

// Test fixture shared by the doctor tests: a HOME with every installer hook registered and a framework tree that
// matches its install manifest. Not loaded by the product code.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cmd = (script) => ({ type: 'command', command: `node "/h/${script}"` });
const protect = (matcher) => ({ matcher, hooks: [cmd('gsd-protect-managed-files.js')] });
const qaLock = (matcher) => ({ matcher, hooks: [cmd('gsd-ui-qa-lock.js')] });

const HOOK_DOC = Object.freeze({
  hooks: {
    Stop: [{ hooks: [cmd('session-end-standalone.js')] }],
    PreToolUse: [protect('Write'), protect('Edit'), protect('Bash'), qaLock('mcp__.*'), qaLock('Bash')],
    UserPromptSubmit: [{ hooks: [cmd('gsd-owner-approve.js')] }],
    SubagentStart: [{ hooks: [cmd('gsd-ui-qa-lock.js')] }],
    SubagentStop: [{ hooks: [cmd('gsd-ui-qa-lock.js')] }],
  },
});

const VERSION_TEXT = '1.0.0\n';

function writeCompleteHome(home) {
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), text);
  };
  write('.claude/settings.json', JSON.stringify(HOOK_DOC));
  write('.claude/get-shit-done/VERSION', VERSION_TEXT);
  const hash = crypto.createHash('sha256').update(VERSION_TEXT).digest('hex');
  write('.claude/gsd-file-manifest.json', JSON.stringify({ files: { 'get-shit-done/VERSION': hash } }));
  return home;
}

module.exports = { HOOK_DOC, writeCompleteHome };
