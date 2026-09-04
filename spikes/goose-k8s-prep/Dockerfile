# goose-in-a-box — headless goose for the Phase 1 K8s Job.
#
# Differs from ../goose-acp-spawn/Dockerfile: no ACP client. Phase 1 runs
# `goose run --text "$TASK_PROMPT"` — fire-and-die, one process.
#
#   docker build -t goose-in-a-box:dev .
#
# NOT YET BUILT. See README "Status".

FROM node:22.23.2-bookworm-slim

# Pinned. Bump deliberately, not by rebuilding.
ARG GOOSE_VERSION=v1.48.0
ARG GH_VERSION=2.99.0

# --- root: system deps ---
# bzip2          — goose release tarball is .tar.bz2, not in slim images
# ca-certificates — TLS for the model gateway
# openssh-client — git clone/push over SSH. `git` only *recommends* it, and
#                  --no-install-recommends means it is not pulled in.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       bzip2 \
       ca-certificates \
       curl \
       git \
       openssh-client \
  && rm -rf /var/lib/apt/lists/*

# --- goose ---
# GOOSE_BIN_DIR defaults to $HOME/.local/bin → /root/.local/bin at build time,
# which is unreachable after `USER node`. Pin it somewhere on the global PATH.
ENV GOOSE_BIN_DIR=/usr/local/bin
RUN curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh \
      | GOOSE_VERSION="${GOOSE_VERSION}" CONFIGURE=false bash \
  && goose --version

# --- gh CLI ---
# Pinned tarball rather than the apt repo: no extra apt source, no floating latest.
# Needed for Phase 2 PR creation. Unused in Phase 1 — see README.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    curl -fsSL -o /tmp/gh.tgz \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${arch}.tar.gz"; \
    tar -xzf /tmp/gh.tgz -C /tmp; \
    install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${arch}/bin/gh" /usr/local/bin/gh; \
    rm -rf /tmp/gh.tgz "/tmp/gh_${GH_VERSION}_linux_${arch}"; \
    gh --version

# Mountpoint for the init container's clone (emptyDir, fsGroup 1000).
# WORKDIR alone would create this root-owned. Matters for plain `docker run`;
# in K8s the volume mount replaces it.
RUN mkdir -p /workspace && chown node:node /workspace

# --- drop privileges: `node` ships with the base image (uid 1000) ---
# uid 1000 is what the Phase 1 securityContext pins. Keep them in sync.
USER node

# goose writes config and session state under $HOME. `USER` alone does not set it.
ENV HOME=/home/node
WORKDIR /workspace

# Baked provider config. Secrets are never baked — AI_GATEWAY_API_KEY comes in
# at runtime via secretKeyRef. In K8s this file becomes a ConfigMap mounted with
# subPath, so it replaces the one file and not the whole goose/ directory.
# COPY creates parents automatically; --chown is required, COPY defaults to root.
COPY --chown=node:node goose.config.yaml /home/node/.config/goose/config.yaml

# node:*-slim defaults to the Node REPL. The Job overrides this with command/args;
# bash is for poking around interactively.
CMD ["bash"]
