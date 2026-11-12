'use strict';

// agnostic-M-09 (9.2, 9.3): behaviour tests of the style gate the base preset deploys. Each test copies the preset
// source of the gate into a tmp project (scripts/style-gate.mjs next to scripts/style-gate/) and runs it there.
// Node and POSIX shell only.

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const GSD_TOOLS = path.join(__dirname, 'gsd-tools.js');
const SCRIPTS = path.join(__dirname, '..', 'presets', 'base', 'scripts');
const GATE = path.join(SCRIPTS, 'style-gate.mjs');

const tmps = [];
afterEach(() => { while (tmps.length > 0) fs.rmSync(tmps.pop(), { recursive: true, force: true }); });
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
};
const write = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const lines = (n, line = 'const a = 1;') => `${Array.from({ length: n }, () => line).join('\n')}\n`;

// A tmp project holding the gate, a config with stack.style, and the given source files.
function project({ style = { rule_set: 'js-ts', roots: ['src'] }, files = {} } = {}) {
  const root = mkTmp('gsd-style-');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(GATE, path.join(root, 'scripts', 'style-gate.mjs'));
  fs.cpSync(path.join(SCRIPTS, 'style-gate'), path.join(root, 'scripts', 'style-gate'), { recursive: true });
  write(root, '.planning/config.json', JSON.stringify({ stack: { style } }));
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  return root;
}
const gate = (root, ...args) => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'style-gate.mjs'), ...args], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const THROW = 'export const f = () => { throw new Error("x"); };\n';

