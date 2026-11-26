import { redact, shortCommand } from '../../redact.js';
import { costOf, DEFAULT_PRICES } from '../../pricing.js';
import { dayKey } from '../../time.js';

const short = (s, n = 70) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-1)[0] || '';
const parent = (p) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] || '';
const TYPES = ['in', 'out', 'cw', 'cr'];

function toolKind(name) {
  if (name.startsWith('mcp__')) return 'mcp';
  if (name === 'Skill') return 'skill';
  if (name === 'Agent') return 'agent';
  if (name === 'SendMessage') return 'msg';
  if (name === 'SubagentHandback') return 'handback';
  return 'tool';
}

function toolTarget(name, i) {
  i = i || {};
  if (i.file_path) return base(i.file_path);
  if (name === 'Bash' || name === 'PowerShell') return shortCommand(i.command, 64);
  if (name === 'Skill') return i.skill;
  if (name === 'Agent') return short(i.description, 60) + (i.model ? ' · ' + i.model : '');
  if (name === 'SendMessage') return '→ ' + short(i.summary || i.message, 56);
  if (name === 'Grep' || name === 'Glob') return short(i.pattern, 40);
  if (name === 'ToolSearch') return short(i.query, 50);
  if (name.startsWith('mcp__')) return short(i.url || i.selector || '', 50);
  return '';
}

const zero = () => ({ in: 0, out: 0, cw: 0, cr: 0 });

export function createAgent() {
  const st = {
    t0: null, t1: null, tok: zero(), cost: 0, costByType: zero(), byModel: {}, ctx: 0,
    tools: {}, errs: 0, files: {}, skills: [], mcp: {}, events: [], spawns: [], msgs: [],
    title: null, cwd: null, entry: null, model: null, hooks: {}, memReads: 0, toolSearch: 0, turns: 0,
    lastAssistant: null, lastUserAfter: false, pending: {}, byDay: {}, lastTool: null, activity: [], bad: 0,
  };
  Object.defineProperty(st, '_seen', { value: new Set(), enumerable: false });
  Object.defineProperty(st, '_ev', { value: new Map(), enumerable: false });
  return st;
}

function dayBucket(st, ts) {
  const d = dayKey(ts);
  return (st.byDay[d] = st.byDay[d] || { in: 0, out: 0, cw: 0, cr: 0, tok: 0 });
}

function applyUsage(st, m, ts, prices) {
  const u = m.usage;
  if (!u || m.model === '<synthetic>' || st._seen.has(m.id)) return;
  if (m.id != null) st._seen.add(m.id);
  st.turns++;
  const uu = { in: u.input_tokens || 0, out: u.output_tokens || 0, cw: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0 };
  for (const k of TYPES) st.tok[k] += uu[k];
  st.ctx = uu.in + uu.cw + uu.cr;
  const mk = m.model || 'unknown';
  const bm = (st.byModel[mk] = st.byModel[mk] || { in: 0, out: 0, cw: 0, cr: 0, cost: 0 });
  for (const k of TYPES) bm[k] += uu[k];
  const c = costOf(m.model, uu, prices);
  const tokSum = uu.in + uu.out + uu.cw + uu.cr;
  if (c != null) {
    st.cost += c; bm.cost += c;
    const p = prices[m.model], bd = dayBucket(st, ts || Date.now());
    bd.tok += tokSum;
    for (const k of TYPES) { const v = uu[k] * p[k] / 1e6; st.costByType[k] += v; bd[k] += v; }
  } else if (ts) {
    dayBucket(st, ts).tok += tokSum;
  }
  if (ts) st.activity.push(ts);
}

