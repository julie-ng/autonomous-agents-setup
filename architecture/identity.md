# Identity — me vs. the agent

The agent is not me. Own GitHub account. Own SSH key. Own credentials to everything in the SDLC.

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

> [!IMPORTANT]
> `IdentitiesOnly=yes` is load-bearing. Without it, SSH offers every key in the agent — including mine.

Net effect: every agent commit is cryptographically distinguishable from mine.

> [!NOTE]
> **Deploy keys** are the alternative for push access. Repo-scoped, blockable from `main`. Not chosen — they can't sign commits, and attribution is the point.

## Scope — GitHub, nothing else

The agent's only outbound write is **pushing to its own branch**.

- No deploy credentials. No cloud keys. No package-registry tokens.
- Downstream runs off **GitHub hooks** — CI, deploys, checks. Reacting to the branch, not driven by the agent.
- Inputs come from the orchestrator.

> [!IMPORTANT]
> Blast radius. A compromised or hallucinating agent can only produce a branch. Branches are reviewable and revertible.

## LLM auth

| | Now | Target |
|---|---|---|
| **Model** | Claude only | Model-agnostic, e.g. `codex`, `qwen`. |
| **Mechanism** | ACP | API token |
| **Binding** | Personal Claude Subscription | API token |

Target: remote agents on API tokens. Own credential. No human account in the loop. Swappable model.

### Claude – via ACP (today)

goose reaches Claude only via **ACP** (`claude-agent-acp`), driving the Claude Code CLI. Not a native goose provider.

- Credential stays on the host. A sentinel crosses into the sandbox. Proxy substitutes outbound. Better than mounting `~/.claude/.credentials.json`.
- No `session resume` / `session fork` on ACP providers. Collides with sandbox pause/resume. Plan around it.

A bridge, not the destination. API tokens use goose's native providers — ACP drops out.

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
| — | Own GitHub account, not just a deploy key. Attribution requires it. |
| — | One ED25519 key. Registered as both auth and signing key. |
| — | Per-repo git config only. `IdentitiesOnly=yes`. |
| — | Write scope is push-to-own-branch. Downstream via hooks, inputs via orchestrator. |
| — | Interim LLM auth via ACP on my subscription. Target: API tokens, model-agnostic. |
| — | Claude in goose is ACP-only. No session resume/fork. |
| Open | How the signing key reaches the sandbox. Neither option verified. |
