#!/usr/bin/env node
// Demo mode: writes a synthetic (fake) Claude Code history to a temp dir and starts Agent Ops on it.
// Used for README screenshots and for trying the UI without real logs.  Usage: node scripts/demo.js [--port 4318] [--open]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(os.tmpdir(), 'agent-ops-demo');
const projects = path.join(root, 'claude', 'projects');
fs.rmSync(root, { recursive: true, force: true });

const NOW = Date.now();
const at = (minAgo) => new Date(NOW - minAgo * 60e3).toISOString();
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5';
let n = 0;
const id = (p) => `${p}${++n}`;
const usage = (o, cw, cr) => ({ input_tokens: 4, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr });
const tu = (name, input) => ({ type: 'tool_use', id: id('tu'), name, input });
// file mtime = last record time, so running / waiting / stopped status looks real
const write = (file, recs) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const last = new Date(recs.reduce((m, r) => (r.timestamp && r.timestamp > m ? r.timestamp : m), '')); if (!isNaN(last)) fs.utimesSync(file, last, last); };

// a turn = one assistant message with tools, followed by their results
function turns(ctx, list) {
  const out = [];
  for (const [minAgo, model, tools, o, cw, cr, err] of list) {
    const content = tools.map(([name, input]) => tu(name, input));
    out.push({ type: 'assistant', timestamp: at(minAgo), sessionId: ctx.sid, cwd: ctx.cwd, entrypoint: 'claude-vscode',
      message: { id: id('m'), role: 'assistant', model, content, usage: usage(o, cw, cr), stop_reason: content.length ? 'tool_use' : 'end_turn' } });
    if (content.length) out.push({ type: 'user', timestamp: at(minAgo - 0.2), message: { role: 'user',
      content: content.map((c, i) => ({ type: 'tool_result', tool_use_id: c.id, is_error: !!(err && i === 0), content: 'ok' })) } });
  }
  return out;
}

function session({ proj, sid, title, cwd, start, main, subs = [] }) {
  const ctx = { sid, cwd };
  const head = [{ type: 'ai-title', aiTitle: title, timestamp: at(start), sessionId: sid, cwd },
    { type: 'user', timestamp: at(start), sessionId: sid, cwd, entrypoint: 'claude-vscode', message: { role: 'user', content: title } }];
  const spawns = subs.map((s) => ({ ...s, tool: tu('Agent', { description: s.desc, model: s.model === OPUS ? 'opus' : 'sonnet' }) }));
  const mainRecs = turns(ctx, main);
  for (const s of spawns) mainRecs.push({ type: 'assistant', timestamp: at(s.start), sessionId: sid, cwd,
    message: { id: id('m'), role: 'assistant', model: OPUS, content: [s.tool], usage: usage(300, 2000, 90000), stop_reason: 'tool_use' } });
  mainRecs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  write(path.join(projects, proj, sid + '.jsonl'), head.concat(mainRecs));
  spawns.forEach((s, i) => {
    const aid = `a${sid}${i}`;
    write(path.join(projects, proj, sid, 'subagents', `agent-${aid}.jsonl`), turns(ctx, s.turns));
    fs.writeFileSync(path.join(projects, proj, sid, 'subagents', `agent-${aid}.meta.json`), JSON.stringify({
      agentType: 'general-purpose', description: s.desc, model: s.model === OPUS ? 'opus' : 'sonnet', toolUseId: s.tool.id, spawnDepth: 1, finished: !!s.done }));
  });
}

const work = (m, k) => Array.from({ length: k }, (_, i) => [m - i * 0.7, SONNET, [i % 3 ? ['Edit', { file_path: `/repo/api/src/Billing/Invoice${i}.cs`, old_string: 'a', new_string: 'a\nb' }] : ['Bash', { command: 'dotnet test --filter Billing' }]], 900, 6000, 40000, i === 4]);

