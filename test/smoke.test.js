import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package.json basics', () => {
  assert.equal(pkg.name, 'agent-ops');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.bin['agent-ops'], 'bin/agent-ops.js');
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
});
