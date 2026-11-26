import { agentSummary } from './agent.js';
import { dayKey } from '../../time.js';
import { DEFAULT_CONFIG } from '../../config.js';

const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-1)[0] || '';
const r4 = (n) => +n.toFixed(4);
const asSummary = (s) => (typeof s.errs === 'number' && Array.isArray(s.events) ? s : agentSummary(s));
const pendingCount = (p) => (Array.isArray(p) ? p.length : p ? Object.keys(p).length : 0);

export function labelOf(desc) {
  const d = String(desc || '');
  const t = d.match(/Task\s*(\d+)/i);
  if (t) return (/review/i.test(d) ? 'R' : 'T') + t[1];
  const w = d.split(/\s+/).filter(Boolean);
  return (w[0] || 'Agent').slice(0, 8);
}

function isRunning(s, mtime, now, thr) {
  const age = now - (mtime || s.t1 || 0);
  return age < thr.runMinutes * 60e3 || (pendingCount(s.pending) > 0 && age < thr.pendingToolMinutes * 60e3);
}

export function sessionStatus(main, mtime, now, thr = DEFAULT_CONFIG.thresholds) {
  const s = asSummary(main);
  if (isRunning(s, mtime, now, thr)) return 'run';
  const age = now - (mtime || s.t1 || 0);
  const la = s.lastAssistant;
  if (la && age < thr.waitHours * 3600e3) {
    if (!la.hasTool && !s.lastUserAfter && pendingCount(s.pending) === 0) return 'wait';
    if (la.askUser) return 'wait';
  }
  return 'stop';
}

export function agentStatus(meta, state, mtime, now, thr = DEFAULT_CONFIG.thresholds) {
  if (meta && meta.finished) return 'done';
  return isRunning(asSummary(state), mtime, now, thr) ? 'run' : 'stop';
}

