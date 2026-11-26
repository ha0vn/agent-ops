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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = JSON.stringify({ type: 'user', timestamp: '2026-11-26T03:30:00Z', sessionId: 's1', message: { role: 'user', content: 'x' } }) + '\n';

test('fs.watch alone triggers change (polling disabled)', async () => {
  const { tmp, root, store } = setup();
  const stop = watch(store, { roots: [root], intervalMs: 60000, debounceMs: 50 });
  try {
    const got = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no change within 3s')), 3000);
      store.on('change', (ids) => { if (ids.includes('s1')) { clearTimeout(t); resolve(); } });
    });
    fs.appendFileSync(path.join(root, 'proj-a', 's1.jsonl'), line);
    await got;
  } finally { stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('rapid appends coalesce into one refresh', async () => {
  const { tmp, root } = setup();
  let calls = 0;
  const stop = watch({ refresh() { calls++; return []; } }, { roots: [root], intervalMs: 60000, debounceMs: 150 });
  try {
    for (let i = 0; i < 5; i++) { fs.appendFileSync(path.join(root, 'proj-a', 's1.jsonl'), line); await sleep(10); }
    await sleep(600);
    assert.equal(calls, 1);
  } finally { stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('non-JSON files do not trigger refresh', async () => {
  const { tmp, root } = setup();
  let calls = 0;
  const stop = watch({ refresh() { calls++; return []; } }, { roots: [root], intervalMs: 60000, debounceMs: 50 });
  try {
    fs.writeFileSync(path.join(root, 'proj-a', 'notes.txt'), 'hi');
    await sleep(400);
    assert.equal(calls, 0);
  } finally { stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('refresh errors are reported and do not stick the guard', async () => {
  const { tmp, root } = setup();
  let calls = 0;
  const errs = [];
  const stop = watch({ refresh() { calls++; if (calls === 1) throw new Error('boom'); return []; } },
    { roots: [root], intervalMs: 50, debounceMs: 20, onError: (e) => errs.push(e.message) });
  try {
    await sleep(400);
    assert.ok(calls >= 2, `calls=${calls}`);
    assert.deepEqual(errs, ['boom']);
  } finally { stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('stop with a pending debounce prevents further refresh', async () => {
  const { tmp, root } = setup();
  let calls = 0;
  const stop = watch({ refresh() { calls++; return []; } }, { roots: [root], intervalMs: 60000, debounceMs: 200 });
  try {
    fs.appendFileSync(path.join(root, 'proj-a', 's1.jsonl'), line);
    await sleep(60);
    stop();
    await sleep(400);
    assert.equal(calls, 0);
  } finally { stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('missing root still polls', async () => {
  const { tmp } = setup();
  let calls = 0;
  const stop = watch({ refresh() { calls++; return []; } }, { roots: [path.join(tmp, 'nope')], intervalMs: 50 });
  try {
    await sleep(300);
    assert.ok(calls >= 2, `calls=${calls}`);
  } finally { stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
