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

const decodeOnce = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const unsafe = (s) => /<img|<script/i.test(s);

test('log-derived strings are escaped in tooltips and attributes (even after one decode)', () => {
  const AO = load('vi');
  const evil = '<img src=x onerror=alert(1)>';
  AO.D = { generatedAt: 1, sources: [{ id: 's', label: evil, color: '#fff', available: true }], sessions: [], config: {} };
  const tok = { in: 1, out: 1, cw: 1, cr: 1 };
  const s = { id: '"><script>', short: '"><script>', status: 'run', agents: [
    { key: 'main', label: evil, desc: evil, model: evil, status: '<script>', tok, ctx: 5, cost: 1 },
    { key: 'a1', label: evil, desc: evil, model: evil, status: '<script>', tok, ctx: 5, cost: 1 }] };
  const outs = [AO.orbit(s), AO.resumeBtn(s, true), AO.sourceBadge({ source: 's' }), AO.status('<script>')];
  for (const h of outs) {
    assert.ok(!unsafe(h), 'raw: ' + h.slice(0, 200));
    for (const m of h.matchAll(/data-tip="([^"]*)"/g)) assert.ok(!unsafe(decodeOnce(m[1])), 'decoded tip: ' + decodeOnce(m[1]).slice(0, 200));
  }
});

test('stale aoSource is reset when not an available source', () => {
  const AO = load('vi', { aoSource: 'gone' });
  assert.equal(AO.sourceFilter, 'gone');
  AO.D = { sources: [{ id: 'a', available: true }], sessions: [], config: {} };
  AO.checkSource();
  assert.equal(AO.sourceFilter, '');
});

test('AO.live: initial render, debounced refetch, error then recovery', async () => {
  const timers = [];
  let fetches = 0, fail = false, es;
  const data = () => ({ generatedAt: Date.now(), sources: [], sessions: [], config: {} });
  const AO = load('vi', {});
  const ctx = {
    window: { AO, scrollY: 40, scrollTo(x, y) { ctx.scrolled = y; } },
    location: { search: "" }, console, URLSearchParams,
    setTimeout: (f, ms) => { const t = { f, ms, off: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.off = true; },
    fetch: async () => { fetches++; if (fail) throw new Error('down'); return { ok: true, json: async () => data() }; },
    EventSource: class { constructor(u) { this.u = u; this.l = {}; es = this; } addEventListener(n, f) { this.l[n] = f; } },
    document: { getElementById: () => null },
  };
  ctx.globalThis = ctx;
  AO.setConn = () => {}; AO.hideTip = () => {};
  vm.createContext(ctx);
  vm.runInContext(read('assets/live.js'), ctx);
  let renders = 0;
  AO.live(() => { renders++; });
  await new Promise((r) => setImmediate(r));
  assert.equal(renders, 1); assert.equal(fetches, 1); assert.equal(es.u, '/events'); assert.equal(ctx.scrolled, 40);
  es.l.change(); es.l.change();
  const live = () => timers.filter((t) => !t.off && t.ms === 800);
  assert.equal(live().length, 1);
  live()[0].f();
  await new Promise((r) => setImmediate(r));
  assert.equal(fetches, 2); assert.equal(renders, 2);
  fail = true; AO.reload();
  await new Promise((r) => setImmediate(r));
  assert.equal(AO.state, 'error');
  assert.ok(timers.some((t) => !t.off && t.ms === 5000));
  fail = false; timers.filter((t) => !t.off && t.ms === 5000)[0].f();
  await new Promise((r) => setImmediate(r));
  assert.notEqual(AO.state, 'error');
  assert.equal(renders, 4);
});

test('pages: sessions and session run on live data', () => {
  for (const [f, key] of [['index.html', 'index'], ['session.html', 'session']]) {
    const h = read(f);
    assert.ok(h.includes('AO.live('), f + ' uses AO.live');
    assert.ok(!h.includes('AO_DATA') && !h.includes('ao-data.js'), f + ' has no mock data');
    assert.ok(!/https?:\/\//.test(h), f + ' has no external url');
    assert.ok(!h.includes('/files/'), f + ' has no mockup links');
    assert.ok(!h.includes('throw 0'), f + ' has no throw 0');
    assert.ok(h.includes('/assets/ao.css') && h.includes('/assets/ao.js') && h.includes('/assets/live.js'));
    assert.ok(h.includes(`AO.header('${key}')`), f + ' header key');
  }
  const idx = read('index.html'), ses = read('session.html');
  assert.ok(idx.includes('c.source') && idx.includes('x.logDeleted') && idx.includes('AO.sourceBadge'));
  assert.ok(ses.includes('x.notFound') && ses.includes('AO.emptyState'));
});

test('skills and cost pages follow the live-page contract', () => {
  for (const [p, nav] of [['skills.html', 'skills'], ['cost.html', 'cost']]) {
    const h = read(p);
    for (const need of ['/assets/ao.css', '/assets/ao.js', '/assets/live.js', `AO.header('${nav}')`, 'AO.live(']) assert.ok(h.includes(need), `${p} lacks ${need}`);
    assert.ok(!h.includes('/files/') && !h.includes('throw 0') && !h.includes('ao-data.js'), p);
    const m = h.match(/<script>\s*\n([\s\S]*)<\/script>/);
    assert.doesNotThrow(() => new vm.Script(m[1]), p);
    for (const tip of h.match(/data-tip="[^"]*"/g) || []) assert.ok(/data-tip="\$\{AO\.tip\(/.test(tip) || !/<\w/.test(tip), `${p}: ${tip}`);
  }
  assert.match(read('cost.html'), /type="number" step="0\.01"/);
});
