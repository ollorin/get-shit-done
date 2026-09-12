'use strict';

/**
 * add(a, b) -- Phase 01 of the eval fixture's toy math library.
 */
function add(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new TypeError('add(a, b) requires both arguments to be numbers');
  }
  return a + b;
}

module.exports = { add };
