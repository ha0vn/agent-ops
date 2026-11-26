// $ per 1M tokens: in, out, cache write, cache read
export const DEFAULT_PRICES = {
  'claude-opus-5-5': { in: 4, out: 20, cw: 8, cr: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cw: 4, cr: 0.1 },
  'claude-fable-5-2': { in: 8, out: 40, cw: 16, cr: 0.2 },
};

export function costOf(model, usage, prices = DEFAULT_PRICES) {
  const p = prices && prices[model];
  if (!p) return null;
  const u = usage || {};
  return ((u.in || 0) * p.in + (u.out || 0) * p.out + (u.cw || 0) * p.cw + (u.cr || 0) * p.cr) / 1e6;
}
