# Round 3 migrations: hosted-apply readiness

Owner: Agent 2 (R3-C8). Status: **LOCAL ONLY. Nothing in this document has been applied to hosted Supabase.**
**Every migration below needs approval before it is applied to a hosted project.**

This document covers all 16 Round 3 migrations, from every worker. For each one it gives:
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

Every replacement keeps its signature, so `CREATE OR REPLACE` keeps the existing grants. Every new function is
`SECURITY DEFINER` with `set search_path = ''` and is granted to `service_role` only; browser roles get nothing.
Three read functions stay `SECURITY INVOKER`, so RLS still controls what they return: #4 (`api_list_my_handovers`,
`api_get_handover`) and #16 (`api_get_processing_status`). No migration changes or drops a table, column, policy
or row. The only schema addition is #11's nullable column.

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
6. **These are safe in either order relative to the app:**
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
- **Rollback:** first roll back #14 and #15 (re-grant), then #12, then drop the new functions. The current worker
  build cannot run without them.
- **Verify:**
  ```sql
  select count(*) = 9 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'pipeline\_%' or p.proname = '_pipeline_claim');
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
- **Rollback:**
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
   - the old publication is still readable.

```bash
bash supabase/tests/upgrade/run.sh                                     # PG 17
BATON_PG_IMAGE=postgres:15-alpine bash supabase/tests/upgrade/run.sh     # PG 15
BATON_UPGRADE_EXTRA_DIR=/path/with/extra/migrations bash supabase/tests/upgrade/run.sh   # not-yet-merged files
```

**Latest result (2026-11-13, all 16 migrations, integration at `b3f68ac`, which includes `0786b1f` and `357f0b5`):**
- PG 17 and PG 15.19 both passed.
- Every migration applied cleanly on the populated database.
- After each step, every pre-upgrade read was unchanged; the only changes were the intended ones (#4's key, #16 on
  mixed runs).
- `verify.sql` passed. Its old line asserting that `mark_source_parse_failed` stays granted (QA-R3-13) is
  replaced by the #15 revoke check.
- All 17 Verify queries in §3 and the §5 pre-check returned `true` on the upgraded database.
- I tampered with one title to confirm the diff detector catches a changed read.

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
-- no worker job is mid-flight (keeps the #11 data note and the #14/#15 switch trivial)
select status, count(*) from public.processing_jobs where status in ('queued', 'running') group by status;
-- the functions about to be replaced exist with the expected signatures
select count(*) = 13 from (values
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
| A | Apply #1–#13 (`20261113100100` … `20261113300400`), in file order, as one `supabase db push` | Additive changes or same-signature replacements; the current app tolerates all of them (§2.6) |
| B | Deploy the Round 3 app build: wizard autosave, the mapper with `partial`, and the worker that uses only `pipeline_*` and passes its claim | Needs #1 and #10–#12 (§2.2, §2.4) |
| C | Smoke-check: edit a draft's details, confirm an upload, and open an existing run's processing page | Confirms B against A (production has no AI provider, so no new run) |
| D | Apply #14–#16 (`20261113300500` … `20261113300700`) | The revokes need B's worker with the required claim (`parse.ts:73`, `b5d3480`; §2.3); #16 needs B's mapper (`mappers.ts:374`; §2.5) |

Do not apply #14–#16 before step B. Do not deploy B before step A.

**3. Post-apply verification:** run every **Verify** query in §3. All must return `true`. Then run the pre-check
again; the newest version should be `20261113300700`.

**4. Rollback triggers.** Roll back the specific migration (its §3 Rollback) if any of these happens:
- any Verify query returns `false`;
- the processing page returns `internal` (suspect #16 before the mapper deploy, so roll back #16);
- worker runs fail with `forbidden` / `42501` (suspect #14/#15 before the worker deploy, so re-grant);
- runs fail with `db_schema_outdated` (#10–#12 missing, so apply them or roll back the worker deploy);
- the wizard autosave returns `internal` (#1 missing).

Roll back in reverse file order and only as far as needed. The app-tolerant migrations (§2.6) do not need to be
rolled back to undo an app deploy. If several of these fail at once, restore from the backup or recovery marker
taken in step 0.
