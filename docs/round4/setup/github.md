# GitHub connector: owner setup guide

This guide sets up the GitHub App Baton uses to bring a repository's issues, pull requests, reviews, commit messages
and releases into a handover. Steps that need **real credentials or your approval** are marked **[OWNER]**. Nothing
in this guide is done by the code or by agents; no real credential is in git.

Status at the time of writing:

1. Code implemented: yes (`lib/connectors/providers/github/**`, `app/api/connectors/github/**`).
2. Mock/synthetic tests: pass (`npm run test:connectors`).
3. GitHub App configured: **not done (owner)**.
4. Live event verified end to end: **not done (owner)**.

## Why a GitHub App (and not an OAuth App or a personal access token)

* **Installed per repository by the owner.** Whoever installs it chooses exactly which repositories Baton can see;
  an OAuth App or a personal token would act with all of that person's access.
* **Read-only, fine-grained permissions.** The app asks for four read permissions on repositories and nothing else:
  no write access, no account permissions, no organisation permissions.
* **No long-lived token stored anywhere.** Baton signs a short JWT with the app's private key and exchanges it for an
  installation token that lives one hour. The token is kept in server memory only, never in the database, logs or the
  browser. A personal token would have to be stored and would not expire.
* **Central webhooks with a secret.** GitHub sends events to one URL, signed with HMAC-SHA256; Baton checks the
  signature on the raw body before reading anything.
* **Revocation is visible.** Uninstalling, suspending, or removing a repository sends an event, and Baton revokes or
  pauses capture right away.

## 1. Create the app [OWNER]

On github.com: **Settings → Developer settings → GitHub Apps → New GitHub App**. (For an organisation-owned app:
*Organisation settings → Developer settings → GitHub Apps → New GitHub App*.)

Replace `<BATON_SITE_URL>` with the deployment's public URL, exactly as it is set in `BATON_SITE_URL` (for example
`https://baton.example.com`, no trailing slash). Every URL derives from it; the code never hardcodes a host.

| Field | Value |
|---|---|
| GitHub App name | `Baton Handover` (if taken, add a suffix such as `Baton Handover CodeCell`). The slug in the app's URL becomes `GITHUB_APP_SLUG`. |
| Description | "Brings issues, pull requests, reviews, commit messages and releases of the repositories you choose into a Baton handover. Read-only; never reads code." |
| Homepage URL | `<BATON_SITE_URL>` |
| Callback URL | `<BATON_SITE_URL>/api/connectors/github/callback` |
| Expire user authorization tokens | On (default) |
| **Request user authorization (OAuth) during installation** | **On.** The callback then receives `code`, `installation_id`, `setup_action` and our `state`, and Baton proves that the signed-in person really can access that installation before connecting it. |
| Enable Device Flow | Off |
| Setup URL | Leave empty. GitHub disables this field when "Request user authorization during installation" is on and sends people to the Callback URL instead, which is what Baton expects. |
| Redirect on update | On, if GitHub offers it. A later change of repositories on GitHub then returns to Baton, which shows "updated" and stores nothing. |
| Webhook → Active | On |
| Webhook URL | `<BATON_SITE_URL>/api/connectors/github/webhook` |
| Webhook secret | A new random value (below). Becomes `GITHUB_WEBHOOK_SECRET`. |
| SSL verification | Enabled |

Generate the webhook secret on your machine and paste it into the form (and later into the environment):

```sh
openssl rand -hex 32
```

### Permissions (Repository permissions only; everything else stays "No access")

| Permission | Access | Why Baton needs it |
|---|---|---|
| Metadata | Read-only | Mandatory for every GitHub App: lists the repositories of the installation (the picker shows `owner/repo`). |
| Issues | Read-only | Issue titles, descriptions, state changes and comments (`issues`, `issue_comment` events; history import). |
| Pull requests | Read-only | Pull request titles, descriptions, merges and reviews (`pull_request`, `pull_request_review` events). |
| Contents | Read-only | Required by GitHub to receive `push` and `release` events and to list commits; Baton reads **only commit messages and release notes**, never files, code or diffs. |

