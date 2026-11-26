import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { listSources } from '../src/sources/index.js';
import { readNew as realReadNew } from '../src/sources/claude-code/reader.js';
import { makeFixtures } from './fixtures/make-fixtures.js';

let tmp, projects, state, env;
const NOW = Date.parse('2026-11-26T03:21:00Z');
const T = (min, sec = 0) => `2026-11-26T03:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}Z`;
const asst = (ts, id, content, out = 1, sid = 's1') => JSON.stringify({
  type: 'assistant', timestamp: ts, sessionId: sid, cwd: '/work/alpha',
  message: { id, role: 'assistant', model: 'claude-opus-5-5', content, usage: { input_tokens: 0, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
}) + '\n';
const touch = (f, t = NOW) => fs.utimesSync(f, t / 1000, t / 1000);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-t5-'));
  projects = path.join(tmp, 'claude', 'projects');
  state = path.join(tmp, 'state');
  makeFixtures(projects);
  env = { CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), AGENT_OPS_HOME: state };
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const mk = (extra = {}) => new Store({ env, stateDir: state, ...extra });
const find = (snap, id) => snap.sessions.find((s) => s.id === id);

test('refresh reads only appended bytes', () => {
  const offsets = [];
  const store = mk({ readNew: (c) => { offsets.push([path.basename(c.file), c.offset]); return realReadNew(c); } });
  assert.deepEqual(store.refresh(NOW).sort(), ['s1', 's2']);
  const before = find(store.snapshot(NOW), 's1').tok.out;
  const f = path.join(projects, 'proj-a', 's1.jsonl');
  const size = fs.statSync(f).size;
  fs.appendFileSync(f, asst(T(6), 'm9', [{ type: 'text', text: 'more' }], 7));
  offsets.length = 0;
  assert.deepEqual(store.refresh(NOW), ['s1']);
  assert.deepEqual(offsets, [['s1.jsonl', size]]);
  assert.equal(find(store.snapshot(NOW), 's1').tok.out, before + 7);
  assert.deepEqual(store.refresh(NOW), []);
});

test('rebuilds a truncated file from scratch', () => {
  const store = mk();
  store.refresh(NOW);
  fs.writeFileSync(path.join(projects, 'proj-b', 's2.jsonl'), asst(T(11), 'z1', [{ type: 'text', text: 'new' }], 3, 's2'));
  assert.deepEqual(store.refresh(NOW), ['s2']);
  assert.equal(find(store.snapshot(NOW), 's2').tok.out, 3);
});

test('new subagent file marks the session changed', () => {
  const store = mk();
  store.refresh(NOW);
  const dir = path.join(projects, 'proj-a', 's1', 'subagents');
  fs.writeFileSync(path.join(dir, 'agent-x.jsonl'), asst(T(7), 'x1', [{ type: 'text', text: 'hi' }], 5));
  fs.writeFileSync(path.join(dir, 'agent-x.meta.json'), JSON.stringify({ description: 'Extra', toolUseId: 'tu-x', spawnDepth: 1 }));
  assert.deepEqual(store.refresh(NOW), ['s1']);
  const ag = find(store.snapshot(NOW), 's1').agents.find((a) => a.key === 'x');
  assert.ok(ag);
  assert.equal(ag.tok.out, 5);
});

test('truncated subagent file is rebuilt, not double counted', () => {
  const store = mk();
  store.refresh(NOW);
  const f = path.join(projects, 'proj-a', 's1', 'subagents', 'agent-a1.jsonl');
  const content = asst(T(8), 'tr1', [{ type: 'text', text: 'x' }], 100000);
  assert.ok(content.length < fs.statSync(f).size, 'fixture must shrink');
  fs.writeFileSync(f, content);
  fs.utimesSync(f, (NOW + 1000) / 1000, (NOW + 1000) / 1000);
  assert.deepEqual(store.refresh(NOW), ['s1']);
  const s = find(store.snapshot(NOW), 's1');
  const ag = s.agents.find((a) => a.key === 'a1');
  assert.equal(ag.tok.out, 100000);
  assert.equal(ag.cost, 2);
  assert.equal(s.subCost, 2);
});

test('corrupt history.json does not break the store', () => {
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'history.json'), '{not json at all');
  const store = mk();
  assert.deepEqual(store.refresh(NOW).sort(), ['s1', 's2']);
  assert.equal(store.snapshot(NOW).sessions.length, 2);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(state, 'history.json'), 'utf8')));
});

test('emits change when a log disappears', () => {
  const store = mk();
  store.refresh(NOW);
  const got = [];
  store.on('change', (ids) => got.push(ids));
  fs.rmSync(path.join(projects, 'proj-b', 's2.jsonl'));
  assert.deepEqual(store.refresh(NOW), ['s2']);
  assert.equal(find(store.snapshot(NOW), 's2').logDeleted, true);
  assert.deepEqual(got, [['s2']]);
});

