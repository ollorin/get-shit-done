'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const driver = require('./ui-qa-driver.js');
const { validateProfile } = require('./project-profile.js');
const { applyToConfig } = require('./project-registry.js');
const { handle } = require('./hooks/gsd-ui-qa-lock.js');
const { register } = require('./demo-check.js');

const REPO = path.join(__dirname, '..', '..');
const TOOLS = path.join(__dirname, 'gsd-tools.js');
const NOW = Date.parse('2026-11-19T12:00:00Z');

const project = (uiQa, extra = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-uiqa-'));
  fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
  const capabilities = { backend: {}, web_ui: {}, ...(uiQa === undefined ? {} : { ui_qa: uiQa }) };
  fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ project: { slug: 'demo' }, stack: { capabilities, ...extra } }));
  return root;
};
const cli = (root, ...args) => {
  const r = spawnSync('node', [TOOLS, 'ui-qa', ...args, '--root', root], { encoding: 'utf8' });
  return { status: r.status, json: JSON.parse(r.stdout) };
};
const readUiQa = (root) => JSON.parse(fs.readFileSync(path.join(root, '.planning', 'config.json'), 'utf8')).stack.capabilities.ui_qa;

describe('driver adapters', () => {
  test('both drivers are listed and the default is one of them', () => {
    assert.deepStrictEqual(driver.listDrivers('mcp'), ['bladebro', 'charlotte']);
    assert.deepStrictEqual(driver.listDrivers('command'), ['playwright']);
    assert.ok(driver.listDrivers('mcp').includes(driver.defaultDriver()));
  });

  test('every adapter has the contract keys and the same op set', () => {
    const names = driver.listDrivers('mcp').map((d) => {
      const a = driver.loadAdapter(d);
      assert.strictEqual(a.driver, d);
      assert.match(a.tool_prefix, /^mcp__[a-z0-9-]+__$/);
      assert.ok(a.lock_file && a.recording.start && a.recording.stop && ['driver', 'register'].includes(a.artifact_index), d);
      for (const [op, entry] of Object.entries(a.ops)) {
        assert.ok(entry.tool === null || typeof entry.tool === 'string', `${d}.${op}`);
        if (entry.tool === null) assert.ok(entry.workaround, `${d}.${op} has no tool and no workaround`);
      }
      assert.ok(a.ops[a.recording.start] && a.ops[a.recording.stop]);
      return Object.keys(a.ops).sort();
    });
    assert.deepStrictEqual(names[0], names[1]);
  });

  test('unknown driver is a clear error naming the known drivers, never a fallback', () => {
    assert.throws(() => driver.loadAdapter('nope'), /unknown ui_qa driver "nope": known drivers are bladebro, charlotte, playwright/);
    assert.throws(() => driver.resolveContract({ driver: '../index' }), /unknown ui_qa driver/);
    assert.throws(() => driver.resolveContract({}), /unknown ui_qa driver/);
    assert.throws(() => driver.resolveContract(undefined), /no ui_qa capability/);
  });

  test('the gap document lists exactly the ops the bladebro adapter has no tool for', () => {
    const doc = fs.readFileSync(path.join(REPO, 'docs', 'ui-qa-driver-gaps.md'), 'utf8');
    const ops = driver.loadAdapter('bladebro').ops;
    const listed = [...doc.matchAll(/^\| `([a-z_]+)` \| (none|partial) \|/gm)].map((m) => m[1]).sort();
    const expected = Object.entries(ops).filter(([, e]) => e.tool === null || /partial/.test(e.note ?? '')).map(([k]) => k).sort();
    assert.deepStrictEqual(listed, expected);
    assert.ok(expected.length >= 10);
  });

  test('bladebro wait_for carries only the condition and timeout; the note names the one match key per condition', () => {
    const op = driver.loadAdapter('bladebro').ops.wait_for;
    assert.deepStrictEqual(Object.keys(op.args), ['action', 'condition', 'timeout']);
    for (const key of ['text', 'selector', 'js']) assert.match(op.note, new RegExp(`\`${key}\``));
  });

  test('bladebro maps requests to see logs=xhr and read_state to act action=read; charlotte has read_state as a workaround', () => {
    const b = driver.loadAdapter('bladebro').ops;
    assert.deepStrictEqual({ tool: b.requests.tool, args: b.requests.args }, { tool: 'see', args: { logs: 'xhr' } });
    assert.deepStrictEqual({ tool: b.read_state.tool, args: b.read_state.args }, { tool: 'act', args: { action: 'read', ref: '{ref}', format: 'json' } });
    const c = driver.loadAdapter('charlotte').ops;
    assert.strictEqual(c.read_state.tool, null);
    assert.match(c.read_state.workaround, /observe/);
  });

  test('bladebro sets BLADE_NO_ACTIVATE=1 in the server env and the recording env, and the pack README lists it', () => {
    const a = driver.loadAdapter('bladebro');
    assert.strictEqual(a.ops.configure.env.BLADE_NO_ACTIVATE, '1');
    assert.strictEqual(a.recording.env.BLADE_NO_ACTIVATE, '1');
    const readme = fs.readFileSync(path.join(REPO, 'get-shit-done', 'presets', 'packs', 'bladebro', 'README.md'), 'utf8');
    assert.match(readme, /BLADE_NO_ACTIVATE=1/);
  });
});

