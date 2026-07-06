#!/usr/bin/env node
'use strict';

/**
 * Reflective Prompt Optimization (MILE-33, Phase 56-01) -- pure, deterministic
 * core: agent-file resolution, telemetry + eval-failure signal collection, a
 * template-based (NEVER-LLM) diagnosis synthesizer, and a hand-rolled unified
 * diff engine.
 *
 * NO LLM calls, NO network calls -- mirrors eval-harness.js's own constraint.
 * Fail-safe convention (identical to eval-harness.js/model-registry.js): every
 * function here degrades gracefully on missing/malformed input, returning
 * `{ error }` (or `[]`/`false`, depending on shape) rather than throwing. This
 * is what makes Plan 56-02's gating deterministic and CI-testable without
 * mocking an LLM.
 *
 * Do NOT require ./gsd-tools.js from this file -- gsd-tools.js will require
 * THIS file in Plan 56-02 (CLI wiring); the reverse would be a circular
 * dependency.
 */

const fs = require('fs');
const path = require('path');
const evalHarness = require('./eval-harness.js');
const promptBudget = require('./prompt-budget.js');

// ─── Agent file resolution ──────────────────────────────────────────────────

// Resolves a bare agent name ('executor'), a full name ('gsd-executor'), or
// an explicit path to a real file under `<cwd>/agents/` (or an absolute/
// relative path outside it). Never throws -- every fs call is wrapped in
// try/catch, returning { error } on any exception. Returns
// { agentName, relPath, fullPath } on success.
function resolveAgentFile(cwd, agentArg) {
  try {
    if (!agentArg || typeof agentArg !== 'string' || !agentArg.trim()) {
      return { error: 'agent argument is required' };
    }

    const trimmed = agentArg.trim();
    const looksLikePath = trimmed.includes('/') || trimmed.includes(path.sep) || path.isAbsolute(trimmed);

    if (looksLikePath) {
      const fullPath = path.isAbsolute(trimmed) ? trimmed : path.join(cwd, trimmed);
      let exists = false;
      try { exists = fs.existsSync(fullPath); } catch (_e) { exists = false; }
      if (!exists) {
        return { error: `agent file not found: ${agentArg}` };
      }
      const agentName = path.basename(fullPath, '.md');
      const relPath = path.relative(cwd, fullPath);
      return { agentName, relPath, fullPath };
    }

    // Bare name (no path separator): try two candidate filenames under
    // <cwd>/agents/, in order -- as-given first, then gsd-prefixed.
    const asGiven = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    const candidates = [asGiven];
    if (!asGiven.startsWith('gsd-')) {
      candidates.push(`gsd-${trimmed}.md`);
    }

    for (const candidate of candidates) {
      const fullPath = path.join(cwd, 'agents', candidate);
      let exists = false;
      try { exists = fs.existsSync(fullPath); } catch (_e) { exists = false; }
      if (exists) {
        const agentName = path.basename(fullPath, '.md');
        const relPath = path.relative(cwd, fullPath);
        return { agentName, relPath, fullPath };
      }
    }

    const triedList = candidates.map((c) => `agents/${c}`).join(', ');
    return { error: `agent not found: ${agentArg} (tried ${triedList})` };
  } catch (e) {
    return { error: `unexpected error resolving agent file: ${e.message}` };
  }
}

// ─── Telemetry signal collection ────────────────────────────────────────────

// Reads .planning/telemetry/agent-reports.jsonl, filters to exact
// `entry.agent === agentName` matches. Malformed lines are skipped (warned,
// never thrown -- mirrors gsd-tools.js's readTelemetryReports skip-and-warn
// convention). Missing file -> []. Never throws.
function readTelemetryForAgent(cwd, agentName) {
  const telemetryPath = path.join(cwd, '.planning', 'telemetry', 'agent-reports.jsonl');

  let raw;
  try {
    raw = fs.readFileSync(telemetryPath, 'utf8');
  } catch (_e) {
    return [];
  }

  const entries = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    let parsed;
    try {
      parsed = JSON.parse(trimmedLine);
    } catch (e) {
      console.warn(`readTelemetryForAgent: skipping malformed JSONL line: ${e.message}`);
      continue;
    }

    if (parsed && typeof parsed === 'object' && parsed.agent === agentName) {
      entries.push(parsed);
    }
  }

  return entries;
}

