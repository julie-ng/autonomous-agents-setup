FROM node:22-slim

# --- root: system deps + global installs ---
RUN apt-get update \
  && apt-get install -y --no-install-recommends bzip2 curl ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# goose installs to $HOME/.local/bin; pin it somewhere every user can reach
ENV GOOSE_BIN_DIR=/usr/local/bin
RUN curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh \
  | CONFIGURE=false bash \
  && goose --version

RUN npm install -g tsx

# --- app ---
WORKDIR /workspace
# COPY package*.json ./
RUN npm install @agentclientprotocol/sdk
COPY goose-acp-client.ts .

# --- drop privileges: `node` ships with the base image (uid 1000) ---
RUN chown -R node:node /workspace
USER node

# goose writes config/session state under $HOME
ENV HOME=/home/node



COPY --chown=node:node goose.config.yaml /home/node/.config/goose/config.yaml

CMD ["bash"]
# CMD ["npx", "tsx", "goose-acp-client.ts"]
