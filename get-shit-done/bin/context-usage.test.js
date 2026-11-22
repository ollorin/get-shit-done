const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const C = require('./context-usage.js');
const TOOL = path.join(__dirname, 'gsd-tools.js');

const asst = (i, c, r, w) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'm', usage: { input_tokens: i, cache_read_input_tokens: r, cache_creation_input_tokens: c, output_tokens: w } } });
const user = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } });

function tmpTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxu-'));
  const f = path.join(dir, 't.jsonl');
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

describe('contextUsage', () => {
  test('sums input + cache read + cache creation + output of the LAST assistant call and reports its line', () => {
    const f = tmpTranscript([asst(1, 2, 3, 9), user, asst(10, 20, 30, 9), user, '{not json']);
    const r = C.contextUsage({ transcript: f, window: 1000 });
    assert.strictEqual(r.tokens_in_context, 69);
    assert.strictEqual(r.last_call_line, 3);
    assert.strictEqual(r.window_assumed, 1000);
    assert.strictEqual(r.window_source, 'arg');
    assert.strictEqual(r.pct, 6.9);
  });

  test('without a window the default is used and flagged assumed', () => {
    const f = tmpTranscript([asst(100, 0, 0, 1)]);
    const r = C.contextUsage({ transcript: f, window: NaN });
    assert.strictEqual(r.window_assumed, C.DEFAULT_WINDOW);
    assert.strictEqual(r.window_source, 'default-assumed');
  });

  test('no usage block and a missing file are errors', () => {
    assert.match(C.contextUsage({ transcript: tmpTranscript([user]) }).error, /no assistant usage/);
    assert.match(C.contextUsage({ transcript: '/nonexistent/x.jsonl' }).error, /not found/);
  });
});

describe('verdict', () => {
  test('below 80% continues whatever the deltas', () => {
    assert.strictEqual(C.verdict(799, 1000, [500]).decision, 'continue');
  });
  test('from 80% with no measured plan the guess is 15%, so 80% + 15% = 95% > 90% hands off',() => {
    assert.strictEqual(C.verdict(800, 1000, []).decision, 'handoff');
    assert.match(C.verdict(800, 1000, []).reason, /15% of the window/);
  });
  test('from 80% the largest measured delta decides: 850+50 fits, 850+51 does not', () => {
    assert.strictEqual(C.verdict(850, 1000, [10, 50]).decision, 'continue');
    assert.strictEqual(C.verdict(850, 1000, [10, 51]).decision, 'handoff');
  });
});

describe('delta state', () => {
  test('records the delta per call, keeps the max, ignores a compaction drop, --peek style record:false writes nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxs-'));
    const f = tmpTranscript([asst(100, 0, 0, 1)]);
    const call = (extra = {}) => C.contextUsage({ transcript: f, window: 1000, stateDir: dir, ...extra });
    assert.strictEqual(call().delta_since_previous, null);
    fs.appendFileSync(f, asst(400, 0, 0, 1) + '\n');
    assert.strictEqual(call().delta_since_previous, 300);
    fs.appendFileSync(f, asst(450, 0, 0, 1) + '\n');
    assert.strictEqual(call({ record: false }).delta_since_previous, 50);
    fs.appendFileSync(f, asst(500, 0, 0, 1) + '\n');
    assert.strictEqual(call().delta_since_previous, 100);
    fs.appendFileSync(f, asst(120, 0, 0, 1) + '\n');
    const r = call();
    assert.strictEqual(r.delta_since_previous, -380);
    const st = JSON.parse(fs.readFileSync(path.join(dir, C.stateKey(f)), 'utf8'));
    assert.deepStrictEqual(st, { last_tokens: 121, deltas: [300, 100] });
  });
});

