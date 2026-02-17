/**
 * Telegram Session Logger
 *
 * Logs all bot activity (messages, questions, decisions) to daily JSONL files.
 * One daily file per day in .planning/telegram-sessions/
 */
import fs from 'fs/promises';
import { existsSync, appendFileSync } from 'fs';
import path from 'path';
// Project root resolution (env var or path traversal)
function getProjectRoot() {
    if (process.env.PROJECT_ROOT) {
        return process.env.PROJECT_ROOT;
    }
    // Traverse up from mcp-servers/telegram-mcp to project root
    const currentDir = process.cwd();
    if (currentDir.includes('mcp-servers/telegram-mcp')) {
        return path.resolve(currentDir, '../..');
    }
    return currentDir;
}
const PROJECT_ROOT = getProjectRoot();
let currentSessionPath = null;
let sessionStartTime = null;
/**
 * Get daily log path
 */
function getDailyLogPath() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const sessionsDir = path.join(PROJECT_ROOT, '.planning', 'telegram-sessions');
    // Ensure directory exists (sync for simplicity)
    if (!existsSync(sessionsDir)) {
        fs.mkdir(sessionsDir, { recursive: true });
    }
    return path.join(sessionsDir, `${date}.jsonl`);
}
/**
 * Start new session log
 */
export function startSession() {
    currentSessionPath = getDailyLogPath();
    sessionStartTime = Date.now();
    logEvent({
        type: 'session_start',
        timestamp: new Date().toISOString()
    });
    return currentSessionPath;
}
/**
 * Log any event to current session
 */
export function logEvent(event) {
    if (!currentSessionPath) {
        currentSessionPath = getDailyLogPath();
        sessionStartTime = Date.now();
    }
    const entry = {
        ...event,
        session_time_ms: sessionStartTime ? Date.now() - sessionStartTime : 0,
        timestamp: event.timestamp || new Date().toISOString()
    };
    // Use synchronous append for atomic writes
    appendFileSync(currentSessionPath, JSON.stringify(entry) + '\n');
}
/**
 * Log user message
 */
export function logMessage(userId, username, messageType, content) {
    logEvent({
        type: 'user_message',
        user_id: userId,
        username,
        message_type: messageType,
        content: messageType === 'voice'
            ? `[voice:${content.duration}s]`
            : content
    });
}
/**
 * Log bot response
 */
export function logBotResponse(content, messageType = 'text') {
    logEvent({
        type: 'bot_response',
        message_type: messageType,
        content
    });
}
/**
 * Log Haiku decision
 */
export function logDecision(decisionType, reasoning, action) {
    logEvent({
        type: 'haiku_decision',
        decision_type: decisionType,
        reasoning,
        action
    });
}
/**
 * Log blocking question
 */
export function logBlockingQuestion(questionId, question, source) {
    logEvent({
        type: 'blocking_question',
        question_id: questionId,
        question,
        source
    });
}
/**
 * Log blocking question response
 */
export function logBlockingResponse(questionId, response) {
    logEvent({
        type: 'blocking_response',
        question_id: questionId,
        response
    });
}
/**
 * End current session
 */
export function endSession() {
    if (currentSessionPath && sessionStartTime) {
        logEvent({
            type: 'session_end',
            duration_ms: Date.now() - sessionStartTime
        });
    }
    const path = currentSessionPath;
    currentSessionPath = null;
    sessionStartTime = null;
    return path;
}
/**
 * Get current session path
 */
export function getSessionPath() {
    return currentSessionPath;
}
/**
 * Get all session files
 */
export async function getAllSessions() {
    const sessionsDir = path.join(PROJECT_ROOT, '.planning', 'telegram-sessions');
    if (!existsSync(sessionsDir)) {
        return [];
    }
    const files = await fs.readdir(sessionsDir);
    return files
        .filter(f => f.endsWith('.jsonl'))
        .map(f => path.join(sessionsDir, f))
        .sort()
        .reverse(); // Most recent first
}
/**
 * Read session log
 */
export async function readSession(sessionPath) {
    const content = await fs.readFile(sessionPath, 'utf8');
    return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
        try {
            return JSON.parse(line);
        }
        catch (err) {
            console.error('[session-logger] Malformed JSON line, skipping:', line);
            return null;
        }
    })
        .filter(entry => entry !== null);
}
