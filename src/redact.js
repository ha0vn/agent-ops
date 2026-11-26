export function redact(text) {
  return String(text)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{10,}|(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,})\b/g, '[redacted]');
}

function short(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function shortCommand(cmd, max = 64) {
  const parts = String(cmd || '').split(/&&|\n/).map((x) => x.trim())
    .filter((x) => x && !/^cd\s/.test(x) && !/^[A-Z_]+=/.test(x) && !/^export\s/.test(x));
  const first = parts[0]
    || String(cmd || '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^cd\s+\S+\s*(&&|;)?\s*/, ''))[0]
    || '';
  return short(first.replace(/(["'])[^"']{40,}\1/g, '"…"'), max);
}
