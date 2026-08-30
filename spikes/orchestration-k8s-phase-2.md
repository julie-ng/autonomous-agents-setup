# Phase 2: Event-Driven GitHub Orchestration

**Objective:** Trigger the Phase 1 `Job` from a GitHub webhook instead of `kubectl apply`. Same execution unit, automated dispatch.

**Prerequisite:** [Phase 1](./orchestration-k8s-phase-1.md) is a go.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ GITHUB                                                                          │
│  ┌────────────────────────┐                                                     │
│  │ Issue / Comment Event  │                                                     │
│  │ (e.g., "/goose fix x") │                                                     │
│  └───────────┬────────────┘                                                     │
└──────────────┼──────────────────────────────────────────────────────────────────┘
               │ Webhook HTTPS Payload
               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ KUBERNETES CLUSTER (Argo Events Namespace)                                      │
│                                                                                 │
│  ┌────────────────────────┐  Triggers Event   ┌──────────────────────────────┐  │
│  │ EventSource            │──────────────────►│ Sensor                       │  │
│  │ (Webhook Listener)     │                   │ (JSON Path Parameterizer)    │  │
│  └────────────────────────┘                   └──────────────┬───────────────┘  │
└──────────────────────────────────────────────────────────────┼──────────────────┘
                                                               │ Instantiates
                                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ KUBERNETES CLUSTER (Default Namespace)                                          │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Triggered Kubernetes Job — same shape as Phase 1                          │  │
│  │                                                                           │  │
│  │  ┌────────────────────────┐         ┌──────────────────────────────────┐  │  │
│  │  │ Init Container         │ Volume  │ Main Container                   │  │  │
│  │  │ (git-clone via SSH)    │ Mount   │ (goose-agent)                    │  │  │
│  │  │                        │────────►│                                  │  │  │
│  │  │ • Repo from payload    │         │ • $TASK_PROMPT from issue body   │  │  │
│  │  │ • Agent identity       │         │ • Commits, pushes, opens PR      │  │  │
│  │  └────────────────────────┘         └──────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Components

1. **`EventSource`** — HTTP endpoint in-cluster. Captures GitHub webhook POSTs, validates HMAC signature against a shared secret.
2. **`Sensor`** — extracts fields from the payload (issue title/body, repo, ref), injects them into a `Job` template, submits it.
3. **Execution unit** — unchanged from Phase 1. Same image, same identity, same security context.

---

## What carries over from Phase 1

Everything about the Job itself. Only the *trigger* changes.

- SSH auth and signing via `agent-ssh-key` Secret, `defaultMode: 0400`
- `securityContext` — non-root, uid 1000, `fsGroup` for the shared volume
- Vercel AI Gateway provider config, overridable via env
- Agent identity: `julieio-goose`

> [!IMPORTANT]
> **Push + PR mechanism is confirmed in Phase 1, not here.** Phase 1 stops at a pushed branch; `gh` CLI and PR creation are still open there. Don't design the PR step in this doc until Phase 1 settles how it works.

---

## Manifests

> [!NOTE]
> Sketch only. Full manifest lands once Phase 1 is proven — the Job spec below is intentionally abbreviated to avoid duplicating what Phase 1 owns.

### 1. EventSource (`eventsource.yaml`)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: github-webhook-secret
  namespace: argo-events
type: Opaque
stringData:
  secret: "<shared-secret>"   # must match GitHub webhook settings
---
apiVersion: argoproj.io/v1alpha1
kind: EventSource
metadata:
  name: github-events
  namespace: argo-events
spec:
  github:
    coding-agent-source:
      repositories:
        - owner: "your-org"
          names:
            - "your-repo"
      events:
        - "issues"
        - "issue_comment"
      service:
        ports:
          - port: 12000
            targetPort: 12000
      webhookSecret:
        name: github-webhook-secret
        key: secret
```

### 2. Sensor (`sensor.yaml`)

Captures the payload, parameterizes the Phase 1 Job.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Sensor
metadata:
  name: github-sensor
  namespace: argo-events
spec:
  dependencies:
    - name: github-dep
      eventSourceName: github-events
      eventName: coding-agent-source
  triggers:
    - template:
        name: goose-job-trigger
        k8s:
          operation: create
          source:
            resource:
              # Phase 1 Job spec, verbatim — see orchestration-k8s-phase-1.md
              # Only TASK_PROMPT and the repo URL are parameterized.
              apiVersion: batch/v1
              kind: Job
              metadata:
                generateName: goose-agent-job-
                namespace: default
              spec:
                ttlSecondsAfterFinished: 600
                backoffLimit: 0
                # ... securityContext, volumes, initContainers, containers
                #     identical to Phase 1

          parameters:
            # Issue title + body → TASK_PROMPT
            - src:
                dependencyName: github-dep
                dataTemplate: "Title: {{ .Input.body.issue.title }}\n\nDetails: {{ .Input.body.issue.body }}"
              dest: spec.template.spec.containers.0.env.3.value

            # Repo → clone URL
            - src:
                dependencyName: github-dep
                dataKey: body.repository.full_name
              dest: spec.template.spec.initContainers.0.env.0.value
              valueFormat: "git@github.com:%s.git"
```

---

## Deployment

1. **Install Argo Events**

```bash
kubectl create namespace argo-events
kubectl apply -f https://raw.githubusercontent.com/argoproj/argo-events/stable/manifests/install.yaml
```

2. **Expose the endpoint** — Ingress, or `ngrok` / `kubectl port-forward` to `github-events-eventsource-svc:12000`.

3. **Configure the GitHub webhook** — point at the exposed URL, content-type `application/json`, subscribe to Issues + Issue Comments, set the shared secret.

4. **End-to-end test** — open an issue, watch a `goose-agent-job-*` pod appear and run.

---

## Deferred

Known and solvable. Not the focus while proving the mechanism. See [gotchas](./orchestration-k8s-gotchas.md).

- **Trigger filtering.** Currently fires on every `issues` / `issue_comment` event, including the agent's own comments — an infinite loop. Needs an explicit opt-in (magic comment or label).
- **Branch collisions.** Hardcoded branch name breaks on concurrent runs. Parameterize.
- **Prompt injection.** Issue text goes straight into the prompt, in a pod holding an SSH key.
- **Runaway cost.** No `activeDeadlineSeconds`, no resource limits.
- **Silent failure.** Async job, nothing posts back to GitHub.
- **Index-based parameter mapping.** `env.3.value` breaks silently if the env list is reordered.
