/**
 * Tests for QuestionService.restoreState() orphan-handling determinism.
 *
 * SAFETY: QuestionService.saveState() writes unconditionally to the real
 * production path (os.homedir()/.claude/knowledge/question-state.jsonl) --
 * there is no constructor override for this path. Every test in this file
 * mocks fs.writeFileSync for its entire duration so NO test ever touches the
 * real production state file, regardless of how many times ask()/restoreState()
 * internally call saveState(). Never remove this mock.
 *
 * All QuestionService instances here are constructed directly with fake,
 * injected createForumTopic/sendToThread/sendToGroup spy functions -- never a
 * real Telegraf bot, never a real network call, never the production socket.
 */

import { describe, test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { QuestionService } from './question-service.js';
import { SessionService } from './session-service.js';
import type { Question } from '../shared/types.js';

let writeFileSyncMock: ReturnType<typeof mock.method>;

before(() => {
  // Prevent ANY test in this file from writing to the real
  // ~/.claude/knowledge/question-state.jsonl production file.
  writeFileSyncMock = mock.method(fs, 'writeFileSync', () => {});
});

after(() => {
  writeFileSyncMock.mock.restore();
});

/** Build a set of fake, spy-recording createForumTopic/sendToThread/sendToGroup functions. */
function makeFakeBot(nextThreadId: number) {
  const sendToThreadCalls: Array<{ threadId: number; text: string }> = [];
  const sendToGroupCalls: Array<{ text: string }> = [];

  return {
    createForumTopic: mock.fn(async (_title: string): Promise<number> => nextThreadId),
    sendToThread: mock.fn(async (threadId: number, text: string): Promise<void> => {
      sendToThreadCalls.push({ threadId, text });
    }),
    sendToGroup: mock.fn(async (text: string): Promise<void> => {
      sendToGroupCalls.push({ text });
    }),
    sendToThreadCalls,
    sendToGroupCalls,
  };
}

/** Build a minimal saved Question record for direct restoreState() testing. */
function makeSavedQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-' + Math.random().toString(36).slice(2),
    sessionId: 's1',
    title: 'Test question title',
    body: 'Full test question body',
    createdAt: new Date().toISOString(),
    timeoutMinutes: 30,
    ...overrides,
  };
}

describe('QuestionService.restoreState() - orphan-handling determinism', () => {
  test('already-expired restored pending question is notified with the timed-out message, dropped, and replies return false', async () => {
    const bot = makeFakeBot(100);
    const sessionService = new SessionService();
    const qs = new QuestionService(bot.createForumTopic, bot.sendToThread, bot.sendToGroup, sessionService);

    // createdAt 40 minutes ago, timeoutMinutes 30 -- already expired
    const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const staleQuestion = makeSavedQuestion({
      id: 'q-stale',
      threadId: 111,
      createdAt: fortyMinutesAgo,
      timeoutMinutes: 30,
      title: 'Stale question',
    });

    qs.restoreState([staleQuestion]);

    // Allow the fire-and-forget notification promise to settle
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(bot.sendToThreadCalls.length, 1);
    assert.equal(bot.sendToThreadCalls[0]?.threadId, 111);
    assert.match(bot.sendToThreadCalls[0]?.text ?? '', /timed out after 30 minutes/);
    assert.match(bot.sendToThreadCalls[0]?.text ?? '', /daemon was restarted/);

    // Not restored into live state
    assert.deepEqual(qs.getPendingQuestions(), []);

    // A reply on the old thread cannot be delivered
    assert.equal(qs.deliverAnswer(111, 'a late reply'), false);
  });

  test('NOT-yet-expired restored pending question is still dropped (core regression case) and notified with the distinct orphan message', async () => {
    const bot = makeFakeBot(200);
    const sessionService = new SessionService();
    const qs = new QuestionService(bot.createForumTopic, bot.sendToThread, bot.sendToGroup, sessionService);

    // createdAt = now, timeoutMinutes = 30 -- expiresAt is ~30 minutes in the future
    const freshQuestion = makeSavedQuestion({
      id: 'q-fresh',
      threadId: 222,
      createdAt: new Date().toISOString(),
      timeoutMinutes: 30,
      title: 'Fresh, not-yet-expired question',
    });

    qs.restoreState([freshQuestion]);

    await new Promise((resolve) => setImmediate(resolve));

    // This is the bug being fixed: today this silently zombies (restored with
    // no timer/listener). Assert it does NOT -- it must be notified and dropped
    // exactly like the stale case, just with different wording.
    assert.equal(bot.sendToThreadCalls.length, 1);
    assert.equal(bot.sendToThreadCalls[0]?.threadId, 222);
    assert.match(bot.sendToThreadCalls[0]?.text ?? '', /cannot be resumed after a daemon restart/);
    assert.doesNotMatch(bot.sendToThreadCalls[0]?.text ?? '', /timed out after/);

    // Never re-enters live state -- no timer, no listener, no zombie
    assert.deepEqual(qs.getPendingQuestions(), []);
  });

  test('a reply arriving on an orphaned thread returns false and does not throw', async () => {
    const bot = makeFakeBot(300);
    const sessionService = new SessionService();
    const qs = new QuestionService(bot.createForumTopic, bot.sendToThread, bot.sendToGroup, sessionService);

    const freshQuestion = makeSavedQuestion({
      id: 'q-orphan',
      threadId: 333,
      createdAt: new Date().toISOString(),
      timeoutMinutes: 30,
    });

    qs.restoreState([freshQuestion]);
    await new Promise((resolve) => setImmediate(resolve));

    let result: boolean | undefined;
    assert.doesNotThrow(() => {
      result = qs.deliverAnswer(333, 'some late answer');
    });
    assert.equal(result, false);
  });

  test('answered questions in the saved state are skipped entirely on restore (regression - unchanged behavior)', async () => {
    const bot = makeFakeBot(400);
    const sessionService = new SessionService();
    const qs = new QuestionService(bot.createForumTopic, bot.sendToThread, bot.sendToGroup, sessionService);

    const answeredQuestion = makeSavedQuestion({
      id: 'q-answered',
      threadId: 444,
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      timeoutMinutes: 30,
      answer: 'yes, already answered',
      answeredAt: new Date().toISOString(),
    });

    qs.restoreState([answeredQuestion]);
    await new Promise((resolve) => setImmediate(resolve));

    // No notification sent for an already-answered question
    assert.equal(bot.sendToThreadCalls.length, 0);
    assert.equal(bot.sendToGroupCalls.length, 0);

    assert.deepEqual(qs.getPendingQuestions(), []);

    // Not tracked as orphaned either (it was never dropped-as-pending) -- a
    // reply here falls through to the generic "no pending question" path,
    // still returning false either way.
    assert.equal(qs.deliverAnswer(444, 'stray reply'), false);
  });

  test('a fresh restore with zero saved questions restores cleanly with no errors and an empty pending-questions list', () => {
    const bot = makeFakeBot(500);
    const sessionService = new SessionService();
    const qs = new QuestionService(bot.createForumTopic, bot.sendToThread, bot.sendToGroup, sessionService);

    assert.doesNotThrow(() => {
      qs.restoreState([]);
    });

    assert.deepEqual(qs.getPendingQuestions(), []);
    assert.equal(bot.sendToThreadCalls.length, 0);
    assert.equal(bot.sendToGroupCalls.length, 0);
  });
});

