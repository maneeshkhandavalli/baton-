# Connector setup checklist (owner) — tunnel to the local review preview

Derived from the code at `work/r4-integration` (scopes, permissions and events are the exact values the code requests;
see `lib/connectors/providers/*/api.ts` and `routes.ts`) and the per-provider guides in this folder. Secrets are never
written here: you enter them in `C:\Users\manee\Documents\programing\baton-r4-main\.env.local` (git-ignored).

`<TUNNEL>` below = your public HTTPS tunnel origin to the review preview on port **3110**, e.g.
`https://abc-123.trycloudflare.com` (no trailing slash). It must equal `BATON_SITE_URL` in `.env.local`.

## 0. Before any provider (order matters)

| # | Step | Who | Status |
|---|---|---|---|
| 0.1 | Local Supabase stack running (you start Docker Desktop and the existing `baton-dev` stack) | owner | waiting |
| 0.2 | **Connector database schema available.** The connector migrations (`20261119800100`, `20261119800200`) are NOT in the shared `baton-dev` database and must not be applied there. Live events can only be stored in an **isolated** database with its own storage. Main will propose one (separate Supabase CLI project id → separate containers and volume) for your approval, after checking memory. Until then: installs fail at "store" and events are acknowledged but cannot be saved. | owner approval → Main | **blocked on approval** |
| 0.3 | **After local verification and the isolated-database decision only:** start the tunnel: `cloudflared tunnel --url http://localhost:3110` (or `ngrok http 3110`) and note `<TUNNEL>` | owner | — |
| 0.4 | In `.env.local`: `BATON_SITE_URL=<TUNNEL>` and the shared variables below; Main restarts the 3110 preview so the server reads them | owner + Main | — |
| 0.5 | **Browse the preview at `<TUNNEL>`, not localhost**, when connecting a provider: the install route needs your Baton session on the same origin the provider redirects back to. Use email + password sign-in there (the local Auth config only allows `localhost:3000` for OAuth redirects, so Google sign-in through the tunnel will not work). | owner | — |

Shared variables (all providers):

