# Infra design — high level

> [!NOTE]
> Draft. Not committed yet. Captures two decisions before they're lost — needs to be fleshed out and cross-linked with [coding-harness-design-summary.md](./coding-harness-design-summary.md) and [orchestration.md](./orchestration.md).

Scope: how the harness design (agent + N sub-agents, delegation) actually gets deployed and where things live at runtime. `orchestration.md` covers a single Job's shape; this is the picture across multiple agents/tasks.

## Model per delegation

- Each sub-agent = its own pod = its own goose process. Model is process-level config in goose (`GOOSE_PROVIDER` / `GOOSE_MODEL` env, or baked `active_provider`) — confirmed in [goose-agent.md](./goose-agent.md) and the containerizing-goose spike.
- One process can't switch models mid-run. But since delegation = a new pod anyway, each delegated task can get its own model — no workaround needed, falls out of the pod-per-agent shape for free.
- Goal: fit-for-purpose models. Orchestrator delegates a task and picks (or is told) which model handles it — cheap model for narrow/mechanical work, stronger model for judgment-heavy work.
- Mechanism sketch: `delegate(task, model=...)` sets `GOOSE_MODEL`/`GOOSE_PROVIDER` on the spawned Job's container env.
- **Open question:** who picks the model — orchestrator's own judgment, the human, or orchestrator proposes + gate confirms? Maps onto the harness doc's code-vs-prose gate split; not decided yet.

## Shared state: blob storage, not shared local state

- No shared *local* state between agents/pods — by design, already stated in the harness doc (state = per-process transcript, nothing shared).
- For artifacts that do need to move between agents: Azure Blob Storage.
- **Invariant: create-only, never overwrite.** Each agent only CREATEs its own artifacts; no agent PUTs/overwrites another's. Sidesteps concurrent-write conflicts entirely rather than solving them (locking, merge, last-write-wins, etc. — none of that needed if writes never collide by construction).
- Read access can be shared; write access is single-owner per artifact.
- **Open question:** naming/addressing scheme so a downstream agent can find an upstream agent's artifact (task ID? delegation-chain path? Not designed yet.)

## Decision log

| Date | Decision | Notes |
|---|---|---|
| 2026-09-04 | Model is chosen per delegated task, not fixed cluster-wide | Falls out of pod-per-sub-agent; set via env at Job spawn time |
| 2026-09-04 | Cross-agent artifacts go through Azure Blob Storage, create-only | Avoids multi-writer problem by construction; no shared local/pod state |
