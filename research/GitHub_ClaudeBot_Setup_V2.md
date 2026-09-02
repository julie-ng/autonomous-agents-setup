# Setting up Isolated GitHub Access for Autonomous AI Agents (V2)

## A Guide to GitHub App-Based Auth — No PATs, No Bot Account, No Long-Lived Keys

V1 of this guide (`GitHub_ClaudeBot_Setup.md`) used a dedicated GitHub **bot account** plus a repo-scoped **Deploy Key** for SSH-based push + commit signing. That pattern works for a single local agent pushing from one machine. It doesn't fit a webhook → pod → PR pipeline where a Kubernetes Job spins up, needs to authenticate, opens a PR, and terminates — with no interactive session to hold an SSH agent open, and no PAT you want sitting in a container image or secret indefinitely.

This guide replaces that pattern with a **GitHub App acting on its own behalf** ("server-to-server" auth). It fits the autonomous tier of the pipeline: no PATs, no second GitHub account to maintain, and the only long-lived secret is an RSA private key that mints short-lived (1-hour) tokens on demand.

---

## Architecture Overview

A GitHub App separates identity from credentials differently than V1:

* **Identity:** The App itself has an identity (e.g. `julieio-agent`). Commits and PRs it makes show up as `julieio-agent[bot]`, auto-verified by GitHub — no manual SSH signing config, no second account to create or log into.
* **Authentication (Installation Token):** The pod generates a JWT from the App's private key, exchanges it for a short-lived **installation access token** scoped to exactly the repos the App is installed on. This token expires after 1 hour — there's no long-lived credential inside the running pod at all.
* **Authorization (App Permissions):** Scoped at the App level (contents, pull requests, etc.) and at install time (which repos). This replaces the Deploy Key's one-repo scoping, but is more flexible — you can grant multiple repos to one App install without generating more keys.

This is the "GitHub Apps that act on their own behalf" pattern GitHub documents for exactly this kind of use case: generating short-lived tokens to give to other CI/CD tools, or to pull information from a repository.

---

## Step 1: Register the GitHub App

1. Log into your **personal** GitHub account (the App is owned by your account or org, not a separate bot login).
2. Go to **Settings > Developer settings > GitHub Apps > New GitHub App**.
3. Fill in the required fields:
   * **GitHub App name:** something identifiable, e.g. `julieio-agent`
   * **Homepage URL:** can be your repo URL — not load-bearing for this use case
   * **Webhook:** if your K8s controller is the thing *receiving* GitHub webhooks (issue/PR events that trigger a pod), you can point this at your webhook receiver's URL now, or leave webhooks unchecked initially and wire it up once the receiver exists. Either is fine — this doesn't affect the App's ability to push/PR.
4. Under **Permissions**, grant only what the pod actually needs. For the webhook → pod → PR flow described in `orchestration-k8s.md`, at minimum:
   * **Repository permissions → Contents:** Read and write (push branches)
   * **Repository permissions → Pull requests:** Read and write (open PRs)
   * **Repository permissions → Metadata:** Read-only (required baseline, auto-selected)
   * Add **Checks** or **Issues** only if Goose is expected to report status back or comment — don't grant it speculatively, per the "explicit over implicit" principle.
5. Under **Where can this GitHub App be installed?**, choose "Only on this account" unless you specifically want it installable elsewhere.
6. Click **Create GitHub App**.

You'll land on the App's settings page — note the **App ID** shown near the top. You'll need it later.

---

## Step 2: Generate the Private Key

Unlike V1's `ssh-keygen` step, you don't generate this key yourself — GitHub generates it and gives you the private half once.

1. Still on the App's settings page, scroll to **Private keys**.
2. Click **Generate a private key**.
3. A `.pem` file downloads immediately. **This is your only copy** — GitHub only stores the public portion. If you lose it, you generate a new one (and must do so *before* deleting the old one, if you ever need to rotate).

Note the format: the downloaded file is in **PKCS#1** format. Some JWT libraries (notably Node's `jsonwebtoken`) expect PKCS#8. If needed, convert:

```bash
openssl pkcs8 -topk8 -nocrypt -in julieio-agent.private-key.pem -out julieio-agent.private-key.pkcs8.pem
```

You can verify a key file matches what GitHub has on record at any time:

```bash
openssl rsa -in julieio-agent.private-key.pem -pubout -outform DER | openssl sha256 -binary | openssl base64
```

Compare the output against the fingerprint shown next to the key on the App's settings page.

**Do not commit this file, bake it into a container image, or put it in an env var if you can avoid it.** For the K8s pipeline, mount it as a `Secret` volume in the pod spec — not as an environment variable — so it doesn't leak into `kubectl describe` output or logs the way an env var would.

---

## Step 3: Install the App on Your Repository

Registering the App doesn't grant it access to any code yet — that's a separate "install" step, and it's where the actual repo scoping happens (this replaces V1's Deploy Key step).

1. From the App's settings page, click **Install App** in the left sidebar.
2. Choose your account/org, then select **Only select repositories** and pick the target repo (e.g. `tally-split-ai`).
3. Confirm the install.
4. After installing, note the **Installation ID** — visible in the URL of the installation's settings page (`.../settings/installations/<INSTALLATION_ID>`), or retrievable via `GET /repos/{owner}/{repo}/installation`.

At this point you have three values the pod will need: **App ID**, **Installation ID**, and the **private key file**. Store the App ID and Installation ID as plain (non-secret) config — only the private key needs Secret-level protection.

> [!IMPORTANT]
> Because the App is installed only on this one repo, it cannot read or write anything else on your account — same isolation guarantee V1's Deploy Key gave you, but without needing a second key per repo if you later add more.

