# Orchestration

GitHub issue → agent runs in a pod → branch pushed → PR. No human at a terminal.

```
┌─────────────────────────────────────────────────────────────┐
│ 🐙 GitHub                                                   │
│                                                             │
│  Issue or comment, e.g. "/goose fix the logger"             │
└──────────────────────────┬──────────────────────────────────┘
                           │ webhook
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ ☸️  Kubernetes                                               │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Event router                                          │  │
│  │ validates signature, filters, extracts prompt         │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │ creates                      │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Job (one per task, fire-and-die)                      │  │
│  │                                                       │  │
│  │  ┌─────────────────┐        ┌──────────────────────┐  │  │
│  │  │ init: git clone │───────►│ 🪿 goose             │  │  │
│  │  │ + agent identity│ volume │ runs the task        │  │  │
│  │  └─────────────────┘        └──────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ git push (agent's own SSH key)
                           ▼
                    ┌─────────────┐
                    │ 🐙 branch   │
                    │ → PR        │
                    └─────────────┘
```

## Why this shape

- **Job, not a long-lived service.** One task, one pod, then gone. No session state to manage, no idle cost.
- **The pod is the boundary.** Namespace isolation, no host access, disposable. See [identity.md](./identity.md) for what credentials it holds.
- **GitHub is the interface.** Requests arrive as issues, results arrive as PRs. Nothing to attach to, nothing to babysit.
- **One container.** goose has ACP built in — no sidecar. See [goose-agent.md](./goose-agent.md).

## Phases

| | |
|---|---|
| **1** | Manual `kubectl apply`. Prove a Job clones, runs goose, pushes a branch. |
| **2** | Webhook + event router. Same Job, triggered by GitHub instead of by me. |
| **3** | Whatever the first two make obvious. Not designed yet. |

Spikes and manifests: [`spikes/`](../spikes/)

## Known sharp edges

Known and deferred. Not the focus during spike phase.

- **Trigger filtering.** Fire on every `issue_comment` and the agent's own PR comment triggers another run. Needs an explicit opt-in — magic comment or label.
- **Branch collisions.** Hardcoded branch names break on concurrent runs. Parameterize.
- **Prompt injection.** Issue text goes straight into the agent's prompt. On a public repo that's untrusted input with a credential in the same pod.
- **Runaway cost.** No `activeDeadlineSeconds` means a self-correction loop burns tokens until noticed.
- **Silent failure.** Async job, no feedback in GitHub. Looks like nothing happened.

Detail: [`spikes/orchestration-k8s-gotchas.md`](../spikes/orchestration-k8s-gotchas.md)

## Decision log

| Decision | Notes |
|---|---|
| Unit of work | K8s `Job`. One task per pod, fire-and-die. |
| Trigger | GitHub webhook. Manual `kubectl apply` in Phase 1. |
| Isolation | Standard container. No gVisor/Kata — no PII or compliance surface in this cluster. |
| Containers per Job | Init (clone + identity) + one main (goose). No sidecar. |
| Observability | `kubectl logs -f` for Phase 1. Defer shipping to Phase 2. |

### Accepted Trade-Offs

| Tradeoff | Notes |
|---|---|
| Shared kernel | Container, not microVM. Cluster runs my own code, threat model doesn't require a hypervisor. |
| No mid-task intervention | Fire-and-die means watching logs, not steering. ACP is available if that changes. |
| Cold start per task | No warm pool. Fine at one-task-at-a-time; revisit if latency matters. |