Do not grant any write permission, organisation permission or account permission. Baton never asks for them.

### Subscribe to events

Tick exactly these (they appear once the matching permission is selected; `installation` and
`installation_repositories` are always delivered to GitHub Apps):

| Event | What Baton does with it |
|---|---|
| Installation (`installation`) | Lifecycle: `deleted` → the connection is revoked in Baton (buffered messages deleted); `suspend` / `unsuspend` → capture stops / resumes. Always delivered. |
| Installation repositories (`installation_repositories`) | `removed` → every capturing link of a removed repository is paused. Always delivered. |
| Issues | Opened, edited (replaces the earlier text), closed (incl. "as not planned"), reopened. |
| Issue comment | Comments on issues and pull requests: created, edited (replaces), deleted (marked deleted). |
| Pull request | Opened (incl. draft), edited, merged, closed without merging, reopened, ready for review. |
| Pull request review | Approved, changes requested, and review summaries with text. Inline code comments are not captured. |
| Push | Commit messages pushed to the **default branch only**, one message per commit (≤ 100 per push), merge-commit noise skipped, emails removed from trailers such as `Co-authored-by`. |
| Release | Published and edited release notes. |

Bots (`sender.type == "Bot"` or a login ending in `[bot]`) are always skipped.

### Where can this GitHub App be installed?

* **Only on this account** when Baton is used by one organisation (recommended: smallest exposure).
* **Any account** only if people from other organisations will connect their own repositories. Every installation
  still needs a signed-in Baton handover creator to start it and to prove access in the callback.

Click **Create GitHub App**.

## 2. Collect the credentials [OWNER]

On the app's settings page (**General**):

| Value | Where it comes from | Environment variable |
|---|---|---|
| App ID | "App ID" near the top | `GITHUB_APP_ID` |
| App slug | The last part of the app's public URL `https://github.com/apps/<slug>` | `GITHUB_APP_SLUG` |
| Client ID | "Client ID" | `GITHUB_APP_CLIENT_ID` |
| Client secret | **Generate a new client secret**, copy it once | `GITHUB_APP_CLIENT_SECRET` |
| Private key | **Private keys → Generate a private key**: downloads a `.pem` file | `GITHUB_APP_PRIVATE_KEY` |
| Webhook secret | The value you generated above | `GITHUB_WEBHOOK_SECRET` |

The private key: the code accepts the PEM **either with real newlines or with newlines escaped as `\n`** (quotes
around it are fine too). For a one-line value, for example in `.env.local` or the Vercel dashboard:

```sh
awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' baton-handover.*.private-key.pem
```

Paste the output as the value of `GITHUB_APP_PRIVATE_KEY`. Then delete the downloaded `.pem` from your Downloads
folder (keep a copy only in your password manager). Never commit it.

### Shared connector variables (once for all providers)

| Variable | Value |
|---|---|
| `BATON_SITE_URL` | The public URL of the deployment, e.g. `https://baton.example.com` |
| `CONNECTOR_STATE_SECRET` | At least 32 characters: `openssl rand -base64 48` |
| `CONNECTOR_SECRET_KEY` | 32 random bytes, base64url: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `CONNECTOR_SECRET_KEY_VERSION` | Optional, `c1` |
| `CONNECTOR_SYNC_SECRET` | Scheduled sync (`POST /api/connectors/sync`); distinct from `CRON_SECRET` |

GitHub stores no per-installation credentials in Baton (`credentials: null`), but `CONNECTOR_SECRET_KEY` is still
required for the connector feature as a whole.

The GitHub routes answer **404** until every variable above is set (`connectorConfigured("github")`), and the
settings panel shows GitHub as "not configured".

Set them in **Vercel → Project → Settings → Environment Variables** (Production, and Preview if wanted) and redeploy.
[OWNER: approval needed before adding production secrets.]

