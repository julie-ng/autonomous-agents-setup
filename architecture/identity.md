# Identity — me vs. the agent

The agent is not me. Separate GitHub account, separate SSH key, separate credentials to everything in the SDLC.

Two things kept apart:

- **Authentication** — can it push?
- **Attribution** — whose name is on the commit?

## GitHub

Agent gets its own GitHub account and its own ED25519 key (`ssh-keygen -t ed25519 -N ""`).

One key, registered twice:

- as an **authentication key** → push access
- as a **signing key** → commits get the green "Verified" badge under the agent's name, not mine

Per-repo config (`git config --local`), never global:

```sh
user.name / user.email     # agent identity
gpg.format ssh             # sign with the SSH key
user.signingkey            # agent's public key
core.sshCommand            # pinned to agent key + IdentitiesOnly=yes
```

`IdentitiesOnly=yes` matters — without it SSH offers every key in the agent, including mine.

Net effect: every agent commit is cryptographically distinguishable from mine.

> [!NOTE]
> Repo-scoped **deploy keys** are the alternative to a bot account for push access — locked to one repo, blockable from `main` via branch protection. A bot account is chosen instead because deploy keys can't sign commits, and attribution is the point.

## Scope — GitHub, nothing else

Deliberate: the agent's only outbound write is **pushing to its own branch**.

- No deploy credentials, no cloud keys, no package-registry tokens.
- Everything downstream is triggered by **hooks off GitHub** (CI, deploys, checks) — reacting to the branch, not driven by the agent.
- Anything the agent needs as *input* is fed to it by the orchestrator.

Rationale: a compromised or hallucinating agent can only produce a branch. A branch is reviewable and revertible. Blast radius stays inside a PR.

## LLM auth

| | Now | Target |
|---|---|---|
| **Model** | Claude only | Model-agnostic, e.g. `codex`, `qwen`. |
| **Mechanism** | ACP | API token |
| **Binding** | Personal Claude Subscription | API token |

Target is remote agents running off API tokens — own credential, no human account in the loop, swappable model.

### Claude – via ACP (today)

goose reaches Claude only via **ACP** (`claude-agent-acp`), driving the Claude Code CLI. Not a native goose provider.

- Credential stays on the host — a sentinel crosses into the sandbox, proxy substitutes outbound. Better than mounting `~/.claude/.credentials.json`.
- No `session resume` / `session fork` on ACP providers. Collides with sandbox pause/resume — plan around it.

Fine as a bridge: the target is API tokens, where goose's native providers apply and ACP drops out.

## Getting the key into the sandbox

Two candidate mechanisms. **Neither verified hands-on** — spike pending.

- **Option 1 - SSH agent forwarding**
  - host agent holds the key, 
  - `SSH_AUTH_SOCK` forwarded in. 
  - Sandbox can request signatures, cannot read or copy the private key.
  - Requires a *scoped* agent holding only the agent key
  
- **Option 2 - Credential substitution** — `sbx secret set`
  - placeholder inside, 
  - proxy substitutes on outbound requests.
  - Sandbox's default template expects `GITHUB_TOKEN`, but I want to authN via SSH key.

Agent forwarding is the better fit for signing. To confirm in a spike.

## Decision log

| Date | Decision |
|---|---|
| — | Agent gets its own GitHub account, not just a deploy key — attribution requires it |
| — | One ED25519 key, registered as both auth and signing key |
| — | Per-repo git config only; `IdentitiesOnly=yes` so the agent never reaches my keys |
| — | Agent's only write scope is push-to-own-branch. Downstream via GitHub hooks; inputs via orchestrator |
| — | Interim LLM auth: piggyback Claude subscription via host proxy (token stays on host). Target: API tokens, model-agnostic |
| — | Claude reachable in goose only via ACP; acceptable since target is API-token providers. No session resume/fork on ACP |
| Open | How the signing key reaches the sandbox — agent forwarding vs. credential substitution. Neither verified |

## Misc.

- Anthropic Sanctioned: the CLI authenticates against my subscription normally. Scripting subscription OAuth directly is not.
