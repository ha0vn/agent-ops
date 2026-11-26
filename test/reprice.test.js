import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { startServer } from '../src/server.js';
import { costOf } from '../src/pricing.js';
import { makeFixtures } from './fixtures/make-fixtures.js';

test('costOf is null unless all four prices are finite numbers', () => {
  const u = { in: 1e6, out: 1e6, cw: 0, cr: 0 };
  assert.equal(costOf('m', u, { m: { in: 1, out: 2 } }), null);
  assert.equal(costOf('m', u, { m: { in: 1, out: 2, cw: NaN, cr: 1 } }), null);
  assert.equal(costOf('m', u, { m: { in: 1, out: 2, cw: 3, cr: 1 } }), 3);
});

test('reprice on config change', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-t11-'));
  const projects = path.join(tmp, 'claude', 'projects'), state = path.join(tmp, 'state'), web = path.join(tmp, 'web');
  makeFixtures(projects);
  fs.mkdirSync(web);
  const env = { CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), AGENT_OPS_HOME: state };
  const store = new Store({ env, stateDir: state });
  const srv = await startServer({ store, stateDir: state, webDir: web, port: 47340 });
  try {
    const get = async () => (await (await fetch(srv.url + '/api/data')).json()).sessions.find((s) => s.id === 's1');
    const before = await get();
    const opus = before.byModel['claude-opus-5-5'];
    assert.ok(opus && opus.in > 0);
    const r = await fetch(srv.url + '/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prices: { 'claude-opus-5-5': { in: 40 } } }) });
    assert.equal(r.status, 200);
    const after = await get();
    assert.ok(Math.abs(after.cost - before.cost - opus.in * (40 - 4) / 1e6) < 1.5e-4, `${before.cost} -> ${after.cost}`);
    assert.ok(Math.abs(after.byModel['claude-opus-5-5'].cost - opus.cost - opus.in * 36 / 1e6) < 1e-9);
  } finally { await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
