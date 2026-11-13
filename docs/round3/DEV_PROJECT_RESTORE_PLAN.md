# Restore plan: original dev project → `baton-dev` (xnwpppnzvrpthukxjfojj)

Status: **PROPOSED — nothing executed.** Source: verified backup
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
values depend on the app's `IDENTITY_PEPPER` (an app secret, not a database feature) — see §6.

## 3. Chosen approach
**Rebuild the schema by replaying the 18 baseline migration files, then load the data.** Rationale: the migrations are
the source of truth and recreate everything in §2 (extension, auth trigger, bucket, storage policy, default
privileges) with the exact grants, without touching Supabase-owned objects. Restoring `public.dump`'s schema instead
would need manual re-creation of §2 and filtering of `supabase_admin` ACLs and `CREATE SCHEMA public`.

The data is then loaded **as plain SQL `INSERT`s** with `session_replication_role = replica` (Supabase's documented
data-restore pattern): FK checks and triggers are off during the load, so audit triggers don't fire, the auth trigger
doesn't create a duplicate profile, and row ids/timestamps are kept exactly.

Two execution channels; both produce the same result:
- **Channel S (SQL Editor, recommended):** no database password needed here. Files are pasted into baton-dev's
  SQL Editor. All files are generated locally from the backup and rehearsed on a local Postgres first.
- **Channel P (pooler, from this machine):** same files run with `psql` through baton-dev's Session pooler; needs a
  `backup/secrets/baton-dev.env` written by the user (same handling as before; never printed). Also enables the
  automated schema diff in §7.

## 4. Database restore — exact sequence (baton-dev only)

Prepared locally (no hosted access) into `baton-multiagent/restore-dev/`, then rehearsed end to end on a throwaway
local Postgres 17 + Supabase shim:

| File | Generated from | Contents |
|---|---|---|
| `10_baseline_schema.sql` | the 18 files `supabase/migrations/2026111{1,2}*.sql`, verbatim, in file order | `begin;` … 18 migrations … plus `create schema if not exists supabase_migrations` / `schema_migrations (version text primary key, statements text[], name text)` and one row per migration … `commit;` |
| `20_auth_users.sql` | `auth_storage_data.dump` → local scratch DB → `pg_dump --data-only --column-inserts -t auth.users -t auth.identities` | 2 `INSERT`s (explicit column lists) |
| `30_public_data.sql` | `public.dump` → local scratch DB → `pg_dump --data-only --column-inserts -n public` | `set session_replication_role = replica;` … all public rows … `set session_replication_role = origin;` + `setval` for the 2 sequences |

Order on baton-dev:
1. **Pre-check (read-only):** `select count(*) from information_schema.tables where table_schema='public'` must be 0;
   `select to_regclass('supabase_migrations.schema_migrations')` should be null (fresh project).
2. Run `10_baseline_schema.sql` (one transaction). Expect `COMMIT`.
3. Run `20_auth_users.sql` (before public data: `profiles.id → auth.users.id`).
4. Run `30_public_data.sql`.
5. Run the verification in §7.

Never run: any `20261113*` migration, `auth_storage_data.dump` as a whole, `auth.schema_migrations`,
`storage.migrations`, or a direct `INSERT` into `storage.objects`.

## 5. Storage restore — exact sequence
1. Bucket: already created by step 4.2 (`source-uploads`, private, 26,214,400 bytes). Verify with
   `select id, public, file_size_limit from storage.buckets`.
