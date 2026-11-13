'use strict';

/**
 * analytics.js — GSD Execution Analytics
 *
 * generateReport(projectPath) — reads EXECUTION_LOG.md + SUMMARY.md files,
 * returns a human-readable markdown analytics report.
 */

const fs = require('fs');
const path = require('path');

// Lazy-load execution-log to avoid circular dependency issues
function getHistory(projectPath) {
  try {
    const { getHistory: _getHistory } = require('./execution-log.js');
    return _getHistory(projectPath);
  } catch (e) {
    // Fallback: parse EXECUTION_LOG.md manually
    const logPath = path.join(projectPath, '.planning', 'EXECUTION_LOG.md');
    if (!fs.existsSync(logPath)) return [];
    const lines = fs.readFileSync(logPath, 'utf8').split('\n');
    const events = [];
    for (const line of lines) {
      if (!line.trim() || line.startsWith('#')) continue;
      try { events.push(JSON.parse(line)); } catch (e2) { /* skip */ }
    }
    return events;
  }
}

// Lazy-load telemetry helpers from gsd-tools.js (same directory, no
// cross-boundary fragility) -- never let a telemetry read crash the report.
function getTelemetryHelpers() {
  try {
    const { summarizeTelemetryReports, readTelemetryReports } = require('./gsd-tools.js');
    return { summarizeTelemetryReports, readTelemetryReports };
  } catch (e) {
    return { summarizeTelemetryReports: null, readTelemetryReports: null };
  }
}

/**
 * Scan all phase SUMMARY.md files and extract first content line.
 * Returns array of { phase, name, oneliner, path }
 */
