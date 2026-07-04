/** Shared error types for the Telegram MCP adapter/daemon architecture. */
export declare class DaemonUnavailableError extends Error {
    readonly code: "DAEMON_UNAVAILABLE";
    constructor(message: string);
}
