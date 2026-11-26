---
allowed-tools: Bash(node:*)
description: Open the Agent Ops dashboard (local, read-only view of Claude Code sessions)
---

Start the Agent Ops dashboard in the background so it does not block this session, by running this Bash command with `run_in_background: true`:

`node "${CLAUDE_PLUGIN_ROOT}/bin/agent-ops.js" --open`

Then read its first output line (`Agent Ops: <url>` or `Agent Ops already running: <url>`) and tell the user the URL. Do nothing else.
