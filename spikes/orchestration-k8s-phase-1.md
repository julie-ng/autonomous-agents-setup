### Phase 1 Design Summary: Local Kubernetes POC

**Objective:** Validate containerized, single-process **Goose** execution on a local Kubernetes cluster (`kind` or `minikube`) without complex abstractions (no `gVisor`, no sidecars, no custom operators, and no `SandboxClaim` CRDs).

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ LOCAL KUBERNETES CLUSTER (kind / minikube)                                     │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Kubernetes Job (goose-poc-job)                                            │  │
│  │                                                                           │  │
│  │  ┌────────────────────────┐         ┌──────────────────────────────────┐  │  │
│  │  │ Init Container         │         │ Main Container                   │  │  │
│  │  │ (git-clone)            │         │ (goose-agent)                    │  │  │
│  │  │                        │ Volume  │                                  │  │  │
│  │  │ • Clones target repo   │────────►│ • Runs single Goose binary       │  │  │
│  │  │ • Checks out target    │ Mount   │ • Reads prompt via env/args      │  │  │
│  │  │   branch               │ (/workspace) • Native self-correction loop  │  │  │
│  │  │                        │         │ • Generates code & commits back  │  │  │
│  │  └────────────────────────┘         └──────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼ (git push)
                                 ┌──────────────────┐
                                 │ GitHub Repository│
                                 └──────────────────┘

```

---

### Core Principles for Phase 1

1. **Single Container Execution:** Goose natively handles model context, tool calling, and self-correction loops, and includes an embedded ACP interface. No sidecars or outer agent frameworks (like LangGraph) are necessary.
2. **Native K8s Primitives:** Use standard Kubernetes `Jobs`, `Secrets`, and `ConfigMaps` to validate end-to-end task execution before introducing event routing or complex CRDs.
3. **Standard Security Boundaries:** Standard container isolation with rootless execution and secret mounts provides sufficient sandboxing for local development.

---

### Phase 1 Manifest (`job.yaml`)

This complete manifest demonstrates running a containerized Goose agent against a target repository.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: goose-agent-poc
  namespace: default
spec:
  ttlSecondsAfterFinished: 300 # Auto-cleanup 5 mins after completion
  backoffLimit: 0 # Fail fast during POC testing
  template:
    spec:
      restartPolicy: Never
      
      # Shared workspace volume for the Git repo
      volumes:
        - name: workspace-volume
          emptyDir: {}

      # Step 1: Clone the repository
      initContainers:
        - name: git-clone
          image: alpine/git:latest
          volumeMounts:
            - name: workspace-volume
              mountPath: /workspace
          workingDir: /workspace
          env:
            - name: GITHUB_TOKEN
              valueFrom:
                secretKeyRef:
                  name: github-credentials
                  key: token
          command: ["/bin/sh", "-c"]
          args:
            - |
              git clone https://x-access-token:${GITHUB_TOKEN}@github.com/your-org/your-repo.git .
              git config user.name "Goose Agent"
              git config user.email "agent@goose.local"
              git checkout -b feature/agent-poc-execution

      # Step 2: Run the Goose Agent
      containers:
        - name: goose-agent
          image: your-org/goose-cli:latest # Container image containing goose binary
          workingDir: /workspace
          volumeMounts:
            - name: workspace-volume
              mountPath: /workspace
          env:
            # Model API keys (OpenRouter, DeepSeek, OpenAI, etc.)
            - name: OPENROUTER_API_KEY
              valueFrom:
                secretKeyRef:
                  name: model-credentials
                  key: api-key
            - name: GOOSE_PROVIDER
              value: "openrouter"
            - name: GOOSE_MODEL
              value: "deepseek/deepseek-r1"
            # Execution Goal / Task Prompt
            - name: TASK_PROMPT
              value: "Refactor main.py to improve error handling and write a unit test for the user login function."
          command: ["goose"]
          args:
            - "run"
            - "--text"
            - "$(TASK_PROMPT)"

---
# Model Credentials Secret
apiVersion: v1
kind: Secret
metadata:
  name: model-credentials
type: Opaque
stringData:
  api-key: "sk-or-v1-your-api-key-here"
---
# GitHub Credentials Secret
apiVersion: v1
kind: Secret
metadata:
  name: github-credentials
type: Opaque
stringData:
  token: "ghp_your_github_token_here"

```

---

### Phase 1 Validation Checklist

* **Execute local job:** `kubectl apply -f job.yaml`
* **Verify execution logs:** `kubectl logs -f job/goose-agent-poc -c goose-agent`
* **Inspect results:** Confirm Goose modified the repository inside `/workspace` and successfully pushed the feature branch back to GitHub.
