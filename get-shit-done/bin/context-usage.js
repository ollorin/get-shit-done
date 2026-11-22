'use strict';
// context-usage: fill of an agent's context window, read from its transcript (JSONL with per-call `usage`).
// Window evidence (igaming-platform coordinator transcripts, model claude-sonnet-5-5): calls reached 264,625 tokens and
// an auto-compaction fired at preTokens 267,458, so the window is above 200k. The real size is not exposed to the
// agent, so DEFAULT_WINDOW is the largest observed compaction trigger and is always reported as assumed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_WINDOW = 267000;

function lastUsage(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    const m = o.message || o;
    if (!m.usage || (o.type && o.type !== 'assistant' && m.role !== 'assistant')) continue;
    const u = m.usage;
    return { line: i + 1, tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) };
  }
  return null;
}

// Only the main session's own transcript is locatable: a child agent's env carries the PARENT's session id and no agent id.
function locateOwnTranscript(env, home) {
  if (env.CLAUDE_CODE_CHILD_SESSION) return { error: 'running inside a child agent: its transcript path is not discoverable from the environment (CLAUDE_CODE_SESSION_ID is the parent session); pass --transcript <path>' };
  const id = env.CLAUDE_CODE_SESSION_ID;
  if (!id) return { error: 'CLAUDE_CODE_SESSION_ID is not set; pass --transcript <path>' };
  const root = path.join(home, '.claude', 'projects');
  let hits = [];
  try {
    hits = fs.readdirSync(root).map((d) => path.join(root, d, `${id}.jsonl`)).filter((f) => fs.existsSync(f));
  } catch { /* no projects dir */ }
  if (hits.length !== 1) return { error: `found ${hits.length} transcripts for session ${id}; pass --transcript <path>` };
  return { path: hits[0] };
}

function contextUsage({ transcript, window, env = process.env, home = os.homedir() }) {
  let file = transcript;
  let source = 'transcript-arg';
  if (!file) {
    const r = locateOwnTranscript(env, home);
    if (r.error) return { error: r.error };
    file = r.path;
    source = 'auto-located';
  }
  if (!fs.existsSync(file)) return { error: `transcript ${file} not found` };
  const last = lastUsage(fs.readFileSync(file, 'utf8'));
  if (!last) return { error: `no assistant usage block in ${file}` };
  const given = Number.isFinite(window) && window > 0;
  const w = given ? window : DEFAULT_WINDOW;
  return {
    tokens_in_context: last.tokens,
    last_call_line: last.line,
    window_assumed: w,
    window_source: given ? 'arg' : 'default-assumed',
    pct: Math.round((last.tokens / w) * 1000) / 10,
    source: `${source}:${file}`,
  };
}

module.exports = { contextUsage, lastUsage, locateOwnTranscript, DEFAULT_WINDOW };
