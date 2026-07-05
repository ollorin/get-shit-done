/** Pure decision logic for the adapter's reconnect-with-backoff loop. */
export function shouldGiveUpReconnecting(attempt: number, maxRetries: number): boolean {
  return attempt > maxRetries;
}

export function computeReconnectDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
}
