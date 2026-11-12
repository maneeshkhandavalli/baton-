# Round 3 migrations: hosted-apply readiness

Owner: Agent 2 (R3-C8). Status: **LOCAL ONLY. Nothing in this document has been applied to hosted Supabase.**
**Every migration below needs approval before it is applied to a hosted project.**

This document covers all 17 Round 3 migrations, from every worker. For each one it gives:
- where it sits in the global apply order;
- what kind of change it is;
- what it depends on;
- how to roll it back;
- a query that confirms it applied;
- which app code needs it.

§5 is the hosted-apply runbook. All of it was checked with `supabase/tests/upgrade/run.sh`. That test applies the baseline,
loads realistic data, then applies Round 3 on top. It passed on Docker PG 17 and PG 15.

## 1. Global apply order

Migrations apply in file-name order. The Supabase CLI and both local runners do the same.

| # | File | Owner | Kind |
|---|---|---|---|
| 1 | `20261113100100_update_handover_details.sql` | Agent 2 | additive: new function |
| 2 | `20261113100200_create_handover_dedupe.sql` | Agent 2 | replace, same signature (`create_handover`) |
| 3 | `20261113100300_create_source_upload_retry.sql` | Agent 2 | replace, same signature (`create_source`) |
| 4 | `20261113100400_handover_summary_description.sql` | Agent 2 | replace, same signature (`api_list_my_handovers`, `api_get_handover`); adds one JSON key |
| 5 | `20261113100500_qa_l2_actor_first.sql` | Agent 2 | replace, same signature (`erase_participant`, `purge_handover`); no grant change |
| 6 | `20261113200100_upload_retention_support.sql` | Agent 3 | additive: new read-only function |
| 7 | `20261113200200_deleted_handover_raw_paths.sql` | Agent 3 | additive: new read-only function |
| 8 | `20261113200300_mark_raw_deleted_guard.sql` | Agent 3 | replace, same signature (`mark_source_raw_deleted`); adds a guard |
| 9 | `20261113200400_source_upload_target_kind.sql` | Agent 3 | replace, same signature (`source_upload_target`); adds one JSON key |
| 10 | `20261113300100_pipeline_fencing.sql` | Agent 4 | additive: `_pipeline_claim`, the `pipeline_*` fenced writers, `pipeline_store_extract_chunk` |
| 11 | `20261113300200_job_yield_checkpoint.sql` | Agent 4 | additive column and trigger; replace, same signature (`complete_processing_job`) |
| 12 | `20261113300300_extract_chunk_inferred_points.sql` | Agent 4 | replace, same signature (`pipeline_store_extract_chunk`, created by #10) |
| 13 | `20261113300400_start_processing_requires_jobs.sql` | Agent 4 | replace, same signature (`start_processing`) |
| 14 | `20261113300500_revoke_unfenced_pipeline_writers.sql` | Agent 4 | **revoke**: 8 unfenced writers |
| 15 | `20261113300600_revoke_mark_source_parse_failed.sql` | Agent 4 | **revoke**: `mark_source_parse_failed` |
| 16 | `20261113300700_processing_status_partial.sql` | Agent 4 | replace, same signature (`api_get_processing_status`); **changes stage-status values** |
| 17 | `20261113300800_claim_generation.sql` | Agent 4 | additive column (backfilled); replace, same signature (`_remember_claim_progress`, `_pipeline_claim`, `heartbeat_processing_job`); 8 new `pipeline_*` overloads; **tightens the attempt-only fence and the heartbeat** |

Every replacement keeps its signature, so `CREATE OR REPLACE` keeps the existing grants. Every new API-callable
function is `SECURITY DEFINER` with `set search_path = ''` and is granted to `service_role` only; browser roles get
nothing. (#17's internal helper `_pipeline_use_generation` is executable by no API role at all; only the
`SECURITY DEFINER` overloads call it, as its owner.) Three read functions stay `SECURITY INVOKER`, so RLS still
controls what they return: #4 (`api_list_my_handovers`, `api_get_handover`) and #16 (`api_get_processing_status`).
No migration changes or drops a table, column or policy. There are two schema additions:
- #11 adds a nullable column, with no rewrite and no row writes.
- #17 adds `processing_jobs.claim_generation bigint not null default 0`. On PG 11+ that is a metadata-only change,
  but the same migration then backfills every `processing_jobs` row (`set claim_generation = attempt`). It is the
  only Round 3 migration that writes existing rows. With no job in flight (§5.1) it is a single short update.

## 2. Order constraints and how they couple to app deploys

Order matters only in the cases below. Everything else can go in any order.

1. **#12 must follow #10.** #12 replaces a function that #10 creates. File-name order already guarantees this.
2. **Apply #10–#12 before deploying the worker.** `lib/db/pipeline.ts` calls only the `pipeline_*` functions.
   Without them every run fails immediately with `precondition_failed` / `db_schema_outdated`, by design.
3. **Apply #14 and #15 after deploying that worker build (QA-R3-14).** That build must route parse-failure
   writes through `pipeline_mark_source_parse_failed` under the job's claim:
   - `lib/pipeline/stages/parse.ts:73` passes `claimOf(ctx)`;
   - Agent 3's `b5d3480` makes the claim **required** in `downloadVerifiedRawSourceWithMeta` and removes the
     unfenced call from `lib/db/storage.ts`;
   - Agent 4's `0d222b3` is part of the same change.

   An older build fails closed, with `42501` → `forbidden`, on every pipeline write that #14/#15 revoke. QA has
   already updated the fixtures that called the unfenced writers.
4. **Apply #1 before deploying the wizard autosave.** Without it, `updateHandoverDetails` returns `internal`
   because the RPC does not exist yet.
5. **Deploy the app before #16 (QA-R3-14).** #16 makes the per-stage status sent to the UI include `partial`.
   - The mapper accepts it: `lib/db/mappers.ts:374` uses `z.enum([...RUN_STATUSES, "partial"])`, and
     `lib/contracts/dto.ts` declares `RunStatus | "partial"`.
   - An app build without that mapper would reject the read, and the processing page would show `internal`
     for any run with a mixed stage.
   - **UI gap (Agent 1):** `components/processing/processing-view.tsx` has no `partial` styling. A partial
     stage renders with the neutral dashed icon. It works, but it is not distinguishable from queued.
   - #16 also changes a stage whose jobs are still open from `failed` to `queued`/`running`.
6. **Deploy the generation-aware worker (`0bb1b96` or later) before #17.** Checked in the code:
   - `claim_ready_processing_jobs` returns `setof processing_jobs`, so `claim_generation` appears in the claimed row
     as soon as the column exists, with no change to that function.
   - `lib/pipeline/stage-context.ts:30-36` (`claimOf`) reads `claimed.claim_generation`, accepting a number or a
     numeric string. It sets `generation` only for a safe integer > 0; otherwise the claim is `{ jobId, attempt }`.
   - `lib/db/pipeline.ts:76` (`fencedRpc`) adds `p_claim_generation` only when `claim.generation` is a number.
     PostgREST then resolves the 8 new overloads by argument name.

   What this means for each combination:
   - **That worker on a database without #17:** the claim has no generation, so it calls the attempt-only writers
     exactly as before. Deploying the worker first is safe.
   - **That worker on a database with #17:** every fenced write sends the generation and is checked exactly.
   - **An older worker (before `0bb1b96`) on a database with #17:** this combination is unsafe. It never sends a
     generation, and #17 accepts an attempt-only write only while `claim_generation = attempt`. After a job's first
     checkpointing `yield`, every later claim of that job is refused with `BTLL0` (`ClaimLostError`, so it records
     nothing). The worker drops the job and the lease expires. The next claim raises `attempt` and the generation
     together, so the gap never closes. The job is reaped as `failed` (`lease_expired`) once
     `attempt >= max_attempts`.
   - **The heartbeat change works with either build.** `runner.ts:184-185` already turns `'lost'` into
     `LeaseLostError`. It is a behaviour change, though: a stage that goes longer than the lease (300 s,
     `runner.ts:82`) between two heartbeats now loses its claim. Before #17, the late heartbeat renewed it.
   - **PostgREST must see the new overloads.** Supabase reloads its schema cache on DDL. If the cache is stale, the
     generation-aware worker gets `PGRST202`, which raises `PipelineSchemaError`, and every run fails with
     `db_schema_outdated`. Run `notify pgrst, 'reload schema';` after the apply if in doubt.
7. **These are safe in either order relative to the app:**
   - #4: the mapper treats a missing `description` as `null`.
   - #7: `deleteHandover` ignores a failed raw cleanup.
   - #9: `storage.ts` treats `kind` as optional.
   - #8: app code only marks a raw delete after a parse, a remove, or a discard.
   - #2, #3, #5, #6, #11, #13: these change behaviour only, or are not called by the app.

## 3. Per-migration details

### #1 `20261113100100_update_handover_details.sql` (Agent 2, C1)
- **Changes:** adds `update_handover_details(uuid, uuid, timestamptz, text, text, text default null,
  text default null) returns timestamptz`.
  - Only the creator or an outgoing member may call it, and only on a `draft`.
  - Optimistic concurrency on `updated_at`, compared to the millisecond; a stale value raises `BTCF0`.
  - For optional fields, NULL keeps the stored value and `''` clears it.
  - A retry that changes nothing succeeds without writing.
  - The audit entry records field names only.
  - Granted to `service_role` only.
- **Depends on:** the baseline only.
- **Needed by:** `lib/actions/handovers.ts#updateHandoverDetails` via `lib/db/mutations.ts` (wizard autosave).
- **Rollback:** roll back the wizard autosave first, then
  `drop function public.update_handover_details(uuid, uuid, timestamptz, text, text, text, text);`
- **Verify:**
  ```sql
  select to_regprocedure('public.update_handover_details(uuid,uuid,timestamptz,text,text,text,text)') is not null
     and has_function_privilege('service_role', 'public.update_handover_details(uuid,uuid,timestamptz,text,text,text,text)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.update_handover_details(uuid,uuid,timestamptz,text,text,text,text)', 'EXECUTE');
  ```

### #2 `20261113100200_create_handover_dedupe.sql` (Agent 2, C2)
- **Changes:** replaces `create_handover`.
  - An identical resubmission by the same actor within 2 minutes returns the first draft's id.
  - This applies only while that draft is untouched: no updates, no sources, no other members, no tokens.
  - A per-actor advisory lock makes concurrent submits wait for each other.
- **Depends on:** the baseline only.
- **Needed by:** nothing new.
- **Rollback:** re-run `create_handover` from `20261111000400_lifecycle.sql` (line 422) as `create or replace`.
- **Verify:**
  ```sql
  select pg_get_functiondef('public.create_handover(uuid,text,text,text,text,text)'::regprocedure) like '%baton.create_handover:%';
  ```

### #3 `20261113100300_create_source_upload_retry.sql` (Agent 2, C5)
- **Changes:** replaces `create_source`. It looks for the same actor's live `pending_upload` row with the same sha256:
  - **No Storage object at its path:** the row is reused. Same id, fresh ticket, no extra slot.
  - **An unconfirmed object occupies the path:** the row is replaced. The old row becomes `removed` and keeps its
    raw path, so the retention sweep can delete that object.
  - Any other duplicate still raises `BTCF0`.
  - A per-(handover, sha256) advisory lock makes concurrent retries wait for each other.
- **Depends on:** the baseline only.
- **Needed by:** nothing new. The ticket contract in `lib/db/storage.ts` is unchanged.
- **Rollback:** re-run `create_source` from `20261111000600_sources_members_tokens.sql` (line 23) as `create or replace`.
- **Verify:**
  ```sql
  select pg_get_functiondef('public.create_source(uuid,uuid,text,text,text,bigint,text,text)'::regprocedure) like '%baton.create_source:%';
  ```

### #4 `20261113100400_handover_summary_description.sql` (Agent 2)
- **Changes:** `api_list_my_handovers()` and `api_get_handover(uuid)` now include `description` for each handover.
  Both stay `SECURITY INVOKER` and keep their `authenticated` grant.
- **Depends on:** the baseline only.
- **Needed by:** `HandoverSummary.description` (`lib/contracts/dto.ts`, `lib/db/mappers.ts`), which the wizard uses
  to prefill the description. The mapper tolerates the key being absent.
- **Rollback:** re-run both functions from `20261111000900_read_api.sql` (lines 6 and 32). Afterwards the app shows
  `description = null`.
- **Verify:**
  ```sql
  select prosrc like '%''description'', h.description%' from pg_proc where oid = 'public.api_get_handover(uuid)'::regprocedure
  union all
  select prosrc like '%''description'', h.description%' from pg_proc where oid = 'public.api_list_my_handovers()'::regprocedure;
  ```

### #5 `20261113100500_qa_l2_actor_first.sql` (Agent 2, C7 = QA-L2)
- **Changes:** replaces `erase_participant` and `purge_handover`.
  - Both call `_require_actor` before doing anything else.
  - `erase_participant` checks that the caller is the creator before it answers `alreadyApplied`.
  - The actor-less purge path is open only to a caller with no session subject and no client API role.
  - **No grant change. D27 stays fail-closed: no API role can execute either function.**
- **Depends on:** the baseline only.
- **Needed by:** nothing. This is hardening ahead of D27.
- **Rollback:** re-run the old definitions from `20261111000700_privacy.sql` (line 550) and
  `20261111000800_account_purge.sql` (line 171).
- **Verify:**
  ```sql
  select bool_and(pg_get_functiondef(f::regprocedure) like '%_require_actor%')
         and bool_and(not has_function_privilege('service_role', f::regprocedure, 'EXECUTE'))
    from unnest(array['public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'public.purge_handover(uuid,uuid,uuid)']) f;
  ```

### #6 `20261113200100_upload_retention_support.sql` (Agent 3, D3)
- **Changes:** adds `list_orphan_upload_candidates(interval, interval, int)`. It only reports candidates and
  deletes nothing. Granted to `service_role` only.
- **Depends on:** the baseline only.
- **Needed by:** no app code yet. The retention sweep is still a proposal.
- **Rollback:** `drop function public.list_orphan_upload_candidates(interval, interval, int);`
- **Verify:**
  ```sql
  select has_function_privilege('service_role', 'public.list_orphan_upload_candidates(interval,interval,integer)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.list_orphan_upload_candidates(interval,interval,integer)', 'EXECUTE');
  ```

### #7 `20261113200200_deleted_handover_raw_paths.sql` (Agent 3, R3-D5)
- **Changes:** adds `list_deleted_handover_raw_paths(uuid, uuid)`.
  - It lists the raw upload paths of a soft-deleted handover.
  - Only the handover's creator, or the actor who deleted it, may call it.
  - A live handover raises `BTPF0`.
  - Granted to `service_role` only.
- **Depends on:** the baseline only.
- **Needed by:** `lib/db/storage.ts#deleteHandoverRawObjects`, called by the `deleteHandover` action on a
  best-effort basis.
- **Rollback:** `drop function public.list_deleted_handover_raw_paths(uuid, uuid);`. Discarded drafts then leave their
  raw objects for the sweep.
- **Verify:**
  ```sql
  select has_function_privilege('service_role', 'public.list_deleted_handover_raw_paths(uuid,uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.list_deleted_handover_raw_paths(uuid,uuid)', 'EXECUTE');
  ```

### #8 `20261113200300_mark_raw_deleted_guard.sql` (Agent 3, QA-L1)
- **Changes:** replaces `mark_source_raw_deleted`. A raw delete can now be recorded only in these cases:
  - the source is `parsed`;
  - the source is removed;
  - its handover is soft-deleted.

  In every other case it raises `BTIT0`. When the raw path is already NULL, the call still does nothing.
- **Depends on:** the baseline only. It works together with #3 (a replaced row is `removed`) and #7 (discard).
- **Needed by:** `lib/db/storage.ts`. Its current callers only mark after a parse, a remove (including the
  signing rollback), or a discard.
- **Rollback:** re-run `mark_source_raw_deleted` from `20261111000500_review_gaps_pipeline.sql` (line 787).
- **Verify:**
  ```sql
  select pg_get_functiondef('public.mark_source_raw_deleted(uuid)'::regprocedure) like '%raw upload is still needed%';
  ```

### #9 `20261113200400_source_upload_target_kind.sql` (Agent 3, request #4)
- **Changes:** replaces `source_upload_target`. Its result now also includes `kind`. The existing fields and checks
  are unchanged.
- **Depends on:** the baseline only.
- **Needed by:** `lib/db/storage.ts#confirmSourceUpload`, which uses it to refuse a wrong-type file. It treats `kind`
  as optional.
- **Rollback:** re-run `source_upload_target` from `20261111000600_sources_members_tokens.sql` (line 66). The
  wrong-type check is then skipped.
- **Verify:**
  ```sql
  select pg_get_functiondef('public.source_upload_target(uuid,uuid)'::regprocedure) like '%''kind'', v_s.kind%';
  ```

### #10 `20261113300100_pipeline_fencing.sql` (Agent 4, DB-12/DB-13)
- **Changes:** adds `_pipeline_claim`, 7 fenced writers, and `pipeline_store_extract_chunk`. A stale claim raises
  `BTLL0`. Granted to `service_role` only.
- **Depends on:** the baseline only.
- **Needed by:** `lib/db/pipeline.ts` (the worker). **Apply it before deploying the worker.**
- **Rollback:** first roll back #17, then #14 and #15 (re-grant), then #12, then drop the new functions. The current
  worker build cannot run without them.
- **Verify** (counts the attempt-only functions; #17's 8 generation overloads are excluded):
  ```sql
  select count(*) = 9 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'pipeline\_%' or p.proname = '_pipeline_claim')
     and p.proargnames[3] is distinct from 'p_claim_generation';
  ```

### #11 `20261113300200_job_yield_checkpoint.sql` (Agent 4, E4)
- **Changes:**
  - Adds the nullable column `processing_jobs.claim_progress_done` (no table rewrite).
  - Adds the trigger `processing_jobs_claim_progress`.
  - Replaces `complete_processing_job`, so a `yield` that saved progress no longer uses up an attempt.
- **Depends on:** the baseline only.
- **Data note:** jobs claimed before the apply have `claim_progress_done = NULL`, which is treated as 0. Their first
  `yield` with any progress is therefore free. The upgrade test covers a job that was mid-flight during the apply.
- **Needed by:** the `lib/pipeline` runner.
- **Rollback** (roll back #17 first: it replaces `_remember_claim_progress`):
  1. Re-run `complete_processing_job` from `20261112000100_integration_worker_support.sql` (line 106).
  2. Drop the trigger and `_remember_claim_progress()`.
  3. Optionally drop the column.
- **Verify:**
  ```sql
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'processing_jobs'
                  and column_name = 'claim_progress_done')
     and exists (select 1 from pg_trigger where tgname = 'processing_jobs_claim_progress');
  ```

### #12 `20261113300300_extract_chunk_inferred_points.sql` (Agent 4)
- **Changes:** replaces `pipeline_store_extract_chunk`. A new point with no stored citation is kept if it carries
  an inference rationale.
- **Depends on:** **#10**.
- **Needed by:** `lib/db/pipeline.ts` (extract).
- **Rollback:** re-run the #10 definition.
- **Verify:**
  ```sql
  select pg_get_functiondef('public.pipeline_store_extract_chunk(uuid,integer,integer,integer,text,jsonb,jsonb)'::regprocedure)
         ilike '%inference%';
  ```

### #13 `20261113300400_start_processing_requires_jobs.sql` (Agent 4, QA-R3-01)
- **Changes:** replaces `start_processing`. An empty, null or non-array job list now raises `BTVF0`. This check runs
  after all the existing ones.
- **Depends on:** the baseline only.
- **Data note:** existing runs with zero jobs are closed as failed (`no_jobs`) by `lib/pipeline/finish.ts`.
- **Needed by:** nothing new.
- **Rollback:** re-run `start_processing` from `20261111000400_lifecycle.sql` (line 457).
- **Verify:**
  ```sql
  select pg_get_functiondef('public.start_processing(uuid,uuid,text,jsonb,jsonb)'::regprocedure) like '%jsonb_array_length%';
  ```

### #14 `20261113300500_revoke_unfenced_pipeline_writers.sql` (Agent 4, DB-12-LEGACY)
- **Changes:** revokes 8 unfenced writers from `public`, `anon`, `authenticated` and `service_role`:
  - `insert_extracted_point`
  - `add_source_quote_evidence`
  - `record_quote_check`
  - `record_support_verdict`
  - `create_system_gap_question`
  - `set_point_sort_keys`
  - `persist_parsed_source`
  - `set_job_provenance`
- **Depends on:** #10 and the deployed worker build (§2.3). The QA fixtures are already updated.
- **Needed by:** nothing. It removes a way around the fencing.
- **Rollback:** `grant execute on function <the 8 signatures> to service_role;`
- **Verify:**
  ```sql
  select not has_function_privilege('service_role', 'public.persist_parsed_source(uuid,jsonb,text)', 'EXECUTE')
     and not has_function_privilege('service_role', 'public.insert_extracted_point(uuid,uuid,text,text,text,jsonb,text,text,jsonb,double precision)', 'EXECUTE');
  ```

### #15 `20261113300600_revoke_mark_source_parse_failed.sql` (Agent 4, DB-12-LEGACY part 2)
- **Changes:** revokes `mark_source_parse_failed(uuid, text)` from every API role. The fenced
  `pipeline_mark_source_parse_failed` still calls it as its owner.
- **Depends on:** #10 and #14, and the deployed build where the parse job passes its claim
  (`lib/pipeline/stages/parse.ts:73`). Since `b5d3480` the claim is required and `storage.ts` no longer calls the
  unfenced function at all; a pre-`b5d3480` build would fail closed with `forbidden` on an integrity mismatch.
- **Needed by:** nothing.
- **Rollback:** `grant execute on function public.mark_source_parse_failed(uuid, text) to service_role;`
- **Verify:**
  ```sql
  select not has_function_privilege('service_role', 'public.mark_source_parse_failed(uuid,text)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.pipeline_mark_source_parse_failed(uuid,integer,text)', 'EXECUTE');
  ```

### #16 `20261113300700_processing_status_partial.sql` (Agent 4, E4; lead-approved contract change)
- **Changes:** replaces `api_get_processing_status`. The signature, grants, `SECURITY INVOKER` and output shape are
  unchanged; **only the per-stage `status` values change**:
  - **New value `partial`:** all of a stage's jobs have finished, some succeeded and the rest failed or were
    skipped. It is also used when the run succeeded but every job in this stage failed or was skipped.
  - **Open jobs win:** a stage with any job still queued or running now reports `queued`/`running`, where it
    previously reported `failed`.
  - **Measured on pre-upgrade data:** a run with one succeeded and one failed extract changes from `failed` to
    `partial`. A stage with one failed and one queued job changes from `failed` to `queued`. Stages that are not
    mixed read exactly as before.
- **Depends on:** the baseline only.
- **Needed by / coupling:** `lib/db/mappers.ts` and `lib/contracts/dto.ts` must accept `partial` **before** this is
  applied (§2.5). The UI should render it (Agent 1 gap, §2.5).
- **Rollback:** re-run `api_get_processing_status` from `20261111000900_read_api.sql` (line 99).
- **Verify:**
  ```sql
  select prosrc like '%''partial''%' from pg_proc where oid = 'public.api_get_processing_status(uuid)'::regprocedure;
  ```

### #17 `20261113300800_claim_generation.sql` (Agent 4, DB-12 follow-up)
- **Changes:**
  - **New column** `processing_jobs.claim_generation bigint not null default 0`, backfilled with `attempt` on every
    existing row. `(job, attempt)` does not identify one claim: a checkpointing `yield` gives its attempt back,
    so the next claim reuses the number. The generation does identify one claim.
  - **`_remember_claim_progress()`** (the claim trigger from #11) now also sets
    `claim_generation = old.claim_generation + 1` on every claim. Nothing ever lowers it, so
    `claim_generation >= attempt` always holds.
  - **`_pipeline_claim(uuid, int, text[])`** keeps its signature. It reads the transaction-local setting
    `baton.claim_generation`:
    - when the setting is present, the generation must match exactly;
    - when it is absent, the call is accepted only while `claim_generation = attempt`, meaning no yield since the
      job was first claimed at that attempt.

    Either way, a mismatch raises `BTLL0`. All other checks are unchanged.
  - **8 new overloads** `pipeline_*(p_job_id, p_attempt, p_claim_generation bigint, …)`, one for each fenced
    writer: `set_job_provenance`, `persist_parsed_source`, `mark_source_parse_failed`, `record_quote_check`,
    `record_support_verdict`, `create_system_gap_question`, `set_point_sort_keys`, `store_extract_chunk`.
    - Each is `SECURITY DEFINER` and granted to `service_role` only.
    - Each sets the generation through `_pipeline_use_generation` (no API grant; refuses NULL or < 1 with
      `BTVF0`), calls the original writer, then clears the setting.
    - The attempt-only originals stay granted to `service_role`.
  - **`heartbeat_processing_job`** keeps its signature and grants. It now returns `'lost'` on a lease that has
    already expired, instead of renewing it.
- **Depends on:** #10 (`_pipeline_claim` and the fenced writers it overloads) and #11 (the claim trigger and
  `_remember_claim_progress`). File-name order guarantees both.
- **Data note:** after the backfill every row has `claim_generation = attempt`. A job that was mid-flight during the
  apply keeps writing through the attempt-only path. The upgrade test covers this, then yields and reclaims that job.
- **Needed by / coupling:** the worker from `0bb1b96` onwards (`lib/pipeline/stage-context.ts` `claimOf`,
  `lib/db/pipeline.ts` `fencedRpc`). It sends `p_claim_generation` only when the claimed row has one. **Deploy that
  worker before #17** (§2.6): an older worker is permanently refused on any job that has yielded once.
- **Rollback** (in this order; every step is `create or replace`, so grants are kept):
  1. Re-run `_pipeline_claim` from `20261113300100_pipeline_fencing.sql` (line 34).
  2. Re-run `_remember_claim_progress` from `20261113300200_job_yield_checkpoint.sql` (line 17).
  3. Re-run `heartbeat_processing_job` from `20261112000100_integration_worker_support.sql` (line 173).
  4. Drop the 8 overloads `pipeline_*(uuid, int, bigint, …)` and `_pipeline_use_generation(bigint)`.
  5. **Drop `processing_jobs.claim_generation`. This step is not optional while the generation-aware worker is
     deployed.** If the column stays, claimed rows still carry a generation, the worker calls the dropped
     overloads, and every run fails with `db_schema_outdated`. Once the column is gone, the same worker falls back
     to the attempt-only writers.
  6. `notify pgrst, 'reload schema';`
- **Verify:**
  ```sql
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'processing_jobs'
                  and column_name = 'claim_generation' and is_nullable = 'NO')
     and not exists (select 1 from public.processing_jobs where claim_generation < attempt)
     and (select count(*) = 8 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'pipeline\_%' and p.proargnames[3] = 'p_claim_generation'
             and p.prosecdef and has_function_privilege('service_role', p.oid, 'EXECUTE')
             and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE'))
     and not has_function_privilege('service_role', 'public._pipeline_use_generation(bigint)', 'EXECUTE')
     and pg_get_functiondef('public._pipeline_claim(uuid,integer,text[])'::regprocedure) like '%baton.claim_generation%'
     and pg_get_functiondef('public._remember_claim_progress()'::regprocedure) like '%claim_generation%'
     and pg_get_functiondef('public.heartbeat_processing_job(uuid,integer,integer,integer,integer)'::regprocedure)
         like '%lease_expires_at <= now()%'
     and has_function_privilege('service_role', 'public.heartbeat_processing_job(uuid,integer,integer,integer,integer)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.heartbeat_processing_job(uuid,integer,integer,integer,integer)', 'EXECUTE');
  ```

## 4. Upgrade-path test

`supabase/tests/upgrade/run.sh` runs in Docker only, never against a hosted project. It does four things:

1. **Baseline.** Applies the shim and the baseline migrations (all files before `20261113`).
2. **Seed.** `seed.sql` builds realistic data through the existing functions and helpers:
   - a draft with two unfinished uploads, one of them with its object already in Storage;
   - a run whose extract job was claimed mid-flight;
   - an in-review handover after a finished run, with points and evidence;
   - a published handover;
   - a discarded draft whose upload is still in Storage;
   - a run with mixed stage outcomes.

   It then snapshots every read through RLS: 4 users × 5 handovers × 6 read functions, plus each user's list.
   The mixed-outcome run is recorded separately, because #16 changes its reads on purpose.
3. **Apply and compare.** Applies each Round 3 migration **one at a time**. After each one it diffs every read
   against the snapshot, ignoring only the `description` key that #4 adds.
4. **Verify.** `verify.sql` checks every grant and signature, then exercises the new behaviour on rows that existed
   before the upgrade:
   - #1: editing the old draft;
   - #3: reuse and replace of the old unfinished uploads;
   - #6 and #7: orphan candidates and raw paths of the old discarded draft;
   - #8: refusal on a live uploaded source and on a live pending source, while marking the discarded draft and
     the replaced row still works;
   - #9: the `kind` field;
   - #10 and #11: yield and re-claim of the job claimed before the upgrade, and the fence on a stale attempt;
   - #13: an empty job list is refused;
   - #14 and #15: grants are revoked;
   - #16: the old mixed run now reports `partial`/`queued`, and a new mixed run reports `partial`;
   - #17, on the same pre-upgrade job:
     - every pre-upgrade job is backfilled with `claim_generation = attempt`;
     - the mid-flight claim keeps writing through the attempt-only writer;
     - after a yield and a re-claim the job reads `attempt 1 / generation 2`;
     - the stale generation 1 is refused with `BTLL0`;
     - the now-ambiguous attempt-only call is refused with `BTLL0`;
     - generation 2 writes, and the setting does not leak past the call;
     - a heartbeat renews a live lease and returns `'lost'` on an expired one, which stays expired;
     - all 8 overloads are granted to `service_role` and nothing else, the 7 attempt-only writers stay granted,
       and `_pipeline_use_generation` / `_pipeline_claim` have no API grant;
   - the old publication is still readable.

```bash
bash supabase/tests/upgrade/run.sh                                     # PG 17
BATON_PG_IMAGE=postgres:15-alpine bash supabase/tests/upgrade/run.sh     # PG 15
BATON_UPGRADE_EXTRA_DIR=/path/with/extra/migrations bash supabase/tests/upgrade/run.sh   # not-yet-merged files
```

**Latest result (2026-11-12, all 17 migrations, integration at `4bb8fef`, which includes Agent 4's `0bb1b96`):**
- PG 17 and PG 15.19 both passed.
- Every migration applied cleanly on the populated database, #17's backfill included.
- After each step, every pre-upgrade read was unchanged. #17 changes no read. The only changes were the intended
  ones (#4's key, #16 on mixed runs).
- `verify.sql` passed, including the #17 checks listed above.
- On the upgraded PG 15 database, all 17 §3 Verify blocks returned `true` (18 rows, because #4's block returns two),
  and so did the §5 pre-check function count.
- Tamper checks:
  - granting a #17 overload to `authenticated`, or setting one job's `claim_generation` below its `attempt`, turns
    #17's Verify query `false`;
  - the same grant makes `verify.sql` fail;
  - an earlier run tampered with one title to confirm the diff detector catches a changed read.
- The #10 Verify query now excludes the #17 overloads; without that change it would return `false` after #17.

**No migration failed on populated data.**

## 5. Hosted apply runbook (for the lead; nothing here has been run against hosted)

**0. Preconditions**
- Approval for every file in §1.
- A fresh backup or point-in-time-recovery marker of the hosted project.
- The upgrade test is green on PG 17 at the exact commit you are deploying.
- Pick a low-traffic window; #16 changes what the processing page shows.

**1. Pre-check (read-only, SQL editor as `postgres`)**
```sql
-- the project is exactly at the baseline
select version from supabase_migrations.schema_migrations order by version desc limit 3;
--   expected: newest 20261112000500; nothing starting 20261113
-- no worker job is mid-flight (keeps the #11/#17 data notes, #17's backfill and the #14/#15 switch trivial)
select status, count(*) from public.processing_jobs where status in ('queued', 'running') group by status;
-- the functions about to be replaced exist with the expected signatures
-- (#17 also replaces _pipeline_claim and _remember_claim_progress, which #10/#11 create in this same apply)
select count(*) = 14 from (values
  ('public.heartbeat_processing_job(uuid,integer,integer,integer,integer)'),
  ('public.create_handover(uuid,text,text,text,text,text)'), ('public.create_source(uuid,uuid,text,text,text,bigint,text,text)'),
  ('public.api_list_my_handovers()'), ('public.api_get_handover(uuid)'),
  ('public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)'), ('public.purge_handover(uuid,uuid,uuid)'),
  ('public.mark_source_raw_deleted(uuid)'), ('public.source_upload_target(uuid,uuid)'),
  ('public.complete_processing_job(uuid,integer,text,jsonb,text,text,timestamp with time zone,integer,integer)'),
  ('public.start_processing(uuid,uuid,text,jsonb,jsonb)'), ('public.api_get_processing_status(uuid)'),
  ('public.persist_parsed_source(uuid,jsonb,text)'), ('public.mark_source_parse_failed(uuid,text)')) f(sig)
 where to_regprocedure(sig) is not null;
```

**2. Apply in two phases, coupled to the app deploy**

| Step | Do | Why |
|---|---|---|
| A | Apply #1–#13 (`20261113100100` … `20261113300400`), in file order, as one `supabase db push` | Additive changes or same-signature replacements; the current app tolerates all of them (§2.7) |
| B | Deploy the Round 3 app build: wizard autosave, the mapper with `partial`, and the worker that uses only `pipeline_*`, passes its claim, and sends its claim generation when the row has one (`0bb1b96` or later) | Needs #1 and #10–#12 (§2.2, §2.4). Without #17 this worker falls back to the attempt-only writers (§2.6) |
| C | Smoke-check: edit a draft's details, confirm an upload, and open an existing run's processing page | Confirms B against A (production has no AI provider, so no new run) |
| D | Confirm that no job is `running` (re-run the pre-check's job query), then apply #14–#17 (`20261113300500` … `20261113300800`). Then run `notify pgrst, 'reload schema';` | The revokes need B's worker with the required claim (`parse.ts:73`, `b5d3480`; §2.3). #16 needs B's mapper (`mappers.ts:374`; §2.5). #17 needs B's generation-aware worker, and an older worker is refused on every job that has yielded (§2.6). PostgREST must see #17's overloads (§2.6) |

Do not apply #14–#17 before step B. Do not deploy B before step A. Never run a worker older than `0bb1b96` against a
database that has #17.

**3. Post-apply verification:** run every **Verify** query in §3. All must return `true`. Then run the pre-check
again; the newest version should be `20261113300800`.

**4. Rollback triggers.** Roll back the specific migration (its §3 Rollback) if any of these happens:
- any Verify query returns `false`;
- the processing page returns `internal` (suspect #16 before the mapper deploy, so roll back #16);
- worker runs fail with `forbidden` / `42501` (suspect #14/#15 before the worker deploy, so re-grant);
- runs fail with `db_schema_outdated`:
  - if #10–#12 are missing, apply them or roll back the worker deploy;
  - right after #17, PostgREST may not see the overloads yet, so run `notify pgrst, 'reload schema';`;
  - after a partial #17 rollback that kept `claim_generation`, finish #17's rollback through step 5;
- after #17, jobs that have yielded keep coming back as `lost` and end `failed` / `lease_expired` (`BTLL0` in the
  worker log):
  - this means a worker older than `0bb1b96` is running, so redeploy B or roll back #17 (through step 5);
- after #17, long stages lose their claim (heartbeat `'lost'`) where they did not before. A gap between heartbeats
  went past the 300 s lease. Roll back #17's heartbeat only (rollback step 3), or shorten that stage's heartbeat
  interval;
- the wizard autosave returns `internal` (#1 missing).

Roll back in reverse file order and only as far as needed. The app-tolerant migrations (§2.7) do not need to be
rolled back to undo an app deploy. If several of these fail at once, restore from the backup or recovery marker
taken in step 0.
