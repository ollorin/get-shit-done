/** Pure decision logic for the adapter's reconnect-with-backoff loop. */
export declare function shouldGiveUpReconnecting(attempt: number, maxRetries: number): boolean;
export declare function computeReconnectDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number;
