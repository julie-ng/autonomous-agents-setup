# Containerizing goose

`goose-in-a-box` — build notes, gotchas, and what goes in the image.

**Status: builds, runs, opens PRs.** Rebased onto the official goose image (2026-09-11). Completes a real issue→PR task end to end against a live repo as the agent's own GitHub identity — see [Issue to PR](#issue-to-pr--2026-09-11). Never run in K8s.

| | |
|---|---|
| `Dockerfile` | Headless image for the [Phase 1](../orchestration-k8s-phase-1.md) Job. |
| `goose.config.yaml` | Baked provider config. Vercel AI Gateway → `openai/gpt-5-mini`. |

Prior art: [`../goose-acp-spawn/Dockerfile`](../goose-acp-spawn/Dockerfile) — the ACP variant, built and verified 30 Aug 2026.

> [!IMPORTANT]
> **Read [`../goose-container/`](../goose-container/) before building this.** That spike ran goose headlessly end to end (2026-09-09) and found things that apply directly to the Phase 1 Job:
>
> - **A skill can silently kill an unattended run.** superpowers' `brainstorming` auto-loaded and ended two runs with an unanswered confirmation prompt — exit 0, no error, no output. **A Job would read that as success.** Assert on the produced artifact, not the exit code.
> - **`max_turns` is the only bound in the recipe schema.** There is no timeout field — wall-clock has to come from `activeDeadlineSeconds`.
> - **Recipes need `prompt`** (not `instructions`) for headless `goose run`, and the CWD must be the repo (`-w`, or `workingDir`) or the model wastes turns on failed relative paths.
> - Skills are discovered from `~/.agents/skills/` and merged with any `.agents/skills/` or `.claude/skills/` in the cloned repo — see [`../../architecture/parked/skills-distribution-and-governance.md`](../../architecture/parked/skills-distribution-and-governance.md).

## Scope — no ACP client

Phase 1 runs `goose run --text "$TASK_PROMPT"`. Fire-and-die, one process, no client. So this image drops `tsx`, `@agentclientprotocol/sdk`, and `goose-acp-client.ts`.

Node is installed anyway — `npx`-based MCP servers and the TypeScript toolchain. The base image's own user (`goose`, uid 1000) is what the Phase 1 `securityContext` pins.

## Base image

`ghcr.io/aaif-goose/goose:v1.48.0` — the official goose image, tag-pinned.