// ─── Eval-failure signal collection ─────────────────────────────────────────

// Internal helper (not exported): decides whether a candidate belongs to the
// target agent. Prefers an explicit context.agent exact match (strong
// signal); falls back to a case-insensitive substring match against
// title/context.root_cause/context.gap_description. This fallback is a
// documented HEURISTIC for candidates that predate the optional
// context.agent field -- it is not a guarantee, and an explicit
// (non-matching) context.agent always wins over it.
function candidateMatchesAgent(candidate, agentName) {
  if (!candidate || typeof candidate !== 'object' || !agentName) return false;

  const context = (candidate.context && typeof candidate.context === 'object') ? candidate.context : {};

  if (context.agent) {
    return context.agent === agentName;
  }

  const haystackPieces = [candidate.title, context.root_cause, context.gap_description].filter(Boolean);
  if (haystackPieces.length === 0) return false;

  const haystack = haystackPieces.join(' ').toLowerCase();
  return haystack.includes(String(agentName).toLowerCase());
}

// Collects eval-failure signal for the target agent from both:
//  - tests/eval-regressions/queue/ (pending, unresolved candidates)
//  - tests/eval-regressions/accepted/ (currently-failing accepted regressions
//    only -- a passing accepted regression is not a "failure")
// Returns [{ id, source, title, reason, origin }], queue entries first, then
// accepted-regression entries. No matches in either source -> []. Never
// throws.
function readEvalFailuresForAgent(cwd, agentName) {
  const results = [];

  // queue/
  const queueDir = path.join(cwd, 'tests', 'eval-regressions', 'queue');
  let queueFiles = [];
  try {
    queueFiles = fs.readdirSync(queueDir).filter((f) => f.endsWith('.json')).sort();
  } catch (_e) {
    queueFiles = [];
  }

  for (const file of queueFiles) {
    let candidate;
    try {
      const content = fs.readFileSync(path.join(queueDir, file), 'utf8');
      candidate = JSON.parse(content);
    } catch (_e) {
      // Malformed queue file: skip silently. Review-queue tooling elsewhere
      // is the place malformed queue files get surfaced, not this read-only
      // signal collector.
      continue;
    }

    if (candidateMatchesAgent(candidate, agentName)) {
      const context = (candidate.context && typeof candidate.context === 'object') ? candidate.context : {};
      results.push({
        id: candidate.id,
        source: candidate.source,
        title: candidate.title,
        reason: context.gap_description || context.root_cause || 'pending human review',
        origin: 'queue',
      });
    }
  }

  // accepted/ -- re-execute each matching accepted candidate; only currently
  // failing (pass:false) ones count as a "failure" signal.
  const acceptedDir = path.join(cwd, 'tests', 'eval-regressions', 'accepted');
  let loaded;
  try {
    loaded = evalHarness.loadAcceptedEvalCandidates(acceptedDir);
  } catch (_e) {
    loaded = { validCandidates: [] };
  }
  const validCandidates = (loaded && Array.isArray(loaded.validCandidates)) ? loaded.validCandidates : [];

  for (const candidate of validCandidates) {
    if (!candidateMatchesAgent(candidate, agentName)) continue;

    let result;
    try {
      result = evalHarness.executeEvalCandidate(candidate, cwd);
    } catch (_e) {
      continue;
    }

    if (result && !result.pass) {
      results.push({
        id: candidate.id,
        source: candidate.source,
        title: candidate.title,
        reason: result.reason,
        origin: 'accepted-regression',
      });
    }
  }

  return results;
}

