# Containerizing goose

`goose-in-a-box` — build notes, gotchas, and what goes in the image.

**Status:** Dockerfile written, **never built**. Nothing below the "Install goose" section is verified in a running container unless marked otherwise.

| | |
|---|---|
| `Dockerfile` | Headless image for the [Phase 1](../orchestration-k8s-phase-1.md) Job. |
| `goose.config.yaml` | Baked provider config. Vercel AI Gateway → `openai/gpt-5-mini`. |

Prior art: [`../goose-acp-spawn/Dockerfile`](../goose-acp-spawn/Dockerfile) — the ACP variant, built and verified 30 Aug 2026.

## Scope — no ACP client

Phase 1 runs `goose run --text "$TASK_PROMPT"`. Fire-and-die, one process, no client. So this image drops `tsx`, `@agentclientprotocol/sdk`, and `goose-acp-client.ts`.

Node stays anyway — `npx`-based MCP servers, and `node` (uid 1000) is the user the Phase 1 `securityContext` pins.

## Base image

`node:22.23.2-bookworm-slim`. Debian-based, so `apt-get`.

Pinned to a patch tag rather than `22-slim`. Not digest-pinned — a tag is mutable in principle, immutable enough in practice for a spike.

## Install goose

No `brew` on Linux. Use the install script:

```dockerfile
ARG GOOSE_VERSION=v1.48.0
RUN curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh \
      | GOOSE_VERSION="${GOOSE_VERSION}" CONFIGURE=false bash \
  && goose --version
```

- `GOOSE_VERSION` — pins the release. Without it the script resolves `stable` at build time, so two builds of the same Dockerfile can differ.
- `CONFIGURE=false` — skips the interactive `goose configure` prompt. Required for a non-interactive build.
- The script itself is still fetched from the floating `stable` path. Only the binary it installs is pinned.

### apt deps

| Package | Why |
|---|---|
| `bzip2` | Release tarball is `.tar.bz2`. Not in slim images. |
| `ca-certificates` | TLS to the model gateway. |
| `curl` | Fetches the installer. |
| `git` | Commit and push. |
| `openssh-client` | git over SSH. |

> [!IMPORTANT]
> `openssh-client` is not optional and not implied. `git` only *recommends* it, and `--no-install-recommends` drops recommends. The main container pushes (Phase 1 does `git push origin HEAD` after `goose run`), so it needs SSH itself — it is not enough that the init container had it.

## `gh` CLI

Pinned tarball, not the apt repo — no extra apt source, no floating latest.

```dockerfile
ARG GH_VERSION=2.99.0
```

`dpkg --print-architecture` gives `amd64`/`arm64`, which matches gh's release asset naming.