Upstream builds the binary with `CARGO_PROFILE_RELEASE_STRIP=true` and `OPT_LEVEL=z`, so goose arrives already stripped: **496MB base vs. the 946MB we built by hand**. That is the upstream answer to the [size question measured earlier](#rejected-stripping-the-goose-binary) — they strip, we chose not to, and inheriting gets it for free without us owning the trade-off.

The base ships goose, git, curl, bash and **nothing else**. No python3, node, npm, gh, jq, ripgrep. All added back here.

| | Old (`node:22-slim` + install script) | Current (official base) |
|---|---|---|
| goose | installed via script, `GOOSE_VERSION` | prebuilt, pinned by image tag |
| User | `node`, uid 1000, `/home/node` | `goose`, uid 1000, `/home/goose` |
| Python | **absent** | python3 + venv |
| TypeScript | absent | tsc, tsx |
| Size | 946MB | 1.06GB |

> [!NOTE]
> **Size went up, capability went up more.** The old 946MB image had no Python and [could not run the tests it wrote](#the-first-run-failed-and-why). The current image is larger because it carries a working toolchain, not because goose got bigger — goose itself is ~60MB smaller here. Compare capability per byte, not totals.

`useradd -m -u 1000 -s /bin/bash goose` is hardcoded upstream with no `ARG`. Same uid the Phase 1 `securityContext` pins, so the manifest is unaffected — only the user *name* and home path changed.

> [!IMPORTANT]
> The base sets `ENTRYPOINT ["/usr/local/bin/goose"]`. This image resets it with `ENTRYPOINT []`, because the Job's shell wrapper must run goose *and then* assert on the artifact, commit and push. It cannot do that if goose is pid 1.

## Toolchain

Everything the base lacks, installed as root, privileges dropped last.

| Tool | Method | Pin |
|---|---|---|
| python3, python3-venv | apt | — |
| node + npm | NodeSource apt source | `NODE_MAJOR=24` |
| typescript, tsx | `npm install -g` | `TYPESCRIPT_VERSION=5.9.3`, tsx floats |
| skills CLI | `npm install -g` | `SKILLS_CLI_VERSION=1.5.25` |
| gh | pinned tarball | `GH_VERSION=2.99.0` |
| ripgrep, jq, openssh-client | apt | — |

**Why python3:** an agent writing tests must be able to run them. The [first run](#the-first-run-failed-and-why) shipped untested code and burned turns trying to build CPython from source because the interpreter was missing. Same reasoning `goose-container` documents.

**Why ripgrep:** `goose-container` logged the model reaching for `rg` and falling back. Cheap to remove the papercut.

**Why the skills CLI but no skills:** the binary is present so a task can install skills at runtime; **nothing is baked**. Skills are filesystem discovery with no goose-side allowlist, so a baked skill can auto-load and [silently kill an unattended run](../goose-container/). An empty `~/.agents/skills` means nothing auto-loads, and no tokens are spent on skill content the task never needed.

> [!IMPORTANT]
> **`npm install -g` as root creates `/home/goose/.npm` root-owned**, which makes any later `npm`/`npx` call as `goose` fail with `EACCES` and a misleading "cache folder contains root-owned files" message. `RUN chown -R goose:goose /home/goose` before dropping privileges. Cost a build cycle.

> [!IMPORTANT]
> **goose creates neither `~/.local/state` nor `~/.local/share`.** Upstream's `chown -R /home/goose` runs before our `COPY`, so parents that `COPY` creates land root-owned and goose starts with `Failed to initialize logging: Permission denied` — **an unattended pod with no logs**, against the visibility goal. `mkdir -p` both, then `chown -R`.

## `gh` CLI

Pinned tarball, not the apt repo — no extra apt source, no floating latest.

```dockerfile
ARG GH_VERSION=2.99.0
```

`dpkg --print-architecture` gives `amd64`/`arm64`, which matches gh's release asset naming.

**Resolved for the spike: a PAT on the agent account.** `GH_TOKEN` alone is enough — see [Identity](#identity--pat-and-it-just-works). Issue read, branch pushed, PR opened, all as `julieio-goose`.

> [!IMPORTANT]
> **This supersedes identity.md's "No `GITHUB_TOKEN`. SSH covers all three." That is a change of direction, not a deviation.**
>
> **The trigger:** the agent's job grew past pushing a branch. Reading issues and opening PRs means the REST API, and the API takes a token — so "no `GITHUB_TOKEN`, SSH covers all three" became unachievable.
>
> Tokens are also faster to set up in a spike. More importantly, **the identity concept itself is being refined.** The likely endpoint is to drop SSH entirely and move to workload identity — federated identities mapped to the agent — rather than long-lived credentials of any kind.
>
> The details get discovered in a later phase. What is settled now: SSH is not the assumed destination, and the PAT is a deliberate spike-phase choice rather than drift. `identity.md` describes the older model and needs revisiting.

Commit signing is **deferred** — not attempted here, and not a blocker for Phase 1.

## Gotchas

### `GOOSE_BIN_DIR`

Installer defaults to `$HOME/.local/bin` → resolves to `/root/.local/bin` at build time. Breaks the moment you `USER node`: wrong PATH, and `/root` isn't readable.

```dockerfile
ENV GOOSE_BIN_DIR=/usr/local/bin
```

Add `&& goose --version` to the same `RUN` so the build fails immediately if the binary didn't land.

### `HOME` after dropping privileges

goose writes config and session state under `$HOME`. `USER node` alone doesn't set it.

The official base already sets both:

```dockerfile
ENV HOME="/home/goose"
USER goose
```

### `/workspace` ownership

`WORKDIR` creates a missing directory root-owned, which is useless to uid 1000. Create it explicitly first:

```dockerfile
RUN mkdir -p /workspace && chown goose:goose /workspace
```

Only matters for a bare `docker run`. In K8s the `emptyDir` mount replaces the directory, and `fsGroup: 1000` makes it group-writable for both containers.

> [!NOTE]
> No `safe.directory` config needed: the init container clones as uid 1000 and goose runs as uid 1000, so ownership already matches. This breaks if either side's uid changes.

### No `sudo`

`RUN` is already root. Slim images don't ship `sudo` — drop it from any commands copied off a host shell.

### Default `CMD` is the Node REPL

`node:*-slim` drops you into `>`, not a shell. For poking around:

```dockerfile
CMD ["bash"]
```

The Job overrides this with `command`/`args` anyway.

## Provider config

Bake it in. No `goose configure`, no interactive prompts.

```dockerfile
COPY --chown=goose:goose goose.config.yaml /home/goose/.config/goose/config.yaml
```

`COPY` creates parent directories automatically. `--chown` is needed explicitly — `COPY` defaults to root-owned regardless of the active `USER`.

See [goose-agent.md](../../architecture/goose-agent.md#goose-provider-config) for the config contents.

> [!NOTE]
> Baking is a spike convenience. In K8s this becomes a ConfigMap mount with `subPath` — without `subPath` the mount replaces the whole `goose/` directory instead of the single file.

## Secrets

Never baked. Passed at runtime.

```sh
docker run -it -e AI_GATEWAY_API_KEY="<placeholder>" goose-in-a-box:dev
```

In K8s: `secretKeyRef`. The SSH key arrives as a Secret mounted `0400` into the init container — see [identity.md](../../architecture/identity.md#getting-the-key-into-the-pod).

## Verifying which model is actually used

> [!IMPORTANT]
> **Don't ask the model.** It has no introspection into its own deployment — the answer is a plausible guess, not a lookup. goose knows, because goose routes the call.

Check instead:
- Gateway billing / request logs — authoritative, and proves the request didn't go somewhere else
- goose's resolved config

A math check (`3*23`) proves *a* model responded. Not which one.

## Build verification

Built and verified **2026-09-11 on Apple Silicon (aarch64)**. `docker build -t goose-in-a-box:dev .` succeeded **unmodified, first attempt**. Every gotcha above now has a result behind it.

> [!NOTE]
> This table records the **original `node:22-slim` build**, kept because the gotchas it verified are what justified the Dockerfile's structure. The current image is rebased onto the official goose base — see [Base image](#base-image). Findings that carried over are re-verified there.

| Claim | Result |
|---|---|
| Runs as `node`, uid 1000 | `uid=1000(node) gid=1000(node)` |
| `HOME` set after `USER` | `HOME=/home/node` |
| `GOOSE_BIN_DIR` survives privilege drop | `/usr/local/bin/goose`, `goose --version` → 1.48.0 |
| `/workspace` writable by uid 1000 | `drwxr-xr-x node node`, write succeeded |
| Baked config lands, `--chown` required | `-rw-r--r-- node node`; **`goose info` resolves it** — goose's own lookup, not inferred from the file existing |
| `gh` tarball, arch detection | `dpkg --print-architecture` → `arm64`, gh 2.99.0 |
| `openssh-client` explicit | OpenSSH_9.2p1 present |
| No `sudo` in `node:22-slim` | absent — confirmed |

> [!NOTE]
> **aarch64 only.** amd64 is unverified. Both arch-dependent steps resolve dynamically (goose's installer detects `uname -m`; gh uses `dpkg --print-architecture`), so it should work — but a K8s cluster will likely pull amd64, so this needs an actual build before Phase 1 runs anywhere but a local Mac.

**`--recipe` and `--params` both exist in the pinned v1.48.0**, alongside `--explain` and `--render-recipe`. Relevant because the [goose-container](../goose-container/) spike found recipes preferable to `--text` — no version bump needed to switch. `--params KEY=VALUE` repeats, which is the likely mechanism for injecting a per-task prompt. See [Scope](#scope--no-acp-client), which still specifies `--text`.

### Image size — 946MB

Previously unmeasured. Breakdown:

| Layer | Size |
|---|---|
| goose binary | 296MB |
| node runtime + Debian (base) | ~151MB |
| apt deps | 114MB |
| gh binary | 38.7MB |

goose is 31% of the image, and it is one static binary — the release tarball (`goose-aarch64-unknown-linux-gnu.tar.bz2`, 82MB compressed) contains exactly one file. No bundled assets to trim.

> [!NOTE]
> `docker images` reports 946MB, `docker image inspect` 902MB. The gap is buildkit attestation manifests, which are not pulled as image content.

#### Rejected: stripping the goose binary

The shipped binary is `not stripped`. Measured: `strip` takes it from **282.6 MB → 223.5 MB**, saving **59MB**.

Not doing it. 59MB is ~6% of the image — it does not change pod startup — and stripping costs symbol names in panics and stack traces. "Visibility into a stuck or crashed agent" is an explicit design goal, so that trade is bad while Phase 1 is still unproven. Revisit if image size ever becomes the actual constraint.

Remaining 223MB is real code (`.text` 124MB, `.rodata` 74MB).

#### Rejected: `gh` via apt

Tested against a control image. apt is not smaller and is worse on pinning:

| Method | gh binary | Notes |
|---|---|---|
| Pinned tarball (current) | 38.7MB | no extra apt source |
| `apt install gh` | 39.2MB | pulls `gnupg` + keyring; **floated to 2.100.0**, ignoring the 2.99.0 pin |

Same Go binary either way — apt just repackages it. The existing decision now has a measurement behind it rather than an assertion.

#### `curl` stays

An earlier note here called `curl` build-only. **That was wrong.** It fetches the installer at build time, but a coding agent reaches for `curl` at runtime — hitting APIs, checking endpoints, fetching schemas. Same category as the missing `ripgrep` in [goose-container](../goose-container/): the agent discovers the gap mid-task and wastes turns routing around it. `bzip2` *is* genuinely build-only.

## Live run — 2026-09-11

First run against a real gateway. `openai/gpt-5-mini` via the baked config, `AI_GATEWAY_API_KEY` supplied at runtime, no `goose configure`.

```sh
docker volume create scratch      # emptyDir analogue — see below
docker run --rm --env-file .env -v scratch:/workspace -w /workspace \
  goose-in-a-box:dev goose run --text "<task>"
```

**Provider plumbing works.** goose resolved the baked config, authenticated, called tools, edited a file. The Phase 1 provider setup is proven end to end.

### goose does not commit on its own

The open question in [phase 1](../orchestration-k8s-phase-1.md#open-questions), answered. After a successful file edit:

```
git log    → initial commit only    (no new commit)
git status →  M hello.txt           (dirty, uncommitted)
```

**No double-fire.** The Phase 1 shell's `git add -A && git commit` is necessary, not redundant.

> [!NOTE]
> Scope: one simple edit, with no instruction to commit. This shows goose does not commit *spontaneously* — not that it never will. A task prompt saying "commit your work" would presumably make it shell out to `git`. Rule: **goose does not commit unless asked**, so Phase 2 prompts built from issue bodies must not ask.

### Exit code 0 is not a success signal

> [!IMPORTANT]
> **`goose run` exits 0 whenever the process did not crash.** It reports that a turn completed, not that the task succeeded. Three independent routes to exit-0-with-no-work are now observed:
>
> | Route | Where seen |
> |---|---|
> | Skill-induced confirmation prompt | [goose-container](../goose-container/), 2026-09-09 |
> | Permission failure on the workspace | here, 2026-09-11 |
> | `--max-turns` exhaustion | here, 2026-09-11 — `--max-turns 1` on a 4-step task created nothing, printed *"I've reached the maximum number of actions… Would you like me to continue?"*, **exit 0** |
>
> This is not a goose defect and there is no flag that changes it. goose has no notion of task success to report. **Defining success is the orchestration layer's job** — see [Asserting on the artifact](#asserting-on-the-artifact).

#### Asserting on the artifact

The Job's shell step decides pass/fail, not the exit code. All three routes above produce the same observable — an unchanged working tree — so one check covers them:

```sh
goose run --recipe /recipes/task.yaml --params ...

git add -A
if git diff --staged --quiet; then
  echo "FAIL: goose produced no changes" >&2
  exit 1
fi
git commit -m "..."
git push origin HEAD
```

`git diff --staged --quiet` exits 1 when changes *are* staged, so the empty case is what gets caught.

> [!NOTE]
> This makes "no changes were needed" indistinguishable from "the agent failed." For Phase 1 that is the right default: a Job whose purpose is to push a branch has failed if it pushes nothing. Revisit if tasks that legitimately produce no diff ever become a real case.

Wall-clock hangs are a separate problem and need `activeDeadlineSeconds` on the Job — **not currently in the Phase 1 manifest**. `--max-turns` bounds iterations, not time.

Two flags worth setting for unattended runs:

| Flag | Why |
|---|---|
| `--max-tool-repetitions <N>` | Caps identical consecutive tool calls. Aimed at loops — directly relevant to goose-container's observation that the model re-tried the same failing path all session. |
| `--no-session` | Documented as "useful for automated runs." Also sidesteps session state written into the container layer. |

### goose reaches for `sudo` when blocked

In the run where the workspace was unwritable, goose chained fallbacks: write API → `echo >>` → **`sudo bash -lc` → `sudo tee`**, all with `||`. Both sudo attempts died on `sudo: command not found`.

**The no-sudo property is load-bearing, not decorative.** goose actively attempts escalation when it hits a permission wall. The base not shipping `sudo` is doing real work here (true of both `node:22-slim` and the current `debian:bookworm-slim`-derived official image) — and it is a stronger position than [goose-container](../goose-container/), where the binary exists but the grant was removed.

### Local testing gotcha — bind mounts on macOS

Not a K8s issue. A bind-mounted host directory carries the **host's** uid (501 on macOS), while goose runs as uid 1000 → `Permission denied`, and `git` refuses the repo with *"detected dubious ownership."*

Use a **Docker volume**, not a bind mount, for local runs. Files are then container-native and genuinely owned by 1000 — which is also the closer analogue of the Job's `emptyDir` + `fsGroup: 1000`.

This incidentally confirms the [`/workspace` ownership](#workspace-ownership) note: matching uids is what makes it work, and a third uid breaks it.

### uid 1000 is a provisioning fact, not a lock

[Upstream's own Dockerfile](https://github.com/aaif-goose/goose/blob/main/Dockerfile) hardcodes `useradd -m -u 1000 -s /bin/bash goose` with no `ARG` — and **this image now derives from it directly**, so that is where uid 1000 and the `goose` user come from.

`USER` sets a default, not a lock: `docker run --user` and `securityContext.runAsUser` both override it. **Verified** — `--user 1234:1234` runs.

But an unprovisioned uid is a degraded agent, not a working one:

```
--user 1234:1234 → uid=1234, HOME=/home/node (an ENV, so it persists)
  Warning: Failed to initialize logging: failed to create directory
  `/home/node/.local/state/goose/logs`: Permission denied (os error 13)
```

goose starts and reads the config (world-readable), but cannot write logs or session state. In an unattended Job that is an agent with no logs — against the visibility goal.

**So: uid 1000 is not immovable, it is the only uid the image is provisioned for.** Changing it means building with that uid or making `$HOME` group-writable, not passing `--user`. Keeping image user, `securityContext`, and `fsGroup` all at 1000 is what makes the current design work.

## Issue to PR — 2026-09-11

The Phase 1 unit of work, proven outside K8s: **read a GitHub issue → implement it → open a PR**, as the agent's own identity, against a live repo (`julie-ng/throwaway-for-agent-tests`, issue #3 — a FizzBuzz-with-primality smoke test).

Three runs. The first failed usefully; the second and third passed.

| Run | Image | Tests run | Workspace after | PR body | PR |
|---|---|---|---|---|---|
| v1 | old `node:22-slim` | ❌ no python3 | ❌ 7 junk dirs, CPython tarballs | ❌ literally `- ???` | #4 |
| v2 | official base | ✅ 7 pass | ✅ clean | ✅ complete | #5 |
| v3 | + tsc/tsx/skills CLI | ✅ 5 pass | ✅ clean | ✅ complete | #6 |

Tests were **re-run independently** in each passing case rather than trusting the agent's report.

### Identity — PAT, and it just works

The agent has its own GitHub account (`julieio-goose`) with push access to the test repo.

```sh
export GH_TOKEN="$AGENT_GITHUB_PAT"   # that is the entire setup
```

**No `gh auth login`, no config file, no interactive step.** One env var and `gh issue view` / `gh pr create` both work. An earlier worry that the container would need more configuration than the local sandbox turned out to be unfounded.

Commits land as the agent, not the human:

```
5359fe1 julieio-goose <296437737+julieio-goose@users.noreply.github.com> Add FizzBuzz classifier (closes #3)
```

Clone and push over HTTPS, with the token kept out of `.git/config`:

```sh
git clone https://x-access-token:$PAT@github.com/<repo>.git .
git remote set-url origin https://github.com/<repo>.git   # strip the token
git config credential.helper '!f() { echo username=x-access-token; echo password=$PAT; }; f'
```

> [!NOTE]
> The token is a **classic PAT** (`ghp_`), so its scopes are account-wide — `repo`, `gist`, `project`, `user`. It does not scope to one repository. The write boundary here is **GitHub's repo permissions on the agent account** (`push: true`, `admin: false`), not the token. A fine-grained PAT would move that boundary into the credential itself. Fine for a throwaway spike; do not describe the token as repo-scoped.

### The recipe

[`recipes/issue-to-pr.yaml`](./recipes/issue-to-pr.yaml) — baked into the image at `/recipes/`, parameterised per task.

```sh
goose run --recipe /recipes/issue-to-pr.yaml \
  --params repo=owner/name \
  --params issue_number=3 \
  --params branch=feature/whatever
```

**`--params` carries a whole task, not just simple values.** This closes the open question from switching off `--text`: `--render-recipe` shows full substitution into the prompt body, and three live runs confirm it. Phase 2 can inject per-run context this way.

Useful for iterating without spending a model call:

| Command | Does |
|---|---|
| `goose recipe validate <file>` | schema check |
| `goose run --recipe <f> --explain` | shows params, flags missing ones |
| `goose run --recipe <f> --params ... --render-recipe` | prints the rendered prompt, runs nothing |

### The first run failed, and why

Worth keeping — every failure was environmental or prompt-level, none were goose's fault.

**No interpreter.** The issue said "language-appropriate equivalent," the repo was empty so there was no convention to follow, the agent chose Python — and the image had none. It wrote tests it could not run, then spent turns downloading CPython tarballs and attempting a source build, leaving seven untracked directories behind. **Fixed by installing python3.**

**The PR body was a placeholder.** The model wrote `## Summary / - ??? ` to a file *early*, then never revised it, and `gh pr create --fill` took the title from commit messages. Its final stdout summary was accurate and complete; the PR body was useless.

> [!IMPORTANT]
> **The honest report went to stdout, which nobody reads. The useless one went to GitHub.** For an unattended agent, the artifact is the only thing a human sees — so quality instructions have to bind the *artifact*, not the final message.

Fixed in the recipe: write the PR description **last, from what actually happened**, never leave a placeholder, read it back before creating, and do not use `--fill`.

### Still exit 0

All three runs exited 0, including the one that produced untested code and a `???` PR body. Consistent with [exit code 0 is not a success signal](#exit-code-0-is-not-a-success-signal) — and a sharper case for it: **a non-empty diff is not sufficient either.** v1 changed files, so a diff-only assertion would have passed it.

## Still to work out

### Done

- [x] **Build it.** Builds unmodified. Rebased onto the official goose image.
- [x] **Run against a live gateway.** Vercel AI Gateway, baked config resolved, no interactive setup.
- [x] **Issue → PR end to end.** Three runs; two clean. Tests verified independently.
- [x] **Agent identity.** PAT on the agent account; `GH_TOKEN` alone is sufficient. Commits and PRs attributed to `julieio-goose`.
- [x] **`gh` CLI + credential.** Both settled for the spike — see [Identity](#identity--pat-and-it-just-works).
- [x] **Switch off `--text` to a recipe.** [`recipes/issue-to-pr.yaml`](./recipes/issue-to-pr.yaml). `--params` proven to carry a full task, which was the open design question.
- [x] **Does `goose run` commit on its own?** No. The Phase 1 shell commit is necessary.
- [x] **Toolchain.** python3, node 24, tsc/tsx, skills CLI, gh, ripgrep, jq. Verified in a running container.
- [x] **Image size.** Measured at each step. Rejected stripping and apt-installed `gh`, both with numbers.
- [x] Non-root + writable workspace, uid 1000 throughout.

### Open — this spike

- [ ] **Build on amd64.** Only aarch64 is verified; the cluster will likely pull amd64.
- [ ] **Apply `--max-tool-repetitions` and `--no-session`** to the Job's `goose run` invocation. Not yet used in any run.
- [ ] **Commit signing.** Deferred deliberately. Revisit once the identity model settles — it may not be SSH-based at all.
- [ ] **Pod startup latency.** Open question, not a decision. Image optimization is not the lever; warm or pre-created pods are the candidate direction, unevaluated. Feeds Phase 3.
- [ ] **Session state dies with the pod** — goose writes to `~/.local/share` and `~/.local/state` inside the container layer, not a volume. Fine for fire-and-die; relevant to the visibility goal. No decision.
- [ ] **Recipe hardening.** v3's PR body told a reviewer to run `source .venv/bin/activate && pytest`, but `.venv` is gitignored and absent from the repo. Instructions in a PR body should be runnable by someone who only has the branch.

### Open — belongs to [Phase 1](../orchestration-k8s-phase-1.md), not here

- [ ] Artifact assertion in the Job `args`. **A non-empty diff is not sufficient** — the v1 run changed files and still produced a broken PR.
- [ ] `activeDeadlineSeconds` on the Job.
- [ ] Swap the manifest's `goose run --text` for the recipe invocation.
- [ ] Init container must clone with the agent credential and set identity — the shape is proven here, but in a shell, not in K8s.

## Decision log

| Date | Decision | Notes |
|---|---|---|
| — | Base image | `node:22-slim`. Node needed for ACP client tooling. **Superseded 2026-09-11** — see the official-base entry below. |
| — | goose install | Linux install script, `CONFIGURE=false`. No brew on Linux. |
| — | Binary location | `GOOSE_BIN_DIR=/usr/local/bin` so it survives the `USER` switch. |
| — | Runtime user | `node` (uid 1000), ships with the base image. |
| — | Provider config | Baked for the spike. ConfigMap in K8s. |
| — | Secrets | Runtime env only. Never in the image. |
| 2026-09-02 | Split from the ACP image | Phase 1 is `goose run --text`. ACP client is dead weight; `goose-acp-spawn` stays as reference. |
| 2026-09-02 | Keep Node despite dropping ACP | `npx` MCP servers, and the `node` user is uid 1000 for free. Switching to `debian-slim` would mean a manual `useradd` to keep the Phase 1 `securityContext` valid. |
| 2026-09-02 | Pin versions | goose `v1.48.0`, gh `2.99.0`, node `22.23.2-bookworm-slim`, via `ARG`. Tags not digests. |
| 2026-09-02 | `openssh-client` explicit | `--no-install-recommends` drops it; the pushing container needs it. |
| 2026-09-02 | `gh` installed from pinned tarball | Avoids adding an apt source. Ships ahead of need — Phase 1 never calls it. |
| 2026-09-02 | gh credential deferred | Conflicts with identity.md's no-token scope. Not resolved by minting a token; Phase 2 decides. |
| 2026-09-11 | Keep the `gh` tarball, don't switch to apt | Measured, not assumed: same ~39MB binary either way, but apt adds a `gnupg` dependency and **floated to 2.100.0 despite the 2.99.0 pin**. Confirms the 2026-09-02 decision. |
| 2026-09-11 | Don't strip the goose binary | 59MB measured (282.6 → 223.5 MB), ~6% of the image. Stripping costs symbol names in crash traces, against an explicit visibility goal. Bad trade while Phase 1 is unproven. |
| 2026-09-11 | Keep `curl` in the final image | Corrects an earlier "build-only" note. Agents reach for `curl` at runtime; removing it repeats the missing-`ripgrep` failure from `goose-container`. `bzip2` is still build-only. |
| 2026-09-11 | **Inherit from the official goose image** | `ghcr.io/aaif-goose/goose:v1.48.0` replaces `node:22-slim` + install script. goose arrives prebuilt and stripped (~60MB smaller) and we stop owning the strip trade-off. Cost: the base is bare, so python3/node/gh/jq/ripgrep are added back, and the user is `goose` not `node` (same uid 1000). |
| 2026-09-11 | Tag-pin the base, not digest | `:v1.48.0` is readable and matches the existing `ARG` style. A tag is mutable in principle, immutable enough for a spike. |
| 2026-09-11 | **Install python3** | An agent that writes tests must be able to run them. Without it the first run shipped untested code and wasted turns building CPython from source. |
| 2026-09-11 | Add typescript + tsx | Agents reach for `tsx` to run `.ts` directly, no build step. |
| 2026-09-11 | **skills CLI, but no skills baked** | The binary lets a task install skills at runtime; baking content imports token cost and the governance gap — skills have no goose-side allowlist and a baked one can silently end a headless run. Empty `~/.agents/skills` means nothing auto-loads. Differs deliberately from `goose-container`, which bakes 23. |
| 2026-09-11 | Reset `ENTRYPOINT` | Base sets it to the goose binary. The Job's shell wrapper must run goose *and then* assert, commit and push — impossible with goose as pid 1. |
| 2026-09-11 | **PAT for the spike; identity model being refined** | **Cause:** reading issues and opening PRs needs the REST API, which takes a token. SSH only covers git transport. Faster to set up too. Supersedes identity.md's no-token scope — **a change of direction, not a deviation**. Likely endpoint is workload identity with federated identities mapped to the agent, not SSH. Details discovered in a later phase. |
| 2026-09-11 | Commit signing deferred | Not attempted; not a Phase 1 blocker. Revisit once the identity model settles, since it may not be SSH-based. |
| 2026-09-11 | Recipe over `--text`, baked into the image | `--params` carries a whole task, verified with `--render-recipe` and three live runs. Closes the open question that blocked this switch. |
| 2026-09-11 | PR body written last, `--fill` forbidden | The model drafts a placeholder early and does not revise it. **The artifact is the only thing a human sees** — its accurate stdout summary reached nobody. Quality instructions must bind the artifact. |
| 2026-09-11 | Success is asserted on the artifact, not the exit code | `goose run` exits 0 whenever the process did not crash — three routes to exit-0-with-no-work observed. **Not a goose defect**: it reports turn completion, and has no notion of task success. Defining success is the orchestration layer's job. The Job's shell step fails on an empty staged diff. |
| 2026-09-11 | Keep uid 1000 everywhere | Image user, `securityContext.runAsUser`, and volume `fsGroup` all 1000. `--user` overrides work, but an unprovisioned uid cannot write `$HOME` — goose loses logs and session state (verified). uid 1000 is the only uid the image is provisioned for. |
| 2026-09-11 | Accept a large image | 946MB. Image optimization is not where pod startup gets fixed — the levers available are worth ~6%, and layers cache per node after the first pull. Coding agents are inherently hefty. Latency belongs to infrastructure; see open questions. |
