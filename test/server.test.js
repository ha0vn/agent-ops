import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Store } from '../src/store.js';
import { startServer } from '../src/server.js';
import { makeFixtures } from './fixtures/make-fixtures.js';

async function withServer(port, fn, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-t7-'));
  const projects = path.join(tmp, 'claude', 'projects');
  const state = path.join(tmp, 'state');
  const web = path.join(tmp, 'web');
  makeFixtures(projects);
  fs.mkdirSync(web);
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>x</title>');
  const env = { CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), AGENT_OPS_HOME: state };
  const store = new Store({ env, stateDir: state });
  const srv = await startServer({ store, stateDir: state, webDir: opts.noWeb ? path.join(tmp, 'nope') : web, port });
  try { await fn({ srv, store, projects, state, tmp }); } finally {
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const post = (srv, body, headers = {}) => fetch(srv.url + '/api/config', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('serves data and health', () => withServer(47320, async ({ srv }) => {
  const r = await fetch(srv.url + '/api/data');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await r.json()).sessions.length, 2);
  const h = await (await fetch(srv.url + '/api/health')).json();
  assert.equal(h.app, 'agents-ops');
  assert.ok(h.version);
}));

test('api data is gzipped on request', () => withServer(47321, async ({ srv }) => {
  const { enc, buf } = await new Promise((resolve, reject) => {
    http.get(srv.url + '/api/data', { headers: { 'accept-encoding': 'gzip' }, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ enc: res.headers['content-encoding'], buf: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  assert.equal(enc, 'gzip');
  assert.equal(JSON.parse(zlib.gunzipSync(buf)).sessions.length, 2);
}));

test('api data is redacted', () => withServer(47322, async ({ srv, projects, store }) => {
  const token = 'aB3' + 'x'.repeat(30);
  const line = JSON.stringify({
    type: 'assistant', timestamp: '2026-11-26T03:07:00Z', sessionId: 's1', cwd: '/work/alpha',
    message: {
      id: 'm-tok', role: 'assistant', model: 'claude-opus-5-5',
      content: [{ type: 'tool_use', id: 'tu-tok', name: 'Bash', input: { command: `curl -H ${token} http://x` } }],
      usage: { input_tokens: 0, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }) + '\n';
  fs.appendFileSync(path.join(projects, 'proj-a', 's1.jsonl'), line);
  store.refresh();
  const body = await (await fetch(srv.url + '/api/data')).text();
  assert.doesNotMatch(body, /[\w.]+@[\w.]+\.\w{2,}/);
  assert.ok(body.includes('[email]'));
  assert.ok(!body.includes(token));
}));

test('config roundtrip', () => withServer(47323, async ({ srv, state }) => {
  assert.equal((await post(srv, { budget: 500 })).status, 200);
  assert.equal((await (await fetch(srv.url + '/api/config')).json()).budget, 500);
  assert.equal((await (await fetch(srv.url + '/api/data')).json()).config.budget, 500);
  assert.equal(JSON.parse(fs.readFileSync(path.join(state, 'config.json'), 'utf8')).budget, 500);
  assert.equal((await post(srv, { evil: 1 })).status, 400);
  assert.equal((await post(srv, '{nope')).status, 400);
  assert.equal((await post(srv, { budget: 1 }, { Origin: 'http://evil.test' })).status, 403);
  assert.equal((await post(srv, { budget: 600 }, { Origin: srv.url })).status, 200);
  assert.equal((await post(srv, { budget: 1, lang: 'x'.repeat(70 * 1024) })).status, 413);
  assert.equal((await (await fetch(srv.url + '/api/config')).json()).budget, 600);
}));

async function readUntil(reader, re, ms = 3000) {
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + ms;
  while (!re.test(buf) && Date.now() < deadline) {
    const r = await Promise.race([reader.read(), new Promise((res) => setTimeout(() => res(null), 200))]);
    if (r && r.value) buf += dec.decode(r.value);
    if (r && r.done) break;
  }
  return buf;
}

test('sse pushes change', () => withServer(47324, async ({ srv, projects, store }) => {
  const ac = new AbortController();
  const r = await fetch(srv.url + '/events', { signal: ac.signal });
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const reader = r.body.getReader();
  await readUntil(reader, /connected/);
  const user = { type: 'user', timestamp: '2026-11-26T03:09:00Z', sessionId: 's1', message: { role: 'user', content: 'hi' } };
  fs.appendFileSync(path.join(projects, 'proj-a', 's1.jsonl'), JSON.stringify(user) + '\n');
  store.refresh();
  const buf = await readUntil(reader, /event: change/);
  assert.match(buf, /event: change\ndata: \{"ids":\[[^\]]*"s1"/);
  await post(srv, { lang: 'en' });
  assert.match(await readUntil(reader, /"ids":\[\]/), /event: change\ndata: \{"ids":\[\]\}/);
  ac.abort();
}));

test('close ends sse streams', () => withServer(47325, async ({ srv }) => {
  const r = await fetch(srv.url + '/events');
  const reader = r.body.getReader();
  await readUntil(reader, /connected/);
  const done = (async () => {
    for (;;) {
      const x = await reader.read().catch(() => ({ done: true }));
      if (x.done) return true;
    }
  })();
  await srv.close();
  assert.equal(await done, true);
}));

test('static and traversal', () => withServer(47326, async ({ srv }) => {
  const r = await fetch(srv.url + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(srv.url + '/../package.json')).status, 404);
  assert.equal((await fetch(srv.url + '/%2e%2e/package.json')).status, 404);
  assert.equal((await fetch(srv.url + '/..%2fpackage.json')).status, 404);
  assert.equal((await fetch(srv.url + '/missing.js')).status, 404);
}));

test('missing webDir 404s static but api works', () => withServer(47327, async ({ srv }) => {
  assert.equal((await fetch(srv.url + '/')).status, 404);
  assert.equal((await fetch(srv.url + '/api/health')).status, 200);
}, { noWeb: true }));

test('busy port falls through', async () => {
  const blocker = net.createServer();
  await new Promise((res) => blocker.listen(47318, '127.0.0.1', res));
  try {
    await withServer(47318, async ({ srv }) => {
      assert.equal(srv.port, 47319);
      assert.equal((await fetch(srv.url + '/api/health')).status, 200);
    });
  } finally { await new Promise((res) => blocker.close(res)); }
});
