import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixtures } from './fixtures/make-fixtures.js';

const bin = fileURLToPath(new URL('../bin/agent-ops.js', import.meta.url));

function run(env, port) {
  const child = spawn(process.execPath, [bin, '--no-open', '--port', String(port)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  return { child, out: () => out };
}
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test('prints url and serves; second launch reuses instance', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-cli-'));
  makeFixtures(path.join(tmp, 'claude', 'projects'));
  const env = { AGENT_OPS_HOME: path.join(tmp, 'home'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude') };
  const port = 43000 + Math.floor(Math.random() * 2000);
  const a = run(env, port);
  let b;
  try {
    assert.ok(await until(() => /http:\/\/127\.0\.0\.1:\d+/.test(a.out())), 'no url printed');
    const url = a.out().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const h = await (await fetch(url + '/api/health')).json();
    assert.equal(h.app, 'agents-ops');
    const t0 = Date.now();
    b = run(env, new URL(url).port);
    const code = await new Promise((res) => b.child.on('exit', res));
    assert.equal(code, 0);
    assert.ok(Date.now() - t0 < 2000);
    assert.match(b.out(), /already running/);
  } finally {
    a.child.kill(); b?.child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('second launch finds an instance that fell forward to port+1', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-cli2-'));
  makeFixtures(path.join(tmp, 'claude', 'projects'));
  const env = { AGENT_OPS_HOME: path.join(tmp, 'home'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude') };
  const port = 45000 + Math.floor(Math.random() * 2000);
  const dummy = http.createServer((_, res) => res.end('nope'));
  await new Promise((r) => dummy.listen(port, '127.0.0.1', r));
  const a = run(env, port);
  let b;
  try {
    assert.ok(await until(() => /http:\/\/127\.0\.0\.1:\d+/.test(a.out())), 'no url printed');
    assert.ok(a.out().includes(`127.0.0.1:${port + 1}`), a.out());
    b = run(env, port);
    await new Promise((res) => b.child.on('exit', res));
    assert.match(b.out(), new RegExp(`already running: http://127\.0\.0\.1:${port + 1}`));
  } finally {
    a.child.kill(); b?.child.kill(); dummy.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