---

## Step 4: Mint a JWT, Then an Installation Token

This is the part that replaces V1's `git config --local` SSH setup. There's no persistent git identity configured on disk — instead, the pod's entrypoint does this at runtime, each invocation:

**a. Generate a JWT signed with the private key** (RS256, must include `iat`, `exp` ≤ 10 minutes out, and `iss` = App ID):

```bash
#!/usr/bin/env bash
set -o pipefail
app_id="$APP_ID"
pem="/etc/secrets/github-app/private-key.pem"

now=$(date +%s)
iat=$((now - 60))
exp=$((now + 600))

b64enc() { openssl base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n'; }

header=$(printf '{"alg":"RS256","typ":"JWT"}' | b64enc)
payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$iat" "$exp" "$app_id" | b64enc)
unsigned="${header}.${payload}"
signature=$(printf '%s' "$unsigned" | openssl dgst -sha256 -sign "$pem" | b64enc)

jwt="${unsigned}.${signature}"
```

**b. Exchange the JWT for an installation access token:**

```bash
curl --request POST \
  --url "https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens" \
  --header "Accept: application/vnd.github+json" \
  --header "Authorization: Bearer ${jwt}" \
  --header "X-GitHub-Api-Version: 2022-11-28"
```

The response includes a token (format `ghs_...`) and its expiry — always 1 hour out. Since a Phase 1 pod is stateless and short-lived per your architecture, this is a good match: the token is only ever as long-lived as the task itself.

**Note:** if your K8s controller or webhook receiver is written in JS/TS or Python, you almost certainly want to use **Octokit** (`@octokit/auth-app`) or **PyGithub**/`ghapp` instead of hand-rolling JWT signing — the SDK will take care of generating a JWT for you and will regenerate the token once it expires. The raw curl/openssl version above is shown because it matches the "fetch-and-digest, no speculation" preference and is useful for debugging inside a container that doesn't have Octokit available.

---

## Step 5: Use the Token for Git Push and PR Creation

With the installation token in hand, git operations use it as an HTTPS credential — no SSH key, no `core.sshCommand` override needed:

```bash
# Push using the installation token as the credential
git -C "$REPO_DIR" push \
  "https://x-access-token:${installation_token}@github.com/julieio/tally-split-ai.git" \
  "HEAD:refs/heads/agent/${TASK_BRANCH}"
```

Opening the PR is a plain REST call using the same token:

```bash
curl --request POST \
  --url "https://api.github.com/repos/julieio/tally-split-ai/pulls" \
  --header "Accept: application/vnd.github+json" \
  --header "Authorization: Bearer ${installation_token}" \
  --header "X-GitHub-Api-Version: 2022-11-28" \
  --data '{
    "title": "agent: task summary here",
    "head": "agent/'"${TASK_BRANCH}"'",
    "base": "main",
    "body": "Opened by julieio-agent[bot]."
  }'
```

Commit authorship on `HEAD` will already reflect whatever `user.name`/`user.email` the Goose/git process used inside the pod — set those to the App's bot identity convention if you want the same clean attribution V1 achieved (e.g. `julieio-agent[bot]` / `<app-id>+julieio-agent[bot]@users.noreply.github.com` — GitHub associates this noreply pattern with the App automatically).

---

## Step 6: Verify the Workflow

Same spirit as V1's Step 5, adapted for the token flow:

```bash
# 1. Create a test feature branch
git checkout -b agent/test-app-setup

# 2. Make a dummy change
echo "# AI Audit Trail (GitHub App)" > AGENT_LOG.md
git add AGENT_LOG.md
git commit -m "chore: verify GitHub App installation token auth"

# 3. Push using the installation token minted in Step 4
git push "https://x-access-token:${installation_token}@github.com/julieio/tally-split-ai.git" agent/test-app-setup
```

### Expected Results on GitHub:

* The commit/PR shows as authored by **julieio-agent[bot]** with the App's own avatar — auto-verified, no SSH signature step required.
* Branch protection on `main` still blocks direct pushes exactly as it did with the Deploy Key; the App's permissions don't bypass repo rules.
* The installation token used will show as expired if you try to reuse it after an hour — confirming the short-lived property is working as intended.

---

## What This Replaces From V1

| V1 concern | V2 resolution |
|---|---|
| Generate + store an SSH keypair (`ssh-keygen`) | GitHub generates the RSA keypair; you only ever hold the private half, downloaded once |
| Create and maintain a second free GitHub account | Not needed — the App itself is the identity |
| Register SSH key as both a signing key (bot account) and a deploy key (repo) — two places | One private key, used only to mint JWTs; App install determines repo scope |
| `git config --local core.sshCommand` pinning a key per repo clone | No git-level SSH config at all; auth happens via HTTPS token minted per pod run |
| Long-lived credential sitting on disk indefinitely | Installation token expires in 1 hour — matches the stateless-per-task pod model |

## Open Questions for This Pipeline Specifically

* **Where does the JWT-minting step live?** Candidates: an init container in the Job manifest, or a step in the K8s controller that mints the token *before* creating the Job and injects it as a short-lived env var/secret for that one pod run (tighter — avoids putting the private key inside the task pod at all, only the already-short-lived installation token). The latter is more in keeping with the "explicit context handoff, no ambient shared state" principle and is worth prototyping first.
* **Webhook secret vs. App webhook:** if the same App also *receives* the triggering webhook (issue/PR event → controller creates Job), that's a separate concern from the outbound push/PR auth covered here — don't conflate the App's inbound webhook secret with the private key used for outbound tokens.
