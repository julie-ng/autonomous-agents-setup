# Architecture

## Security Principle

Claude Code's default sandbox is read-permissive by design.

- Nothing in-app is a security boundary — not `settings.json` rules, not permission prompts.
- Real isolation needs an OS-level mechanism: container, VM, restricted user account.
- Credential files (`~/.aws/credentials`, `~/.ssh/`) are not protected by default. Level 0 needs explicit `deny` rules; Level 1+ makes them invisible by construction.

## Isolation Levels

Referenced as "Level 1" etc. throughout these docs.

| Level | Mechanism | Boundary? |
|---|---|---|
| **0** | `allow`/`deny` rules in `.claude/settings.json` | No — matches command strings, not paths. Deterrent only. |
| **1** | Dev container | Yes — filesystem. Shares host kernel. |
| **2** | MicroVM (`sbx`) | Yes — own kernel, hypervisor boundary. |
