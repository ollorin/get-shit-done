/**
 * Token Usage Ledger (Phase 58, MILE-36)
 *
 * Durable per-project, per-task token-usage record + honest savings
 * computation. Mirrors the Self-Report Telemetry (MILE-26) thin-I/O +
 * pure-aggregator split in gsd-tools.js, in its own file per
 * 58-RESEARCH.md's guidance (gsd-tools.js requires this module, not the
 * reverse -- avoids a circular require).
 *
 * HONESTY CONTRACT: as of this phase, no harness mechanism exposes real
 * per-spawn token counts to this codebase. Every record's `source` field
 * is therefore 'estimated' in practice today -- the schema supports
 * 'actual' with zero future migration, but callers must never present
 * estimated figures as measured fact. See formatUsageSavingsTable.
 */

const fs = require('fs');
const path = require('path');
const { CLAUDE_PRICING } = require('./llm-metrics.js');

const TOKEN_USAGE_DIR = 'telemetry';
const TOKEN_USAGE_FILE = 'token-usage.jsonl';

function getTokenUsagePath(cwd) {
  return path.join(cwd, '.planning', TOKEN_USAGE_DIR, TOKEN_USAGE_FILE);
}

// Thin I/O: appends one JSONL line. NEVER throws -- best-effort, matching
// the routing-ledger/tier_escalation "never blocking" convention.
// Missing/invalid optional fields fall back to safe defaults; timestamp
// and source are always resolved fresh/validated, never trusted blindly.
function appendTaskUsage(cwd, entry) {
  const usagePath = getTokenUsagePath(cwd);
  const tokensIn = (entry && entry.tokens && typeof entry.tokens.input === 'number') ? entry.tokens.input : 0;
  const tokensOut = (entry && entry.tokens && typeof entry.tokens.output === 'number') ? entry.tokens.output : 0;
  const record = {
    timestamp: new Date().toISOString(),
    phase: (entry && entry.phase !== undefined) ? entry.phase : null,
    plan: (entry && entry.plan !== undefined) ? entry.plan : null,
    task_index: (entry && entry.task_index !== undefined) ? entry.task_index : null,
    task_name: (entry && entry.task_name) || '',
    tier: (entry && entry.tier) || 'sonnet',
    tokens: { input: tokensIn, output: tokensOut },
    source: (entry && (entry.source === 'actual' || entry.source === 'estimated')) ? entry.source : 'estimated'
  };
  try {
    fs.mkdirSync(path.dirname(usagePath), { recursive: true });
    fs.appendFileSync(usagePath, JSON.stringify(record) + '\n');
    return { ok: true, record };
  } catch (e) {
    console.warn(`Warning: failed to append token-usage record: ${e.message}`);
    return { ok: false, error: e.message, record };
  }
}

// Thin I/O: reads all usage records, skip-and-warn per malformed line
// (matches execution-log.js's getHistory convention). Absent file -> [].
function readTaskUsageRecords(cwd) {
  const usagePath = getTokenUsagePath(cwd);
  if (!fs.existsSync(usagePath)) return [];
  const lines = fs.readFileSync(usagePath, 'utf-8').split('\n');
  const records = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (e) {
      console.warn(`Warning: skipping malformed token-usage line: ${e.message}`);
    }
  }
  return records;
}

// Pure function -- no I/O. Crude, clearly-labeled estimation heuristic: a
// flat per-tier input/output default, mildly scaled by task description
// length. NOT a measured value -- callers must always tag
// source:'estimated' when this function supplied the tokens.
const ESTIMATED_TOKENS_BY_TIER = {
  haiku: { input: 3000, output: 800 },
  sonnet: { input: 8000, output: 2000 },
  opus: { input: 12000, output: 3000 }
};
function estimateTaskTokens(taskName, tier) {
  const base = ESTIMATED_TOKENS_BY_TIER[tier] || ESTIMATED_TOKENS_BY_TIER.sonnet;
  const lengthFactor = (taskName && typeof taskName === 'string')
    ? Math.min(2, Math.max(1, taskName.length / 80))
    : 1;
  return {
    input: Math.round(base.input * lengthFactor),
    output: Math.round(base.output * lengthFactor)
  };
}

// Pure function -- no I/O. Resolves the tier the CONFIGURED baseline
// profile (savings_baseline_profile, default "quality") would have
// assigned to the per-task gsd-executor spawn these usage records track,
// mirroring model-profiles.md's gsd-executor row EXACTLY: quality->opus,
// balanced->sonnet, budget->sonnet. Deliberately narrow, documented,
// hardcoded mirror (not a live markdown parse) -- if model-profiles.md's
// gsd-executor row ever changes, this constant must be updated too.
const BASELINE_PROFILE_EXECUTOR_TIER = { quality: 'opus', balanced: 'sonnet', budget: 'sonnet' };
function resolveBaselineTier(baselineProfile) {
  return BASELINE_PROFILE_EXECUTOR_TIER[baselineProfile] || BASELINE_PROFILE_EXECUTOR_TIER.quality;
}

