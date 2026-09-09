FROM mcr.microsoft.com/devcontainers/base:ubuntu

# devcontainers/base:ubuntu ships git, curl, wget, zsh already — confirmed via
# `which zsh` in a running container from this image. Not re-installed below.
ARG GOOSE_VERSION=v1.48.0
ARG UV_VERSION=0.12.10
ARG YQ_VERSION=v4.53.6
ARG NODE_MAJOR=24

# The `skills` CLI itself (npm pkg from vercel-labs/skills). Pinned so the tool
# doing the install isn't a floating dependency.
ARG SKILLS_CLI_VERSION=1.5.25

# Skill sources, pinned. Bump deliberately.
# superpowers tags semver releases. agent-skills does NOT — its only tags are
# SHA-suffixed, so its pin is a commit.
ARG SUPERPOWERS_REF=v6.3.0
ARG VERCEL_SKILLS_REF=063bee94c3f4df8453406c830b0a7df0f2860278

ARG USERNAME=agent
RUN userdel -r vscode 2>/dev/null || true \
    && useradd -m -s /bin/bash $USERNAME

# --- root: system deps ---
# bzip2      — goose release tarball is .tar.bz2, not guaranteed present on this base.
# jq         — apt package, stable on Debian/Ubuntu, no separate pin needed.
# python3    — baseline interpreter on PATH for anything that shells out to
#              `python3` directly (scripts, MCP servers) instead of going
#              through uv. uv still owns actual agent-managed envs/versions —
#              this is just the "always there" fallback, not a replacement.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         bzip2 \
         ca-certificates \
         curl \
         git \
         jq \
         python3 \
         python3-pip \
    && rm -rf /var/lib/apt/lists/*

# --- goose ---
# GOOSE_BIN_DIR defaults to $HOME/.local/bin → /root/.local/bin at build time,
# unreachable once we switch to $USERNAME. Pin it on the global PATH instead.
ENV GOOSE_BIN_DIR=/usr/local/bin
RUN curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh \
      | GOOSE_VERSION="${GOOSE_VERSION}" CONFIGURE=false bash \
    && goose --version

# --- uv (Python env/package manager) ---
# UV_INSTALL_DIR overrides the default $HOME/.local/bin (→ /root/.local/bin,
# unreachable post-`USER`), same reasoning as GOOSE_BIN_DIR above.
ENV UV_INSTALL_DIR=/usr/local/bin
RUN curl -fsSL https://astral.sh/uv/${UV_VERSION}/install.sh | sh \
    && uv --version

# --- yq (mikefarah/yq, Go binary — no apt package) ---
RUN arch="$(dpkg --print-architecture)" \
    && curl -fsSL -o /usr/local/bin/yq \
         "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_${arch}" \
    && chmod +x /usr/local/bin/yq \
    && yq --version

# --- Node (current LTS) ---
# NodeSource setup script adds the apt source for the pinned major, then a
# normal apt-get install. Matches goose-k8s-prep's aversion to floating repos
# only loosely — NodeSource itself is the recommended non-nvm route for LTS.
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version && npm --version

# --- drop privileges: last step ---
USER $USERNAME
ENV HOME=/home/$USERNAME
WORKDIR /home/$USERNAME

# --- skills ---
# goose discovers global skills from ~/.agents/skills/<name>/SKILL.md.
# Installed with the `skills` CLI (vercel-labs/skills), which knows the per-agent
# paths so we don't hand-roll them.
#
#   -g       install globally (~/.agents/skills). Without it, scope is
#            auto-detected from CWD — works here only by coincidence of WORKDIR.
#   -y       skip prompts. Required in a non-interactive build.
#   --copy   default is to symlink; a symlink into the npx cache does not
#            survive the layer.
#
# The source must come before the flags — `-a '*'` before it gets parsed as the
# positional and the command fails with "Missing required argument: source".
#
# Pinning: a bare `owner/repo` floats the default branch. The full
# /tree/<ref> URL form pins it, and takes a tag or a commit SHA. Verified by
# diffing v5.1.0 against v6.3.0 — contents differ, so the ref is honored, not
# silently ignored.
RUN npx -y skills@${SKILLS_CLI_VERSION} add \
      https://github.com/obra/superpowers/tree/${SUPERPOWERS_REF} -y -g --copy \
    && npx -y skills@${SKILLS_CLI_VERSION} add \
      https://github.com/vercel-labs/agent-skills/tree/${VERCEL_SKILLS_REF} -y -g --copy \
    && ls -1 "$HOME/.agents/skills" | wc -l

# --- goose config ---
# Baked for the spike, same as ../goose-k8s-prep. Secrets never baked —
# the provider key arrives at runtime via -e / --env-file.
COPY --chown=$USERNAME:$USERNAME goose.config.yaml /home/$USERNAME/.config/goose/config.yaml

# Recipes. GOOSE_RECIPE_PATH is where `goose run --recipe <name>` resolves
# bare names from.
ENV GOOSE_RECIPE_PATH=/home/$USERNAME/recipes
COPY --chown=$USERNAME:$USERNAME recipes/ /home/$USERNAME/recipes/

CMD ["bash"]
