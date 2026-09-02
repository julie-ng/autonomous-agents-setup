# Setting up Isolated GitLab Access for Autonomous AI Agents (V2)

## GitLab's Equivalent(s) to GitHub App Auth — Verified Against GitLab Docs

This is the GitLab counterpart to `GitHub_ClaudeBot_Setup_V2.md`. A second-opinion summary (from Gemini) proposed three patterns; I've verified each against current GitLab docs. **Two of the three had real, substantive errors** — flagged inline below, with the correct mechanism in its place. The corrected version is what's written up as the actionable guide.

**Bottom line up front:** GitLab has no direct analog to a GitHub App's RSA-key → JWT → 1-hour installation token flow scoped to *your own* GitLab resources. The closest "no stored secret" pattern (OIDC) actually works in the opposite direction from what you'd want for this pipeline. For your webhook → pod → PR pipeline, the practically-best fit is a **Project Access Token**, which is GitLab's real equivalent to a scoped, non-human bot identity.

---

## Corrections to the Gemini Summary

### ❌ Option 1 as described ("OIDC Federation, Preferred") — direction is backwards

The summary describes: *"agent requests an OIDC JWT from its cloud provider, then exchanges that JWT with GitLab's OIDC endpoints to get a scoped GitLab session token."*

This is backwards. **GitLab is the OIDC *issuer* (identity provider), not a relying party that accepts external OIDC tokens for its own API.** The real, documented flow (`ci/cloud_services`, `ci/secrets/id_token_authentication`) is:

- A GitLab CI/CD job requests an **ID token *from* GitLab** (configured via `id_tokens:` in `.gitlab-ci.yml`).
- That GitLab-issued JWT is presented *to* an external OIDC-supporting party — AWS, GCP, Azure, HashiCorp Vault — to obtain a temporary credential **for that external service**.
- There is no corresponding "present an external cloud JWT to GitLab and get a GitLab API token back" flow. It doesn't exist. GitLab's OIDC support authenticates outward, not inward.

So this pattern is genuinely excellent for "my GitLab pipeline needs to talk to AWS/GCP/Vault without a stored key" — but it does not solve "my agent needs to authenticate *to GitLab* without a stored key." It's the wrong tool for the problem you're actually solving (agent needs GitLab API/push access), and as written it isn't achievable at all.

### ⚠️ Option 2 (Project/Group Access Tokens) — accurate, with one correction

This one holds up. Verified against GitLab's Project Access Tokens docs:

- Creating one does auto-provision a dedicated bot user, username `project_{project_id}_bot` — confirmed exact format.
- It is a real bearer token used the same way a PAT is (`Authorization: Bearer` or HTTP Basic auth with any non-blank username), so calling it "not a token under the hood" would be wrong — it *is* a token, just one tied to a service identity rather than your personal account. The summary's phrasing was fair here.
- One inaccuracy to flag: older docs capped bot role at Maintainer; current docs show project access tokens can be created up to **Owner** role, so scope it down deliberately — don't default to broad.
- Expiry is mandatory: project access tokens without an expiry date were deprecated in GitLab 15.4 and removed in 16.0 — any token you create now requires an expiry, and self-managed instances may cap the max lifetime the same way personal access tokens are capped. Rotation is your responsibility, not automatic.

### ❌ Option 3 (Service Accounts) — mechanism fabricated

The summary claims service accounts can use "OAuth 2.0 client credentials (`client_id` + `client_secret` exchange)." **GitLab does not support the OAuth 2.0 client_credentials grant type at all** — it's an open, unresolved feature request (gitlab-org/gitlab#419240), not a shipped capability.

What GitLab Service Accounts actually do, per docs:
- Service accounts authenticate with a **personal access token**, generated for the service account the same way a PAT is generated for a human user. That's the only supported API auth path — no client-credentials exchange.
- SSH keys *can* be attached (correct detail) — but only via the User SSH/GPG keys API; you cannot manage SSH keys for a service account through the GitLab UI.
- **Tier gate is real and important:** Service accounts are only available on **GitLab Premium and Ultimate** (self-managed or GitLab.com). If Julie's org is on GitLab Free, this option is unavailable outright, not just harder to provision.
- Provisioning also requires elevated privilege: on GitLab.com, the Owner of the top-level group must verify their identity before creating one.

So Option 3 is real, but its mechanism is "provision a service-account user, then mint it a PAT" — i.e., it reduces to the same primitive as Option 2 (a token), just with a heavier-weight, paid-tier-gated identity behind it. It isn't a distinct tokenless mechanism the way the summary implied.

---

## What Actually Fits This Pipeline

Given the architecture in `orchestration-k8s.md` (webhook → pod → Goose → push branch → open MR → pod terminates), here's the real decision tree:

| Your situation | Use |
|---|---|
| Agent only ever touches **one repo** (matches your current `tally-split-ai` deploy-key scope) | **Project Access Token** — closest GitLab equivalent to the GitHub App pattern's per-repo scoping, and to your V1 Deploy Key |
| Agent needs to open MRs across **multiple repos in one group** | **Group Access Token** — same bot-user mechanism, scoped one level up |
| You're on **Premium/Ultimate** and want an org-durable identity decoupled from any one project/group, reusable across many repos and not tied to token-per-project sprawl | **Service Account + PAT** — heavier to provision, but the identity outlives any single access token's rotation |
| Pipeline separately needs to reach AWS/GCP/Vault (not GitLab itself) from a CI job | **OIDC ID Tokens** — genuinely the right, secret-free pattern, just for a different leg of the pipeline than "authenticate to GitLab" |

