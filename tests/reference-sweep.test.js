'use strict';
// One generated sweep: every `gsd-tools <command> [subcommand]` named in a code span of the shipped
// prose must be a dispatcher case and a subcommand the CLI accepts.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'get-shit-done', 'bin', 'gsd-tools.js');
const DIRS = ['agents', 'get-shit-done/workflows', 'get-shit-done/references', 'commands'];

function mdFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? mdFiles(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []);
}

function topLevelCommands() {
  const src = fs.readFileSync(TOOLS, 'utf8');
  const end = src.indexOf('Unknown command: ');
  const start = src.lastIndexOf('switch (command)', end);
  return new Set([...src.slice(start, end).matchAll(/^    case '([a-z-]+)':/gm)].map((m) => m[1]));
}

function namedInvocations() {
  const found = new Map();
  const commands = topLevelCommands();
  for (const file of DIRS.flatMap(mdFiles)) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of text.matchAll(/`(?:gsd-tools(?:\.js)? )?([a-z][^`\n]*)`/g)) {
      const words = [];
      if (!m[0].startsWith('`gsd-tools') && !commands.has(m[1].split(/\s+/)[0])) continue;
      for (const w of m[1].trim().split(/\s+/)) {
        if (!/^[a-z][a-z0-9-]*$/.test(w) || words.length === 2) break;
        words.push(w);
      }
      if (words.length) found.set(words.join(' '), file);
    }
  }
  return found;
}

test('every gsd-tools command path named in agents, workflows and references is dispatched', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-sweep-'));
  const binDir = path.dirname(TOOLS);
  const sources = fs.readdirSync(binDir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => fs.readFileSync(path.join(binDir, f), 'utf8')).join('\n');
  const commands = topLevelCommands();
  const invocations = namedInvocations();
  assert.ok(invocations.size > 60, `sweep found only ${invocations.size} command paths`);
  const unknown = [];
  for (const [words, file] of invocations) {
    const args = words.split(' ');
    if (args[0] === 'gsd-tools') continue;
    if (!commands.has(args[0])) { unknown.push(`${words}  (${file})`); continue; }
    if (args.length < 2) continue;
    if (sources.includes(`'${args[1]}'`)) continue;
    const r = spawnSync(process.execPath, [TOOLS, ...args, '--cwd', cwd], { cwd, encoding: 'utf8', timeout: 20000 });
    if (/Unknown (command|init workflow|[a-z-]+ subcommand)/.test(`${r.stdout}${r.stderr}`)) unknown.push(`${words}  (${file})`);
  }
  fs.rmSync(cwd, { recursive: true, force: true });
  assert.deepStrictEqual(unknown, []);
});
