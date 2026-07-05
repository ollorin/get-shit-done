const fs = require('fs');
const path = require('path');

const { classifyAction } = require('./knowledge-principles.js');

// ─── Secrets/PII Content Filter ────────────────────────────────────────────

// Unambiguous API-key-like prefixes. Any match here means REJECT the whole
// insight outright (never redact) — per policy, a clear credential match is
// never persisted verbatim to the DB, full stop.
const API_KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{36}\b/,
  /\bgho_[A-Za-z0-9]{36}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[A-Za-z0-9_-]{35}\b/
];

// Credential keyword patterns -> REDACT (unambiguous key:value shape, safe
// to redact rather than reject since the key name itself is harmless).
const CREDENTIAL_KEYWORD_PATTERN = /(password|secret|api[_-]?key|token)\s*[:=]\s*(\S+)/gi;

// Email addresses -> REDACT.
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Generic high-entropy ambiguous token -> REJECT whole insight. Standalone
// 32+ char alnum/dash tokens not already matched by a known API-key prefix.
// Word-boundary guarded, and skipped if preceded closely by a word like
// hash/sha/commit/id (normal git-hash mentions in lessons/prose).
const HIGH_ENTROPY_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/g;
const HIGH_ENTROPY_CONTEXT_EXCLUSION = /(hash|sha|commit|id)\W{0,10}$/i;

/**
 * Load additional project-configured secret patterns from
 * .planning/config.json's `knowledge.secrets_patterns` (array of strings,
 * each compiled as a case-insensitive RegExp). Never throws — absent file,
 * malformed JSON, or an invalid regex string all degrade to an empty array.
 *
 * @param {string} [cwd] - Working directory (defaults to process.cwd())
 * @returns {RegExp[]} Compiled extra secret patterns
 */