describe('style gate: rules, tags and exit codes (agnostic-M-09 9.2)', () => {
  test('S-a clean sources under the js-ts rule set exit 0', () => {
    const root = project({ files: { 'src/domain.js': 'export const add = (a, b) => a + b;\nexport const push = (items, x) => { const next = [...items]; next.push(x); return next; };\n' } });
    const r = gate(root);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /1 file\(s\), rule set js-ts, 0 violation\(s\)/);
  });

  test('S-b a throw fails naming file, line and rule; a comment, a string, an edge glob and a tag with a reason do not', () => {
    const bad = gate(project({ files: { 'src/domain.js': `export const a = 1;\n${THROW}` } }));
    assert.strictEqual(bad.code, 1, bad.out);
    assert.match(bad.out, /src\/domain\.js:2 \[throws\]/);
    const quiet = project({
      style: { rule_set: 'js-ts', roots: ['src'], edge_globs: ['src/edge/**'] },
      files: {
        'src/comment.js': '// throw new Error("x")\n/* try { } */\nexport const a = 1;\n',
        'src/string.js': 'export const s = "throw new Error(1)";\nexport const t = `try { ${1} }`;\n',
        'src/edge/entry.js': THROW,
        'src/tagged.js': `// style-gate:edge process entry point\n${THROW}`,
      },
    });
    const q = gate(quiet);
    assert.strictEqual(q.code, 0, q.out);
    const noReason = gate(project({ files: { 'src/tagged.js': `// style-gate:edge\n${THROW}` } }));
    assert.strictEqual(noReason.code, 1, noReason.out);
    assert.match(noReason.out, /\[throws\]/);
    const blockTag = gate(project({ files: { 'src/tagged.js': `/* style-gate:edge */\n${THROW}` } }));
    assert.strictEqual(blockTag.code, 1, blockTag.out);
  });

  test('S-c a parameter changed in place fails; a local copy passes; the line escape needs a reason', () => {
    const push = gate(project({ files: { 'src/a.js': 'export function add(items, x) {\n  items.push(x);\n  return items;\n}\n' } }));
    assert.strictEqual(push.code, 1, push.out);
    assert.match(push.out, /src\/a\.js:2 \[inputMutation\]/);
    const assign = gate(project({ files: { 'src/a.js': 'export const total = (input) => {\n  input.total = 1;\n  return input;\n};\n' } }));
    assert.strictEqual(assign.code, 1, assign.out);
    assert.match(assign.out, /\[inputMutation\]/);
    const local = gate(project({ files: { 'src/a.js': 'export function add(items, x) {\n  const next = [...items];\n  next.push(x);\n  return next;\n}\n' } }));
    assert.strictEqual(local.code, 0, local.out);
    const escaped = gate(project({ files: { 'src/a.js': 'export function put(param, k, v) {\n  param.set(k, v); // style-gate:ignore a map-like set\n}\n' } }));
    assert.strictEqual(escaped.code, 0, escaped.out);
    const previous = gate(project({ files: { 'src/a.js': 'export function put(param, k, v) {\n  // style-gate:ignore a map-like set\n  param.set(k, v);\n}\n' } }));
    assert.strictEqual(previous.code, 0, previous.out);
    const noReason = gate(project({ files: { 'src/a.js': 'export function put(param, k, v) {\n  param.set(k, v); // style-gate:ignore\n}\n' } }));
    assert.strictEqual(noReason.code, 1, noReason.out);
  });

  test('S-d a file of max_file_lines + 1 lines fails under every rule set; max_file_lines exactly passes', () => {
    for (const rule_set of ['generic', 'js-ts', 'python']) {
      const ext = rule_set === 'python' ? 'py' : 'js';
      const over = gate(project({ style: { rule_set, roots: ['src'], max_file_lines: 30, require_language_rules: false }, files: { [`src/big.${ext}`]: lines(31, 'x = 1') } }));
      assert.strictEqual(over.code, 1, `${rule_set}: ${over.out}`);
      assert.match(over.out, /big\.(?:js|py):31 \[oversizeFiles\]/);
      const exact = gate(project({ style: { rule_set, roots: ['src'], max_file_lines: 30, require_language_rules: false }, files: { [`src/big.${ext}`]: lines(30, 'x = 1') } }));
      assert.strictEqual(exact.code, 0, `${rule_set}: ${exact.out}`);
    }
  });

  test('S-e the ratchet: a count may fall and never rise; seed once; write-baseline never raises', () => {
    const two = `${THROW}${THROW}`;
    const root = project({ files: { 'src/a.js': two } });
    assert.strictEqual(gate(root).code, 1, 'no baseline means every count is 0');
    const seed = gate(root, '--seed-baseline');
    assert.strictEqual(seed.code, 0, seed.out);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, '.planning', 'style-baseline.json'), 'utf8')), { domains: { src: { throws: 2 } } });
    assert.strictEqual(gate(root).code, 0);
    assert.strictEqual(gate(root, '--seed-baseline').code, 1, 'refuses when a baseline exists');
    write(root, 'src/a.js', `${two}${THROW}`);
    const third = gate(root);
    assert.strictEqual(third.code, 1, third.out);
    assert.match(third.out, /throws measured 3 > baseline 2/);
    const keep = gate(root, '--write-baseline');
    assert.strictEqual(keep.code, 1, keep.out);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.planning', 'style-baseline.json'), 'utf8')).domains.src.throws, 2, 'never raised');
    write(root, 'src/a.js', THROW);
    const stale = gate(root);
    assert.strictEqual(stale.code, 0, stale.out);
    assert.match(stale.out, /STALE src: throws measured 1 < baseline 2/);
    assert.strictEqual(gate(root, '--write-baseline').code, 0);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.planning', 'style-baseline.json'), 'utf8')).domains.src.throws, 1);
    write(root, 'src/a.js', `${THROW}${THROW}`);
    assert.strictEqual(gate(root).code, 1, 'a later second throw fails');
    const none = project({ files: { 'src/a.js': THROW } });
    assert.strictEqual(gate(none, '--write-baseline').code, 1, 'write-baseline without a baseline fails');
    assert.strictEqual(gate(none, '--bogus').code, 2);
  });

  test('S-f an unreadable config, a missing stack.style, an unknown rule set and an invalid pattern fail naming the cause', () => {
    const noConfig = project();
    fs.rmSync(path.join(noConfig, '.planning', 'config.json'));
    const a = gate(noConfig);
    assert.strictEqual(a.code, 1);
    assert.match(a.out, /config\.json unreadable/);
    const notJson = project();
    write(notJson, '.planning/config.json', '{ nope');
    const b = gate(notJson);
    assert.strictEqual(b.code, 1);
    assert.match(b.out, /not valid JSON/);
    const noStyle = project();
    write(noStyle, '.planning/config.json', '{"stack":{}}');
    assert.match(gate(noStyle).out, /stack\.style is missing/);
    const unknown = gate(project({ style: { rule_set: 'nope', roots: ['src'] }, files: { 'src/a.js': 'const a = 1;\n' } }));
    assert.strictEqual(unknown.code, 1);
    assert.match(unknown.out, /unknown rule set "nope"/);
    const badRe = project({ style: { rule_set: 'bad', roots: ['src'] }, files: { 'src/a.js': 'const a = 1;\n' } });
    write(badRe, 'scripts/style-gate/rule-sets/bad.json', JSON.stringify({ extensions: ['.js'], regex_rules: [{ id: 'broken', pattern: '(', message: 'm' }] }));
    const c = gate(badRe);
    assert.strictEqual(c.code, 1);
    assert.match(c.out, /rule broken has an invalid pattern/);
    const noRoot = gate(project({ style: { rule_set: 'js-ts', roots: ['missing'] } }));
    assert.strictEqual(noRoot.code, 1);
    assert.match(noRoot.out, /not a directory: missing/);
  });

  test('S-g the python rule set flags raise outside an edge, a mutable default argument and a global statement', async () => {
    const { loadRuleSet } = await import(pathToFileURL(GATE).href);
    const { scanText } = await import(pathToFileURL(path.join(SCRIPTS, 'style-gate', 'scan.mjs')).href);
    const rs = loadRuleSet('python', path.join(SCRIPTS, 'style-gate', 'rule-sets'));
    const opts = { edgeGlobs: [], maxLines: 500 };
    const run = (text) => scanText(text, 'app/domain.py', rs, opts).map((v) => `${v.line}:${v.rule}`);
    assert.deepStrictEqual(run('def f(x):\n    if not x:\n        raise ValueError("x")\n'), ['3:raise']);
    assert.deepStrictEqual(run('def f(x, seen=[]):\n    return x\n'), ['1:mutableDefault']);
    assert.deepStrictEqual(run('def f(x):\n    global state\n    return x\n'), ['2:globalState']);
    assert.deepStrictEqual(run('# raise in a comment\ns = "raise x"\n"""\nraise in a docstring\n"""\n'), []);
    assert.deepStrictEqual(scanText('# style-gate:edge entry point\nraise SystemExit(1)\n', 'app/main.py', rs, opts), []);
  });

  test('S-h the deployed canary gate and the guard registry reconcile pass with the style-gate entry; one fixture removed fails the canary gate', () => {
    const root = mkTmp('gsd-style-estate-');
    fs.cpSync(SCRIPTS, path.join(root, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'gsd'), { recursive: true });
    fs.copyFileSync(path.join(SCRIPTS, '..', 'docs', 'guard-estate.md'), path.join(root, 'docs', 'gsd', 'guard-estate.md'));
    const run = (name) => spawnSync(process.execPath, [path.join(root, 'scripts', 'validation', name)], { cwd: root, encoding: 'utf8' });
    const canary = run('canary-gate.mjs');
    assert.strictEqual(canary.status, 0, canary.stdout + canary.stderr);
    assert.match(canary.stdout, /style-gate: \d+ fixture\(s\)/);
    const rec = run('guard-registry-reconcile.mjs');
    assert.strictEqual(rec.status, 0, rec.stdout + rec.stderr);
    const corpus = path.join(root, 'scripts', 'validation', 'canaries', 'style-gate.canaries.mjs');
    const src = fs.readFileSync(corpus, 'utf8');
    fs.writeFileSync(corpus, src.replace(/  \{ rule: 'inputMutation', name: 'delete on a parameter'.*\n/, ''));
    const cut = run('canary-gate.mjs');
    assert.strictEqual(cut.status, 1, cut.stdout);
    assert.match(cut.stdout, /corpus keeps three fixtures per rule/);
  });
});

