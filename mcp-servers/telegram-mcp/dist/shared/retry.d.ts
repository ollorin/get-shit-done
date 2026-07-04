export interface RetryOptions {
    /** Delay (ms) before each retry attempt. Default: [500, 1500, 4000] -- one initial try + up to 3 retries. */
    delaysMs?: number[];
    /** Total attempts including the first try. Default: delaysMs.length + 1. */
    attempts?: number;
    /** Label used in log lines (e.g. 'sendToGroup'). Default: 'operation'. */
    label?: string;
    /** Injectable sleep function -- override in tests to avoid real timers. Default: real setTimeout. */
    sleepFn?: (ms: number) => Promise<void>;
}
/**
 * Run fn() with bounded exponential-backoff retry. Every retry is logged at
 * WARN (loud, visible -- a notification failure must never be silently
 * dropped). If all attempts are exhausted, logs at ERROR and rethrows the
 * last error -- callers keep their existing "does this failure matter to me"
 * semantics; this helper only ensures no failure goes unlogged.
 */
export declare function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