## 3. Local development

* GitHub can only deliver webhooks to a **public HTTPS URL**. Locally, use a tunnel (for example
  `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`), set `BATON_SITE_URL` to the tunnel URL, and
  use a **separate development GitHub App** whose Callback and Webhook URLs point at that tunnel. Do not point the
  production app at a laptop.
* Alternatively, without a tunnel: install and link work locally if the callback URL is `http://localhost:3000/...`
  in the development app (GitHub allows http for localhost callbacks), but no events will arrive; use GitHub's
  **Advanced → Recent Deliveries → Redeliver** after switching to a tunnel.
* Remember the local environment notes in the repository: a plain `npm run dev` may target the shared database.

## 4. Manual verification [OWNER: real credentials, your approval]

1. Create a throwaway test repository (e.g. `acme/baton-github-test`).
2. In Baton, open a draft handover you created → **Settings → Connected channels → Connect GitHub**.
   You are sent to GitHub's install page. Choose **Only select repositories → the test repository** → **Install &
   Authorize**.
3. You land back on the handover settings with `status=connected`. If you see `install_requested`, an organisation
   owner must approve the installation on GitHub first; `installation_not_accessible` means the signed-in GitHub
   account cannot see that installation; `connected_by_someone_else` means another Baton user already connected it.
4. Pick the repository in the picker → **Link** → read and confirm the capture consent.
5. On GitHub, open an issue in the test repository ("Test: who owns sponsor payments?").
   Within a few seconds the link shows **1 buffered message**. In the app's **Advanced → Recent Deliveries**, the
   delivery shows response 200.
6. Click **Bring in new messages**. A `chat_import` source "GitHub - acme baton-github-test" appears in
   **Settings → Sources**, **awaiting consent**. Give the usual processing consent to process it.
7. Push a commit to the default branch and to another branch: only the default-branch commit is buffered.
8. Optional: **Redeliver** the issue delivery on GitHub: Baton answers 200 and does not buffer it twice.

Completion state 4 is reached only when steps 5–6 work against the real deployment.

## 5. Revocation

* **In Baton:** Settings → Connected channels → **Disconnect** (revokes locally: every link of that installation is
  revoked and buffered messages deleted; sources already added stay until you remove them in Sources). Baton does not
  uninstall the app on GitHub for you.
* **On GitHub (full revocation):** the account that installed it → **Settings → Applications → Installed GitHub Apps
  → Baton Handover → Configure → Uninstall** (for an organisation: *Organisation settings → GitHub Apps*). GitHub
  sends `installation.deleted` and Baton revokes the connection. Suspending the app there pauses capture.
* **Removing a repository** from the installation pauses its links in Baton.
* **Rotating secrets:** generate a new private key and delete the old one on the app page; generate a new client
  secret; change the webhook secret on GitHub and in `GITHUB_WEBHOOK_SECRET` at the same time (deliveries in between
  fail with 401 and can be redelivered).
* To remove a user's OAuth grant (only used once during installation and revoked immediately by Baton): the user's
  **Settings → Applications → Authorized GitHub Apps → Revoke**.

## 6. Permissions justification (for reviewers and organisation owners)

Baton is a handover tool: it records who did what and what was decided, so a successor can take over. From a
repository it needs the conversation around the work (issue and pull request titles, descriptions, comments, review
verdicts), the one-line history of what changed (commit messages on the default branch) and what was shipped
(release notes). It requests **read-only** Metadata, Issues, Pull requests and Contents on the repositories the
installer selects; Contents is needed only because GitHub ties push and release events and the commit list to it.
Baton never reads files, code or diffs, never stores emails or GitHub user ids, skips bots, and captures nothing at all
until the handover's creator links one repository to one handover and confirms a versioned capture consent. Messages
are buffered, masked when parsed, and reach AI processing only after the creator reviews the resulting source and gives
the usual processing consent. The app has no write access and cannot change anything on GitHub.