// ─── Signal presence ─────────────────────────────────────────────────────────

function hasSignal(telemetryEntries, evalFailures) {
  return (Array.isArray(telemetryEntries) && telemetryEntries.length > 0) ||
    (Array.isArray(evalFailures) && evalFailures.length > 0);
}

// ─── Diagnosis synthesis (template-based, deterministic, NEVER an LLM call) ─

// Builds a deterministic natural-language diagnosis: given the same
// telemetryEntries + evalFailures input twice, produces byte-identical
// { text, topIssue } output. This determinism is required so Plan 56-03's
// integration tests never need to mock an LLM.
function buildDiagnosis(agentName, telemetryEntries, evalFailures) {
  const tel = Array.isArray(telemetryEntries) ? telemetryEntries : [];
  const ef = Array.isArray(evalFailures) ? evalFailures : [];

  // Aggregate instructions_not_followed rule counts + first-seen `why`,
  // insertion-order tie-break (only replace topRule on a STRICTLY higher
  // count).
  const ruleCounts = {};
  const ruleWhy = {};
  for (const entry of tel) {
    const items = Array.isArray(entry && entry.instructions_not_followed) ? entry.instructions_not_followed : [];
    for (const item of items) {
      if (!item || !item.rule) continue;
      ruleCounts[item.rule] = (ruleCounts[item.rule] || 0) + 1;
      if (!(item.rule in ruleWhy)) {
        ruleWhy[item.rule] = item.why;
      }
    }
  }

  let topRule = null;
  let topRuleCount = 0;
  for (const [rule, count] of Object.entries(ruleCounts)) {
    if (count > topRuleCount) {
      topRule = rule;
      topRuleCount = count;
    }
  }

  // Distinct ambiguities, first-seen order.
  const ambiguities = [];
  for (const entry of tel) {
    const items = Array.isArray(entry && entry.ambiguities) ? entry.ambiguities : [];
    for (const a of items) {
      if (a && !ambiguities.includes(a)) {
        ambiguities.push(a);
      }
    }
  }

  // Total tool errors swallowed (non-numbers treated as 0).
  let toolErrorsTotal = 0;
  for (const entry of tel) {
    const n = entry && entry.tool_errors_swallowed;
    toolErrorsTotal += (typeof n === 'number' && !Number.isNaN(n)) ? n : 0;
  }

  const lines = [];
  lines.push(`# Diagnosis for ${agentName}`);
  lines.push('');
  lines.push(`## Telemetry signal (${tel.length} report(s))`);
  if (tel.length === 0) {
    lines.push('- No telemetry entries found for this agent.');
  } else {
    if (topRule) {
      lines.push(`- Most-frequent unfollowed instruction: "${topRule}" (${topRuleCount}x) -- ${ruleWhy[topRule] || 'no reason recorded'}`);
    } else {
      lines.push('- No instructions_not_followed entries recorded.');
    }
    if (ambiguities.length > 0) {
      lines.push(`- Distinct ambiguities: ${ambiguities.join('; ')}`);
    } else {
      lines.push('- No ambiguities recorded.');
    }
    lines.push(`- Total tool errors swallowed: ${toolErrorsTotal}`);
  }
  lines.push('');
  lines.push(`## Eval-failure signal (${ef.length} failure(s))`);
  if (ef.length === 0) {
    lines.push('- No eval failures found for this agent.');
  } else {
    for (const failure of ef) {
      lines.push(`- ${failure.title || failure.id}: ${failure.reason} [${failure.origin}]`);
    }
  }
  lines.push('');

  // topIssue selection order (first non-empty wins):
  //  1. ambiguities[0]
  //  2. ruleWhy[topRule] if topRule is set
  //  3. ef[0].title || ef[0].reason
  //  4. deterministic fallback string
  let topIssue = null;
  if (ambiguities.length > 0) {
    topIssue = ambiguities[0];
  } else if (topRule && ruleWhy[topRule]) {
    topIssue = ruleWhy[topRule];
  } else if (ef.length > 0 && (ef[0].title || ef[0].reason)) {
    topIssue = ef[0].title || ef[0].reason;
  } else {
    topIssue = `No specific issue identified for ${agentName} (signal present but not attributable to a single cause).`;
  }

  lines.push('## Top issue');
  lines.push(topIssue);

  return { text: lines.join('\n'), topIssue };
}

