### Architectural Hand-Off: Sandboxed Autonomous Coding Agents on Kubernetes

**Project Goal:** Transition from a local interactive agent harness (`agent-manager.dev`) to an autonomous, cost-effective, multi-agent execution pipeline on Kubernetes using **Goose**, **`k8s-sigs/agent-sandbox`**, and **GitHub**.

---

### Core Architecture Overview

```
                      ┌─────────────────────────────────────────────────────────────┐
                      │                     KUBERNETES CLUSTER                      │
                      │                                                             │
┌──────────────────┐  │  ┌───────────────────────────────────────────────────────┐  │
│  GitHub Event    │  │  │ Agent Sandbox Pod (gVisor Runtime)                    │  │
│  (Issue / PR)    │  │  │                                                       │  │
└────────┬─────────┘  │  │  ┌────────────────────────┐  ┌──────────────────────┐ │  │
         │ Webhook    │  │  │ Main Container: Goose  │  │ Sidecar Container    │ │  │
         ▼            │  │  │                        │  │                      │ │  │
┌──────────────────┐  │  │  │ • Coding & Execution   │◄─┼─► ACP / MCP Server   │ │  │
│ Event Controller │──┼──┼─►│ • Native Retry Loop    │  │                      │ │  │
│ (Custom / K8s)   │  │  │  │ • Local .goosehints    │  │ • Sits on localhost  │ │  │
└──────────────────┘  │  │  └────────────────────────┘  └──────────┬───────────┘ │  │
                      │  └─────────────────────────────────────────┼─────────────┘  │
                      └────────────────────────────────────────────┼────────────────┘
                                                                   │
                                                                   ▼
                                                         ┌──────────────────┐
                                                         │ GitHub PR / Diff │
                                                         └──────────────────┘

```

The system cleanly separates the **Data Plane** (secure, containerized Goose execution inside isolated Pods) from the **Control Plane** (GitHub webhooks and Kubernetes Pod lifecycle management).

---

### Key Architectural Components

#### 1. Data Plane & Sandboxing (`k8s-sigs/agent-sandbox`)

* **Pod Runtime:** Agents run as disposable Kubernetes Pods isolated via **gVisor** to prevent arbitrary code execution vulnerabilities from breaching the host kernel.
* **Lifecycle Management:** Leverages the **Kubernetes SIGs `agent-sandbox**` project (using `Sandbox` and `SandboxClaim` CRDs) to maintain pre-warmed pod pools, handle fast volume snapshotting, and enforce strict network egress policies.
* **Session Execution:** Upon job creation, an init container fetches the targeted GitHub repository. The Goose agent executes the requested task, produces code modifications, pushes a git branch, and opens a Pull Request before the Pod terminates.

#### 2. Agent Runtime (Goose)

* **Role:** Serves as the single-session execution engine inside the container.
* **Prompt Engineering & System Rules:** Custom agent behavior and repository-specific coding standards are defined directly via dynamic `.goosehints` files and `.yaml` recipes rather than external code abstractions.
* **Self-Correction & Tooling:** Goose handles its own internal cognitive loops out of the box—capturing `stderr`, retrying failed linter/test commands, managing model context windows, and executing tools via the Model Context Protocol (MCP).

#### 3. Communications & Control Plane

* **ACP Sidecar Bridge:** The Agent Communication Protocol (ACP) server runs as a sidecar alongside Goose inside the Pod. External systems interact with the agent strictly through JSON-RPC endpoints over WebSockets/HTTP rather than parsing terminal output (`tmux`/`stdout`).
* **Triggering Mechanism:** GitHub Webhooks (Issues, PR comments) trigger an outer workflow/controller that creates a Kubernetes `SandboxClaim` or `Job`, passing task parameters directly to the ACP sidecar interface.

---

### Component Responsibility Matrix: Goose + K8s Setup

| Primitives | How Goose Handles It (Inside Pod) | How K8s & GitHub Layer Handles It (Outer Layer) | Wiring / Integration Mechanism |
| --- | --- | --- | --- |
| **Retry Mechanics** | **In-session self-correction:** Captures `stderr` from failed tests/bash commands and re-prompts the model to fix code syntax or logical bugs. | **Infrastructure failures:** Handles Pod crashes, node evictions, OOM kills, or container timeouts by re-queuing the K8s `Job` or `SandboxClaim`. | Goose handles loop internally; K8s `restartPolicy: OnFailure` or Operator logic manages container crash retries. |
| **Prompting** | **Execution context:** Reads repo-specific rules via `.goosehints` and execution specs via `.yaml` YAML recipes. | **Goal dispatch:** Extracts task goals from incoming GitHub Issues or Pull Request descriptions. | K8s controller injects the GitHub issue body into the ACP JSON-RPC payload during Pod initialization. |
| **Human-In-The-Loop (HITP)** | **In-flight pauses:** Halts execution when requesting explicit approval for sensitive actions (e.g., executing high-risk commands). | **Asynchronous approval:** Listens for human actions (e.g., approving a GitHub PR or commenting `/approve` on an issue). | ACP sidecar exposes status over WebSockets; an external bot posts a comment to GitHub asking for a maintainer review. |
| **State & Persistence** | **Ephemeral state:** Manages token window pruning, working git tree edits, and active session history in RAM/local disk. | **Long-term persistence:** Stores durable artifacts outside the container (Git commits, PR diffs, log streams). | Init containers pull the git branch at startup; main container executes `git push` or opens a GitHub PR upon completion. |

---

### Key Technical Decision: Why NOT LangGraph?

| Dimension | Goose + K8s Native | LangGraph |
| --- | --- | --- |
| **Cognitive Loop** | Built-in (Goose manages prompt execution, tool retries, context window pruning, and MCP interactions). | Requires writing custom Python graphs for prompt orchestration, state routing, and tool loops from scratch. |
| **SDLC Alignment** | Pre-built specifically for file-editing, git actions, repo context, and coding workflows. | General-purpose graph engine; coding capabilities must be custom-coded. |
| **System Boundary** | Keeps agent logic encapsulated inside the execution engine; K8s manages infrastructure. | Blurs the line between agent reasoning logic and outer workflow orchestration. |

**Verdict:** LangGraph is redundant in this setup. Using it would force us to rebuild coding loops, tool execution routines, and error-handling mechanisms that Goose already provides natively out of the box.

---

### Implementation Roadmap

1. **Phase 1 (Local Sandbox Proof of Concept):** Configure a local Kubernetes cluster (`kind` / `minikube`) with `gVisor`. Deploy Goose inside a Pod using an ACP sidecar wrapper to verify JSON-RPC job execution.
2. **Phase 2 (CRD Integration):** Integrate the `k8s-sigs/agent-sandbox` CRDs to handle pre-warmed pod allocations and automatic cleanup upon task completion.
3. **Phase 3 (GitHub Event Orchestration):** Build a lightweight webhook receiver to translate GitHub Issue events into K8s `SandboxClaim` objects and monitor resulting Pull Requests.
4. **Phase 4 (Model Optimization):** Swap default model backends from commercial subscriptions (Claude via ACP) to cost-effective alternatives (e.g., DeepSeek-Coder, Qwen 2.5 Coder, or OpenRouter endpoints) without altering the K8s orchestration logic.
