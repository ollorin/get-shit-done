#!/usr/bin/env node
/**
 * GSD UI-QA forbid hook: denies logical ops for a runner's own child sessions. Installed with the other hooks but never
 * registered by GSD; a runner attaches it per session with `claude --settings '<json>'` (docs/ui-qa-driver-gaps.md).
 *
 * Env: GSD_UI_QA_FORBIDDEN_OPS = comma list of logical ops (unset or empty: no-op, exit 0).
 *      GSD_UI_QA_DRIVER        = adapter name; else the MCP tier of <cwd>/.planning/config.json stack.capabilities.ui_qa.
 * A PreToolUse call whose tool starts with the driver's tool_prefix is resolved with opsOf; exit 2 when any op is
 * forbidden or `unknown` (a call the ops map cannot place). Every other call exits 0. With a non-empty list the hook fails
 * closed on a payload or contract it cannot read, and on a listed name that is not an op of the contract (a typo would allow).
 */

'use strict';

const path = require('path');
const uiQaDriver = require('../ui-qa-driver.js');

const parseList = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter((s) => s !== '') : []);
const deny = (message) => ({ exitCode: 2, stderr: `[gsd-ui-qa-forbid] ${message}` });
const ALLOW = { exitCode: 0 };

function loadContract(env, cwd) {
  const driver = env.GSD_UI_QA_DRIVER;
  if (typeof driver === 'string' && driver !== '') return uiQaDriver.resolveContract({ driver });
  return uiQaDriver.resolveMcpTier(uiQaDriver.readUiQa(path.resolve(cwd)));
}

function evaluate(input, env = process.env, cwd = process.cwd()) {
  const forbidden = parseList(env.GSD_UI_QA_FORBIDDEN_OPS);
  if (forbidden.length === 0) return ALLOW;
  const tool = input && typeof input.tool_name === 'string' ? input.tool_name : '';
  let contract;
  try {
    contract = loadContract(env, cwd);
  } catch (e) {
    return tool.startsWith('mcp__') ? deny(`no readable UI QA contract (${e.message}); denying ${tool} while ops are forbidden`) : ALLOW;
  }
  if (!contract || contract.kind === 'command' || typeof contract.tool_prefix !== 'string' || contract.tool_prefix === '') return ALLOW;
  if (!tool.startsWith(contract.tool_prefix)) return ALLOW;
  const missing = forbidden.filter((op) => contract.ops[op] === undefined);
  if (missing.length > 0) return deny(`GSD_UI_QA_FORBIDDEN_OPS names ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not an op of driver "${contract.driver}"`);
  const ops = uiQaDriver.opsOf(contract, tool, input.tool_input);
  const hit = ops.filter((op) => op === uiQaDriver.UNKNOWN_OP || forbidden.includes(op));
  if (hit.length === 0) return ALLOW;
  return deny(`${tool} is denied: it performs ${hit.join(', ')} (${hit.includes(uiQaDriver.UNKNOWN_OP) ? 'a call shape the ops map cannot place is treated as forbidden' : 'forbidden for this session'}; forbidden ops: ${forbidden.join(', ')})`);
}

function main() {
  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    if (parseList(process.env.GSD_UI_QA_FORBIDDEN_OPS).length === 0) process.exit(0);
    let result;
    try {
      result = evaluate(JSON.parse(raw));
    } catch (e) {
      result = deny(`unreadable hook payload (${e.message}); denying while ops are forbidden`);
    }
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.exit(result.exitCode);
  });
}

module.exports = { evaluate, parseList };

if (require.main === module) main();
