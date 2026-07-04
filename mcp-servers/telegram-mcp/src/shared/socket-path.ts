/**
 * Project-scoped Unix socket path computation.
 *
 * Each project gets its own socket file in /tmp/ based on a short hash of the
 * project root path. This prevents collision when multiple GSD projects are
 * open simultaneously on the same machine.
 *
 * Socket path format: /tmp/telegram-mcp-{HASH}.sock
 * where HASH = first 8 hex characters of SHA-1(projectRoot)
 *
 * Usage:
 *   import { getSocketPath } from './shared/socket-path.js';
 *   const socketPath = getSocketPath(); // uses PROJECT_ROOT env or process.cwd()
 *   const socketPath = getSocketPath('/path/to/project'); // explicit root
 */

import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

/**
 * Compute the Unix socket path for the Telegram MCP daemon.
 *
 * @param projectRoot Optional explicit project root path.
 *   If omitted, falls back to process.env.PROJECT_ROOT, then process.cwd().
 * @returns Absolute path to the socket file, e.g. '/tmp/telegram-mcp-a1b2c3d4.sock'
 */
export function getSocketPath(projectRoot?: string): string {
  const root = projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 8);
  return `/tmp/telegram-mcp-${hash}.sock`;
}

/**
 * Compute the project-scoped path for question-state JSONL persistence.
 * Mirrors getSocketPath()'s SHA1-hash scheme so each project's daemon persists
 * its own question state independently -- no cross-project collision.
 * NOTE: changing this only affects daemons started AFTER the change; an
 * already-running daemon keeps using the path it computed at its own startup.
 *
 * @param projectRoot Optional explicit project root path.
 *   If omitted, falls back to process.env.PROJECT_ROOT, then process.cwd().
 * @returns Absolute path to the state file, e.g.
 *   '~/.claude/knowledge/question-state-a1b2c3d4.jsonl'
 */
export function getStateFilePath(projectRoot?: string): string {
  const root = projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 8);
  return path.join(os.homedir(), '.claude', 'knowledge', `question-state-${hash}.jsonl`);
}
