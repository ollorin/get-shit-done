'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RULE = path.join(__dirname, '..', 'presets', 'base', 'rules', 'shared-stack.md');

test('WP7 shared-stack rule: the unit lane needs no stack lock and a stack-using unit file moves out of it', () => {
  const text = fs.readFileSync(RULE, 'utf8');
  assert.match(text, /^## Unit lane \(no lock\)$/m);
  const section = text.split(/^## /m).find((s) => s.startsWith('Unit lane (no lock)'));
  assert.match(section, /unit lane/i);
  assert.match(section, /not in `stack\.locked_commands`/);
  assert.match(section, /database, SQL or stack helper/);
  assert.match(section, /moves to the live-stack suite/);
});