function scanSummaries(projectPath) {
  const phasesDir = path.join(projectPath, '.planning', 'phases');
  if (!fs.existsSync(phasesDir)) return [];

  const results = [];
  const entries = fs.readdirSync(phasesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const phaseDir = path.join(phasesDir, entry.name);

    // Find SUMMARY.md files
    let summaryFiles;
    try {
      summaryFiles = fs.readdirSync(phaseDir).filter(f => f.endsWith('-SUMMARY.md'));
    } catch (e) {
      continue;
    }

    for (const summaryFile of summaryFiles) {
      const summaryPath = path.join(phaseDir, summaryFile);
      let oneliner = '';
      try {
        const content = fs.readFileSync(summaryPath, 'utf8');
        const lines = content.split('\n');
        // Find first non-blank, non-heading line
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            oneliner = trimmed.slice(0, 120);
            break;
          }
        }
      } catch (e) { /* skip */ }

      // Extract phase number from directory name (e.g. "40-observability-analytics" -> 40)
      const phaseMatch = entry.name.match(/^(\d+)/);
      const phaseNum = phaseMatch ? parseInt(phaseMatch[1], 10) : null;

      results.push({
        phase: phaseNum,
        dir: entry.name,
        oneliner,
        path: summaryPath,
        file: summaryFile
      });
    }
  }

  return results.sort((a, b) => (a.phase || 0) - (b.phase || 0));
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms) {
  if (ms < 0) return 'N/A';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * Pad a string to a given width.
 */
function pad(str, width) {
  const s = String(str == null ? '' : str);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/**
 * Generate an analytics report from EXECUTION_LOG.md and SUMMARY.md files.
 *
 * @param {string} projectPath — root of the project (contains .planning/)
 * @returns {string} markdown report
 */
function generateReport(projectPath) {
  const events = getHistory(projectPath);

  if (events.length === 0) {
    return [
      '# GSD Execution Analytics Report',
      '',
      `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
      '',
      'No execution history found. Run `execute-roadmap` first to generate data.',
      ''
    ].join('\n');
  }

  const lines = [];
  const now = new Date();

  // --- Header ---
  lines.push('# GSD Execution Analytics Report');
  lines.push('');
  lines.push(`**Generated:** ${now.toISOString().slice(0, 10)}`);
  lines.push('');

  // --- Phase duration computation ---
  const phaseStarts = {};
  const phaseCompletes = {};
  const phaseFailed = {};
  const phaseNames = {};

  for (const ev of events) {
    if (ev.type === 'phase_start') {
      phaseStarts[ev.phase] = ev.timestamp;
      if (ev.name) phaseNames[ev.phase] = ev.name;
    } else if (ev.type === 'phase_complete') {
      phaseCompletes[ev.phase] = ev.timestamp;
      if (ev.name) phaseNames[ev.phase] = ev.name;
    } else if (ev.type === 'phase_failed') {
      phaseFailed[ev.phase] = ev.timestamp;
      if (ev.name) phaseNames[ev.phase] = ev.name;
    }
  }

  const allPhaseNums = new Set([
    ...Object.keys(phaseStarts),
    ...Object.keys(phaseCompletes),
    ...Object.keys(phaseFailed)
  ].map(Number));

  const phaseDurations = [];
  for (const phaseNum of Array.from(allPhaseNums).sort((a, b) => a - b)) {
    const startTs = phaseStarts[phaseNum];
    const completeTs = phaseCompletes[phaseNum];
    const failedTs = phaseFailed[phaseNum];
    const endTs = completeTs || failedTs;
    const status = completeTs ? 'complete' : (failedTs ? 'failed' : 'in_progress');
    const durationMs = (startTs && endTs) ? new Date(endTs) - new Date(startTs) : -1;
    phaseDurations.push({ phase: phaseNum, status, durationMs, name: phaseNames[phaseNum] || '' });
  }

  const completedPhases = phaseDurations.filter(p => p.status === 'complete');
  const failedPhases = phaseDurations.filter(p => p.status === 'failed');
  const failureRate = allPhaseNums.size > 0
    ? ((failedPhases.length / allPhaseNums.size) * 100).toFixed(1)
    : '0.0';

  // Total roadmap duration
  const roadmapStarts = events.filter(e => e.type === 'roadmap_start');
  const roadmapCompletes = events.filter(e => e.type === 'roadmap_complete');
  let roadmapDurationMs = -1;
  if (roadmapStarts.length > 0 && roadmapCompletes.length > 0) {
    roadmapDurationMs = new Date(roadmapCompletes[roadmapCompletes.length - 1].timestamp) -
                        new Date(roadmapStarts[0].timestamp);
  }

  const avgPhaseDurationMs = completedPhases.length > 0
    ? completedPhases.reduce((sum, p) => sum + (p.durationMs > 0 ? p.durationMs : 0), 0) / completedPhases.length
    : -1;

  // --- Summary Table ---
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Phases completed | ${completedPhases.length} |`);
  lines.push(`| Phases failed | ${failedPhases.length} |`);
  lines.push(`| Failure rate | ${failureRate}% |`);
  lines.push(`| Total roadmap duration | ${roadmapDurationMs > 0 ? formatDuration(roadmapDurationMs) : 'N/A'} |`);
  lines.push(`| Average phase duration | ${avgPhaseDurationMs > 0 ? formatDuration(avgPhaseDurationMs) : 'N/A'} |`);
  lines.push('');

  // --- Phase Breakdown ---
  lines.push('## Phase Breakdown');
  lines.push('');
  lines.push(`| ${pad('Phase', 6)} | ${pad('Name', 30)} | ${pad('Duration', 10)} | ${pad('Status', 12)} |`);
  lines.push(`|${'-'.repeat(8)}|${'-'.repeat(32)}|${'-'.repeat(12)}|${'-'.repeat(14)}|`);

  for (const p of phaseDurations) {
    const dur = p.durationMs > 0 ? formatDuration(p.durationMs) : 'N/A';
    const name = (p.name || '').slice(0, 28);
    lines.push(`| ${pad(p.phase, 6)} | ${pad(name, 30)} | ${pad(dur, 10)} | ${pad(p.status, 12)} |`);
  }
  lines.push('');

  // --- Self-Report Telemetry (MILE-26) ---
  let telemetryReports = [];
  try {
    const { readTelemetryReports } = getTelemetryHelpers();
    telemetryReports = readTelemetryReports ? readTelemetryReports(projectPath) : [];
  } catch (e) { telemetryReports = []; }
  if (telemetryReports.length > 0) {
    const { summarizeTelemetryReports } = getTelemetryHelpers();
    const summary = summarizeTelemetryReports(telemetryReports);
    lines.push('## Self-Report Telemetry');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Reports | ${summary.count} |`);
    lines.push(`| Avg context pressure | ${summary.avg_context_pressure !== null ? summary.avg_context_pressure.toFixed(2) : 'N/A'} |`);
    lines.push(`| Total tool errors swallowed | ${summary.total_tool_errors_swallowed} |`);
    lines.push('');
    const rules = Object.entries(summary.instructions_not_followed_by_rule);
    if (rules.length > 0) {
      lines.push('**Instructions not followed (by rule):**');
      lines.push('');
      for (const [rule, count] of rules) lines.push(`- ${rule}: ${count}`);
      lines.push('');
    }
    if (summary.top_ambiguities.length > 0) {
      lines.push('**Top ambiguities:**');
      lines.push('');
      for (const a of summary.top_ambiguities) lines.push(`- ${a.text} (${a.count})`);
      lines.push('');
    }
  }

  // --- Failure Analysis ---
  const failureEvents = events.filter(e => e.type === 'phase_failed');
  if (failureEvents.length > 0) {
    lines.push('## Failure Analysis');
    lines.push('');
    for (const ev of failureEvents) {
      lines.push(`- **Phase ${ev.phase}** (${ev.name || 'unknown'}): ${ev.error || 'no error details'}`);
    }
    lines.push('');
  }

  // --- Phase Summaries ---
  const summaries = scanSummaries(projectPath);
  if (summaries.length > 0) {
    lines.push('## Phase Summaries');
    lines.push('');
    for (const s of summaries) {
      if (s.oneliner) {
        lines.push(`- **Phase ${s.phase}** (${s.dir}): ${s.oneliner}`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Report generated by \`gsd-tools.js analytics report\` at ${now.toISOString()}*`);
  lines.push('');

  return lines.join('\n');
}

module.exports = { generateReport };
