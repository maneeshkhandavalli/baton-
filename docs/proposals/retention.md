# Proposal: orphan-upload and raw-source retention (Round 3, D3)

Status: **proposal for the lead and product** (D12/D14/D27 decisions). Author: Agent 3 (ingestion,
storage, privacy). Nothing here has been run against the hosted project; nothing was deleted.

## Decision needed (product owner)

**Why it matters.** Raw uploads are the original, unmasked chats and documents. Today nothing expires
them: a draft that is never processed keeps them indefinitely, and before Round 3 so did a discarded
draft. Unfinished uploads (`pending_upload` rows) are never cleaned up either. No user can see these
files, but keeping them contradicts the retention we promise (§12.6: "7-day ceiling").

**Please approve or change these defaults.** The details, alternatives and consequences for each choice follow the table.

| # | Choice | Recommended default | Alternatives |
|---|---|---|---|
| 1 | How long an unfinished upload (`pending_upload`) may stay before it is cleared | **24 hours** | 2–6 hours; 7 days |
| 2 | Raw file of an uploaded-but-never-processed source | **Deleted 7 days after upload** (§12.6) | 3 days; 14–30 days |
| 3 | Raw file whose automatic delete after a successful parse (or a source removal) failed | **Retried after 24 hours**, then every hourly run | 1 hour; at the next run regardless of age |
| 4 | Raw files of a discarded draft | **Deleted immediately on discard** (built in R3-D5); the sweep retries failures | Keep until the 30-day purge |
| 5 | Database rows of a discarded draft (sources, masked messages, points) | **Unchanged** until the 30-day purge, which stays blocked on D27 | Hard-delete or blank the messages now (a purge in all but name) |
| 6 | How the sweep is first switched on | **One-week dry run** (counts only), then live with a per-run cap | Live immediately; leave it off |

Nothing in this section has been run. Every option refers to the sweep design in §7, which is not built.

### Choice 1 — unfinished uploads (`pending_upload` rows)

What exists: the row holds no accepted content, only the masked file name, size, checksum and MIME type,
and usually there is no object. The exception is an upload that finished but whose confirm was lost: it
leaves a complete, unconfirmed, **unmasked** object at the path (the detector reports
`rawObjectPresent`). After the signed URL expires (2 h) the row can never be completed. All it does is
occupy one of the 10 source slots and block that file's checksum. Agent 2's retry reuse removes the
checksum friction for the same user.

| Option | Privacy exposure | User impact | Ops / cost | Reversible? | D27 / purge | Monitoring |
|---|---|---|---|---|---|---|
| **24 h (recommended)** | A lost-confirm object lives for at most 24 h plus one sweep interval | None: an expired row already shows as "upload didn't finish, add the file again" | Negligible: a few rows a day | The row, yes (soft removal to `removed`). The object, no, but it was never accepted | No interaction: soft removal only, no hard delete | `pending_upload_expired` per run, and the share with `rawObjectPresent = true` (a rising share points to a client confirm bug) |
| 2–6 h | Shortest window | A very slow 25 MB upload over a bad connection, near the 2 h URL limit, could be cleared while the user is still waiting; they choose the file again | Same | Same | None | Same, plus a count of "confirm after expiry" errors |
| 7 days | Lost-confirm objects live for a week | Dead rows occupy slots for a week (10-source limit) | Same | Same | None | Same |

**If you choose nothing:** unfinished rows, and any lost-confirm unmasked objects, stay forever.

### Choice 2 — raw file of a source that was uploaded but never processed

This is the **largest exposure**: the full, unmasked chat or document. It is kept only so the creator
can preview and process it.

| Option | Privacy exposure | User impact | Ops / cost | Reversible? | D27 / purge | Monitoring |
|---|---|---|---|---|---|---|
| **7 days (recommended, §12.6)** | Unmasked raw kept for at most 7 days | A draft resumed after 7 days shows the source as failed (`raw_expired`) and the user uploads it again. Conversation exclusions (source-scoped) must be chosen again; participant and date-range exclusions (handover-wide) still apply | Small storage saving; one delete and one row update per source | **No**: the object is gone and the user must re-upload | Raw objects are not database content. Deleting one is the same operation as after every parse (D14), not a purge, so no manifest entry is needed. After a database restore, rows point at deleted objects; the sweep is idempotent and the source shows "upload again" | `raw_ceiling` deletions per day, and the age of the oldest raw object (alert if older than the ceiling plus one day, which means the sweep is not running) |
| 3 days | Less exposure | More re-uploads for drafts that sit over a long weekend | Same | No | Same | Same |
| 14–30 days | Two to four times the exposure; contradicts §12.6 and the consent wording | Fewer re-uploads | Same | No | Same | Same |

