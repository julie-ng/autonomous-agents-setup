# Spike: goose in Docker Sandbox

**Question:** does goose → ACP → Claude Code behave the same inside `sbx` as it does on host?

Status: not started

## What's under test

Not goose. Not Claude Code. Both are verified on host.

The **ACP bridge** (`claude-agent-acp`) running inside a microVM. Candidates for what breaks in a sandbox but not on host:

- auth / credential flow
- subprocess spawning permissions
- stdio / JSON-RPC transport
- filesystem paths the adapter assumes exist

## Prerequisites

- [ ] `sbx` installed, `sbx login` done, network policy set
- [ ] goose in the sandbox image — or confirm it's installable once inside
- [ ] A disposable test repo. Nothing real at stake.

## Steps

```sh
sbx run shell    # plain shell first, before anything agentic
```

- [ ] `goose --version` — present, or install it
- [ ] `goose configure` → Configure Providers → Claude Code / ACP
- [ ] **Auth:** fresh `/login` prompt inside the sandbox, or does it find something? Expect fresh. `~/.claude` is not mounted.
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
| | | |
