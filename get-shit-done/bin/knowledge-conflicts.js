#!/usr/bin/env node

/**
 * Knowledge Conflict Resolution - Priority-based principle conflict resolution
 *
 * Purpose: When multiple principles apply to a decision, resolve conflict using
 * user-defined priority rules (safety > security > reliability > speed > cost > convenience)
 */

const fs = require('fs');
const path = require('path');

// Default priority weights for principle categories
const DEFAULT_PRIORITIES = {
  safety: 1.0,
  security: 0.9,
  reliability: 0.85,
  speed: 0.6,
  cost: 0.5,
  convenience: 0.3
};

// Config cache
let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 60000; // 60 seconds

/**
 * Load full configuration file
 * Caches config for 60 seconds to reduce I/O
 * @returns {Object} Config object or defaults
 */
function loadConfig() {
  const now = Date.now();

  // Return cached config if still valid
  if (configCache && (now - configCacheTime) < CONFIG_CACHE_TTL) {
    return configCache;
  }

  try {
    const configPath = path.join(process.cwd(), '.planning/knowledge/permissions-config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    configCache = JSON.parse(configData);
    configCacheTime = now;
    return configCache;
  } catch (error) {
    // Return defaults if config doesn't exist or is invalid
    return {
      version: 1,
      priorities: DEFAULT_PRIORITIES,
      allowlist: { safe_actions: [] }
    };
  }
}

/**
 * Load user-defined priority weights from config
 * Falls back to DEFAULT_PRIORITIES if config is missing or invalid
 * @returns {Object} Priority weights object
 */
function loadUserPriorities() {
  const config = loadConfig();

  if (config && config.priorities && typeof config.priorities === 'object') {
    return config.priorities;
  }

  return DEFAULT_PRIORITIES;
}

/**
 * Calculate priority score for a principle
 * @param {Object} principle - Principle object with metadata
 * @param {Object} priorities - Priority weights object
 * @returns {Object} Principle with added priority, score, and category
 */
function scorePrinciple(principle, priorities) {
  // Get category from principle metadata (default: 'convenience')
  const category = principle.metadata?.category || 'convenience';

  // Get priority weight from priorities object (default: 0.5)
  const priority = priorities[category] !== undefined ? priorities[category] : 0.5;

  // Get confidence from principle (default: 0.7)
  const confidence = principle.metadata?.confidence || principle.confidence || 0.7;

  // Calculate score: confidence * priority
  const score = confidence * priority;

  return {
    ...principle,
    priority,
    score,
    category
  };
}

/**
 * Resolve conflicts between multiple principles
 * @param {Array} principles - Array of principle objects
 * @param {Object} context - Optional context object
 * @returns {Object} Resolution result
 */
function resolvePrincipleConflict(principles, context = {}) {
  if (!principles || principles.length === 0) {
    return {
      resolved: false,
      reason: 'no_principles',
      message: 'No principles provided for conflict resolution'
    };
  }

  // Load priorities and score each principle
  const priorities = loadUserPriorities();
  const scored = principles.map(p => scorePrinciple(p, priorities));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // If only one principle, return it
  if (scored.length === 1) {
    return {
      resolved: true,
      chosen: scored[0],
      reasoning: 'Only one principle provided'
    };
  }

  // Check if top two scores are within 20% (ambiguous)
  const topScore = scored[0].score;
  const secondScore = scored[1].score;
  const gap = (topScore - secondScore) / topScore;

  if (gap < 0.20) {
    // Ambiguous priority - escalate to user
    return {
      resolved: false,
      reason: 'ambiguous_priority',
      top_choices: [scored[0], scored[1]],
      message: `Top two principles have similar scores (${topScore.toFixed(3)} vs ${secondScore.toFixed(3)}, gap: ${(gap * 100).toFixed(1)}%). User decision required.`
    };
  }

  // Clear winner - return chosen principle with alternatives
  return {
    resolved: true,
    chosen: scored[0],
    alternatives: scored.slice(1, 3),
    reasoning: `Chosen principle has highest priority score (${topScore.toFixed(3)}) with sufficient gap (${(gap * 100).toFixed(1)}%) from next option`
  };
}

/**
 * Validate priority configuration
 * @param {Object} priorities - Priority weights object
 * @returns {Object} Validation result with warnings
 */
function validatePriorities(priorities) {
  const warnings = [];
  let valid = true;

  // Check all values are 0-1
  for (const [category, weight] of Object.entries(priorities)) {
    if (typeof weight !== 'number' || weight < 0 || weight > 1) {
      valid = false;
      warnings.push(`Invalid priority for ${category}: ${weight} (must be 0-1)`);
    }
  }

  // Check for duplicate priorities (can cause ambiguity)
  const values = Object.values(priorities);
  const uniqueValues = new Set(values);
  if (values.length !== uniqueValues.size) {
    warnings.push('Multiple categories have same priority weight - may cause ambiguous conflicts');
  }

  return { valid, warnings };
}

/**
 * Load allowlist from config
 * @returns {Array} Array of safe action patterns
 */
function loadAllowlist() {
  const config = loadConfig();
  return config.allowlist?.safe_actions || [];
}

/**
 * Check if action matches allowlist pattern
 * Supports exact match and wildcard suffix (:*)
 * @param {string} action - Action to check
 * @param {string} pattern - Pattern to match against
 * @returns {boolean} True if matches
 */
function matchesAllowlistPattern(action, pattern) {
  // Exact match
  if (action === pattern) {
    return true;
  }

  // Wildcard suffix (:*)
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return action.startsWith(prefix + ':') || action === prefix;
  }

  return false;
}

/**
 * Check if action is pre-approved in allowlist
 * @param {string} action - Action to check
 * @returns {Object} Result with allowed flag and matching pattern
 */
function isAllowlisted(action) {
  const allowlist = loadAllowlist();

  for (const pattern of allowlist) {
    if (matchesAllowlistPattern(action, pattern)) {
      return {
        allowed: true,
        pattern
      };
    }
  }

  return {
    allowed: false
  };
}

module.exports = {
  DEFAULT_PRIORITIES,
  loadUserPriorities,
  scorePrinciple,
  resolvePrincipleConflict,
  validatePriorities,
  loadAllowlist,
  isAllowlisted,
  loadConfig
};
