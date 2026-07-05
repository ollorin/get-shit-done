#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Identical shape/values to config/model-registry.json -- used only if the
// JSON file is missing or corrupt. The 3 live consumers of this module
// (circuit-breaker, escalation, analytics) must NEVER crash over a config
// file problem, so this module fails open, always.
const DEFAULT_REGISTRY = {
  tiers: ['haiku', 'sonnet', 'opus'],
  escalation_ladder: { haiku: 'sonnet', sonnet: 'opus', opus: null },
  thresholds: {
    haiku:  { timeout_ms: 1200000, iterations: 15 },
    sonnet: { timeout_ms: 2400000, iterations: 20 },
    opus:   { timeout_ms: 3600000, iterations: 25 }
  }
};

let cachedRegistry = null;

function loadRegistry() {
  if (cachedRegistry) return cachedRegistry;
  const configPath = path.join(__dirname, '..', 'config', 'model-registry.json');
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (!parsed || !parsed.tiers || !parsed.escalation_ladder || !parsed.thresholds) {
      throw new Error('model-registry.json missing required top-level keys');
    }
    cachedRegistry = parsed;
  } catch (e) {
    cachedRegistry = DEFAULT_REGISTRY;
  }
  return cachedRegistry;
}

function getTiers() {
  return loadRegistry().tiers.slice();
}

function getThresholds(tier) {
  const registry = loadRegistry();
  return registry.thresholds[(tier || '').toLowerCase()] || registry.thresholds.sonnet;
}

function getAllThresholds() {
  return loadRegistry().thresholds;
}

function getNextTier(tier) {
  const registry = loadRegistry();
  const ladder = registry.escalation_ladder;
  return Object.prototype.hasOwnProperty.call(ladder, tier) ? ladder[tier] : null;
}

function getEscalationLadder() {
  return loadRegistry().escalation_ladder;
}

module.exports = { loadRegistry, getTiers, getThresholds, getAllThresholds, getNextTier, getEscalationLadder, DEFAULT_REGISTRY };
