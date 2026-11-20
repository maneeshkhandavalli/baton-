# What the owner still needs to provide (2026-11-19)

Everything goes into **`C:\Users\manee\Documents\programing\baton-r4-main\.env.connectors-test.local`** with a local
editor (git-ignored). Never paste secrets into chat. After saving, Main runs
`node scripts/connectors/check-credentials.mjs .env.connectors-test.local`, which calls each provider's identity
endpoint and prints only non-secret facts (bot username, app id/slug, webhook host).

Already filled by Main (do not change): Supabase URL/keys of the isolated stack, identity keys, `CRON_SECRET`,
`CONNECTOR_STATE_SECRET`, `CONNECTOR_SECRET_KEY(_VERSION)`, `CONNECTOR_SYNC_SECRET`, **`TELEGRAM_WEBHOOK_SECRET`** and
**`GITHUB_WEBHOOK_SECRET`** (secrets we choose, not issued by a provider), `TELEGRAM_BOT_USERNAME=BatonProjectContextBot`.

## 0. Tunnel (needed by Telegram, Slack, GitHub webhooks)

| Item | What / where | Action |
|---|---|---|
| ngrok authtoken | dashboard.ngrok.com → Your Authtoken | ✅ Done 2026-11-20 (kept in ngrok's own config, never in the repo); the tunnel ran on the static domain below for the live Telegram test. |
| Static domain (optional, recommended) | dashboard.ngrok.com → Domains (free accounts get one) | Tell Main the domain name (not secret); then the URL survives restarts and console URLs never need re-entering. |

Main then runs `ngrok http 3110 --url https://spilt-launch-mankind.ngrok-free.dev --traffic-policy-file …/baton-connectors-testdb/ngrok-policy.yml` (static domain, so console URLs never change). The policy (outside the repo) leaves ONLY seven exact paths public: `/api/connectors/telegram/webhook`, `slack/webhook`, `slack/callback`, `github/webhook`, `github/callback`, `discord/webhook`, `discord/callback`; each verifies a signature, secret or signed state. Everything else (app pages, dev assets, install and sync routes, dot-segment or encoded paths) asks for the basic-auth login in `…/baton-connectors-testdb/tunnel-login.txt`. `<TUNNEL>` = `https://spilt-launch-mankind.ngrok-free.dev`.

Which providers need the tunnel: **Telegram** (webhook), **Slack** (Events API + its OAuth redirect must be https),
**GitHub** (webhook). **Discord** pulls messages over REST (`/api/connectors/sync` or "Bring in new messages"), so its
capture needs no inbound HTTPS; only its optional `/handover` slash command uses the Interactions endpoint, and its
OAuth redirect may be `http://localhost:3110/...` (add the tunnel one too). One tunnel on 3110 serves everything
because all callbacks derive from one `BATON_SITE_URL`.

## A. Non-secret details / console actions

| Provider | What Main needs from you | Console action |
|---|---|---|
| Telegram | confirm the bot is `@BatonProjectContextBot`; a **test group** where you are admin (name only) | BotFather: `/setprivacy` → Disable (then remove + re-add the bot to the test group), `/setjoingroups` → Enable. **Press Start** in a private chat with the bot. |
| Discord | the **test server** name; confirm app "Baton" | Developer Portal → Bot → **Message Content Intent ON**; OAuth2 → Redirects: add `http://localhost:3110/api/connectors/discord/callback` and `<TUNNEL>/api/connectors/discord/callback`. Interactions Endpoint URL `<TUNNEL>/api/connectors/discord/webhook` only after the tunnel runs (optional, for `/handover`). |
| Slack | the **test channel** name in midnight labs | `slack.md` §3b: scopes exactly `channels:history, channels:read, chat:write, users:read`; delete the `/handover` slash command; events `message.channels, app_uninstalled, tokens_revoked, channel_left`; Redirect URL `<TUNNEL>/api/connectors/slack/callback`; Request URL `<TUNNEL>/api/connectors/slack/webhook` (after the tunnel + preview run); remove the old console installation. |
| GitHub | a **throwaway repository** name (e.g. `<you>/baton-github-test`) | **Register a new GitHub App** (none exists yet), CHECKLIST §4: Callback `<TUNNEL>/api/connectors/github/callback` (+ `http://localhost:3110/api/connectors/github/callback`), "Request user authorization during installation" ON, webhook `<TUNNEL>/api/connectors/github/webhook` with the secret from `GITHUB_WEBHOOK_SECRET` in the env file, read-only Metadata/Issues/Pull requests/Contents, events Issues, Issue comment, Pull request, Pull request review, Push, Release, "Only on this account". |

## B. Secrets to type into `.env.connectors-test.local`

| Variable | What it is | Where to get it |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | bot token `123456:ABC…` | BotFather → `/mybots` → the bot → API Token |
| `DISCORD_APPLICATION_ID` (not secret) | application id | Developer Portal → General Information |
| `DISCORD_PUBLIC_KEY` (not secret) | Ed25519 public key (hex) | General Information |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret | OAuth2 → Client Secret (Reset if never copied) |
| `DISCORD_BOT_TOKEN` | bot token | Bot → Reset Token |
| `SLACK_CLIENT_ID` (not secret) | | Basic Information → App Credentials |
| `SLACK_CLIENT_SECRET` | | Basic Information → App Credentials |
| `SLACK_SIGNING_SECRET` | request signing secret | Basic Information → App Credentials |
| `GITHUB_APP_ID` (not secret) | numeric App ID | App settings → General → About |
| `GITHUB_APP_SLUG` (not secret) | the app's URL name (`github.com/apps/<slug>`) | App settings |
| `GITHUB_APP_CLIENT_ID` (not secret) | `Iv1…`/`Iv23…` | App settings → General |
| `GITHUB_APP_CLIENT_SECRET` | | General → Generate a new client secret |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key | General → Private keys → Generate (downloads a `.pem`). Put it on ONE line with `\n` for line breaks, or tell Main the `.pem` path and Main converts it locally without printing. |

Optional, keep empty: `SLACK_PRIVATE_CHANNELS`, `SLACK_SLASH_COMMAND` (minimal Slack by default).
