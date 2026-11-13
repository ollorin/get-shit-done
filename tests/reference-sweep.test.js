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

function invocationsIn(text, file, commands, found = new Map()) {
  for (const m of text.matchAll(/`(?:gsd-tools(?:\.js)? )?([a-z][^`\n]*)`/g)) {
    const words = [];
    if (!m[0].startsWith('`gsd-tools') && !commands.has(m[1].split(/\s+/)[0])) continue;
    for (const w of m[1].trim().split(/\s+/)) {
      if (!/^[a-z][a-z0-9-]*$/.test(w) || words.length === 2) break;
      words.push(w);
    }
    if (words.length) found.set(words.join(' '), file);
  }
  return found;
}

function namedInvocations() {
  const found = new Map();
  const commands = topLevelCommands();
  for (const file of DIRS.flatMap(mdFiles)) invocationsIn(fs.readFileSync(path.join(ROOT, file), 'utf8'), file, commands, found);
  return found;
}

function binSources() {
  const binDir = path.dirname(TOOLS);
  return fs.readdirSync(binDir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => fs.readFileSync(path.join(binDir, f), 'utf8')).join('\n');
}

function unknownPaths(invocations) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-sweep-'));
  const sources = binSources();
  const commands = topLevelCommands();
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
  return unknown;
}

// Fields a workflow's "Parse JSON for:" line names must exist somewhere in the CLI sources.
function unknownInitFields(text, file, sources) {
  const missing = [];
  for (const line of text.split('\n').filter((l) => /^Parse JSON for:/.test(l))) {
    const names = [...line.slice(0, line.indexOf('. ') > 0 ? line.indexOf('. ') : undefined).matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
    for (const n of names) if (!new RegExp(`\\b${n}\\b`).test(sources)) missing.push(`${n}  (${file})`);
  }
  return missing;
}

test('every gsd-tools command path named in agents, workflows and references is dispatched', () => {
  const invocations = namedInvocations();
  assert.ok(invocations.size > 60, `sweep found only ${invocations.size} command paths`);
  assert.deepStrictEqual(unknownPaths(invocations), []);
});

test('the sweep fails on a misspelled command and on a misspelled subcommand, and passes a real one', () => {
  const commands = topLevelCommands();
  const bad = invocationsIn('Run `gsd-tools frobnicate widget` then `gsd-tools phase frobnicate`.', 'fixture.md', commands);
  assert.deepStrictEqual(unknownPaths(bad).map((u) => u.split('  ')[0]).sort(), ['frobnicate widget', 'phase frobnicate']);
  assert.deepStrictEqual(unknownPaths(invocationsIn('Run `gsd-tools phase complete`.', 'fixture.md', commands)), []);
});

test('every field a workflow\'s "Parse JSON for:" line names exists in the CLI sources; a misspelled one is reported', () => {
  const sources = binSources();
  const missing = mdFiles('get-shit-done/workflows').flatMap((f) => unknownInitFields(fs.readFileSync(path.join(ROOT, f), 'utf8'), f, sources));
  assert.deepStrictEqual(missing, []);
  assert.deepStrictEqual(unknownInitFields('Parse JSON for: `executor_model`, `zzz_no_such_field`.', 'fixture.md', sources), ['zzz_no_such_field  (fixture.md)']);
});
