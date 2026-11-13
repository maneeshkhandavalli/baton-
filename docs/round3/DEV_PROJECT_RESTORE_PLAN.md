# Restore plan: original dev project → `baton-dev` (xnwpppnzvrpthukxjfojj)

Status: **REHEARSED LOCALLY (both variants 27/27); NOT executed on any hosted project.** Source: verified backup
`baton-multiagent/backup/20261113T063630Z/` (SHA-256 manifest re-checked: all 9 files OK). The original project
(`enalguyitewjojgrgzxv`, "baton-") is never contacted by any step below. No Round 3 migration is applied here; the
target ends at the baseline `20261112000500`, exactly like the source.

## 1. What the backup contains (inspected locally)

### `public.dump` (schema + data of `public` and `supabase_migrations`)
- 54 tables (26 with a data section; 22 have rows), 188 functions, 32 triggers, 22 RLS policies, 54 constraints,
  87 foreign keys, 44 indexes, 2 sequences, 1 view, 260 ACL entries.
- Owners: `postgres` (all Baton objects), `pg_database_owner` (schema `public`), `supabase_admin` (3 DEFAULT ACL
  entries: Supabase's own default privileges — must not be restored).
- `supabase_migrations.schema_migrations`: 18 rows, newest `20261112000500` (columns `version, statements, name`).
- Plain data size: public ≈ 146 KB, migration history ≈ 364 KB (it stores each migration's statements).

### `auth_storage_data.dump` (data only; 37 tables)
| Table | Rows | Restore? | Why |
|---|---|---|---|
| `auth.users` | 1 | **Yes** | The account; `public.profiles.id` references it (FK) |
| `auth.identities` | 1 | **Yes** | The user's email identity (needed to sign in with the same account) |
| `auth.sessions` | 1 | No | Bound to the old project's JWT secret; the user simply signs in again |
| `auth.refresh_tokens` | 9 | No | Same (old JWT secret) |
| `auth.mfa_amr_claims` | 1 | No | Belongs to the session above |
| `auth.schema_migrations` | 82 | **Never** | Supabase Auth's internal migration ledger; overwriting it breaks GoTrue |
| `storage.migrations` | 81 | **Never** | Supabase Storage's internal migration ledger |
| `storage.buckets` | 1 | No (recreated) | `source-uploads` is created by baseline migration `20261111001000_storage.sql` |
| `storage.objects` | 1 | No (recreated) | Created by uploading the file through the Storage API (§5) |
| 28 other auth/storage tables | 0 | — | Empty (OAuth, SAML/SSO, SCIM, WebAuthn, MFA, flow state, multipart uploads, vector/analytics buckets…) |

**Conclusion: the Auth/Storage dump must NOT be restored wholesale.** Only `auth.users` and `auth.identities` rows
are application data; everything else is session state, empty, or Supabase-internal.

### Storage
- `storage/objects.json` + one file: bucket `source-uploads`, path
  `raw/58053120-daa8-4c5a-83b5-dbe6830ea429/28820916-61e3-4bdc-8379-98412eef0794`, 7,134 bytes, `text/plain`,
  SHA-256 `269eaf89…e567162`, MD5 = original eTag.

## 2. Objects outside `public` that Baton depends on (from the baseline migrations)
These are **not** in `public.dump` (it was dumped with `-n public -n supabase_migrations`), so a public-only restore
would silently miss them:
1. `create extension citext with schema extensions` (`20261111000100_schema.sql:10`).
2. Trigger `on_auth_user_created` **on `auth.users`** → `public._handle_new_auth_user()` (creates the profile on sign-up;
   `20261111000400_lifecycle.sql:42`).
3. Bucket `source-uploads` (private, 25 MB) and policy `baton_source_uploads_insert` **on `storage.objects`**
   (`20261111001000_storage.sql`).
4. `alter default privileges in schema public revoke …` for `public/anon/authenticated/service_role`
   (`20261111001100_grants.sql:16-18`).

**Encryption / special setup:** no Supabase Vault, no pgsodium, no `pgcrypto`, no encrypted columns, no custom roles
(no `create role` in any migration). The only non-default extension is `citext` (in `extensions`). Hashed identity
values depend on the app's `IDENTITY_PEPPER` (an app secret, not a database feature) — see §8.

## 3. Approach
Rebuild the schema by **replaying the 18 baseline migration files verbatim**, then load the data. The migrations are the
source of truth and recreate everything in §2 with the original grants, without touching Supabase-owned objects.
Data is loaded as plain `INSERT`s (ids, timestamps and relationships preserved). Two variants exist because hosted
privileges cannot be proven locally (§6):
- **replica**: `set local session_replication_role = replica` for the load (Supabase's documented restore pattern);
- **noreplica fallback**: needs only table ownership — disables **user** triggers per table, defers the 2 deferrable
  FKs, inserts in FK dependency order, then runs every deferred FK check and re-enables the triggers.

The 87 FKs contain three cycles (handovers ↔ publications, handover_points ↔ point_revisions, handovers ↔ members).
The first two are closed by the only 2 DEFERRABLE FKs; the third runs through `handovers.pending_creator_member_id`,
which is NULL in every backed-up row, so it imposes no order.

## 4. Final executable procedure
All files live OUTSIDE the repository in `baton-multiagent/restore-dev/`. **The auth files contain the user's email
and auth metadata: keep them private and delete them after the restore.**

| File | SHA-256 (prefix) | Purpose |
|---|---|---|
| `10_baseline_schema.sql` | `8668c2d1` | Guard (abort unless `public` has no tables) → the 18 baseline migrations verbatim → the original 18 history rows (exact, incl. statements). One transaction |
| `20_auth_users.sql` | `e8f65ae2` | `auth.users` + `auth.identities` only, replica mode (no auto-created profile). One transaction |
| `20_auth_users_noreplica.sql` | `1c2fe348` | Same rows without replica mode (the auth trigger creates a provisional profile) |
| `30_public_data.sql` | `498d6c55` | 379 rows, replica mode; guard aborts unless phase 2 ran. One transaction |
| `30_public_data_noreplica.sql` | `c9a4a440` | Same rows, fallback mechanics (§3); replaces the provisional profile with the original. One transaction |
| `verify.sql` | — | Read-only, one grid: history, auth, FKs, disabled triggers, RLS, citext, auth trigger, storage policy, bucket, object, jobs, every public row count |
| `run-hosted.sh` | — | The only hosted runner; one phase per call; refuses the original project, the transaction pooler (6543) and the direct host; refuses to run if the SQL files differ from `SHA256SUMS` |
| `storage-restore.mjs` | — | Storage API only: checks the bucket, uploads the one file to its original path with `x-upsert: false`, downloads it back and compares SHA-256 |
| `gen.sh`, `rehearse.sh`, `SHA256SUMS` | — | Regenerate from the backup / rehearse locally / pin the rehearsed files |

### Hosted sequence (each step needs explicit approval; verification between steps)
| # | Command (in `restore-dev/`) | Writes? | Expected (anything else: stop) |
|---|---|---|---|
| 0 | user creates `backup/secrets/baton-dev.env` with one line `SUPABASE_DB_URL=postgresql://postgres.xnwpppnzvrpthukxjfojj:<pw>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres` | — | never printed; split into PG* variables in a 0600 temp file deleted on exit |
| 1 | `bash run-hosted.sh precheck` | no | `public_tables 0`, `history_table_exists 0`, `auth_users 0`, `source_uploads_bucket 0` |
| 2 | `bash run-hosted.sh probe` | no (`begin; set local …; rollback`) | records `replica` or `noreplica` for phases 2–3 |
| 3 | `bash run-hosted.sh phase1` | yes, 1 txn | `phase 1 committed` (any error: whole phase rolled back, project still empty) |
| 4 | `bash run-hosted.sh verify` | no | `history_rows 18`, `history_newest 20261112000500`, `history_round3_rows 0`, `citext 1`, `auth_user_trigger 1`, `storage_upload_policy 1`, `bucket_source_uploads false/26214400`, all public counts 0 |
| 5 | `bash run-hosted.sh phase2` | yes, 1 txn | then `verify`: `auth_users 1`, `auth_identities 1` |
| 6 | `bash run-hosted.sh phase3` | yes, 1 txn | `phase3 committed` |
| 7 | `bash run-hosted.sh verify` | no | **public row counts EQUAL to the backup (26 tables)**, `profiles_joined_to_auth 1`, `fk_constraints 87`, `user_triggers_disabled 0`, `rls_policies_public 22`, `rls_enabled_tables 26`, `jobs_queued_running 0` |
| 8 | `node storage-restore.mjs ../baton-lead/.env.baton-dev` | Storage API | `sha256Match: true`; then `verify` shows `storage_object_present 1` |
| 9 | pre-check (`hosted-apply/01_precheck.sql`) | no | newest `20261112000500`, jobs `0`, functions `true`: baton-dev is ready for the Round 3 runbook |
| 10 | delete `backup/secrets/baton-dev.env` and the `restore-dev/20_*` files | — | — |

## 5. Local rehearsal results (no network)
Target: throwaway Postgres 17 + the repo's Supabase shim (its `auth.users` extended with the backup's column list).
Phase 1 as superuser; phases 2–3 as superuser (replica) and as a **NOSUPERUSER role that owns every object in
`public`** (noreplica fallback).

| Check | replica | noreplica (non-superuser) |
|---|---|---|
| phase 1 commits; 18 history rows; newest `20261112000500`; 0 Round 3 rows; migrations seed 0 public rows | PASS | PASS |
| phase 1 guard refuses a second run; phase 3 guard refuses before phase 2 and writes nothing | PASS | PASS |
| a non-superuser cannot set `session_replication_role` (vanilla PG) | — | PASS (denied) |
| `auth.users` 1, `auth.identities` 1 | PASS | PASS |
| **public row counts equal the backup, all 26 tables** | PASS | PASS |
| profile joins its auth user | PASS | PASS |
| 0 orphan rows across all 87 FKs; 87 FKs present | PASS | PASS |
| no user trigger left disabled; audit trigger active | PASS | PASS |
| 22 RLS policies; 26 tables with RLS enabled | PASS | PASS |
| default privileges: a new public table grants nothing to `anon`/`authenticated`/`service_role` | PASS | PASS |
| `citext`; `on_auth_user_created` on `auth.users` and it still creates profiles for NEW users | PASS | PASS |
| storage policy `baton_source_uploads_insert`; bucket private 25 MB; restored source points at the backed-up path | PASS | PASS |
| migration pre-check on the restored copy: newest `20261112000500`, jobs 0, functions true | PASS | PASS |
| schema diff vs the backup's `public_schema.sql` (normalised) | 1 line: `GRANT USAGE ON SCHEMA public TO postgres` (Supabase platform grant) | same, with the stand-in role name |
| **total** | **27 / 27** | **27 / 27** |

`verify.sql` was also run against the rehearsed target: all values as expected (`storage_object_present 0` until step 8).
`run-hosted.sh` guard test (test credentials file outside `backup/secrets`, no connection): refuses original-project
credentials, the transaction pooler and the direct host.

Defects found and fixed during the rehearsal: multi-line history/data rows truncated by a line filter (now the whole
`pg_dump` output is kept, minus its `\restrict` markers); auth values ordered by JSON key instead of column position;
re-enabling triggers while deferred FK checks were pending (now `set constraints all immediate` first).

## 6. Hosted-permission analysis (local results do NOT prove these)
| Operation | Needed by | Evidence for hosted | If refused |
|---|---|---|---|
| the 18 baseline migrations (citext, trigger on `auth.users`, bucket insert, policy on `storage.objects`, default privileges) | phase 1 | They already ran successfully as `postgres` on the original hosted project | phase 1 rolls back; stop |
| `set session_replication_role = replica` | replica phases | Supabase's restore guide uses it as `postgres`; not verified here | `probe` detects it without writing; the `_noreplica` files are used |
| `alter table … disable/enable trigger user` on public tables | fallback phase 3 | `postgres` owns every public object (backup TOC) | phase 3 rolls back; stop |
| `insert into auth.users / auth.identities` | phase 2 | Commonly done as `postgres` on Supabase; not verified here; the column set must exist in the target's Auth version | phase 2 rolls back; nothing depends on it yet |

Atomicity: every write phase is one explicit transaction run with `ON_ERROR_STOP`; a failure inside a phase leaves no
partial rows. Between phases the state is consistent and re-checkable with `verify`. A failure in phase 3 after a
successful phase 2 leaves only the 2 auth rows; fix the cause and re-run phase 3.

## 7. Storage (API only) and a decision point
The restore scripts never write `storage.*`; the object is uploaded only through the Storage API. The **bucket** is
created by baseline migration `20261111001000_storage.sql` (`insert into storage.buckets … on conflict` and
`create policy … on storage.objects`), exactly as on the original project, because phase 1 replays the migrations
verbatim. If you prefer the bucket to be created through the Storage API too, it can be created via the API before
phase 1; the migration's `on conflict` then only re-asserts `public = false` and the 25 MB limit. **Please choose.**
Access: the service-role key bypasses RLS for the restore upload; the migration's `baton_source_uploads_insert`
policy governs signed uploads by app users afterwards.

## 8. Application configuration for baton-dev
- New file `baton-lead/.env.baton-dev` (ignored by the `.gitignore` rule `.env*`), created **by the user** after the
  restore: baton-dev's `NEXT_PUBLIC_SUPABASE_URL=https://xnwpppnzvrpthukxjfojj.supabase.co`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and **copies of the current** `IDENTITY_PEPPER`,
  `IDENTITY_PEPPER_VERSION=p1`, `IDENTITY_PEPPER_CANARY`, plus `CRON_SECRET`, `BATON_SITE_URL=http://localhost:3000`,
  `AI_PROVIDER=fake`, `BATON_ALLOW_FAKE_AI=1`.
- **Why the pepper must be identical:** `identity_hash = HMAC-SHA256(IDENTITY_PEPPER, …)` (`lib/contracts/identity.ts`),
  and the restored rows store those hashes with `*_identity_pepper_version = 'p1'` (`source_participants`,
  `source_exclusions`, `source_messages`, …; the schema allows only `p1`). A different pepper silently breaks participant
  exclusions and identity matches on restored data; the canary (`IDENTITY_PEPPER_CANARY`) lets the app refuse a pepper
  that does not match it.
- Run the single dev server against baton-dev without touching `.env.local`:
  `cd baton-lead && set -a && . ./.env.baton-dev && set +a && npm run dev` (shell variables win over `.env.local`).
- baton-dev dashboard: Authentication → URL Configuration: Site URL `http://localhost:3000`, Redirect URL
  `http://localhost:3000/auth/callback`; email (magic link) enabled; default SMTP is rate-limited.

## 9. Open risks
1. Hosted `postgres` permissions for replica mode and for `auth.*` inserts are unproven (mitigated by `probe`, the
   fallback, and per-phase transactions).
2. The target's Auth version could differ in `auth.users`/`auth.identities` columns; the local stand-in cannot prove
   it; phase 2 fails atomically if so.
3. The restored auth row keeps the old password-hash/confirmation fields; sign-in is by magic link, so this is inert;
   old sessions are intentionally not restored.
4. The data is the 12:06 IST snapshot of the original project.
5. Bucket creation via migration SQL (decision in §7).

## 10. Rollback
baton-dev is new and isolated; no script can contact the original project (the runner refuses its ref).
- Failed phase: rolled back automatically; fix and re-run that phase.
- Bad state after phase 3: recreate the baton-dev project (Free plan) and start again from step 1.
- Storage: delete the single object in baton-dev and re-run step 8.
- App: stop the server; `.env.local` still points at the original project.
