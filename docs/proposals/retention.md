# Proposal: orphan-upload and raw-source retention (Round 3, D3)

Status: **proposal for the lead and product** (D12/D14/D27 decisions). Author: Agent 3 (ingestion,
storage, privacy). Nothing here has been run against the hosted project; nothing was deleted.

## 1. The observation

Hosted dev holds 4 `sources` rows in state `pending_upload`, belonging to 2 soft-deleted drafts, with
0 raw objects in `source-uploads`. This analysis is from code and migrations only (baseline `24320e1`
plus `integration/round3`).

## 2. How a `pending_upload` row is born and normally dies

1. `createSourceUpload` (lib/db/storage.ts) calls `create_source`: the row is inserted as
   `pending_upload` **with `raw_storage_path` already set** to `raw/{handover}/{source}`, before any
   byte exists. Then a signed upload URL (assumed 2 h) is created with the user's storage client.
2. The browser uploads directly to Storage (`uploadToSignedUrl`), allowed by
   `can_upload_source_object` only while the row is `pending_upload`, not deleted, its handover not
   deleted, and the uploader is the signing user.
3. `confirmSourceUpload` downloads, measures and calls `confirm_source_uploaded` → `uploaded`.
4. The only ways out of `pending_upload` are that confirm, or `remove_source` (→ `removed`).

Nothing server-side ever expires a `pending_upload` row.

## 3. How the 4 hosted rows arose (most likely first)

The wizard (`components/wizard/new-handover-wizard.tsx`) uploads each chosen file in parallel; two
files per draft fits "2 rows per draft". A row stays `pending_upload` when the flow stops between step 1
and step 3:

| # | Path | Leaves an object? |
|---|---|---|
| a | Tab closed, refresh, navigation or sleep while files are hashing/uploading/verifying | No (or a complete object if the upload finished and only confirm was lost) |
| b | Upload failed (network) and the compensating `removeSource` in the wizard failed too — likely, since the cause is usually the same network | No |
| c | Confirm failed (`validation_failed` mismatch) and the compensating `removeSource` failed | No: confirm already removed the object |
| d | Signing failed after the row was inserted. Before R3 the error went to the user with **no `sourceId`**, so nobody could remove the row | No |
| e | The resumed draft shows "This upload didn't finish. Remove it and add the file again", and the user discarded the draft instead | as (a) |

Then the draft was discarded: `delete_handover` only sets `handovers.deleted_at` (and cancels runs,
revokes tokens). It does **not** touch sources. From that moment:

- `remove_source` / `source_upload_target` / `confirm_source_uploaded` all fail with "not found"
  (`_member_row` ignores deleted handovers), so no application path can ever clean the rows;
- `can_upload_source_object` refuses further uploads (`h.deleted_at is null`), so no object can appear;
- the 30-day purge (`purge_handover`) is granted to **no** application role until D27 is resolved
  (lib/db/recovery-gate.ts), so the rows and everything else of the draft stay indefinitely.

"0 raw objects" matches every path above: either nothing arrived, or the mismatch path removed it. The
rows are inert: they hold no content (title is the masked file name; size, checksum, MIME type), are
invisible to other users (RLS + deleted handover) and do not block anything live.

## 4. Can live drafts get orphans? (yes, before and partly after R3)