Recommended alongside: tell the user in the wizard ("uploads are kept for 7 days until you start
processing"). A reminder email before expiry would need Resend, an external dependency that is not built.

**If you choose nothing:** unmasked uploads of abandoned drafts stay indefinitely, contradicting §12.6
and the consent statement.

### Choice 3 — retrying a raw delete that failed after a parse or a source removal

By this point the masked data is committed (parsed) or the source is removed, so the raw object is a
redundant, unmasked copy. A failure here means Storage was unavailable or refused the delete.

| Option | Privacy exposure | User impact | Ops / cost | Reversible? | D27 / purge | Monitoring |
|---|---|---|---|---|---|---|
| **24 h, then hourly (recommended)** | The redundant copy lives about 24 h after a failure | None: the user never needs it again | Negligible | No, but the copy is redundant | None: the same operation as the post-parse delete (D14) | `parsed_raw_pending` and `removed_raw_pending` should stay near 0; alert when they grow (Storage outage or permission change) |
| 1 hour | Shorter | None | Same; needs a separate grace parameter for parsed rows in the detector (today one `p_grace` covers both parsed and pending rows) | No | None | Same |
| Next run, any age | Shortest | None. A very small race with the parse job's own delete; both deletes are idempotent | Same | No | None | Same |

**If you choose nothing:** every failed delete leaves an unmasked duplicate forever, because today
nothing retries it.

### Choice 4 — raw files of a discarded draft

Already built (R3-D5): `deleteHandover` deletes the raw objects right after `delete_handover` commits,
and a failed delete keeps its path for the sweep. The product has **no "undo discard"**.

| Option | Privacy exposure | User impact | Ops / cost | Reversible? | D27 / purge | Monitoring |
|---|---|---|---|---|---|---|
| **Immediate (recommended, built)** | Files are gone at discard; failures last at most one sweep interval once the sweep runs | An accidental discard can't be undone in the product anyway; any manual, support-assisted restore would also need the files uploaded again | One delete per source at discard | No | Not a purge: the database rows stay under the 30-day purge (choice 5) | The `failed` count from `deleteHandoverRawObjects` in the logs; `handover_deleted` candidates with `rawObjectPresent = true` should be 0 |
| Keep until the 30-day purge | Unmasked files of discarded drafts are kept for at least 30 days, and **indefinitely while D27 blocks the purge** | Would allow a manual restore later, but no restore feature exists | Storage held longer | Yes, until the purge | Ties raw deletion to the blocked purge, so nothing is ever deleted | The purge backlog (see choice 5) |

**If you choose nothing:** the built immediate deletion keeps running. Only its failures linger, because
the sweep that would retry them is not approved.

### Choice 5 — database rows of a discarded draft

This covers the masked messages, points, evidence and source rows of a discarded draft.

| Option | Privacy exposure | User impact | Ops / cost | Reversible? | D27 / purge | Monitoring |
|---|---|---|---|---|---|---|
| **Keep until the 30-day purge (recommended)** | Masked data stays while D27 is open: no raw files, and no unmasked PII under §12.1. Users can't see it (RLS, deleted handover) | None | Grows slowly with discarded drafts | Yes (soft-deleted) | **Respects D27**: the purge stays fail-closed until the recovery manifest exists | Purge backlog: a read-only count of soft-deleted handovers older than 30 days |
| Hard-delete or blank the message bodies now | Lower | None | A new destructive job | **No** | **Violates D27**: removing database content without the manifest is exactly what the gate forbids, and a backup restore would bring the data back with no record that it was removed | Would need its own audit |

**If you choose nothing:** same as the recommendation (the status quo).

### Choice 6 — switching the sweep on

| Option | Privacy exposure | User impact | Ops / cost | Reversible? | D27 / purge | Monitoring |
|---|---|---|---|---|---|---|
| **One-week dry run, then live with a per-run cap (e.g. 100) and an environment kill switch (recommended)** | One more week at today's exposure | None during the dry run | One hourly cron route; `CRON_SECRET` | The dry run is fully reversible; live deletions are not | The sweep never calls `purge_handover` or `erase_participant` and never hard-deletes rows | Per-reason counts per run, deletions and failures per run, and run duration. Alert when a run hits the cap, or when failures occur in 3 runs in a row |
| Live immediately | Shortest | A misconfigured grace period or clock could cause a surprise mass deletion that cannot be undone | Same | No | Same | Same |
| Leave it off | Choices 1–3 have no effect | None | None | n/a | n/a | The read-only detector can still report the backlog |

**If you choose nothing:** the sweep stays off and choices 1–3 have no effect.

**Already done without a decision:** detection (`list_orphan_upload_candidates`, read-only); raw cleanup
on discard (R3-D5); refusing to record a raw delete for a source that still needs it (QA-L1); early
refusal of wrong-type uploads; reuse of an interrupted upload's row on retry (Agent 2).

**Blocked until approved:** the scheduled sweep (`app/api/cron/retention`, `CRON_SECRET`, hourly) and its
SQL claim step `claim_raw_for_retention` (§7): nothing deletes expired `pending_upload` rows, raw files
past the 7-day ceiling, or raw files whose post-parse/remove delete failed. The 30-day purge stays blocked
on D27 regardless of this decision.

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
3. `deleteRawSource` (storage remove, then `mark_source_raw_deleted`). Since QA-L1 (migration
   `20261113200300`) that marker only accepts parsed or removed sources and sources of a soft-deleted
   handover, so for `raw_ceiling` the claim function must first move the source out of
   `uploaded`/`failed` (or record the deletion itself). Failure: leave the path set; the
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
