# goose — the agent front-end

[goose](https://block.github.io/goose/) is the agent runtime inside the sandbox. Claude Code is the model behind it, reached over ACP.

![Goose in Agent Stack](./../images/agent-stack-goose.svg)

Why goose rather than Claude Code directly:

- Model-agnostic. Swapping to API-token providers later doesn't change the front-end.
- Prepackages plugins, skills, extensions per agent.
- Runs headless outside an IDE — the point of the whole setup.

> [!IMPORTANT]
> I chose goose because it's an [Agentic AI Foundation (AAIF)](https://aaif.io/projects/goose) project — foundation-governed with same reasoning as picking CNCF over proprietary tools: no vendor lock-in.

## The chain
 
```
goose (client) → ACP → claude-agent-acp → Claude Code
```

`claude-agent-acp` is an ACP adapter built on the official Claude Agent SDK. A client wrapper, not a replacement.

ACP providers are goose's **recommended replacement for the deprecated CLI providers**. They reuse an existing Claude Code login rather than a separate API key.

> [!Tip]
> See [identity.md](./identity.md) for auth and credential handling.

Nothing in the chain is sandbox-specific — it's a process chain that should run inside `sbx` like any other. Should isn't verified.

Candidates for what breaks in a sandbox but not on host:

- auth / credential flow
- subprocess spawning permissions
- stdio / JSON-RPC transport quirks
- filesystem paths the adapter assumes exist

## Known gaps

> [!IMPORTANT]
> **No `session resume` / `session fork` on ACP providers.** Native goose providers only.

Collides directly with `sbx` pause/resume. Pause a sandbox mid-session and the goose session is likely gone. Plan around it — not a bug to chase.

## Install

Install Desktop App

```sh
brew install --cask block-goose
```

Install CLI

```sh
brew install block-goose-cli
```

[See full instructions &rarr;](https://goose-docs.ai/docs/getting-started/installation)

## Authentication

- Using Claude Code for now – to test and build out system system
- Will be **model agnostic** in future – targeting cheaper and specialized models, e.g. [Codex](https://openai.com/codex/).

### Using with a Claude subscription

> [!Warning]
> **Do not mount `~/.claude`.** Per anthropic usage policy, if running locally, authN must be via ACP and then `/login` slash command _within_ ACP session. Otherwise use API token.

We'll use agent client protocol (ACP) to integrate Goose with Claude. ACP lets us enhance a Claude Code session and give it more context, which is what ACP's creators [Zed](https://zed.dev/acp) do with their IDE chat panel. 

Similarly, we will wrap Claude wtih goose via ACP.

#### Install ACP connector

```sh
npm install -g @agentclientprotocol/claude-agent-acp
```

#### Configure in goose CLI

After installing the ACP connector, run

```sh
goose configure
```

* When selecting a provider, make sure to select **"Claude Code ACP"** as the provider/backend.
* Do not select Anthropic - which is API based usage.
* Select default model for now.

#### Connect in goose UI

- In goose, connect via **"Claude Code ACP"** as the provider/backend
- Claude Code CLI does the actual authenticating — normal `/login` OAuth flow, same as the Zed devcontainer setup. Goose orchestrates around it, doesn't hold the subscription itself.
- MCP extensions configured in goose pass through to Claude via ACP — existing `.mcp.json` setup carries through

It should look like this:

<img src="./../images/goose-ui-configure-provider.png" alt="Goose UI connected to Claude via ACP" width="400">

## Decision log

| Decision | Notes |
|---|---|
| Harness | Goose: model-agnostic, headless, prepackages skills. |
| AuthN (local dev) | Claude reached via ACP (`claude-agent-acp`) |
| AuthN (remote agent) | API tokens (vendor agnostic) |

### Accepted Trade-Offs

| Tradeoff | Notes |
|---|---|
| No session resume/fork on ACP | **Doesn't really matter.** ACP is local dev only. Prod version would use API tokens anyway. |

## Misc.

### Alternatives

- [LangChain "Deep Agents"](https://docs.langchain.com/oss/javascript/deepagents/overview) - is more of a harness library, requiring more plumbing.