describe('QuestionService.restoreState() - realistic crash-simulation pattern', () => {
  test('a question in-flight when the daemon "crashes" is orphaned deterministically by a second, fresh instance', async () => {
    const firstBot = makeFakeBot(999);
    const firstSessionService = new SessionService();
    const qs1 = new QuestionService(
      firstBot.createForumTopic,
      firstBot.sendToThread,
      firstBot.sendToGroup,
      firstSessionService
    );

    const session = firstSessionService.register('fake-client-1', 'fake-test-root');

    // Fake out the 30-minute internal ask() timer so this test never waits in
    // real wall-clock time and never leaves a real dangling setTimeout behind
    // that would keep the process alive.
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      // Call ask() WITHOUT awaiting -- it blocks pending an answer/timeout.
      const askPromise = qs1.ask(session.id, 'Will it rain tomorrow?', 'some context', 30);
      askPromise.catch(() => {
        // Never resolved/rejected in this test (fake timer never fires) --
        // this handler only exists to prevent an unhandled-rejection warning
        // in case future changes alter that behavior.
      });

      // Let the async chain progress past thread creation + question posting
      // (both fakes resolve on the microtask queue) before "crashing".
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      const sessionQuestions = qs1.getSessionQuestions(session.id);
      assert.equal(sessionQuestions.length, 1);
      assert.equal(sessionQuestions[0]?.threadId, 999);
      assert.equal(sessionQuestions[0]?.answer, undefined);

      // Capture the in-memory shape, mirroring exactly what saveState() would
      // have written to disk right before the "crash".
      const savedQuestion: Question = JSON.parse(JSON.stringify(sessionQuestions[0]));
      assert.equal(savedQuestion.timeoutMinutes, 30);

      // Construct a SECOND, fresh QuestionService instance (simulating the
      // new post-crash daemon process) and restore from the captured state.
      const secondBot = makeFakeBot(999);
      const secondSessionService = new SessionService();
      const qs2 = new QuestionService(
        secondBot.createForumTopic,
        secondBot.sendToThread,
        secondBot.sendToGroup,
        secondSessionService
      );

      qs2.restoreState([savedQuestion]);
      await new Promise((resolve) => setImmediate(resolve));

      // Orphaned deterministically -- notified, dropped, never a live zombie.
      assert.equal(secondBot.sendToThreadCalls.length, 1);
      assert.equal(secondBot.sendToThreadCalls[0]?.threadId, 999);
      assert.match(secondBot.sendToThreadCalls[0]?.text ?? '', /cannot be resumed after a daemon restart/);

      assert.deepEqual(qs2.getPendingQuestions(), []);
      assert.equal(qs2.deliverAnswer(999, 'a reply arriving after the crash'), false);
    } finally {
      mock.timers.reset();
    }
  });
});