// Pure function -- no I/O. THE honesty-critical computation:
//  - zero usage records -> { available: false, reason: 'no recorded usage data' }
//    (never fabricates numbers, never falls through to any other default)
//  - otherwise -> full savings computation against the CONFIGURED baseline
//    profile, plus an explicit coverage percentage: unique
//    (phase,plan,task_index) task identity tuples with >=1 matching usage
//    record, vs the total unique task identity tuples in taskOutcomeEvents.
function computeSavingsFromUsage(usageRecords, taskOutcomeEvents, baselineProfile) {
  const records = Array.isArray(usageRecords) ? usageRecords : [];
  const outcomeEvents = (Array.isArray(taskOutcomeEvents) ? taskOutcomeEvents : [])
    .filter(e => e && e.type === 'task_outcome');

  if (records.length === 0) {
    return { available: false, reason: 'no recorded usage data' };
  }

  const resolvedBaselineProfile = baselineProfile || 'quality';
  const baselineTier = resolveBaselineTier(resolvedBaselineProfile);
  const baselinePricing = CLAUDE_PRICING[baselineTier] || CLAUDE_PRICING.opus;

  let actualCostUsd = 0, baselineCostUsd = 0;
  let totalInput = 0, totalOutput = 0;
  let estimatedCount = 0, actualCount = 0;

  for (const r of records) {
    const tokens = (r && r.tokens) || {};
    const input = typeof tokens.input === 'number' ? tokens.input : 0;
    const output = typeof tokens.output === 'number' ? tokens.output : 0;
    totalInput += input;
    totalOutput += output;

    const tier = (r && r.tier) || 'sonnet';
    const pricing = CLAUDE_PRICING[tier] || CLAUDE_PRICING.sonnet;
    actualCostUsd += (input / 1e6) * pricing.input + (output / 1e6) * pricing.output;
    baselineCostUsd += (input / 1e6) * baselinePricing.input + (output / 1e6) * baselinePricing.output;

    if (r && r.source === 'actual') actualCount++;
    else estimatedCount++;
  }

  const savingsUsd = baselineCostUsd - actualCostUsd;
  const savingsPercent = baselineCostUsd > 0 ? (savingsUsd / baselineCostUsd) * 100 : 0;

  const taskKey = (e) => `${e.phase}|${e.plan}|${e.task_index}`;
  const totalTaskKeys = new Set(outcomeEvents.map(taskKey));
  const recordKeys = new Set(records.map(taskKey));
  let matchedTasks = 0;
  for (const k of totalTaskKeys) { if (recordKeys.has(k)) matchedTasks++; }
  const totalTasks = totalTaskKeys.size;
  const coveragePercent = totalTasks > 0 ? (matchedTasks / totalTasks) * 100 : null;

  const dataQuality = actualCount === 0 ? 'all_estimated' : (estimatedCount === 0 ? 'all_actual' : 'mixed');

  return {
    available: true,
    generated_at: new Date().toISOString(),
    baseline_profile: resolvedBaselineProfile,
    baseline_tier: baselineTier,
    total_tokens: { input: totalInput, output: totalOutput, total: totalInput + totalOutput },
    actual_cost_usd: actualCostUsd,
    baseline_cost_usd: baselineCostUsd,
    savings_usd: savingsUsd,
    savings_percent: savingsPercent,
    coverage: { matched_tasks: matchedTasks, total_tasks: totalTasks, percent: coveragePercent },
    record_count: records.length,
    estimated_record_count: estimatedCount,
    actual_record_count: actualCount,
    data_quality: dataQuality
  };
}

// Table formatter for CLI display. Honesty labeling lives here: zero data
// prints an explicit "no data" message; any non-'all_actual' data_quality
// prints an explicit ESTIMATED banner; coverage is ALWAYS printed
// explicitly, never omitted.
function formatUsageSavingsTable(report) {
  if (!report || report.available === false) {
    return `No data recorded — cannot compute savings (${(report && report.reason) || 'no recorded usage data'}).`;
  }
  const lines = [
    '='.repeat(60),
    'TOKEN SAVINGS REPORT (from recorded usage)',
    '='.repeat(60),
    ''
  ];
  if (report.data_quality !== 'all_actual') {
    const scope = report.data_quality === 'all_estimated' ? 'All' : 'Some';
    lines.push(`NOTE: ${scope} figures below are ESTIMATED -- no actual per-spawn token data is available from the harness yet. Treat as an approximation, not measured fact.`);
    lines.push('');
  }
  lines.push(`Baseline profile: ${report.baseline_profile} (executor tier: ${report.baseline_tier})`);
  lines.push(`Coverage: ${report.coverage.percent === null ? 'n/a' : report.coverage.percent.toFixed(0) + '%'} (${report.coverage.matched_tasks}/${report.coverage.total_tasks} tasks have recorded usage)`);
  lines.push('');
  lines.push(`Total Tokens:  ${report.total_tokens.total.toLocaleString()} (in: ${report.total_tokens.input.toLocaleString()}, out: ${report.total_tokens.output.toLocaleString()})`);
  lines.push(`Actual Cost:   $${report.actual_cost_usd.toFixed(4)}`);
  lines.push(`Baseline Cost: $${report.baseline_cost_usd.toFixed(4)}`);
  lines.push(`Savings:       $${report.savings_usd.toFixed(4)} (${report.savings_percent.toFixed(1)}%)`);
  lines.push('');
  lines.push(`Records: ${report.record_count} (${report.estimated_record_count} estimated, ${report.actual_record_count} actual)`);
  lines.push('');
  lines.push(`Generated: ${report.generated_at}`);
  return lines.join('\n');
}

module.exports = {
  getTokenUsagePath,
  appendTaskUsage,
  readTaskUsageRecords,
  estimateTaskTokens,
  resolveBaselineTier,
  computeSavingsFromUsage,
  formatUsageSavingsTable
};
