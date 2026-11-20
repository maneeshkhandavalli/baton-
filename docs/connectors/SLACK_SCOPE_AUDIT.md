# Slack permission audit (Round 4)

**Decision (owner, 2026-11-19): minimal default, private channels and slash command optional — implemented.**
Required: `channels:history`, `channels:read`, `chat:write`, `users:read`. Optional (off unless set):
`SLACK_PRIVATE_CHANNELS=1` → `groups:history`, `groups:read`; `SLACK_SLASH_COMMAND=1` → `commands`. Reinstall
procedure: `slack.md` §3b. The audit below describes the calls; line numbers are from before the change.

Source of truth: `lib/connectors/providers/slack/api.ts` (`SLACK_BOT_SCOPES`, requested in the install URL by
`routes.ts`) and the Slack Web API calls in `lib/connectors/providers/slack/server.ts`. Every call Baton makes:

| Slack API / event | Where | Scope Slack requires | Baton feature that depends on it |
|---|---|---|---|
| `conversations.list` (`types=public_channel,private_channel`) | `server.ts:156` `listChannels` | `channels:read` for public; `groups:read` for private (Slack answers `missing_scope` if a requested type lacks its scope) | channel picker in Connected channels |
| `conversations.info` | `server.ts:172` `describeChannel` | `channels:read` (public) / `groups:read` (private) | verifying the channel and its name when linking (the label is never taken from the browser) |
| `conversations.history` | `server.ts:186` `fetchHistory` | `channels:history` (public) / `groups:history` (private) | optional "include earlier days" at consent |
| Events `message.channels` | webhook | `channels:history` | live capture of public channels |
| Events `message.groups` | webhook | `groups:history` | live capture of private channels |
| Events `channel_left` / `group_left` | webhook | `channels:read` / `groups:read` | pausing a link when the app is removed from a channel |
| Events `app_uninstalled`, `tokens_revoked` | webhook | none | revocation |
| `users.info` | `server.ts:130` `displayName` | `users:read` | author display names when Slack does not include `user_profile` (always for history import; sometimes for live events) |
| `chat.postMessage` | `server.ts:202` `announceCapture` | `chat:write` | the visible "Baton is now saving messages" notice on start / pause / stop |
| Slash command `/handover` | `routes.ts:101` | `commands` | alternative way to connect a channel from Slack (ephemeral link) |
| `auth.revoke` | `server.ts:209` | none | Disconnect workspace |
| `oauth.v2.access` | `api.ts` | none (client id / secret) | install |

## Answers

1. **Which calls need `groups:history` / `groups:read`?** Only the private-channel half of the calls above:
   `conversations.list` with `private_channel`, `conversations.info` / `conversations.history` on a private channel,
   and the `message.groups` / `group_left` events. Nothing about public channels uses them.
2. **Required for public-channel ingestion?** **No.** Public channels need `channels:read` + `channels:history` only.
   The current code, however, always REQUESTS `groups:*` in the install URL and always asks `conversations.list` for
   `public_channel,private_channel`, so an app configured with public-channel scopes only would fail at install
   (Slack rejects scopes the app does not declare) and the picker would fail with `missing_scope`.
3. **Why `commands`?** Only for the `/handover` slash command. Linking from Baton's own Settings → Connected channels
   works without it. It can be optional.
4. **Why `users:read`?** Without it every author becomes "Slack member": all messages in the source collapse into one
   person, so "who owns what / who decided" (the core of a handover) is lost, and masking/identity treat everyone as
   one participant. Live events sometimes carry `user_profile`, history imports never do. **Recommended to keep.**
   `users.info` returns profile fields; Baton keeps only the display name in the transcript (never ids or emails;
   `users:read.email` is not requested).
5. **`chat:write`** is needed for the capture notice, which is part of the consent design (people in the channel are
   told). Recommended to keep.
6. **Can private-channel ingestion stay optional?** **Yes**, with a small code change (not made; awaiting review):
   * `SLACK_PRIVATE_CHANNELS=1` (server env, default off) adds `groups:history`, `groups:read` to the install URL and
     `private_channel` to `conversations.list`; the manifest lists `message.groups` / `group_left` only then.
   * `SLACK_SLASH_COMMAND=1` (default off) adds `commands`; without it the guide omits the slash command.
   * Default (minimal) set: `channels:history`, `channels:read`, `chat:write`, `users:read` — which matches a
     public-channel app plus `users:read` (and `chat:write` if your app does not have it yet).
   * Tests: install URL scopes per flag; `conversations.list` types per flag; a private channel link refused when the
     flag is off.

Implemented as described in 6 (code: `lib/connectors/config.ts` `slackOptions`, `providers/slack/api.ts`
`slackBotScopes` / `missingRequiredSlackScopes`, `server.ts`, `routes.ts`, `lib/actions/core/connectors.ts`), plus:
the OAuth callback refuses an install missing any required scope and revokes its token, so attribution and the
capture notice are never silently lost. Nothing in the Slack console has been changed.
