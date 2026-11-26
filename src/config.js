import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PRICES } from './pricing.js';

export const DEFAULT_CONFIG = {
  port: 4317,
  lang: 'vi',
  budget: null,
  prices: DEFAULT_PRICES,
  thresholds: {
    runMinutes: 2, pendingToolMinutes: 15, waitHours: 3, longSessionHours: 8,
    bigSessionTokens: 150e6, errCount: 20, errRate: 0.03, toolErrRate: 0.1, toolErrMin: 20,
    ctxRatio: 0.8, ctxWindow: 1e6,
  },
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObj(v) && isObj(out[k])) out[k] = merge(out[k], v);
    else out[k] = isObj(v) ? merge({}, v) : v;
  }
  return out;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const file = (dir) => path.join(dir, 'config.json');

export function loadConfig(dir) {
  let user = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file(dir), 'utf8'));
    if (isObj(parsed)) user = parsed;
  } catch { /* missing or corrupt: defaults */ }
  return merge(clone(DEFAULT_CONFIG), user);
}

export function saveConfig(dir, patch) {
  let user = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file(dir), 'utf8'));
    if (isObj(parsed)) user = parsed;
  } catch { /* start fresh */ }
  const next = merge(user, patch);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file(dir), JSON.stringify(next, null, 2));
  return merge(clone(DEFAULT_CONFIG), next);
}