function loadExtraSecretPatterns(cwd) {
  try {
    const configPath = path.join(cwd || process.cwd(), '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const patterns = (config.knowledge && config.knowledge.secrets_patterns) || [];
    if (!Array.isArray(patterns)) return [];
    const compiled = [];
    for (const p of patterns) {
      try {
        if (typeof p === 'string' && p.length > 0) {
          compiled.push(new RegExp(p, 'i'));
        }
      } catch (_) {
        // Invalid regex string — skip it, never throw
      }
    }
    return compiled;
  } catch (_) {
    return [];
  }
}

/**
 * Filter content for secrets/PII before persistence.
 *
 * Policy: rejection preferred over redaction when a match is ambiguous — "a
 * lost knowledge entry is cheaper than a persisted credential." Clean content
 * with no sensitive patterns passes through completely unchanged.
 *
 * Order of evaluation:
 *   1. Unambiguous-reject patterns (built-in API-key prefixes + project-
 *      configured custom patterns) — any match short-circuits to rejected.
 *   2. Ambiguous high-entropy token check — also short-circuits to rejected.
 *   3. Redaction passes (credential keywords, then emails) — applied only if
 *      neither reject condition fired.
 *
 * @param {string} content - Raw content to filter
 * @param {string} [cwd] - Working directory for loading custom patterns
 * @returns {{ safe: boolean, action: 'redacted'|'rejected'|null, content: string, reason?: string }}
 */
function filterContentForSecrets(content, cwd) {
  if (typeof content !== 'string') {
    return { safe: true, action: null, content };
  }

  // 1a. Built-in unambiguous API-key prefixes
  for (const pattern of API_KEY_PATTERNS) {
    if (pattern.test(content)) {
      return {
        safe: false,
        action: 'rejected',
        content,
        reason: 'API-key-like token detected'
      };
    }
  }

  // 1b. Project-configured custom patterns — treated as unambiguous, same as
  // built-in API-key prefixes, since explicit project configuration signals
  // clear intent.
  const extraPatterns = loadExtraSecretPatterns(cwd);
  for (const pattern of extraPatterns) {
    if (pattern.test(content)) {
      return {
        safe: false,
        action: 'rejected',
        content,
        reason: 'Matched project-configured secret pattern'
      };
    }
  }

  // 2. Ambiguous high-entropy token check
  HIGH_ENTROPY_TOKEN_PATTERN.lastIndex = 0;
  let match;
  while ((match = HIGH_ENTROPY_TOKEN_PATTERN.exec(content)) !== null) {
    const token = match[0];
    // Skip tokens already covered by a redaction pattern below (email local
    // parts can be long, but those are handled by EMAIL_PATTERN separately —
    // check here only for tokens NOT part of an email address).
    const precedingText = content.slice(Math.max(0, match.index - 12), match.index);
    if (HIGH_ENTROPY_CONTEXT_EXCLUSION.test(precedingText)) {
      continue; // e.g. "commit abc123...", "sha: abc123...", "id abc123..."
    }
    // Skip if this token is actually the domain/local part of an email match
    const surroundingChar = content[match.index - 1];
    const trailingChar = content[match.index + token.length];
    if (surroundingChar === '@' || trailingChar === '@') {
      continue;
    }
    return {
      safe: false,
      action: 'rejected',
      content,
      reason: 'Ambiguous high-entropy token detected'
    };
  }

  // 3. Redaction passes — credential keywords, then emails
  let redacted = content;
  let didRedact = false;

  CREDENTIAL_KEYWORD_PATTERN.lastIndex = 0;
  if (CREDENTIAL_KEYWORD_PATTERN.test(redacted)) {
    didRedact = true;
  }
  CREDENTIAL_KEYWORD_PATTERN.lastIndex = 0;
  redacted = redacted.replace(CREDENTIAL_KEYWORD_PATTERN, (m, key) => `${key}: [REDACTED]`);

  EMAIL_PATTERN.lastIndex = 0;
  if (EMAIL_PATTERN.test(redacted)) {
    didRedact = true;
  }
  EMAIL_PATTERN.lastIndex = 0;
  redacted = redacted.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');

  return {
    safe: true,
    action: didRedact ? 'redacted' : null,
    content: redacted
  };
}

// Lazy-load permissions module to avoid circular dependencies
function getPermissionsModule() {
  try {
    return require('./knowledge-permissions.js');
  } catch (err) {
    // Module not ready yet
    return null;
  }
}

/**
 * Determine if action requires user approval
 * @param {string} action - The action to check
 * @param {object} context - Additional context
 * @returns {object} - { stop: boolean, reason: string, category: string, prompt?: string }
 */
function shouldStopAndAsk(action, context = {}) {
  const classification = classifyAction(action);
  const category = classification.category;

  // Irreversible actions require approval
  if (category === 'irreversible') {
    return {
      stop: true,
      reason: 'irreversible_action',
      category,
      prompt: formatApprovalPrompt(action, 'irreversible')
    };
  }

  // External communications require approval
  if (category === 'external') {
    return {
      stop: true,
      reason: 'external_communication',
      category,
      prompt: formatApprovalPrompt(action, 'external')
    };
  }

  // Costly actions require approval
  if (category === 'costly') {
    return {
      stop: true,
      reason: 'costly_action',
      category,
      prompt: formatApprovalPrompt(action, 'costly')
    };
  }

  // Safe/reversible actions don't require approval
  return {
    stop: false,
    reason: 'safe_action',
    category
  };
}

/**
 * Format human-readable approval prompt
 * @param {string} action - The action requiring approval
 * @param {string} category - Action category (irreversible/external/costly)
 * @returns {string} - Formatted prompt
 */
function formatApprovalPrompt(action, category) {
  switch (category) {
    case 'irreversible':
      return `This action will ${action}. This cannot be undone. Proceed? [y/N]`;
    case 'external':
      return `This will communicate externally: ${action}. Proceed? [y/N]`;
    case 'costly':
      return `This action may incur costs: ${action}. Proceed? [y/N]`;
    default:
      return `Proceed with ${action}? [y/N]`;
  }
}

/**
 * Estimate cost of action
 * @param {string} action - The action to estimate
 * @param {object} context - Additional context (estimated_tokens, etc.)
 * @returns {number} - Estimated cost in dollars
 */
function estimateActionCost(action, context = {}) {
  const lowerAction = action.toLowerCase();

  // AWS/cloud resources
  if (lowerAction.includes('aws') || lowerAction.includes('cloud_resource')) {
    return 0.10; // Conservative estimate
  }

  // GCP resources
  if (lowerAction.includes('gcp')) {
    return 0.10;
  }

  // Azure resources
  if (lowerAction.includes('azure')) {
    return 0.10;
  }

  // API calls with token estimates
  if (lowerAction.includes('api_call') && context.estimated_tokens) {
    return (context.estimated_tokens / 1000000) * 0.50;
  }

  // OpenAI API calls
  if (lowerAction.includes('openai')) {
    return 0.05;
  }

  // Anthropic API calls
  if (lowerAction.includes('anthropic')) {
    return 0.05;
  }

  // Stripe charges
  if (lowerAction.includes('stripe_charge')) {
    return 0.05;
  }

  // Deploy to production
  if (lowerAction.includes('deploy_to')) {
    return 0.10;
  }

  // Paid APIs
  if (lowerAction.includes('paid_api')) {
    return 0.05;
  }

  // Large compute
  if (lowerAction.includes('large_compute')) {
    return 1.00;
  }

  // Default: no cost
  return 0.0;
}

/**
 * Execute action with full safety check flow
 * @param {string} action - The action to execute
 * @param {object} context - Additional context
 * @param {object} options - Execution options
 * @returns {object} - { proceed: boolean, autonomous?: boolean, requires_approval?: boolean, reason: string, ... }
 */
function executeWithSafetyCheck(action, context = {}, options = {}) {
  // Step 1: Check if we should stop and ask
  const stopCheck = shouldStopAndAsk(action, context);

  if (stopCheck.stop) {
    // Try to check permission (if module is available)
    let permitted = false;
    let grantId = null;

    try {
      const permissionsModule = getPermissionsModule();
      if (permissionsModule && permissionsModule.checkPermission) {
        const permCheck = permissionsModule.checkPermission(action, context);
        permitted = permCheck.permitted || false;
        grantId = permCheck.grant_id || null;
      }
    } catch (err) {
      // Permission check failed - treat as not permitted
      permitted = false;
    }

    // If permitted, proceed autonomously
    if (permitted) {
      const result = {
        proceed: true,
        autonomous: true,
        via: 'permission',
        grant_id: grantId,
        reason: stopCheck.reason,
        category: stopCheck.category
      };

      // Add cost estimate for costly actions
      if (stopCheck.category === 'costly') {
        result.estimated_cost = estimateActionCost(action, context);
      }

      return result;
    }

    // Not permitted - require approval
    const result = {
      proceed: false,
      requires_approval: true,
      reason: stopCheck.reason,
      prompt: stopCheck.prompt,
      category: stopCheck.category
    };

    // Add cost estimate for costly actions
    if (stopCheck.category === 'costly') {
      const cost = estimateActionCost(action, context);
      result.estimated_cost = cost;
      result.prompt = `This action may cost ~$${cost.toFixed(2)}: ${action}. Proceed? [y/N]`;
    }

    return result;
  }

  // No stop required - safe to proceed
  return {
    proceed: true,
    autonomous: true,
    reason: 'safe_action',
    category: stopCheck.category
  };
}

module.exports = {
  shouldStopAndAsk,
  formatApprovalPrompt,
  estimateActionCost,
  executeWithSafetyCheck,
  filterContentForSecrets,
  loadExtraSecretPatterns
};
