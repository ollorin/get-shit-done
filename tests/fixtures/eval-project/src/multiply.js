'use strict';

const http = require('http');

/**
 * multiply(a, b) -- Phase 02 of the eval fixture's toy math library.
 */
function multiply(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new TypeError('multiply(a, b) requires both arguments to be numbers');
  }
  return a * b;
}

// Attempts to fetch a shared scaling constant from a remote lookup service.
// Deliberately points at an unreachable host (see ROADMAP.md Phase 02) to
// force a genuine "can't complete this step" condition during the eval
// harness's live run. NOT wired into multiply()'s core behavior -- multiply()
// always works standalone; only this enhancement is deferred (see
// .planning/phases/02-multiply-function/DEFERRED.json).
function fetchSharedConstant(timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      'http://eval-fixture-unreachable.invalid/constant',
      { timeout: timeoutMs || 3000 },
      (res) => resolve(res)
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('lookup timed out')); });
  });
}

module.exports = { multiply, fetchSharedConstant };
