# Discord setup (Baton Handover bot)

Status: code implemented and tested with synthetic data. **Nothing below has been done with real credentials.**
Steps marked **[needs your credentials/approval]** must be done by the owner.

How it works: a creator adds the Baton bot to a Discord server (OAuth2 "bot" install), links one text channel to a
handover and confirms the capture statement. Discord sends message events only over its Gateway (a socket a serverless
deployment cannot hold), so Baton **pulls** new messages of capturing channels over REST: on the scheduled sync
(`POST /api/connectors/sync`) and when the creator presses **Bring in new messages**. The `/handover` slash command
arrives over HTTP at the interactions endpoint.

## 1. Shared variables (once for all connectors)

| Variable | Value |
|---|---|
| `BATON_SITE_URL` | Public origin of this deployment, e.g. `https://baton.example.com` (no trailing slash). Production and previews each use their own. |
| `CONNECTOR_STATE_SECRET` | ≥ 32 random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `CONNECTOR_SECRET_KEY` | 32 random bytes, base64url: same command as above. Losing it makes stored Slack tokens unreadable (reconnect Slack). |
| `CONNECTOR_SECRET_KEY_VERSION` | Optional, `c1`. |
| `CONNECTOR_SYNC_SECRET` | Only for `POST /api/connectors/sync` (bearer). Must differ from `CRON_SECRET`, which only authorises `/api/pipeline/drain`; neither works on the other endpoint. |

## 2. Create the application **[needs your credentials/approval]**

1. Open <https://discord.com/developers/applications> → **New Application** → name it **Baton Handover** → accept the terms.
2. **General Information**: copy **Application ID** → `DISCORD_APPLICATION_ID`, **Public Key** → `DISCORD_PUBLIC_KEY`.
   Set **Interactions Endpoint URL** to `<BATON_SITE_URL>/api/connectors/discord/webhook` and save (Discord sends a
   signed PING; the deployment must already have the variables below, or saving fails).
3. **OAuth2**: copy **Client Secret** (Reset Secret) → `DISCORD_CLIENT_SECRET`. Under **Redirects** add
   `<BATON_SITE_URL>/api/connectors/discord/callback`.
4. **Bot**: **Reset Token** → `DISCORD_BOT_TOKEN`. Turn **Public Bot** on only if people outside your account should be
   able to add it (Baton's install link works either way for you). Under **Privileged Gateway Intents** enable
   **MESSAGE CONTENT INTENT** (without it Discord returns empty message text to the REST API). Leave the other
   intents off. Bots in 100+ servers need Discord's verification for this intent.
5. **Installation**: set **Install Link** to *None* (Baton builds its own link with a signed `state`).

Scopes and permissions Baton requests (fixed in code, `permissions=68608`):

| Item | Why |
|---|---|
| scope `bot` | adds the Baton bot user to the server |
| scope `applications.commands` | the `/handover` slash command |
| View Channels | see the channel list for the picker and read the linked channel |
| Read Message History | pull new messages of a capturing channel (and the optional history import) |
| Send Messages | post the notice when capture starts, pauses or stops |

## 3. Environment variables **[needs your credentials]**

`DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET` + the shared ones. Set them
in Vercel (Production and, separately, Preview) and redeploy. Until all are set, every `/api/connectors/discord/*`
route answers 404 and the panel says "Not set up on this server".

## 4. Register the `/handover` command **[needs your credentials]**

```
DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... node scripts/connectors/discord-register-commands.mjs
```

It overwrites the application's global commands with exactly `/handover` (guild channels only). It prints the command
id, never the token. Global commands can take a few minutes to show up.

## 5. Scheduled sync (Main)

Discord capture depends on `POST /api/connectors/sync` running on a schedule (Main's route, `CONNECTOR_SYNC_SECRET`), plus the
creator's **Bring in new messages**. Without a schedule, messages are pulled only when the creator presses the button.

## 6. Local development

Discord must reach the interactions endpoint over public HTTPS, so local testing needs a tunnel (for example
`cloudflared tunnel --url http://localhost:3000`). Use a **separate Discord application** for development with the
tunnel URL as its endpoint and redirect, and set `BATON_SITE_URL` to the tunnel origin in `.env.local` only. Never put
a tunnel or localhost URL into the production application or production variables. Remember that plain `npm run dev`
in this repo may target a real database (see `.env.local`).

## 7. End-to-end check **[needs your credentials and approval]**

1. Sign in as a handover's creator → **Settings → Connected channels** → **Add to Discord** → choose a server you
   manage → Authorize. You land back on the panel with "Discord added".
2. **Link a channel** → pick a text channel → **Link channel** → read the statement, tick the box (optionally choose
   earlier days) → **Start saving messages**. The bot posts "<your Baton display name> connected this channel to a Baton handover. Baton is now saving messages…" (display name only; never an email or id; neutral wording if no name is set).
3. Post a message in the channel as a person (not a bot).
4. Press **Bring in new messages** (this pulls, then adds). Or wait for the scheduled sync, which first shows
   "1 message waiting to be added" and adds it on its next run.
5. **Settings → Sources** shows a chat source "awaiting consent". Give the usual processing consent.
6. Alternative path: in the channel type `/handover` → only you see a link → open it → pick the handover → confirm.

## 8. Revocation

* **Disconnect channel** (panel): stops capture for that handover, deletes messages not yet added, posts a notice.
* **Disconnect server** (panel): the bot leaves the server (`DELETE /users/@me/guilds/{id}`), every link of that
  server is revoked and its buffered messages deleted. Sources already added stay (remove them in Sources).
* Removing the bot inside Discord is **not** delivered to Baton over HTTP. The next pull gets 403/404; Main's sync
  then pauses the link and the panel shows "Baton lost access to this channel". Use **Disconnect server** to clean up.
* Rotating the bot token: update `DISCORD_BOT_TOKEN` and redeploy.

## Known limits

* Only messages posted after consent (plus the optional history window) are captured.
* Edits and deletions of messages Baton already pulled are not seen (Gateway only).
* Author = Discord display name (global name or username); ids are never stored.
