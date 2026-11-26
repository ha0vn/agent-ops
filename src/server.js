import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { saveConfig, DEFAULT_CONFIG } from './config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const CONFIG_KEYS = new Set(['prices', 'budget', 'thresholds', 'lang']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PRICE_KEYS = new Set(['in', 'out', 'cw', 'cr']);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const hasForbidden = (v) => isPlain(v) && Object.keys(v).some((k) => FORBIDDEN_KEYS.has(k) || hasForbidden(v[k]));

// Returns an error string, or null when the patch is acceptable.
function validatePatch(p) {
  if (hasForbidden(p)) return 'forbidden key';
  if ('budget' in p && p.budget !== null && !isNum(p.budget)) return 'budget must be null or a number >= 0';
  if ('lang' in p && p.lang !== 'vi' && p.lang !== 'en') return 'lang must be vi or en';
  if ('thresholds' in p) {
    if (!isPlain(p.thresholds)) return 'thresholds must be an object';
    for (const [k, v] of Object.entries(p.thresholds)) {
      if (!Object.hasOwn(DEFAULT_CONFIG.thresholds, k)) return 'unknown threshold ' + k;
      if (!isNum(v)) return 'threshold ' + k + ' must be a number >= 0';
    }
  }
  if ('prices' in p) {
    if (!isPlain(p.prices)) return 'prices must be an object';
    for (const [model, pr] of Object.entries(p.prices)) {
      if (!isPlain(pr)) return 'price for ' + model + ' must be an object';
      for (const [k, v] of Object.entries(pr)) {
        if (!PRICE_KEYS.has(k)) return 'unknown price key ' + k;
        if (!isNum(v)) return 'price ' + model + '.' + k + ' must be a number >= 0';
      }
    }
  }
  return null;
}

const MAX_BODY = 64 * 1024;
const KEEPALIVE_MS = 25000;

let VERSION = '0.0.0';
try { VERSION = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version; } catch { /* keep default */ }

export function startServer({ store, stateDir, webDir, port = 4317, host = '127.0.0.1', maxPort = port + 10 }) {
  const clients = new Set();
  let boundPort = port;

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body);
  };
  const sendJson = (req, res, status, obj, gzip = false) => {
    const raw = Buffer.from(JSON.stringify(obj));
    const h = { 'Content-Type': 'application/json; charset=utf-8' };
    if (gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding';
      return send(res, status, zlib.gzipSync(raw), h);
    }
    return send(res, status, raw, h);
  };

  const tooLarge = (res) => send(res, 413, JSON.stringify({ error: 'body too large' }), { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });

  const broadcast = (ids) => {
    const msg = `event: change\ndata: ${JSON.stringify({ ids })}\n\n`;
    for (const c of clients) c.write(msg);
  };
  const onChange = (ids) => broadcast(ids);
  store.on('change', onChange);
  const keepalive = setInterval(() => { for (const c of clients) c.write(': keepalive\n\n'); }, KEEPALIVE_MS);
  keepalive.unref();

  const hostOk = (req) => {
    const h = req.headers.host;
    return h === `127.0.0.1:${boundPort}` || h === `localhost:${boundPort}`;
  };

  const originOk = (req) => {
    const o = req.headers.origin;
    return o === undefined || o === `http://127.0.0.1:${boundPort}` || o === `http://localhost:${boundPort}`;
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  const serveStatic = (res, pathname) => {
    if (!webDir) return send(res, 404, 'not found');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'bad request'); }
    if (rel.includes('\0')) return send(res, 400, 'bad request');
    if (rel.endsWith('/')) rel += 'index.html';
    const root = path.resolve(webDir);
    const file = path.resolve(root, '.' + path.sep + rel);
    if (file !== root && !file.startsWith(root + path.sep)) return send(res, 404, 'not found');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'not found');
      send(res, 200, buf, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    });
  };

  const handler = async (req, res) => {
    try {
      if (!hostOk(req)) return send(res, 403, 'forbidden');
      const pathname = req.url.split(/[?#]/)[0];
      if (!pathname.startsWith('/')) return send(res, 400, 'bad request');
      const isApi = pathname.startsWith('/api/');
      if (req.method !== 'GET' && req.method !== 'HEAD' && !originOk(req)) return send(res, 403, 'forbidden');

      if (pathname === '/api/health' && req.method === 'GET') return sendJson(req, res, 200, { app: 'agents-ops', version: VERSION });
      if (pathname === '/api/data' && req.method === 'GET') return sendJson(req, res, 200, store.snapshot(), true);
      if (pathname === '/api/config' && req.method === 'GET') return sendJson(req, res, 200, store.config);
      if (pathname === '/api/config' && req.method === 'POST') {
        let patch;
        if (Number(req.headers['content-length']) > MAX_BODY) return tooLarge(res);
        try {
          const text = await readBody(req);
          patch = JSON.parse(text);
        } catch (e) {
          if (e.status === 413) return tooLarge(res);
          return sendJson(req, res, 400, { error: 'invalid json' });
        }
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return sendJson(req, res, 400, { error: 'body must be an object' });
        const bad = Object.keys(patch).filter((k) => !CONFIG_KEYS.has(k));
        if (bad.length) return sendJson(req, res, 400, { error: `unknown keys: ${bad.join(', ')}` });
        const invalid = validatePatch(patch);
        if (invalid) return sendJson(req, res, 400, { error: invalid });
        const merged = saveConfig(stateDir, patch);
        store.setConfig(merged);
        broadcast([]);
        return sendJson(req, res, 200, merged);
      }
      if (pathname === '/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (isApi) return send(res, 404, 'not found');
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
      return serveStatic(res, pathname);
    } catch {
      if (!res.headersSent) send(res, 500, 'internal error'); else res.end();
    }
  };

  const listen = (p) => new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(p, host, () => { server.off('error', reject); resolve(server); });
  });

  return (async () => {
    let server, p = port;
    for (;;) {
      try { server = await listen(p); break; } catch (e) {
        if (e.code === 'EADDRINUSE' && p < maxPort) { p++; continue; }
        clearInterval(keepalive); store.off('change', onChange);
        throw e;
      }
    }
    boundPort = server.address().port;
    return {
      port: boundPort,
      url: `http://${host}:${boundPort}`,
      close: () => new Promise((resolve) => {
        clearInterval(keepalive); store.off('change', onChange);
        for (const c of clients) c.end();
        clients.clear();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
    };
  })();
}
