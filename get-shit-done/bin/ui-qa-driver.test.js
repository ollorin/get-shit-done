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

  test('the gap document lists every op the charlotte adapter has no tool for in its bladebro-only table', () => {
    const doc = fs.readFileSync(path.join(REPO, 'docs', 'ui-qa-driver-gaps.md'), 'utf8');
    const section = doc.split('## Bladebro ops with no Charlotte equivalent')[1].split(/^## /m)[0];
    const listed = [...section.matchAll(/^\| `([a-z_]+)` \| /gm)].map((m) => m[1]).sort();
    const expected = Object.entries(driver.loadAdapter('charlotte').ops).filter(([, e]) => e.tool === null).map(([k]) => k).sort();
    assert.deepStrictEqual(listed, expected);
    assert.ok(expected.length >= 8);
  });

  test('bladebro wait_for carries only the condition and timeout; the note names the one match key per condition', () => {
    const op = driver.loadAdapter('bladebro').ops.wait_for;
    assert.deepStrictEqual(Object.keys(op.args), ['action', 'condition', 'timeout']);
    for (const key of ['text', 'selector', 'js']) assert.match(op.note, new RegExp(`\`${key}\``));
  });

  test('bladebro maps requests to see logs=xhr and read_state to act action=read; charlotte has read_state as a workaround', () => {
    const b = driver.loadAdapter('bladebro').ops;
    assert.deepStrictEqual({ tool: b.requests.tool, args: b.requests.args }, { tool: 'see', args: { logs: 'xhr' } });
    assert.deepStrictEqual({ tool: b.read_state.tool, args: b.read_state.args }, { tool: 'act', args: { action: 'read', ref: '{ref}', format: '{format}' } });
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
      const listedAll = frontmatterTools(agent);
      const allowedAll = new Set();
      for (const d of driver.listDrivers('mcp')) {
        const c = driver.resolveContract({ driver: d });
        const allowed = new Set(ui.roles[role].map((op) => driver.fullToolName(c, op)).filter(Boolean));
        for (const t of allowed) allowedAll.add(t);
        const listed = listedAll.filter((t) => t.startsWith(c.tool_prefix));
        assert.ok(listed.length > 0, `${agent} lists no ${d} tool`);
        for (const t of listed) assert.ok(allowed.has(t), `${agent}: ${t} is outside the ${role} role`);
        for (const t of allowed) assert.ok(listedAll.includes(t), `${agent} lacks ${t}, the ${d} tool of a ${role} op`);
      }
      for (const t of listedAll) assert.ok(allowedAll.has(t), `${agent}: ${t} serves no ${role} op`);
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
    assert.deepStrictEqual(filled.agent_aliases, [], 'a custom agent gets no default alias, as resolveMcpTier');
    assert.deepStrictEqual(driver.fillContract({ driver: 'bladebro' }).agent_aliases, ['gsd-charlotte-qa']);
    const odd = { driver: 'zzz' };
    assert.strictEqual(driver.fillContract(odd), odd);
  });

  test('drivers prints the default and the aliases', () => {
    const r = cli(project(undefined), 'drivers');
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.json.default, 'bladebro');
    assert.deepStrictEqual(r.json.defaults.agent_aliases, ['gsd-charlotte-qa']);
    assert.strictEqual(r.json.project, undefined);
  });

  test('drivers inside a project shows its resolved aliases beside the labelled adapter defaults', () => {
    const cleared = cli(project({ driver: 'bladebro', agent: 'custom-qa' }), 'drivers').json;
    assert.deepStrictEqual(cleared.project, { driver: 'bladebro', agent: 'custom-qa', agent_aliases: [] });
    assert.deepStrictEqual(cleared.defaults.agent_aliases, ['gsd-charlotte-qa']);
    assert.deepStrictEqual(cli(project({ driver: 'bladebro' }), 'drivers').json.project.agent_aliases, ['gsd-charlotte-qa']);
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

describe('apply --driver between kinds and the mixed-tier hook', () => {
  const valid = (u) => assert.deepStrictEqual(problems(u), []);
  const problems = (u) => validateProfile({ found: true, stack: { capabilities: { ui_qa: u } } }).invalid.filter((e) => /ui_qa/.test(e.key));
  const apply = (uiQa, ...args) => {
    const root = project(uiQa);
    const r = cli(root, 'apply', ...args);
    assert.strictEqual(r.status, 0, JSON.stringify(r.json));
    return { r, out: readUiQa(root) };
  };

  test('MCP top + scripted tier, switch to a command driver not nested: old top becomes ui_qa.mcp, no stale scripted, agent is the new driver default', () => {
    const { out } = apply({ driver: 'charlotte', agent: 'gsd-ui-qa', lock_file: '.tmp/keep.lock', scripted: { driver: 'playwright', command: 'old' } }, '--driver', 'playwright', '--command', 'new');
    valid(out);
    assert.strictEqual(out.scripted, undefined);
    assert.strictEqual(out.driver, 'playwright');
    assert.strictEqual(out.command, 'new');
    assert.strictEqual(out.agent, 'gsd2-runner');
    assert.strictEqual(out.mcp.driver, 'charlotte');
    assert.strictEqual(out.mcp.lock_file, '.tmp/keep.lock');
  });

  test('swap: target equals the nested driver, so top and nested trade places', () => {
    const { out } = apply({ driver: 'charlotte', lock_file: '.tmp/keep.lock', agent: 'gsd-ui-qa', scripted: { driver: 'playwright', command: 'npm run ui', agent: 'gsd2-runner' } }, '--driver', 'playwright');
    valid(out);
    assert.deepStrictEqual([out.driver, out.command, out.agent, out.scripted], ['playwright', 'npm run ui', 'gsd2-runner', undefined]);
    assert.strictEqual(out.mcp.driver, 'charlotte');
    assert.strictEqual(out.mcp.lock_file, '.tmp/keep.lock');
    assert.strictEqual(out.mcp.agent, 'gsd-ui-qa');
    assert.strictEqual(driver.resolveContract(out).mcp.tool_prefix, 'mcp__charlotte__');
  });

  test('command top + mcp tier, switch to an MCP driver: old top becomes ui_qa.scripted, no stale mcp, agent is the MCP default', () => {
    const { out } = apply({ driver: 'playwright', command: 'npm run ui', agent: 'gsd2-runner', mcp: { driver: 'charlotte' } }, '--driver', 'bladebro');
    valid(out);
    assert.strictEqual(out.mcp, undefined);
    assert.strictEqual(out.driver, 'bladebro');
    assert.strictEqual(out.agent, 'gsd-ui-qa');
    assert.deepStrictEqual([out.scripted.driver, out.scripted.command, out.scripted.agent], ['playwright', 'npm run ui', 'gsd2-runner']);
  });

  test('command top + mcp tier, swap to the nested MCP driver: minimal nested tier comes out complete', () => {
    const { out, r } = apply({ driver: 'playwright', command: 'npm run ui', agent: 'gsd2-runner', reset_patterns: ['db reset'], mcp: { driver: 'charlotte' } }, '--driver', 'charlotte');
    valid(out);
    assert.deepStrictEqual([out.driver, out.agent, out.mcp], ['charlotte', 'gsd-ui-qa', undefined]);
    assert.deepStrictEqual(out.reset_patterns, ['db reset']);
    assert.strictEqual(out.scripted.command, 'npm run ui');
    assert.strictEqual(out.scripted.reset_patterns, undefined);
    assert.ok(r.json.changed.includes('scripted'));
  });

  test('apply fills the missing keys of a minimal nested tier and is idempotent', () => {
    const root = project({ driver: 'playwright', command: 'x', agent: 'gsd2-runner', mcp: { driver: 'charlotte' } });
    cli(root, 'apply');
    const out = readUiQa(root);
    assert.deepStrictEqual([out.mcp.agent, out.mcp.lock_file, out.mcp.tool_prefix], ['gsd-ui-qa', '.tmp/charlotte.lock', 'mcp__charlotte__']);
    valid(out);
    assert.strictEqual(cli(root, 'apply').json.written, false);
  });

  test('mixed project with a minimal nested tier: the hook locks for gsd-ui-qa at the lock_file the contract reports', () => {
    const uiQa = { driver: 'playwright', command: 'x', agent: 'gsd2-runner', mcp: { driver: 'charlotte' } };
    const root = project(uiQa);
    const mcp = cli(root, 'contract', '--tier', 'mcp').json;
    assert.strictEqual(mcp.agent, 'gsd-ui-qa');
    assert.strictEqual(mcp.lock_file, '.tmp/charlotte.lock');
    const r = handle({ hook_event_name: 'SubagentStart', cwd: root, session_id: 's', agent_id: 'a1', agent_type: 'gsd-ui-qa' }, { nowMs: NOW, holderPid: process.pid });
    assert.strictEqual(r.exitCode, 0);
    assert.ok(fs.existsSync(path.join(root, mcp.lock_file)));
    assert.ok(!fs.existsSync(path.join(root, '.tmp', 'ui-qa.lock')));
    const alias = handle({ hook_event_name: 'SubagentStart', cwd: root, session_id: 's', agent_id: 'a2', agent_type: 'gsd-charlotte-qa' }, { nowMs: NOW, holderPid: process.pid });
    assert.strictEqual(alias.exitCode, 0);
    assert.ok(JSON.parse(fs.readFileSync(path.join(root, mcp.lock_file), 'utf8')).holders.includes('a2'));
  });
});

describe('logical op resolver, per-instance env, wait_for match keys', () => {
  const cliIn = (cwd, ...args) => {
    const r = spawnSync('node', [TOOLS, 'ui-qa', ...args], { encoding: 'utf8', cwd });
    return { status: r.status, json: JSON.parse(r.stdout) };
  };
  const cliArgs = (...args) => cliIn(undefined, ...args);
  const opOf =(driverName, tool, args) => driver.opsOf(driver.resolveContract({ driver: driverName }), tool, args);

  test('opsOf maps bladebro act action=eval and charlotte charlotte_evaluate to evaluate, by args not tool name', () => {
    assert.deepStrictEqual(opOf('bladebro', 'mcp__bladebro__act', { action: 'eval', js: '1' }), ['evaluate']);
    assert.deepStrictEqual(opOf('bladebro', 'act', { action: 'navigate', url: 'x' }), ['navigate']);
    assert.deepStrictEqual(opOf('charlotte', 'mcp__charlotte__charlotte_evaluate', {}), ['evaluate']);
    assert.deepStrictEqual(opOf('bladebro', 'act', { action: 'nope' }), ['unknown']);
    assert.deepStrictEqual(opOf('bladebro', 'see', { logs: 'xhr' }), ['requests']);
  });

  test('op-of CLI resolves with --driver and with the project driver; a shared tool returns every op it can be', () => {
    const r = cliArgs('op-of', '--tool', 'mcp__bladebro__act', '--args', '{"action":"eval"}', '--driver', 'bladebro');
    assert.deepStrictEqual([r.status, r.json.ops, r.json.unknown, 'op' in r.json], [0, ['evaluate'], false, false]);
    const p = cli(project({ driver: 'charlotte' }), 'op-of', '--tool', 'charlotte_evaluate');
    assert.deepStrictEqual(p.json.ops, ['evaluate']);
    const fill = driver.opsOf(driver.resolveContract({ driver: 'bladebro' }), 'act', { action: 'fill' });
    assert.deepStrictEqual(fill, ['submit', 'toggle']);
    assert.strictEqual(cliArgs('op-of', '--driver', 'bladebro').status, 1);
  });

  describe('every call form that runs page JS or is unmapped is accounted for', () => {
    const B = (args, tool = 'mcp__bladebro__act') => opOf('bladebro', tool, args);
    const evalStep = { action: 'eval', js: 'document.cookie' };

    test('act wait condition=js (and a bare js field) is evaluate as well as wait_for', () => {
      assert.deepStrictEqual(B({ action: 'wait', condition: 'js', js: 'window.x', timeout: 1 }), ['evaluate', 'wait_for']);
      assert.deepStrictEqual(B({ action: 'wait', js: 'window.x' }), ['evaluate', 'wait_for']);
      assert.deepStrictEqual(B({ action: 'wait', condition: 'text', text: 'hi' }), ['wait_for']);
    });

    test('act batch returns the union of its steps, nested eval included', () => {
      assert.deepStrictEqual(B({ action: 'batch', steps: [{ action: 'click', ref: 'e1' }, evalStep] }), ['click', 'evaluate']);
      assert.deepStrictEqual(B({ action: 'batch', steps: [{ action: 'js', js: '1' }] }), ['evaluate']);
      assert.deepStrictEqual(B({ action: 'batch', steps: [{ action: 'wait', condition: 'js', js: '1' }] }), ['evaluate', 'wait_for']);
      assert.deepStrictEqual(B({ action: 'batch', steps: [{ action: 'see', logs: 'console' }, { action: 'state', op: 'cookies' }] }), ['console', 'get_cookies']);
    });

    test('run returns the union over steps, then/else branches and loop bodies; if/while condition=js is evaluate', () => {
      assert.deepStrictEqual(B({ steps: [{ action: 'navigate', url: 'x' }, evalStep] }, 'mcp__bladebro__run'), ['evaluate', 'navigate']);
      assert.deepStrictEqual(B({ steps: [{ action: 'if', condition: 'js', js: 'true', then: [{ action: 'click', ref: 'e1' }] }] }, 'run'), ['click', 'evaluate']);
      assert.deepStrictEqual(B({ steps: [{ action: 'while', condition: 'js', js: 'true', max: 2, steps: [{ action: 'scroll', dy: 5 }] }] }, 'run'), ['evaluate', 'scroll']);
      assert.deepStrictEqual(B({ steps: [{ action: 'if', condition: 'text', text: 'a', then: [], else: [evalStep] }] }, 'run'), ['evaluate']);
      assert.deepStrictEqual(B({ steps: [{ action: 'if', condition: 'text', text: 'a', then: [{ action: 'back' }] }] }, 'run'), ['back']);
    });

    test('an unknown action, an unmapped step, malformed nesting and non-object args yield unknown, never []', () => {
      assert.deepStrictEqual(B({ action: 'nope' }), ['unknown']);
      assert.deepStrictEqual(B({ action: 'batch', steps: [{ action: 'click', ref: 'e1' }, { action: 'nope' }] }), ['click', 'unknown']);
      assert.deepStrictEqual(B({ action: 'batch', steps: [{ ref: 'e1' }] }), ['unknown']);
      assert.deepStrictEqual(B({ action: 'batch' }), ['unknown']);
      assert.deepStrictEqual(B({ steps: 'x' }, 'run'), ['unknown']);
      assert.deepStrictEqual(B('not-an-object'), ['unknown']);
      assert.deepStrictEqual(B({ action: 'frobnicate' }), ['unknown']);
      assert.deepStrictEqual(opOf('bladebro', 'mcp__bladebro__other', {}), ['unknown']);
      const deep = Array.from({ length: 40 }).reduce((inner) => ({ action: 'if', condition: 'text', text: 'a', then: [inner] }), { action: 'back' });
      assert.ok(B({ steps: [deep] }, 'run').includes('unknown'));
    });

    test('normalisation follows bladebro: condition is trimmed (run.rs:153), action/op/mode are exact (act.rs:342)', () => {
      for (const condition of [' js', 'js ', '\tjs\n', ' JS ', 'JS']) {
        assert.deepStrictEqual(B({ action: 'wait', condition, text: 'document.cookie' }), ['evaluate', 'wait_for'], JSON.stringify(condition));
        assert.deepStrictEqual(B({ steps: [{ action: 'wait', condition, js: '1' }] }, 'run'), ['evaluate', 'wait_for']);
        assert.ok(B({ action: 'batch', steps: [{ action: 'if', condition, js: '1', then: [] }] }).includes('evaluate'));
      }
      assert.deepStrictEqual(B({ action: 'wait', condition: ' text ', text: 'x' }), ['wait_for']);
      for (const action of [' eval ', 'EVAL', 'eval\n']) assert.deepStrictEqual(B({ action, js: '1' }), ['unknown'], JSON.stringify(action));
      assert.deepStrictEqual(B({ action: 'batch', steps: [{ action: ' eval', js: '1' }] }), ['unknown']);
      assert.deepStrictEqual(B({ op: ' open-tab ' }, 'state'), ['unknown']);
    });

    test('a nested step is found in whatever field holds it: wait else, unknown container keys, object-valued fields', () => {
      const evalOnly = (args, tool) => assert.ok(B(args, tool).includes('evaluate'), JSON.stringify(args));
      evalOnly({ steps: [{ action: 'wait', condition: 'text', text: 'x', else: [{ action: 'eval', js: '1' }] }] }, 'run');
      evalOnly({ action: 'wait', condition: 'text', text: 'x', else: [{ action: 'eval', js: '1' }] });
      evalOnly({ action: 'click', ref: 'e1', on_error: [{ action: 'eval', js: '1' }] });
      evalOnly({ steps: [{ action: 'navigate', url: 'x', whatever_next: [{ action: 'eval', js: '1' }] }] }, 'run');
      evalOnly({ action: 'batch', steps: [{ action: 'click', ref: 'e1', fallback: { action: 'eval', js: '1' } }] });
      evalOnly({ action: 'wait', condition: 'text', text: 'x', deep: [{ action: 'if', condition: 'text', text: 'a', then: [{ action: 'eval', js: '1' }] }] });
      assert.deepStrictEqual(B({ action: 'click', ref: 'e1', extra: [{ ref: 'e2' }] }), ['click', 'unknown']);
      assert.deepStrictEqual(B({ action: 'click', ref: 'e1', extra: [{ action: 'nope' }] }), ['click', 'unknown']);
      assert.deepStrictEqual(B({ action: 'fill', fields: [{ ref: 'e1', text: 'a' }] }), ['submit', 'toggle']);
    });

    test('act actions without a logical op yesterday now map; tab and state ops sent via act resolve like the state tool', () => {
      const expected = { clear: 'clear_field', pdf: 'export_pdf', download: 'download', paginate: 'paginate', collect: 'collect', upload: 'upload' };
      for (const [action, op] of Object.entries(expected)) assert.deepStrictEqual(B({ action }), [op], action);
      assert.deepStrictEqual(B({ action: 'open-tab', url: 'x' }), ['tab_open']);
      assert.deepStrictEqual(B({ action: 'close-tab', target_id: '1' }), ['tab_close']);
      assert.deepStrictEqual(B({ action: 'switch-tab', target_id: '1' }), ['tab_switch']);
      assert.deepStrictEqual(B({ action: 'state', op: 'open-tab', url: 'x' }), ['tab_open']);
      assert.deepStrictEqual(B({ action: 'cookies' }), ['get_cookies']);
      assert.deepStrictEqual(B({ action: 'set-cookie', name: 'a' }), ['set_cookies']);
      assert.deepStrictEqual(B({ action: 'save' }), ['session_save']);
      assert.deepStrictEqual(B({ action: 'load' }), ['session_load']);
      assert.deepStrictEqual(B({ op: 'save' }, 'state'), ['session_save']);
      for (const op of Object.values(expected).concat(['session_save', 'session_load'])) {
        assert.strictEqual(driver.loadAdapter('charlotte').ops[op].tool, null, op);
        assert.ok(driver.loadAdapter('charlotte').ops[op].workaround, op);
      }
    });

    test('the default qa role allows an ordinary QA flow and still denies what it should', () => {
      const c = driver.resolveContract({ driver: 'bladebro' });
      const bladebro = (tool, input) => driver.roleViolation(c, 'qa', `mcp__bladebro__${tool}`, input);
      for (const [tool, input] of [
        ['act', { action: 'wait', condition: 'text', text: 'Welcome' }],
        ['act', { action: 'press', key: 'Enter' }],
        ['act', { action: 'fill', fields: [{ ref: 'e1', text: 'a' }], submit: 'e2' }],
        ['act', { action: 'back' }], ['act', { action: 'forward' }], ['act', { action: 'select', ref: 'e1', option: 'a' }],
        ['act', { action: 'eval', js: '1' }], ['run', { steps: [{ action: 'click', ref: 'e1' }, { action: 'wait', condition: 'text', text: 'x' }] }],
      ]) assert.strictEqual(bladebro(tool, input), null, `${tool} ${JSON.stringify(input)}`);
      for (const [tool, input] of [
        ['state', { op: 'cookies' }], ['act', { action: 'upload' }], ['act', { action: 'nope' }],
      ]) assert.match(bladebro(tool, input) ?? '', /may not call/, `${tool} ${JSON.stringify(input)}`);
      const inv = (tool, input) => driver.roleViolation(c, 'investigator', `mcp__bladebro__${tool}`, input);
      assert.match(inv('act', { action: 'click', ref: 'e1' }), /may not call/);
      assert.match(inv('act', { action: 'wait', condition: 'text', text: 'x' }), /may not call/);
      assert.match(inv('act', { action: 'wait', condition: ' js', text: 'document.cookie' }), /evaluate/);
    });

    test('charlotte wait_for with a js argument is evaluate too', () => {
      assert.deepStrictEqual(opOf('charlotte', 'mcp__charlotte__charlotte_wait_for', { js: '1' }), ['evaluate', 'wait_for']);
      assert.deepStrictEqual(opOf('charlotte', 'mcp__charlotte__charlotte_nope', {}), ['unknown']);
    });

    test('op-of CLI flags unknown and exits non-zero (also for unparseable args); it prints ops, no op field', () => {
      const run = (...a) => spawnSync('node', [TOOLS, 'ui-qa', 'op-of', '--driver', 'bladebro', ...a], { encoding: 'utf8' });
      const bad = run('--tool', 'mcp__bladebro__act', '--args', '{"action":"batch","steps":[{"action":"nope"}]}');
      assert.deepStrictEqual([bad.status, JSON.parse(bad.stdout)], [3, { tool: 'mcp__bladebro__act', ops: ['unknown'], unknown: true }]);
      const garbled = run('--tool', 'mcp__bladebro__act', '--args', '{nope');
      assert.deepStrictEqual([garbled.status, JSON.parse(garbled.stdout).unknown], [3, true]);
      const js = run('--tool', 'mcp__bladebro__run', '--args', JSON.stringify({ steps: [evalStep] }));
      assert.deepStrictEqual([js.status, JSON.parse(js.stdout).ops], [0, ['evaluate']]);
    });
  });

  test('instance-env renders bladebro isolation.env per instance and maps charlotte to its instance_launch tool', () => {
    const root = os.tmpdir();
    const b = cliArgs('instance-env', '--instance', 'b1', '--driver', 'bladebro', '--root', root);
    assert.deepStrictEqual(b.json.env, { BLADE_HOME: path.join(root, '.tmp', 'bladebro', 'b1') });
    assert.deepStrictEqual(cliArgs('instance-env', '--instance', 'b2', '--driver', 'bladebro', '--root', root).json.env, { BLADE_HOME: path.join(root, '.tmp', 'bladebro', 'b2') });
    const c = cliArgs('instance-env', '--instance', 'b1', '--driver', 'charlotte').json;
    assert.deepStrictEqual(c.launch, { op: 'instance_launch', tool: 'mcp__charlotte__charlotte_instance_launch' });
    assert.strictEqual(cliArgs('instance-env', '--instance', '../x', '--driver', 'bladebro').status, 1);
    assert.strictEqual(cliArgs('instance-env', '--driver', 'bladebro').status, 1);
  });

  test('instance-env path_env values are absolute, resolved against the cwd project', () => {
    const dir = fs.realpathSync(os.tmpdir());
    const r = cliIn(dir, 'instance-env', '--instance', 'w1', '--driver', 'bladebro');
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(r.json.env, { BLADE_HOME: path.join(dir, '.tmp', 'bladebro', 'w1') });
    assert.ok(path.isAbsolute(r.json.env.BLADE_HOME));
  });

  test('instance-env --root resolves path_env against the given project root (absolute or relative to cwd)', () => {
    const dir = fs.realpathSync(os.tmpdir());
    const abs = path.join(dir, 'proj-abs');
    assert.deepStrictEqual(cliIn(dir, 'instance-env', '--instance', 'w1', '--driver', 'bladebro', '--root', abs).json.env,
      { BLADE_HOME: path.join(abs, '.tmp', 'bladebro', 'w1') });
    assert.deepStrictEqual(cliIn(dir, 'instance-env', '--instance', 'w1', '--driver', 'bladebro', '--root', 'proj-rel').json.env,
      { BLADE_HOME: path.join(dir, 'proj-rel', '.tmp', 'bladebro', 'w1') });
  });

  test('instance-env leaves non-path env values unchanged and renders only keys listed in path_env', () => {
    const contract = { driver: 'synthetic', isolation: { env: { BLADE_HOME: '.tmp/{instance}', BLADE_HEADLESS: '1', NOTES: 'a/b' }, path_env: ['BLADE_HOME'] } };
    assert.deepStrictEqual(driver.instanceEnv(contract, 'w1', '/proj').env, { BLADE_HOME: '/proj/.tmp/w1', BLADE_HEADLESS: '1', NOTES: 'a/b' });
    const unmarked = { driver: 'synthetic', isolation: { env: { BLADE_HOME: '.tmp/{instance}' } } };
    assert.deepStrictEqual(driver.instanceEnv(unmarked, 'w1', '/proj').env, { BLADE_HOME: '.tmp/w1' });
  });

  test('instance traversal and non-identifier instances are rejected by instance-env and instanceEnv', () => {
    const dir = fs.realpathSync(os.tmpdir());
    const contract = driver.resolveContract({ driver: 'bladebro' });
    for (const bad of ['../x', '/abs', 'a/../b', '']) {
      assert.strictEqual(cliIn(dir, 'instance-env', '--instance', bad, '--driver', 'bladebro').status, 1);
      assert.throws(() => driver.instanceEnv(contract, bad, dir), /--instance must match/);
    }
  });

  test('every wait_for condition has a match key; the key set is the one bladebro act.rs accepts and charlotte schema declares', () => {
    const b = driver.loadAdapter('bladebro').ops.wait_for.match;
    assert.deepStrictEqual(b, { element: 'text', title: 'text', url: 'text', text: 'text', selector: 'selector', js: 'js', settle: null, network: null, 'network-idle': null });
    for (const cond of Object.keys(b)) assert.match(driver.loadAdapter('bladebro').ops.wait_for.note, new RegExp(cond));
    assert.deepStrictEqual(driver.loadAdapter('charlotte').ops.wait_for.match, { element: 'element_id', selector: 'selector', text: 'text', js: 'js' });
  });

  test('server: adapter MCP launch command resolves in the contract and a project overrides it per key', () => {
    assert.deepStrictEqual(driver.resolveContract({ driver: 'bladebro' }).server, { command: 'bladebro', args: ['mcp'] });
    assert.deepStrictEqual(driver.resolveContract({ driver: 'charlotte' }).server, { command: 'npx', args: ['@ticktockbent/charlotte'] });
    assert.deepStrictEqual(driver.resolveContract({ driver: 'bladebro', server: { command: '/opt/bin/bladebro' } }).server, { command: '/opt/bin/bladebro', args: ['mcp'] });
    assert.deepStrictEqual(driver.resolveContract({ driver: 'bladebro', server: { command: '/x', args: ['mcp', '--v'] } }).server, { command: '/x', args: ['mcp', '--v'] });
    assert.strictEqual(driver.resolveContract({ driver: 'playwright', command: 'x' }).server, undefined);
  });

  test('isolation names the scratch-home and record-dir env vars; instance-env reports them', () => {
    assert.deepStrictEqual([driver.loadAdapter('bladebro').isolation.home_env, driver.loadAdapter('bladebro').isolation.record_dir_env], ['BLADE_HOME', 'BLADE_RECORD']);
    const root = os.tmpdir();
    const b = cliArgs('instance-env', '--instance', 'q1', '--driver', 'bladebro', '--root', root).json;
    assert.deepStrictEqual([b.home_env, b.record_dir_env, b.env], ['BLADE_HOME', 'BLADE_RECORD', { BLADE_HOME: path.join(root, '.tmp', 'bladebro', 'q1') }]);
    assert.strictEqual(Object.hasOwn(b.env, b.home_env), true);
    const c = cliArgs('instance-env', '--instance', 'q1', '--driver', 'charlotte').json;
    assert.strictEqual(c.home_env, undefined);
  });

  test('probe-spec prints server, full expected tool names and the smoke call without starting a server', () => {
    const b = cliArgs('probe-spec', '--driver', 'bladebro');
    assert.strictEqual(b.status, 0);
    assert.deepStrictEqual(b.json.expect_tools, ['act', 'see', 'state', 'run', 'vision'].map((t) => `mcp__bladebro__${t}`));
    assert.deepStrictEqual(b.json.smoke, { op: 'navigate', tool: 'mcp__bladebro__act', args: { action: 'navigate', url: 'about:blank' } });
    assert.deepStrictEqual(b.json.server, { command: 'bladebro', args: ['mcp'] });
    const c = cliArgs('probe-spec', '--driver', 'charlotte').json;
    assert.strictEqual(c.smoke.tool, 'mcp__charlotte__charlotte_navigate');
    assert.ok(c.expect_tools.every((t) => t.startsWith('mcp__charlotte__charlotte_')));
    assert.strictEqual(cliArgs('probe-spec', '--driver', 'playwright').status, 1);
  });

  test('every mcp adapter has a server and a probe whose smoke_op tool is among the expected tools', () => {
    for (const d of driver.listDrivers('mcp')) {
      const a = driver.loadAdapter(d);
      assert.ok(a.server.command && Array.isArray(a.server.args), d);
      assert.ok(a.probe.expect_tools.length > 0 && a.probe.expect_tools.includes(a.ops[a.probe.smoke_op].tool), d);
      assert.ok(a.ops[a.probe.smoke_op].tool, d);
    }
  });
});
