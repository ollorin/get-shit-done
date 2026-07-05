#!/usr/bin/env node
'use strict';

// Prompt core-preamble token budget measurement (MILE-30, Phase 53-02).
//
// Pure functions, no I/O side effects beyond reading the target files listed
// in get-shit-done/config/prompt-budgets.json. Mirrors the fail-safe
// convention established by computeManifestDrift/filterContentForSecrets:
// never throw on a missing/malformed input -- report the failure as its own
// result instead of crashing the whole check.

const fs = require('fs');
const path = require('path');

// The convention marker every restructured agent file gets, immediately
// after its hard-rules-first preamble. Content AFTER this marker (detail,
// examples, edge cases -- typically moved to @references/ includes) is
// NOT counted against the budget. A file with no marker is measured in
// full and flagged `markerPresent: false` so callers know it hasn't been
// restructured yet.
const CORE_PREAMBLE_MARKER = '<!-- GSD:CORE-PREAMBLE-END -->';

// chars/4 is a documented approximation of GPT/Claude-style tokenization
// (roughly 4 characters per token for English prose) -- acceptable per
// MILE-30's scope, NOT a real tokenizer call. Good enough for a budget
// gate; not good enough for exact billing.
function measurePreamble(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const markerIdx = content.indexOf(CORE_PREAMBLE_MARKER);
  const markerPresent = markerIdx !== -1;
  const preamble = markerPresent ? content.slice(0, markerIdx) : content;
  const estimatedTokens = Math.ceil(preamble.length / 4);
  return { filePath, estimatedTokens, markerPresent, charCount: preamble.length };
}

// Reads a budgets config object (repoRoot-relative paths as keys mapping to
// numeric token budgets; a leading "_comment" key is ignored), measures each
// listed file relative to repoRoot, and returns
// { pass: boolean, results: [{ filePath, estimatedTokens, budget, pass, markerPresent }] }.
// Never throws: a missing agent file is reported as its own failing result
// rather than crashing the whole check.
function checkAllBudgets(repoRoot, budgetsConfigPath) {
  const configPath = budgetsConfigPath || path.join(repoRoot, 'get-shit-done', 'config', 'prompt-budgets.json');

  let budgets;
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    budgets = JSON.parse(raw);
  } catch (e) {
    return {
      pass: false,
      results: [],
      error: `Could not read/parse budgets config at ${configPath}: ${e.message}`,
    };
  }

  const results = [];
  let allPass = true;

  for (const [relPath, budget] of Object.entries(budgets)) {
    if (relPath === '_comment') continue;
    if (typeof budget !== 'number') continue;

    const fullPath = path.join(repoRoot, relPath);

    if (!fs.existsSync(fullPath)) {
      allPass = false;
      results.push({
        filePath: relPath,
        estimatedTokens: null,
        budget,
        pass: false,
        markerPresent: false,
        error: 'not found',
      });
      continue;
    }

    let measured;
    try {
      measured = measurePreamble(fullPath);
    } catch (e) {
      allPass = false;
      results.push({
        filePath: relPath,
        estimatedTokens: null,
        budget,
        pass: false,
        markerPresent: false,
        error: `Could not measure: ${e.message}`,
      });
      continue;
    }

    const pass = measured.estimatedTokens <= budget;
    if (!pass) allPass = false;

    results.push({
      filePath: relPath,
      estimatedTokens: measured.estimatedTokens,
      budget,
      pass,
      markerPresent: measured.markerPresent,
    });
  }

  return { pass: allPass, results };
}

module.exports = { measurePreamble, checkAllBudgets, CORE_PREAMBLE_MARKER };
