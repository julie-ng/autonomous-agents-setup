# goose-in-a-box — headless goose for the Phase 1 K8s Job.
#
# Inherits from the official goose image rather than installing goose onto a
# node base. Upstream builds the binary stripped (CARGO_PROFILE_RELEASE_STRIP,
# OPT_LEVEL=z), which is why their image is ~half the size of the old build.
#
# The base ships goose, git, curl, bash and nothing else — no python3, node,
# npm, gh, jq. All added back here.
#
#   docker build -t goose-in-a-box:dev .

FROM ghcr.io/aaif-goose/goose:v1.48.0

# Upstream user is `goose` (uid 1000), home /home/goose. Same uid the Phase 1
# securityContext pins — only the name and home differ from the old node base.
USER root

ARG GH_VERSION=2.99.0
ARG NODE_MAJOR=24
ARG TYPESCRIPT_VERSION=5.9.3
ARG SKILLS_CLI_VERSION=1.5.25

# python3      — agents reach for `python3` by convention; without it a task
#                that writes tests cannot run them (observed: run of issue #3,
#                which shipped untested code and burned turns trying to build
#                CPython from source)
# ripgrep      — the model reaches for `rg` and falls back when absent
# jq           — JSON wrangling, and the agent's own use
# ca-certificates/curl/git — already in the base, not reinstalled
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 \
       python3-venv \
       ripgrep \
       jq \
       openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && python3 --version && rg --version | head -1 && jq --version

# --- node + npm, for npx-based MCP servers ---
# NodeSource apt source. The base has no node at all, unlike the old image.
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/* \
  && node --version && npm --version

# --- typescript + tsx, global ---
# `tsx` runs .ts directly, no build step — the form an agent reaches for.
# Installed globally so it is on PATH for any uid, not just goose.
RUN npm install -g \
      typescript@${TYPESCRIPT_VERSION} \
      tsx \
      skills@${SKILLS_CLI_VERSION} \
  && tsc --version && tsx --version && skills --version

# npm install -g ran as root and creates /home/goose/.npm root-owned, which
# makes any later npm/npx call as `goose` fail with EACCES. Hand it back.
RUN chown -R goose:goose /home/goose

# --- gh CLI ---
# Pinned tarball, not the apt repo: apt floats the version (measured: gave
# 2.100.0 against a 2.99.0 pin) and pulls in gnupg. Same ~39MB binary either way.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    curl -fsSL -o /tmp/gh.tgz \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${arch}.tar.gz"; \
    tar -xzf /tmp/gh.tgz -C /tmp; \
    install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${arch}/bin/gh" /usr/local/bin/gh; \
    rm -rf /tmp/gh.tgz "/tmp/gh_${GH_VERSION}_linux_${arch}"; \
    gh --version

# Mountpoint for the init container's clone (emptyDir, fsGroup 1000).
# WORKDIR alone would create this root-owned.
RUN mkdir -p /workspace && chown goose:goose /workspace

# Baked provider config. Secrets never baked — AI_GATEWAY_API_KEY arrives at
# runtime via secretKeyRef. In K8s this becomes a ConfigMap mounted with subPath,
# so it replaces the one file and not the whole goose/ directory.
COPY --chown=goose:goose goose.config.yaml /home/goose/.config/goose/config.yaml

# Recipes are baked; the task is chosen per run via --recipe + --params.
COPY --chown=goose:goose recipes/ /recipes/

# goose writes logs to ~/.local/state and session state to ~/.local/share, and
# creates neither. Upstream's `chown -R /home/goose` runs before the COPY above,
# so the parents COPY creates land root-owned. Without this, goose starts but
# emits "Failed to initialize logging: Permission denied" — an unattended pod
# with no logs, which defeats the visibility goal.
RUN mkdir -p /home/goose/.local/state/goose/logs \
             /home/goose/.local/share/goose \
  && chown -R goose:goose /home/goose

# --- drop privileges last ---
USER goose
WORKDIR /workspace

# The base sets ENTRYPOINT to the goose binary, so `docker run <img> run --recipe`
# works directly. Reset it: the Job's shell wrapper needs to run goose *and then*
# assert on the artifact, commit and push — it cannot do that if goose is pid 1.
ENTRYPOINT []
CMD ["bash"]
