# Round 3 migrations: hosted-apply readiness

Owner: Agent 2 (R3-C8). Status: **LOCAL ONLY. Nothing here has been applied to hosted Supabase.**
**Every migration below requires approval before any hosted apply.**

This document covers all Round 3 migrations from every worker. For each one it gives the global apply order,
the kind of change, its dependencies, rollback notes, a post-apply verification query, and the app code that
needs it. The claims are checked by an upgrade-path test, `supabase/tests/upgrade/run.sh`, which passed on
Docker PG 17 and PG 15. That test applies the baseline, seeds realistic data, then applies Round 3 on top.

## 1. Global apply order

The apply order is file-name order. The Supabase CLI and both local runners apply migrations the same way.

| # | File | Owner | Kind |
|---|---|---|---|
| 1 | `20261113100100_update_handover_details.sql` | Agent 2 | additive: new function |
| 2 | `20261113100200_create_handover_dedupe.sql` | Agent 2 | replace, same signature (`create_handover`) |
| 3 | `20261113100300_create_source_upload_retry.sql` | Agent 2 | replace, same signature (`create_source`) |
| 4 | `20261113100400_handover_summary_description.sql` | Agent 2 | replace, same signature (`api_list_my_handovers`, `api_get_handover`): adds one JSON key |
| 5 | `20261113100500_qa_l2_actor_first.sql` | Agent 2 | replace, same signature (`erase_participant`, `purge_handover`); no grant change |
| 6 | `20261113200100_upload_retention_support.sql` | Agent 3 | additive: new read-only function |
| 7 | `20261113200200_deleted_handover_raw_paths.sql` | Agent 3 | additive: new read-only function |
| 8 | `20261113300100_pipeline_fencing.sql` | Agent 4 | additive: new functions (`_pipeline_claim`, the `pipeline_*` fenced writers, `pipeline_store_extract_chunk`) |
| 9 | `20261113300200_job_yield_checkpoint.sql` | Agent 4 | additive column + trigger; replace, same signature (`complete_processing_job`) |
| 10 | `20261113300300_extract_chunk_inferred_points.sql` | Agent 4 | replace, same signature (`pipeline_store_extract_chunk`, created by #8) |
| 11 | `20261113300400_start_processing_requires_jobs.sql` | Agent 4 | replace, same signature (`start_processing`) |
| 12 | `20261113300500_revoke_unfenced_pipeline_writers.sql` | Agent 4 | **revoke** (grants only). On `origin/feature/r3-ai-pipeline` (`76b4cd7`); not yet on integration |
| 13 | `20261113300600_*` | Agent 4 | *announced, not yet written*: add a row here when it lands |

Every replacement keeps its signature, so `CREATE OR REPLACE` keeps the existing ACL. All new functions are
`SECURITY DEFINER` with `set search_path = ''`, executable by `service_role` only (browser roles have nothing).
The read functions in #4 stay `SECURITY INVOKER`, so RLS still decides visibility. No migration changes or
drops a table, column, policy or row. The single exception is #9, which adds one nullable column.

**Hosted pre-check (read-only, run by the lead only):** confirm that the hosted project is at the baseline
before applying anything:
```sql
select version from supabase_migrations.schema_migrations order by version desc limit 3;
-- expected: newest = 20261112000500 (quote_offset_check), and nothing starting 20261113
```

## 2. Order constraints

These are the points where order matters. Everything else is order-independent.

1. **#10 after #8.** #10 replaces `pipeline_store_extract_chunk`, which #8 creates. File-name order already
   guarantees this.
2. **#12 last, and only when all three of these hold:**
   - (a) #8 is applied, because the fenced twins call the revoked functions as their owner;
   - (b) the deployed worker is the build that calls only the `pipeline_*` functions
     (`lib/db/pipeline.ts` since `ab96beb`), because an older worker build would hit `42501` on every write;
   - (c) the **lead-owned SQL fixtures** are updated. Measured locally with #12 added to the normal SQL suite:
     `40_lifecycle_review`, `70_concurrency`, `90_reconciliation` and `95_integration_worker` fail
     (`permission denied for function persist_parsed_source` / `add_source_quote_evidence`), because they
     call the unfenced writers as `service_role`. The IT-SQL files that call them are `it03_quotes`,
     `it10_retry_partial`, `it11_raw_lifecycle` and `it17_db12_db13_fencing`; these were not run with #12.
     → **Owners:** the lead (`supabase/tests/sql/{40,70,90,95}`) and QA (`tests/integration/db/sql/*`),
     following Agent 4's fixture note.
3. **Migrations before app code**, for the code paths that call a new function:
   - **#1 before the wizard deploy** that autosaves details. Without it, `updateHandoverDetails` returns
     `internal`, because the RPC is unknown.
   - **#8–#10 before the worker deploy.** Without them, every run fails at once with
     `precondition_failed` / `db_schema_outdated`. There is no fallback, by design.
4. **App code that tolerates either order:**
   - #4: `mapHandoverSummary` maps a missing `description` to `null`.
   - #7: `deleteHandover` swallows a failed raw cleanup; the delete still succeeds.
   - #2, #3, #5, #6, #9, #11: behaviour only, or not called by the app.

## 3. Per-migration details

### #1 `20261113100100_update_handover_details.sql` (Agent 2, C1)
- **Changes:** new `update_handover_details(p_actor_profile_id uuid, p_handover_id uuid,
  p_expected_updated_at timestamptz, p_title text, p_team_name text, p_role_title text default null,
  p_description text default null) returns timestamptz`.
  - Rules: creator or outgoing member; `draft` only; optimistic concurrency on `updated_at` at
    millisecond precision (`BTCF0`).
  - Optional fields: NULL keeps the stored value, `''` clears it.
  - A no-op retry succeeds without writing. The audit records field names only.
  - Grants: `service_role` only.
- **Depends on:** baseline (`_require_actor`, `_lock_handover_for_update`, `_is_*_as`, `_audit`).
- **Needed by:** `lib/actions/handovers.ts#updateHandoverDetails` → `lib/db/mutations.ts#updateHandoverDetails`
  (wizard details autosave).
- **Rollback:** `drop function public.update_handover_details(uuid, uuid, timestamptz, text, text, text, text);`
  Roll back the wizard autosave first.
- **Verify:**
  ```sql
  select to_regprocedure('public.update_handover_details(uuid,uuid,timestamptz,text,text,text,text)') is not null
     and has_function_privilege('service_role', 'public.update_handover_details(uuid,uuid,timestamptz,text,text,text,text)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.update_handover_details(uuid,uuid,timestamptz,text,text,text,text)', 'EXECUTE');
  ```

### #2 `20261113100200_create_handover_dedupe.sql` (Agent 2, C2)
- **Changes:** replaces `create_handover`. An identical resubmission by the same actor within 2 minutes
  returns the first draft's id, provided that draft is untouched: still draft, never updated, no sources, no
  other members, no tokens. A per-actor advisory transaction lock serialises concurrent submits.
- **Depends on:** baseline.
- **Needed by:** nothing new. `createHandover` simply stops producing double drafts.
- **Rollback:** re-run the `create function public.create_handover …` block from
  `20261111000400_lifecycle.sql` (line 422) as `create or replace`.
- **Verify:**
  ```sql
  select pg_get_functiondef('public.create_handover(uuid,text,text,text,text,text)'::regprocedure) like '%baton.create_handover:%';
  ```

### #3 `20261113100300_create_source_upload_retry.sql` (Agent 2, C5)
- **Changes:** replaces `create_source`. For the same actor's live `pending_upload` row with the same sha256:
  - **reuse** it when no Storage object exists at its path (same id, fresh ticket, no extra slot);
  - **replace** it when an unconfirmed object occupies the path. The old row becomes `removed` and keeps
    its raw path for the sweep; a new row is created.

  Every other duplicate is still `BTCF0`. A per-(handover, sha256) advisory lock serialises retries. The
  function reads `storage.objects`, as `confirm_source_uploaded` already does.
- **Depends on:** baseline (storage bucket and `storage.objects`).
- **Needed by:** nothing new. `createSourceUpload` → `lib/db/storage.ts` keeps its ticket contract, and the
  upload retry UX relies on it.
- **Rollback:** re-run the `create_source` block from `20261111000600_sources_members_tokens.sql` (line 23) as
  `create or replace`. Rows created while #3 was live are ordinary rows.
- **Verify:**
  ```sql
  select pg_get_functiondef('public.create_source(uuid,uuid,text,text,text,bigint,text,text)'::regprocedure) like '%baton.create_source:%';
  ```

### #4 `20261113100400_handover_summary_description.sql` (Agent 2)
- **Changes:** replaces `api_list_my_handovers()` and `api_get_handover(uuid)`. Each handover object gains a
  `description` key; nothing else changes. Both stay SECURITY INVOKER and keep their grants (`authenticated`).
- **Depends on:** baseline.
- **Needed by:** `HandoverSummary.description` (`lib/contracts/dto.ts`, `lib/db/mappers.ts`), used to prefill
  the wizard's description. The mapper tolerates the key being absent.
- **Rollback:** re-run both blocks from `20261111000900_read_api.sql` (lines 6 and 32) as `create or replace`.
  The app then shows `description = null`.
- **Verify:**
  ```sql
  select prosrc like '%''description'', h.description%' from pg_proc where oid = 'public.api_get_handover(uuid)'::regprocedure
  union all
  select prosrc like '%''description'', h.description%' from pg_proc where oid = 'public.api_list_my_handovers()'::regprocedure;
  ```

### #5 `20261113100500_qa_l2_actor_first.sql` (Agent 2, C7 = QA-L2)
- **Changes:** replaces `erase_participant` and `purge_handover`. Both now call `_require_actor` first.
  - `erase_participant` checks the creator before answering `alreadyApplied`.
  - The actor-less purge path is open only to a caller with no session subject and no client API role.
  - Bodies are otherwise unchanged. **No grant change: D27 stays fail-closed, and no API role executes
    either function.**
- **Depends on:** baseline.
- **Needed by:** nothing. No action calls them while D27 is open; this is hardening ahead of D27.
- **Rollback:** re-run the blocks from `20261111000700_privacy.sql` (line 550) and
  `20261111000800_account_purge.sql` (line 171) as `create or replace`.
- **Verify:**
  ```sql
  select bool_and(pg_get_functiondef(f::regprocedure) like '%_require_actor%')
         and bool_and(not has_function_privilege('service_role', f::regprocedure, 'EXECUTE'))
    from unnest(array['public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'public.purge_handover(uuid,uuid,uuid)']) f;
  ```

### #6 `20261113200100_upload_retention_support.sql` (Agent 3, D3)
- **Changes:** new read-only `list_orphan_upload_candidates(interval, interval, int) returns jsonb`. It is
  detection only and deletes nothing. Grants: `service_role` only.
- **Depends on:** baseline.
- **Needed by:** no app code yet. The retention sweep is a proposal (`docs/proposals/retention.md`).
- **Rollback:** `drop function public.list_orphan_upload_candidates(interval, interval, int);`
- **Verify:**
  ```sql
  select has_function_privilege('service_role', 'public.list_orphan_upload_candidates(interval,interval,integer)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.list_orphan_upload_candidates(interval,interval,integer)', 'EXECUTE');
  ```

### #7 `20261113200200_deleted_handover_raw_paths.sql` (Agent 3, R3-D5)
- **Changes:** new read-only `list_deleted_handover_raw_paths(uuid, uuid) returns jsonb`.
  - It lists the raw paths of a soft-deleted handover, for its creator or the actor who deleted it.
  - A live handover gets `BTPF0`.
  - Grants: `service_role` only.
- **Depends on:** baseline.
- **Needed by:** `lib/db/storage.ts#deleteHandoverRawObjects`, called by the `deleteHandover` action after
  the commit (best-effort; failures are swallowed).
- **Rollback:** `drop function public.list_deleted_handover_raw_paths(uuid, uuid);`. Discard then leaves raw
  objects for the sweep.
- **Verify:**
  ```sql
  select has_function_privilege('service_role', 'public.list_deleted_handover_raw_paths(uuid,uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.list_deleted_handover_raw_paths(uuid,uuid)', 'EXECUTE');
  ```

### #8 `20261113300100_pipeline_fencing.sql` (Agent 4, DB-12/DB-13)
- **Changes:** adds `_pipeline_claim`, the fenced writers (`pipeline_set_job_provenance`,
  `pipeline_persist_parsed_source`, `pipeline_mark_source_parse_failed`, `pipeline_record_quote_check`,
  `pipeline_record_support_verdict`, `pipeline_create_system_gap_question`, `pipeline_set_point_sort_keys`) and
  `pipeline_store_extract_chunk`. A stale claim raises `BTLL0`. Grants: `service_role` only.
- **Depends on:** baseline (the unfenced writers, `_require_active_run`, `_lock_handover_for_share`).
- **Needed by:** `lib/db/pipeline.ts`, the worker. **Apply before deploying the worker.**
- **Rollback:** roll back #10 first, then drop the new functions. A worker on this build cannot run without
  them.
- **Verify:**
  ```sql
  select count(*) = 9 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'pipeline\_%' or p.proname = '_pipeline_claim');
  ```

### #9 `20261113300200_job_yield_checkpoint.sql` (Agent 4, E4)
- **Changes:**
  - adds `processing_jobs.claim_progress_done int`, nullable, no default, so there is no table rewrite;
  - adds the trigger `processing_jobs_claim_progress` (`before update of attempt`);
  - replaces `complete_processing_job`, same signature, so a checkpointing `yield` no longer costs an attempt.
- **Depends on:** baseline.
- **Data note:** jobs claimed **before** the apply have `claim_progress_done = NULL`, which is treated as
  0. Such a job's first `yield` with any progress is therefore free. The upgrade test checks this on a job
  claimed mid-flight.
- **Needed by:** the `lib/pipeline` runner (yield semantics).
- **Rollback:**
  1. re-run `complete_processing_job` from `20261112000100_integration_worker_support.sql` (line 106);
  2. `drop trigger processing_jobs_claim_progress on public.processing_jobs; drop function public._remember_claim_progress();`;
  3. optionally `alter table public.processing_jobs drop column claim_progress_done;`.
- **Verify:**
  ```sql
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'processing_jobs'
                  and column_name = 'claim_progress_done')
     and exists (select 1 from pg_trigger where tgname = 'processing_jobs_claim_progress');
  ```

### #10 `20261113300300_extract_chunk_inferred_points.sql` (Agent 4)
- **Changes:** replaces `pipeline_store_extract_chunk`, same signature. A new point with no stored citation
  is kept when it carries an inference rationale.
- **Depends on:** **#8**.
- **Needed by:** `lib/db/pipeline.ts` (extract stage).
- **Rollback:** re-run the `pipeline_store_extract_chunk` block from #8 as `create or replace`.
- **Verify:**
  ```sql
  select pg_get_functiondef('public.pipeline_store_extract_chunk(uuid,integer,integer,integer,text,jsonb,jsonb)'::regprocedure)
         ilike '%inference%';
  ```

### #11 `20261113300400_start_processing_requires_jobs.sql` (Agent 4, QA-R3-01)
- **Changes:** replaces `start_processing`, same signature. An empty, null or non-array job list is
  `BTVF0`. This check runs after all the existing ones.
- **Depends on:** baseline.
- **Data note:** existing zero-job runs are closed as failed `no_jobs` by `lib/pipeline/finish.ts`.
- **Needed by:** nothing new. `planProcessingRun` always sends jobs.
- **Rollback:** re-run the `start_processing` block from `20261111000400_lifecycle.sql` (line 457) as
  `create or replace`.
- **Verify:**
  ```sql
  select pg_get_functiondef('public.start_processing(uuid,uuid,text,jsonb,jsonb)'::regprocedure) like '%jsonb_array_length%';
  ```
  This assumes the new check uses `jsonb_array_length`; adjust it to the final body if needed.

### #12 `20261113300500_revoke_unfenced_pipeline_writers.sql` (Agent 4, DB-12-LEGACY)
- **Changes:** revokes 8 unfenced writers from `public`, `anon`, `authenticated` and `service_role`:
  `insert_extracted_point`, `add_source_quote_evidence`, `record_quote_check`, `record_support_verdict`,
  `create_system_gap_question`, `set_point_sort_keys`, `persist_parsed_source`, `set_job_provenance`.
  `mark_source_parse_failed` stays granted because `lib/db/storage.ts` still calls it.
- **Depends on:** #8, the deployed worker build, and the fixture updates (see §2.2).
- **Needed by:** nothing calls it. It removes a bypass of the fencing.
- **Rollback:** `grant execute on function <the 8 signatures> to service_role;`
- **Verify:**
  ```sql
  select not has_function_privilege('service_role', 'public.persist_parsed_source(uuid,jsonb,text)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.mark_source_parse_failed(uuid,text)', 'EXECUTE');
  ```

### #13 `20261113300600_*` (Agent 4, announced)
Not yet written. Add its row, run the upgrade test with it, and record the result here.

## 4. Upgrade-path test

`supabase/tests/upgrade/run.sh` uses Docker only and never a hosted project. It runs these steps:
1. Applies the shim and the **baseline** migrations (`< 20261113`).
2. Runs `seed.sql`, which goes through the existing functions and helpers. It creates:
   - a draft with two unfinished uploads (one with an object present);
   - a processing run whose extract job is claimed mid-flight (with a progress heartbeat);
   - an in-review handover after a finished run, with points and verified/unchecked evidence;
   - a published handover with an incoming member;
   - a discarded draft whose upload is still in Storage.

   It then snapshots, for 4 users × 5 handovers, `api_list_my_handovers`, `api_get_handover`,
   `api_list_sources`, `api_get_processing_status`, `api_list_points` and `api_get_published_handover`,
   read through RLS as `authenticated`.
3. Applies each Round 3 migration **one at a time**. After each one it re-reads everything and diffs it
   against the snapshot; only #4's added `description` key is ignored.
4. Runs `verify.sql`. It checks grants and signatures, then exercises the new behaviour on the pre-upgrade
   rows:
   - edit the old draft;
   - reuse and replace of the old pending uploads;
   - orphan candidates and raw paths of the old discarded draft;
   - yield and re-claim of the job that was claimed before the upgrade, and the fence refusing a stale
     attempt;
   - empty job list refused;
   - the old publication still readable.

Run it with:
```bash
bash supabase/tests/upgrade/run.sh                                  # PG 17
BATON_PG_IMAGE=postgres:15-alpine bash supabase/tests/upgrade/run.sh  # PG 15
# migrations not yet on the branch (e.g. #12 from Agent 4's branch):
mkdir -p /tmp/r3x && git show origin/feature/r3-ai-pipeline:supabase/migrations/20261113300500_revoke_unfenced_pipeline_writers.sql \
  > /tmp/r3x/20261113300500_revoke_unfenced_pipeline_writers.sql
BATON_UPGRADE_EXTRA_DIR=/tmp/r3x bash supabase/tests/upgrade/run.sh
```

**Result (2026-11-13, #1–#12, #12 taken from `76b4cd7`):** PG 17.x and PG 15.19 both passed. Every
migration applied cleanly on the populated database, every pre-upgrade read was unchanged after each step,
and `verify.sql` passed. I also checked the diff detector by tampering with one title, which flagged the
affected reads.

**No migration failed on populated data.** The only operational constraint found is #12 (§2.2).