> [!IMPORTANT]
> **Unresolved: gh needs a token, and [identity.md](../../architecture/identity.md) says there isn't one.**
>
> `gh pr create` authenticates with `GH_TOKEN`/`GITHUB_TOKEN`. It cannot auth over SSH. But identity.md's scope is "No `GITHUB_TOKEN`. SSH covers all three."
>
> The binary is in the image; the credential is not decided. Phase 1 stops at a pushed branch and never invokes `gh`, so nothing is blocked yet. **Phase 2 cannot open a PR until this is settled** — either a credential on the `julieio-goose` account, or PR creation moves out of the agent (e.g. the orchestrator opens it from the pushed branch, which keeps the agent's write scope at "one branch").

## Gotchas

### `GOOSE_BIN_DIR`

Installer defaults to `$HOME/.local/bin` → resolves to `/root/.local/bin` at build time. Breaks the moment you `USER node`: wrong PATH, and `/root` isn't readable.

```dockerfile
ENV GOOSE_BIN_DIR=/usr/local/bin
```

Add `&& goose --version` to the same `RUN` so the build fails immediately if the binary didn't land.

### `HOME` after dropping privileges

goose writes config and session state under `$HOME`. `USER node` alone doesn't set it.

```dockerfile
USER node
ENV HOME=/home/node
```

### `/workspace` ownership

`WORKDIR` creates a missing directory root-owned, which is useless to uid 1000. Create it explicitly first:

```dockerfile
RUN mkdir -p /workspace && chown node:node /workspace
```

Only matters for a bare `docker run`. In K8s the `emptyDir` mount replaces the directory, and `fsGroup: 1000` makes it group-writable for both containers.

> [!NOTE]
> No `safe.directory` config needed: the init container clones as uid 1000 and goose runs as uid 1000, so ownership already matches. This breaks if either side's uid changes.

### No `sudo`

`RUN` is already root. Slim images don't ship `sudo` — drop it from any commands copied off a host shell.

### Default `CMD` is the Node REPL

`node:*-slim` drops you into `>`, not a shell. For poking around:

```dockerfile
CMD ["bash"]
```

The Job overrides this with `command`/`args` anyway.

## Provider config

Bake it in. No `goose configure`, no interactive prompts.

```dockerfile
COPY --chown=node:node goose.config.yaml /home/node/.config/goose/config.yaml
```

`COPY` creates parent directories automatically. `--chown` is needed explicitly — `COPY` defaults to root-owned regardless of the active `USER`.

See [goose-agent.md](../../architecture/goose-agent.md#goose-provider-config) for the config contents.

> [!NOTE]
> Baking is a spike convenience. In K8s this becomes a ConfigMap mount with `subPath` — without `subPath` the mount replaces the whole `goose/` directory instead of the single file.

## Secrets

Never baked. Passed at runtime.

```sh
docker run -it -e AI_GATEWAY_API_KEY="<placeholder>" goose-in-a-box:dev
```

In K8s: `secretKeyRef`. The SSH key arrives as a Secret mounted `0400` into the init container — see [identity.md](../../architecture/identity.md#getting-the-key-into-the-pod).

## Verifying which model is actually used

> [!IMPORTANT]
> **Don't ask the model.** It has no introspection into its own deployment — the answer is a plausible guess, not a lookup. goose knows, because goose routes the call.

Check instead:
- Gateway billing / request logs — authoritative, and proves the request didn't go somewhere else
- goose's resolved config

A math check (`3*23`) proves *a* model responded. Not which one.

## Still to work out

- [x] `gh` CLI in the image — binary pinned and installed. **Credential unresolved**, see above.
- [x] Pinning — `GOOSE_VERSION`, `GH_VERSION`, patch-level node tag. Installer script URL still floats.
- [x] Non-root + writable workspace — `/workspace` chowned to uid 1000, matches init container. Unverified.
- [ ] **Build it.** Nothing here has been through `docker build`.
- [ ] git identity + SSH key for signed commits — set at clone time by the init container, not in the image. Unproven end to end.
- [ ] Image size — still unmeasured. No multi-stage build. `curl`/`bzip2` are build-only and could be dropped from the final layer.
- [ ] Does `goose run` commit on its own? If so the Phase 1 shell commit double-fires. Open in [phase 1](../orchestration-k8s-phase-1.md#open-questions).

## Decision log

| Date | Decision | Notes |
|---|---|---|
| — | Base image | `node:22-slim`. Node needed for ACP client tooling. |
| — | goose install | Linux install script, `CONFIGURE=false`. No brew on Linux. |
| — | Binary location | `GOOSE_BIN_DIR=/usr/local/bin` so it survives the `USER` switch. |
| — | Runtime user | `node` (uid 1000), ships with the base image. |
| — | Provider config | Baked for the spike. ConfigMap in K8s. |
| — | Secrets | Runtime env only. Never in the image. |
| 2026-09-02 | Split from the ACP image | Phase 1 is `goose run --text`. ACP client is dead weight; `goose-acp-spawn` stays as reference. |
| 2026-09-02 | Keep Node despite dropping ACP | `npx` MCP servers, and the `node` user is uid 1000 for free. Switching to `debian-slim` would mean a manual `useradd` to keep the Phase 1 `securityContext` valid. |
| 2026-09-02 | Pin versions | goose `v1.48.0`, gh `2.99.0`, node `22.23.2-bookworm-slim`, via `ARG`. Tags not digests. |
| 2026-09-02 | `openssh-client` explicit | `--no-install-recommends` drops it; the pushing container needs it. |
| 2026-09-02 | `gh` installed from pinned tarball | Avoids adding an apt source. Ships ahead of need — Phase 1 never calls it. |
| 2026-09-02 | gh credential deferred | Conflicts with identity.md's no-token scope. Not resolved by minting a token; Phase 2 decides. |