| Variable | How to generate |
|---|---|
| `BATON_SITE_URL` | `<TUNNEL>` |
| `CONNECTOR_STATE_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `CONNECTOR_SECRET_KEY` | same command (32 random bytes, base64url) |
| `CONNECTOR_SECRET_KEY_VERSION` | `c1` (optional) |
| `CRON_SECRET` | already present (≥ 32 characters); used by `POST /api/connectors/sync` |

A provider's routes answer **404** and its card says "Not set up on this server" until the shared variables AND all of
that provider's variables are set.

## 1. Telegram — @BatonProjectContextBot (exists)

| Item | Value |
|---|---|
| Webhook URL | `<TUNNEL>/api/connectors/telegram/webhook` (set by the script, not by hand) |
| OAuth callback | none (Telegram has no install OAuth); "Add to group" link `https://t.me/BatonProjectContextBot?startgroup=baton` |
| Secret check | header `X-Telegram-Bot-Api-Secret-Token` must equal `TELEGRAM_WEBHOOK_SECRET` |
| Updates | `allowed_updates = ["message", "edited_message", "my_chat_member"]` |
| BotFather | `/setprivacy` → **Disable** (then remove and re-add the bot to the test group), `/setjoingroups` → Enable, `/setcommands` → `handover - Connect this group to a Baton handover` |
| Env | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME=BatonProjectContextBot`, `TELEGRAM_WEBHOOK_SECRET` (`A-Z a-z 0-9 _ -`, generate as above) |
| Script (after 0.3–0.4, preview running) | `node scripts/connectors/telegram-set-webhook.mjs` with `BATON_SITE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` in the environment; `--info` only checks. Prints host, pending updates, last error and "can read all group messages". |
| Note | One bot has one webhook. While it points at `<TUNNEL>` it is your development bot; production later needs the script re-run (or a second bot). |

## 2. Discord — application "Baton" (exists)

| Item | Value |
|---|---|
| Interactions Endpoint URL | `<TUNNEL>/api/connectors/discord/webhook` (Discord sends a signed PING on save: the preview must be running with the Discord variables, or saving fails) |
| OAuth2 redirect | `<TUNNEL>/api/connectors/discord/callback` |
| Scopes (fixed in code) | `bot applications.commands` |
| Bot permissions (fixed in code) | `68608` = View Channels + Send Messages + Read Message History |
| Privileged intent | **MESSAGE CONTENT INTENT: on** (others off). No Gateway connection is used: Baton pulls messages over REST. |
| Installation → Install Link | None (Baton builds its own signed link) |
| Env | `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` (General Information), `DISCORD_CLIENT_SECRET` (OAuth2), `DISCORD_BOT_TOKEN` (Bot → Reset Token) |
| Script | `node scripts/connectors/discord-register-commands.mjs` with `DISCORD_APPLICATION_ID` + `DISCORD_BOT_TOKEN` → registers global `/handover` (guild channels only; may take minutes to appear) |
| Capture | pulled on **Bring in new messages** and on `POST /api/connectors/sync` (CRON_SECRET bearer); there is no automatic schedule in the local preview |

## 3. Slack — app "baton", installed in midnight labs (exists; needs changes)

| Item | Value |
|---|---|
| OAuth redirect URL | `<TUNNEL>/api/connectors/slack/callback` |
| Event Subscriptions → Request URL | `<TUNNEL>/api/connectors/slack/webhook` (signed `url_verification` on save: preview must be running with Slack variables) |
| Slash command | **none** by default (delete `/handover`; Slack adds `commands` while one exists). Only with `SLACK_SLASH_COMMAND=1`: `/handover` → `<TUNNEL>/api/connectors/slack/webhook` |
| Bot scopes (decided: minimal) | `channels:history`, `channels:read`, `chat:write`, `users:read`. Optional: `groups:history`, `groups:read` only with `SLACK_PRIVATE_CHANNELS=1`; `commands` only with `SLACK_SLASH_COMMAND=1`. An install missing a required scope is refused. |
| Bot events | `message.channels`, `app_uninstalled`, `tokens_revoked`, `channel_left` (+ `message.groups`, `group_left` only with `SLACK_PRIVATE_CHANNELS=1`) |
| Env | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (Basic Information → App Credentials); optional flags `SLACK_PRIVATE_CHANNELS`, `SLACK_SLASH_COMMAND` (unset = off) |
| Changing the existing app | follow `slack.md` §3b (scopes, slash command, events, remove the old console install, install from Baton) — only after your review of the procedure |
| Install | from **Baton** (Settings → Connected channels → Add to Slack), not the console's "Install to Workspace": Baton's signed state ties the install to you and seals the bot token. The existing console install's token is not used. |
| In Slack | `/invite @baton` in the test channel before linking it |
| Manifest | minimal YAML in `slack.md` §2 (replace `<BATON_SITE_URL>` with `<TUNNEL>`) |

## 4. GitHub — App (not yet registered)

| Field | Value |
|---|---|
| Homepage URL | `<TUNNEL>` |
| Callback URL | `<TUNNEL>/api/connectors/github/callback` |
| Request user authorization (OAuth) during installation | **On** |
| Expire user authorization tokens | On |
| Setup URL | leave empty (disabled by the option above) |
| Redirect on update | On, if offered |
| Webhook active / URL / SSL | On / `<TUNNEL>/api/connectors/github/webhook` / enabled |
| Webhook secret | `openssl rand -hex 32` → `GITHUB_WEBHOOK_SECRET` |
| Repository permissions (read-only) | Metadata, Issues, Pull requests, Contents. Nothing else, no write, no org/account permissions |
| Events | Issues, Issue comment, Pull request, Pull request review, Push, Release (`installation` and `installation_repositories` are always delivered) |
| Where installable | Only on this account (recommended) |
| Env | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (PEM with real or `\n`-escaped newlines), `GITHUB_WEBHOOK_SECRET` |
| Test target | a throwaway repository only (e.g. `<you>/baton-github-test`), "Only select repositories" |

## 5. Verification ladder (each provider, reported separately)

| State | Meaning | How it is shown |
|---|---|---|
| 1. Code implemented | adapter, routes, UI | done for all four |
| 2. Mock tests pass | synthetic events, memory store | done (`npm run test:connectors`) |
| 3. App registered | console settings above saved | owner |
| 4. Credentials configured | variables in `.env.local`, preview restarted; provider card no longer "Not set up" | owner + Main |
| 5. Live event delivered | provider console shows a 200 delivery (GitHub Recent Deliveries, Slack event log, `telegram-set-webhook.mjs --info` with no last error, Discord: Bring in new messages pulls it) and the link shows "1 message waiting" | owner + Main (needs 0.2) |
| 6. Event appears in Baton | after **Bring in new messages**, Settings → Sources shows the `chat_import` source "awaiting consent"; after consent it processes like any source | owner + Main (needs 0.2) |

Per provider, the live check: connect (from `<TUNNEL>`) → link a **test** channel/group/repo → read and confirm the
capture statement (the bot posts a notice; GitHub has none) → post one message / open one issue as a person → see
"1 message waiting" → **Bring in new messages** → source appears awaiting consent. Then re-send the same delivery where
the provider allows it (GitHub Redeliver): it must not be stored twice.

Do not connect real team channels or repositories until states 5–6 pass on test targets.
