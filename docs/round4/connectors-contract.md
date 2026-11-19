# Round 4 — connector contract (GitHub, Discord, Slack, Telegram)

Owner: **Main**. Frozen for Workers 02 (GitHub) and 03 (Discord, Telegram, Slack). Changes go through Main.
Base: `work/r4-integration` (fc4bbb3 + this contract commit).

## 0. Principles

1. **Real ingestion, one pipeline.** Every connector turns provider events into canonical `ConnectorMessage`s.
   They become a **`chat_import` source** of a handover, then follow the existing path: masking and identity
   hashing in the parser, per-source processing consent, extraction, review, and for later batches the Task 05
   Living Handover (new source **version** → change detection → change review).
2. **Explicit consent before capture.** Installing an app or adding a bot captures nothing. The handover creator
   links one channel/repo to one handover and confirms the versioned capture statement
   (`lib/connectors/consent.ts`). Before that, events for the channel are acknowledged and dropped without
   storing content. The bot posts a visible notice in the channel when capture starts, pauses or stops.
3. **Server-only credentials.** Per-installation tokens (Slack bot token) are sealed with AES-256-GCM
   (`lib/connectors/secrets.ts`, key `CONNECTOR_SECRET_KEY`) before they reach the database. App-level secrets
   stay in env. Nothing secret is returned to the browser, logged or put in URLs.
4. **Verified, idempotent, retry-safe events.** Signature check on the raw body first. De-duplication by
   `(provider, deliveryId)` in the event ledger. A `failed` delivery or one stuck `received` for >5 min is processed
   again on the provider's retry. Duplicates are acknowledged with 200.
5. **Minimal data.** Only what a handover needs: message text, author display name/login, time, reply parent.
   No provider user ids, no emails, no attachments, no repository code.

## 1. Model (`lib/connectors/types.ts`)

| Concept | Meaning |
|---|---|
| Installation | One provider account Baton can act in: GitHub App installation, Discord guild, Slack workspace, Telegram group. `installed_by` = the Baton user who connected it. Status `active / suspended / error / revoked` (revoked is terminal: credentials deleted, every link revoked, buffers deleted). |
| Channel link | One channel/repo → one handover. State `pending_consent → capturing ⇄ paused`, `revoked` is terminal. **Linking requires the actor to be BOTH the handover creator AND the installer.** Consent: creator only, versioned. Resume (`paused → capturing`) needs a person and earlier consent. A provider may only pause. |
| Event ledger | `(provider, delivery_id)` unique, status `received / processed / ignored / failed`, attempts, reason code. No content. |
| Buffer | Normalised messages of a capturing link waiting for a flush. Unique per `(link, providerMessageId)`: an edit replaces the row. Bounded (20,000 per link). Deleted on revoke and after a successful flush. |

## 2. Flow

```
provider ──webhook──▶ /api/connectors/<p>/webhook  (worker)
   verify signature (lib/connectors/verify.ts) → parse → NormalizedEvent
   ingestEvent(store, event)  (lib/connectors/ingest.ts, Main)
      ledger de-dup → installation lifecycle → capturing links of that channel → sanitize → buffer
   respond httpStatusFor(outcome)   (503 only for transient failure → provider retries)

creator ──"Bring in new messages" / bot command / scheduled /api/connectors/sync──▶ flushLink (Main)
   buffer → chat_import transcript → first: create_source / later: create_source_version
   → server upload (service role) → confirm (size, SHA-256, kind re-measured) → completeFlush (delete buffer rows)
   creator then gives the usual processing consent in Settings → Sources, exactly like an upload
```

A flush acts as the **creator who consented** (`getConnectorFlushActor(db, linkId)` in `lib/db/actor.ts`, from a
link id only; the database checks link live, installation active, still the creator). New versions are only
possible while the handover is draft/in review; otherwise messages stay buffered and the link shows
`handover_not_accepting_updates` (see `FLUSH_MESSAGES`).

## 3. `chat_import` source kind

* Added to `SOURCE_KINDS`; **not** in `USER_UPLOAD_SOURCE_KINDS` (the browser can never upload it; schemas use the
  user list). `isChatSourceKind()` replaces `kind === "whatsapp_export"` wherever "messages vs blocks" matters.
* Format: JSON Lines, written only by `serializeTranscript` (deterministic, oldest first), parsed by
  `lib/parsers/chat-import/parse-chat-import.ts` into the same `RawChatMessage`s as WhatsApp. Header line
  `{"format":"baton.chat_import","version":1,"provider","channel"}`; message lines `{id, at, author, kind, text, reply_to}`.
* Each version holds only the messages since the previous flush (delta); change detection compares new messages with
  existing points.

