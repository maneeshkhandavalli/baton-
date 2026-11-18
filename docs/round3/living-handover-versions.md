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

## Task 05C: scoped processing and the publication gate

Migration `supabase/migrations/20261117500200_scoped_version_processing.sql` (requires approval before any hosted
apply; requires 20261117500100).

**Scoped run:**
- `start_source_update_processing(actor, handover, pipeline, ai_config, jobs)` is server-only, for the creator or an
  outgoing member, in review only, after a succeeded run, with at least one pending update.
- **Scope:** derived under the handover lock by `_source_update_scope`, never taken from a request. It is the current
  versions whose update is `awaiting_processing` or `failed`, plus current sources never extracted.
- **Required job set:** exactly, per scoped source, `parse` (only when not parsed), `extract` and `verify_quotes`,
  plus `verify_support`, `analyze` and `prepare_review` once each. Jobs for another source or the superseded version
  are a conflict; a missing handover-wide stage is invalid.
- **`source_ids`:** all current included sources. This lets `analyze` compare against every current source;
  `verify_support` already covers every unverified link of the handover.
- **Starting it:**
  - `source_update_processing_scope` tells the server `scoped` or `full`.
  - `startProcessing` plans with `scopeSourceIds` and calls the scoped function.
  - An older database, a draft, or nothing pending gets the unchanged full `start_processing`.
- The existing worker claims, leases, fences and retries these jobs like any others. A second request while a run is
  active is refused.

**Update lifecycle** (`source_version_changes.state`), recorded by triggers on every path:

| from | to | when |
|---|---|---|
| `awaiting_processing` or `failed` | `processing` | an extract job for the new version is created (a retry reuses the same record) |
| `processing` | `awaiting_detection` | the run succeeded **and** the new version was fully extracted. This is not "ready": comparing it with the handover is 05D |
| `processing` | `failed` | otherwise. `error_code` is one of `extraction_partial`, `extraction_failed`, `run_failed`, `run_cancelled` |
| `awaiting_processing`, `failed` or `awaiting_detection` | `superseded` | a newer version became current |

**Publication gate** (`_assert_source_updates_settled`):
- It is attached to the same two trigger points as Task 04: a new publication row, and in_review → approved. It
  therefore covers the 3- and 4-argument `publish_handover` and any direct write.
- These states of a current version's update **block** publication (`source_update_pending`), and no acknowledgement
  lifts them:
  - `awaiting_processing`, `processing`, `awaiting_detection`;
  - `failed` with `run_failed` or `run_cancelled` (the extraction was complete but the handover-wide checks were not:
    process it again).
- A `failed` update with an extraction gap (`extraction_partial` or `extraction_failed`) uses Task 04's explicit
  acknowledgement, unchanged. The update **stays `failed`**, and the publication writes
  `publication.source_updates_unverified` to the audit log.
- 05D adds open review items to the same assertion.
- A refused publication rolls back everything, including any acknowledgement written in the same call.
- Incoming members keep reading the last publication throughout.

**Task 04 scope, same signatures.** A scoped run extracts only some sources, so `_extraction_publish_gaps` and
`api_get_extraction_report` judge each source of the latest run and each current source by **its own** latest
extraction:
- For a full run this is exactly the previous result.
- It is never weaker: an older, unacknowledged gap of a source the scoped run did not touch stays a gap.
- The report lists `sourceUpdates`, each with `blocksPublication`.

**Application:**
- The publish action refuses early with `source_update_pending` and plain instructions.
- The publish dialog explains the block and disables Publish.
- The processing page lists source updates and offers "Process the new version" after an earlier successful run.
- Settings → Sources shows each update's state.

**Superseded by 05D.** A successfully processed update now becomes `ready` once change detection is recorded (see
below); an update left in `awaiting_detection` by 05C is processed again by the next scoped run.

## Task 05D: deterministic change detection

Migration `20261118500100_change_detection.sql` (additive). Detector `lib/signals/change-detection.ts` (pure),
orchestrated by `lib/pipeline/change-detection.ts` inside the `analyze` job of the run that processes the update.

**Baseline.** `source_version_changes.base_publication_id` is the handover's current publication when the version
became current (BEFORE INSERT trigger; existing rows backfilled with the latest publication not newer than the change).
NULL means the handover was never published: newly extracted points stay in the ordinary initial review.

**What is compared.** The retained evidence of every EARLIER version of the lineage (not only the immediate
predecessor: a version that failed to parse has no evidence, and the points still cite the one before it), linked to
live, non-rejected points with a verified quote (`exact` / `normalized`), against the new version's stored (masked,
pseudonymised) messages.

**Matching.** `checkQuote` (the app's quote verifier: format characters, NFC, curly quotes, dashes, whitespace and line
breaks normalised; case preserved), at every occurrence, accepted only when bounded by non-word characters and meeting
the 12-character / 3-word minimum. Placeholders compare by type only in a separate relaxed tier, which is never a
match: `[PERSON_1]` → `[PERSON_2]` is reported as `placeholder_changed`, never mapped. Same place: chat = same author
placeholder and timestamp; document = same section heading (line shifts are ignored).

| outcome | item |
|---|---|
| strict match at the same place | none (a new message id is not a change) |
| no match at the same place, exactly one elsewhere | `evidence_moved` with the new message and offsets |
| several matches elsewhere (or twice in one message) | `evidence_moved`, `detail.match = ambiguous`, no message chosen |
| relaxed (placeholder) match only | `evidence_missing`, `detail.match = placeholder_changed` |
| nothing | `evidence_missing`, `detail.match = not_found` |

