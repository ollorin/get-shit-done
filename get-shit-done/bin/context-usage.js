'use strict';
// context-usage: fill of an agent's context window, read from its transcript (JSONL with per-call `usage`).
// Window evidence (pilot-project coordinator transcripts, model claude-sonnet-5-5): calls reached 264,625 tokens and
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

const HANDOFF_FROM = 0.8;
const RESERVE_TO = 0.9;
const FIRST_PLAN_GUESS = 0.15;

// Below 80% always continue. From 80%: continue only if used + the largest plan cost measured so far (15% of the window
// before any plan was measured) stays within 90%; the last 10% is the reserve for the handoff write, checkpoint and report.
function verdict(used, window, deltas) {
  if (used < HANDOFF_FROM * window) return { decision: 'continue', reason: `below ${HANDOFF_FROM * 100}% of the window` };
  const measured = deltas.length > 0;
  const est = measured ? Math.max(...deltas) : Math.round(FIRST_PLAN_GUESS * window);
  const basis = measured ? `max of ${deltas.length} measured plan deltas` : '15% of the window, no plan measured yet';
  const fits = used + est <= RESERVE_TO * window;
  return {
    decision: fits ? 'continue' : 'handoff',
    reason: `used ${used} + next plan ~${est} (${basis}) ${fits ? '<=' : '>'} ${Math.round(RESERVE_TO * window)} (90% of the window)`,
  };
}

function readState(f) {
  try { return f ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch { return null; }
}

function writeState(f, s) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s) + '\n');
}

// stateDir: holds one small JSON per transcript ({last_tokens, deltas}), written by every call unless record is false.
// Call it once per plan boundary only, so each recorded delta is one plan's cost.
function contextUsage({ transcript, window, stateDir = null, record = true, env = process.env, home = os.homedir() }) {
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
  const stateFile = stateDir ? path.join(stateDir, `${path.basename(file)}.json`) : null;
  const prev = readState(stateFile);
  const delta = prev ? last.tokens - prev.last_tokens : null;
  // A negative delta means the context was compacted between calls: not a plan cost.
  const deltas = [...(prev ? prev.deltas : []), ...(delta !== null && delta > 0 ? [delta] : [])];
  if (record && stateFile) writeState(stateFile, { last_tokens: last.tokens, deltas });
  return {
    tokens_in_context: last.tokens,
    last_call_line: last.line,
    window_assumed: w,
    window_source: given ? 'arg' : 'default-assumed',
    pct: Math.round((last.tokens / w) * 1000) / 10,
    delta_since_previous: delta,
    source: `${source}:${file}`,
    verdict: verdict(last.tokens, w, deltas),
  };
}

module.exports = { contextUsage, verdict, lastUsage, locateOwnTranscript, DEFAULT_WINDOW, HANDOFF_FROM, RESERVE_TO };