export function buildSession({ id, projectDir, main, mainMtime, subs = [] }, now, cfg = DEFAULT_CONFIG) {
  const thr = (cfg && cfg.thresholds) || DEFAULT_CONFIG.thresholds;
  const m = agentSummary(main);
  const subList = subs.map((x) => ({ ...x, a: agentSummary(x.state), meta: x.meta || {} }))
    .sort((p, q) => (p.a.t0 || 0) - (q.a.t0 || 0));
  const agents = [{ key: 'main', label: 'main', desc: null, model: m.model, depth: 0, parent: null, a: m, mtime: mainMtime }]
    .concat(subList.map((x) => ({
      key: x.agentId, label: labelOf(x.meta.description), desc: x.meta.description || 'agent', model: x.a.model || x.meta.model,
      type: x.meta.agentType, depth: x.meta.spawnDepth || 1, parent: x.meta.toolUseId, finished: !!x.meta.finished, a: x.a, mtime: x.mtime, meta: x.meta,
    })));
  const cnt = {};
  for (const g of agents) { cnt[g.label] = (cnt[g.label] || 0) + 1; if (cnt[g.label] > 1) g.label += '·' + cnt[g.label]; }

  const tok = { in: 0, out: 0, cw: 0, cr: 0 }, costByType = { in: 0, out: 0, cw: 0, cr: 0 };
  const byModel = {}, tools = {}, mcp = {}, byDay = {}, files = {};
  let cost = 0, subCost = 0, errs = 0, calls = 0;
  const events = [], activity = [];
  for (const g of agents) {
    const a = g.a;
    for (const k in tok) { tok[k] += a.tok[k]; costByType[k] += a.costByType[k]; }
    cost += a.cost; if (g.key !== 'main') subCost += a.cost; errs += a.errs;
    for (const [mo, v] of Object.entries(a.byModel)) {
      if (mo === '<synthetic>') continue;
      const b = byModel[mo] = byModel[mo] || { in: 0, out: 0, cw: 0, cr: 0, cost: 0 };
      for (const k in b) b[k] += v[k] || 0;
    }
    for (const [n, t] of Object.entries(a.tools)) {
      const x = tools[n] = tools[n] || { n: 0, err: 0, ms: 0, msN: 0 };
      x.n += t.n; x.err += t.err; x.ms += t.ms; x.msN += t.msN; calls += t.n;
    }
    for (const [sv, ts] of Object.entries(a.mcp)) { mcp[sv] = mcp[sv] || {}; for (const [k, v] of Object.entries(ts)) mcp[sv][k] = (mcp[sv][k] || 0) + v; }
    for (const [d, v] of Object.entries(a.byDay)) { const b = byDay[d] = byDay[d] || { in: 0, out: 0, cw: 0, cr: 0, tok: 0 }; for (const k in b) b[k] += v[k] || 0; }
    for (const f of Object.values(a.files)) {
      const k = f.path.toLowerCase();
      const x = files[k] = files[k] || { name: f.name, dir: f.dir, ops: {}, n: 0, plus: 0, minus: 0, agents: [], last: 0 };
      for (const [o, v] of Object.entries(f.ops)) x.ops[o] = (x.ops[o] || 0) + v;
      x.n += f.n; x.plus += f.plus; x.minus += f.minus; x.last = Math.max(x.last, f.last || 0);
      if (!x.agents.includes(g.label)) x.agents.push(g.label);
    }
    for (const e of a.events) events.push({ ...e, agent: g.label });
    activity.push(...a.activity);
  }
  events.sort((p, q) => (q.ts || 0) - (p.ts || 0));

  const toolsByDay = {};
  for (const e of events) {
    if (!e.ts) continue;
    const d = dayKey(e.ts);
    const x = toolsByDay[d] = toolsByDay[d] || { n: 0, err: 0, tools: {} };
    x.n++; if (e.err) x.err++; x.tools[e.tool] = (x.tools[e.tool] || 0) + 1;
  }
  const t1 = Math.max(0, ...agents.map((g) => g.a.t1 || 0));
  const sk = m.skills.filter((s) => s.ts);
  const phases = sk.map((s, i) => {
    const from = s.ts, to = i + 1 < sk.length ? sk[i + 1].ts : t1;
    const inRange = events.filter((e) => e.ts >= from && e.ts < to);
    return {
      skill: s.name, from, to, calls: inRange.length, errs: inRange.filter((e) => e.err).length,
      written: new Set(inRange.filter((e) => e.tool === 'Write' || /Edit/.test(e.tool)).map((e) => e.text)).size,
      spawns: m.spawns.filter((p) => p.ts >= from && p.ts < to).length, mcp: inRange.filter((e) => e.kind === 'mcp').length,
    };
  });

  const st0 = sessionStatus(m, mainMtime, now, thr);
  const agentsOut = agents.map((g) => {
    const a = g.a;
    const s = g.key === 'main' ? st0 : agentStatus(g.meta, a, g.mtime, now, thr);
    const tc = Object.entries(a.tools).sort((p, q) => q[1].n - p[1].n).map(([n, t]) => [n, t.n]);
    return {
      key: g.key, label: g.label, desc: g.desc, model: g.model, type: g.type, depth: g.depth, parent: g.parent, finished: g.finished, status: s,
      t0: a.t0, t1: a.t1, tok: a.tok, cost: r4(a.cost), ctx: a.ctx, turns: a.turns, errs: a.errs, calls: tc.reduce((x, y) => x + y[1], 0),
      tools: tc.slice(0, 6), files: Object.keys(a.files).length, now: a.lastTool, skills: a.skills,
      toolErr: Object.fromEntries(Object.entries(a.tools).filter(([, t]) => t.err).map(([n, t]) => [n, t.err])),
      recent: a.events.slice(-10).reverse().map((e) => ({ ts: e.ts, tool: e.tool, text: e.text, kind: e.kind, err: e.err || 0 })),
      fileList: Object.values(a.files).sort((p, q) => q.n - p.n).slice(0, 8)
        .map((f) => ({ name: f.name, dir: f.dir, op: f.ops.W ? 'W' : f.ops.E ? 'E' : 'R', n: f.n })),
    };
  });
  for (const g of agentsOut) {
    if (g.parent) { const p = agents.find((x) => x.a.spawns.some((s) => s.id === g.parent)); g.parentLabel = p ? p.label : 'main'; }
  }

  return {
    id, short: id.slice(0, 8), title: m.title || '(chưa đặt tên)', project: m.cwd ? base(m.cwd) : projectDir, projectDir, entry: m.entry,
    t0: m.t0, t1, mtime: mainMtime, status: st0,
    tok, tokTotal: tok.in + tok.out + tok.cw + tok.cr, cost: r4(cost), subCost: r4(subCost), costByType, byModel, byDay,
    errs, calls, tools, mcp, ctx: m.ctx,
    skills: m.skills.concat(...subList.map((x) => x.a.skills)).sort((p, q) => p.ts - q.ts),
    spawns: m.spawns.map((s) => ({ ts: s.ts, desc: s.desc, model: s.model })), msgs: m.msgs,
    hooks: m.hooks, memReads: m.memReads, toolSearch: m.toolSearch, badLines: agents.reduce((x, g) => x + (g.a.bad || 0), 0),
    agents: agentsOut,
    files: Object.values(files).sort((p, q) => q.n - p.n).slice(0, 40),
    events: events.slice(0, 60).map((e) => ({ ts: e.ts, agent: e.agent, kind: e.kind, tool: e.tool, text: e.text, ms: e.ms || null, err: e.err || 0 })),
    activity: [...new Set(activity.map((t) => Math.floor(t / 900e3)))],
    toolsByDay, phases,
    source: 'claude-code',
    capabilities: { tokens: true, subagents: true, skills: true, mcp: true, cost: true },
  };
}