describe('style gate in a deployed project (agnostic-M-09 9.2 S-i)', () => {
  const git = (root, ...args) => spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' });

  test('S-i the deployed tree is excluded through the manifest; a project source file over the limit fails', () => {
    const root = mkTmp('gsd-style-deployed-');
    assert.strictEqual(spawnSync('git', ['init', '-q', root]).status, 0);
    write(root, '.planning/config.json', JSON.stringify({ project: { slug: 'demo' }, stack: { capabilities: {}, style: { rule_set: 'generic', roots: ['.'] } } }));
    const init = spawnSync(process.execPath, [GSD_TOOLS, 'project', 'init', '--root', root, '--preset', 'base'], { encoding: 'utf8', env: { ...process.env, GSD_HOME: mkTmp('gsd-style-home-') } });
    assert.strictEqual(init.status, 0, init.stdout + init.stderr);
    assert.strictEqual(git(root, 'add', '-A').status, 0);
    assert.strictEqual(git(root, 'commit', '-q', '-m', 'init').status, 0);
    const clean = gate(root);
    assert.strictEqual(clean.code, 0, clean.out);
    write(root, 'app/big.js', lines(501));
    const over = gate(root);
    assert.strictEqual(over.code, 1, over.out);
    assert.match(over.out, /app\/big\.js:501 \[oversizeFiles\]/);
    fs.rmSync(path.join(root, 'app'), { recursive: true });
    fs.appendFileSync(path.join(root, 'scripts', 'stack-lock.mjs'), lines(600));
    const dest = gate(root);
    assert.strictEqual(dest.code, 0, dest.out);
  });
});