// ─── Unified diff engine (hand-rolled LCS, no new npm dependency) ───────────

// Internal helper (not exported): classic LCS via an (n+1)x(m+1) DP table
// built backwards, then a forward walk choosing 'equal'/'delete'/'insert'.
// Agent .md files are small (a few hundred lines) so O(n*m) is fine.
function computeLineDiffOps(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;

  // dp[i][j] = length of LCS of oldLines[i..] and newLines[j..]
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    dp[i] = new Array(m + 1).fill(0);
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'equal', line: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'delete', line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: 'insert', line: newLines[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'delete', line: oldLines[i] });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'insert', line: newLines[j] });
    j++;
  }

  return ops;
}

// Groups diff ops into unified-diff hunks with up to 3 lines of context
// before/after each change run, merging runs whose context windows overlap.
function buildHunks(ops) {
  // First pass: annotate each op with its old/new line numbers (1-based).
  const annotated = [];
  let oldLineNo = 1;
  let newLineNo = 1;
  for (const op of ops) {
    if (op.type === 'equal') {
      annotated.push({ ...op, oldLineNo, newLineNo });
      oldLineNo++;
      newLineNo++;
    } else if (op.type === 'delete') {
      annotated.push({ ...op, oldLineNo, newLineNo: null });
      oldLineNo++;
    } else {
      annotated.push({ ...op, oldLineNo: null, newLineNo });
      newLineNo++;
    }
  }

  // Find indices of change ops (delete/insert).
  const changeIndices = [];
  for (let idx = 0; idx < annotated.length; idx++) {
    if (annotated[idx].type !== 'equal') changeIndices.push(idx);
  }

  if (changeIndices.length === 0) {
    return [];
  }

  const CONTEXT = 3;
  // Build runs: group consecutive (allowing context-overlap) change indices.
  const ranges = [];
  let rangeStart = Math.max(0, changeIndices[0] - CONTEXT);
  let rangeEnd = Math.min(annotated.length - 1, changeIndices[0] + CONTEXT);

  for (let k = 1; k < changeIndices.length; k++) {
    const idx = changeIndices[k];
    const candidateStart = Math.max(0, idx - CONTEXT);
    if (candidateStart <= rangeEnd + 1) {
      // Overlaps or is adjacent to current range -- merge.
      rangeEnd = Math.min(annotated.length - 1, idx + CONTEXT);
    } else {
      ranges.push([rangeStart, rangeEnd]);
      rangeStart = candidateStart;
      rangeEnd = Math.min(annotated.length - 1, idx + CONTEXT);
    }
  }
  ranges.push([rangeStart, rangeEnd]);

  const hunks = [];
  for (const [start, end] of ranges) {
    const hunkOps = annotated.slice(start, end + 1);
    let oldStart = null;
    let newStart = null;
    let oldCount = 0;
    let newCount = 0;
    for (const op of hunkOps) {
      if (op.type === 'equal') {
        if (oldStart === null) oldStart = op.oldLineNo;
        if (newStart === null) newStart = op.newLineNo;
        oldCount++;
        newCount++;
      } else if (op.type === 'delete') {
        if (oldStart === null) oldStart = op.oldLineNo;
        oldCount++;
      } else {
        if (newStart === null) newStart = op.newLineNo;
        newCount++;
      }
    }
    hunks.push({ oldStart: oldStart || 0, oldCount, newStart: newStart || 0, newCount, ops: hunkOps });
  }

  return hunks;
}

