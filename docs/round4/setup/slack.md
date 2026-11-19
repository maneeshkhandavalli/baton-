# Slack setup (Baton Handover app)

Status: code implemented and tested with synthetic data. **Nothing below has been done with real credentials.**
Steps marked **[needs your credentials/approval]** must be done by the owner.

How it works: a handover creator installs the Baton app in a workspace (OAuth v2). The bot token is encrypted
(AES-256-GCM, `CONNECTOR_SECRET_KEY`) before it is stored. The creator links a channel and confirms the capture
statement; from then on Slack pushes message events to Baton's webhook. `/handover` in a channel answers privately
(ephemeral) with a link to connect it.

## 1. Shared variables

See `discord.md` §1 (`BATON_SITE_URL`, `CONNECTOR_STATE_SECRET`, `CONNECTOR_SECRET_KEY`, `CRON_SECRET`).

## 2. Create the app from a manifest **[needs your credentials/approval]**

<https://api.slack.com/apps> → **Create New App** → **From a manifest** → pick a workspace → paste (replace
`<BATON_SITE_URL>` with your origin, e.g. `https://baton.example.com`):

```yaml
display_information:
  name: Baton Handover
  description: Saves a channel's messages to a Baton handover after the handover's creator confirms.
features:
  bot_user:
    display_name: Baton Handover
    always_online: false
  slash_commands:
    - command: /handover
      url: <BATON_SITE_URL>/api/connectors/slack/webhook
      description: Connect this channel to a Baton handover
      should_escape: false
oauth_config:
  redirect_urls:
    - <BATON_SITE_URL>/api/connectors/slack/callback
  scopes:
    bot:
      - channels:history
      - channels:read
      - groups:history
      - groups:read
      - chat:write
      - commands
      - users:read
settings:
  event_subscriptions:
    request_url: <BATON_SITE_URL>/api/connectors/slack/webhook
    bot_events:
      - message.channels
      - message.groups
      - app_uninstalled
      - tokens_revoked
      - channel_left
      - group_left
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

Slack verifies the event Request URL immediately (signed `url_verification`), so deploy with the variables below
first, or re-verify under **Event Subscriptions** afterwards.

| Bot scope | Why |
|---|---|
| `channels:history` | read messages of public channels the app was added to |
| `groups:history` | the same for private channels |
| `channels:read` | list public channels for the picker, read names and whether the app is a member |
| `groups:read` | the same for private channels |
| `chat:write` | post the notice when capture starts, pauses or stops |
| `commands` | the `/handover` slash command |
| `users:read` | turn an author into a display name (`users.info`); user ids are never stored |
| `channels:join` (not requested) | would let Baton join public channels by itself; Baton asks you to `/invite` it instead, so membership stays a visible human decision |

## 3. Environment variables **[needs your credentials]**

From **Basic Information → App Credentials**: **Client ID** → `SLACK_CLIENT_ID`, **Client Secret** →
`SLACK_CLIENT_SECRET`, **Signing Secret** → `SLACK_SIGNING_SECRET`. Plus the shared ones (`CONNECTOR_SECRET_KEY` is
required: the bot token is sealed with it). Set them in Vercel and redeploy. Until all are set,
`/api/connectors/slack/*` answers 404.

Do **not** use the "Install to Workspace" button in the Slack console for normal use: install from Baton so the
signed `state` ties the install to you and the handover. (Distributing to other workspaces needs **Manage
Distribution → Activate Public Distribution**.)

## 4. Local development

Events and slash commands need public HTTPS: use a tunnel and a **separate development app** (same manifest with the
tunnel origin), with `BATON_SITE_URL` = tunnel origin in `.env.local` only. Never put a tunnel URL in the production app.

## 5. End-to-end check **[needs your credentials and approval]**

1. As a handover's creator: **Settings → Connected channels → Add to Slack** → Allow. You return with "Slack added".
2. In Slack, in the channel to capture: `/invite @Baton Handover` (channels where the app is not a member are greyed
   out in the picker with that instruction).
3. **Link a channel** → pick it → **Link channel** → read the statement, tick, optionally include earlier days →
   **Start saving messages**. The app posts the capture notice in the channel.
4. Post a message as a person → the panel shows "1 message waiting to be added" (refresh the page).
5. **Bring in new messages** → **Settings → Sources** shows the chat source awaiting consent.
6. Alternative: `/handover` in a channel → private reply with a link → open it → pick the handover → confirm.

## 6. Revocation

* **Disconnect channel**: stops capture for that handover, deletes messages not yet added, posts a notice.
* **Disconnect workspace**: Baton calls `auth.revoke` with the stored token, then revokes every link of the workspace
  and deletes its buffered messages and the sealed token. Sources already added stay.
* Uninstalling the app in Slack sends `app_uninstalled` / `tokens_revoked`: Baton revokes the installation the same way.
* Removing the app from one channel sends `channel_left` / `group_left`: links of that channel are paused.
* Rotating secrets: regenerate in **Basic Information**, update the variables, redeploy. A new client secret does not
  invalidate installed tokens; uninstall and reinstall to replace a bot token.

## What is captured

* Top-level messages and thread replies (as replies) of linked channels, after consent; edits replace the saved
  text; deletions are recorded as deleted. Files without text become "media omitted". Bot messages, joins and leaves
  are skipped. Author = Slack display name (or real name).
* Slack expects an answer within 3 seconds; Baton only looks up display names for channels that are capturing.
