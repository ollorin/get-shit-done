#!/usr/bin/env node
// gsd-owner-approve.js: UserPromptSubmit hook. Records an owner-gate approval from the owner's own chat message.
//
// Why a hook: an agent that calls `owner-gate approve --owner-confirmed` writes an attestation nobody can check
// (references/auto-mode.md, "Owner gates"). A UserPromptSubmit hook runs outside the model and receives only a
// message the human typed, so the approval it records cannot be forged by an agent.
//
// Trigger: the message STARTS with  "одобряю <kind>"  or  "approve <kind>"  (kind: pr, roadmap, composition),
// optionally followed by free text. Anything else is ignored. The gate must be pending in the project's
// .planning/OWNER-GATES.json. The verbatim message (first 300 chars) goes into the gate's note.
// Never blocks the session: every path exits 0; the outcome goes back to the model as additionalContext.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GSD_TOOLS = path.join(__dirname, '..', 'gsd-tools.js');
const TRIGGER = /^\s*(?:одобряю|approve)\s+(pr|roadmap|composition)\b/i;

function say(text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }));
}

function pendingKinds(cwd) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(cwd, '.planning', 'OWNER-GATES.json'), 'utf8'));
    return (state.gates || []).filter((g) => g.status === 'pending').map((g) => g.kind);
  } catch {
    return null;
  }
}

function parseTrigger(prompt) {
  const match = TRIGGER.exec(prompt);
  return match ? match[1].toLowerCase() : null;
}

function approve(cwd, kind, prompt) {
  const note = `Owner chat message via UserPromptSubmit hook (verbatim): ${prompt.trim().slice(0, 300)}`;
  return execFileSync(
    process.execPath,
    [GSD_TOOLS, 'owner-gate', 'approve', '--kind', kind, '--owner-confirmed', '--note', note],
    { cwd, encoding: 'utf8', timeout: 30000 },
  );
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const kind = parseTrigger(prompt);
  if (!kind) return;
  const cwd = input.cwd || process.cwd();
  const pending = pendingKinds(cwd);
  if (pending === null) return say(`gsd-owner-approve: no .planning/OWNER-GATES.json in ${cwd}; nothing recorded.`);
  if (!pending.includes(kind)) {
    return say(`gsd-owner-approve: no pending '${kind}' gate (pending: ${pending.join(', ') || 'none'}); nothing recorded.`);
  }
  try {
    const out = approve(cwd, kind, prompt);
    say(`gsd-owner-approve: the owner's message approved the '${kind}' gate. Recorded by the hook, not by an agent. ${out.trim().slice(0, 300)}`);
  } catch (error) {
    say(`gsd-owner-approve: approve '${kind}' failed: ${String(error && error.message).slice(0, 300)}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch {
    // style-gate:edge a hook never blocks the session
  }
  process.exit(0);
}

module.exports = { parseTrigger, pendingKinds };
