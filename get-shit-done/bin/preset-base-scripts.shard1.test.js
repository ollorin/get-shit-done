'use strict';

// Shard 1 of 2 of preset-base-scripts.test.js (see tests/helpers/shard.js): the top-level suites of that file spread over two processes.
require('../../tests/helpers/shard.js')(require.resolve('./preset-base-scripts.test.js'), 0, 2);
