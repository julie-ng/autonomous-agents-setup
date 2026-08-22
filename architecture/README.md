# Architecture

## Isolation Rungs

Referenced as "Rung 1" etc. throughout these docs.

| Rung | Mechanism | Boundary? |
|---|---|---|
| **0** | `allow`/`deny` rules in `.claude/settings.json` | No — matches command strings, not paths. Deterrent only. |
| **1** | Dev container | Yes — filesystem. Shares host kernel. |
| **2** | MicroVM (`sbx`) | Yes — own kernel, hypervisor boundary. |

Config != security. Only Rung 1+ is an actual boundary.

- [Sandbox](./SANDBOX.md) — isolating the agent
