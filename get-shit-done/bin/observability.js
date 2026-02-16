/**
 * OpenTelemetry Initialization for GSD Autonomous Execution
 *
 * Provides distributed tracing across multi-agent workflows.
 * Pattern: OpenTelemetry with gen_ai.* semantic conventions
 * Source: Phase 8 Research - Pattern 3
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { trace } = require('@opentelemetry/api');

let sdk = null;
let isInitialized = false;

/**
 * Initialize OpenTelemetry tracing
 * @param {object} options - Configuration options
 * @param {string} options.serviceName - Service name for traces (default: 'gsd-autonomous-execution')
 * @param {string} options.endpoint - OTLP endpoint (default: env.OTEL_EXPORTER_OTLP_ENDPOINT or disabled)
 */
function initTracing(options = {}) {
  if (isInitialized) {
    console.log('OpenTelemetry already initialized');
    return;
  }

  const serviceName = options.serviceName || 'gsd-autonomous-execution';
  const endpoint = options.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  // If no endpoint configured, create no-op tracer
  if (!endpoint) {
    console.log('OTEL_EXPORTER_OTLP_ENDPOINT not set. Tracing disabled (no-op mode).');
    isInitialized = true;
    return;
  }

  try {
    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
      }),
      traceExporter: new OTLPTraceExporter({
        url: endpoint,
      }),
    });

    sdk.start();
    isInitialized = true;
    console.log(`OpenTelemetry tracing enabled. Exporting to: ${endpoint}`);
  } catch (error) {
    console.error('Failed to initialize OpenTelemetry:', error.message);
    isInitialized = true; // Mark as initialized to prevent retry loops
  }
}

/**
 * Get tracer for creating spans
 * @param {string} tracerName - Name of the tracer (default: 'gsd')
 */
function getTracer(tracerName = 'gsd') {
  return trace.getTracer(tracerName);
}

/**
 * Graceful shutdown of tracing
 */
async function shutdownTracing() {
  if (sdk) {
    try {
      await sdk.shutdown();
      console.log('OpenTelemetry tracing terminated');
    } catch (error) {
      console.error('Error shutting down OpenTelemetry:', error.message);
    }
  }
}

/**
 * Get current span context for propagation to sub-coordinators
 * Returns traceparent header value for W3C Trace Context
 */
function getTraceContext() {
  const currentSpan = trace.getActiveSpan();
  if (!currentSpan) return null;

  const ctx = currentSpan.spanContext();
  // W3C Trace Context format: version-traceId-spanId-flags
  return `00-${ctx.traceId}-${ctx.spanId}-01`;
}

/**
 * Check if tracing is enabled
 */
function isTracingEnabled() {
  return isInitialized && sdk !== null;
}

module.exports = {
  initTracing,
  getTracer,
  shutdownTracing,
  getTraceContext,
  isTracingEnabled
};