describe('bare project init picks the style rule set (agnostic-M-09 F3)', () => {
  const bareInit = (files) => {
    const root = mkTmp('gsd-style-bare-');
    assert.strictEqual(spawnSync('git', ['init', '-q', root]).status, 0);
    write(root, '.planning/config.json', JSON.stringify({ project: { slug: 'demo' }, stack: { capabilities: {} } }));
    for (const [rel, text] of Object.entries(files)) write(root, rel, text);
    const init = spawnSync(process.execPath, [GSD_TOOLS, 'project', 'init', '--root', root, '--preset', 'base'], { encoding: 'utf8', env: { ...process.env, GSD_HOME: mkTmp('gsd-style-home-') } });
    assert.strictEqual(init.status, 0, init.stdout + init.stderr);
    return { root, ruleSet: JSON.parse(fs.readFileSync(path.join(root, '.planning', 'config.json'), 'utf8')).stack.style.rule_set };
  };
  const dupBlock = (tag) => Array.from({ length: 15 }, (_, k) => `const ${tag}${k} = compute(argumentNumber${k}, otherArgument${k}, thirdArgument${k});`).join('\n') + '\n';

  test('F3-a a JS project with a planted throw, an input mutation and a duplicate fails on all three after a bare init', () => {
    const { root, ruleSet } = bareInit({
      'package.json': '{"name":"demo"}\n',
      'src/a.js': `export const f = () => { throw new Error("x"); };\n${dupBlock('v')}`,
      'src/b.js': `export function add(items, x) {\n  items.push(x);\n  return items;\n}\n${dupBlock('v')}`,
    });
    assert.strictEqual(ruleSet, 'js-ts');
    const r = gate(root);
    assert.strictEqual(r.code, 1, r.out);
    for (const rule of ['throws', 'inputMutation', 'duplicateBlocks']) assert.match(r.out, new RegExp(`\\[${rule}\\]`), `${rule} fires`);
  });

  test('F3-b python files choose the python rule set; an empty project keeps generic and prints scanned 0 files', () => {
    assert.strictEqual(bareInit({ 'pyproject.toml': '[project]\nname = "demo"\n', 'app/main.py': 'x = 1\n' }).ruleSet, 'python');
    const empty = bareInit({});
    assert.strictEqual(empty.ruleSet, 'generic');
    const r = gate(empty.root);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /scanned 0 files/);
  });

  test('F3-c generic over non-js/ts/py source prints a loud no-language-rules line and passes', () => {
    const warn = gate(project({ style: { rule_set: 'generic', roots: ['src'] }, files: { 'src/a.go': 'package main\n' } }));
    assert.strictEqual(warn.code, 0, warn.out);
    assert.match(warn.out, /no language rules active for 1 source files/);
    const quiet = gate(project({ style: { rule_set: 'js-ts', roots: ['src'] }, files: { 'src/a.js': 'export const a = 1;\n' } }));
    assert.doesNotMatch(quiet.out, /no language rules active/);
  });

  test('R1 greenfield: init empty, a source file with a throw and a mutation added later exits 1 by default; opt-out warns only', () => {
    const { root, ruleSet } = bareInit({});
    assert.strictEqual(ruleSet, 'generic');
    assert.strictEqual(gate(root).code, 0);
    write(root, 'src/a.js', `${THROW}export function add(items, x) {\n  items.push(x);\n  return items;\n}\n`);
    const r = gate(root);
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /no language rules active for 1 source files/);
    const cfgFile = path.join(root, '.planning', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, stack: { ...cfg.stack, style: { ...cfg.stack.style, require_language_rules: false } } }));
    const off = gate(root);
    assert.strictEqual(off.code, 0, off.out);
    assert.match(off.out, /no language rules active/);
  });

  test('R1 a scripts-only project (init detection skips scripts/) fails at gate time; clean js-ts code passes', () => {
    const { root, ruleSet } = bareInit({ 'scripts/tool.mjs': THROW });
    assert.strictEqual(ruleSet, 'generic');
    const r = gate(root);
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /no language rules active for 1 source files/);
    const clean = gate(project({ style: { rule_set: 'js-ts', roots: ['src'] }, files: { 'src/a.js': 'export const a = 1;\n' } }));
    assert.strictEqual(clean.code, 0, clean.out);
  });

  test('R2 polyglot: python chosen, an unscanned .ts with a throw fails; opt-out warns and passes', () => {
    const files = { 'src/a.py': 'x = 1\n', 'src/b.py': 'y = 1\n', 'src/c.py': 'z = 1\n', 'src/web/a.ts': THROW };
    const strict = gate(project({ style: { rule_set: 'python', roots: ['src'] }, files }));
    assert.strictEqual(strict.code, 1, strict.out);
    assert.match(strict.out, /outside rule set python and were not scanned: src\/web\/a\.ts/);
    const off = gate(project({ style: { rule_set: 'python', roots: ['src'], require_language_rules: false }, files }));
    assert.strictEqual(off.code, 0, off.out);
    assert.match(off.out, /WARN 1 source file\(s\) are outside rule set python/);
  });
});

