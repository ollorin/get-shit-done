/**
 * Tests for getStateFilePath()'s per-project scoping (47-02) and its
 * relationship to the existing getSocketPath().
 *
 * SAFETY: every call here passes an explicit fake project root -- never
 * getStateFilePath()/getSocketPath() with no arguments, which would resolve
 * against process.env.PROJECT_ROOT / process.cwd() and could collide with a
 * real project's socket or state file.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getSocketPath, getStateFilePath } from './socket-path.js';

describe('getStateFilePath() - per-project scoping (47-02)', () => {
  test('different project roots produce different state file paths', () => {
    const pathA = getStateFilePath('/fake/project/a');
    const pathB = getStateFilePath('/fake/project/b');

    assert.notEqual(pathA, pathB);
  });

  test('the same project root produces the identical path on repeated calls (deterministic)', () => {
    const root = '/fake/project/deterministic';
    const first = getStateFilePath(root);
    const second = getStateFilePath(root);

    assert.equal(first, second);
  });

  test('getStateFilePath() never collides with getSocketPath() for the same root', () => {
    const root = '/fake/project/no-collision';
    const statePath = getStateFilePath(root);
    const socketPath = getSocketPath(root);

    assert.notEqual(statePath, socketPath);
  });

  test('returned path is scoped under ~/.claude/knowledge and named question-state-{hash}.jsonl', () => {
    const root = '/fake/project/naming-check';
    const statePath = getStateFilePath(root);

    assert.match(statePath, /\.claude\/knowledge\/question-state-[0-9a-f]{8}\.jsonl$/);
  });
});