// Produces standard unified-diff text: `--- oldLabel`, `+++ newLabel`, one or
// more `@@ -a,b +c,d @@` hunks. Never throws -- on any internal error returns
// a minimal but structurally-valid diff.
function computeUnifiedDiff(oldLabel, newLabel, oldContent, newContent) {
  try {
    const oldLines = (oldContent || '').split('\n');
    const newLines = (newContent || '').split('\n');
    const ops = computeLineDiffOps(oldLines, newLines);

    let hunks = buildHunks(ops);

    if (hunks.length === 0) {
      // No delete/insert at all -- still return a well-formed diff with a
      // single hunk showing all lines as context (never headerless).
      const allEqualOps = ops.map((op, idx) => ({ ...op, oldLineNo: idx + 1, newLineNo: idx + 1 }));
      hunks = [{
        oldStart: oldLines.length > 0 ? 1 : 0,
        oldCount: oldLines.length,
        newStart: newLines.length > 0 ? 1 : 0,
        newCount: newLines.length,
        ops: allEqualOps,
      }];
    }

    const parts = [`--- ${oldLabel}`, `+++ ${newLabel}`];
    for (const hunk of hunks) {
      parts.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
      for (const op of hunk.ops) {
        const prefix = op.type === 'equal' ? ' ' : (op.type === 'delete' ? '-' : '+');
        parts.push(`${prefix}${op.line}`);
      }
    }

    return parts.join('\n') + '\n';
  } catch (_e) {
    return `--- ${oldLabel}\n+++ ${newLabel}\n@@ -1,0 +1,0 @@\n`;
  }
}

// Structural validator: non-empty string, contains a `--- ` header line, a
// `+++ ` header line, and at least one `@@ ... @@` hunk header. Never throws.
function isValidUnifiedDiff(diffText) {
  try {
    return typeof diffText === 'string' &&
      diffText.trim().length > 0 &&
      /^--- /m.test(diffText) &&
      /^\+\+\+ /m.test(diffText) &&
      /^@@ .*@@/m.test(diffText);
  } catch (_e) {
    return false;
  }
}

// ─── Revision candidate builder ─────────────────────────────────────────────

// Reads the real agent file content, inserts a single clearly-labeled
// auto-suggested clarification line immediately before CORE_PREAMBLE_MARKER
// (so the addition counts against the budget-checked preamble -- the whole
// point of Plan 56-02's budget gate), or appends at end of file if the
// marker is absent. Returns { originalContent, revisedContent, diffText }.
// Never throws -- returns { error } on any exception.
function buildRevisionCandidate(agentFilePath, diagnosis) {
  try {
    const originalContent = fs.readFileSync(agentFilePath, 'utf8');
    const isoDate = new Date().toISOString().slice(0, 10);
    const clarificationLine = `**Auto-suggested clarification (prompt-optimize, ${isoDate}):** ${diagnosis.topIssue}`;

    const markerIdx = originalContent.indexOf(promptBudget.CORE_PREAMBLE_MARKER);
    let revisedContent;
    if (markerIdx !== -1) {
      revisedContent = originalContent.slice(0, markerIdx) + clarificationLine + '\n\n' + originalContent.slice(markerIdx);
    } else {
      revisedContent = originalContent.replace(/\n?$/, '\n') + '\n' + clarificationLine + '\n';
    }

    const label = path.basename(agentFilePath);
    const diffText = computeUnifiedDiff(`a/${label}`, `b/${label}`, originalContent, revisedContent);

    return { originalContent, revisedContent, diffText };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = {
  resolveAgentFile,
  readTelemetryForAgent,
  readEvalFailuresForAgent,
  hasSignal,
  buildDiagnosis,
  computeUnifiedDiff,
  isValidUnifiedDiff,
  buildRevisionCandidate,
};