| Orphan on a LIVE draft | Before R3 | After R3 (this branch) | Remaining fix |
|---|---|---|---|
| Row created, signing failed, user got no `sourceId` | Yes | **Fixed**: storage.ts removes the row and marks its (empty) raw path deleted | — |
| Interrupted session (3a/3e) | Yes: row uses one of the 10 source slots and blocks re-uploading the same file (`(handover_id, sha256)` unique index → "already uploaded") | Same; the resumed wizard tells the user to remove it | Agent 2 (C2/C3): `create_source` reuses/replaces the actor's own stale `pending_upload` row for the same SHA-256; sweep §6 expires the rest |
| Confirm response lost (network) after a successful confirm; wizard then calls `removeSource` | A good upload was removed | Confirm is now idempotent (a repeat succeeds), so a retrying client is safe | Agent 1: retry `confirmSourceUploaded` on transient errors before removing |
| `removeSource` storage delete failed | Raw object stays, row `removed` with path set | Same (by design) | Sweep reason `removed_raw_pending` |
| Parse committed, raw delete failed | Raw object stays, row `parsed` with path set | Same (by design, D14) | Sweep reason `parsed_raw_pending` |
| Uploaded/failed source never processed | Raw kept forever (the 7-day ceiling of §12.6 is not implemented) | Same | Sweep reason `raw_ceiling` |
| Draft discarded with uploaded/failed sources | **Raw objects kept forever** (purge is D27-gated) | Same | Delete raw objects on discard (§7 request 1) + sweep reason `handover_deleted` |

The last row is the significant one: a discarded draft's uploaded chats (raw, unmasked) stay in the
bucket with no expiry. It is not visible to users (no client can read the bucket), but it contradicts
§12.6 ("Deleted immediately when the user removes the source", "hard ceiling: 7 days").

## 5. Detection (added, local only)

Migration `20261113200100_upload_retention_support.sql` adds
`list_orphan_upload_candidates(p_grace ≥ 2 h default 24 h, p_raw_ceiling ≥ 1 day default 7 days, p_limit
≤ 1000)`: service role only, `stable`, read-only (verified by `supabase/tests/sql/97_upload_retention.sql`:
no row changes, no audit rows, browser roles get `42501`). One entry per source with a raw path, with
`reason`, `state`, `rawObjectPresent` (checks `storage.objects`) and timestamps:

| reason | meaning |
|---|---|
| `handover_deleted` | draft discarded; any state (the hosted case) |
| `removed_raw_pending` | source removed, storage delete failed |
| `parsed_raw_pending` | parsed > grace ago, raw delete failed |
| `pending_upload_expired` | `pending_upload` older than grace; the signed URL is dead |
| `raw_ceiling` | `uploaded`/`failed` older than the ceiling |

To check hosted without applying the migration, the lead can run this read-only query (service role or
SQL editor; it reads only, and prints no content):

```sql
select s.state, (h.deleted_at is not null) as handover_deleted, count(*) as sources,
       count(o.id) as raw_objects, min(s.created_at) as oldest
  from public.sources s
  join public.handovers h on h.id = s.handover_id
  left join storage.objects o on o.bucket_id = 'source-uploads' and o.name = s.raw_storage_path
 where s.raw_storage_path is not null
 group by 1, 2 order by 1, 2;
```

## 6. Recommended policy

| Data | Recommendation | Why it is safe |
|---|---|---|
| `pending_upload` row older than **24 h** (min 2 h = signed-URL TTL) | Soft-remove it (`state = 'removed'`, `deleted_at`, audit `source.upload_expired`), then delete any object at its path and mark the raw path deleted | No content has been accepted; the signed URL has expired so the upload can never complete; frees the slot and the checksum |
| Raw object of a **removed** source | Delete at any age (retry of the failed post-commit delete) | §12.6 already requires immediate deletion |
| Raw object of a **parsed** source | Delete after **24 h** (retry of the failed post-commit delete) | The permitted masked data is committed (D14); the raw file is no longer needed |
| Raw object of an **uploaded/failed** source | Delete **7 days** after upload (§12.6 ceiling); then mark the source `failed` with `error_code = 'raw_expired'` so the UI asks for a new upload | The user loses only the ability to retry without re-uploading, which §10.3 step 5 already states |
| Raw objects of a **discarded draft** | Delete **immediately on discard** (after the `delete_handover` commit, best-effort, like `removeSource`), and the sweep catches failures at any age | The user asked to throw the draft away; raw files are the most sensitive copy (unmasked) |
| Rows, messages, points of a discarded draft | **Do not touch.** They stay under the 30-day purge, which remains fail-closed until D27 is resolved | Hard-deleting database content is a purge; only `purge_handover` behind the recovery manifest may do it |

