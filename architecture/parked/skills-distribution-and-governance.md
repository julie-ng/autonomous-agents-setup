# Skills — distribution and governance (parked)

How different agent types get different skill sets, and what makes that a boundary rather than a convention.

> [!IMPORTANT]
> **Status: parked.** Not needed for Phase 1, which runs one agent type. Revisit when there is more than one, or before granting any agent write access to infra.

**Leaning:** `npx skills add` at pod startup, under the pod's own workload identity, federated to GitHub via OIDC. Not decided — see the trade-off below, which is narrower than it first appears.

## Why this needs solving at all

goose has **no governance layer for skills**. Extensions are scoped per-recipe; skills are filesystem discovery with no filter — no allowlist, no `skills:` recipe field, no `GOOSE_SKILLS_PATH`. See [`../coding-harness-design-summary.md`](../coding-harness-design-summary.md#applying-this-to-goose).

Consequences:

- Agent types can't be expressed as recipes if they differ by skill set. The skill set is a property of the filesystem.
- The model loads what it finds, based on skill descriptions. In [`../../spikes/goose-container/`](../../spikes/goose-container/), superpowers' `brainstorming` auto-loaded and killed two headless runs with an unanswered confirmation prompt.

So skill selection has to happen **before goose starts**. The question is what mechanism, and what it actually enforces.

## Motivation, stated honestly

**Today: tidiness and efficiency.** A headless reviewer doesn't need Vercel deployment skills, and `brainstorming` actively breaks it. This is a wrong-behaviour problem, not a privilege one.

**Long-term: security.** Worth designing for now, because retrofitting containment is much harder than starting with it.

Keeping these separate matters — the cheap option is adequate for tidiness and inadequate for containment.

## Options

### A. Bake per agent type (image-per-agent)

`npx skills add -s '<subset>'` at build time, one image per agent type.

- Reproducible; skill set is an image property, pinned with everything else
- Rebuild to change skills; N images to maintain; expensive toolchain layers duplicated (mitigable with a shared base)

### B. Mount from object storage

Scheduled job syncs skills to Azure Blob; pods mount subdirectories per agent via BlobFuse, read-only.

- One image; manifest is the versioned artifact; `readOnly` structurally prevents the agent authoring skills into its own registry
- Sync decoupled from deploy

> [!IMPORTANT]
> **Confused deputy — this is why B is not a boundary.**
>
> The agent needs no storage credentials, because the *platform* has them and will mount whatever the manifest names. So B only holds if the agent cannot influence the manifest. That is not safe to assume in this project: agents write code, open PRs, and may touch infra repos. Paths in — editing a GitOps-managed manifest, any RBAC to create or patch Jobs, or influencing whatever templates the spec (**including the Phase 2 orchestrator, if a sub-agent can shape the pod spec it runs in**).
>
> Mount selection is a *request*, not an *authorization*.

### C. Fetch at startup under the pod's own identity

Pod has its own workload identity, federated to GitHub via OIDC. An init container (or `npx skills add`) pulls only what that identity is authorized for.

- **The manifest can name anything; the fetch still fails if the identity isn't authorized.** Credential and constraint travel together — no deputy to aim.
- Git's own access model becomes the authorization model: access to the repo *is* access to the skill. OAuth-based, no long-lived tokens.
- Freshest content; no sync job to operate.
- **Every pod start depends on GitHub.** Rate limits, outages, moved tags, deleted repos. GitHub reliability has been poor recently.
- Content can drift between two pods with identical manifests — versioning the reference without versioning the content.

## The trade-off is not "GitHub uptime vs. clean security"

Worth stating plainly, because it is easy to frame this as accepting flakiness to get a clean model.

The same identity property is available **without** the GitHub dependency: pod's own workload identity, per-prefix authorization on blob storage, init container pulls. The authenticated GitHub pull moves to a sync job, which can fail and retry without blocking any agent run.

| | Identity check | Depends on GitHub at pod start |
|:--|:--|:--|
| B (platform mounts) | none — deputy | no |
| C (pod pulls from GitHub) | pod's own | **yes** |
| C′ (pod pulls from blob, per-prefix authz) | pod's own | no |

B is the one that fails the confused-deputy test. C and C′ both pass it. The real choice between C and C′ is **freshness and one less system to run** versus **no external dependency at pod start** — not security.

C is still defensible: if skills change often, or a sync job is not worth operating, the dependency buys real simplicity.

## What none of these solve

**Presence is not loading.** Every option controls which skills are *available*. The model still loads whatever it finds, from descriptions. `brainstorming` would be prevented by not shipping it — not by anything filtering behaviour at runtime.

Do not let "we scope skills per agent" get read as "we control skill loading." Those are different claims and only the first is true.

## Precondition for any of this

**The agent must not have RBAC to create Jobs, patch pod specs, or bind service accounts.** If it can set its own identity, every option above collapses. This belongs in the Phase 2 orchestrator design, not here.

## Open questions

- Does BlobFuse support subdirectory-granular mounts under CSI the way B assumes? Unverified — its own spike if B is revisited.
- What is the actual failure mode when `npx skills add` can't reach GitHub at startup — does the Job fail loudly, or start with a partial skill set? A partial set is the dangerous one.
- Does the `skills` CLI's `skills-lock.json` (`skills experimental_install`) help here? It would make installs declarative and reproducible, but it is an install-time artifact — not a goose-side capability filter. Unexamined.
- Does workload identity federation to GitHub work for the *read* path on private repos, or only for Actions-issued tokens? Assumed, not verified.

## Decision log

| Date | Decision | Notes |
|---|---|---|
| 2026-09-09 | Parked | Phase 1 runs one agent type. Not blocking. |
| 2026-09-09 | Motivation is tidiness now, security later | Kept separate deliberately — the cheap option suffices for one and not the other. |
| 2026-09-09 | Mount-based selection (B) is not a boundary | Confused deputy: the platform holds the credential and mounts what the manifest names. Only holds if the agent can't influence the manifest, which is not safe to assume here. |
| 2026-09-09 | Leaning C — fetch at startup under pod identity | Credential and constraint travel together. Accepts a GitHub dependency at pod start. |
| 2026-09-09 | Recorded that C′ exists | Same identity property against blob storage, without the GitHub dependency. C vs. C′ is freshness/simplicity, not security — do not justify C on security grounds alone. |
