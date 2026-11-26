process.env.TZ = 'Asia/Ho_Chi_Minh';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { claudeProjectsDir, stateDir } from '../src/paths.js';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../src/config.js';
import { redact, shortCommand } from '../src/redact.js';
import { DEFAULT_PRICES, costOf } from '../src/pricing.js';
import { dayKey } from '../src/time.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ao-utils-'));

test('paths honour env overrides', () => {
  assert.equal(claudeProjectsDir({ CLAUDE_CONFIG_DIR: '/x' }), path.join('/x', 'projects'));
  assert.equal(claudeProjectsDir({}), path.join(os.homedir(), '.claude', 'projects'));
  assert.equal(stateDir({ AGENT_OPS_HOME: '/y' }), '/y');
  assert.equal(stateDir({}), path.join(os.homedir(), '.agent-ops'));
});

test('config defaults, merge and corrupt file', () => {
  const tmp = tmpDir();
  try {
    assert.deepEqual(loadConfig(tmp), DEFAULT_CONFIG);
    const c = loadConfig(tmp); c.prices['claude-opus-5-5'].in = 99;
    assert.equal(DEFAULT_PRICES['claude-opus-5-5'].in, 4);
    saveConfig(tmp, { prices: { 'claude-opus-5-5': { in: 5 } } });
    assert.deepEqual(loadConfig(tmp).prices['claude-opus-5-5'], { in: 5, out: 20, cw: 8, cr: 0.2 });
    fs.writeFileSync(path.join(tmp, 'config.json'), '{bad');
    assert.deepEqual(loadConfig(tmp), DEFAULT_CONFIG);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('redact', () => {
  const r = redact('mail a.b@c.vn and sk-ABCdef1234567890xyz and eyJhbGciOiJIUzI1NiJ9.x');
  assert.ok(!r.includes('@c.vn') && !r.includes('sk-ABC') && !r.includes('eyJhbG'));
  assert.equal(redact('mcp__playwright__browser_take_screenshot'), 'mcp__playwright__browser_take_screenshot');
  const s = '2026-11-26-consolidator-tenant-self-scope-design';
  assert.equal(redact(s), s);
});

test('shortCommand', () => {
  assert.equal(shortCommand('cd /d/repo && dotnet test --filter X'), 'dotnet test --filter X');
  assert.equal(shortCommand('FOO=1\nnpm run build'), 'npm run build');
  const s = shortCommand('x'.repeat(100));
  assert.equal(s.length, 64);
  assert.ok(s.endsWith('…'));
});

test('costOf', () => {
  const u = { in: 1e6, out: 1e6, cw: 1e6, cr: 1e6 };
  assert.equal(costOf('claude-opus-5-5', u, DEFAULT_PRICES), 32.2);
  assert.equal(costOf('claude-haiku-5-5', u, DEFAULT_PRICES), null);
});

test('dayKey uses local time', () => {
  assert.equal(dayKey(Date.parse('2026-11-25T18:30:00Z')), '2026-11-26');
});
