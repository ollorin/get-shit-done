/** Shared error types for the Telegram MCP adapter/daemon architecture. */
export class DaemonUnavailableError extends Error {
    code = 'DAEMON_UNAVAILABLE';
    constructor(message) {
        super(message);
        this.name = 'DaemonUnavailableError';
    }
}
