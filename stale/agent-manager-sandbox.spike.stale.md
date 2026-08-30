# Spike: agent-manager on a sandboxed goose

**Question:** can agent-manager monitor and drive a goose session running inside `sbx` without degrading or colliding?

Status: unblocked — [goose-in-sandbox](./goose-in-sandbox.md) is a confirmed Go. Not started yet.

> [!NOTE]
> Convenience layer only. `sbx` remains the boundary. Nothing here adds isolation.

## Prerequisites

- [X] goose-in-sandbox spike is a **go**
- [ ] agent-manager installed on host

## Steps

- [ ] Point agent-manager at a running sandbox — likely `sbx setup ssh` + the `.sbx` alias. Check whether it needs an SSH target or has a direct process-attach mode.
- [ ] **Status detection.** agent-manager reads Claude Code *hook events*, not screen output. Does that survive Claude running behind the ACP bridge?
- [ ] "Answer in place" against a goose session
- [ ] Worktree spawn (`alt+w`) — agent-manager creates worktrees, so does `sbx`
- [ ] Diff review (`ctrl+r`) on a change goose made inside the sandbox

## Go / no-go

**Go** — attaches, monitors, and interacts without screen-scraped status or worktree collision.

**Partial** — hook-based status doesn't survive ACP, so agent-manager treats this as a generic CLI rather than its best-case Claude Code integration. Downgraded, still usable. Not a blocker.

> [!IMPORTANT]
> The silent failure mode: status *looks* like it works but is guessing from terminal text. Verify it reflects goose's real state, don't assume.

## Result

| Date | Result | Notes |
|---|---|---|
| | | |
