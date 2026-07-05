/** Shared error types for the Telegram MCP adapter/daemon architecture. */
export class DaemonUnavailableError extends Error {
  readonly code = 'DAEMON_UNAVAILABLE' as const;
  constructor(message: string) {
    super(message);
    this.name = 'DaemonUnavailableError';
  }
}
