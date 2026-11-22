'use strict';
// context-usage: fill of an agent's context window, read from its transcript (JSONL with per-call `usage`).
// Window evidence (pilot-project coordinator transcripts): one run auto-compacted at preTokens 267,458, so that window
// is above 200k; the trigger is model-dependent and other runs compacted at 317k-375k. The real size is not exposed to
// the agent, so DEFAULT_WINDOW (267k) is a conservative assumed default and is always reported as assumed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_WINDOW = 267000;

function lastUsage(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    const m = o && o.message;
    if (!o || o.type !== 'assistant' || !m || !m.usage || m.model === '<synthetic>') continue;
    const u = m.usage;
    const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
    if (tokens === 0) continue;
    return { line: i + 1, tokens };
  }
  return null;
}

const SELF_MAX_AGE_MS = 15 * 60 * 1000;

// A child agent's env carries the PARENT's session id and no agent id, but its transcript is
// <projects>/<proj>/<session>/subagents/agent-<id>.jsonl and the Bash command line (holding the nonce) is written there
// before it runs. Only files modified within maxAgeMs are read (the live transcript was just written).
function locateByNonce(env, home, nonce, maxAgeMs = SELF_MAX_AGE_MS, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{8,}$/.test(nonce || '')) return { error: '--self needs a literal token of 8+ characters [A-Za-z0-9_-] that you made up' };
  const id = env.CLAUDE_CODE_SESSION_ID;
  if (!id) return { error: 'CLAUDE_CODE_SESSION_ID is not set; pass --transcript <path>' };
  const root = path.join(home, '.claude', 'projects');
  const hits = [];
  try {
    for (const proj of fs.readdirSync(root)) {
      const dir = path.join(root, proj, id, 'subagents');
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        if (!/^agent-.*\.jsonl$/.test(n)) continue;
        const f = path.join(dir, n);
        if (now - fs.statSync(f).mtimeMs > maxAgeMs) continue;
        if (fs.readFileSync(f).includes(nonce)) hits.push(f);
      }
    }
  } catch { /* no projects dir */ }
  if (hits.length !== 1) return { error: `--self ${nonce} matched ${hits.length} subagent transcripts of session ${id} (need exactly 1); run it once from a Bash call of your own, or pass --transcript <path>` };
  return { path: hits[0] };
}

function locateOwnTranscript(env, home, nonce = null) {
  if (nonce) return locateByNonce(env, home, nonce);
  if (env.CLAUDE_CODE_CHILD_SESSION) return { error: 'running inside a child agent: pass --self <a unique literal token you make up> or --transcript <path> (CLAUDE_CODE_SESSION_ID is the parent session)' };
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
  if (!f || !fs.existsSync(f)) return { state: null };
  try { return { state: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch (e) { return { state: null, warning: `state file ${f} is corrupt (${e.message}); deltas restart from this call` }; }
}

function writeState(f, s) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s) + '\n');
  fs.renameSync(tmp, f);
}

function stateKey(file) {
  const real = fs.realpathSync(file);
  return `${path.basename(real)}-${crypto.createHash('sha1').update(real).digest('hex').slice(0, 12)}.json`;
}

// stateDir: holds one small JSON per transcript ({last_tokens, deltas}), written by every call unless record is false.
// Call it once per plan boundary only, so each recorded delta is one plan's cost.
function contextUsage({ transcript, self = null, window, stateDir = null, record = true, env = process.env, home = os.homedir() }) {
  let file = transcript;
  let source = 'transcript-arg';
  if (!file) {
    const r = locateOwnTranscript(env, home, self);
    if (r.error) return { error: r.error };
    file = r.path;
    source = self ? 'self-nonce' : 'auto-located';
  }
  if (!fs.existsSync(file)) return { error: `transcript ${file} not found` };
  const last = lastUsage(fs.readFileSync(file, 'utf8'));
  if (!last) return { error: `no assistant usage block in ${file}` };
  const given = Number.isFinite(window) && window > 0;
  const w = given ? window : DEFAULT_WINDOW;
  const stateFile = stateDir ? path.join(stateDir, stateKey(file)) : null;
  const { state: prev, warning } = readState(stateFile);
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
    ...(warning ? { warning } : {}),
  };
}

module.exports = { contextUsage, verdict, lastUsage, locateOwnTranscript, locateByNonce, stateKey, DEFAULT_WINDOW, HANDOFF_FROM, RESERVE_TO };
