# goose-container

Local build/test image for goose. Custom user, own toolchain, baked skills and recipes.

**Status: working end to end.** Builds, runs, discovers skills, and executes both recipes headlessly. `codebase-review` produced a verified, correctly-cited review of a real Nuxt project (`gpt-5.1-codex`, 2026-09-09), and obeyed read-only.

Known gaps: the review under-reported its own coverage (`Unverified: None` was false), and the fix for skill-injected confirmation prompts is prompt-level, not enforced. See [Recipes](#recipes).

Separate track from [`../goose-k8s-prep/`](../goose-k8s-prep/) — that one targets the Phase 1 K8s Job and pins uid 1000 to match its `securityContext`. This one is for local iteration and has no K8s coupling.

| | |
|---|---|
| `Dockerfile` | The image. |
| `goose.config.yaml` | Baked provider config + enabled extensions. |
| `recipes/` | `smoke-test.yaml`, `codebase-review.yaml`. |
| `AGENTS.md` | Test fixture — sample project rules, adapted from a real Nuxt project. |

## Build and run

```sh
docker build -t goose-container:dev .
docker run --rm -it -e AI_GATEWAY_API_KEY="<key>" goose-container:dev
```

Secrets are never baked. The provider key arrives at runtime.

Against a real repo — the form that produced the verified run below:

```sh
docker run --rm -it \
  -e AI_GATEWAY_API_KEY=$AI_GATEWAY_API_KEY \
  -e GOOSE_MODEL=openai/gpt-5.1-codex \
  -v /path/to/repo:/workspace \
  -w /workspace \
  goose-container:dev \
  goose run --recipe /home/agent/recipes/codebase-review.yaml --params repo_path=/workspace
```

`-w` is load-bearing — see [Recipes](#recipes). The recipe path is absolute because `-w` moves the CWD off `/home/agent`.

> [!NOTE]
> Built and verified on **Apple Silicon (aarch64)** only. The `yq` layer resolves arch via `dpkg --print-architecture` and goose's installer detects it too, so amd64 should work — **unverified**.

## User

Rolls its own `agent` user rather than reusing `node` or `vscode`.

```dockerfile
ARG USERNAME=agent
RUN userdel -r vscode 2>/dev/null || true \
    && useradd -m -s /bin/bash $USERNAME
```

- `userdel vscode` frees uid 1000 so `useradd` reassigns it to `agent`. **Verified** — `id agent` returns uid 1000.
- **No sudo grant.** `-G sudo` and the `NOPASSWD:ALL` sudoers line were dropped deliberately.

> [!IMPORTANT]
> The `sudo` **binary is still present** at `/usr/bin/sudo` — it ships with `devcontainers/base:ubuntu` and nothing here removes it. What's absent is the *authorization*: `agent` is not in `sudo` group and has no sudoers entry.
>
> **Verified:** `sudo -n true` → `sudo: a password is required`, exit 1. `agent` has no password set, so this is unusable, not merely inconvenient.
>
> `goose-k8s-prep` differs — its `node:22-slim` base doesn't ship `sudo` at all. The two images are not equivalent on this point.
- uid 1000 is not load-bearing here (no `securityContext` to match), but it comes free and keeps the option open.

> [!NOTE]
> Custom username and uid 1000 are independent. If `useradd` ever stops landing on 1000, pin it: `useradd -u 1000`.

## Toolchain

Everything installs as root; `USER` drops at the end.

| Tool | Method | Pin |
|---|---|---|
| goose | Install script, `CONFIGURE=false` | `GOOSE_VERSION` |
| uv | Astral install script | `UV_VERSION` |
| yq | Pinned binary (mikefarah/yq — no apt package) | `YQ_VERSION` |
| node + npm | NodeSource apt source | `NODE_MAJOR=24` |
| jq, python3, python3-pip, git, curl, bzip2 | apt | — |

`git`, `curl`, `wget`, `zsh` ship with `devcontainers/base:ubuntu` — **confirmed** via `which zsh`. Not reinstalled.

**Verified in a running container:** Python 3.14.4, pip 25.1.1, uv 0.12.10, goose, node, npm, jq, yq, git.

### Node 24 is current LTS

Checked against `nodejs.org/dist/index.json`: latest LTS is `v24.20.0` ("Krypton"). v26.x exists but is Current, not LTS.

### python3 alongside uv

uv manages its own interpreters and needs no system Python. `python3` is installed anyway as a baseline:

- A model writing a quick script reaches for `python3 foo.py`, not `uv run foo.py` — that's the universal convention.
- Without it, that call fails at runtime and the agent has to notice and route around it mid-task.

uv still owns real env/dependency management. System `python3` is the always-there fallback.

> [!NOTE]
> Debian's `pip3` is PEP 668 "externally managed" — a bare `pip3 install` refuses and points at a venv. Expected, not a bug. If it trips the agent, route through `uv` rather than `--break-system-packages`.

## Skills

goose discovers global skills from `~/.agents/skills/<name>/SKILL.md`.

> [!IMPORTANT]
> [`../../architecture/coding-harness-design-summary.md`](../../architecture/coding-harness-design-summary.md) says `~/.config/agents/skills/`. **That path is stale.** Current docs say `~/.agents/skills/` (global) and `.agents/skills/` (project). Legacy `.goose/skills/`, `~/.config/goose/skills/`, and `~/.claude/skills/` are still read for back-compat. Worth correcting in that doc.

> [!NOTE]
> **Project skills merge with global ones, and the legacy path works.** Running against a repo containing `.claude/skills/` produced a combined `goose skills list` — the mounted repo's `add-api-endpoint`, `azure-blob-storage`, etc. from `/workspace/.claude/skills/` alongside the image's `~/.agents/skills/`. Observed in a run trace, not just documented.

### Method: `npx skills add`

The [`skills` CLI](https://github.com/vercel-labs/skills) knows each agent's install path, so we don't hand-roll them.

```dockerfile
RUN npx -y skills@${SKILLS_CLI_VERSION} add \
      https://github.com/obra/superpowers/tree/${SUPERPOWERS_REF} -y -g --copy
```

| Flag | Why |
|---|---|
| `-g` | Global → `~/.agents/skills/`. Without it, scope is auto-detected from CWD. |
| `-y` | Skip prompts. Required non-interactively. |
| `--copy` | Default symlinks; a symlink into the npx cache won't survive the layer. |

> [!IMPORTANT]
> The source must come **before** the flags. `npx skills add -a '*' obra/superpowers` fails with `Missing required argument: source` — the glob is parsed as the positional.

### Pinning

Three separate pins:

| `ARG` | Pins | Form |
|---|---|---|
| `SKILLS_CLI_VERSION` | the `skills` CLI itself | npm version, `1.5.25` |
| `SUPERPOWERS_REF` | superpowers content | git tag, `v6.3.0` |
| `VERCEL_SKILLS_REF` | agent-skills content | commit SHA |

A bare `owner/repo` floats the default branch. The full `/tree/<ref>` URL form pins it and accepts either a tag or a SHA.

> [!NOTE]
> **`vercel-labs/agent-skills` publishes no semver tags** — only SHA-suffixed ones (`agent-skills-<sha>`), so its pin is a commit. `v1.5.25` is the **CLI's** version, not the collection's; the two repos are easy to conflate.

Verified the ref is honored rather than silently ignored: installing `v5.1.0` vs `v6.3.0` yields differing file contents (the skill *names* are identical across those tags, so a name-level check would have looked like a false pass).

### Sources

| Repo | Skills |
|---|---|
| `obra/superpowers` | 14 |
| `vercel-labs/agent-skills` | 9 |

> [!IMPORTANT]
> **`vercel-labs/skills` is not the skill collection.** It is the `skills` CLI tool itself and contains exactly one skill (`find-skills`). The content lives in **`vercel-labs/agent-skills`**, which is what `npx skills add vercel-labs/agent-skills` targets. Easy to conflate.

> [!NOTE]
> **superpowers publishes no goose install path.** Its docs cover Claude Code, Cursor, Devin, Gemini, Antigravity, Hermes, Pi — goose is absent. Its skills are standard `SKILL.md`, so they load anyway, but this is an unofficial route and nothing guarantees it keeps working.

superpowers skills cross-reference each other with `superpowers:` prefixes (5 of 14 do). Whether those references resolve under goose is **untested**.

## Overriding the model

The image bakes `openai/gpt-5-mini` via `goose.config.yaml` as a default. Three ways to override, no rebuild:

| Method | Scope |
|---|---|
| `-e GOOSE_MODEL=... -e GOOSE_PROVIDER=...` | per run |
| `-v ./goose.config.yaml:/home/agent/.config/goose/config.yaml:ro` | per run, whole config |
| `settings.goose_model` in a recipe | per recipe |

Env vars are the lightest for comparing models across runs — goose documents that **"environment variables take precedence over configuration files."**

> [!NOTE]
> Where a *recipe's* `settings.goose_model` sits relative to env vars is **not documented**. If a recipe pins a model and an env var contradicts it, which wins is unverified — test before relying on it.

Keep the baked config as the fallback rather than switching to mount-only: an image that can't run without an external file is worse for the K8s track, and a mount already shadows the baked file when present.

## Recipes

`GOOSE_RECIPE_PATH=/home/agent/recipes` — where `goose run --recipe <name>` resolves bare names.

```sh
goose run --recipe smoke-test.yaml
goose run --recipe codebase-review.yaml --params repo_path=/workspace
```

> [!IMPORTANT]
> **Run with `-w /workspace`** when mounting a repo. The image's `WORKDIR` is `/home/agent`, so without it the model's bare relative paths (`README.md`, `package.json`) all miss.
>
> Observed: the model **does not learn from these failures**. Across one run it re-tried bare `README.md` after having already read `/workspace/README.md` successfully, and kept doing so for the rest of the session. A "prefix every path" instruction at the top of the prompt decays as context accumulates.
>
> This is the general lesson, not a path quirk: **a constraint that must hold for the whole run should be enforced by the environment, not stated in the prompt.** `-w` holds unconditionally; prompt text does not. Same category error as trying to suppress `brainstorming` with wording.

| Recipe | Purpose |
|---|---|
| `smoke-test.yaml` | Verifies toolchain, skill discovery, non-root identity, file tools. Designed to fail loudly on a partial environment rather than report success. |
| `codebase-review.yaml` | Non-trivial task against a mounted repo. Read-only. Requires `path:line` citations and an explicit "Unverified" section. |

Both use `prompt` (not `instructions`) — required for headless `goose run`.

Both set `settings.max_turns` (40 / 25). Without a bound, an unattended run explores until something external stops it — the same silent-failure shape as the confirmation bug, but it costs tokens instead of producing nothing. A truncated review is the better failure.

> [!NOTE]
> `max_turns` is the only limit in the recipe schema — there is **no timeout field**. Wall-clock bounds have to come from outside (`timeout`, a K8s `activeDeadlineSeconds`). Extensions have their own separate timeouts.

`goose run` is non-interactive by default — it processes input and exits. `--interactive`/`-s` is the opt-*in* to keeping a session open.

Two ways to supply the prompt, and they are **alternatives**:

| Path | Prompt source |
|---|---|
| `goose run -t "do the thing"` | the `-t` / `--text` value |
| `goose run --recipe x.yaml` | the recipe's `prompt` field |

The [headless tutorial](https://goose-docs.ai/docs/tutorials/headless-goose/) leads with `-t`, which is the text path. Recipes carry their own prompt instead — the tutorial requires a `prompt` field for headless recipe use, which both recipes here have.

> [!NOTE]
> Passing `--text` alongside `--recipe` fails with `a value is required for '--text <TEXT>'`. It is a flag that takes a value, not a mode switch.

> [!IMPORTANT]
> **A confirmation request produces an empty run.**
>
> The first `codebase-review` run emitted `Classification: Spike`, described a
> planned probe, and ended with *"Please confirm I should proceed."* goose
> exited normally and **no review was produced.**
>
> Nothing was blocked on stdin. The model ended its turn with a question rather
> than doing the work, and a completed turn is goose's exit condition. So this
> is a **model-behaviour** failure, not a plumbing one — which also means no CLI
> flag fixes it.
>
> **Confirmed on the second run.** The trace shows `load_skill: using-superpowers`
> → `load_skill: brainstorming`, then — after reading README, CLAUDE.md,
> package.json, nuxt.config.ts and the rules — it stopped and emitted
> *"This looks like a Spike ... Proceed with this plan? (yes/no)"*. That is
> `brainstorming`'s protocol verbatim. All the reading was done and discarded.
>
> **A prompt-level "don't ask" instruction does not beat a skill that says
> "You MUST use this before any creative work."** The first fix attempt failed
> exactly this way.
>
> Worse, the recipe was *causing* it: it told the model to run `goose skills
> list` and load anything relevant, which is what pulled `brainstorming` in.
> Instructing it to load skills and to ignore their gates are contradictory, and
> the skill won.
>
> Now: name the offending skills and forbid loading them, rather than inviting a
> survey. **Still a prompt-level mitigation** — see open questions.
>
> **This matters beyond this spike.** Installed skills can inject
> confirm-first protocols into unattended runs, and the failure is quiet: exit
> 0, no error, no output. A K8s Job would look like it succeeded. Carry this to
> [`../goose-k8s-prep/`](../goose-k8s-prep/), and consider asserting on the
> artifact rather than the exit code.

`codebase-review` is deliberately harder than hello-world: orient in an unfamiliar codebase, load relevant skills, cite evidence, and check the project's own documented conventions against its actual code.

### Result — 2026-09-09, `openai/gpt-5.1-codex` vs `tally-split-ai`

Run with `-w /workspace` and `-e GOOSE_MODEL=openai/gpt-5.1-codex`, overriding the image's baked `gpt-5-mini`. **This also confirms the `GOOSE_MODEL` env override works** — goose used the override, not the config file.

Produced three findings, all **independently verified** as real and correctly cited:

| Finding | Verified |
|---|---|
| `callOnce` used for data fetching in `expenses/index.vue:12` | The project's own rules file marks `callOnce(...fetchAll())` with an explicit ❌ *"callOnce is not for data fetching"* |
| Same pattern in `[year]/[month]/index.vue:24` | Confirmed |
| `upload-queue.store.js:3` imports `useUserStore` | Confirmed; used at `:437`. `CLAUDE.md:168` says *"Stores must not reference each other"* |

This is the spike's core question answered: the container reads an unfamiliar repo, finds its documented conventions, and catches real violations. Not hello-world output.

Read-only was obeyed — `git status` on the mounted repo was clean afterwards.

> [!IMPORTANT]
> **It reported `Unverified: None`, which is false.** It never found `AGENTS.md` (absent from that repo) and examined roughly five files out of ~50 top-level entries. An honest Unverified section was the recipe's main guard against overconfidence, and the model skipped it.
>
> The findings that *are* present hold up — so this is a completeness problem, not a fabrication one. Worth strengthening: require the Unverified section to state coverage (what was read vs. what exists) rather than allowing a bare "None."

## AGENTS.md

Two files, different jobs:

| File | Role |
|---|---|
| [`../../AGENTS.md`](../../AGENTS.md) | Real rules for this repo. Harness-agnostic subset of `CLAUDE.md`. |
| `./AGENTS.md` | **Test fixture.** Sample project rules adapted from a real Nuxt 4 project. |

The fixture exists because a generic instruction file does not test much. It carries real conventions, concrete anti-patterns with ✅/❌ examples, and "verify against current docs, don't design from training data" pressure — so a review task has something to actually check code against.

Both are harness-agnostic on purpose: this image is for testing goose across multiple model providers, and `AGENTS.md` is the cross-harness convention.

> [!NOTE]
> The fixture was adapted from `tally-split-ai`, cloned locally under `tmp/` (gitignored). That clone is not needed to use anything here — the fixture is self-contained.

## Still to work out

- [x] Custom non-root user, uid 1000 — verified.
- [x] No usable sudo — verified (`sudo -n true` → password required, exit 1). Binary present but unauthorized.
- [x] Toolchain — goose, uv, node 24, yq, jq, python3. Verified in a running container.
- [x] Skills installed via `npx skills add`, pinned — CLI version, superpowers tag, agent-skills SHA.
- [x] Recipes written.
- [x] **Smoke test run and passed.** Caught a real error — its own sudo check was testing the wrong thing.
- [x] `goose skills list` finds all 23 from `~/.agents/skills/`, plus 2 builtin = 25.
- [x] The `skills` extension name in `goose.config.yaml` was a guess, and it was correct.
- [x] Which skill imposed the confirm-first protocol? **`brainstorming`**, auto-chained from `using-superpowers`. Seen in the run trace.
- [x] **Does forbidding it by name hold?** Yes — third attempt produced a full review. Naming the skills to avoid worked where a generic "don't ask" did not. Still prompt-level; see below.
- [x] **End-to-end run against a real repo** — `codebase-review` produced three findings against `tally-split-ai`, all citations verified as real and supporting their claims.
- [x] Is there a goose-level way to restrict which skills a recipe may load? **No.** No allowlist, no `skills:` recipe field, no `GOOSE_SKILLS_PATH` — skills are filesystem discovery only, while extensions get per-recipe scoping. Written up as a design gap in [`coding-harness-design-summary.md`](../../architecture/coding-harness-design-summary.md#applying-this-to-goose).
- [ ] Does the **`skills` CLI's** `skills-lock.json` (`skills experimental_install`, seen in its `--help`) work as a declarative manifest of *which skill packages to install*? That would make the install step versioned and reproducible — but it is an install-time artifact of the CLI, **not** a goose-side capability filter. goose would still discover and load whatever ends up in the directory. Unexamined.
- [ ] Do superpowers' `superpowers:`-prefixed cross-references resolve under goose?
- [ ] Image size — unmeasured. No multi-stage build. `bzip2`/`curl` are build-only.
- [ ] `ripgrep` not installed — the model reached for `rg` and fell back to other tools. Harmless, but it's a common default.
- [ ] The `AGENTS.md` fixture has never been exercised. It lives here, not in a mounted repo, so the verified run read the target's `CLAUDE.md` instead. Copy it into a test repo to actually test it.
- [x] Corrected the stale skills path in `coding-harness-design-summary.md`.

## Decision log

| Date | Decision | Notes |
|---|---|---|
| 2026-09-07 | Base `devcontainers/base:ubuntu` | Separate from `goose-k8s-prep`'s `node:22-slim`. Local iteration, no K8s coupling. |
| 2026-09-07 | Own `agent` user, not `node`/`vscode` | Name reads for the purpose. uid 1000 comes free after `userdel vscode`. |
| 2026-09-07 | Drop the sudo grant | `-G sudo` + `NOPASSWD:ALL` removed. Was inherited from a devcontainer template, not chosen. |
| 2026-09-09 | Leave the sudo binary in place | Removing the grant is what matters; `agent` can't escalate (verified). Purging the package is possible but buys nothing here — revisit if this image ever informs the K8s one, where `node:22-slim` has no `sudo` at all. |
| 2026-09-07 | Install as root, drop privileges last | Conventional order. |
| 2026-09-07 | `python3` alongside uv | Agents reach for `python3` by convention. uv still owns real env management. |
| 2026-09-07 | Node via NodeSource, major 24 | Current LTS, verified against `nodejs.org/dist`. Non-nvm route suits a Dockerfile. |
| 2026-09-07 | yq = mikefarah/yq | Go binary, `yq eval` syntax. Not the Python `jq`-wrapper of the same name. |
| 2026-09-09 | Skills via `npx skills add -y -g --copy` | **Reversed** an earlier decision to hand-roll a pinned `git fetch` + sparse checkout. That was built on a wrong premise: `npx skills add` is not unavoidably interactive (`-y`), and it installs to `~/.agents/skills/`, not legacy paths. The CLI knows each agent's paths; hand-rolling them was reinventing the wheel. |
| 2026-09-09 | Pin CLI + both skill sources | `/tree/<ref>` URL form pins content without giving up the CLI. Supersedes an earlier "accept unpinned" trade-off — it turned out not to be a trade-off at all. |
| 2026-09-07 | Skills to `~/.agents/skills/` | Documented current path. Legacy paths work but are not the target. |
| 2026-09-07 | superpowers via unofficial route | No goose install path exists. Standard `SKILL.md` loads anyway; accepted for a spike. |
| 2026-09-07 | Two AGENTS.md files | Root = real repo rules. Spike = test fixture, so tasks have real conventions to check against. |
| 2026-09-07 | Bake skills + recipes, mount secrets | Same split as `goose-k8s-prep`: config baked, secrets at runtime. |