## 4. Adapter output rules (`ConnectorMessage`)

* `providerMessageId` stable and unique per link (≤200 chars): Slack `ts`, Discord snowflake, Telegram
  `message_id` (prefix with chat id if needed), GitHub `issue:12`, `issue:12:comment:345`, `pr:7:review:9`,
  `commit:<sha>`, `release:<id>`.
* `authorLabel`: display name / login; never email, phone, or provider user id. `kind`: `text | system |
  media_omitted | deleted` (attachments only → `media_omitted`; a deletion event → `deleted` with the same id).
* `text`: what a person would read. GitHub: `"Opened pull request #7: <title>\n\n<body>"` style.
  Bot/self messages are skipped by the adapter (`bot_or_self_message`).
* ≤100 messages per event (`sanitizeMessages` trims; adapters should trim earlier, e.g. pushes).

## 5. Fixed routes and ownership

| Path | Owner | Notes |
|---|---|---|
| `GET /api/connectors/<p>/install?handover=<id>` | provider worker | signed-in creator only; signs `state` (`lib/connectors/state.ts`, `t:"oauth"`) and redirects to the provider |
| `GET /api/connectors/<p>/callback` | provider worker | verifies `state` against the signed-in user, exchanges the code server-side, `store.upsertInstallation`, redirects to `/handover/<id>/settings#connectors` |
| `POST /api/connectors/<p>/webhook` | provider worker | raw body, signature first, `ingestEvent`, `httpStatusFor`. Discord: interactions endpoint (PING → PONG). Slack: `url_verification` challenge. |
| `POST /api/connectors/sync` | Main | CRON_SECRET (same auth as `/api/pipeline/drain`), `flushDueLinks` with a fixed budget |
| `/connect?intent=<signed>` page | Worker 03 | bot command → signed intent (`t:"intent"`) → creator picks a handover → `linkFromIntent` → consent |
| Settings panel "Connected channels" (`components/connectors/*`, mounted in handover settings) | Worker 03 | generic, DTO-driven (`lib/contracts/connectors.ts`), all providers |
| `components/connectors/providers/github*.tsx` | Worker 02 | GitHub-specific settings (event families), rendered by the panel |
| `lib/connectors/providers/<p>/**` | provider worker | adapter (`ProviderServerAdapter`), parsers, API client, tests in `__tests__/` |
| `lib/connectors/*.ts` (core), `lib/actions/**/connectors.ts`, `lib/contracts/connectors.ts`, migrations, `package.json` scripts | Main | ask Main for changes |

All endpoint URLs derive from `BATON_SITE_URL` (`connectorUrls()`); never hardcode hosts. A provider is enabled
only when every variable in `CONNECTOR_ENV[provider]` plus `CONNECTOR_SHARED_ENV` is set; otherwise its routes
answer 404 and the UI says "not configured".

## 6. Server Functions for the UI (`lib/actions/connectors.ts`, Main)

`listHandoverConnectors`, `listInstallationChannels`, `getCaptureConsent`, `linkChannel`, `recordCaptureConsent`
(optional `historyDays` ≤ 30, pull-capable providers only), `setCapturePaused`, `unlinkChannel`, `syncLinkNow`,
`disconnectInstallation`, `readLinkIntent`, `linkFromIntent`. Logic in `lib/actions/core/connectors.ts`, testable
with `MemoryConnectorStore` and fake adapters.

## 7. Database (Main): `20261119800100_chat_import_kind.sql` (kind) and `20261119800200_connectors.sql` (connectors)

Tables `connector_installations`, `connector_channel_links`, `connector_events`, `connector_buffered_messages`;
`sources.kind` check gains `chat_import`. Service-role-only SECURITY DEFINER functions named exactly as called in
`lib/connectors/store-db.ts` (`connector_*`), plus `connector_flush_actor` and `connector_creator_handovers`. Every
lifecycle change writes `audit_logs` (`connector.*`). No browser grants, no RLS read policy on these tables.
Workers never write migrations; a worker needing a schema change asks Main.

## 8. Environment (names only; values in the setup guides, never in git)

Shared: `BATON_SITE_URL`, `CONNECTOR_STATE_SECRET` (≥32 chars), `CONNECTOR_SECRET_KEY` (32 bytes base64url),
optional `CONNECTOR_SECRET_KEY_VERSION` (`c1`), `CRON_SECRET` (existing).
GitHub: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`.
Discord: `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`.
Slack: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.
Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.

## 9. Completion states (reported separately, never conflated)

1. Code implemented · 2. Mock/synthetic tests pass · 3. Third-party app configured (owner) · 4. Live provider event
verified end-to-end (owner credentials, owner approval). "Connected" in the UI is not completion.
