import fs from 'node:fs';

const RELEVANT = /\.jsonl?$/i;

// Watches `roots` for changes and calls store.refresh(). Native fs.watch is a fast path;
// the interval poll is the safety net. Returns a stop function.
export function watch(store, { roots = [], intervalMs = 3000, debounceMs = 400 } = {}) {
  const watchers = [];
  let debounce = null;
  let running = false;
  let again = false;
  let stopped = false;

  const run = () => {
    if (stopped) return;
    if (running) { again = true; return; }
    running = true;
    try { store.refresh(); } catch { /* keep watching */ }
    finally { running = false; }
    if (again) { again = false; schedule(); }
  };

  const schedule = () => {
    if (stopped || debounce) return;
    debounce = setTimeout(() => { debounce = null; run(); }, debounceMs);
    debounce.unref?.();
  };

  for (const root of roots) {
    try {
      const w = fs.watch(root, { recursive: true }, (_evt, name) => {
        if (name && !RELEVANT.test(String(name))) return;
        schedule();
      });
      w.on('error', () => { try { w.close(); } catch { /* ignore */ } });
      watchers.push(w);
    } catch { /* unsupported or missing root: polling only */ }
  }

  const timer = setInterval(() => { if (!debounce) run(); }, intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
    if (debounce) clearTimeout(debounce);
    debounce = null;
    for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
    watchers.length = 0;
  };
}