describe('role agents, packs and agent text', () => {
  const frontmatterTools = (agent) => fs.readFileSync(path.join(REPO, 'agents', `${agent}.md`), 'utf8').match(/^tools: (.*)$/m)[1].split(', ').filter((t) => t.startsWith('mcp__'));

  test('every role agent lists explicit driver tools, none wider than its role allows, for both drivers', () => {
    const ui = driver.resolveContract({ driver: 'charlotte' });
    for (const [agent, role] of Object.entries({ 'gsd-product-investigator': 'investigator', 'gsd-demo': 'demo', 'gsd-ui-qa': 'qa' })) {
      assert.strictEqual(driver.roleOf(agent, undefined), role);
      for (const d of driver.listDrivers('mcp')) {
        const c = driver.resolveContract({ driver: d });
        const allowed = new Set(ui.roles[role].map((op) => driver.fullToolName(c, op)).filter(Boolean));
        const listed = frontmatterTools(agent).filter((t) => t.startsWith(c.tool_prefix));
        assert.ok(listed.length > 0, `${agent} lists no ${d} tool`);
        for (const t of listed) assert.ok(allowed.has(t), `${agent}: ${t} is outside the ${role} role`);
      }
    }
    assert.ok(!frontmatterTools('gsd-product-investigator').some((t) => /click|type|evaluate|cookies/.test(t)));
    assert.deepStrictEqual(frontmatterTools('gsd-product-investigator').filter((t) => t.startsWith('mcp__bladebro__')), ['mcp__bladebro__act', 'mcp__bladebro__see', 'mcp__bladebro__vision']);
  });

  test('every role names only ops that exist in the adapters', () => {
    for (const d of driver.listDrivers('mcp')) {
      const c = driver.resolveContract({ driver: d });
      for (const [role, ops] of Object.entries(c.roles)) for (const op of ops) assert.ok(c.ops[op], `${d}: role ${role} names unknown op ${op}`);
    }
  });

  test('the bladebro pack allows exactly the five bladebro tools and documents the MCP registration', () => {
    const dir = path.join(REPO, 'get-shit-done', 'presets', 'packs', 'bladebro');
    const allow = JSON.parse(fs.readFileSync(path.join(dir, 'settings.fragment.json'), 'utf8')).permissions.allow;
    assert.deepStrictEqual([...allow].sort(), ['act', 'run', 'see', 'state', 'vision'].map((t) => `mcp__bladebro__${t}`));
    assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /claude mcp add --scope user bladebro -- <path>\/bladebro mcp/);
    const r = spawnSync('node', [TOOLS, 'pack', 'install', 'bladebro', '--root', project(undefined)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout).manual_settings, JSON.parse(fs.readFileSync(path.join(dir, 'settings.fragment.json'), 'utf8')));
  });

  test('the stack-neutral agent carries no domain vocabulary; the check catches it', () => {
    const DOMAIN = /\bplayers?\b|PlayerDetail/i;
    assert.ok(DOMAIN.test('View in Players') && DOMAIN.test('at PlayerDetail (x.tsx:1)'));
    assert.ok(!DOMAIN.test(fs.readFileSync(path.join(REPO, 'agents', 'gsd-ui-qa.md'), 'utf8')));
  });
});

