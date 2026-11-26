import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL(`../web/${p}`, import.meta.url), 'utf8');

function load(lang = 'vi', extra = {}) {
  const store = { aoLang: lang, ...extra };
  const win = {
    document: { querySelectorAll: () => [], createElement: () => ({}), addEventListener() {}, body: { appendChild() {}, dataset: {} } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    location: { search: '' },
    navigator: { language: 'vi-VN' },
  };
  win.window = win; win.globalThis = win;
  vm.createContext(win);
  vm.runInContext(read('assets/ao.js'), win);
  return win.AO;
}

test('formatters follow language', () => {
  assert.equal(load('vi').tok(19610000), '19,6M');
  assert.equal(load('en').tok(19610000), '19.6M');
  assert.equal(load('vi').dur(73 * 60e3), '1h 13m');
  assert.equal(load('vi').t('nav.graph'), 'Sơ đồ đội');
  assert.equal(load('en').t('nav.graph'), 'Team graph');
});

test('dayKey/date use local timezone', () => {
  const AO = load('vi');
  const ts = new Date(2026, 10, 5, 0, 30).getTime();
  assert.equal(AO.dayKey(ts), '2026-11-05');
  assert.equal(AO.date(ts), '05/11');
});

test('problems reads thresholds and overlaps', () => {
  const AO = load('vi');
  AO.D = { config: { thresholds: { longSessionHours: 1, bigSessionTokens: 1e12, errCount: 1e9, errRate: 1 } }, sessions: [], sources: [] };
  const s = { t0: 0, t1: 2 * 3600e3, tokTotal: 1, calls: 0, errs: 0, overlaps: ['x'] };
  const p = AO.problems(s);
  assert.equal(p.length, 2);
  assert.equal(p[1][1], 'trùng file');
});

test('header: nav links, no mockup badge, source filter only with 2+ sources', () => {
  const AO = load('vi');
  AO.D = { generatedAt: Date.now(), sources: [{ id: 'a', label: 'Claude', color: '#fff', available: true }], sessions: [], config: {} };
  let h = AO.header('index');
  assert.ok(h.includes('href="/"') && h.includes('href="/graph.html"') && !h.includes('MOCKUP') && !h.includes('srcSel'));
  AO.D.sources.push({ id: 'b', label: 'Codex', color: '#000', available: true });
  h = AO.header('index');
  assert.ok(h.includes('srcSel'));
  assert.equal(AO.sourceBadge(AO.D.sources[1] && { source: 'b' }).includes('>C<'), true);
});

test('css has no external font and live.js defines AO.live', () => {
  assert.ok(!read('assets/ao.css').includes('fonts.googleapis.com'));
  assert.ok(!read('assets/ao.js').includes('fonts.googleapis.com'));
  assert.match(read('assets/live.js'), /AO\.live\s*=/);
  assert.match(read('assets/live.js'), /EventSource\('\/events'\)/);
});

test('every i18n key used in web/*.html exists', () => {
  const AO = load('vi');
  const files = readdirSync(new URL('../web/', import.meta.url)).filter((f) => f.endsWith('.html'));
  const keys = new Set();
  for (const f of files) for (const m of read(f).matchAll(/\bt\('([a-z0-9.]+)'\)/g)) keys.add(m[1]);
  for (const f of ['assets/ao.js']) for (const m of read(f).matchAll(/AO\.t\('([a-z0-9.]+)'\)/g)) keys.add(m[1]);
  for (const k of keys) assert.notEqual(AO.t(k), k, `missing i18n key ${k}`);
  assert.ok(existsSync(new URL('../web/assets/live.js', import.meta.url)));
});
