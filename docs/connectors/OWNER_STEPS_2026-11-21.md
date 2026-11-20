# Connector owner steps (2026-11-21)

These are the console and command steps only the owner can do. Agents never open provider consoles, never call
provider APIs and never handle secrets. Every value marked `<...>` is yours to paste; never paste a secret into a chat,
an issue, a commit or this file.

Production origin used below: `https://baton-seven-alpha.vercel.app` (call it `<SITE>`). For a laptop tunnel use a
**separate dev app or bot** per provider (see each section), never the production one: a provider app has one webhook
or interactions URL, so pointing it at a tunnel takes it away from production.

Code state these steps match (uncommitted at the time of writing, in the r4 task folder):

- One shared connector service for all four providers (one adapter interface, one capture consent, one creator and
  installer permission model, one ingest and de-duplication path, one source writer, one revocation model).
- Capture notice failures (start, pause, stop) and revocation failures are now logged as one JSON line with codes
  only, for example `{"scope":"connector","provider":"discord","event":"notice_started","code":"forbidden"}`. Search
  the Vercel function logs for `"scope":"connector"`.
- GitHub "Link a repository" now names the misconfiguration (for example "the App ID setting holds the app's Client
  ID") instead of the generic "isn't set up on this server yet", and logs `provider_config` with the reason code.
- New bot commands: `/status`, `/pause` (channel admins), `/help`. Bots do not answer questions about a handover.

## 1. GitHub (about 10 minutes)

The App "Baton Handover by Maneesh" is installed and authorised on production (installation row 20 Nov, 22:44 IST),
but no webhook delivery has reached production and no repository is linked yet.

1. github.com, Settings, Developer settings, GitHub Apps, **Baton Handover by Maneesh**, General:
   - Note the **App ID** (a number, for example `1234567`). This is NOT the Client ID (`Iv1.` or `Iv23` followed by
     letters and digits).
   - **Webhook**: Active ticked. Webhook URL exactly `<SITE>/api/connectors/github/webhook`.
   - **Webhook secret**: generate a fresh one (`openssl rand -hex 32`), paste it here and into Vercel Production
     `GITHUB_WEBHOOK_SECRET` (Sensitive). Both must be byte-identical.
   - Save.
2. Vercel, Project, Settings, Environment Variables, Production:
   - `GITHUB_APP_ID` = the numeric App ID from step 1. If Baton showed "the App ID setting holds the app's Client ID",
     this is the fix.
   - `GITHUB_APP_PRIVATE_KEY`: only if Baton says the private key can't be read. Generate a new private key on the app
     page and upload the whole `.pem` (the existing `deploy/github-key-to-vercel.sh` helper in baton-live-reports does
     this without printing it).
   - Redeploy production after any change (Vercel reads env at build and start).
3. Same App, **Permissions & events**: repository permissions read-only Metadata, Issues, Pull requests, Contents;
   events Issues, Issue comment, Pull request, Pull request review, Push, Release. Nothing else.
4. Same App, **Advanced, Recent Deliveries**: open the 20 Nov 22:44 `installation` delivery, note its status, then
   **Redeliver**.
   - Expected: 200. A 401 means the webhook secret differs between GitHub and Vercel. A connection error or a
     different host means the URL is wrong.
   - Redeliver the same delivery once more: still 200, and Baton stores it once (duplicate protection by
     `X-GitHub-Delivery`; covered by tests).
5. Create a **throwaway test repository** (for example `<you>/baton-github-test`). github.com/settings/installations,
   the Baton app, **Only select repositories**, add only that repository.
6. In Baton on production, as the handover creator: Settings, Connected channels, GitHub, **Link a repository**, pick
   the test repository, confirm the capture statement (optionally with earlier activity).
7. Open one issue and add one comment on the test repository. Expect "1 message waiting" (or 2). Press **Bring in new
   messages**: a source appears awaiting consent in Settings, Sources. Give processing consent.
8. Pass criteria: a `connector_events` row for `installation`, a 200 in Recent Deliveries, a `chat_import` source.

## 2. Discord (about 10 minutes)

1. Developer Portal, application "Baton", **General Information**, **Interactions Endpoint URL** =
   `<SITE>/api/connectors/discord/webhook`, Save. Discord sends a signed PING; saving only succeeds when production
   answers it (`DISCORD_PUBLIC_KEY` must be set on production).
2. **Bot**, Privileged Gateway Intents: **MESSAGE CONTENT INTENT on** (others off). Without it, message text arrives
   empty and Baton skips the messages, which matches the 0-message history import seen on 20 Nov.
3. Register the command once, from Git Bash in the repo (the script prints only the command name and id):

   ```
   DISCORD_APPLICATION_ID=<numeric application id> DISCORD_BOT_TOKEN=<bot token> node scripts/connectors/discord-register-commands.mjs
   ```

   It registers ONE global command, `/handover`, with an optional `action` choice: `connect` (default), `status`,
   `pause`, `help`. Global commands can take a few minutes to appear. Running it again is safe (bulk overwrite).
4. In the linked test channel: check Baton's "started saving" notice is visible. If it is not, search the Vercel logs
   for `"event":"notice_started"` to see the code (for example `forbidden` = the bot lacks Send Messages there).
5. Post **one test message** as a person. In Baton press **Bring in new messages**. Expected: a `chat_import` source
   awaiting consent.
6. Try `/handover action:status` (private answer) and, as a member with Manage Channels, `/handover action:pause`
   (public notice; only the creator can resume it in Baton).
7. Dev tunnel: create a separate Discord application for the laptop and give it the tunnel URL. Do not change the
   production application's Interactions Endpoint.

## 3. Telegram (about 3 minutes)

1. Post **one ordinary test message** as a person in the group connected on 20 Nov at 22:37. Expect "1 message waiting"
   in that handover's Connected channels. Press **Bring in new messages**; expect a source awaiting consent.
2. Set the command menu once (the script prints only scopes and command names, never the token):

   ```
   TELEGRAM_BOT_TOKEN=<bot token> node scripts/connectors/telegram-set-commands.mjs
   ```

   Group chats get `/handover`, `/status`, `/pause`, `/help`; private chats get `/help`. Equivalent BotFather
   alternative: `/setcommands`, then paste
   `handover - Connect this group to a Baton handover`, `status - See whether Baton is saving this group`,
   `pause - Pause saving (group admins only)`, `help - What Baton does here`.
3. Optional: as a group admin send `/status` (counts only), then `/pause`; the group sees the pause notice; resume in
   Baton.
4. Dev tunnel: the bot has one webhook. Use a second bot from BotFather for the laptop, never re-point
   `@BatonProjectContextBot` away from production.

## 4. Slack (about 15 minutes; blocked until done)

1. api.slack.com, Your Apps, the app, **OAuth & Permissions**:
   - Redirect URL: `<SITE>/api/connectors/slack/callback`.
   - Bot Token Scopes, exactly: `channels:history`, `channels:read`, `chat:write`, `users:read`. Remove any others.
     (`groups:history` and `groups:read` only if you also set `SLACK_PRIVATE_CHANNELS=1`; `commands` only with
     `SLACK_SLASH_COMMAND=1`. Both flags are off unless set to `1`, `true`, `yes` or `on`; tests pin this.)
2. **Slash Commands**: delete `/handover` unless you also set `SLACK_SLASH_COMMAND=1`. With it on, the command URL is
   `<SITE>/api/connectors/slack/webhook` and it supports `/handover`, `/handover status`, `/handover help` (no pause on
   Slack).
3. Vercel Production env: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (Basic Information, App
   Credentials; mark Sensitive). Leave `SLACK_PRIVATE_CHANNELS` and `SLACK_SLASH_COMMAND` unset. Redeploy.
4. **Event Subscriptions** (after the redeploy; Slack verifies the URL when you save):
   - Request URL: `<SITE>/api/connectors/slack/webhook`.
   - Bot events: `message.channels`, `app_uninstalled`, `tokens_revoked`, `channel_left`.
5. Remove the old console installation, then install from **Baton** (handover, Settings, Connected channels, Add to
   Slack), not the console's "Install to Workspace".
6. In Slack: `/invite @baton` in a test channel, link it in Baton, confirm, post one message, press **Bring in new
   messages**.
7. Dev tunnel: create a **separate Slack dev app** whose redirect URL and Request URL use the tunnel origin. A Slack
   app has one Request URL, so the production app must keep `<SITE>`.

## 5. External sync scheduler (P1; no code change)

Nothing calls the sync endpoint on production yet, so Discord is pulled and buffered messages become sources only when
the creator presses "Bring in new messages". Vercel cron cannot be used as-is (Hobby runs once a day, and it sends
`CRON_SECRET`, which this route deliberately refuses).

Ask an external scheduler (for example cron-job.org, or a GitHub Actions `schedule` workflow in a private repository
with the secret stored as an Actions secret) to send:

| Field | Value |
|---|---|
| Method | `POST` |
| URL | `<SITE>/api/connectors/sync` |
| Header | `Authorization: Bearer <CONNECTOR_SYNC_SECRET>` (the production value, at least 32 characters, different from `CRON_SECRET`) |
| Body | none |
| Interval | every 5 to 15 minutes (10 is a good default) |
| Timeout | 60 seconds |
| Expected | 200 with a JSON summary; 401 = wrong secret; 503 = `CONNECTOR_SYNC_SECRET` unset, too short or equal to `CRON_SECRET` |

Store the secret only in the scheduler's secret field. Do not log the response body anywhere public.

## 6. Not implemented: "Ask the handover" in the bots

The bots do not answer questions. Baton has no grounded, clearance-checked answer service to reuse (searched `lib/`
on 21 Nov: nothing reads a published handover to answer a question), and inventing one in a bot would risk wrong or
leaked answers. Remaining work, in order:

1. A grounded retrieval service over **published** points only (never drafts, review notes, gap answers awaiting
   review, or reviewer-only data), returning answers only with citations to visible points, and "not in the handover"
   otherwise.
2. Membership mapping from a chat user to a Baton member of that handover (a signed, user-confirmed account link per
   provider), so the answer is limited to what that member may see.
3. Private delivery: Discord ephemeral replies, Slack ephemeral replies, Telegram private messages only.
4. Rate limits, cost limits and masking of every AI payload, plus tests for each role.
