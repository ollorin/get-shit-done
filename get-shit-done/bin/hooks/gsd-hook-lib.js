'use strict';

// Shared helpers for GSD PreToolUse guard hooks: one-line JSONL log and a
// fail-open stdin runner. Log path: GSD_HOOK_LOG, else <home>/.claude/gsd-hook-log.jsonl.

const fs = require('fs');
const path = require('path');
const os = require('os');

function logPath() {
  return process.env.GSD_HOOK_LOG || path.join(os.homedir(), '.claude', 'gsd-hook-log.jsonl');
}

// Never throws: logging must not be able to change a hook's decision.
function logEvent(entry) {
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* fail open */ }
}

function clip(value, n = 200) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s && s.length > n ? s.slice(0, n) + '...' : s;
}

// Reads the hook payload, calls handler(data) -> { deny?: string, logs?: object[] } | null.
// Any parse error or exception allows the call and logs one line.
function runHook(hookName, handler) {
  let raw = '';
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => {
    let data = null;
    try {
      data = JSON.parse(raw);
      const result = handler(data) || {};
      const base = { hook: hookName, tool: data.tool_name, session_id: data.session_id, agent_type: data.agent_type };
      for (const l of result.logs || []) logEvent({ ...base, event: 'log', ...l });
      if (result.deny) {
        logEvent({ ...base, event: 'deny', rule: result.rule, detail: result.detail });
        try { fs.writeSync(2, result.deny + '\n'); } catch { /* stderr closed */ }
        process.exit(2);
      }
    } catch (err) {
      logEvent({ hook: hookName, event: 'error', error: clip(String((err && err.message) || err)) });
    }
    process.exit(0);
  });
}

module.exports = { logEvent, logPath, clip, runHook };
