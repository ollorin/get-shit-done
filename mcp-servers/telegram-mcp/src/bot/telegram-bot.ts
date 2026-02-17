/**
 * Telegram Bot with Middleware-Based Menu Handlers
 *
 * CRITICAL FIX: Uses session middleware instead of .once() listeners
 * to avoid the Phase 8 bug where menu buttons only work once.
 */

import { Telegraf, Markup, session } from 'telegraf';
import type { Context } from 'telegraf';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  startSession,
  endSession,
  logMessage,
  logBotResponse,
  logBlockingQuestion,
  logBlockingResponse
} from './session-logger.js';
import { transcribeAudio, checkWhisperModel } from './transcription.js';
import { loadAllPendingQuestions, getPendingById, markAnswered } from '../storage/question-queue.js';
import { discoverSessions, loadSessionJSONL } from '../storage/session-manager.js';

// Load environment variables
dotenv.config();

// Session data interface
interface SessionData {
  awaitingQuestionResponse: string | null; // Question ID user is responding to
  awaitingSessionId: string | null; // Session ID for the question
}

interface BotContext extends Context {
  session: SessionData;
}

// Bot instance (lazy-initialized in startBot)
let bot: Telegraf<BotContext> | null = null;
let botStarted = false;
let ownerChatId: number | null = null;

// Inactivity timer for session-end detection
let inactivityTimer: NodeJS.Timeout | null = null;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Set owner chat ID from env
if (process.env.TELEGRAM_OWNER_ID) {
  ownerChatId = parseInt(process.env.TELEGRAM_OWNER_ID, 10);
}

/**
 * Main menu keyboard (New Requirements DISABLED per user decision)
 */
export const MAIN_MENU = Markup.inlineKeyboard([
  [
    Markup.button.callback('📊 Status', 'menu:status'),
    Markup.button.callback('❓ Pending', 'menu:pending')
  ]
]);

/**
 * Reset the 10-minute inactivity timer.
 * When the timer fires, triggers session analysis.
 * Called after each substantive user message.
 */
function resetInactivityTimer(): void {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  inactivityTimer = setTimeout(async () => {
    try {
      const { closeSessionWithAnalysis } = await import('../storage/session-manager.js');
      const { getCurrentSessionId } = await import('../storage/session-state.js');

      let sessionId: string | null = null;
      try {
        sessionId = getCurrentSessionId();
      } catch {
        // Session not initialized
      }

      if (sessionId) {
        await closeSessionWithAnalysis(sessionId);

        // Notify owner if possible
        if (bot && ownerChatId) {
          try {
            await bot.telegram.sendMessage(
              ownerChatId,
              'Session analysis triggered (10-minute inactivity timeout). Knowledge extracted.'
            );
          } catch (sendErr: any) {
            console.error('[telegram-bot] Failed to send inactivity notification:', sendErr.message);
          }
        }
      }

      console.error('[telegram-bot] Inactivity timeout - session analysis triggered');
    } catch (err: any) {
      console.error('[telegram-bot] Inactivity timer error:', err.message);
    }
  }, INACTIVITY_TIMEOUT_MS);
}

/**
 * Get GSD status from STATE.md
 */
async function getGSDStatus(): Promise<string> {
  try {
    const projectRoot = process.env.PROJECT_ROOT || process.cwd();
    const statePath = path.join(projectRoot, '.planning', 'STATE.md');

    if (!existsSync(statePath)) {
      return 'No active execution (STATE.md not found)';
    }

    const state = await fs.readFile(statePath, 'utf8');
    const positionMatch = state.match(/## Current Position\n\n([\s\S]*?)\n\n##/);

    if (positionMatch) {
      return `📊 **Current Status**\n\n${positionMatch[1].slice(0, 300)}`;
    }

    return 'Unable to parse STATE.md';
  } catch (err: any) {
    return `Error reading status: ${err.message}`;
  }
}

/**
 * Initialize bot instance with handlers
 */
function initializeBot(): Telegraf<BotContext> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN not set in environment');
  }

  const botInstance = new Telegraf<BotContext>(process.env.TELEGRAM_BOT_TOKEN);

  // Add session middleware
  botInstance.use(session({
    defaultSession: (): SessionData => ({
      awaitingQuestionResponse: null,
      awaitingSessionId: null
    })
  }));

  // Register all handlers
  setupHandlers(botInstance);

  return botInstance;
}

/**
 * Setup all bot command and message handlers
 */
