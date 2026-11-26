import os from 'node:os';
import path from 'node:path';

export function claudeProjectsDir(env = process.env) {
  const base = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

export function stateDir(env = process.env) {
  return env.AGENT_OPS_HOME || path.join(os.homedir(), '.agent-ops');
}