describe('auto-locate', () => {
  test('a child agent never guesses: it is told to pass --transcript', () => {
    const r = C.locateOwnTranscript({ CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 's1' }, os.tmpdir());
    assert.match(r.error, /--transcript/);
  });

  test('the main session finds its single transcript by session id, zero or two hits fail', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxh-'));
    const p1 = path.join(home, '.claude', 'projects', 'p1');
    fs.mkdirSync(p1, { recursive: true });
    assert.match(C.locateOwnTranscript({ CLAUDE_CODE_SESSION_ID: 's1' }, home).error, /found 0/);
    fs.writeFileSync(path.join(p1, 's1.jsonl'), asst(1, 1, 1, 1) + '\n');
    assert.strictEqual(C.locateOwnTranscript({ CLAUDE_CODE_SESSION_ID: 's1' }, home).path, path.join(p1, 's1.jsonl'));
    const p2 = path.join(home, '.claude', 'projects', 'p2');
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, 's1.jsonl'), '');
    assert.match(C.locateOwnTranscript({ CLAUDE_CODE_SESSION_ID: 's1' }, home).error, /found 2/);
  });
});

describe('gsd-tools context-usage', () => {
  test('prints the JSON for --transcript and --window; exits non-zero without a locatable transcript', () => {
    const f = tmpTranscript([asst(50, 25, 25, 1)]);
    const ok = spawnSync('node', [TOOL, 'context-usage', '--transcript', f, '--window', '200'], { encoding: 'utf8' });
    assert.strictEqual(ok.status, 0, ok.stderr);
    const j = JSON.parse(ok.stdout);
    assert.deepStrictEqual([j.tokens_in_context, j.window_assumed, j.pct, j.last_call_line], [101, 200, 50.5, 1]);
    assert.strictEqual(j.verdict.decision, 'continue');
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxc-'));
    const run = () => JSON.parse(spawnSync('node', [TOOL, 'context-usage', '--transcript', f, '--window', '200'], { encoding: 'utf8', cwd }).stdout);
    run();
    fs.appendFileSync(f, asst(170, 0, 0, 1) + '\n');
    const second = run();
    assert.strictEqual(second.delta_since_previous, 70);
    assert.strictEqual(second.verdict.decision, 'handoff');
    assert.ok(fs.readdirSync(path.join(cwd, '.tmp', 'context-usage')).some((n) => /^t\.jsonl-[0-9a-f]{12}\.json$/.test(n)));
    const bad = spawnSync('node', [TOOL, 'context-usage'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_CHILD_SESSION: '1' } });
    assert.notStrictEqual(bad.status, 0);
    assert.match(bad.stderr, /--transcript/);
  });
});

describe('lastUsage filtering', () => {
  const synth = JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: '<synthetic>', usage: { input_tokens: 5, output_tokens: 5 } } });
  const zero = asst(0, 0, 0, 0);
  const nonAsst = JSON.stringify({ type: 'user', message: { role: 'assistant', usage: { input_tokens: 999 } } });
  const noType = JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 999 } } });

  test('synthetic and all-zero lines are skipped, the last real call is reported', () => {
    const r = C.lastUsage([asst(10, 0, 0, 1), synth, zero].join('\n'));
    assert.deepStrictEqual(r, { line: 1, tokens: 11 });
  });
  test('a line whose type is not assistant is rejected even with a usage block and assistant role', () => {
    assert.deepStrictEqual(C.lastUsage([asst(10, 0, 0, 0), nonAsst, noType].join('\n')), { line: 1, tokens: 10 });
    assert.strictEqual(C.lastUsage(nonAsst), null);
  });
  test('output_tokens of the last call are added', () => {
    assert.strictEqual(C.lastUsage(asst(1, 2, 3, 4)).tokens, 10);
  });
  test('a skipped zero line does not inflate the next delta', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxs-'));
    const f = tmpTranscript([asst(100, 0, 0, 0)]);
    C.contextUsage({ transcript: f, window: 1000, stateDir: dir });
    fs.appendFileSync(f, zero + '\n' + synth + '\n' + asst(130, 0, 0, 0) + '\n');
    assert.strictEqual(C.contextUsage({ transcript: f, window: 1000, stateDir: dir }).delta_since_previous, 30);
  });
});

