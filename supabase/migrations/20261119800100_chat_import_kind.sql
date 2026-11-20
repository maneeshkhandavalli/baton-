-- Round 4 (connectors): the `chat_import` source kind (docs/connectors/connectors-contract.md §3).
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- A `chat_import` source is the server-written JSON Lines transcript of a connected channel (GitHub, Discord,
-- Slack, Telegram). It is created only by the server (lib/connectors/source-writer.ts) through the existing
-- create_source / create_source_version / confirm_source_uploaded functions, so every existing rule (creator
-- only, draft/in review only, limits, checksums, consent, retention, RLS) applies unchanged. Browsers cannot
-- upload it: the app's upload schemas accept USER_UPLOAD_SOURCE_KINDS only.
--
-- Additive: the CHECK only gains a value; existing rows are unaffected.

alter table public.sources drop constraint sources_kind_check;
alter table public.sources
  add constraint sources_kind_check check (kind in ('whatsapp_export', 'pdf', 'docx', 'markdown', 'text', 'chat_import'));