For your specific stated goal — avoid PATs for the agent — worth being direct: **there is no way to avoid a token-shaped credential entirely on GitLab today**, the way a GitHub App's short-lived installation token avoids one. Every GitLab-side option resolves to some flavor of bearer token (project/group access token, or a service account's PAT). The meaningful win available to you isn't "tokenless," it's **"not a human's personal token"** — a project access token is not tied to your GitHub-equivalent personal account, has its own bot identity, its own scope, and its own expiry, which gets you the isolation and audit-trail benefits your V1 GitHub guide was after, just not the zero-standing-secret property the GitHub App gives you.

---

## Step 1: Create the Project Access Token

1. Log into your **personal** GitLab account (owner/maintainer on the target project).
2. Navigate to the project → **Settings → Access Tokens**.
3. Fill in:
   * **Name:** something identifiable, e.g. `julieio-agent`
   * **Expiration date:** required — pick the shortest interval your rotation process can tolerate (30–90 days is a reasonable starting point; shorter if you can automate rotation)
   * **Role:** minimum needed to push branches and open MRs — **Developer** is usually sufficient (push to non-protected branches, open MRs); only use **Maintainer** if the agent needs to merge or manage protected branch settings itself, which it shouldn't in this pipeline design
   * **Scopes:** `write_repository` (git push) + `api` only if the agent needs to call the MR-creation REST endpoint directly rather than relying on a push-triggered MR flow. Avoid the broader `api` scope if `write_repository` alone covers it.
4. Click **Create project access token**.
5. **Copy the token immediately** — like a PAT, GitLab shows it exactly once.

This also creates the bot user `project_<id>_bot`, visible under **Project → Members**, which is what will show as the author of pushes and MRs — giving you the same "distinguishable from personal commits" property your V1 GitHub bot account was built for, without a second account to log into.

---

## Step 2: Store the Token for the Pod

Same guidance as the GitHub App guide's private key: **Secret volume, not env var**, in your K8s Job manifest — avoids leaking into `kubectl describe` output or logs.

```yaml
# excerpt from the Job manifest
env:
  - name: GITLAB_TOKEN
    valueFrom:
      secretKeyRef:
        name: gitlab-agent-token
        key: token
```

Unlike the GitHub App's private key (which only ever mints short-lived tokens and is never itself the credential used against the API), **this token *is* the live credential** — so treat the Secret with the same care you'd give the actual API key, not the signing key. There's no intermediate exchange step to add a layer of indirection here.

---

## Step 3: Use the Token for Git Push and MR Creation

```bash
# Push using the project access token as the credential (any non-blank username works)
git -C "$REPO_DIR" push \
  "https://julieio-agent:${GITLAB_TOKEN}@gitlab.com/julieio/tally-split-ai.git" \
  "HEAD:refs/heads/agent/${TASK_BRANCH}"
```

Opening the merge request via REST:

```bash
curl --request POST \
  --url "https://gitlab.com/api/v4/projects/${PROJECT_ID}/merge_requests" \
  --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
  --data-urlencode "source_branch=agent/${TASK_BRANCH}" \
  --data-urlencode "target_branch=main" \
  --data-urlencode "title=agent: task summary here"
```

`PROJECT_ID` is the numeric project ID (visible on the project's overview page), not the `owner/repo` path — GitLab's v4 API expects the ID or a URL-encoded full path (`julieio%2Ftally-split-ai`).

---

## Step 4: Verify the Workflow

```bash
git checkout -b agent/test-token-setup
echo "# AI Audit Trail (GitLab Project Access Token)" > AGENT_LOG.md
git add AGENT_LOG.md
git commit -m "chore: verify project access token auth"
git push "https://julieio-agent:${GITLAB_TOKEN}@gitlab.com/julieio/tally-split-ai.git" agent/test-token-setup
```

### Expected Results:

* Commit/MR authored by **`project_<id>_bot`**, visible with its own avatar in the project's Members and in commit history — clearly distinguishable from your personal commits.
* Branch protection on `main` still applies exactly as it would for any other credential — a Developer-scoped token can't push directly to a protected `main` if protection rules forbid it, forcing the feature-branch + MR pattern.
* The token stops working after its expiration date — confirm your rotation reminder (GitLab emails Owners when a token nears expiry) is actually reaching someone, since there's no auto-renewal the way an installation token regenerates itself.

---

## Open Questions for This Pipeline Specifically

* **Rotation cadence:** since there's no short-lived-token-minted-per-run mechanism here (unlike the GitHub App), the Project Access Token is a standing secret for its full expiration window. Decide a rotation cadence now and script it — GitLab exposes a rotate-token endpoint via the access tokens API, so this can be automated rather than manual.
* **Multi-repo growth:** if the K8s pipeline expands beyond `tally-split-ai` to more repos, re-evaluate Group Access Token (one bot identity, one token, scoped to the group) rather than provisioning a Project Access Token per repo — avoids token sprawl.
* **Self-managed vs. GitLab.com:** if this ever moves to a self-managed GitLab instance, double check the max token lifetime setting an admin may have configured instance-wide — self-managed instances can enforce shorter caps than GitLab.com's defaults.
