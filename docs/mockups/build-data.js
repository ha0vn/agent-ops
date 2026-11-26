// Build one consistent snapshot dataset (window.AO_DATA) from ~/.claude/projects for the Agent Ops mockups.
// Read-only on the logs. Usage: node build-data.js <outFile>
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const OUT = process.argv[2];
const NOW = Date.now();
const WINDOW_DAYS = 31;
const PRICE = { 'claude-opus-5-5': { in: 4, out: 20, cw: 8, cr: 0.2 }, 'claude-sonnet-5-5': { in: 2, out: 10, cw: 4, cr: 0.1 }, 'claude-fable-5-2': { in: 8, out: 40, cw: 16, cr: 0.2 } };
const TZ = 7 * 3600e3;
const localDay = t => new Date(t + TZ).toISOString().slice(0, 10);

const parse = p => { const out = []; let bad = 0;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { bad++; } }
  return { recs: out, bad }; };
const short = (s, n = 70) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const base = p => String(p || '').split(/[\\/]/).filter(Boolean).slice(-1)[0] || '';
const parent = p => String(p || '').split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] || '';
function cmdText(c) {
  const parts = String(c || '').split(/&&|\n/).map(x => x.trim()).filter(x => x && !/^cd\s/.test(x) && !/^[A-Z_]+=/.test(x) && !/^export\s/.test(x));
  const first = parts[0] || String(c || '').split('\n').map(x => x.trim()).filter(Boolean).map(x => x.replace(/^cd\s+\S+\s*(&&|;)?\s*/, ''))[0] || '';
  return short(first.replace(/(["'])[^"']{40,}\1/g, '"…"'), 64);
}
function toolKind(name) { if (name.startsWith('mcp__')) return 'mcp'; if (name === 'Skill') return 'skill'; if (name === 'Agent') return 'agent';
  if (name === 'SendMessage') return 'msg'; if (name === 'SubagentHandback') return 'handback'; return 'tool'; }
function toolTarget(name, i) {
  i = i || {};
  if (i.file_path) return base(i.file_path);
  if (name === 'Bash' || name === 'PowerShell') return cmdText(i.command);
  if (name === 'Skill') return i.skill;
  if (name === 'Agent') return short(i.description, 60) + (i.model ? ' · ' + i.model : '');
  if (name === 'SendMessage') return '→ ' + short(i.summary || i.message, 56);
  if (name === 'Grep' || name === 'Glob') return short(i.pattern, 40);
  if (name === 'ToolSearch') return short(i.query, 50);
  if (name.startsWith('mcp__')) return short(i.url || i.selector || '', 50);
  return '';
}
function costOf(model, u) { const p = PRICE[model]; if (!p) return null;
  return (u.in * p.in + u.out * p.out + u.cw * p.cw + u.cr * p.cr) / 1e6; }

function readAgent(file) {
  const { recs, bad } = parse(file);
  const a = { t0: null, t1: null, tok: { in: 0, out: 0, cw: 0, cr: 0 }, cost: 0, costByType: { in: 0, out: 0, cw: 0, cr: 0 }, byModel: {}, ctx: 0,
    tools: {}, errs: 0, files: {}, skills: [], mcp: {}, events: [], spawns: [], msgs: [], title: null, cwd: null, entry: null,
    hooks: {}, memReads: 0, toolSearch: 0, turns: 0, lastAssistant: null, lastUserAfter: false, pending: {}, bad, byDay: {}, lastTool: null, activity: [] };
  const seen = new Set();
  for (const e of recs) {
    const ts = e.timestamp ? Date.parse(e.timestamp) : null;
    if (ts) { a.t0 = a.t0 ?? ts; a.t1 = ts; }
    if (e.aiTitle) a.title = e.aiTitle;
    if (e.cwd && !a.cwd) a.cwd = e.cwd;
    if (e.entrypoint && !a.entry) a.entry = e.entrypoint;
    if (e.type === 'attachment' && e.attachment && e.attachment.hookEvent) a.hooks[e.attachment.hookEvent] = (a.hooks[e.attachment.hookEvent] || 0) + 1;
    if (e.hookEvent) a.hooks[e.hookEvent] = (a.hooks[e.hookEvent] || 0) + 1;
    if (e.type === 'assistant' && e.message) {
      const m = e.message, u = m.usage;
      if (u && !seen.has(m.id)) { seen.add(m.id); a.turns++;
        const uu = { in: u.input_tokens || 0, out: u.output_tokens || 0, cw: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0 };
        for (const k in uu) a.tok[k] += uu[k];
        a.ctx = uu.in + uu.cw + uu.cr;
        const bm = a.byModel[m.model] = a.byModel[m.model] || { in: 0, out: 0, cw: 0, cr: 0, cost: 0 };
        for (const k in uu) bm[k] += uu[k];
        const c = costOf(m.model, uu);
        if (c != null) { a.cost += c; bm.cost += c; const p = PRICE[m.model];
          const d = localDay(ts || NOW), bd = a.byDay[d] = a.byDay[d] || { in: 0, out: 0, cw: 0, cr: 0, tok: 0 }; bd.tok += uu.in + uu.out + uu.cw + uu.cr;
          for (const k in uu) { const v = uu[k] * p[k] / 1e6; a.costByType[k] += v; bd[k] += v; } }
        else if (ts) { const d = localDay(ts), bd = a.byDay[d] = a.byDay[d] || { in: 0, out: 0, cw: 0, cr: 0, tok: 0 }; bd.tok += uu.in + uu.out + uu.cw + uu.cr; }
        if (ts) a.activity.push(ts);
      }
      if (m.model && m.model !== '<synthetic>') a.model = m.model;
      let hasTool = false;
      for (const c of m.content || []) if (c.type === 'tool_use') { hasTool = true;
        const n = c.name; a.pending[c.id] = { n, ts };
        const t = a.tools[n] = a.tools[n] || { n: 0, err: 0, ms: 0, msN: 0 }; t.n++;
        const tgt = toolTarget(n, c.input);
        a.events.push({ ts, kind: toolKind(n), tool: n, text: tgt, id: c.id });
        a.lastTool = { tool: n, text: tgt, ts };
        if (n === 'Skill') a.skills.push({ name: c.input && c.input.skill, ts });
        if (n === 'Agent') a.spawns.push({ ts, desc: c.input && c.input.description, model: c.input && c.input.model, id: c.id });
        if (n === 'SendMessage') a.msgs.push({ ts, to: c.input && c.input.to, text: short(c.input && (c.input.summary || c.input.message), 60) });
        if (n === 'ToolSearch') a.toolSearch++;
        if (n.startsWith('mcp__')) { const [, sv, ...rest] = n.split('__'); const tn = rest.join('_').replace(/^browser_/, '');
          a.mcp[sv] = a.mcp[sv] || {}; a.mcp[sv][tn] = (a.mcp[sv][tn] || 0) + 1; }
        const fp = c.input && (c.input.file_path || c.input.notebook_path);
        if (fp) { const op = n === 'Write' ? 'W' : /Edit/.test(n) ? 'E' : n === 'Read' ? 'R' : null;
          if (op) { if (/[\\/]memory[\\/]/.test(fp) && op === 'R') a.memReads++;
            const key = fp.toLowerCase(); const f = a.files[key] = a.files[key] || { name: base(fp), dir: parent(fp), ops: {}, n: 0, plus: 0, minus: 0, path: fp, last: 0 };
            f.ops[op] = (f.ops[op] || 0) + 1; f.n++; f.last = ts || f.last;
            if (n === 'Write' && c.input.content) f.plus += String(c.input.content).split('\n').length;
            if (/Edit/.test(n)) { f.plus += String(c.input.new_string || '').split('\n').length; f.minus += String(c.input.old_string || '').split('\n').length; } } }
      }
      a.lastAssistant = { ts, hasTool, stop: m.stop_reason, askUser: (m.content || []).some(c => c.type === 'tool_use' && c.name === 'AskUserQuestion') };
      a.lastUserAfter = false;
    }
    if (e.type === 'user' && e.message) {
      const content = e.message.content;
      if (typeof content === 'string') { a.lastUserAfter = true; }
      else if (Array.isArray(content)) {
        let real = false;
        for (const c of content) {
          if (c.type === 'tool_result') { const p = a.pending[c.tool_use_id];
            if (p) { const t = a.tools[p.n]; if (ts && p.ts) { t.ms += ts - p.ts; t.msN++; }
              if (c.is_error) { t.err++; a.errs++; const ev = a.events.find(x => x.id === c.tool_use_id); if (ev) ev.err = 1; }
              const ev = a.events.find(x => x.id === c.tool_use_id); if (ev && ts && p.ts) ev.ms = ts - p.ts;
              delete a.pending[c.tool_use_id]; } }
          else if (c.type === 'text' && !String(c.text).startsWith('<')) real = true;
        }
        if (real) a.lastUserAfter = true;
      }
    }
  }
  return a;
}

function label(desc, i) {
  const d = String(desc || '');
  const t = d.match(/Task\s*(\d+)/i);
  if (t) return (/review/i.test(d) ? 'R' : 'T') + t[1];
  const w = d.split(/\s+/).filter(Boolean);
  return (w[0] || 'Agent').slice(0, 8) + (i != null ? '' : '');
}
function status(a, isMain) {
  const age = NOW - (a.mtime || a.t1 || 0);
  if (age < 2 * 60e3 || Object.keys(a.pending).length && age < 15 * 60e3) return 'run';
  if (isMain && a.lastAssistant && !a.lastAssistant.hasTool && !a.lastUserAfter && age < 3 * 3600e3) return 'wait';
  if (isMain && a.lastAssistant && a.lastAssistant.askUser && age < 3 * 3600e3) return 'wait';
  return 'stop';
}

const sessions = [];
for (const dir of fs.readdirSync(ROOT)) {
  const pdir = path.join(ROOT, dir); if (!fs.statSync(pdir).isDirectory()) continue;
  for (const f of fs.readdirSync(pdir).filter(x => x.endsWith('.jsonl'))) {
    const fp = path.join(pdir, f), st = fs.statSync(fp);
    if (NOW - st.mtimeMs > WINDOW_DAYS * 864e5 || st.size < 2000) continue;
    const id = f.replace('.jsonl', '');
    const main = readAgent(fp); main.mtime = st.mtimeMs;
    if (!main.turns) continue;
    const subs = []; const sd = path.join(pdir, id, 'subagents');
    if (fs.existsSync(sd)) for (const x of fs.readdirSync(sd).filter(x => x.endsWith('.jsonl'))) {
      const sp = path.join(sd, x); const a = readAgent(sp); a.mtime = fs.statSync(sp).mtimeMs;
      let meta = {}; try { meta = JSON.parse(fs.readFileSync(sp.replace('.jsonl', '.meta.json'), 'utf8')); } catch {}
      a.meta = meta; a.agentId = x.slice(6, -6); subs.push(a);
    }
    subs.sort((p, q) => (p.t0 || 0) - (q.t0 || 0));
    const project = main.cwd ? base(main.cwd) : dir;
    const agents = [{ key: 'main', label: 'main', desc: null, model: main.model, depth: 0, parent: null, a: main }]
      .concat(subs.map((a, i) => ({ key: a.agentId, label: label(a.meta.description, i), desc: a.meta.description || 'agent', model: a.model || a.meta.model,
        type: a.meta.agentType, depth: a.meta.spawnDepth || 1, parent: a.meta.toolUseId, finished: !!a.meta.finished, a })));
    // de-dup labels
    const cnt = {}; for (const g of agents) { cnt[g.label] = (cnt[g.label] || 0) + 1; if (cnt[g.label] > 1) g.label += '·' + cnt[g.label]; }
    const tok = { in: 0, out: 0, cw: 0, cr: 0 }, costByType = { in: 0, out: 0, cw: 0, cr: 0 }, byModel = {}, tools = {}, mcp = {}, byDay = {};
    let cost = 0, subCost = 0, errs = 0, calls = 0; const files = {}, events = [], activity = [];
    for (const g of agents) { const a = g.a;
      for (const k in tok) { tok[k] += a.tok[k]; costByType[k] += a.costByType[k]; }
      cost += a.cost; if (g.key !== 'main') subCost += a.cost; errs += a.errs;
      for (const [m, v] of Object.entries(a.byModel)) { const b = byModel[m] = byModel[m] || { in: 0, out: 0, cw: 0, cr: 0, cost: 0 }; for (const k in v) b[k] += v[k]; }
      for (const [n, t] of Object.entries(a.tools)) { const x = tools[n] = tools[n] || { n: 0, err: 0, ms: 0, msN: 0 }; x.n += t.n; x.err += t.err; x.ms += t.ms; x.msN += t.msN; calls += t.n; }
      for (const [sv, ts] of Object.entries(a.mcp)) { mcp[sv] = mcp[sv] || {}; for (const [k, v] of Object.entries(ts)) mcp[sv][k] = (mcp[sv][k] || 0) + v; }
      for (const [d, v] of Object.entries(a.byDay)) { const b = byDay[d] = byDay[d] || { in: 0, out: 0, cw: 0, cr: 0, tok: 0 }; for (const k in v) b[k] += v[k]; }
      for (const f of Object.values(a.files)) { const k = f.path.toLowerCase(); const x = files[k] = files[k] || { name: f.name, dir: f.dir, ops: {}, n: 0, plus: 0, minus: 0, agents: [], last: 0 };
        for (const [o, v] of Object.entries(f.ops)) x.ops[o] = (x.ops[o] || 0) + v; x.n += f.n; x.plus += f.plus; x.minus += f.minus; x.last = Math.max(x.last, f.last || 0);
        if (!x.agents.includes(g.label)) x.agents.push(g.label); }
      for (const e of a.events) events.push({ ...e, agent: g.label });
      activity.push(...a.activity);
    }
    events.sort((p, q) => (q.ts || 0) - (p.ts || 0));
    // tools per local day (all agents) and skill phases (main agent)
    const toolsByDay = {};
    for (const e of events) { if (!e.ts) continue; const d = localDay(e.ts); const x = toolsByDay[d] = toolsByDay[d] || { n: 0, err: 0, tools: {} };
      x.n++; if (e.err) x.err++; x.tools[e.tool] = (x.tools[e.tool] || 0) + 1; }
    const sk = main.skills.filter(s => s.ts);
    const phases = sk.map((s, i) => { const from = s.ts, to = i + 1 < sk.length ? sk[i + 1].ts : Math.max(...agents.map(g => g.a.t1 || 0));
      const inRange = events.filter(e => e.ts >= from && e.ts < to);
      return { skill: s.name, from, to, calls: inRange.length, errs: inRange.filter(e => e.err).length,
        written: new Set(inRange.filter(e => e.tool === 'Write' || /Edit/.test(e.tool)).map(e => e.text)).size,
        spawns: main.spawns.filter(p => p.ts >= from && p.ts < to).length, mcp: inRange.filter(e => e.kind === 'mcp').length }; });
    const st0 = status(main, true);
    const agentsOut = agents.map(g => { const a = g.a; const s = g.key === 'main' ? st0 : (g.finished ? 'done' : status(a, false) === 'run' ? 'run' : 'stop');
      const tc = Object.entries(a.tools).sort((p, q) => q[1].n - p[1].n).map(([n, t]) => [n, t.n]);
      return { key: g.key, label: g.label, desc: g.desc, model: g.model, depth: g.depth, parent: g.parent, status: s,
        t0: a.t0, t1: a.t1, tok: a.tok, cost: +a.cost.toFixed(4), ctx: a.ctx, turns: a.turns, errs: a.errs, calls: tc.reduce((x, y) => x + y[1], 0),
        tools: tc.slice(0, 6), files: Object.keys(a.files).length, now: a.lastTool, skills: a.skills,
        toolErr: Object.fromEntries(Object.entries(a.tools).filter(([, t]) => t.err).map(([n, t]) => [n, t.err])),
        recent: a.events.slice(-10).reverse().map(e => ({ ts: e.ts, tool: e.tool, text: e.text, kind: e.kind, err: e.err || 0 })),
        fileList: Object.values(a.files).sort((p, q) => q.n - p.n).slice(0, 8).map(f => ({ name: f.name, dir: f.dir, op: f.ops.W ? 'W' : f.ops.E ? 'E' : 'R', n: f.n })) }; });
    // spawn edges: parent toolUseId → which agent made that Agent call
    for (const g of agentsOut) if (g.parent) { const p = agents.find(x => x.a.spawns.some(s => s.id === g.parent)); g.parentLabel = p ? p.label : 'main'; }
    sessions.push({
      id, short: id.slice(0, 8), title: main.title || '(chưa đặt tên)', project, projectDir: dir, entry: main.entry,
      t0: main.t0, t1: Math.max(...agents.map(g => g.a.t1 || 0)), mtime: st.mtimeMs, status: st0,
      tok, tokTotal: tok.in + tok.out + tok.cw + tok.cr, cost: +cost.toFixed(4), subCost: +subCost.toFixed(4), costByType, byModel, byDay,
      errs, calls, tools, mcp, ctx: main.ctx,
      skills: main.skills.concat(...subs.map(s => s.skills)).sort((p, q) => p.ts - q.ts),
      spawns: main.spawns.map(s => ({ ts: s.ts, desc: s.desc, model: s.model })), msgs: main.msgs,
      hooks: main.hooks, memReads: main.memReads, toolSearch: main.toolSearch, badLines: agents.reduce((x, g) => x + g.a.bad, 0),
      agents: agentsOut,
      files: Object.values(files).sort((p, q) => q.n - p.n).slice(0, 40),
      events: events.slice(0, 60).map(e => ({ ts: e.ts, agent: e.agent, kind: e.kind, tool: e.tool, text: e.text, ms: e.ms || null, err: e.err || 0 })),
      activity: [...new Set(activity.map(t => Math.floor(t / 900e3)))],
      toolsByDay, phases,
    });
  }
}
sessions.sort((p, q) => q.t1 - p.t1);
const data = { generatedAt: NOW, windowDays: WINDOW_DAYS, price: PRICE, sessions };
// redact e-mail addresses and long secret-looking tokens before anything reaches the page
const json = JSON.stringify(data)
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
  .replace(/\b(eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{10,}|(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,})\b/g, '[redacted]');
fs.writeFileSync(OUT, 'window.AO_DATA = ' + json + ';\n');
console.log('sessions', sessions.length, 'bytes', fs.statSync(OUT).size,
  'statuses', JSON.stringify(sessions.reduce((m, s) => (m[s.status] = (m[s.status] || 0) + 1, m), {})),
  'projects', JSON.stringify([...new Set(sessions.map(s => s.project))]),
  'cost', sessions.reduce((x, s) => x + s.cost, 0).toFixed(2), 'maxAgents', Math.max(...sessions.map(s => s.agents.length)),
  'bad', sessions.reduce((x, s) => x + s.badLines, 0));
