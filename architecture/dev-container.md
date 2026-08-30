# Dev Container — the human architect's session

Where I work. Interactive, paired with the LLM, me in the loop.

Not where autonomous agents run — see [orchestration.md](./orchestration.md) for that.

[Isolation Level 1](./README.md) — Dev containers in Zed.

## Why

- Agent cannot `cd ../` into the parent folder.
- Memory persists across sessions.
- My personal credential files — `~/.ssh`, `~/.aws/credentials` — aren't accessible.

## Limits

Reasons this works for pairing but **not** for autonomous work:

- Shared host kernel.
- Secure but slow — I rarely grant broad permissions, so it's "Allow once" for _every_ change.
- Claude owns and drives subagents:
  - No _per-task_ model selection. Subagents inherit the main session's model, e.g. Opus — not cost effective. `CLAUDE_CODE_SUBAGENT_MODEL` isn't task-configurable.
  - No visibility into subagents. Wait until it finishes to find out it hallucinated. I want live inspection and course-correction.
- Babysitting. Manually pushing changes to GitHub, approving each step.

## Setup

To persist Claude's memory across sessions, via mounts:

- **Persisted Memory** — `~/.claude`, keyed by workspace path slug
- **Workspace Folder** — mirroring the exact host path so the slug matches

The host path is hard-coded into the config:

```json
/* Example .devcontainer.json */
{
  "name": "Claude Node Sandbox",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:22",
  "workspaceMount": "source=${localWorkspaceFolder},target=/Users/jng/workspace/julie-ng/tally-split-ai,type=bind,consistency=cached",
  "workspaceFolder": "/Users/jng/workspace/julie-ng/tally-split-ai",
  "mounts": [
    "source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind",
    "target=${containerWorkspaceFolder}/node_modules,type=volume"
  ],
  "onCreateCommand": "sudo chown -R node:node ${containerWorkspaceFolder}/node_modules",
  "postCreateCommand": "npm install && npm install -g @anthropic-ai/claude-code",
  "customizations": {
    "zed": {
      "extensions": ["eslint", "html", "sql", "vue", "mcp-server-context7"]
    }
  }
}
```

> [!WARNING]
> **Do not mount `~/.claude.json`.** Concurrent writes from host and container truncated it mid-write — invalid JSON, blocked new sessions from starting. No locking, two writers, one file.

Trade-offs of skipping it:

- folders need re-trusting every time
- need in-repo `.mcp.json`

## Decision log

| Decision | Notes |
|---|---|
| Isolation | Dev container (Level 1). Filesystem boundary, shared kernel. |
| Role | Human architect's interactive session. Not for autonomous work. |
| Mounts | `~/.claude` yes, `~/.claude.json` never. Mirror the host workspace path. |
| MCP | In-repo `.mcp.json` instead of project-scoped config. |
