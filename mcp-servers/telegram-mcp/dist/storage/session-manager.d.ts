/**
 * Session metadata - first line of every session JSONL file
 */
export interface SessionMetadata {
    type: 'session_metadata';
    session_id: string;
    pid: number;
    cwd: string;
    start_time: string;
    last_heartbeat: string;
    label?: string;
    tasks: any[];
}
/**
 * Generic JSONL entry
 */
export interface SessionEntry {
    type: string;
    [key: string]: any;
}
/**
 * Session information for discovery
 */
export interface SessionInfo {
    id: string;
    path: string;
    metadata: SessionMetadata | null;
}
export declare const SESSIONS_DIR: string;
/**
 * Get full path to session JSONL file
 */
export declare function getSessionPath(sessionId: string): string;
/**
 * Self-healing JSONL reader
 * Handles corrupted lines gracefully, warns if >10% corrupted
 */
export declare function loadSessionJSONL(filePath: string): Promise<any[]>;
/**
 * Append entry to session file with file locking
 */
export declare function appendToSession(sessionId: string, entry: any): Promise<void>;
/**
 * Create new session with UUID and metadata
 * Triggers opportunistic cleanup of stale sessions
 */
export declare function createSession(label?: string): Promise<string>;
/**
 * Discover all sessions in sessions directory
 * Returns array of SessionInfo with metadata (or null if corrupted)
 */
export declare function discoverSessions(): Promise<SessionInfo[]>;
/**
 * Check if session is alive using dual detection:
 * 1. PID exists (process is running)
 * 2. Heartbeat is fresh (within TTL)
 */
export declare function isSessionAlive(metadata: SessionMetadata): Promise<boolean>;
/**
 * Opportunistic cleanup - archive dead sessions
 * Non-blocking, catches all errors
 */
export declare function cleanupStaleSessions(): Promise<void>;
/**
 * Archive session to date-based archive directory
 * Format: archive/YYYY-MM-DD/<session-id>.jsonl
 */
export declare function archiveSession(sessionPath: string): Promise<void>;
/**
 * Update session heartbeat
 * Appends heartbeat entry to session file
 */
export declare function updateHeartbeat(sessionId: string): Promise<void>;
/**
 * Explicitly close session
 * Appends session_close entry to session file
 */
export declare function closeSession(sessionId: string): Promise<void>;
/**
 * Close session with pre-close analysis.
 *
 * Per locked decision #6: Analysis runs BEFORE session close to prevent
 * data loss on crash. Analysis failures must never prevent session close.
 *
 * Flow:
 * 1. Load session entries
 * 2. Run quality gates (shouldAnalyzeSession)
 * 3. Check if already analyzed (isAlreadyAnalyzed)
 * 4. Prepare extraction requests via analyzeSession()
 * 5. Append session_analysis_pending entry for GSD workflow to pick up
 * 6. Close session (append session_close entry)
 *
 * @param sessionId - Session identifier
 * @returns { analyzed: boolean, reason: string }
 */
export declare function closeSessionWithAnalysis(sessionId: string): Promise<{
    analyzed: boolean;
    reason: string;
}>;
