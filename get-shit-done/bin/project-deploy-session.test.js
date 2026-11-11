'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { agentAncestor, detectSession, guardFailures } = require('./project-deploy-session.js');

const HUMAN = Object.freeze({ stdin_tty: true, stdout_tty: true, agent_ancestor: false, orphan: false });
const TTY_IO = { stdin: { isTTY: true }, stdout: { isTTY: true } };

const LAUNCHD = '    1     0 launchd launchd\n';
const CLEAN_CHAIN = `  300   200 zsh -zsh\n  200   100 login login -fp user\n  100     1 Terminal /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal\n${LAUNCHD}`;

describe('project deploy session guard (B-FIX1 M5)', () => {
  test('M5 a node process reparented to launchd (ppid 1) is refused as orphan', () => {
    const psOutput = `  300     1 node node /tmp/x.js\n${LAUNCHD}`;
    const session = detectSession({ ...TTY_IO, pid: 300, psOutput });
    assert.strictEqual(session.orphan, true);
    assert.deepStrictEqual(guardFailures({}, session), ['orphan']);
  });

  test('M5 a broken ancestor chain (missing link) is refused', () => {
    const psOutput = `  300   200 zsh zsh\n${LAUNCHD}`;
    assert.strictEqual(agentAncestor(psOutput, 300), true);
  });

  test('M5 a claude-code cli.js ancestor is refused by args', () => {
    const psOutput = `  300   200 zsh zsh\n  200     1 node node /Users/x/claude-code/cli.js\n${LAUNCHD}`;
    assert.strictEqual(agentAncestor(psOutput, 300), true);
  });

  test('M5 CLAUDE_CODE_SESSION_ID alone refuses under the env check', () => {
    assert.deepStrictEqual(guardFailures({ CLAUDE_CODE_SESSION_ID: 'abc' }, HUMAN), ['env']);
  });

  test('M5 a clean zsh->login->Terminal->launchd chain passes all checks', () => {
    const session = detectSession({ ...TTY_IO, pid: 300, psOutput: CLEAN_CHAIN });
    assert.deepStrictEqual(session, { stdin_tty: true, stdout_tty: true, agent_ancestor: false, orphan: false });
    assert.deepStrictEqual(guardFailures({}, session), []);
  });

  test('M5 (B-FIX2 4) an ancestor named claudette is not an agent (exact basename, not prefix)', () => {
    const psOutput = `  300   200 zsh zsh\n  200     1 claudette claudette --x\n${LAUNCHD}`;
    assert.strictEqual(agentAncestor(psOutput, 300), false);
  });

  test('M5 (B-FIX2 4) a tmux process with -s claude-code in its args is not an agent', () => {
    const psOutput = `  300   200 zsh zsh\n  200     1 tmux tmux new -s claude-code\n${LAUNCHD}`;
    assert.strictEqual(agentAncestor(psOutput, 300), false);
  });

  test('M5 (B-FIX2 4) a real @anthropic-ai/claude-code cli.js ancestor is an agent', () => {
    const psOutput = `  300   200 zsh zsh\n  200     1 node node /x/node_modules/@anthropic-ai/claude-code/cli.js\n${LAUNCHD}`;
    assert.strictEqual(agentAncestor(psOutput, 300), true);
  });

  test('M5 (B-FIX2 4) an ancestor whose comm basename is exactly claude is an agent', () => {
    const psOutput = `  300   200 zsh zsh\n  200     1 /usr/local/bin/claude claude\n${LAUNCHD}`;
    assert.strictEqual(agentAncestor(psOutput, 300), true);
  });
});