describe('state file', () => {
  test('a symlink and its target share one state; same basename in two dirs do not collide', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxs-'));
    const f = tmpTranscript([asst(100, 0, 0, 0)]);
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ctxl-')), 't.jsonl');
    fs.symlinkSync(f, link);
    assert.strictEqual(C.stateKey(link), C.stateKey(f));
    C.contextUsage({ transcript: link, window: 1000, stateDir: dir });
    fs.appendFileSync(f, asst(150, 0, 0, 0) + '\n');
    assert.strictEqual(C.contextUsage({ transcript: f, window: 1000, stateDir: dir }).delta_since_previous, 50);
    const other = tmpTranscript([asst(100, 0, 0, 0)]);
    assert.strictEqual(path.basename(other), path.basename(f));
    assert.notStrictEqual(C.stateKey(other), C.stateKey(f));
    assert.strictEqual(C.contextUsage({ transcript: other, window: 1000, stateDir: dir }).delta_since_previous, null);
    assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')));
  });
  test('a corrupt state file warns instead of silently resetting', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxs-'));
    const f = tmpTranscript([asst(100, 0, 0, 0)]);
    fs.writeFileSync(path.join(dir, C.stateKey(f)), '{oops');
    const r = C.contextUsage({ transcript: f, window: 1000, stateDir: dir });
    assert.match(r.warning, /corrupt/);
    assert.strictEqual(r.delta_since_previous, null);
    assert.strictEqual(C.contextUsage({ transcript: f, window: 1000, stateDir: dir }).warning, undefined);
  });
});

describe('--self', () => {
  const setup = () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxh-'));
    const sub = path.join(home, '.claude', 'projects', 'p1', 's1', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    return { home, sub, env: { CLAUDE_CODE_SESSION_ID: 's1', CLAUDE_CODE_CHILD_SESSION: '1' } };
  };
  test('exactly one subagent transcript containing the nonce is found; 0 and 2 matches are errors', () => {
    const { home, sub, env } = setup();
    fs.writeFileSync(path.join(sub, 'agent-a.jsonl'), asst(1, 1, 1, 1) + '\n');
    fs.writeFileSync(path.join(sub, 'agent-b.jsonl'), 'cmd gsd-tools context-usage --self ctx-abc12345\n');
    assert.match(C.locateOwnTranscript(env, home, 'ctx-zzzzzzzz').error, /matched 0/);
    assert.strictEqual(C.locateOwnTranscript(env, home, 'ctx-abc12345').path, path.join(sub, 'agent-b.jsonl'));
    fs.writeFileSync(path.join(sub, 'agent-a.jsonl'), 'ctx-abc12345\n');
    assert.match(C.locateOwnTranscript(env, home, 'ctx-abc12345').error, /matched 2/);
  });
  test('0 matches tells the caller the first call only plants the token and to repeat it', () => {
    const { home, env } = setup();
    assert.match(C.locateOwnTranscript(env, home, 'ctx-first123').error, /FIRST call[\s\S]*repeat the identical command/);
  });
  test('stale files are not read, short or odd nonces are refused, the parent transcript is not a candidate', () => {
    const { home, sub, env } = setup();
    const f = path.join(sub, 'agent-a.jsonl');
    fs.writeFileSync(f, 'ctx-abc12345\n');
    assert.match(C.locateByNonce(env, home, 'ctx-abc12345', 1000, Date.now() + 60000).error, /matched 0/);
    assert.match(C.locateOwnTranscript(env, home, 'abc').error, /8\+ characters/);
    fs.writeFileSync(path.join(sub, '..', '..', 's1.jsonl'), 'ctx-other999\n');
    assert.match(C.locateOwnTranscript(env, home, 'ctx-other999').error, /matched 0/);
  });
  test('contextUsage with self reads the located transcript', () => {
    const { home, sub, env } = setup();
    fs.writeFileSync(path.join(sub, 'agent-a.jsonl'), asst(40, 0, 0, 2) + '\n{"x":"ctx-abc12345"}\n');
    const r = C.contextUsage({ self: 'ctx-abc12345', window: 1000, env, home });
    assert.strictEqual(r.tokens_in_context, 42);
    assert.match(r.source, /^self-nonce:/);
  });
});
