# Proposal: isolated connector test database (NOT created — awaiting approval)

Purpose: a throwaway local Supabase stack that has the connector migrations, so live provider events can be stored
and shown as connected-channel sources, without touching `baton-dev` (Task 05 data, shared preview database).

## 1. Project configuration

* Directory (outside every git clone): `C:\Users\manee\Documents\programing\baton-connectors-testdb\`
  * `supabase\config.toml` — a copy of `baton-r4-main/supabase/config.toml` with ONLY these changes:
    ```toml
    project_id = "baton-connectors-test"

    [api]
    port = 55321

    [db]
    port = 55322
    shadow_port = 55320

    [db.pooler]
    port = 55329

    [studio]
    port = 55323

    [inbucket]
    port = 55324

    [analytics]
    port = 55327
    ```
    (the `[auth]` section keeps local email sign-up without confirmation; `site_url` / redirect URLs point at
    `http://localhost:3110`)
  * `supabase\migrations\` — a copy of `baton-r4-main/supabase/migrations/` at the integration commit (all 54 files,
    including `20261119800100_chat_import_kind.sql` and `20261119800200_connectors.sql`). No seed file.
* Start (same CLI version as baton-dev, same lean service set):
  ```
  npx supabase@2.122.1 start --workdir C:\Users\manee\Documents\programing\baton-connectors-testdb -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
  ```
  `supabase start` applies the migrations of THIS workdir to THIS project's fresh database only.

## 2. Names (all derived from the distinct project id)

| Kind | baton-dev (unchanged) | New, isolated |
|---|---|---|
| Project id | `baton-dev` | `baton-connectors-test` |
| Containers | `supabase_db_baton-dev`, `supabase_auth_baton-dev`, `supabase_rest_baton-dev`, `supabase_storage_baton-dev`, `supabase_kong_baton-dev` | `supabase_db_baton-connectors-test`, `supabase_auth_baton-connectors-test`, `supabase_rest_baton-connectors-test`, `supabase_storage_baton-connectors-test`, `supabase_kong_baton-connectors-test` |
| Volumes | `supabase_db_baton-dev`, `supabase_storage_baton-dev` (+ any `supabase_config_baton-dev`) | `supabase_db_baton-connectors-test`, `supabase_storage_baton-connectors-test` (+ `supabase_config_baton-connectors-test` if the CLI creates one) |
| Network | `supabase_network_baton-dev` | `supabase_network_baton-connectors-test` |
| API (Kong) | 127.0.0.1:54321 | 127.0.0.1:55321 |
| Postgres | 54322 (shadow 54320) | 55322 (shadow 55320) |

Before starting, Main lists `docker ps -a` and `docker volume ls` and confirms none of the new names exist; after
starting, Main shows both lists again so you can see baton-dev's containers and volumes are unchanged.

## 3. Memory

Lean stack (db, auth, rest, storage, kong) inside the existing Docker VM: about **0.6–0.9 GB** extra (Postgres
≈300–450 MB, storage ≈100 MB, Kong ≈100–150 MB, GoTrue ≈30 MB, PostgREST ≈50 MB). Free host RAM has been 2.2–3.1 GB
during this session, so while it runs: no other dev servers, and only the 3110 preview. Main checks free memory
before starting and stops the stack if free RAM falls below ~1 GB.

## 4. Isolation (why it cannot access or alter baton-dev)

* Different project id → different container names, Docker network, and named volumes; the CLI only ever addresses
  containers/volumes labelled with its own project id.
* Different host ports; the app connects to exactly one API URL. During live connector testing the 3110 preview is
  restarted with a separate env file `baton-r4-main\.env.connectors-test.local` (git-ignored) whose
  `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321` and the new stack's anon/service keys; `.env.local` (baton-dev) is
  not edited. The preview prints which API host it uses on start; Main reports it.
* No cross-database link, no foreign data wrapper, no shared volume. Migrations are applied by `supabase start` in
  the new workdir only; nothing runs `db push`, `db reset` or `migration up` against port 54322.
* Note: Supabase CLI local stacks share the same well-known local JWT signing secret, so a baton-dev session cookie
  would be *syntactically* valid on the new stack, but it names a user that does not exist there; nothing is shared.

## 5. While it is in use

* 3110 points at either baton-dev (normal review) or the isolated stack (live connector test), never both; switching
  is a restart of the single 3110 preview.
* Only fresh test accounts and throwaway provider targets (test repo / test channel / test group) are used there.

## 6. Cleanup (preserves baton-dev)

1. Stop the 3110 preview if it points at the isolated stack; restart it with `.env.local` (baton-dev).
2. `npx supabase@2.122.1 stop --workdir C:\Users\manee\Documents\programing\baton-connectors-testdb --no-backup`
   — removes ONLY `baton-connectors-test` containers and its volumes (`--no-backup` = delete this project's volumes).
3. Verify: `docker ps -a` and `docker volume ls` show no `baton-connectors-test` names and the same `baton-dev`
   names as before.
4. Delete `baton-connectors-testdb\` and `.env.connectors-test.local`.
Never `docker system prune`, `docker volume prune`, or `supabase stop` without `--workdir` pointing at the test dir.
