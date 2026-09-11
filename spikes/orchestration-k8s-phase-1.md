# Phase 1: Local Kubernetes POC

**Objective:** Validate containerized, single-process goose execution on a local `k3d` cluster. No gVisor, no sidecars, no operators, no CRDs.

**Goal:** a `kubectl apply` produces a pushed branch.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ LOCAL KUBERNETES CLUSTER (k3d)                                                  │
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
3. **Non-root, own identity.** Rootless execution enforced via `securityContext`. Agent authenticates as itself, not as me — see [identity.md](../architecture/identity.md). **The mechanism has changed:** the cloud tier targets a GitHub App with short-lived installation tokens, not the SSH key this manifest still assumes.

---

## Identity

The agent has its own GitHub account: **`julieio-goose`**.

> [!IMPORTANT]
> **Superseded — this section describes the old SSH-only model.** It assumed the agent's work ended at a pushed branch. Reading issues and opening PRs needs the REST API, which takes a token — so the identity model was reconsidered. [identity.md](../architecture/identity.md) now splits identity into a local tier (bot account + deploy key) and a cloud tier (**GitHub App**, 1-hour installation tokens). A webhook-triggered pod is the cloud tier.
>
> The manifest below still shows the SSH key Secret. It needs reworking for App-token auth before Phase 1 runs — the init container mints or receives a token rather than mounting a key.
>
> **Proven so far** (outside K8s, in [`goose-k8s-prep`](./goose-k8s-prep/)): a container can read an issue, push a branch and open a PR as `julieio-goose` using a **PAT** over HTTPS — a spike shortcut, not the target mechanism. Commit signing untested.

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

- [x] **Does goose commit, or does the shell?** **The shell.** goose leaves the working tree dirty and does not commit on its own — verified 2026-09-11 in [`goose-k8s-prep`](./goose-k8s-prep/README.md#goose-does-not-commit-on-its-own). No double-fire. Caveat: goose was not *asked* to commit; a prompt that says "commit your work" presumably would, so task prompts must not ask.
- **PR creation.** Not here yet — `gh` CLI isn't in the image. Phase 1 stops at a pushed branch.
- **Signing with a mounted key.** `user.signingkey` pointing at a file path works for SSH signing, but is unverified in this setup.

### Exit code 0 does not mean the task succeeded

> [!IMPORTANT]
> **The manifest's `set -e` + `goose run` is not enough.** `goose run` exits 0 whenever the process did not crash — it signals turn completion, not task success. Three routes to exit-0-with-no-work are observed ([detail](./goose-k8s-prep/README.md#exit-code-0-is-not-a-success-signal)): a skill-injected confirmation prompt, a workspace permission failure, and `--max-turns` exhaustion.
>
> **A Job would read all three as success.** This is not a goose defect and no flag fixes it — success criteria belong here, in the orchestration layer.
>
> The `args` below need an artifact assertion: fail when the staged diff is empty. All three routes produce that same observable.

```sh
goose run --recipe /recipes/task.yaml --params ...

git add -A
if git diff --staged --quiet; then
  echo "FAIL: goose produced no changes" >&2
  exit 1
fi
git commit -m "..."
git push origin HEAD
```

> [!NOTE]
> This conflates "no changes needed" with "agent failed." Right default for Phase 1 — a Job whose purpose is to push a branch has failed if it pushes nothing.

### Missing: `activeDeadlineSeconds`

The Job has `backoffLimit: 0` and `ttlSecondsAfterFinished`, but **no wall-clock bound**. `--max-turns` caps iterations, not time, and the recipe schema has no timeout field — so a hung run has nothing to stop it. Listed as a fix in [gotchas](./orchestration-k8s-gotchas.md), still absent from the manifest above.

### Switch `--text` to a recipe

The manifest runs `goose run --text "$TASK_PROMPT"`. [`goose-container`](./goose-container/) found recipes the better path for headless runs, and `--recipe` / `--params` both exist in the pinned v1.48.0 — no version bump needed.

Open design question: a recipe carries its own `prompt`, but Phase 2 needs the issue body injected per run. `--params` is the likely mechanism — proven for values like `repo_path`, unproven for a whole task prompt.

---

## Validation checklist

- [ ] `kubectl apply -f job.yaml`
- [ ] `kubectl logs -f job/goose-agent-poc -c goose-agent`
- [ ] Init container clones without a token — SSH only
- [ ] Both containers run as uid 1000, workspace is writable
- [ ] goose modifies files in `/workspace`
- [ ] Branch appears on GitHub
- [ ] Commit is **signed** and attributed to `julieio-goose`, not me
