'use strict';

const fs = require('fs');
const { sha256 } = require('./project-deploy-files.js');

const PERM_KEYS = ['allow', 'deny', 'ask'];
const CONTROL_RE = new RegExp('[\\u007f-\\u009f\\u2028\\u2029]', 'g');

const show = (v) => JSON.stringify(v).replace(CONTROL_RE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const contentLines = (buf) => buf.toString('utf8').split('\n').map((l) => `    | ${show(l)}`);

function shownFiles({ writes, files, olds, guarded, settingsPlan, settingsPath }) {
  const entries = writes.filter((w) => guarded.includes(w.dest)).map((w) => ({
    path: w.dest,
    action: files.find((f) => f.path === w.dest).action,
    old: olds.get(w.dest) ?? null,
    content: w.content,
  }));
  return settingsPlan === null ? entries : [...entries, {
    path: settingsPath,
    action: settingsPlan.action,
    old: settingsPlan.old,
    content: Buffer.from(settingsPlan.text, 'utf8'),
  }];
}

const changeLines = (sign, shape) => [
  ...PERM_KEYS.flatMap((k) => shape.permissions[k].map((v) => `  ${sign} permission ${k}: ${show(v)}`)),
  ...shape.hooks.map((t) => `  ${sign} hook: ${show(t)}`),
];

function confirmationText({ report, presetPath, shown }) {
  const out = [
    'GSD project deploy: review before applying',
    `command: ${show(report.command)}`,
    `preset: ${show(report.preset.name)} version ${show(report.preset.version)}`,
    `preset path: ${show(presetPath)}`,
    'guarded changes:',
  ];
  for (const s of shown) {
    out.push(
      `- ${show(s.path)} action=${show(s.action)}`,
      `  old sha256: ${s.old === null ? 'none (absent)' : sha256(s.old)}`,
      `  new sha256: ${sha256(s.content)}`,
      '  new content:',
      ...contentLines(s.content),
    );
  }
  if (report.settings !== null && report.settings.added !== null) {
    out.push('settings changes:', ...changeLines('+', report.settings.added), ...changeLines('-', report.settings.removed));
  }
  return out.join('\n');
}

function readTtyLine(text) {
  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'r+');
  } catch {
    return '';
  }
  try {
    fs.writeSync(fd, `${text}\nType APPLY to apply, anything else cancels: `);
    const bytes = [];
    const b = Buffer.alloc(1);
    while (fs.readSync(fd, b, 0, 1, null) === 1 && b[0] !== 0x0a) bytes.push(b[0]);
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return '';
  } finally {
    fs.closeSync(fd);
  }
}

const needsConfirm = (plan) => plan.report.command !== 'diff'
  && plan.report.guarded_changes.length > 0
  && plan.exempt !== true;

function confirmed(plan, ask = readTtyLine) {
  return !needsConfirm(plan) || ask(confirmationText(plan)) === 'APPLY';
}

module.exports = { shownFiles, confirmationText, confirmed, readTtyLine, show };
