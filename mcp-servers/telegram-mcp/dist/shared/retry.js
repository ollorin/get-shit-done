import { createLogger } from './logger.js';
const log = createLogger('shared/retry');
const DEFAULT_DELAYS_MS = [500, 1500, 4000];
function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Run fn() with bounded exponential-backoff retry. Every retry is logged at
 * WARN (loud, visible -- a notification failure must never be silently
 * dropped). If all attempts are exhausted, logs at ERROR and rethrows the
 * last error -- callers keep their existing "does this failure matter to me"
 * semantics; this helper only ensures no failure goes unlogged.
 */
export async function withRetry(fn, options = {}) {
    const delaysMs = options.delaysMs ?? DEFAULT_DELAYS_MS;
    const attempts = options.attempts ?? delaysMs.length + 1;
    const sleep = options.sleepFn ?? defaultSleep;
    const label = options.label ?? 'operation';
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            const message = err instanceof Error ? err.message : String(err);
            const isLastAttempt = attempt === attempts;
            if (isLastAttempt) {
                log.error({ label, attempt, attempts, err: message }, `${label} failed after ${attempts} attempts — giving up`);
                throw err;
            }
            const delay = delaysMs[attempt - 1] ?? delaysMs[delaysMs.length - 1];
            log.warn({ label, attempt, attempts, delayMs: delay, err: message }, `${label} attempt ${attempt}/${attempts} failed — retrying in ${delay}ms`);
            await sleep(delay);
        }
    }
    throw lastError;
}
