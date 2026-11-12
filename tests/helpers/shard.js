'use strict';

// Runs one shard of a test file: node --test runs files in parallel and the suites of one file in sequence,
// so a long file is listed as N wrapper files, each loading it with the top-level suites of its shard only.
// Top-level suite k (in source order) belongs to shard k mod N; every suite runs in exactly one shard, unchanged.
// The wrapper must call this before anything else loads node:test bindings from the target file.

const nodeTest = require('node:test');

module.exports = function runShard(file, index, count) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= count) throw new Error(`shard ${index} of ${count} is not valid`);
  const state = { depth: 0, seen: 0, kept: 0 };
  const sharded = (original) => {
    const wrapped = (...args) => {
      if (state.depth > 0) return original(...args);
      const mine = state.seen++ % count === index;
      if (!mine) return undefined;
      state.kept++;
      const at = args.findIndex((a) => typeof a === 'function');
      if (at < 0) return original(...args);
      const body = args[at];
      const tracked = function trackedSuite(...inner) {
        state.depth++;
        try {
          return body.apply(this, inner);
        } finally {
          state.depth--;
        }
      };
      return original(...args.slice(0, at), tracked, ...args.slice(at + 1));
    };
    return Object.assign(wrapped, original);
  };
  const saved = { describe: nodeTest.describe, suite: nodeTest.suite, test: nodeTest.test, it: nodeTest.it };
  nodeTest.describe = sharded(saved.describe);
  if (saved.suite) nodeTest.suite = nodeTest.describe;
  // A top-level test counts as a unit too; a test inside a kept suite is registered as written.
  const topLevelTest = (original) => Object.assign((...args) => {
    if (state.depth > 0) return original(...args);
    if (state.seen++ % count !== index) return undefined;
    state.kept++;
    return original(...args);
  }, original);
  nodeTest.test = topLevelTest(saved.test);
  nodeTest.it = topLevelTest(saved.it);
  try {
    require(file);
  } finally {
    Object.assign(nodeTest, saved);
  }
  // A file whose suites all landed elsewhere would report zero tests and pass: refuse that.
  if (state.kept === 0) throw new Error(`shard ${index} of ${count} of ${file} holds no suite (${state.seen} top-level units)`);
  return state;
};