function setupHandlers(botInstance: Telegraf<BotContext>): void {
  /**
   * Menu action handler: Status
   */
  botInstance.action('menu:status', async (ctx) => {
    await ctx.answerCbQuery();

    const status = await getGSDStatus();
    const backButton = Markup.inlineKeyboard([
      Markup.button.callback('« Back to Menu', 'back:main')
    ]);

    await ctx.editMessageText(status, { parse_mode: 'Markdown', ...backButton });
    logBotResponse(status, 'menu');
  });

  /**
   * Menu action handler: Pending Questions
   */
  botInstance.action('menu:pending', async (ctx) => {
    await ctx.answerCbQuery();

    const questions = await loadAllPendingQuestions();

    if (questions.length === 0) {
      const backButton = Markup.inlineKeyboard([
        Markup.button.callback('« Back to Menu', 'back:main')
      ]);
      await ctx.editMessageText('No pending questions. All clear! ✓', backButton);
      logBotResponse('No pending questions', 'menu');
      return;
    }

    // Count unique sessions
    const sessionIds = new Set(questions.map(q => q.session_id));
    const sessionCount = sessionIds.size;

    // Get session metadata for labels
    const sessions = await discoverSessions();
    const sessionLabels = new Map<string, string>();
    for (const session of sessions) {
      if (session.metadata) {
        const label = session.metadata.label || session.id.slice(0, 8);
        sessionLabels.set(session.id, label);
      }
    }

    // Show questions with answer buttons
    let text = `❓ **Pending Questions** (${questions.length} from ${sessionCount} session${sessionCount > 1 ? 's' : ''})\n\nClick to respond:\n\n`;

    const buttons = questions.map((q, idx) => {
      const label = sessionLabels.get(q.session_id) || q.session_id.slice(0, 8);
      const preview = q.question.slice(0, 30);
      return [Markup.button.callback(`${idx + 1}. [${label}] ${preview}...`, `answer:${q.session_id}:${q.id}`)];
    });

    buttons.push([Markup.button.callback('« Back to Menu', 'back:main')]);

    const keyboard = Markup.inlineKeyboard(buttons);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    logBotResponse(`Showed ${questions.length} pending questions from ${sessionCount} sessions`, 'menu');
  });

  /**
   * Answer button handler (dynamic - registers for session:question format)
   */
  botInstance.action(/^answer:([^:]+):(.+)$/, async (ctx) => {
    const sessionId = ctx.match[1];
    const questionId = ctx.match[2];
    await ctx.answerCbQuery();

    const question = await getPendingById(questionId, sessionId);
    if (!question) {
      await ctx.reply('Question not found or already answered.');
      return;
    }

    // Set session state to await response
    ctx.session.awaitingQuestionResponse = questionId;
    ctx.session.awaitingSessionId = sessionId;

    await ctx.reply(
      `**Question:** ${question.question}\n\n` +
      `Send your response (text or voice):`,
      { parse_mode: 'Markdown' }
    );

    logBotResponse(`Awaiting response for question: ${questionId} (session: ${sessionId})`, 'menu');
  });

  /**
   * Back to main menu handler
   */
  botInstance.action('back:main', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.awaitingQuestionResponse = null;
    ctx.session.awaitingSessionId = null;
    await ctx.editMessageText('Main Menu:', MAIN_MENU);
    logBotResponse('Returned to main menu', 'menu');
  });

  /**
   * Command: /start
   */
  botInstance.command('start', async (ctx) => {
  const chatId = ctx.from.id;
  const username = ctx.from.username || 'unknown';

  // Store chat ID if owner
  if (!process.env.TELEGRAM_OWNER_ID || chatId.toString() === process.env.TELEGRAM_OWNER_ID) {
    ownerChatId = chatId;
    await ctx.reply(
      `👋 Welcome ${username}!\n\n` +
      `I'm your GSD assistant powered by MCP.\n\n` +
      `Use the menu below to:\n` +
      `• Check execution status\n` +
      `• Respond to pending questions\n\n` +
      `Voice messages are supported! 🎤`,
      MAIN_MENU
    );
    logMessage(chatId, username, 'text', '/start');
    logBotResponse('Sent welcome message', 'menu');
  } else {
    await ctx.reply('Unauthorized. This bot is private.');
    logMessage(chatId, username, 'text', '/start (unauthorized)');
  }
});

/**
 * Command: /end
 * Explicitly ends the session and triggers knowledge extraction
 */
