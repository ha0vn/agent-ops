import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { SOURCES, listSources } from './sources/index.js';
import { loadConfig } from './config.js';

export const OVERLAP_WINDOW_MS = 30 * 60e3;

const toSummary = (s) => {
  const { events: _events, ...rest } = s;
  return { ...rest, agents: s.agents.map(({ recent: _recent, ...a }) => a) };
};

const fileKey = (f) => (String(f.dir || '') + '/' + f.name).replace(/\\/g, '/').toLowerCase();

// id -> ids of other active sessions that wrote/edited the same file within the window.
export function computeOverlaps(sessions) {
  const active = sessions.filter((s) => s.status === 'run' || s.status === 'wait');
  const writes = active.map((s) => {
    const m = new Map();
    for (const f of s.files || []) if (f.ops && (f.ops.W || f.ops.E)) m.set(fileKey(f), f.last || 0);
    return m;
  });
  const res = new Map(sessions.map((s) => [s.id, []]));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      let hit = false;
      for (const [k, t] of writes[i]) {
        const u = writes[j].get(k);
        if (u !== undefined && Math.abs(t - u) <= OVERLAP_WINDOW_MS) { hit = true; break; }
      }
      if (hit) {
        res.get(active[i].id).push(active[j].id);
        res.get(active[j].id).push(active[i].id);
      }
    }
  }
  return res;
}

export class Store extends EventEmitter {
  constructor({ env = process.env, stateDir, config, readNew } = {}) {
    super();
    this.env = env;
    this.stateDir = stateDir;
    this.config = config || loadConfig(stateDir);
    this.scanners = new Map(SOURCES.filter((s) => s.detect(env)).map((s) => [s.id, s.createScanner(env, this.config, { readNew })]));
    this.history = new Map();
    this.refreshed = false;
    try {
      const arr = JSON.parse(fs.readFileSync(this._histFile(), 'utf8'));
      if (Array.isArray(arr)) for (const s of arr) if (s && s.id) this.history.set(s.id, s);
    } catch { /* no history yet */ }
  }

  _histFile() { return path.join(this.stateDir, 'history.json'); }

  _saveHistory() {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const f = this._histFile(), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...this.history.values()]));
    fs.renameSync(tmp, f);
  }

  refresh(now = Date.now()) {
    const changed = [];
    for (const sc of this.scanners.values()) {
      const r = sc.refresh(now);
      const ids = new Set(r.changed);
      for (const s of r.sessions) if (ids.has(s.id)) this.history.set(s.id, toSummary(s));
      changed.push(...r.changed);
    }
    this.refreshed = true;
    if (changed.length) {
      try { this._saveHistory(); } catch { /* unwritable state dir: keep serving from memory */ }
      this.emit('change', changed);
    }
    return changed;
  }

  // Pure in-memory: statuses are recomputed for `now`, no file is read (except a one-time first refresh).
  snapshot(now = Date.now()) {
    if (!this.refreshed) this.refresh(now);
    const live = [];
    for (const sc of this.scanners.values()) live.push(...sc.sessionsAt(now));
    const liveIds = new Set(live.map((s) => s.id));
    const ov = computeOverlaps(live);
    const sessions = live.map((s) => ({ ...s, overlaps: ov.get(s.id) || [], logDeleted: false }));
    for (const h of this.history.values()) {
      if (liveIds.has(h.id)) continue;
      sessions.push({
        ...h, status: 'stop', events: [], overlaps: [], logDeleted: true,
        agents: (h.agents || []).map((a) => ({ ...a, status: a.status === 'done' ? 'done' : 'stop', recent: [] })),
      });
    }
    sessions.sort((a, b) => (b.t1 || 0) - (a.t1 || 0));
    return {
      generatedAt: now, price: this.config.prices,
      config: { thresholds: this.config.thresholds, budget: this.config.budget },
      sources: listSources(this.env), sessions,
    };
  }
}