Missing evidence is never deleted, unlinked or used to change a point; the old evidence stays attached to its version.

**New content.** Chats: messages after the previous versions' latest `last_message_at` (kept through pruning) are new;
messages exactly at it are treated as possibly new (exports are minute-precise) unless retained evidence is found
there; earlier ones are re-exported old content. Documents: every block without retained evidence is only "previously
uncited". Edits or deletions of old, uncited content cannot be detected, because that content was deliberately pruned;
nothing claims otherwise.

**Other items.** `possible_contradiction`: Task 03 retrieval with new content as the only candidates (top 3 per point),
linked to the Task 03 review flag for the same point and message when one exists. `support_changed`: only when the
independent support check judged the SAME matched passage with the opposite polarity (supports/partial ↔ contradicts /
irrelevant). `new_information`: a pending extracted point whose only evidence is the new version (dedup already merged
equivalents into existing points); only when there is a baseline publication.

**Lifecycle.** One fenced, atomic `pipeline_record_change_detection` per update (analyze claim with exact generation;
the update must still be `processing` in this run and its version current; all items validated; `ON CONFLICT DO
NOTHING` on `(change_id, dedupe_key)`; audited `source_update.changes_detected`). When the run closes: `ready` only if
extraction was complete, the run succeeded and this run recorded detection; otherwise `failed` with
`extraction_partial`, `extraction_failed`, `run_failed`, `run_cancelled` or `detection_incomplete`. A pre-05D
`awaiting_detection` update is retried by the next scoped run. A newer version → `superseded`, and its open /
investigating items → `stale` (`superseded`); removing the source → `stale` (`source_removed`); both audited.

**Gate.** Open or investigating items of a current version's update block publication on every path (BTPF0
`change_review_open`); accepted, rejected and stale items do not. Task 04's acknowledgement never lifts them. Readiness
gains `source_updates_pending` and `change_reviews_open`, so the dashboard and review panel never say "ready" around
the gate.

**Consent wording.** `getConsentDisclosure()` (lib/ai/config.ts) describes the actual configuration: the local fake
adapter is "no AI provider", Gemini is named only when configured (free tier vs. the approved paid profile), an
evaluation provider by its public name. Each wording has its own statement version.

## Task 05E: reviewer decisions

Migration `20261118600100_change_review_decisions.sql` (additive). Page `/handover/[id]/changes`
(`components/review/change-reviews.tsx`), action `decideChangeReview` (`lib/actions/core/change-reviews.ts`).

`decide_change_review_item` is the only way to decide an item (service role, the server's verified actor). Under the
handover lock and an item row lock it checks: a review role who can see the point(s), both versions and the evidence
(otherwise "not found"); the handover is in review; the item is not stale and its update and source version are still
current; the expected state; the handover's current publication is still the item's baseline; the point is still at
the revision the reviewer saw. Then, in one transaction: the kind-specific effect, the item state (`decided_by`,
`decided_at`), one row in the append-only `source_change_review_decisions` (with the note), a `change_review` review
action on the point and an audit event (never the note).

| kind | accept | reject |
|---|---|---|
| evidence_moved | links the quotation at the detected span of the current version (existing quote reused, else an exact slice); refused when ambiguous or the message is gone | nothing changes |
| evidence_missing | re-attestation: a note of at least 20 characters; no evidence is created or removed | nothing changes |
| possible_contradiction | the reviewer's wording through `edit_point` (new revision, back to pending) plus a supporting quotation chosen inside the new message (≥ 12 characters, 3 words) | nothing changes |
| support_changed | confirmation of the new assessment with a note; evidence and wording unchanged | nothing changes |
| new_information | `approve_point` on the candidate (its evidence-status rules apply) | `reject_point` on the candidate |

Investigate (all kinds) needs a note and keeps the item unresolved (`investigating` still blocks publication). Reject
needs a reason. Accepted and rejected are final; repeating a decision that already took effect returns `unchanged`
and writes nothing; any other state mismatch (another reviewer, a concurrent request) is a conflict. Stale items
cannot be decided; their history and notes are kept.

Accepting a moved quotation does not create a point revision: the wording did not change, and a new revision would
invalidate every support verdict (they are recorded per revision) and reopen the approved point. The relocated
quotation is carried into the next publication with the point.

Consent (05D hardening): `recordSourceConsent` accepts only the statement version the server shows for its actual AI
configuration; stale, forged or other-provider versions are refused before any write.

## Not in this stage

The following are deferred to later stages:

| stage | work |
|---|---|
| 05D | done (above): deterministic change detection, review items, gate |
| 05E | done (above): reviewer decisions |
| 05F | the before-and-after review interface |
| later | freshness UI and provider events |

05B does not mark anything as checked against a new version: the transition stays `awaiting_processing`.

## Risks and decisions

- **Publishing an unprocessed version:** closed in 05C. The database gate refuses it.
- **Re-uploading an earlier version's exact file** as a new version is refused as a duplicate, because that file is
  still a live, superseded source.
- **Versions need the handover in draft or review.** After publishing, the creator starts a revision first. Whether an
  update should start the revision automatically is still an open product decision (05C did not change it).
- **Conversation exclusions block versioning** (see Privacy).