describe('style gate: duplicate blocks (agnostic-M-09 9.3)', () => {
  const block = (tag, n) => Array.from({ length: n }, (_, k) => `const ${tag}${k} = compute(argumentNumber${k}, otherArgument${k}, thirdArgument${k});`).join('\n') + '\n';

  test('D-a a 15-line block pasted into a second file fails naming both places; pasted twice in one file also fails', () => {
    const two = gate(project({ files: { 'src/a.js': block('v', 15), 'src/b.js': `export const own = 1;\n${block('v', 15)}` } }));
    assert.strictEqual(two.code, 1, two.out);
    assert.match(two.out, /src\/b\.js:2 \[duplicateBlocks\] duplicates src\/a\.js:1 \(15 lines\)/);
    const one = gate(project({ files: { 'src/a.js': `${block('v', 15)}export const gap = 1;\n${block('v', 15)}` } }));
    assert.strictEqual(one.code, 1, one.out);
    assert.match(one.out, /\[duplicateBlocks\] duplicates src\/a\.js:1/);
  });

  test('D-b a re-indented copy with comments still fails; an 11-line copy and 12 closing-bracket lines pass', () => {
    const copy = block('v', 15).split('\n').filter(Boolean).map((l) => `      ${l} // copied from a`).join('\n');
    const reindented = gate(project({ files: { 'src/a.js': block('v', 15), 'src/b.js': `// a header comment\n${copy}\n` } }));
    assert.strictEqual(reindented.code, 1, reindented.out);
    const short = gate(project({ files: { 'src/a.js': block('v', 11), 'src/b.js': block('v', 11) } }));
    assert.strictEqual(short.code, 0, short.out);
    const brackets = `${'}\n'.repeat(12)}`;
    const closers = gate(project({ files: { 'src/a.js': `${brackets}`, 'src/b.js': `${brackets}` } }));
    assert.strictEqual(closers.code, 0, closers.out);
  });

  test('D-c 40 lines pasted once yield one block, not 29', async () => {
    const { findDuplicates, normalise } = await import(pathToFileURL(path.join(SCRIPTS, 'style-gate', 'dup.mjs')).href);
    const files = [{ file: 'a.js', lines: normalise(block('w', 40), 'a.js') }, { file: 'b.js', lines: normalise(block('w', 40), 'b.js') }];
    const found = findDuplicates(files, 12);
    assert.strictEqual(found.length, 1);
    assert.deepStrictEqual(found[0], { file: 'b.js', line: 1, message: 'duplicates a.js:1 (40 lines)' });
  });

  test('D-d dup.mjs has at most 150 lines and imports only node: modules and ./scan.mjs', () => {
    const text = fs.readFileSync(path.join(SCRIPTS, 'style-gate', 'dup.mjs'), 'utf8');
    assert.ok(text.trimEnd().split('\n').length <= 150);
    const imports = [...text.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    assert.ok(imports.length > 0);
    for (const spec of imports) assert.ok(spec.startsWith('node:') || spec === './scan.mjs', spec);
  });
});