describe('resolveContract', () => {
  test('a bare driver resolves to the adapter, agent from the index', () => {
    const c = driver.resolveContract({ driver: 'bladebro' });
    assert.strictEqual(c.agent, 'gsd-ui-qa');
    assert.strictEqual(c.tool_prefix, 'mcp__bladebro__');
    assert.strictEqual(driver.fullToolName(c, 'navigate'), 'mcp__bladebro__act');
    assert.deepStrictEqual(c.ops.navigate.args, { action: 'navigate', url: '{url}' });
    assert.strictEqual(driver.fullToolName(c, 'drag'), null);
    assert.deepStrictEqual(c.reset_patterns, []);
    assert.throws(() => driver.fullToolName(c, 'no_such_op'), /no op "no_such_op"/);
  });

  test('values the project sets win; ops merge per op', () => {
    const c = driver.resolveContract({
      driver: 'charlotte', agent: 'gsd-charlotte-qa', lock_file: '.tmp/x.lock', reset_patterns: ['db reset'],
      ops: { navigate: { tool: 'custom_nav', args: { u: '{url}' } } }, recording: { env: { A: '1' } },
    });
    assert.strictEqual(c.agent, 'gsd-charlotte-qa');
    assert.strictEqual(c.lock_file, '.tmp/x.lock');
    assert.strictEqual(driver.fullToolName(c, 'navigate'), 'mcp__charlotte__custom_nav');
    assert.strictEqual(driver.fullToolName(c, 'click'), 'mcp__charlotte__charlotte_click');
    assert.deepStrictEqual(c.recording.env, { A: '1' });
    assert.strictEqual(c.recording.start, 'screencast_start');
  });
});

describe('fillContract and gsd-tools ui-qa', () => {
  test('fill adds missing keys, keeps set ones, leaves an unknown driver alone', () => {
    const filled = driver.fillContract({ driver: 'bladebro', agent: 'mine', reset_patterns: ['x'] });
    assert.strictEqual(filled.agent, 'mine');
    assert.deepStrictEqual(filled.reset_patterns, ['x']);
    assert.strictEqual(filled.tool_prefix, 'mcp__bladebro__');
    assert.deepStrictEqual(filled.agent_aliases, ['gsd-charlotte-qa']);
    const odd = { driver: 'zzz' };
    assert.strictEqual(driver.fillContract(odd), odd);
  });

  test('drivers prints the default and the aliases', () => {
    const r = cli(project(undefined), 'drivers');
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.json.default, 'bladebro');
    assert.deepStrictEqual(r.json.agent_aliases, ['gsd-charlotte-qa']);
  });

  test('apply with no ui_qa and no flag writes the default driver; a second run writes nothing', () => {
    const root = project(undefined);
    const first = cli(root, 'apply');
    assert.strictEqual(first.json.written, true);
    assert.strictEqual(readUiQa(root).driver, 'bladebro');
    assert.strictEqual(readUiQa(root).agent, 'gsd-ui-qa');
    assert.strictEqual(cli(root, 'apply').json.written, false);
    assert.deepStrictEqual(cli(root, 'contract').json.ops.drag.tool, null);
  });

  test('apply --driver X on the same driver keeps every set value', () => {
    const root = project({ driver: 'charlotte', agent: 'gsd-charlotte-qa', lock_file: '.tmp/mine.lock', reset_patterns: ['db reset'] });
    cli(root, 'apply', '--driver', 'charlotte');
    const ui = readUiQa(root);
    assert.deepStrictEqual([ui.driver, ui.agent, ui.lock_file, ui.reset_patterns], ['charlotte', 'gsd-charlotte-qa', '.tmp/mine.lock', ['db reset']]);
    assert.strictEqual(ui.tool_prefix, 'mcp__charlotte__');
  });

  test('apply --driver bladebro on a charlotte project switches the driver keys and keeps lock_file, reset_patterns and agent', () => {
    const root = project({ driver: 'charlotte', agent: 'gsd-charlotte-qa', tool_prefix: 'mcp__charlotte__', lock_file: '.tmp/mine.lock', reset_patterns: ['db reset'], recording: { start: 'x' }, ops: { navigate: { tool: 'x' } } });
    const r = cli(root, 'apply', '--driver', 'bladebro');
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.json.written, true);
    assert.deepStrictEqual(r.json.switched, { from: 'charlotte', to: 'bladebro' });
    assert.ok(['driver', 'tool_prefix', 'recording', 'ops'].every((k) => r.json.changed.includes(k)), JSON.stringify(r.json.changed));
    const ui = readUiQa(root);
    assert.deepStrictEqual([ui.driver, ui.tool_prefix, ui.agent, ui.lock_file, ui.reset_patterns], ['bladebro', 'mcp__bladebro__', 'gsd-charlotte-qa', '.tmp/mine.lock', ['db reset']]);
    assert.strictEqual(ui.ops, undefined);
    assert.strictEqual(ui.recording.env.BLADE_RECORD, '1');
    assert.strictEqual(cli(root, 'apply', '--driver', 'bladebro').json.written, false);
  });

  test('unknown driver: contract and apply exit 1 naming the drivers, and the config is not written', () => {
    const root = project({ driver: 'nope' });
    const before = fs.readFileSync(path.join(root, '.planning', 'config.json'), 'utf8');
    for (const args of [['contract'], ['apply']]) {
      const r = cli(root, ...args);
      assert.strictEqual(r.status, 1);
      assert.match(r.json.error, /unknown ui_qa driver "nope"/);
    }
    assert.match(cli(project(undefined), 'apply', '--driver', 'nope').json.error, /known drivers are/);
    assert.strictEqual(fs.readFileSync(path.join(root, '.planning', 'config.json'), 'utf8'), before);
  });

  test('no capability: contract exits 1', () => {
    const r = cli(project(undefined), 'contract');
    assert.strictEqual(r.status, 1);
    assert.match(r.json.error, /no ui_qa capability/);
  });
});

