process.env.TZ = 'Asia/Ho_Chi_Minh';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCursor, readNew } from '../src/sources/claude-code/reader.js';
import { createAgent, applyRecord, agentSummary } from '../src/sources/claude-code/agent.js';
import { DEFAULT_PRICES } from '../src/pricing.js';
import { makeFixtures } from './fixtures/make-fixtures.js';

let root;
before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-t3-')); makeFixtures(root); });
after(() => fs.rmSync(root, { recursive: true, force: true }));

function load(file) {
  const c = openCursor(file), st = createAgent();
  const { records, bad } = readNew(c);
  for (const r of records) applyRecord(st, r, DEFAULT_PRICES);
  st.bad += bad;
  return agentSummary(st);
}
const s1 = () => load(path.join(root, 'proj-a', 's1.jsonl'));

test('reader keeps partial trailing line', () => {
  const f = path.join(root, 'partial.jsonl');
  fs.writeFileSync(f, '{"a":1}\n{"b":');
  const c = openCursor(f);
  let r = readNew(c);
  assert.deepEqual(r.records, [{ a: 1 }]);
  assert.equal(r.bad, 0);
  fs.appendFileSync(f, '2}\r\n');
  r = readNew(c);
  assert.deepEqual(r.records, [{ b: 2 }]);
  assert.equal(r.bad, 0);
  assert.equal(readNew(c).records.length, 0);
});

test('dedupes usage by message id', () => {
  const s = s1();
  assert.deepEqual(s.tok, { in: 10, out: 150, cw: 1000, cr: 13000 });
  assert.equal(s.turns, 2);
  assert.equal(s.model, 'claude-opus-5-5');
});

test('cost per type', () => {
  const s = s1();
  assert.ok(Math.abs(s.cost - 0.01364) < 1e-9);
  assert.ok(Math.abs(s.costByType.cr - 0.0026) < 1e-9);
  assert.equal(Object.values(s.byDay)[0].tok, 14160);
});

test('tools and errors', () => {
  const s = s1();
  assert.equal(s.tools.Bash.n, 1);
  assert.equal(s.tools.Bash.err, 1);
  assert.equal(s.errs, 1);
  assert.equal(s.mcp.playwright.navigate, 1);
  assert.equal(s.skills[0].name, 'superpowers:brainstorming');
  assert.equal(s.spawns[0].desc, 'Implement Task 1: core');
  assert.equal(s.spawns[0].id, 'tu-agent1');
  assert.equal(s.title, 'Alpha task');
  assert.equal(s.cwd, '/work/alpha');
  assert.ok(s.pending.includes('tu-agent1'));
});

test('files W/E with line deltas', () => {
  const f = s1().files['/work/alpha/src/a.js'];
  assert.equal(f.name, 'a.js');
  assert.equal(f.ops.W, 1);
  assert.equal(f.plus, 2);
  const a1 = load(path.join(root, 'proj-a', 's1', 'subagents', 'agent-a1.jsonl')).files['/work/alpha/src/a.js'];
  assert.deepEqual(a1.ops, { R: 1, E: 1 });
  assert.equal(a1.plus, 2);
});

test('tolerates unknown records and bad lines', () => {
  const s = s1();
  assert.equal(s.bad, 1);
  assert.equal(s.model, 'claude-opus-5-5'); // <synthetic> never sets model
});

test('redacts text', () => {
  const s = s1();
  assert.ok(s.events.length > 0);
  assert.ok(!JSON.stringify(s.events).includes('dev@example.com'));
  assert.ok(JSON.stringify(s.events).includes('[email]'));
});

test('solo session waits for user and makeFixtures is idempotent', () => {
  makeFixtures(root);
  const s = load(path.join(root, 'proj-b', 's2.jsonl'));
  assert.equal(s.lastAssistant.hasTool, false);
  assert.equal(s.lastUserAfter, false);
  assert.deepEqual(s.pending, []);
});
