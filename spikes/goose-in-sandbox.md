# Spike: goose in Docker Sandbox

**Question:** does goose → ACP → Claude Code behave the same inside `sbx` as it does on host?

Status: **No-go** — ACP handshake fails in the sandbox specifically, per below.

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
- [ ] **Auth:** fresh `/login` prompt inside the sandbox, or does it find something? Expect fresh. `~/.claude` is not mounted. — **Failed.** `goose session` → any message, including `/login`, fails instantly (~0.2–0.3s) with `Invalid API key: authentication_failed`. Confirmed this isn't missing OAuth: a direct `claude` CLI login (outside goose) inside the same sandbox succeeds fine and produces a resumable session — `goose`'s ACP connection isn't using those credentials at all. Also confirmed not a network-policy block: `api.anthropic.com` traffic is allowed and succeeding per `sbx policy log`. Root cause not fully confirmed — live suspect is an `sbx`-injected `ANTHROPIC_API_KEY` env var (`proxy-managed`) that `goose`'s spawned ACP subprocess may inherit and fail on before ever reaching OAuth. See `SPIKE.md` (uncommitted, repo root) for full diagnostic detail if still present.
- [ ] `goose session` — not `goose term`. `term` is shell integration (`@goose`/`@g` aliases in your existing shell); `session` is the actual agent interface and the one that goes through ACP to Claude Code.
- [ ] Trivial session against the test repo — "summarize the README"
- [ ] Response comes back **through goose**, not just the adapter process running
- [ ] A tool call — "add a comment to the top of file X". Confirms tool-bridging, not just chat.

## Go / no-go

**Go** — provider configures, session runs end-to-end including a tool call, auth behavior understood. Per-sandbox login is an accepted cost, not a blocker.

**No-go** — ACP handshake fails *in the sandbox specifically*. Works on host, breaks in `sbx`.

> [!IMPORTANT]
> If it fails, check `sbx policy log` first. Blocked outbound requests are the likeliest cause — ACP's auth flow needs network access that may not be allow-listed.

Other suspects, in order: missing dependency in the template, subprocess-spawn restriction.

## Result

| Date | Result | Notes |
|---|---|---|
| 2026-08-29 | **No-go** | ACP auth fails in sandbox only. Root cause unconfirmed — suspect `sbx`'s injected `ANTHROPIC_API_KEY` env var pre-empting the OAuth flow. Not root-caused before session ended; handed off to Claude Desktop via `SPIKE.md` (uncommitted). |