describe('project sync and profile validation', () => {
  test('applyToConfig fills the contract of an existing ui_qa object and never adds one', () => {
    const ctx = { slug: 'x', port_base: 55000 };
    const out = applyToConfig({ project: { slug: 'x' }, stack: { capabilities: { ui_qa: { driver: 'bladebro', lock_file: '.tmp/keep.lock' } } } }, ctx);
    assert.strictEqual(out.stack.capabilities.ui_qa.lock_file, '.tmp/keep.lock');
    assert.strictEqual(out.stack.capabilities.ui_qa.agent, 'gsd-ui-qa');
    assert.strictEqual(applyToConfig(out, ctx).stack.capabilities.ui_qa.agent, 'gsd-ui-qa');
    const none = applyToConfig({ project: { slug: 'x' }, stack: { capabilities: {} } }, ctx);
    assert.ok(!('ui_qa' in none.stack.capabilities));
    const odd = applyToConfig({ project: { slug: 'x' }, stack: { capabilities: { ui_qa: { driver: 'zzz' } } } }, ctx);
    assert.deepStrictEqual(odd.stack.capabilities.ui_qa, { driver: 'zzz' });
  });

  const problemsFor = (uiQa) => validateProfile({ found: true, stack: { capabilities: { ui_qa: uiQa } } }).invalid.filter((e) => /ui_qa/.test(e.key));

  test('validation: a bare known driver is valid; an unknown driver is named; a bad agent is refused', () => {
    assert.deepStrictEqual(problemsFor({ driver: 'bladebro' }), []);
    assert.match(JSON.stringify(problemsFor({ driver: 'nope' })), /unknown driver \\"nope\\": known drivers are bladebro, charlotte, playwright/);
    assert.strictEqual(problemsFor({ driver: 'charlotte', agent: '' }).length, 1);
    assert.strictEqual(problemsFor({ driver: 'charlotte', ops: [] }).length, 1);
  });
});

