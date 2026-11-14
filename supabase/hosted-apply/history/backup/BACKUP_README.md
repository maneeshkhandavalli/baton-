# Baton hosted-DEV manual backup (Free plan: no managed backups)

Lives outside the repository (`baton-multiagent/backup/`). Nothing here writes to hosted; every
hosted access is a read (pg_dump / psql `select` / Storage list + download).

## Tooling
- No Supabase CLI on this machine. `supabase db dump` is a wrapper around `pg_dump`, so the same logical
  export is made with **pg_dump 17.11** from the local Docker image `postgres:17-alpine` (hosted is
  Postgres 17.11; pg_dump must be the same or a newer major). No new download.

## Credentials (never printed, never stored in the backup folder or the repo)
- `backup/secrets/db.env` — created **by the user**:
  `SUPABASE_DB_URL=postgresql://postgres.<ref>:<db password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
  Dashboard → **Connect** → **Session pooler** (port 5432; IPv4). Not the transaction pooler (6543).
  It reaches pg_dump only through `docker --env-file` (not argv). Delete the file after the backup.
- Storage download uses the existing service-role key in `baton-lead/.env.local` (read in-process).
- `run-backup.sh <ref>` refuses to run unless the DB URL and `.env.local` both belong to `<ref>`.

## What is backed up
| File | Contents | Restore with |
|---|---|---|
| `public.dump` | schema **and** data of `public` (all Baton tables, functions, RLS policies, grants, triggers) and `supabase_migrations` (applied-migration history) | `pg_restore` |
| `public_schema.sql` | the same schema as plain SQL, for reading/diffing | — |
| `auth_storage_data.dump` | **data only** of `auth` (users, identities, sessions, refresh tokens, MFA …) and `storage` (buckets + object metadata) | `pg_restore --data-only` into a Supabase project (schemas are Supabase-managed) |
| `storage/<bucket>/…` | every Storage object, downloaded byte for byte; `buckets.json` (bucket config), `objects.json` (index) | Storage API upload |
| `row_counts.txt` | row count of every table in the four schemas at backup time | verification |
| `server.txt` | database name, server version, server time of the backup | record |
| `sizes.txt`, `sha256.txt` | size and SHA-256 of every file | integrity check |

## What is NOT backed up (and why)
- **Supabase-managed schemas' definitions** (`auth`, `storage`, `realtime`, `vault`, `graphql`, `extensions`,
  `pgsodium`, `net`, `cron`): owned by Supabase, recreated by any Supabase project. Only their *data* that Baton
  depends on (`auth`, `storage`) is dumped.
- **Database roles** (`anon`, `authenticated`, `service_role`, …): built into every Supabase project; Baton
  creates no custom roles (checked: no `create role` in `supabase/migrations`).
- **Vault secrets / `pgsodium` keys**: Baton stores none.
- **Project configuration** (API keys, JWT secret, Auth settings: site URL, redirect URLs, email templates,
  SMTP, rate limits; Storage settings; network restrictions): lives in the Supabase platform, not the
  database. Record it separately: screenshots or notes of **Authentication → URL Configuration, Email
  Templates, SMTP Settings**, and **Project Settings → API** (key names only). The app's own env values are in
  `baton-lead/.env.local` (outside git; back it up to your password manager, not here).
- **Edge Functions, cron jobs, webhooks**: Baton has none.
- **Logs / analytics**: not needed for recovery.

## Recovery path
- **Undo a Round 3 migration** (the realistic case): each migration's §3 Rollback in
  `docs/round3/migrations.md` restores the previous function definitions from the baseline files; the data is
  untouched by those migrations (two add one nullable column each).
- **Full restore of Baton data into this or a new dev project**: restore `public.dump` (drop/recreate the
  `public` schema first), then `auth_storage_data.dump` data, then re-upload `storage/`. Auth users keep their ids,
  so `public.profiles` links stay valid.
- `restore-rehearsal.sh <folder>` proves the files are complete and restorable on a throwaway local Postgres
  (public + migration history fully restored and counted; auth/storage dumps proven readable and counted).
