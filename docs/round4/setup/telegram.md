# Telegram setup (shared Baton bot)

Status (2026-11-20): implemented, tested with synthetic data, and **verified live locally** with the development bot
`@BatonProjectContextBot` against the isolated stack through an ngrok tunnel: capture consent, capture windows
(pause/resume, pre-consent), import as versions 1 and 2, pending-version consent, processing with the **local test AI
adapter**, publication, incoming acknowledgement, Disconnect channel and Disconnect group (evidence: `../STATUS.md`,
"Live Telegram verification"). **Not verified:** a production deployment, a production bot, and extraction by a real
AI provider. Steps marked **[needs your credentials/approval]** must be done by the owner.

How it works: one Baton bot serves every group. A group admin adds the bot to a group and sends `/handover`; the bot
sends that admin a Baton link valid for 30 minutes in a PRIVATE message (the group only sees "I've sent you the
link"), so no other group member can open it first. The admin must have pressed Start in a private chat with the bot
once; otherwise the group reply says so. Anonymous admins are asked to turn off "Remain anonymous". The handover
creator opens the link, picks the handover and confirms the capture statement; only a handover's creator can use it,
checked before anything is stored. That person becomes the group's installer in Baton; nobody else can link it while
that is active. Telegram pushes updates to Baton's webhook.

## 1. Shared variables

See `discord.md` §1 (`BATON_SITE_URL`, `CONNECTOR_STATE_SECRET`, `CONNECTOR_SECRET_KEY`, `CONNECTOR_SYNC_SECRET`).

## 2. Create the bot with BotFather **[needs your credentials/approval]**

1. In Telegram open **@BotFather** → `/newbot` → name **Baton Handover** → a username ending in `bot`
   (e.g. `BatonHandoverBot`). Copy the token → `TELEGRAM_BOT_TOKEN`; the username (without `@`) → `TELEGRAM_BOT_USERNAME`.
2. `/setprivacy` → choose the bot → **Disable**. With privacy mode on, a bot in a group only sees commands and replies to
   itself, so Baton would capture nothing. **After changing it, remove the bot from existing groups and add it again**
   (Telegram applies the setting when the bot joins). Alternative: make the bot a group admin (admins see every message).
3. `/setjoingroups` → **Enable** (allows adding the bot to groups).
4. `/setcommands` → `handover - Connect this group to a Baton handover`.
5. Optional: `/setdescription` → "Saves this group's messages to a Baton handover after the handover's creator confirms."

## 3. Environment variables **[needs your credentials]**

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `TELEGRAM_BOT_USERNAME` | e.g. `BatonHandoverBot` |
| `TELEGRAM_WEBHOOK_SECRET` | 1–256 chars of `A-Z a-z 0-9 _ -`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |

Set them (plus the shared ones) in Vercel and redeploy. Until all are set, `/api/connectors/telegram/*` answers 404.

## 4. Point the bot at Baton **[needs your credentials]**

```
BATON_SITE_URL=https://your-site TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/connectors/telegram-set-webhook.mjs
```

It calls `setWebhook` with `url=<BATON_SITE_URL>/api/connectors/telegram/webhook`, `secret_token`, and
`allowed_updates=["message","edited_message","my_chat_member"]`, then prints the webhook host, pending updates, the last
delivery error and whether the bot can read all group messages. Add `--info` to only check. It never prints the token
or secret. A bot has exactly one webhook: development and production need **different bots**.

## 5. Groups vs supergroups

* Both work. When a group is upgraded to a supergroup (Telegram does this automatically, e.g. when history is made
  visible to new members), its id changes. Baton pauses the old link ("can't find this channel"); send `/handover`
  in the upgraded group and link it again.
* Channels (broadcast) and private chats are not captured.

## 6. What is captured

* Only messages sent **after the bot joined and after consent**. Telegram gives bots no history, so there is no
  earlier-messages option (verified live: a message sent before `/handover` was ignored as `no_installation`).
* **Capture windows:** consent opens a window, Pause closes it, Resume opens a new one, Disconnect closes it. A message
  is stored only if it was sent inside a window; an **edit** only if it was made in the SAME window as the message. A
  late edit of an older message (before consent, during a pause, or across a pause) is ignored
  (`outside_capture_window`) and never overwrites what was saved.
* Text and captions. Photos, files, voice, stickers, contacts and locations become "media omitted" (no file, no phone
  number). Telegram does not tell bots about deletions.
* Service messages (joins, title changes, pins) and other bots are skipped. Author = first + last name (or username).

## 7. Local development

Webhooks need public HTTPS: use a tunnel and a **separate development bot** whose webhook points at the tunnel
(`BATON_SITE_URL` = tunnel origin in `.env.local` only). Never point the production bot at a tunnel.

## 8. End-to-end check **[needs your credentials and approval]**

1. In the panel (Telegram card) click **Add the Baton bot to your group** (opens `t.me/<bot>?startgroup=baton`) and add
   it to a test group where you are an admin.
2. Open a private chat with the bot and press **Start** (once). In the group send `/handover`. The bot sends you the
   link privately (only admins get one; the group sees a short pointer).
3. Open it signed in as the handover's creator → choose the handover → **Continue** → read and tick → **Start saving
   messages**. The bot posts the capture notice in the group.
4. Post a message as a person. The panel shows "1 message waiting to be added".
5. **Bring in new messages** → **Settings → Sources** shows the chat source (version 1) awaiting consent; the
   Processing page collects that consent ("Process the new source").
6. Later messages + **Bring in new messages** create a **new version** of the same source holding only the messages
   since the previous import. It is not used until its consent is confirmed on the Processing page ("Process the new
   version"), which processes only that version and compares it with the published handover (change review).

Live result (2026-11-20, local test adapter): all six steps passed; details, ids and limits in `../STATUS.md`.
Known limit: avoid a third import (version 3) on the same channel until change detection treats connector versions as
additive; otherwise points backed by version 2 are flagged as "evidence missing" (STATUS.md, "Open risks").

## 9. Revocation

* **Disconnect channel** (one link): stops capture for that handover, closes its capture window, deletes messages not
  yet added, posts a notice. The bot stays in the group; later messages are ignored (`no_capturing_link`). Verified live.
* **Disconnect group** (the installation, a separate button): revokes every link of the group in all handovers, then
  the bot leaves (`leaveChat` → `bot_removed`); later updates are ignored (`installation_inactive`). Verified live.
  Disconnect channel never does this by itself.
* Removing or banning the bot in Telegram sends `my_chat_member` (left/kicked): Baton revokes the group's installation
  and deletes its buffered messages. Sources already added stay.
* Rotating the token: BotFather `/revoke`, update `TELEGRAM_BOT_TOKEN`, run the webhook script again.

## Security notes

* The webhook accepts a request only when `X-Telegram-Bot-Api-Secret-Token` equals `TELEGRAM_WEBHOOK_SECRET`.
* The `/handover` link goes only to the admin who asked, privately, for 30 minutes. It names only the group; it links
  nothing by itself, needs a signed-in Baton handover creator, and capture starts only after their explicit consent,
  which the bot announces in the group.
