/**
 * Telegram Session Logger
 *
 * Logs all bot activity (messages, questions, decisions) to daily JSONL files.
 * One daily file per day in .planning/telegram-sessions/
 */
/**
 * Start new session log
 */
export declare function startSession(): string;
/**
 * Log any event to current session
 */
export declare function logEvent(event: Record<string, any>): void;
/**
 * Log user message
 */
export declare function logMessage(userId: number, username: string, messageType: 'text' | 'voice' | 'button', content: string | {
    duration: number;
}): void;
/**
 * Log bot response
 */
export declare function logBotResponse(content: string, messageType?: 'text' | 'menu'): void;
/**
 * Log Haiku decision
 */
export declare function logDecision(decisionType: string, reasoning: string, action: string): void;
/**
 * Log blocking question
 */
export declare function logBlockingQuestion(questionId: string, question: string, source: string): void;
/**
 * Log blocking question response
 */
export declare function logBlockingResponse(questionId: string, response: string): void;
/**
 * End current session
 */
export declare function endSession(): string | null;
/**
 * Get current session path
 */
export declare function getSessionPath(): string | null;
/**
 * Get all session files
 */
export declare function getAllSessions(): Promise<string[]>;
/**
 * Read session log
 */
export declare function readSession(sessionPath: string): Promise<any[]>;
