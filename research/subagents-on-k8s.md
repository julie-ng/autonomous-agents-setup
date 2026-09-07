There isn't a single, widely adopted off-the-shelf library named *"goose-k8s-subagent-runner"* because Goose defaults to local subprocess execution via its built-in `summon` extension.

However, **this pattern (dynamic Kubernetes Jobs triggered by MCP tools) is actively used in production AI infrastructure.** Platforms like K8sGPT, Red Hat's Kubernetes MCP, and enterprise AI agent platforms use MCP servers as orchestrators that translate agent tool-calls into Kubernetes Job creation calls.

Here is how practitioners implement dynamic Kubernetes subagent dispatchers for Goose, along with a production-ready blueprint.

---

### The Architecture

Instead of using Goose's built-in `delegate` tool (which spawns local processes), you disable or override it with an **MCP Dispatcher Server**.

```
┌──────────────┐     1. Tool Call (spawn_subagent)     ┌────────────────────────┐
│  Primary     │ ────────────────────────────────────> │  Local MCP Dispatcher  │
│  Goose CLI   │ <──────────────────────────────────── │  (Python / Node)       │
└──────────────┘     4. Return Output / Logs           └────────────────────────┘
                                                                 │
                                                    2. Create    │ 3. Wait & Stream
                                                       Job       │    Pod Logs
                                                                 ▼
                                                       ┌───────────────────┐
                                                       │  Kubernetes API   │
                                                       └───────────────────┘
                                                                 │
                                                                 ▼
                                                       ┌───────────────────┐
                                                       │ K8s Pod (Subagent)│
                                                       │ `goose run "..."` │
                                                       └───────────────────┘

```

---

### Blueprint: Building a K8s Subagent Dispatcher

#### Step 1: Create the Subagent Docker Image

Build an image containing the Goose CLI and any runtime dependencies your subagent needs:

```dockerfile
FROM alpine:latest
RUN apk add --no-libc curl bash git
# Install Goose CLI
RUN curl -fsSL https://github.com/block/goose/releases/latest/download/download_cli.sh | bash
ENV PATH="/root/.local/bin:${PATH}"

ENTRYPOINT ["goose", "run", "--text"]

```

#### Step 2: Implement the MCP Dispatcher (`k8s_mcp.py`)

This script uses the official Python `mcp` SDK and `kubernetes` client. It exposes a single tool (`dispatch_k8s_subagent`) that creates a K8s Job, waits for completion, streams back the output, and cleans up the pod.

```python
import time
import uuid
from mcp.server.fastmcp import FastMCP
from kubernetes import client, config

# Initialize FastMCP Server
mcp = FastMCP("K8s Subagent Dispatcher")

# Load cluster config (in-cluster or local kubeconfig)
try:
    config.load_incluster_config()
except config.ConfigException:
    config.load_kubeconfig()

batch_v1 = client.BatchV1Api()
core_v1 = client.CoreV1Api()

@mcp.tool()
def dispatch_k8s_subagent(prompt: str, namespace: str = "default") -> str:
    """Spawns an isolated subagent inside a Kubernetes Job to execute a prompt."""
    job_id = f"goose-subagent-{uuid.uuid4().hex[:6]}"
    
    # Define K8s Job Spec
    job = client.V1Job(
        metadata=client.V1ObjectMeta(name=job_id, namespace=namespace),
        spec=client.V1JobSpec(
            ttl_seconds_after_finished=60,  # Auto-cleanup after finished
            template=client.V1PodTemplateSpec(
                spec=client.V1PodSpec(
                    restart_policy="Never",
                    containers=[
                        client.V1Container(
                            name="goose-worker",
                            image="your-registry/goose-subagent:latest",
                            args=[prompt],
                            env=[
                                client.V1EnvVar(name="OPENAI_API_KEY", value="your-key-or-secret")
                            ]
                        )
                    ]
                )
            )
        )
    )
    
    # Create the Job
    batch_v1.create_namespaced_job(namespace=namespace, body=job)
    
    # Wait for completion & collect logs
    timeout = 300  # 5 minute timeout
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        pods = core_v1.list_namespaced_pod(
            namespace=namespace, 
            label_selector=f"job-name={job_id}"
        )
        if pods.items:
            pod_name = pods.items[0].metadata.name
            phase = pods.items[0].status.phase
            
            if phase == "Succeeded":
                return core_v1.read_namespaced_pod_log(name=pod_name, namespace=namespace)
            elif phase == "Failed":
                return f"Subagent execution failed. Logs:\n{core_v1.read_namespaced_pod_log(name=pod_name, namespace=namespace)}"
                
        time.sleep(3)
        
    return "Error: Subagent Pod timed out."

if __name__ == "__main__":
    mcp.run()

```

#### Step 3: Register in Goose Configuration

Add the local script as an extension in your `~/.config/goose/config.yaml`:

```yaml
extensions:
  k8s_dispatcher:
    type: stdio
    cmd: python3
    args:
      - /path/to/k8s_mcp.py

```

---

### Key Production Considerations

1. **Secret & Context Passing:** You will likely need to inject credentials into the spawned Pod. Pass secrets via Kubernetes `Secret` mounts rather than inline environment variables.
2. **Persistence/Volume Mounting:** If the subagent needs to work on a Git repository or code workspace, mount an ephemeral **PersistentVolumeClaim (PVC)** or pass state as a git commit hash that the worker clones on startup.
3. **Cluster RBAC:** The machine or service running your main Goose CLI must have RBAC permissions allowing `create`, `get`, `list`, and `logs` access on `batch/jobs` and `pods`.
