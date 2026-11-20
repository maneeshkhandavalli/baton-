# Live provider test plan (Round 4)

Prerequisites (CHECKLIST §0): isolated stack running (done), `.env.connectors-test.local` filled for the provider,
ngrok authenticated (`ngrok config add-authtoken …`, never committed), tunnel up on the static domain with the
traffic policy (`ngrok http 3110 --url https://spilt-launch-mankind.ngrok-free.dev --traffic-policy-file
<baton-connectors-testdb>/ngrok-policy.yml`; only the seven provider webhook/callback paths are public, everything
else needs the tunnel login), `BATON_SITE_URL=<TUNNEL>`, 3110 started with
`node scripts/connectors/preview-3110.mjs .env.connectors-test.local`. Baton pages can be used directly at
`http://localhost:3110` (no tunnel login); the signed `/connect?intent=…` link works on either host.

Status (2026-11-20): **Telegram verified live** (results in the Telegram section and `../STATUS.md`). Discord, Slack
and GitHub: not yet run (credentials missing).
All browsing for installs happens at `<TUNNEL>` (same origin as the provider's redirect). Use a fresh synthetic Baton
account on the isolated stack (it is empty; nothing from baton-dev exists there) and only throwaway targets: a test
repository, a test Discord server/channel, a test Telegram group, a test Slack channel.

**A mock test, a successful install or an HTTP 200 is not a live result.** A provider is "live verified" only when a
real message/event typed by a person in the provider appears as buffered content and then in the handover's Sources.

## Evidence to capture (per provider)

| # | Question | Evidence |
|---|---|---|
| 1 | App configured? | console screenshot of callback/webhook URLs = `<TUNNEL>/api/connectors/<p>/…` (no secrets visible) |
| 2 | OAuth / bot installation successful? | Baton shows "<Provider> added"; SQL Q1 shows an `active` installation with `has_credentials` (no token) |
| 3 | Consent verified? | before consent: a test message is NOT buffered (SQL Q3 = 0); after consent the bot's notice names you |
| 4 | Real event received? | provider delivery log (GitHub Recent Deliveries / Slack event log / `telegram-set-webhook.mjs --info` with no last error) and SQL Q2 row `processed` |
| 5 | Message persisted? | panel "1 message waiting"; SQL Q3 count ≥ 1 (body never printed) |
| 6 | Correct handover updated? | after **Bring in new messages**: Settings → Sources shows `<Provider> - <channel>` on THAT handover; SQL Q4 |
| 7 | Duplicate / retry handled? | re-deliver the same event (GitHub Redeliver; Slack retries automatically on a 503) → SQL Q2 shows one `processed` row per delivery id, Q3 count unchanged |
| 8 | Disconnect / revocation? | **Disconnect channel** → link `revoked`, Q3 = 0, a new message afterwards is ignored `no_capturing_link` (bot posts "stopped by <you>"). **Disconnect group/workspace/server** is a separate action → Q1 `revoked`, credentials null, later events `installation_inactive` |

Read-only SQL on the isolated stack only (never baton-dev), e.g.
`docker exec supabase_db_baton-connectors-test psql -U postgres -tAc "<query>"`:

* Q1 `select provider, status, credentials is not null as has_credentials from public.connector_installations;`
* Q2 `select provider, delivery_id, status from public.connector_events order by received_at desc limit 10;`
* Q3 `select l.channel_label, l.state, count(b.id) from public.connector_channel_links l left join public.connector_buffered_messages b on b.link_id = l.id group by 1,2;`
* Q4 `select h.title, s.title, s.kind, s.version_number from public.sources s join public.handovers h on h.id = s.handover_id where s.kind = 'chat_import';`

## GitHub (App to register; test repository only)

| Step | Expected |
|---|---|
| Register the App per CHECKLIST §4 (callback, webhook, read-only Metadata/Issues/PRs/Contents, events) | App page shows the `<TUNNEL>` URLs |
| Baton → Settings → Connected channels → **Add to GitHub** → install on "Only select repositories": the test repo | back on Baton with "GitHub added"; Q1 active |
| Link the repository → read and confirm the capture statement | link `capturing` (GitHub posts no notice) |
| Before consent (a second repo link left pending): open an issue | Q3 for that link stays 0 |
| Open an issue and comment on it as a person | Recent Deliveries 200; Q2 `processed`; panel shows messages waiting |
| **Redeliver** the same delivery | Q2 still one row for that delivery id; Q3 unchanged |
| **Bring in new messages** | Sources shows the GitHub source awaiting consent; after consent it processes |
| Disconnect | Q1 revoked; a new issue is acknowledged but not stored |

## Discord (application "Baton"; test server)

| Step | Expected |
|---|---|
| Portal: Interactions Endpoint URL saves (signed PING verified), OAuth2 redirect, MESSAGE CONTENT intent on | save succeeds |
| `node scripts/connectors/discord-register-commands.mjs` | `/handover` registered |
| **Add to Discord** → test server → link `#test` → confirm | bot posts "<you> connected this channel…" |
| Post 2 messages as a person → **Bring in new messages** (Discord is pulled, not pushed) | Q3/Sources show them on the right handover |
| **Pause** → post message P → **Resume** → post message R → Bring in new messages | R is captured; **P is NOT** (pause notice: "paused by <you>"; fixed in `72047c0`) |
| `POST <TUNNEL>/api/connectors/sync` with `Authorization: Bearer <CONNECTOR_SYNC_SECRET>` | 200 with counts; with the CRON_SECRET instead → 401 |
| Disconnect | bot posts "stopped by <you>"; nothing new stored |

## Telegram (@BatonProjectContextBot; test group)

| Step | Expected |
|---|---|
| BotFather: `/setprivacy` Disable (then remove + re-add the bot), `/setjoingroups` Enable | — |
| `node scripts/connectors/telegram-set-webhook.mjs` (env from the isolated file) then `--info` | webhook = `<TUNNEL>/api/connectors/telegram/webhook`, no last error, can read all group messages |
| **First press Start in a private chat with the bot** | — |
| Non-admin member sends `/handover` in the group | "Only a group admin can connect this group" |
| Admin sends `/handover` | group sees only "I've sent you the link … in a private message"; the admin's private chat has the link (fixed in `72047c0`) |
| Admin without Start pressed (second admin) sends `/handover` | group: "I can't message you privately yet … press Start" |
| Open the private link signed in as a Baton user who is NOT the handover's creator | refused before anything is stored (no installation created) |
| Open it as the creator → pick the handover → confirm | bot posts "<you> connected this channel…"; link capturing |
| Post a message as a person → Bring in new messages | appears on THAT handover only (first flush = version 1) |
| Edit a message in the same capture window | the buffered row is updated, edit time recorded |
| Send a message, Pause, Resume, then edit it | the edit is ignored `outside_capture_window`; the row keeps its text |
| Pause, send a message, Resume, edit it | message ignored `no_capturing_link`, edit ignored `outside_capture_window`; no row |
| In a second group: message BEFORE `/handover`, then connect (history 0 days) and edit it | `no_installation`, then `outside_capture_window`; no row |
| More messages → Bring in new messages | a pending **candidate** version; Processing page asks for its consent → "Process the new version" (scoped run) |
| **Disconnect channel**, then post a message | link revoked, window closed; message ignored `no_capturing_link`; bot still in the group |
| **Disconnect group** (separate action), or remove the bot in Telegram | installation revoked; bot leaves (`bot_removed`); later messages ignored `installation_inactive` |

### Telegram result (2026-11-20, local test AI adapter)

Every row above passed with real messages (bot `@BatonProjectContextBot`, group "baton bot testing group",
installation `b3f0ed31`, link `0c0a0f66-49ff-4ecd-ab09-a440a836c08e`, handover
`af38678a-0f73-4c89-afa2-055c3407575d`; second group "Baton Telegram QA 2" for the pre-consent row). Delivery ids,
timestamps, source/publication ids and limits are recorded in `../STATUS.md` ("Live Telegram verification").
Not covered: the non-admin and second-admin `/handover` replies, the non-creator link refusal, a duplicate delivery,
and real AI extraction (the test adapter only matches keyword phrasing; the v2 messages were worded for it).

## Slack (app "baton"; minimal scopes; test channel)

| Step | Expected |
|---|---|
| Console changes per `slack.md` §3b (exactly `channels:history`, `channels:read`, `chat:write`, `users:read`; no slash command; events `message.channels`, `app_uninstalled`, `tokens_revoked`, `channel_left`; remove the old console install) | Event Request URL verifies (signed `url_verification`) |
| **Add to Slack** from Baton | consent screen lists exactly 4 permissions; Baton "Slack added" |
| `/invite @baton` in `#test`; link it → confirm | notice "<you> connected this channel…"; private channels absent from the picker |
| Post a message as a person | Slack event log 200; Q2 processed; author shown by display name |
| A request with a wrong signature (e.g. `curl` to the webhook) | 401, nothing stored |
| (Optional negative) approve an install missing `users:read` | Baton "wasn't added: … permissions Baton needs"; no installation stored |
| Disconnect workspace | `auth.revoke` called; Q1 revoked; later messages not stored |

## After each provider

Record the 8 answers with the evidence in `docs/status/STATUS.md` (row 1–4: "Live provider verified" only with
evidence 4–6). Screenshots must not show tokens, secrets or real people's data.
