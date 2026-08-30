# Session Management

> [!WARNING]
> This design is stale and was retired on 30 August 2026. Refer to latest design in [architecture/](./../architecture/README.md).

The convenience layer. Dashboards, status, reply-in-place, diff review.

> [!IMPORTANT]
> This layer enforces **no isolation**. `sbx` is the boundary. A session manager is UI on top of it — it inherits whatever isolation is underneath, and claims none of its own.

## Why I need one

GitHub PRs alone aren't enough. If a sandboxed agent crashes or blocks *before* it can push, a PR-only workflow shows nothing.

I need a second path into a stuck agent that doesn't depend on it reaching GitHub.

## Parallel sessions aren't free

Multiple terminals in **one** container are peer processes sharing that namespace. Isolated from the host. Not from each other.

For genuinely parallel, mutually-isolated agents, either:

- one sandbox per agent, or
- a purpose-built tool

**[Container Use](https://container-use.com)** is the candidate for the second: per-session sandboxes via Dagger containers + git worktrees, with Zed MCP integration.

- [Zed extension](https://zed.dev/extensions/mcp-server-container-use)
- [Zed background agents post](https://zed.dev/blog/container-use-background-agents)

Not adopted. Not yet prototyped.

## herdr vs agent-manager

Both are **tmux**-based — a background server hosting terminal sessions that survive detaching. Closing the laptop doesn't kill the agent.

Neither is sandbox-aware. Both manage the *session* a CLI runs in, not the boundary around it.

| | [herdr](https://herdr.dev) | [agent-manager](https://agent-manager.dev) |
|---|---|---|
| **Survives disconnect** | Yes | Yes — private `agentmgr` tmux server |
| **Status at a glance** | Working / blocked / idle, read from pane output | Six states. For Claude Code, from **hook events** — not screen-inference |
| **Reply without attaching** | Not called out | Yes — "answer in place" |
| **Worktrees** | Not native | First-class. `alt+w` spawns into a fresh worktree |
| **Diff review** | Not built in | Yes. `ctrl+r` split/unified viewer, inline comments delivered to the agent's pane |
| **Resume after kill** | Native agent restore, needs per-agent integration | `x` kills, `v` revives on the same thread |
| **Agent CLIs** | 20+ detected out of the box | 6 named, plus any CLI via config |
| **Explicitly not supported** | — | Cost tracking, mouse nav, agent-to-agent |
| **Maturity** | YC-backed, 30k+ stars, v0.8.0 | Trendshift, Product Hunt Aug 2026, Apache-2.0 |

**agent-manager is the frontrunner.** Worktree spawn and in-terminal diff review map onto plan → subagent → worktree → review directly. herdr is broader but doesn't address those two pieces.

## Open: wiring either one to `sbx`

Neither tool understands sandboxes.

Likely approach: point a session-manager pane at `sbx exec -it` / `sbx ssh` rather than a bare local process. Sandbox stays the boundary. Session manager becomes dashboard + reply + review on top.

**Not attempted.** This is the next thing to prototype, before Container Use.

Two things to check when spiking:

- **Hook-based status through ACP.** agent-manager reads Claude Code hook events. Unverified whether that survives Claude running one layer removed behind goose's ACP bridge. May silently degrade to screen-inference — looks like it works, but is guessing.
- **Worktree collision.** agent-manager spawns worktrees. So does `sbx`. Same risk that disqualified Orca.

## Rejected: Orca

[Orca](https://onorca.dev) — worktree + terminal + diff-review UI for agent CLIs. Genuinely good at that.

Ruled out on two counts:

- **Owns the worktree layer.** Its SSH mode expects a plain host it can create worktrees on. No concept of `sbx`, microVM lifecycle, or pause/resume. Pointing it at a `.sbx` alias stacks two worktree systems on one sandbox.
- **Provides zero isolation.** Against a bare local process, the agent has full host access. Its isolation is git-level (agents don't clobber each other's files), not OS-level (nothing stops a read of `~/.ssh`).

Category error, not a gap. Nice UI, wrong layer.

## Decision log

| Decision | Notes |
|---|---|
| Session manager | agent-manager over herdr. Worktree spawn + in-terminal diff review fit the workflow. |
| Layer | UI only, never the boundary. `sbx` is the boundary. |
| Rejected | Orca. Owns its own worktree layer, no sandbox model, no isolation of its own. |

### Accepted Trade-Offs

| Tradeoff | Notes |
|---|---|
| No tool is `sbx`-aware | Wire it by pointing a pane at `sbx exec`/`ssh` rather than a bare process. |
| Hook-based status may degrade | agent-manager reads Claude Code hooks. Behind ACP it may fall back to screen-inference — looks like it works, but is guessing. |
| Parallel sessions need one sandbox each | Terminals in one container are peers, not mutually isolated. |