botInstance.command('end', async (ctx) => {
  try {
    const { closeSessionWithAnalysis } = await import('../storage/session-manager.js');
    const { getCurrentSessionId } = await import('../storage/session-state.js');

    let sessionId: string | null = null;
    try {
      sessionId = getCurrentSessionId();
    } catch {
      // Session not initialized
    }

    if (sessionId) {
      const result = await closeSessionWithAnalysis(sessionId);
      await ctx.reply(
        `Session analysis ${result.analyzed ? 'completed' : 'skipped'} (${result.reason}). Knowledge extracted.`
      );
    } else {
      await ctx.reply('No active session.');
    }

    // Clear inactivity timer since we explicitly ended
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  } catch (err: any) {
    await ctx.reply(`Error ending session: ${err.message}`);
  }
});

/**
 * Text message handler
 */
botInstance.on('text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;
  const username = ctx.from.username || 'unknown';

  // Skip commands
  if (text.startsWith('/')) {
    return;
  }

  // Detect "done" keyword - triggers session analysis
  const lowerText = text.trim().toLowerCase();
  if (lowerText === 'done') {
    try {
      const { closeSessionWithAnalysis } = await import('../storage/session-manager.js');
      const { getCurrentSessionId } = await import('../storage/session-state.js');

      let sessionId: string | null = null;
      try {
        sessionId = getCurrentSessionId();
      } catch {
        // Session not initialized
      }

      if (sessionId) {
        const result = await closeSessionWithAnalysis(sessionId);
        await ctx.reply(
          `Session analysis ${result.analyzed ? 'completed' : 'skipped'} (${result.reason}). Knowledge extracted.`
        );
      } else {
        await ctx.reply('No active session to analyze.');
      }

      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
    } catch (err: any) {
      await ctx.reply(`Error triggering session analysis: ${err.message}`);
    }
    return;
  }

  logMessage(userId, username, 'text', text);

  // If awaiting response for specific question
  if (ctx.session.awaitingQuestionResponse && ctx.session.awaitingSessionId) {
    const questionId = ctx.session.awaitingQuestionResponse;
    const sessionId = ctx.session.awaitingSessionId;

    try {
      await markAnswered(sessionId, questionId, text);
      ctx.session.awaitingQuestionResponse = null;
      ctx.session.awaitingSessionId = null;

      await ctx.reply('✅ Response recorded! Resuming execution...');
      logBlockingResponse(questionId, text);
      return;
    } catch (err: any) {
      await ctx.reply(`Error recording response: ${err.message}`);
      ctx.session.awaitingQuestionResponse = null;
      ctx.session.awaitingSessionId = null;
      return;
    }
  }

  // Check for single pending question (auto-match)
  const pending = await loadAllPendingQuestions();
  if (pending.length === 1) {
    const questionId = pending[0].id;
    const sessionId = pending[0].session_id;

    try {
      await markAnswered(sessionId, questionId, text);
      await ctx.reply(
        `✅ Response recorded for: "${pending[0].question.slice(0, 50)}..."\n\n` +
        `Resuming execution...`
      );
      logBlockingResponse(questionId, text);
      return;
    } catch (err: any) {
      await ctx.reply(`Error recording response: ${err.message}`);
      return;
    }
  }

  // Multiple pending or none - show menu
  await ctx.reply('What would you like to do?', MAIN_MENU);

  // Reset inactivity timer on every substantive message
  resetInactivityTimer();
});

/**
 * Voice message handler
 */
botInstance.on('voice', async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || 'unknown';
  const duration = ctx.message.voice.duration;

  logMessage(userId, username, 'voice', { duration });

  // Check Whisper availability
  const modelStatus = await checkWhisperModel();
  if (!modelStatus.available) {
    await ctx.reply(`❌ Voice not available: ${modelStatus.message}`);
    return;
  }

  // Get file link
  const fileId = ctx.message.voice.file_id;
  const fileSize = ctx.message.voice.file_size;

  // Check size limit (20MB)
  if (fileSize && fileSize > 20 * 1024 * 1024) {
    await ctx.reply('Voice message too large (>20MB). Please send a shorter clip.');
    return;
  }

  await ctx.reply('🎤 Transcribing voice message...');

  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const transcription = await transcribeAudio(fileLink.href);

    await ctx.reply(`Transcribed: "${transcription}"`);

    // If awaiting response, use transcription as answer
    if (ctx.session.awaitingQuestionResponse && ctx.session.awaitingSessionId) {
      const questionId = ctx.session.awaitingQuestionResponse;
      const sessionId = ctx.session.awaitingSessionId;

      try {
        await markAnswered(sessionId, questionId, transcription);
        ctx.session.awaitingQuestionResponse = null;
        ctx.session.awaitingSessionId = null;

        await ctx.reply('✅ Response recorded! Resuming execution...');
        logBlockingResponse(questionId, transcription);
        return;
      } catch (err: any) {
        await ctx.reply(`Error recording response: ${err.message}`);
        ctx.session.awaitingQuestionResponse = null;
        ctx.session.awaitingSessionId = null;
        return;
      }
    }

    // Check for single pending question
    const pending = await loadAllPendingQuestions();
    if (pending.length === 1) {
      const questionId = pending[0].id;
      const sessionId = pending[0].session_id;

      try {
        await markAnswered(sessionId, questionId, transcription);
        await ctx.reply(
          `✅ Response recorded for: "${pending[0].question.slice(0, 50)}..."\n\n` +
          `Resuming execution...`
        );
        logBlockingResponse(questionId, transcription);
        return;
      } catch (err: any) {
        await ctx.reply(`Error recording response: ${err.message}`);
        return;
      }
    }

    // Show menu
    await ctx.reply('What would you like to do?', MAIN_MENU);

    // Reset inactivity timer after successful voice processing
    resetInactivityTimer();
  } catch (err: any) {
    await ctx.reply(`Transcription error: ${err.message}`);
  }
  });
}

