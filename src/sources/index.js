import { claudeCode } from './claude-code/index.js';

export const SOURCES = [claudeCode];

export function listSources(env = process.env) {
  return SOURCES.map((s) => ({ id: s.id, label: s.label, color: s.color, available: !!s.detect(env) }));
}