What the sweep must never do: call `purge_handover` or `erase_participant`; hard-delete any database
row; delete anything outside `raw/{handover}/{source}` (lib/db/storage.ts `isOwnedRawPath` enforces the
shape and that the path belongs to that source); delete the raw object of a source that is `parsing`
or whose handover is `processing`.

### D27 (fail-closed) is respected

- Raw-object deletion is not an erasure or a purge: it is the same operation the product already does
  after every parse (D14) and on every `removeSource`, audited as `source.raw_deleted`. Raw objects are
  not in the database backups the recovery manifest protects, and they never hold anything the
  database does not already hold in masked form (or, for unparsed sources, anything the product has
  accepted).
- The sweep only soft-removes expired `pending_upload` rows (the `removeSource` semantics) and marks
  raw paths deleted. No database content is hard-deleted, so no manifest entry is needed and the purge
  gate stays closed.
- After a database restore, restored `raw_storage_path` values point at objects that are already gone;
  the sweep re-runs idempotently (Storage reports success for a missing path; `mark_source_raw_deleted`
  is idempotent).

## 7. Sweep design

`app/api/cron/retention/route.ts` (lead-owned; §12.6 already names it), `CRON_SECRET`, service role,
hourly. Per run, with a time budget and `limit` 100 per page:

1. `list_orphan_upload_candidates()`.
2. For each candidate: call a new **claim** function in SQL, `claim_raw_for_retention(source_id,
   reason)`, that re-checks the reason under `FOR UPDATE` of the source (and `FOR SHARE` of the handover:
   not `processing`, source not `parsing`), applies the row change for the reason (`pending_upload` →
   `removed`; `uploaded`/`failed` past ceiling → `failed`/`raw_expired`), and returns the path. It closes
   the race where a user starts processing between the listing and the delete.
3. `deleteRawSource` (storage remove, then `mark_source_raw_deleted`). Failure: leave the path set; the
   next run retries.
4. Log counts per reason only (no paths, names or content); alert if `removed_raw_pending` or
   `parsed_raw_pending` keep growing (Storage failing).
5. Dry-run mode (`?dryRun=1`) returns the counts from step 1 only; first production enablement should run
   dry for a week.

## 8. Requests (cross-owner)

1. **Agent 2 / lead** — discard deletes raw uploads: after `delete_handover` commits, the
   `deleteHandover` action should delete the draft's raw objects best-effort. Needs a service-role SQL
   function returning `(source_id, raw_storage_path)` for a just-deleted handover's sources with a raw
   path (callable for a deleted handover by its creator, or by service role with the handover id), then
   `deleteRawSource` per row (lib/db/storage.ts, unchanged API). Reason: §4 last row.
   **Status (R3-D5):** the database and storage half is done: migration `20261113200200`
   (`list_deleted_handover_raw_paths`, service role, soft-deleted handovers only, creator or deleting
   actor only) and `deleteHandoverRawObjects(db, adminStorage, actor, handoverId)` →
   `{ deleted, failed }` in lib/db/storage.ts. Agent 2 calls it from `deleteHandover` after commit.
2. **Lead** — the retention route (§7) and `CRON_SECRET` wiring; `claim_raw_for_retention` can be added
   by Agent 3 in the `2026111320*` range once the policy is approved.
3. **Agent 1** — in the wizard, retry `confirmSourceUploaded` on `internal`/network errors before calling
   `removeSource` (confirm is idempotent now), and surface a failed compensating `removeSource` instead of
   ignoring it.
4. **Product** — confirm the timings (24 h pending, 24 h parsed retry, 7-day ceiling, immediate on
   discard).
