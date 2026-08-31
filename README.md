# 🪿 autonomous-agents-setup

Working notes on running coding agents autonomously — real isolation boundaries, their own git identity, orchestrated outside the IDE.

## AI-Native SDLC

```
   👤 me — human architect                 🪿 geese — autonomous agents
   ─────────────────────────                ────────────────────────────
   interactive, in the loop                 headless, nobody watching

┌──────────────────────────┐             ┌──────────────────────────────┐
│ 💻 Host (my machine)     │             │ ☸️  Kubernetes                │
│                          │             │                              │
│  ┌────────────────────┐  │             │  ┌────────────────────────┐  │
│  │ 🐳 Dev Container   │  │             │  │ 🐳 Job (one per task)  │  │
│  │                    │  │             │  │                        │  │
│  │  Zed + Claude      │  │             │  │  🪿 goose              │  │
│  │  pair on design    │  │             │  │  runs the task         │  │
│  └────────────────────┘  │             │  └────────────────────────┘  │
└──────────────────────────┘             └──────────────────────────────┘
             │                                          │
             │  defines the work                        │  git push
             ▼                                          ▼
      ┌──────────────────────────────────────────────────────┐
      │ 🐙 GitHub — issues in, branches out                  │
      └──────────────────────────────────────────────────────┘
```

- **Me — the human architect.** Interactive session in a [dev container](./architecture/dev-container.md), paired with the LLM on my host. I define the work and review what comes back.
- **The geese — autonomous agents.** Pick up work I've already defined, run headless in a pod, push a branch. Nobody watching.

The point is not to babysit sessions. No approving every change, no manually pushing to GitHub.

## Design Goals

### Security

- Isolation is a boundary, not config rules.
- Agent has own identity
  - separate cryptographically signed commits
  - own credentials to SDLC services, e.g. git, deployments, etc.
  - only write scope is pushing its own branch

### Orchestration

- Runs headless. GitHub issue in, PR out.
- Visibility into a stuck or crashed agent that doesn't depend on it reaching GitHub.

### Agents (fit-for-purpose)

- Run _autonomously_ outside the IDE, in parallel, without them colliding.
- Task specific agents, e.g. `frontend-dev` vs `backend-dev`, vs `qa-checker`
- Size-for-purpose, e.g. use cheaper models, which work fine in decomposed tasks.
- **One task, one goose, one pod.** No nesting — a goose spawning its own subagents means no per-task model control and no visibility, which is what I'm moving away from.

## Architecture

| | |
|---|---|
| [Isolation levels](./architecture/README.md) | What counts as a boundary, what's only a deterrent |
| [Dev container](./architecture/dev-container.md) | My interactive session. Current setup. |
| [goose](./architecture/goose-agent.md) | The agent runtime. ACP built in, model-agnostic. |
| [Identity](./architecture/identity.md) | Agent vs. me. Own GitHub account, own SSH key. |
| [Orchestration](./architecture/orchestration.md) | GitHub → K8s Job → branch → PR |

Spikes and working code: [`spikes/`](./spikes/). Retired directions: [`stale/`](./stale/).

## Current Progress

### Agent Setup

- [X] Install and test goose
- [X] Connect Claude subscription via ACP (local dev)
- [X] Containerize goose — headless, API key, zero interactive setup
- [X] Drive goose programmatically over ACP
- [ ] `gh` CLI in the image
- [ ] Agent SSH key — clone, push, signed commits

### Orchestration

- [ ] Phase 1 — local `k3d` cluster, `kubectl apply` a Job, push a branch
- [ ] Phase 2 — GitHub webhook triggers the Job
- [ ] Phase 3 — TBD, whatever the first two make obvious

### Customization

- [ ] Package custom skills, MCP servers, plugins with goose agent.
- [ ] Deploy custom goose-agent as Docker image

## Decision Log

| Decision | Notes |
|---|---|
| Isolation | `settings.json` allow/deny rules are a deterrent, not a boundary. Container is the boundary. |
| My session | Dev container in Zed. Interactive, me in the loop. |
| Harness | goose. Model-agnostic, headless, AAIF-governed — no vendor lock-in. |
| LLM auth | API keys for headless agents. ACP on my Claude subscription for local dev only. |
| Agent identity | Own GitHub account and ED25519 key. Deploy keys can't sign commits. |
| Orchestration | K8s `Job`, one task per pod, fire-and-die. No sidecar — ACP is native to goose. |
| No nested agents | One task, one goose, one pod. Specialization comes from what I dispatch, not from a goose spawning subagents. |

### Retired

| | Why |
|---|---|
| Docker Sandbox (`sbx`) | Worked, but local-machine only. Doesn't lead to remote agents. |
| `agent-manager` / session managers | Built for attaching to interactive panes. Webhook → pod → PR has no pane. |

Detail in [`stale/`](./stale/).

## References

- [agents.md](https://agents.md/)
- [goose](https://goose-docs.ai/) - open source AI Agent (part of [AAIF](https://github.com/aaif-goose/goose))
