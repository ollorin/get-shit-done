/**
 * LLM-Specific Metrics Collection
 *
 * Captures tokens, cost, context size, and latency per LLM operation.
 * Uses OpenTelemetry gen_ai.* semantic conventions.
 * Source: Phase 8 Research - Pattern 3
 */

const { SpanStatusCode } = require('@opentelemetry/api');
const { getTracer, isTracingEnabled } = require('./observability.js');

// Claude pricing (per 1M tokens)
const CLAUDE_PRICING = {
  'claude-opus-4-5': { input: 5, output: 25, cached: 0.5 },
  'claude-sonnet-4': { input: 3, output: 15, cached: 0.3 },
  'claude-haiku-3-5': { input: 1, output: 5, cached: 0.1 },
  // Aliases
  'opus': { input: 5, output: 25, cached: 0.5 },
  'sonnet': { input: 3, output: 15, cached: 0.3 },
  'haiku': { input: 1, output: 5, cached: 0.1 }
};

/**
 * Calculate cost for an LLM operation
 * @param {string} model - Model name
 * @param {object} usage - Token usage { input_tokens, output_tokens, cache_read_input_tokens }
 * @returns {object} - Cost breakdown { input_cost, output_cost, total_cost }
 */
function calculateCost(model, usage) {
  const pricing = CLAUDE_PRICING[model] || CLAUDE_PRICING['opus'];

  const baseInputTokens = usage.input_tokens - (usage.cache_read_input_tokens || 0);
  const cachedTokens = usage.cache_read_input_tokens || 0;

  const inputCost = (baseInputTokens / 1000000) * pricing.input;
  const cachedCost = (cachedTokens / 1000000) * pricing.cached;
  const outputCost = (usage.output_tokens / 1000000) * pricing.output;

  return {
    input_cost: inputCost + cachedCost,
    output_cost: outputCost,
    total_cost: inputCost + cachedCost + outputCost
  };
}

/**
 * Create an LLM span with gen_ai.* attributes
 * @param {string} operation - Operation name (e.g., 'research', 'plan', 'execute')
 * @param {object} metadata - Additional context
 * @returns {object} - Span wrapper with end() method
 */
function createLLMSpan(operation, metadata = {}) {
  if (!isTracingEnabled()) {
    // Return no-op wrapper
    return {
      setAttributes: () => {},
      recordException: () => {},
      setStatus: () => {},
      end: () => {},
      isNoOp: true
    };
  }

  const tracer = getTracer('gsd-llm');
  const span = tracer.startSpan(`llm.${operation}`);

  // Set initial gen_ai.* attributes
  span.setAttributes({
    'gen_ai.system': 'anthropic',
    'gen_ai.operation.name': operation,
    'gen_ai.request.model': metadata.model || 'unknown',
    'gen_ai.request.max_tokens': metadata.max_tokens || 200000,
    'gen_ai.request.temperature': metadata.temperature || 1.0,
    'gsd.phase': metadata.phase || 'unknown',
    'gsd.plan': metadata.plan || 'unknown'
  });

  return {
    setAttributes: (attrs) => span.setAttributes(attrs),
    recordException: (error) => span.recordException(error),
    setStatus: (code, message) => span.setStatus({ code, message }),
    end: () => span.end(),
    _span: span
  };
}

/**
 * Record LLM usage metrics on a span
 * @param {object} spanWrapper - Span from createLLMSpan
 * @param {object} response - Claude API response with usage field
 */
function recordLLMUsage(spanWrapper, response) {
  if (spanWrapper.isNoOp) return;

  const usage = response.usage || {};
  const model = response.model || 'unknown';
  const cost = calculateCost(model, usage);

  spanWrapper.setAttributes({
    'gen_ai.response.model': model,
    'gen_ai.usage.input_tokens': usage.input_tokens || 0,
    'gen_ai.usage.output_tokens': usage.output_tokens || 0,
    'gen_ai.usage.total_tokens': (usage.input_tokens || 0) + (usage.output_tokens || 0),
    'gen_ai.usage.cache_read_tokens': usage.cache_read_input_tokens || 0,
    'gsd.cost.input_usd': cost.input_cost,
    'gsd.cost.output_usd': cost.output_cost,
    'gsd.cost.total_usd': cost.total_cost
  });

  spanWrapper.setStatus(SpanStatusCode.OK);
}

/**
 * Record an error on an LLM span
 * @param {object} spanWrapper - Span from createLLMSpan
 * @param {Error} error - The error that occurred
 */
function recordLLMError(spanWrapper, error) {
  if (spanWrapper.isNoOp) return;

  spanWrapper.recordException(error);
  spanWrapper.setStatus(SpanStatusCode.ERROR, error.message);
}

/**
 * Wrap an LLM call with tracing
 * @param {string} operation - Operation name
 * @param {object} metadata - Context metadata
 * @param {function} fn - Async function to execute
 */
async function withLLMTracing(operation, metadata, fn) {
  const span = createLLMSpan(operation, metadata);
  const startTime = Date.now();

  try {
    const result = await fn();

    // Record timing
    span.setAttributes({
      'gsd.duration_ms': Date.now() - startTime
    });

    // If result has usage, record it
    if (result && result.usage) {
      recordLLMUsage(span, result);
    }

    return result;
  } catch (error) {
    recordLLMError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

module.exports = {
  calculateCost,
  createLLMSpan,
  recordLLMUsage,
  recordLLMError,
  withLLMTracing,
  CLAUDE_PRICING
};