describe('agent aliases', () => {
  const lockRoot = (uiQa) => project(uiQa);
  const start = (root, agent) => handle({ hook_event_name: 'SubagentStart', agent_type: agent, agent_id: 'q1', cwd: root }, { nowMs: NOW, env: {} });

  test('the lock hook takes the lock for the configured agent and for each alias, not for another agent', () => {
    const ui = driver.fillContract({ driver: 'bladebro' });
    for (const [agent, locked] of [['gsd-ui-qa', true], ['gsd-charlotte-qa', true], ['gsd-executor', false]]) {
      const root = lockRoot(ui);
      start(root, agent);
      assert.strictEqual(fs.existsSync(path.join(root, ui.lock_file)), locked, agent);
    }
  });

  test('the old agent stays installable as a pack shim that points at gsd-ui-qa; the generic agent names no driver in its body', () => {
    const shim = fs.readFileSync(path.join(REPO, 'get-shit-done', 'presets', 'packs', 'charlotte', 'agents', 'gsd-charlotte-qa.md'), 'utf8');
    assert.match(shim, /^name: gsd-charlotte-qa$/m);
    assert.match(shim, /Deprecated alias of gsd-ui-qa/);
    assert.match(shim, /agents\/gsd-ui-qa\.md/);
    const generic = fs.readFileSync(path.join(REPO, 'agents', 'gsd-ui-qa.md'), 'utf8');
    assert.match(generic, /^name: gsd-ui-qa$/m);
    const [, front, body] = generic.split(/^---$/m);
    assert.match(front, /mcp__charlotte__charlotte_navigate/);
    assert.match(front, /mcp__bladebro__act/);
    assert.doesNotMatch(front, /mcp__\w+__\*/);
    assert.ok(!/charlotte|bladebro/i.test(body), 'agent body must take tool names from the contract');
  });

  test('every agent that drives a browser allows both drivers and reads the contract', () => {
    for (const f of ['gsd-ui-qa', 'gsd-demo', 'gsd-product-investigator']) {
      const text = fs.readFileSync(path.join(REPO, 'agents', `${f}.md`), 'utf8');
      const [, front, body] = text.split(/^---$/m);
      assert.match(front, /^tools: .*mcp__charlotte__charlotte_navigate.*mcp__bladebro__act/m, f);
      assert.doesNotMatch(front, /mcp__\w+__\*/, f);
      assert.match(text, /ui-qa contract/, f);
      assert.ok(!/mcp__charlotte__charlotte_/.test(body), f);
    }
  });
});

describe('demo-check register (driver without an index of its own)', () => {
  test('copies the file under its content id and appends the index row; re-registering is idempotent', () => {
    const root = project({ driver: 'bladebro' });
    const phase = path.join(root, '.planning', 'phases', '1-x');
    fs.mkdirSync(phase, { recursive: true });
    const png = path.join(root, 'shot.png');
    fs.writeFileSync(png, Buffer.concat([Buffer.from('89504e47', 'hex'), Buffer.alloc(40, 3)]));
    const row = register(phase, 'shot', { file: png, url: 'http://localhost:3000/', title: 'Home' });
    register(phase, 'shot', { file: png, url: 'http://localhost:3000/', title: 'Home' });
    const index = JSON.parse(fs.readFileSync(path.join(phase, 'demo', 'shots', '.bladebro-screenshots.json'), 'utf8'));
    assert.deepStrictEqual(index.map((r) => r.id), [row.id]);
    assert.ok(fs.existsSync(path.join(phase, 'demo', 'shots', `${row.id}.png`)));
    assert.throws(() => register(phase, 'shot', { file: path.join(root, 'missing.png') }), /existing file/);
    assert.throws(() => register(phase, 'video', { file: png }), /not webm or mp4/);
  });
});

