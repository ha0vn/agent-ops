#!/usr/bin/env node
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { claudeProjectsDir, stateDir as getStateDir } from '../src/paths.js';
import { Store } from '../src/store.js';
import { watch } from '../src/watcher.js';
import { startServer } from '../src/server.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const quiet = flag('--quiet');
const log = (s) => { if (!quiet) console.log(s); };

function openBrowser(url) {
  const [cmd, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, a, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).on('error', () => {}).unref(); } catch { /* ignore */ }
}

function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', headers: { Host: `127.0.0.1:${port}` }, timeout: 400 }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b).app === 'agents-ops'); } catch { resolve(false); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

const stateDir = getStateDir();
const config = loadConfig(stateDir);
const port = Number(opt('--port')) || config.port || 4317;
// Browser rule (same for a fresh start and for reusing a running instance): open it unless --no-open.
const wantOpen = !flag('--no-open');

// The server falls forward up to 10 ports when the configured one is busy, so look for a running instance there too.
for (let p = port; p <= port + 10; p++) {
  if (await probe(p)) {
    const url = `http://127.0.0.1:${p}`;
    console.log(`Agent Ops already running: ${url}`);
    if (wantOpen) openBrowser(url);
    process.exit(0);
  }
}

const store = new Store({ env: process.env, stateDir, config });
await store.refresh();
const stop = watch(store, { roots: [claudeProjectsDir()], onError: (e) => log(`watch error: ${e?.message || e}`) });
const server = await startServer({ store, stateDir, webDir: fileURLToPath(new URL('../web', import.meta.url)), port });
console.log(`Agent Ops: ${server.url}`);
if (wantOpen) openBrowser(server.url);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  try { stop?.(); await server.close(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
