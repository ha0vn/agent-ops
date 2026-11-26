process.env.TZ = 'Asia/Ho_Chi_Minh';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCursor, readNew } from '../src/sources/claude-code/reader.js';
import { createAgent, applyRecord } from '../src/sources/claude-code/agent.js';
import { buildSession, labelOf } from '../src/sources/claude-code/session.js';
import { DEFAULT_PRICES } from '../src/pricing.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { makeFixtures } from './fixtures/make-fixtures.js';

let root;
before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-t4-')); makeFixtures(root); });
after(() => fs.rmSync(root, { recursive: true, force: true }));

function load(file) {
  const c = openCursor(file), st = createAgent();
  const { records, bad } = readNew(c);
  for (const r of records) applyRecord(st, r, DEFAULT_PRICES);
  st.bad += bad;
  return st;
}
function inputs(proj, id) {
  const dir = path.join(root, proj), f = path.join(dir, id + '.jsonl');
  const subs = [];
  const sd = path.join(dir, id, 'subagents');
  if (fs.existsSync(sd)) {
    for (const x of fs.readdirSync(sd).filter((n) => n.endsWith('.jsonl'))) {
      const sp = path.join(sd, x);
      subs.push({
        agentId: x.slice(6, -6), state: load(sp), mtime: fs.statSync(sp).mtimeMs,
        meta: JSON.parse(fs.readFileSync(sp.replace('.jsonl', '.meta.json'), 'utf8')),
      });
    }
  }
  return { id, projectDir: proj, main: load(f), mainMtime: fs.statSync(f).mtimeMs, subs };
}
const build = (proj, id, plus = 60e3) => {
  const i = inputs(proj, id);
  return buildSession(i, i.mainMtime + plus, DEFAULT_CONFIG);
};

test('s1 assembles main + sub-agent', () => {
  const s = build('proj-a', 's1');
  assert.equal(s.tokTotal, 14160 + 1225);
  assert.equal(s.agents.length, 2);
  assert.equal(s.agents[1].label, 'T1');
  assert.equal(s.agents[1].parentLabel, 'main');
  assert.equal(s.agents[1].status, 'done');
  assert.ok(s.subCost > 0);
  const a = s.files.find((f) => f.name === 'a.js');
  assert.ok(a.agents.includes('main') && a.agents.includes('T1'));
  assert.equal(s.source, 'claude-code');
  assert.equal(s.capabilities.cost, true);
  assert.ok(s.events.length <= 60 && s.events[0].ts >= s.events[s.events.length - 1].ts);
  assert.ok(!('<synthetic>' in s.byModel));
});

test('phases', () => {
  const s = build('proj-a', 's1');
  assert.equal(s.phases.length, 1);
  assert.equal(s.phases[0].skill, 'superpowers:brainstorming');
  assert.ok(s.phases[0].calls >= 3);
});

test('status thresholds', () => {
  assert.equal(build('proj-a', 's1', 60e3).status, 'run');
  assert.equal(build('proj-a', 's1', 30 * 60e3).status, 'stop');
  assert.equal(build('proj-b', 's2', 60 * 60e3).status, 'wait');
  assert.equal(build('proj-b', 's2', 4 * 3600e3).status, 'stop');
});

test('labelOf', () => {
  assert.equal(labelOf('Review Task 3 (spec + quality)'), 'R3');
  assert.equal(labelOf('Builder check on design doc'), 'Builder');
  assert.equal(labelOf('Task 2: x'), 'T2');
});

test('byDay tok per local day', () => {
  const s = build('proj-a', 's1');
  const total = Object.values(s.byDay).reduce((x, d) => x + d.tok, 0);
  assert.equal(total, s.tokTotal);
  assert.ok(s.byDay['2026-11-26'].tok > 0);
});
