### Phase 2 Design Summary: Event-Driven GitHub Orchestration with Argo Events

**Objective:** Automate task execution by triggering Phase 1 Kubernetes `Jobs` dynamically whenever a GitHub Issue or Pull Request comment is created. This replaces manual `kubectl apply` commands with declarative, open-source event routing.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ GITHUB                                                                          │
│  ┌────────────────────────┐                                                     │
│  │ Issue / Comment Event  │                                                     │
│  │ (e.g., "Fix bug in x") │                                                     │
│  └───────────┬────────────┘                                                     │
└──────────────┼──────────────────────────────────────────────────────────────────┘
               │ Webhook HTTPS Payload
               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ KUBERNETES CLUSTER (Argo Events Namespace)                                      │
│                                                                                 │
│  ┌────────────────────────┐  Triggers Event   ┌──────────────────────────────┐ │
│  │ EventSource            │──────────────────►│ Sensor                       │ │
│  │ (Webhook Listener)     │                   │ (JSON Path Parameterizer)    │ │
│  └────────────────────────┘                   └──────────────┬───────────────┘ │
└──────────────────────────────────────────────────────────────┼──────────────────┘
                                                               │ Instantiates
                                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ KUBERNETES CLUSTER (Default Namespace)                                          │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Triggered Kubernetes Job                                                  │  │
│  │                                                                           │  │
│  │  ┌────────────────────────┐         ┌──────────────────────────────────┐  │  │
│  │  │ Init Container         │         │ Main Container                   │  │  │
│  │  │ (git-clone)            │ Volume  │ (goose-agent)                    │  │  │
│  │  │                        │ Mount   │                                  │  │  │
│  │  │ • Clones target repo   │────────►│ • Target repo mounted            │  │  │
│  │  │   from webhook event   │         │ • $TASK_PROMPT set dynamically    │  │  │
│  │  │ • Checks out branch    │         │   from issue body                │  │  │
│  │  └────────────────────────┘         └──────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘

```

---

### Phase 2 Architecture & Component Breakdown

1. **Argo Events `EventSource`:** Operates a lightweight, secure HTTP endpoint in your cluster. It captures incoming GitHub webhook POST requests and validates the HMAC signature using a shared secret.
2. **Argo Events `Sensor`:** Intercepts the validated webhook event, extracts key fields (Issue title, Issue body, Repository URL, Branch/Ref), injects them as environment variables into a Kubernetes `Job` template, and submits the job.
3. **Execution Unit:** Reuses the exact same single-container **Goose** setup validated in Phase 1.

---

### Phase 2 Manifests

#### 1. Setup Secrets and EventSource (`eventsource.yaml`)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: github-webhook-secret
  namespace: argo-events
type: Opaque
stringData:
  secret: "your-shared-github-webhook-secret" # Must match Secret set in GitHub Webhook settings
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

#### 2. Event Sensor Trigger (`sensor.yaml`)

This sensor captures the payload from `github-events`, extracts the repository URL and Issue description, and injects them into the Phase 1 Job.

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
              apiVersion: batch/v1
              kind: Job
              metadata:
                generateName: goose-agent-job-
                namespace: default
              spec:
                ttlSecondsAfterFinished: 600
                backoffLimit: 0
                template:
                  spec:
                    restartPolicy: Never
                    volumes:
                      - name: workspace-volume
                        emptyDir: {}

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
                          - name: REPO_URL
                            value: "placeholder" # Parameterized below
                        command: ["/bin/sh", "-c"]
                        args:
                          - |
                            git clone https://x-access-token:${GITHUB_TOKEN}@${REPO_URL}.git .
                            git config user.name "Goose Agent"
                            git config user.email "agent@goose.local"
                            git checkout -b feature/agent-automated-fix

                    containers:
                      - name: goose-agent
                        image: your-org/goose-cli:latest
                        workingDir: /workspace
                        volumeMounts:
                          - name: workspace-volume
                            mountPath: /workspace
                        env:
                          - name: OPENROUTER_API_KEY
                            valueFrom:
                              secretKeyRef:
                                name: model-credentials
                                key: api-key
                          - name: GOOSE_PROVIDER
                            value: "openrouter"
                          - name: GOOSE_MODEL
                            value: "deepseek/deepseek-r1"
                          - name: TASK_PROMPT
                            value: "placeholder" # Parameterized below
                        command: ["goose"]
                        args:
                          - "run"
                          - "--text"
                          - "$(TASK_PROMPT)"

          # Parameter Mapping from GitHub Webhook Payload -> Kubernetes Job Spec
          parameters:
            # 1. Inject Issue Body/Title as the TASK_PROMPT
            - src:
                dependencyName: github-dep
                dataTemplate: "Title: {{ .Input.body.issue.title }}\n\nDetails: {{ .Input.body.issue.body }}"
              dest: spec.template.spec.containers.0.env.3.value

            # 2. Extract Repo HTML URL (strips https:// prefix for git clone sub-stringing)
            - src:
                dependencyName: github-dep
                dataKey: body.repository.full_name
              dest: spec.template.spec.initContainers.0.env.1.value
              valueFormat: "github.com/%s"

```

---

### Phase 2 Deployment Steps

1. **Install Argo Events on Cluster:**
```bash
kubectl create namespace argo-events
kubectl apply -f https://raw.githubusercontent.com/argoproj/argo-events/stable/manifests/install.yaml

```


2. **Expose `EventSource` Endpoint:**
Create an Ingress resource or execute a local tunnel (e.g., `ngrok` or `kubectl port-forward`) pointing to `github-events-eventsource-svc:12000`.
3. **Configure GitHub Webhook:**
In your GitHub repository, point Webhooks to your exposed Ingress URL, set Content-Type to `application/json`, select the **Issues** and **Issue Comments** events, and input your shared secret.
4. **End-to-End Test:**
Open a new Issue in your GitHub repository titled *"Refactor logger to include ISO timestamps"*. Observe Argo Events triggering a new `goose-agent-job-*` pod that runs Goose against the prompt automatically.
