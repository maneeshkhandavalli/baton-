# Round 3 Task 05B: Living Handover, source versions

This is stage 1 of Living Handover. Branch `round3/task05-living-handover`, from `round3/integration` `5bd0086`. Local
only: nothing has been pushed, merged, deployed or applied to a hosted database.

One forward-only migration, which **requires approval before any hosted apply**:
`supabase/migrations/20261117500100_source_versions.sql`.

## Model

A source version is an ordinary `sources` row linked to the row it replaces. Every existing link keeps working
unchanged, because it is keyed by the source id: messages, evidence, jobs, `source_visible` RLS, retention, the identity
vault and the exclusion rules. No second source identity exists.

| column | meaning |
|---|---|
| `lineage_id` | the version-1 row of the chain (itself for version 1) |
| `version_number` | 1, 2, 3 …; `NULL` only for a **pending update** (uploaded but not active yet) |
| `supersedes_source_id` | the version this one replaces |
| `superseded_at`, `superseded_by_source_id` | set once, when the next version becomes current |

**Current version:**
- Defined as `version_number is not null and superseded_at is null and deleted_at is null`.
- There is exactly one per lineage (unique index), and only the current version is processed.

**Superseded versions:**
- They stay live rows, and their evidence and quotes remain attached and active.
- Published snapshots are never touched.

**Invariants, enforced for every role including the table owner:**
- The trigger `sources_version_guard` keeps the chain immutable, same-handover, and numbered `n → n+1`. It also stops a
  row from superseding itself or being superseded twice.
- The composite foreign keys keep every link within one handover.
- Unique indexes allow one current version and one pending update per lineage, and one successor per version.

## Lifecycle

1. **Start the upload:** `create_source_version(actor, previous_source_id, kind, file, mime, size, sha256, tz)`.
   - Who and when: the creator only, with the handover in draft or review.
   - Locking: it takes the handover share lock, then the lineage lock (the current row `FOR UPDATE`).
   - What it creates: a pending update (`pending_upload`, no version number) that copies the previous version's access
     level and title.
   - Returned outcomes:

     | outcome | meaning |
     |---|---|
     | `created` / `resumed` | a pending update was made or reused; an upload ticket is signed |
     | `awaiting_confirmation` / `awaiting_consent` | a retry of the same update; continue from that step |
     | `unchanged` | the same file as the current version; nothing is written |
     | `stale` | the base is no longer current; the response names the current version |
     | `update_in_progress` | a different update is already pending |
     | `exclusions_not_portable` | the source has conversation exclusions (see Privacy) |

   - Refusals raise as follows:

     | error | when |
     |---|---|
     | not_found | the source is unknown, removed or invisible |
     | forbidden | the caller is not the creator |
     | invalid_transition | the handover is in the wrong state, or the base is not a finished upload |
     | validation_failed | the checksum is malformed, or the kind differs from the previous version |
     | conflict | the file is already another live source |

2. **Upload and confirm** through the existing signed upload and `confirm_source_uploaded`, unchanged.
3. **Activate:** `record_source_consent` on a pending update activates it in one transaction. Every new version needs
   fresh consent. Activation:
   - re-checks that the previous version is still current (otherwise conflict);
   - refuses a visibility broader than the previous version's;
   - supersedes the previous version and numbers the new one;
   - writes one `source_version_changes` row (`awaiting_processing`), and marks the previous transition `superseded` if
     it was still waiting;
   - copies the previous version's source-scoped participant and date-range exclusions;
   - keeps the previous date order and document date unless new ones are given;
   - audits the change (`source.superseded`, `source.version_created`).

   Any failure rolls everything back, and the previous version stays current.

**Changed in place,** with the same signatures, grants and security mode:
- `start_processing` includes current versions only.
- `create_source`: the 10-source cap counts current versions only. A ceiling of 100 live rows still bounds history.
- `remove_source`:
  - on a pending update, it discards only that update;
  - on the current version, it removes the whole source (all versions, with the existing evidence exclusion);
  - an earlier version alone cannot be removed.
- `_source_json` adds a `version` object to source reads.

**Application:**
- `createSourceVersionUpload` (server action) returns `upload` with a ticket, `awaiting_confirmation`,
  `awaiting_consent` or `unchanged`, or an error with a `details.reason`: `stale`, `update_in_progress`,
  `exclusions_not_portable`, `duplicate_source` or `source_version_kind_changed`.
- `recordSourceConsent` on a pending update:
  - defaults to the previous version's access level;
  - refuses a broader level (`source_version_access_broadened`);
  - maps a stale base to `source_version_stale`.
- `startProcessing`, the processing page, the wizard and the dashboard draft state use current versions only.
- Settings → Sources:
  - shows one row per source, with its version and number of earlier versions;
  - has a **New version** dialog (file, access level, consent checklist) for the creator;
  - has a **Discard** control for a pending update.

## Privacy

- **Handover-wide exclusions** already apply to every new source. This includes every participant erasure.
- **The previous version's source-scoped participant and date-range exclusions** are copied to the new version.
- **Source-scoped conversation exclusions** (`c_N`, D32) are positional within one file, and the bounds of an excluded
  conversation are never stored. They cannot be carried over exactly, so a new version of such a source is refused (fail
  closed). The workaround is to add the new file as a separate source and choose its exclusions there.
- **Name-based identity confirmations** (`same_person` / `different_person`) are per source and are not copied. The
  parse of the new version asks for them again, as for any new source.
- **Nothing new is stored:** no message digests (decision 11), no copies of raw uploads. Retention is unchanged, and a
  pending update that is never finished expires like any unfinished upload.

## Not in this stage

The following are deferred to later stages:

| stage | work |
|---|---|
| 05C | scoped processing |
| 05D | change detection: `source_version_changes` states `detecting`, `ready`, `failed`, `detector_version`, `error_code` |
| 05E | the reviewer queue and decisions |
| later | freshness UI and provider events |

05B does not mark anything as checked against a new version: the transition stays `awaiting_processing`.

## Risks and decisions

- **Publishing an unprocessed version:** a handover in review can still be published after a new version is activated
  but before it is processed. Nothing claims that the publication was checked against it, and the transition record
  stays `awaiting_processing`. A freshness gate belongs to 05C/05D and needs a product decision.
- **Re-uploading an earlier version's exact file** as a new version is refused as a duplicate, because that file is
  still a live, superseded source.
- **Versions need the handover in draft or review.** After publishing, the creator starts a revision first. Whether an
  update should start the revision automatically is a product decision for 05C.
- **Conversation exclusions block versioning** (see Privacy).
