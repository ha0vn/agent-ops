import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const T = (min, sec = 0) => `2026-11-26T03:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}Z`;
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const usage = (i, o, cw, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr });
const asst = (ts, id, model, content, u, extra = {}) => ({
  type: 'assistant', timestamp: ts, sessionId: extra.sessionId, cwd: extra.cwd, entrypoint: extra.entrypoint,
  message: { id, role: 'assistant', model, content, ...(u ? { usage: u } : {}), stop_reason: extra.stop },
});
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
const jl = (arr) => arr.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n';
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// Writes a fake Claude Code projects tree under `root` (recreated cleanly each call).
export function makeFixtures(root) {
  const abs = path.resolve(root);
  const allowed = [os.tmpdir(), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp')];
  if (!allowed.some((a) => abs.startsWith(path.resolve(a) + path.sep))) throw new Error('makeFixtures: refusing root outside tmpdir or test/.tmp: ' + abs);
  fs.rmSync(abs, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const c1 = { sessionId: 's1', cwd: '/work/alpha', entrypoint: 'cli' };
  const m1u = usage(10, 100, 1000, 5000);
  write(path.join(root, 'proj-a', 's1.jsonl'), jl([
    { type: 'ai-title', aiTitle: 'Alpha task', timestamp: T(0), sessionId: 's1', cwd: '/work/alpha' },
    { type: 'user', timestamp: T(0, 5), sessionId: 's1', cwd: '/work/alpha', entrypoint: 'cli', message: { role: 'user', content: 'start alpha' } },
    asst(T(1), 'm1', OPUS, [toolUse('tu-skill1', 'Skill', { skill: 'superpowers:brainstorming' })], m1u, c1),
    // same message id again (streamed as a separate line): its tool_use counts, its usage must not
    asst(T(1, 1), 'm1', OPUS, [{ type: 'text', text: 'Tiếng Việt: working on it' }, toolUse('tu-read1', 'Read', { file_path: '/work/alpha/README.md' })], m1u, c1),
    { type: 'user', timestamp: T(1, 3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-skill1', content: 'ok' }] } },
    asst(T(2), 'm2', OPUS, [
      toolUse('tu-agent1', 'Agent', { description: 'Implement Task 1: core', model: 'sonnet', prompt: 'do it' }),
      toolUse('tu-b1', 'Bash', { command: 'cd /w && npm test --user dev@example.com' }),
    ], usage(0, 50, 0, 8000), c1),
    { type: 'user', timestamp: T(2, 30), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-b1', is_error: true, content: 'fail' }] } },
    asst(T(3), 'm3', OPUS, [
      toolUse('tu-mcp1', 'mcp__playwright__browser_navigate', { url: 'http://localhost:5180' }),
      toolUse('tu-w1', 'Write', { file_path: '/work/alpha/src/a.js', content: 'x\ny' }),
    ], null, c1),
    '{bad json',
    { type: 'mystery', timestamp: T(3, 10) },
    asst(T(4), 'm4', '<synthetic>', [{ type: 'text', text: 'API error' }], null, c1),
  ]));

  const c2 = { sessionId: 's1', cwd: '/work/alpha' };
  write(path.join(root, 'proj-a', 's1', 'subagents', 'agent-a1.jsonl'), jl([
    asst(T(5), 'sa1', SONNET, [
      toolUse('tu-r1', 'Read', { file_path: '/work/alpha/src/a.js' }),
      toolUse('tu-e1', 'Edit', { file_path: '/work/alpha/src/a.js', old_string: 'x', new_string: 'x\nz' }),
      toolUse('tu-h1', 'SubagentHandback', {}),
    ], usage(5, 20, 200, 1000), c2),
  ]));
  write(path.join(root, 'proj-a', 's1', 'subagents', 'agent-a1.meta.json'), JSON.stringify({
    agentType: 'general-purpose', description: 'Implement Task 1: core', model: 'sonnet', toolUseId: 'tu-agent1', spawnDepth: 1, finished: true,
  }));

  const c3 = { sessionId: 's2', cwd: '/work/beta', entrypoint: 'cli' };
  write(path.join(root, 'proj-b', 's2.jsonl'), jl([
    { type: 'user', timestamp: T(10), sessionId: 's2', cwd: '/work/beta', entrypoint: 'cli', message: { role: 'user', content: 'hi' } },
    asst(T(10, 20), 'b1', OPUS, [{ type: 'text', text: 'Hello!' }], usage(1, 10, 100, 0), { ...c3, stop: 'end_turn' }),
  ]));
}
