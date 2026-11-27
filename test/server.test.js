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
  assert.equal(h.app, 'agent-ops');
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

const raw = (srv, p, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: srv.port, path: p, agent: false, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject);
  req.end();
});

test('static and traversal', () => withServer(47326, async ({ srv, tmp }) => {
  const r = await fetch(srv.url + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(srv.url + '/missing.js')).status, 404);
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'SENTINEL-SECRET');
  for (const p of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/%2e%2e%5csecret.txt', '/%00', '//secret.txt', '/../secret.txt']) {
    const res = await raw(srv, p);
    assert.ok(res.status === 400 || res.status === 404, p + ' -> ' + res.status);
    assert.ok(!res.body.includes('SENTINEL-SECRET'), p);
  }
}));

test('host header must be loopback', () => withServer(47329, async ({ srv }) => {
  assert.equal((await raw(srv, '/api/health', { Host: 'evil.test' })).status, 403);
  assert.equal((await raw(srv, '/', { Host: 'evil.test:' + srv.port })).status, 403);
  assert.equal((await raw(srv, '/api/health', { Host: 'localhost:' + srv.port })).status, 200);
}));

test('config validation rejects bad values', () => withServer(47330, async ({ srv }) => {
  const bad = [
    { budget: -1 }, { budget: 'x' }, { lang: 'fr' }, { lang: 1 },
    { thresholds: 5 }, { thresholds: { nope: 1 } }, { thresholds: { runMinutes: 'a' } }, { thresholds: { runMinutes: -1 } },
    { prices: [] }, { prices: { m: 3 } }, { prices: { m: { bad: 1 } } }, { prices: { m: { in: -1 } } }, { prices: { m: { in: '2' } } },
  ];
  for (const b of bad) assert.equal((await post(srv, b)).status, 400, JSON.stringify(b));
  for (const s of ['{"budget":1e999}', '{"prices":{"__proto__":{"in":1}}}', '{"thresholds":{"constructor":1}}', '{"prices":{"m":{"prototype":1}}}']) {
    assert.equal((await post(srv, s)).status, 400, s);
  }
  assert.equal((await post(srv, { budget: null })).status, 200);
  const ok = await post(srv, { prices: { 'claude-opus-5-5': { out: 21 } }, thresholds: { runMinutes: 3 }, lang: 'en' });
  assert.equal(ok.status, 200);
  const cfg = await ok.json();
  assert.equal(cfg.prices['claude-opus-5-5'].out, 21);
  assert.equal(cfg.prices['claude-opus-5-5'].in, 4);
}));

test('origin guard covers every non-GET method', () => withServer(47331, async ({ srv }) => {
  const r = await fetch(srv.url + '/api/config', { method: 'PUT', headers: { Origin: 'http://evil.test' }, body: '{}' });
  assert.equal(r.status, 403);
}));

test('oversized content-length gets 413 with connection close', () => withServer(47332, async ({ srv }) => {
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/config', method: 'POST', agent: false, headers: { 'content-length': String(70 * 1024) } }, resolve);
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(res.statusCode, 413);
  assert.equal(res.headers.connection, 'close');
  res.resume();
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

test('html responses carry anti-framing and CSP headers', () => withServer(47340, async ({ srv }) => {
  const r = await fetch(srv.url + '/');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
}));

test('agent meta description is redacted in api data', () => withServer(47341, async ({ srv, projects, store }) => {
  const token = 'aB3' + 'y'.repeat(30);
  const dir = path.join(projects, 'proj-a', 's1', 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: 'assistant', timestamp: '2026-11-26T03:07:00Z', sessionId: 's1', message: { id: 'ma', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 0, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }) + '\n';
  fs.writeFileSync(path.join(dir, 'agent-zz.jsonl'), line);
  fs.writeFileSync(path.join(dir, 'agent-zz.meta.json'), JSON.stringify({ description: `mail bob@example.com ${token}`, agentType: 'general-purpose' }));
  store.refresh();
  const body = await (await fetch(srv.url + '/api/data')).text();
  assert.ok(body.includes('agent-zz') || body.includes('zz'));
  assert.ok(!body.includes('bob@example.com'));
  assert.ok(!body.includes(token));
}));