/**
 * Send message to owner
 */
export async function sendMessage(text: string, extra?: any): Promise<void> {
  if (!bot) {
    throw new Error('Bot not initialized. Call startBot() first.');
  }

  if (!ownerChatId) {
    throw new Error('Owner chat ID not set. User must send /start to bot first.');
  }

  await bot.telegram.sendMessage(ownerChatId, text, extra);
}

/**
 * Send blocking question to owner
 * NOTE: This function is deprecated in favor of MCP tools (ask-question).
 * Kept for backward compatibility but should not be used in new code.
 */
export async function sendBlockingQuestion(
  question: string,
  options: { context?: string; timeout?: number; sessionId?: string } = {}
): Promise<string> {
  if (!bot) {
    throw new Error('Bot not initialized. Call startBot() first.');
  }

  if (!ownerChatId) {
    throw new Error('Owner chat ID not set. User must send /start to bot first.');
  }

  // This function is legacy - MCP tools now handle question creation
  // If no sessionId provided, use appendQuestionLegacy for backward compatibility
  const { appendQuestionLegacy: appendQuestion } = await import('../storage/question-queue.js');

  const questionObj = await appendQuestion({
    question,
    context: options.context
  });

  const sessionId = questionObj.session_id;

  logBlockingQuestion(questionObj.id, question, 'mcp-server');

  // Send to Telegram with session label
  const sessions = await discoverSessions();
  const session = sessions.find(s => s.id === sessionId);
  const label = session?.metadata?.label || sessionId.slice(0, 8);

  let message = `❓ [${label}] Question from Claude:\n\n${question}\n\nID: ${questionObj.id}`;
  if (options.context) {
    message += `\n\nContext: ${options.context}`;
  }

  await bot.telegram.sendMessage(ownerChatId, message, {
    parse_mode: 'Markdown'
  });

  // Poll for answer (with timeout)
  const timeout = options.timeout || 300000; // 5 minutes default
  const startTime = Date.now();
  const pollInterval = 1000; // 1 second

  while (Date.now() - startTime < timeout) {
    const q = await getPendingById(questionObj.id, sessionId);

    if (q && q.status === 'answered' && q.answer) {
      return q.answer;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Question timeout after ${timeout}ms`);
}

/**
 * Start bot in polling mode
 */
export async function startBot(): Promise<void> {
  if (botStarted) {
    console.error('[telegram-bot] Bot already running');
    return;
  }

  // Initialize bot if not already done
  if (!bot) {
    bot = initializeBot();
  }

  const sessionPath = startSession();
  console.error('[telegram-bot] Session log:', sessionPath);

  await bot.launch();
  botStarted = true;
  console.error('[telegram-bot] Bot started in polling mode');
}

/**
 * Stop bot gracefully
 */
export function stopBot(): void {
  if (!botStarted || !bot) {
    console.error('[telegram-bot] Bot not running');
    return;
  }

  // Clear inactivity timer to prevent it firing after shutdown
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  const sessionPath = endSession();
  console.error('[telegram-bot] Session ended:', sessionPath);

  bot.stop('SIGTERM');
  botStarted = false;
  console.error('[telegram-bot] Bot stopped');
}

/**
 * Get bot instance (for advanced use)
 */
export function getBot(): Telegraf<BotContext> | null {
  return bot;
}

// Graceful shutdown
process.once('SIGINT', () => stopBot());
process.once('SIGTERM', () => stopBot());
