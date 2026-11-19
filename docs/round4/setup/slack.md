# Slack setup (Baton Handover app)

Status: code implemented and tested with synthetic data. **Nothing below has been done with real credentials.**
Steps marked **[needs your credentials/approval]** must be done by the owner.

How it works: a handover creator installs the Baton app in a workspace (OAuth v2). The bot token is encrypted
(AES-256-GCM, `CONNECTOR_SECRET_KEY`) before it is stored. The creator links a channel and confirms the capture
statement; from then on Slack pushes message events to Baton's webhook.

**Default = minimal permissions:** public channels only, no slash command. Two optional capabilities are off unless
the server turns them on (see §2b): private channels (`SLACK_PRIVATE_CHANNELS=1`) and the `/handover` slash command
(`SLACK_SLASH_COMMAND=1`). Author names (`users:read`) and the capture notice (`chat:write`) are always required: an
install that lacks either is refused and its token revoked (status "missing_permissions"), never kept in a weaker mode.

## 1. Shared variables

See `discord.md` §1 (`BATON_SITE_URL`, `CONNECTOR_STATE_SECRET`, `CONNECTOR_SECRET_KEY`, `CRON_SECRET`).

## 2. Create the app from a manifest (minimal default) **[needs your credentials/approval]**

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
oauth_config:
  redirect_urls:
    - <BATON_SITE_URL>/api/connectors/slack/callback
  scopes:
    bot:
      - channels:history
      - channels:read
      - chat:write
      - users:read
settings:
  event_subscriptions:
    request_url: <BATON_SITE_URL>/api/connectors/slack/webhook
    bot_events:
      - message.channels
      - app_uninstalled
      - tokens_revoked
      - channel_left
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

Slack verifies the event Request URL immediately (signed `url_verification`), so deploy with the variables below
first, or re-verify under **Event Subscriptions** afterwards.

| Bot scope | Default | Why |
|---|---|---|
| `channels:history` | required | read messages of public channels the app was added to |
| `channels:read` | required | list public channels for the picker, read names and whether the app is a member |
| `chat:write` | required | post the notice when capture starts, pauses or stops (part of consent: the channel is told) |
| `users:read` | required | turn an author into a display name (`users.info`); user ids and emails are never stored |
| `groups:history`, `groups:read` | optional (`SLACK_PRIVATE_CHANNELS=1`) | the same for private channels |
| `commands` | optional (`SLACK_SLASH_COMMAND=1`) | the `/handover` slash command |
| `channels:join` (never requested) | — | would let Baton join public channels by itself; Baton asks you to `/invite` it instead, so membership stays a visible human decision |

Note: Slack adds `commands` to an app automatically when it has a slash command. For the minimal app, the app must
have **no** slash command.

## 2b. Optional capabilities (off by default)

| Server variable | Add in the Slack app | Effect in Baton |
|---|---|---|
| `SLACK_PRIVATE_CHANNELS=1` | scopes `groups:history`, `groups:read`; bot events `message.groups`, `group_left` | install URL also requests the two scopes; the picker lists private channels; private-channel messages are stored after consent |
| `SLACK_SLASH_COMMAND=1` | slash command `/handover` → `<BATON_SITE_URL>/api/connectors/slack/webhook` (adds `commands`) | install URL also requests `commands`; `/handover` answers with a link to connect the channel |

While a flag is off: the install URL does not request its scopes; private channels are not listed and are refused if
linked (`private_channel`); private-channel message events are dropped before storage; `/handover` (if it still
reaches Baton) answers that the command is off and points to Settings → Connected channels. Turning a flag on needs
the console change above, a preview restart, and a reinstall from Baton (§3b).

## 3. Environment variables **[needs your credentials]**

From **Basic Information → App Credentials**: **Client ID** → `SLACK_CLIENT_ID`, **Client Secret** →
`SLACK_CLIENT_SECRET`, **Signing Secret** → `SLACK_SIGNING_SECRET`. Plus the shared ones (`CONNECTOR_SECRET_KEY` is
required: the bot token is sealed with it). Set them in Vercel and redeploy. Until all are set,
`/api/connectors/slack/*` answers 404.

Do **not** use the "Install to Workspace" button in the Slack console for normal use: install from Baton so the
signed `state` ties the install to you and the handover. (Distributing to other workspaces needs **Manage
Distribution → Activate Public Distribution**.)

## 3b. Changing the existing app's permissions (reinstall procedure) **[owner, after review]**

For the existing app (installed earlier from the console with the broader scope set):

1. **OAuth & Permissions → Bot Token Scopes:** keep exactly `channels:history`, `channels:read`, `chat:write`,
   `users:read`; remove `groups:history`, `groups:read`, `commands` (and anything else).
2. **Slash Commands:** delete `/handover` (otherwise Slack keeps `commands`).
3. **Event Subscriptions → bot events:** keep `message.channels`, `app_uninstalled`, `tokens_revoked`,
   `channel_left`; remove `message.groups`, `group_left`. The Request URL is set only once the tunnel and the preview
   with Slack variables are running (CHECKLIST §0).
4. **Remove the old console installation** (Slack → workspace settings → Manage apps → the app → Remove, or
   **Install App → Revoke**), so the unused token with the broader scopes stops existing. Ignore the console's
   "reinstall your app" banner: Baton does not use console-issued tokens.
5. **Install from Baton** (Settings → Connected channels → **Add to Slack**). The Slack consent screen must list exactly
   the four permissions. Baton checks the granted scopes; if `users:read`, `chat:write`, `channels:read` or
   `channels:history` is missing it refuses the install and revokes the token.
6. To turn on an optional capability later: set its variable, make the §2b console change, restart the preview, and
   run **Add to Slack** again from Baton (same workspace → the sealed token is replaced with the new one).

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
6. Only with `SLACK_SLASH_COMMAND=1`: `/handover` in a channel → private reply with a link → open it → pick the
   handover → confirm. With the default, the picker in Baton is the only way to link.

## 6. Revocation

* **Disconnect channel**: stops capture for that handover, deletes messages not yet added, posts a notice.
* **Disconnect workspace**: Baton calls `auth.revoke` with the stored token, then revokes every link of the workspace
  and deletes its buffered messages and the sealed token. Sources already added stay.
* Uninstalling the app in Slack sends `app_uninstalled` / `tokens_revoked`: Baton revokes the installation the same way.
* Removing the app from one channel sends `channel_left` (and `group_left` for private channels, when enabled):
  links of that channel are paused.
* Rotating secrets: regenerate in **Basic Information**, update the variables, redeploy. A new client secret does not
  invalidate installed tokens; uninstall and reinstall to replace a bot token.

## What is captured

* Top-level messages and thread replies (as replies) of linked channels, after consent; edits replace the saved
  text; deletions are recorded as deleted. Files without text become "media omitted". Bot messages, joins and leaves
  are skipped. Author = Slack display name (or real name).
* Slack expects an answer within 3 seconds; Baton only looks up display names for channels that are capturing.
