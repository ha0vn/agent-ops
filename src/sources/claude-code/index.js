import fs from 'node:fs';
import path from 'node:path';
import { claudeProjectsDir } from '../../paths.js';
import { DEFAULT_CONFIG } from '../../config.js';
import { openCursor, readNew as defaultReadNew } from './reader.js';
import { createAgent, applyRecord, agentSummary } from './agent.js';
import { buildSession, sessionStatus, agentStatus } from './session.js';

const statOf = (f) => { try { return fs.statSync(f); } catch { return null; } };
const listDir = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
const readMeta = (f) => { try { const m = JSON.parse(fs.readFileSync(f, 'utf8')); return m && typeof m === 'object' ? m : {}; } catch { return {}; } };

class ClaudeCodeScanner {
  constructor(env, cfg, opts = {}) {
    this.dir = claudeProjectsDir(env);
    this.cfg = cfg || DEFAULT_CONFIG;
    this.readNew = opts.readNew || defaultReadNew;
    this.files = new Map(); // file -> { cursor, state, summary, mtime, size }
    this.metas = new Map(); // meta file -> { mtime, meta }
    this.sess = new Map(); // `${projectDir}/${id}` -> { built, mainFile, mainMtime, subs }
  }

  _load(file, st) {
    let e = this.files.get(file);
    if (e && st.size === e.size && st.mtimeMs === e.mtime) return false;
    // new file, or truncated/replaced: rebuild this file's agent state from scratch
    if (!e || st.size < e.cursor.offset) e = { cursor: openCursor(file), state: createAgent(), summary: null, mtime: 0, size: 0 };
    const { records, bad } = this.readNew(e.cursor);
    for (const r of records) applyRecord(e.state, r, this.cfg.prices);
    e.state.bad += bad;
    e.summary = null;
    e.mtime = st.mtimeMs;
    e.size = st.size;
    this.files.set(file, e);
    return true;
  }

  _summary(file) {
    const e = this.files.get(file);
    return e.summary || (e.summary = agentSummary(e.state));
  }

  refresh(now = Date.now()) {
    const changed = [];
    const seen = new Set();
    const seenFiles = new Set();
    for (const pd of listDir(this.dir)) {
      if (!pd.isDirectory()) continue;
      const projDir = path.join(this.dir, pd.name);
      for (const f of listDir(projDir)) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        const id = f.name.slice(0, -6), key = pd.name + '/' + id;
        const mainFile = path.join(projDir, f.name);
        const mst = statOf(mainFile);
        if (!mst) continue;
        seen.add(key);
        seenFiles.add(mainFile);
        let dirty = this._load(mainFile, mst);
        const subs = [];
        for (const sf of listDir(path.join(projDir, id, 'subagents'))) {
          if (!sf.isFile() || !/^agent-.+\.jsonl$/.test(sf.name)) continue;
          const sp = path.join(projDir, id, 'subagents', sf.name), sst = statOf(sp);
          if (!sst) continue;
          seenFiles.add(sp);
          if (this._load(sp, sst)) dirty = true;
          const mp = sp.slice(0, -6) + '.meta.json', mt = statOf(mp);
          let m = this.metas.get(mp);
          if (!mt) {
            if (m) { this.metas.delete(mp); dirty = true; }
            m = null;
          } else if (!m || m.mtime !== mt.mtimeMs) {
            m = { mtime: mt.mtimeMs, meta: readMeta(mp) };
            this.metas.set(mp, m);
            dirty = true;
          }
          subs.push({ agentId: sf.name.slice(6, -6), file: sp, mtime: sst.mtimeMs, meta: m ? m.meta : {} });
        }
        const prev = this.sess.get(key);
        if (!dirty && prev && prev.subs.length === subs.length) continue;
        const built = buildSession({
          id, projectDir: pd.name, main: this.files.get(mainFile).state, mainMtime: mst.mtimeMs,
          subs: subs.map((s) => ({ agentId: s.agentId, state: this.files.get(s.file).state, mtime: s.mtime, meta: s.meta })),
        }, now, this.cfg);
        this.sess.set(key, { built, mainFile, mainMtime: mst.mtimeMs, subs });
        changed.push(id);
      }
    }
    for (const [key, en] of [...this.sess.entries()]) {
      if (seen.has(key)) continue;
      this.sess.delete(key);
      changed.push(en.built.id); // log disappeared: let clients see logDeleted
    }
    for (const f of [...this.files.keys()]) if (!seenFiles.has(f)) this.files.delete(f);
    return { changed, sessions: this.sessionsAt(now) };
  }

  // Cached sessions with status recomputed for `now`; never touches the disk.
  sessionsAt(now = Date.now()) {
    const thr = this.cfg.thresholds || DEFAULT_CONFIG.thresholds;
    const out = [];
    for (const en of this.sess.values()) {
      const st0 = sessionStatus(this._summary(en.mainFile), en.mainMtime, now, thr);
      const byKey = new Map(en.subs.map((s) => [s.agentId, s]));
      const agents = en.built.agents.map((g) => {
        const s = g.key === 'main' ? null : byKey.get(g.key);
        const status = g.key === 'main' ? st0 : s ? agentStatus(s.meta, this._summary(s.file), s.mtime, now, thr) : g.status;
        return status === g.status ? g : { ...g, status };
      });
      out.push({ ...en.built, status: st0, agents });
    }
    return out;
  }
}

export const claudeCode = {
  id: 'claude-code',
  label: 'Claude Code',
  color: '#d6b67e',
  detect(env = process.env) {
    try { return fs.statSync(claudeProjectsDir(env)).isDirectory(); } catch { return false; }
  },
  createScanner(env, cfg, opts) { return new ClaudeCodeScanner(env, cfg, opts); },
};
