# Containerizing goose

`goose-in-a-box` — build notes, gotchas, and what goes in the image.

Working reference: [`spikes/goose-acp-spawn/Dockerfile`](../spikes/goose-acp-spawn/Dockerfile)

## Base image

`node:22-slim`. Node is needed for the ACP client and `npm`-installed tooling. Debian-based, so `apt-get`.

## Install goose

No `brew` on Linux. Use the install script:

```sh
apt-get install -y --no-install-recommends bzip2 curl ca-certificates git
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh \
  | CONFIGURE=false bash
```

- `bzip2` — the release tarball is `.tar.bz2`. Not in slim images.
- `CONFIGURE=false` — skips the interactive `goose configure` prompt. Required for a non-interactive build.
- `ca-certificates` — TLS for outbound API calls.

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

### No `sudo`

`RUN` is already root. Slim images don't ship `sudo` — drop it from any commands copied off a host shell.

### Default `CMD` is the Node REPL

`node:22-slim` drops you into `>` , not a shell. For poking around:

```dockerfile
CMD ["bash"]
```

## Provider config

Bake it in. No `goose configure`, no interactive prompts.

```dockerfile
COPY --chown=node:node goose.config.yaml /home/node/.config/goose/config.yaml
```

`COPY` creates parent directories automatically. `--chown` is needed explicitly — `COPY` defaults to root-owned regardless of the active `USER`.

See [goose-agent.md](./goose-agent.md#goose-provider-config) for the config contents.

> [!NOTE]
> Baking is a spike convenience. In K8s this becomes a ConfigMap mount with `subPath` — without `subPath` the mount replaces the whole `goose/` directory instead of the single file.

## Secrets

Never baked. Passed at runtime.

```sh
docker run -it -e AI_GATEWAY_API_KEY="$AI_GATEWAY_API_KEY" goose-in-a-box
```

In K8s: `secretKeyRef`.

## Verifying which model is actually used

> [!IMPORTANT]
> **Don't ask the model.** It has no introspection into its own deployment — the answer is a plausible guess, not a lookup. goose knows, because goose routes the call.

Check instead:
- Gateway billing / request logs — authoritative, and proves the request didn't go somewhere else
- goose's resolved config

A math check (`3*23`) proves *a* model responded. Not which one.

## Still to work out

- [ ] `gh` CLI in the image — needed for PR creation
- [ ] git identity + SSH key for signed commits (see [identity.md](./identity.md))
- [ ] Non-root + writable workspace when the repo is cloned by an init container
- [ ] Image size — currently unmeasured, unoptimized. No multi-stage build.
- [ ] Pinning: `stable` release URL and `node:22-slim` are both floating tags

## Decision log

| Decision | Notes |
|---|---|
| Base image | `node:22-slim`. Node needed for ACP client tooling. |
| goose install | Linux install script, `CONFIGURE=false`. No brew on Linux. |
| Binary location | `GOOSE_BIN_DIR=/usr/local/bin` so it survives the `USER` switch. |
| Runtime user | `node` (uid 1000), ships with the base image. |
| Provider config | Baked for the spike. ConfigMap in K8s. |
| Secrets | Runtime env only. Never in the image. |
