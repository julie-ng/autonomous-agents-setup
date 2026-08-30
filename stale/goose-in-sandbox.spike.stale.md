# Spike: goose in Docker Sandbox

**Question:** does goose → ACP → Claude Code behave the same inside `sbx` as it does on host?

Status: **Go** — works, once a `sbx`-injected env var is unset. Root cause confirmed, see below.

## What's under test

Not goose. Not Claude Code. Both are verified on host.

The **ACP bridge** (`claude-agent-acp`) running inside a microVM. Candidates for what breaks in a sandbox but not on host:

- auth / credential flow
- subprocess spawning permissions
- stdio / JSON-RPC transport
- filesystem paths the adapter assumes exist

## Prerequisites

- [X] `sbx` installed, `sbx login` done, network policy set
- [ ] goose in the sandbox image — or confirm it's installable once inside
- [ ] A disposable test repo. Nothing real at stake.

## Steps

```sh
sbx run shell    # plain shell first, before anything agentic
```

- [X] `goose --version` — not present. Sandbox is Ubuntu-based ([templates docs](https://docs.docker.com/ai/sandboxes/customize/templates/)), so the macOS `brew` install in [goose-agent.md](../architecture/goose-agent.md) doesn't apply. Use the Linux install script instead:

```sh
sudo apt update && sudo apt install bzip2 -y   # dependency for the install script
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash
```

- [X] `goose configure` → Configure Providers → Claude Code / ACP — `npm` was already present in the sandbox, but the ACP connector is not auto-installed. Install it manually first, same as host (see [goose-agent.md](../architecture/goose-agent.md#authenticating-with-claude)):

```sh
npm install -g @agentclientprotocol/claude-agent-acp
```
- [X] **Auth:** fresh `/login` prompt inside the sandbox, or does it find something? Expect fresh. `~/.claude` is not mounted. — **Root cause confirmed.** `sbx` injects placeholder env vars for well-known credential names into every sandbox — `ANTHROPIC_API_KEY="proxy-managed"`, `GH_TOKEN="gho_sbxproxymanaged..."`, `GOOGLE_API_KEY="proxy-managed"`. These are literal sentinel strings, not real keys — likely meant for tools that only check "is this set." The Claude Agent SDK (bundled inside `claude-agent-acp`, separate binary from the standalone `claude` CLI) takes the literal string at face value and sends it as the API key, which Anthropic rejects instantly as `Invalid API key: authentication_failed` — before ever falling back to the real OAuth token in `~/.claude/.credentials.json` (written by a direct `claude` CLI `/login`, done once per sandbox). Fix, needed once per fresh sandbox shell:

  ```sh
  unset ANTHROPIC_API_KEY
  ```

  Confirmed via clean before/after test: identical session, only that env var changed, behavior flipped from consistent failure to working. Not a network, subprocess-spawn, `$HOME`, or version issue — all of those were checked directly and ruled out first.
- [X] `goose session` — not `goose term`. `term` is shell integration (`@goose`/`@g` aliases in your existing shell); `session` is the actual agent interface and the one that goes through ACP to Claude Code.
- [X] Trivial session against the test repo — sent a plain chat message, got a real response back once the env var was unset.
- [X] Response comes back **through goose**, not just the adapter process running — confirmed, same test.
- [X] A tool call — asked it to create a file with specific contents; file appeared with the right contents. Confirms tool-bridging through ACP, not just chat.

## Go / no-go

**Go** — provider configures, session runs end-to-end including a tool call, auth behavior understood. Per-sandbox login is an accepted cost, not a blocker.

**No-go** — ACP handshake fails *in the sandbox specifically*. Works on host, breaks in `sbx`.

> [!IMPORTANT]
> If it fails, check `sbx policy log` first. Blocked outbound requests are the likeliest cause — ACP's auth flow needs network access that may not be allow-listed.

Other suspects, in order: missing dependency in the template, subprocess-spawn restriction.

## Result

| Date | Result | Notes |
|---|---|---|
| 2026-08-29 | **Go** | Root cause: `sbx` injects a placeholder `ANTHROPIC_API_KEY="proxy-managed"` env var into every sandbox, which the ACP adapter's bundled SDK sends as a literal (invalid) API key instead of falling back to the real OAuth token. Fix: `unset ANTHROPIC_API_KEY` before running `goose`, once per fresh sandbox shell. Confirmed end-to-end: chat response and a real tool call (file creation) both work through ACP once unset. |