2. Upload the one file through the **Storage API** with baton-dev's service-role key, `upsert: false`, path
   `raw/58053120-…/28820916-…`, `content-type: text/plain`. This creates the `storage.objects` row the way Supabase
   expects (new object id; that's fine — Baton links sources by **path** only, `sources.raw_storage_path`).
3. Download it back once and compare SHA-256 to `269eaf89…e567162`.

## 6. Application configuration (original credentials untouched)
- Create `baton-lead/.env.baton-dev` (matched by `.gitignore` rule `.env*`; never committed) with **baton-dev's**
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and the **same**
  `IDENTITY_PEPPER`, `IDENTITY_PEPPER_VERSION`, `IDENTITY_PEPPER_CANARY` as today (stored identity hashes depend on
  them), plus `CRON_SECRET`, `BATON_SITE_URL=http://localhost:3000`, `AI_PROVIDER=fake`, `BATON_ALLOW_FAKE_AI=1`.
  The user pastes the three Supabase values; I never print them.
- Start the single dev server against baton-dev without editing `.env.local`:
  `set -a; . ./.env.baton-dev; set +a; npm run dev` — shell variables take precedence over `.env.local` in Next.js.
  `.env.local` (original project) stays as the fallback.
- **baton-dev dashboard settings** (manual, before sign-in): Authentication → URL Configuration: Site URL
  `http://localhost:3000`, Redirect URLs `http://localhost:3000/auth/callback`; email provider enabled (magic link);
  default SMTP is rate-limited (Resend is Rithika's item). Storage: nothing to configure beyond the migration.

## 7. Verification (all must pass before baton-dev is used)
1. `supabase_migrations.schema_migrations`: 18 rows, newest `20261112000500`, none `20261113*`.
2. Row counts of every `public` table equal `backup/20261113T063630Z/row_counts.txt` (22 non-empty tables, e.g.
   handovers 7, sources 17, handover_points 15, evidence_quotes 17, processing_jobs 30, profiles 1).
3. `auth.users` = 1 and `auth.identities` = 1; the profile joins its user (`profiles p join auth.users u using (id)` = 1).
4. Schema equality (Channel P): `pg_dump --schema-only -n public` of baton-dev, normalised, diffed against
   `public_schema.sql` — expected: no differences except ownership/ACL lines of Supabase-internal roles.
   (Channel S fallback: counts of functions 188, triggers on public tables, policies 22, FKs 87 via `pg_catalog`.)
5. Objects outside public: `citext` installed; trigger `on_auth_user_created` on `auth.users`; policy
   `baton_source_uploads_insert` on `storage.objects`; bucket `source-uploads` private.
6. `hosted-apply/01_precheck.sql` on baton-dev: newest `20261112000500`, jobs queued/running `0`, functions_present
   `true` — i.e. baton-dev is ready for the Round 3 runbook.
7. Storage file present and SHA-256 equal (§5.3).
8. App smoke (needs the user's browser): sign in by magic link as the restored user → dashboard lists the 7 handovers.

## 8. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Accidentally targeting the original project | Every script checks the target ref `xnwpppnzvrpthukxjfojj` from the URL/env before connecting and refuses anything else; the original's credentials are never loaded by restore scripts |
| Auth schema version differs between projects (column set) | `--column-inserts`; rehearsed; the two rows only use long-standing `auth.users`/`auth.identities` columns. If an insert fails, stop (nothing else depends on it until step 4.4) |
| Magic-link sign-in fails for the restored user | The identity row is restored with the same provider id and email, so the same account signs in. If it still fails, stop and investigate (§7.8); do not create a second account, because the restored data belongs to the existing user id |
| SQL Editor size limits | Largest file ≈ 0.5 MB (`10_…` with migration statements); split per migration if the editor rejects it |
| Different `IDENTITY_PEPPER` | Exclusion/identity hashes would stop matching; §6 copies the existing values |
| Data in the restored copy is a 12:06 IST snapshot | Expected; the original project stays the source of truth until we switch |

## 9. Rollback
baton-dev is new and isolated, so rollback never touches the original:
- Before 4.4: re-run is safe after `drop schema public cascade; create schema public;` + re-grant defaults — simpler:
  **pause/delete and recreate the baton-dev project** (Free plan) and start from §4.1.
- After a bad data load: `truncate` all public tables (`session_replication_role = replica`) and re-run 4.3–4.4.
- Storage: delete the single uploaded object and re-upload.
- App: unset the shell variables / stop the server; `.env.local` still points at the original project.

## 10. Approvals needed before execution
1. Generate the three restore files and run the local rehearsal (local only).
2. Choose Channel S or P (P needs `backup/secrets/baton-dev.env`).
3. Execute §4 → §5 → §7 on baton-dev; then the Round 3 runbook can target baton-dev instead of the original.
