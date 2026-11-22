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
  test('sums input + cache read + cache creation of the LAST assistant call and reports its line', () => {
    const f = tmpTranscript([asst(1, 2, 3, 9), user, asst(10, 20, 30, 9), user, '{not json']);
    const r = C.contextUsage({ transcript: f, window: 1000 });
    assert.strictEqual(r.tokens_in_context, 60);
    assert.strictEqual(r.last_call_line, 3);
    assert.strictEqual(r.window_assumed, 1000);
    assert.strictEqual(r.window_source, 'arg');
    assert.strictEqual(r.pct, 6);
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
    assert.deepStrictEqual([j.tokens_in_context, j.window_assumed, j.pct, j.last_call_line], [100, 200, 50, 1]);
    const bad = spawnSync('node', [TOOL, 'context-usage'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_CHILD_SESSION: '1' } });
    assert.notStrictEqual(bad.status, 0);
    assert.match(bad.stderr, /--transcript/);
  });
});