describe('command-kind driver (scripted UI-QA tier)', () => {
  const CASINO_MALL = { driver: 'playwright', browser: 'system-chrome', command: 'npm run ui-qa', agent: 'gsd2-runner' };
  const problems = (uiQa) => validateProfile({ found: true, stack: { capabilities: { ui_qa: uiQa } } }).invalid.filter((e) => /ui_qa/.test(e.key));

  test('casino-mall config resolves as kind command and validates unedited', () => {
    const c = driver.resolveContract(CASINO_MALL);
    assert.strictEqual(c.kind, 'command');
    assert.strictEqual(c.command, 'npm run ui-qa');
    assert.strictEqual(c.agent, 'gsd2-runner');
    assert.ok(!('tool_prefix' in c) && !('ops' in c));
    assert.deepStrictEqual(problems(CASINO_MALL), []);
    assert.deepStrictEqual(driver.fillContract(CASINO_MALL), CASINO_MALL);
  });

  test('agent defaults to gsd2-runner; command is required', () => {
    assert.strictEqual(driver.resolveContract({ driver: 'playwright', command: 'x' }).agent, 'gsd2-runner');
    assert.throws(() => driver.resolveContract({ driver: 'playwright' }), /command driver: set .*command/);
    assert.match(JSON.stringify(problems({ driver: 'playwright' })), /needs a non-empty command/);
  });

  test('gsd-tools ui-qa contract prints kind command; apply keeps the config byte-equal', () => {
    const root = project(CASINO_MALL);
    const r = cli(root, 'contract');
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.json.kind, 'command');
    const a = cli(root, 'apply');
    assert.strictEqual(a.json.written, false);
    assert.strictEqual(cli(root, 'contract', '--tier', 'mcp').status, 1);
    assert.strictEqual(cli(root, 'contract', '--tier', 'scripted').json.driver, 'playwright');
    assert.strictEqual(cli(project(undefined), 'apply', '--driver', 'playwright').status, 1);
    assert.strictEqual(cli(project(undefined), 'apply', '--driver', 'playwright', '--command', 'npm run ui-qa').json.ui_qa.command, 'npm run ui-qa');
  });

  test('an unknown driver is still an error', () => {
    assert.throws(() => driver.resolveContract({ driver: 'cypress', command: 'x' }), /unknown ui_qa driver "cypress"/);
    assert.match(JSON.stringify(problems({ driver: 'cypress', command: 'x' })), /unknown driver/);
  });

  test('both tiers: ui_qa.mcp beside a command driver, ui_qa.scripted beside an MCP driver', () => {
    const both = { ...CASINO_MALL, mcp: { driver: 'charlotte' } };
    assert.deepStrictEqual(problems(both), []);
    const c = driver.resolveContract(both);
    assert.strictEqual(c.kind, 'command');
    assert.strictEqual(c.mcp.kind, 'mcp');
    assert.strictEqual(c.mcp.agent, 'gsd-ui-qa');
    assert.strictEqual(c.mcp.tool_prefix, 'mcp__charlotte__');
    const flipped = { driver: 'bladebro', scripted: { driver: 'playwright', command: 'npm run ui-qa' } };
    assert.deepStrictEqual(problems(flipped), []);
    assert.strictEqual(driver.resolveContract(flipped).scripted.kind, 'command');
    assert.strictEqual(problems({ ...CASINO_MALL, mcp: { driver: 'playwright', command: 'x' } }).length, 1);
    assert.strictEqual(problems({ driver: 'bladebro', mcp: { driver: 'charlotte' } }).length, 1);
    assert.strictEqual(problems({ ...CASINO_MALL, scripted: { driver: 'playwright', command: 'x' } }).length, 1);
  });

  const call = (uiQa, event, extra) => handle({ hook_event_name: event, cwd: project(uiQa), session_id: 's', agent_id: 'a1', ...extra }, { nowMs: NOW, holderPid: process.pid });

  test('lock hook is a no-op for a command driver: no deny, no lock, even for MCP tools and its own agent', () => {
    for (const [event, extra] of [
      ['PreToolUse', { tool_name: 'mcp__charlotte__charlotte_click' }],
      ['PreToolUse', { tool_name: 'mcp__bladebro__act', tool_input: { action: 'click' } }],
      ['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'supabase db reset' } }],
      ['SubagentStart', { agent_type: 'gsd2-runner' }],
      ['SubagentStop', { agent_type: 'gsd2-runner' }],
    ]) assert.deepStrictEqual(call(CASINO_MALL, event, extra), { exitCode: 0 });
  });

  test('with a declared mcp tier the hook enforces that tier only', () => {
    const both = { ...CASINO_MALL, mcp: { driver: 'charlotte' } };
    assert.strictEqual(call(both, 'PreToolUse', { tool_name: 'mcp__bladebro__act' }).exitCode, 2);
    assert.strictEqual(call(both, 'PreToolUse', { tool_name: 'mcp__charlotte__charlotte_click' }).exitCode, 0);
  });
});
