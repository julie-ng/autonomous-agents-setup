# Phase 1: Local Kubernetes POC

**Objective:** Validate containerized, single-process goose execution on a local cluster (`kind` or `minikube`). No gVisor, no sidecars, no operators, no CRDs.

**Goal:** a `kubectl apply` produces a pushed branch.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ LOCAL KUBERNETES CLUSTER (kind / minikube)                                      │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Kubernetes Job (goose-poc-job)                                            │  │
│  │                                                                           │  │
│  │  ┌────────────────────────┐         ┌──────────────────────────────────┐  │  │
│  │  │ Init Container         │         │ Main Container                   │  │  │
│  │  │ (git-clone)            │         │ (goose-agent)                    │  │  │
│  │  │                        │ Volume  │                                  │  │  │
│  │  │ • Clones via SSH       │────────►│ • Runs single goose binary       │  │  │
│  │  │ • Sets agent identity  │ Mount   │ • Reads prompt via env/args      │  │  │
│  │  │ • Checks out branch    │(/workspace) • Commits (signed)             │  │  │
│  │  │                        │         │ • Pushes branch                  │  │  │
│  │  └────────────────────────┘         └──────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼ (git push, agent's SSH key)
                                 ┌──────────────────┐
                                 │ GitHub Repository│
                                 └──────────────────┘
```

---

## Core Principles

1. **Single container execution.** goose natively handles model context, tool calling, and self-correction, and has ACP built in. No sidecars, no outer framework.
2. **Native K8s primitives.** `Job`, `Secret`, `ConfigMap`. Nothing custom until these prove insufficient.
3. **Non-root, SSH identity.** Rootless execution enforced via `securityContext`. Agent authenticates and signs with its own key — see [identity.md](../architecture/identity.md).

---

## Identity

The agent has its own GitHub account: **`julieio-goose`**.

One ED25519 key does everything:

- **clone + push** — authentication key on the account
- **commit signing** — same key registered as a signing key, so commits get "Verified" under the agent's name

No `GITHUB_TOKEN`. SSH covers all three.

> [!IMPORTANT]
> `IdentitiesOnly=yes` in `core.sshCommand`. Without it SSH offers every key it can find.

---

## Manifest (`job.yaml`)

> [!NOTE]
> Image names and repo URLs are placeholders — not yet decided. Provider is Vercel AI Gateway for now; swappable via `GOOSE_PROVIDER` / `GOOSE_MODEL` env, which override the baked config.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: goose-agent-poc
  namespace: default
spec:
  ttlSecondsAfterFinished: 300  # auto-cleanup 5 min after completion
  backoffLimit: 0               # fail fast during POC
  template:
    spec:
      restartPolicy: Never

      # Non-root. uid 1000 = `node` in the goose image.
      # fsGroup makes the emptyDir group-writable so both containers can use it.
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000

      volumes:
        - name: workspace-volume
          emptyDir: {}
        - name: ssh-key
          secret:
            secretName: agent-ssh-key
            defaultMode: 0400   # ssh refuses group/world-readable keys

      # Step 1: clone + set agent identity
      initContainers:
        - name: git-clone
          image: alpine/git:latest   # placeholder
          volumeMounts:
            - name: workspace-volume
              mountPath: /workspace
            - name: ssh-key
              mountPath: /keys
              readOnly: true
          workingDir: /workspace
          command: ["/bin/sh", "-c"]
          args:
            - |
              set -e
              export GIT_SSH_COMMAND="ssh -i /keys/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

              git clone git@github.com:your-org/your-repo.git .

              # Agent identity — its own GitHub account, not mine
              git config user.name  "julieio-goose"
              git config user.email "<agent-account-email>"

              # Sign commits with the same SSH key
              git config gpg.format ssh
              git config user.signingkey /keys/id_ed25519
              git config commit.gpgsign true

              # Pin SSH so nothing else is offered
              git config core.sshCommand "$GIT_SSH_COMMAND"

              git checkout -b feature/agent-poc-execution

      # Step 2: run goose, commit, push
      containers:
        - name: goose-agent
          image: your-org/goose-in-a-box:latest   # placeholder
          workingDir: /workspace
          volumeMounts:
            - name: workspace-volume
              mountPath: /workspace
            - name: ssh-key
              mountPath: /keys
              readOnly: true
          env:
            - name: AI_GATEWAY_API_KEY
              valueFrom:
                secretKeyRef:
                  name: model-credentials
                  key: api-key
            - name: GOOSE_PROVIDER
              value: "vercel_ai_gateway"
            - name: GOOSE_MODEL
              value: "openai/gpt-5-mini"
            - name: TASK_PROMPT
              value: "Refactor main.py to improve error handling and write a unit test for the user login function."
          command: ["/bin/sh", "-c"]
          args:
            - |
              set -e
              goose run --text "$TASK_PROMPT"

              # Push whatever goose changed
              git add -A
              git diff --staged --quiet || git commit -m "agent: $TASK_PROMPT"
              git push origin HEAD

---
# Model credentials
apiVersion: v1
kind: Secret
metadata:
  name: model-credentials
type: Opaque
stringData:
  api-key: "<vercel-ai-gateway-key>"
---
# Agent SSH key — private key for julieio-goose
apiVersion: v1
kind: Secret
metadata:
  name: agent-ssh-key
type: Opaque
stringData:
  id_ed25519: |
    -----BEGIN OPENSSH PRIVATE KEY-----
    <agent private key>
    -----END OPENSSH PRIVATE KEY-----
```

---

## Open questions

- **Does goose commit, or does the shell?** The manifest has the shell commit after `goose run`. goose may commit on its own, which would double up. Confirm behavior and pick one.
- **PR creation.** Not here yet — `gh` CLI isn't in the image. Phase 1 stops at a pushed branch.
- **Signing with a mounted key.** `user.signingkey` pointing at a file path works for SSH signing, but is unverified in this setup.

---

## Validation checklist

- [ ] `kubectl apply -f job.yaml`
- [ ] `kubectl logs -f job/goose-agent-poc -c goose-agent`
- [ ] Init container clones without a token — SSH only
- [ ] Both containers run as uid 1000, workspace is writable
- [ ] goose modifies files in `/workspace`
- [ ] Branch appears on GitHub
- [ ] Commit is **signed** and attributed to `julieio-goose`, not me