// 1. a team at work: plan → implement in parallel → review
session({ proj: 'acme-billing', sid: 'demo-billing', title: 'Add invoice export to the billing API', cwd: '/repo/acme-billing', start: 55,
  main: [[54, OPUS, [['Skill', { skill: 'superpowers:brainstorming' }]], 2000, 30000, 0],
    [40, OPUS, [['Skill', { skill: 'superpowers:writing-plans' }], ['Write', { file_path: '/repo/docs/plans/invoice-export.md', content: 'plan\n'.repeat(40) }]], 4000, 12000, 200000],
    [33, OPUS, [['Skill', { skill: 'superpowers:subagent-driven-development' }]], 800, 4000, 300000],
    [3, OPUS, [['SendMessage', { to: 'T2', summary: 'Fix round: handle empty invoices' }]], 400, 1000, 400000],
    [0.4, OPUS, [['Bash', { command: 'git log --oneline -5' }]], 300, 800, 420000]],
  subs: [
    { desc: 'Implement Task 1: export endpoint', model: SONNET, start: 30, done: true, turns: work(29, 9).concat([[20, SONNET, [['SubagentHandback', {}]], 200, 100, 60000]]) },
    { desc: 'Implement Task 2: CSV writer', model: SONNET, start: 29, turns: work(12, 14) },
    { desc: 'Implement Task 3: UI download button', model: OPUS, start: 28, turns: work(8, 10) },
    { desc: 'Review Task 1 (spec + quality)', model: SONNET, start: 19, done: true, turns: [[18, SONNET, [['Read', { file_path: '/repo/api/src/Billing/Export.cs' }], ['Grep', { pattern: 'Invoice' }]], 600, 5000, 30000], [16, SONNET, [['SubagentHandback', {}]], 200, 100, 30000]] },
  ] });
// 2. waiting for the user
session({ proj: 'acme-web', sid: 'demo-web', title: 'Fix flaky login E2E test', cwd: '/repo/acme-web', start: 95,
  main: [[94, OPUS, [['Skill', { skill: 'superpowers:systematic-debugging' }]], 900, 20000, 0],
    ...Array.from({ length: 12 }, (_, i) => [90 - i * 3, OPUS, [i % 2 ? ['mcp__playwright__browser_navigate', { url: 'http://localhost:5173/login' }] : ['Bash', { command: 'npx playwright test login.spec.ts' }]], 700, 3000, 90000 + i * 9000, i === 3 || i === 7]),
    [52, OPUS, [], 600, 1000, 200000]] });
// 3. finished solo sessions across projects
const solo = (proj, sid, title, start, k, tool) => session({ proj, sid, title, cwd: '/repo/' + proj, start,
  main: Array.from({ length: k }, (_, i) => [start - i * 2, i % 4 ? SONNET : OPUS, [tool(i)], 500, 2500, 50000 + i * 6000, i % 9 === 5]) });
solo('acme-billing', 'demo-db', 'Speed up the reports query', 300, 30, (i) => ['Bash', { command: i % 2 ? 'psql -f explain.sql' : 'dotnet build' }]);
solo('acme-web', 'demo-dark', 'Dark mode for settings page', 1500, 40, (i) => ['Edit', { file_path: `/repo/acme-web/src/settings/Theme${i % 5}.tsx`, old_string: 'a', new_string: 'b' }]);
solo('acme-mobile', 'demo-push', 'Push notification permissions', 2900, 25, (i) => ['Read', { file_path: `/repo/acme-mobile/ios/Push${i % 4}.swift` }]);
solo('acme-docs', 'demo-docs', 'Write the onboarding guide', 4300, 18, (i) => ['mcp__claude_ai_Claude_Docs__update', { id: 'guide' }]);
solo('acme-billing', 'demo-tax', 'VAT rounding bug', 7000, 22, (i) => ['Grep', { pattern: 'Round' }]);

console.log('Demo data: ' + projects);
const port = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '4318';
const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agent-ops.js');
const child = spawn(process.execPath, [bin, '--port', port, process.argv.includes('--open') ? '--open' : '--no-open'], {
  stdio: 'inherit', env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(root, 'claude'), AGENT_OPS_HOME: path.join(root, 'state') } });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
child.on('exit', (code) => process.exit(code ?? 0));
