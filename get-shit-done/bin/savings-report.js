/**
 * Token Savings Report
 *
 * Calculates cost savings from auto mode vs fixed profiles.
 * Compares actual usage against hypothetical all-Opus baseline.
 * Source: Phase 8 Research - OBSV-05
 */

const fs = require('fs');
const path = require('path');
const { CLAUDE_PRICING } = require('./llm-metrics.js');

/**
 * Calculate savings comparing auto mode to all-Opus baseline
 * @param {object} usageData - Token usage data by model tier
 * @returns {object} - Savings breakdown
 */
function calculateSavings(usageData) {
  // usageData format: { haiku: { input, output }, sonnet: { input, output }, opus: { input, output } }

  let actualCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const breakdown = {};

  for (const [model, usage] of Object.entries(usageData)) {
    const pricing = CLAUDE_PRICING[model] || CLAUDE_PRICING['opus'];
    const inputCost = (usage.input || 0) / 1000000 * pricing.input;
    const outputCost = (usage.output || 0) / 1000000 * pricing.output;
    const modelCost = inputCost + outputCost;

    actualCost += modelCost;
    totalInputTokens += usage.input || 0;
    totalOutputTokens += usage.output || 0;

    breakdown[model] = {
      input_tokens: usage.input || 0,
      output_tokens: usage.output || 0,
      input_cost: inputCost,
      output_cost: outputCost,
      total_cost: modelCost
    };
  }

  // Calculate hypothetical all-Opus cost
  const opusPricing = CLAUDE_PRICING['opus'];
  const opusInputCost = totalInputTokens / 1000000 * opusPricing.input;
  const opusOutputCost = totalOutputTokens / 1000000 * opusPricing.output;
  const opusBaseline = opusInputCost + opusOutputCost;

  const savings = opusBaseline - actualCost;
  const savingsPercent = opusBaseline > 0 ? (savings / opusBaseline * 100) : 0;

  return {
    total_tokens: {
      input: totalInputTokens,
      output: totalOutputTokens,
      total: totalInputTokens + totalOutputTokens
    },
    actual_cost: actualCost,
    opus_baseline: opusBaseline,
    savings_usd: savings,
    savings_percent: savingsPercent,
    model_breakdown: breakdown
  };
}

/**
 * Generate formatted savings report from token_budget.json
 * @param {string} budgetPath - Path to token_budget.json
 * @returns {object} - Full report
 */
function generateReport(budgetPath = '.planning/token_budget.json') {
  if (!fs.existsSync(budgetPath)) {
    return { error: 'No budget data available' };
  }

  const data = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

  // Aggregate usage by model from phase breakdown
  const usageByModel = {
    haiku: { input: 0, output: 0 },
    sonnet: { input: 0, output: 0 },
    opus: { input: 0, output: 0 }
  };

  // Parse phase usage if available
  const phaseUsage = data.phaseUsage || {};
  for (const [phase, usage] of Object.entries(phaseUsage)) {
    // Default to opus if model not specified
    const model = data.model || 'opus';
    if (!usageByModel[model]) usageByModel[model] = { input: 0, output: 0 };

    // Assume 70/30 input/output split if only total available
    if (typeof usage === 'number') {
      usageByModel[model].input += Math.floor(usage * 0.7);
      usageByModel[model].output += Math.floor(usage * 0.3);
    } else if (usage.input !== undefined) {
      usageByModel[model].input += usage.input;
      usageByModel[model].output += usage.output || 0;
    }
  }

  // If we have model-specific tracking, use that
  if (data.modelUsage) {
    for (const [model, usage] of Object.entries(data.modelUsage)) {
      if (!usageByModel[model]) usageByModel[model] = { input: 0, output: 0 };
      usageByModel[model].input += usage.input || 0;
      usageByModel[model].output += usage.output || 0;
    }
  }

  const savings = calculateSavings(usageByModel);

  return {
    report_generated: new Date().toISOString(),
    session: {
      model: data.model,
      max_tokens: data.maxTokens,
      current_usage: data.currentUsage
    },
    ...savings,
    recommendations: generateRecommendations(savings)
  };
}

/**
 * Generate optimization recommendations based on usage patterns
 */
function generateRecommendations(savings) {
  const recommendations = [];

  const breakdown = savings.model_breakdown || {};

  // Check if Opus usage is high
  if (breakdown.opus && breakdown.opus.total_cost > savings.actual_cost * 0.8) {
    recommendations.push('High Opus usage detected. Consider tuning auto mode routing rules for simpler tasks.');
  }

  // Check if Haiku usage is low
  if (!breakdown.haiku || breakdown.haiku.total_cost < savings.actual_cost * 0.1) {
    recommendations.push('Low Haiku utilization. Simple tasks may be over-routed to stronger models.');
  }

  // Good savings
  if (savings.savings_percent > 40) {
    recommendations.push(`Excellent savings (${savings.savings_percent.toFixed(1)}%). Auto mode routing is effective.`);
  } else if (savings.savings_percent > 20) {
    recommendations.push(`Good savings (${savings.savings_percent.toFixed(1)}%). Consider adjusting routing thresholds for more aggressive optimization.`);
  } else if (savings.savings_percent > 0) {
    recommendations.push(`Moderate savings (${savings.savings_percent.toFixed(1)}%). Review routing patterns for optimization opportunities.`);
  }

  return recommendations;
}

/**
 * Format report as table for CLI display
 */
function formatReportTable(report) {
  if (report.error) return report.error;

  const lines = [
    '='.repeat(60),
    'TOKEN SAVINGS REPORT',
    '='.repeat(60),
    '',
    'SUMMARY',
    '-'.repeat(40),
    `Total Tokens:      ${report.total_tokens.total.toLocaleString()}`,
    `  Input:           ${report.total_tokens.input.toLocaleString()}`,
    `  Output:          ${report.total_tokens.output.toLocaleString()}`,
    '',
    `Actual Cost:       $${report.actual_cost.toFixed(4)}`,
    `Opus Baseline:     $${report.opus_baseline.toFixed(4)}`,
    `Savings:           $${report.savings_usd.toFixed(4)} (${report.savings_percent.toFixed(1)}%)`,
    '',
    'MODEL BREAKDOWN',
    '-'.repeat(40),
  ];

  for (const [model, data] of Object.entries(report.model_breakdown)) {
    if (data.total_cost > 0) {
      lines.push(`${model.toUpperCase().padEnd(10)} ${data.input_tokens.toLocaleString().padStart(12)} in / ${data.output_tokens.toLocaleString().padStart(12)} out  $${data.total_cost.toFixed(4)}`);
    }
  }

  if (report.recommendations && report.recommendations.length > 0) {
    lines.push('');
    lines.push('RECOMMENDATIONS');
    lines.push('-'.repeat(40));
    report.recommendations.forEach(r => lines.push(`* ${r}`));
  }

  lines.push('');
  lines.push(`Report generated: ${report.report_generated}`);

  return lines.join('\n');
}

module.exports = {
  calculateSavings,
  generateReport,
  formatReportTable,
  generateRecommendations
};