function applyToolUse(st, c, ts) {
  const n = c.name || '';
  const input = c.input || {};
  st.pending[c.id] = { n, ts };
  const t = (st.tools[n] = st.tools[n] || { n: 0, err: 0, ms: 0, msN: 0 });
  t.n++;
  const tgt = redact(toolTarget(n, input) || '');
  const ev = { ts, kind: toolKind(n), tool: n, text: tgt, id: c.id };
  st.events.push(ev);
  st._ev.set(c.id, ev);
  st.lastTool = { tool: n, text: tgt, ts };
  if (n === 'Skill') st.skills.push({ name: input.skill, ts });
  if (n === 'Agent') st.spawns.push({ ts, desc: redact(input.description || ''), model: input.model, id: c.id });
  if (n === 'SendMessage') st.msgs.push({ ts, to: input.to, text: redact(short(input.summary || input.message, 60)) });
  if (n === 'ToolSearch') st.toolSearch++;
  if (n.startsWith('mcp__')) {
    const [, sv, ...rest] = n.split('__');
    const tn = rest.join('_').replace(/^browser_/, '');
    st.mcp[sv] = st.mcp[sv] || {};
    st.mcp[sv][tn] = (st.mcp[sv][tn] || 0) + 1;
  }
  const fp = input.file_path || input.notebook_path;
  if (fp) {
    const op = n === 'Write' ? 'W' : /Edit/.test(n) ? 'E' : n === 'Read' ? 'R' : null;
    if (op) {
      if (/[\\/]memory[\\/]/.test(fp) && op === 'R') st.memReads++;
      const key = fp.toLowerCase();
      const f = (st.files[key] = st.files[key] || { name: base(fp), dir: parent(fp), ops: {}, n: 0, plus: 0, minus: 0, path: fp, last: 0 });
      f.ops[op] = (f.ops[op] || 0) + 1; f.n++; f.last = ts || f.last;
      if (n === 'Write' && input.content) f.plus += String(input.content).split('\n').length;
      if (/Edit/.test(n)) {
        f.plus += String(input.new_string || '').split('\n').length;
        f.minus += String(input.old_string || '').split('\n').length;
      }
    }
  }
}

export function applyRecord(st, e, prices = DEFAULT_PRICES) {
  if (!e || typeof e !== 'object') return;
  const ts = e.timestamp ? Date.parse(e.timestamp) || null : null;
  if (ts) { st.t0 = st.t0 ?? ts; st.t1 = ts; }
  if (e.aiTitle) st.title = redact(e.aiTitle);
  if (e.cwd && !st.cwd) st.cwd = e.cwd;
  if (e.entrypoint && !st.entry) st.entry = e.entrypoint;
  if (e.type === 'attachment' && e.attachment && e.attachment.hookEvent) st.hooks[e.attachment.hookEvent] = (st.hooks[e.attachment.hookEvent] || 0) + 1;
  if (e.hookEvent) st.hooks[e.hookEvent] = (st.hooks[e.hookEvent] || 0) + 1;

  if (e.type === 'assistant' && e.message && typeof e.message === 'object') {
    const m = e.message;
    applyUsage(st, m, ts, prices);
    if (m.model && m.model !== '<synthetic>') st.model = m.model;
    const content = Array.isArray(m.content) ? m.content : [];
    let hasTool = false;
    for (const c of content) {
      if (c && c.type === 'tool_use') { hasTool = true; applyToolUse(st, c, ts); }
    }
    st.lastAssistant = { ts, hasTool, stop: m.stop_reason, askUser: content.some((c) => c && c.type === 'tool_use' && c.name === 'AskUserQuestion') };
    st.lastUserAfter = false;
  }

  if (e.type === 'user' && e.message && typeof e.message === 'object') {
    const content = e.message.content;
    if (typeof content === 'string') st.lastUserAfter = true;
    else if (Array.isArray(content)) {
      let real = false;
      for (const c of content) {
        if (!c) continue;
        if (c.type === 'tool_result') {
          const p = st.pending[c.tool_use_id];
          if (!p) continue;
          const t = st.tools[p.n];
          const ev = st._ev.get(c.tool_use_id);
          if (ts && p.ts) { t.ms += ts - p.ts; t.msN++; }
          if (c.is_error) { t.err++; st.errs++; if (ev) ev.err = 1; }
          if (ev && ts && p.ts) ev.ms = ts - p.ts;
          delete st.pending[c.tool_use_id];
        } else if (c.type === 'text' && !String(c.text).startsWith('<')) real = true;
      }
      if (real) st.lastUserAfter = true;
    }
  }
}

const clone = (o) => JSON.parse(JSON.stringify(o));

export function agentSummary(st) {
  const { pending, ...rest } = st;
  return { ...clone(rest), pending: Object.keys(pending) };
}