test('emits change', () => {
  const store = mk();
  store.refresh(NOW);
  const got = [];
  store.on('change', (ids) => got.push(ids));
  fs.appendFileSync(path.join(projects, 'proj-a', 's1.jsonl'), asst(T(6), 'm9', [{ type: 'text', text: 'x' }]));
  store.refresh(NOW);
  store.refresh(NOW);
  assert.deepEqual(got, [['s1']]);
});

test('history survives log cleanup', () => {
  const s1 = mk();
  s1.refresh(NOW);
  const old = find(s1.snapshot(NOW), 's2');
  assert.ok(old.tokTotal > 0);
  const saved = fs.readFileSync(path.join(state, 'history.json'), 'utf8');
  assert.ok(!saved.includes('"recent"') && !saved.includes('"events"'));
  fs.rmSync(path.join(projects, 'proj-b', 's2.jsonl'));
  const s2 = mk();
  s2.refresh(NOW);
  const got = find(s2.snapshot(NOW), 's2');
  assert.equal(got.logDeleted, true);
  assert.equal(got.tokTotal, old.tokTotal);
  assert.deepEqual(got.events, []);
  assert.equal(find(s2.snapshot(NOW), 's1').logDeleted, false);
});

test('50k-line session builds under 2s', () => {
  const lines = [];
  for (let i = 0; i < 50000; i++) lines.push(asst(T(10, 0), 'big' + i, [{ type: 'text', text: 'hello ' + i }], 1, 'big').trimEnd());
  fs.writeFileSync(path.join(projects, 'proj-b', 'big.jsonl'), lines.join('\n') + '\n');
  const store = mk();
  const t = Date.now();
  store.refresh(NOW);
  const ms = Date.now() - t;
  assert.ok(ms < 2000, 'took ' + ms + 'ms');
  assert.equal(find(store.snapshot(NOW), 'big').tok.out, 50000);
});

test('listSources reports availability', () => {
  assert.deepEqual(listSources(env), [{ id: 'claude-code', label: 'Claude Code', color: '#d6b67e', available: true }]);
  const none = listSources({ CLAUDE_CONFIG_DIR: path.join(tmp, 'nope') });
  assert.equal(none[0].id, 'claude-code');
  assert.equal(none[0].available, false);
});

test('flags overlapping writers', () => {
  fs.writeFileSync(path.join(projects, 'proj-a', 's3.jsonl'), asst(T(20), 'w3', [
    { type: 'tool_use', id: 'tu-w3', name: 'Write', input: { file_path: '/work/alpha/src/a.js', content: 'q' } },
  ], 1, 's3'));
  for (const f of ['proj-a/s1.jsonl', 'proj-a/s3.jsonl', 'proj-b/s2.jsonl']) touch(path.join(projects, f));
  const store = mk();
  store.refresh(NOW);
  const snap = store.snapshot(NOW);
  assert.equal(find(snap, 's1').status, 'run');
  assert.deepEqual(find(snap, 's1').overlaps, ['s3']);
  assert.deepEqual(find(snap, 's3').overlaps, ['s1']);
  assert.deepEqual(find(snap, 's2').overlaps, []);
  const late = store.snapshot(NOW + 24 * 3600e3);
  assert.deepEqual(find(late, 's1').overlaps, []);
});

test('snapshot recomputes status for now without reading files', () => {
  touch(path.join(projects, 'proj-a', 's1.jsonl'));
  let reads = 0;
  const store = mk({ readNew: (c) => { reads++; return realReadNew(c); } });
  store.refresh(NOW);
  const n = reads;
  assert.equal(find(store.snapshot(NOW), 's1').status, 'run');
  assert.equal(find(store.snapshot(NOW + 5 * 24 * 3600e3), 's1').status, 'stop');
  assert.equal(reads, n);
});

test('snapshot shape', () => {
  const store = mk();
  store.refresh(NOW);
  const snap = store.snapshot(NOW);
  assert.deepEqual(Object.keys(snap).sort(), ['config', 'generatedAt', 'price', 'sessions', 'sources']);
  assert.equal(snap.generatedAt, NOW);
  assert.deepEqual(Object.keys(snap.config).sort(), ['budget', 'thresholds']);
  assert.deepEqual(snap.sessions.map((s) => s.t1), snap.sessions.map((s) => s.t1).sort((a, b) => b - a));
  const expected = [
    'id', 'short', 'title', 'project', 'projectDir', 'entry', 't0', 't1', 'mtime', 'status',
    'tok', 'tokTotal', 'cost', 'subCost', 'costByType', 'byModel', 'byDay',
    'errs', 'calls', 'tools', 'mcp', 'ctx', 'skills', 'spawns', 'msgs',
    'hooks', 'memReads', 'toolSearch', 'badLines', 'agents', 'files', 'events', 'activity', 'toolsByDay', 'phases',
    'source', 'capabilities', 'overlaps', 'logDeleted',
  ];
  assert.deepEqual(Object.keys(find(snap, 's1')).sort(), expected.slice().sort());
});

test('setConfig changes what the next snapshot reports', () => {
  const store = mk();
  store.refresh(NOW);
  store.setConfig({ ...store.config, budget: 123 });
  assert.equal(store.snapshot(NOW).config.budget, 123);
});
