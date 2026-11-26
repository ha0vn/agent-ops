import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { watch } from '../src/watcher.js';
import { makeFixtures } from './fixtures/make-fixtures.js';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-watch-'));
  const root = path.join(tmp, 'projects');
  makeFixtures(root);
  const store = new Store({ env: { CLAUDE_CONFIG_DIR: tmp }, stateDir: path.join(tmp, 'state') });
  store.refresh();
  return { tmp, root, store };
}

test('detects appended lines', async () => {
  const { tmp, root, store } = setup();
  const stop = watch(store, { roots: [root], intervalMs: 500, debounceMs: 50 });
  try {
    const got = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no change within 3s')), 3000);
      store.on('change', (ids) => { if (ids.includes('s1')) { clearTimeout(t); resolve(ids); } });
    });
    fs.appendFileSync(path.join(root, 'proj-a', 's1.jsonl'),
      JSON.stringify({ type: 'user', timestamp: '2026-11-26T03:30:00Z', sessionId: 's1', message: { role: 'user', content: 'more' } }) + '\n');
    assert.ok((await got).includes('s1'));
  } finally {
    stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing root falls back to polling without throwing; stop is idempotent', () => {
  const { tmp, store } = setup();
  const stop = watch(store, { roots: [path.join(tmp, 'nope')], intervalMs: 50 });
  stop();
  stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});
