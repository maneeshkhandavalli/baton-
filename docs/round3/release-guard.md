# Round 3 Task 04: release reliability and the publish guard

Branch `round3/task04-release-guard`, from `origin/round3/integration` `4198c52`. Local only: nothing pushed, merged,
deployed or applied to a hosted database.

Two new forward-only migrations (both **require approval before any hosted apply**):

| # | file | purpose |
|---|---|---|
| 1 | `20261117400100_gap_answer_point_attributes.sql` | accepted Gap Interview answers never create invalid typed points |
| 2 | `20261117400200_publish_extraction_ack.sql` | the database enforces the partial/failed-source acknowledgement on every publication |

Both are additive: new functions, one new table, two triggers, one new overload each for `review_gap_answer` and
`publish_handover`. `review_gap_answer(uuid,uuid,text,text)` and `api_get_extraction_report(uuid)` are replaced in place
with the same signature, grants and security mode. No column, policy or previously applied migration is changed, and no
existing row is rewritten. The upgrade test applies all 27 Round 3 migrations to populated data with every
pre-upgrade read unchanged.

## 1. Gap Interview answers → valid points

**Flow traced:**
1. `submit_gap_answers` stores the answer.
2. `review_gap_answer` accepts it, adds testimony evidence, and (for a question without a point, QA-UI3-G1) creates a
   pending `gap_answer` point.
3. `api_get_point` → `mapPointDetail` → `parsePointAttributes` (strict per-category contract).
4. `loadReview` keeps only points whose `getPoint` succeeds.
5. `readiness_report` counts every pending point.

**Defect:** the point was created with `attributes = '{}'`. Exactly three categories reject that:
`owner.responsibility`, `contact.nameLabel` and `account_access.system` (verified against the contract schema; the other
seven accept `{}`). The point then:
- failed `getPoint` (`internal`);
- vanished from the review page;
- still counted as pending, which blocked publishing.

**Fix (at the source).** When accepting creates a point of one of those categories, the required attribute comes from
one of two real sources:
1. **The reviewer**, who reads the answer and types it. This is the new optional `pointDetail` input (≤ 200 chars,
   masked like any reviewer text, passed to the new 5-argument `review_gap_answer`). The Gaps page shows one small field
   next to *Accept* only in this case.
2. **The question actually asked**, when it is a checklist question that names its subject. These are exact-text
   matches (`_checklist_point_detail`, mirrored by `pointDetail` in `lib/pipeline/checklist.ts` and kept in step by a
   test):

   | checklist question | attribute |
   |---|---|
   | Who holds the bank or UPI account…? | system "Bank or UPI account" |
   | Where are shared logins (email, social media, drive) kept…? | system "Shared logins (email, social media, drive)" |
   | Who is responsible for the budget and reimbursements? | responsibility "Budget and reimbursements" |

   A contact's **name** is never derived from a question.

**Insufficient information.** When neither source is available, the database **refuses** to accept (BTVF0). The
answer stays `submitted` (preserved and still reviewable), the question stays `open` (the existing unresolved-gap
mechanism, so a required gap keeps blocking readiness), and nothing is written: no point, no orphan testimony. The
action returns `validation_failed` / `gap_answer_needs_details` with a plain instruction. The reviewer adds the detail
and accepts again, or rejects/waives exactly as before. Answers to questions that already have a point, categories
without a required attribute, and rejections behave exactly as before. The audit log records whether the attribute came
from the reviewer or the checklist question.

### Existing records created in the invalid form: repair proposal (not executed)

`gap_answer_points_missing_attributes()` (service-role, read-only, ids and flags only, never text) lists them:
`point_id, handover_id, category, review_state, handover_state, in_publication, derivable_from_question`.

Proposed procedure, per environment and only after review:
1. Run the diagnostic. On local data it should be empty. On hosted dev it may list points created since
   `20261115100100` was applied.
2. **Pending, unpublished, `derivable_from_question = true`:** add a new revision (append-only; revision 1 stays) with
   the attribute from the checklist question, author `system`, edit reason "required attribute from the question asked".
3. **Pending, not derivable** (custom questions, every contact): do not invent a value. Ask a reviewer to supply it.
   The existing edit path needs a readable point, so this is a one-off, reviewed script that calls `edit_point` with the
   reviewer's value and records them as the actor. Or reject the point with a note, after which the question can be
   asked again.
4. **Approved or in a publication:** leave as is. Published snapshots are never rewritten. If the incoming view cannot
   render such a point, fix it in a new revision and republish. That needs the creator's decision.

## 2. `verify.sql`: the overload assertion

**Before:**
- The check counted every `pipeline_*` function whose **third argument is named** `p_claim_generation` and expected 8.
- Task 02's `pipeline_list_handover_people(p_job_id, p_attempt, p_claim_generation)` also matched, so the result was 9.
- The failing assertion stopped the script, so every later check in `verify.sql` had not run since Task 02.
- It was also blind to an extra overload that names its arguments differently.

**After** (`upgrade.protected_overload_problems()`, defined at the top of the check):
- For the **8 protected fenced writers** of 300100/300300, the set of overloads must equal exactly the 16 expected
  signatures (each attempt-only original and its 300800 generation-checked twin).
- Signatures are compared by **name and argument types** and reported by name: `unexpected overload: …`, `missing overload: …`.
- The grant check is scoped to the same names.
- A new, broader check asserts that **no** `pipeline_*` function (Task 02/03 writers included) is executable by a
  browser role.
- The expected count was **not** simply changed to 9.

**Self-test** (`supabase/tests/upgrade/verify_selftest.sql`, run by `run.sh` after `verify.sql`):
- `pipeline_list_handover_people` exists with that third argument and is not reported.
- Two injected overloads of protected writers are reported. One of them has different argument names, which the old
  count would have missed.
- A dropped generation twin is reported as missing.
- Every change is rolled back.

The complete `verify.sql` now runs to the end and passes.

## 3. The database publish guard

**Paths traced:** the only publication function is `publish_handover`, which is creator-only, `in_review` only, and
recomputes readiness under `FOR UPDATE`. It inserts `handover_publications`, then `transition_handover(…,'approved')`
under the `baton.publishing` flag. `acknowledged → approved` is the incoming-member lifecycle, not a publication. API
roles have no direct `INSERT`/`UPDATE` on `handovers` or `handover_publications`. `in_review → processing` is allowed,
so coverage can change while a handover is in review.

**Gap source of truth:** `_extraction_publish_gaps(handover)` (internal). It takes the latest run, and for each of its
sources the extract job:

| extract job | state | acknowledgement |
|---|---|---|
| succeeded, all chunks | complete (also complete_with_skips) | no |
| succeeded, chunks missing; or failed/cancelled after ≥ 1 chunk | partial | **required** |
| failed/cancelled with no chunk (e.g. its parse failed) | failed | **required** |
| queued/running | in progress | publishing impossible anyway |
| no extract job | not_processed (as Task 03; never happens in a planned run) | no |

It depends only on `processing_jobs`, not the optional coverage tables. Each partial/failed state has a fingerprint:
`cov1:md5(run | job | status | chunks done | chunks total | attempt | reason)`.

**Audit record:** `publication_source_acknowledgements`:
- columns: `handover_id`, `source_id`, `run_id`, `extract_job_id`, `gap_state`, `chunks_done`, `chunks_total`,
  `coverage_fingerprint`, `acknowledged_by` (the verified actor), `acknowledged_at`;
- unique per (source, run, fingerprint);
- append-only for every application role (FK cascades/set-null excepted);
- RLS read under `source_visible`; no write grant for any API role;
- plus an `audit_logs` entry `publication.extraction_gaps_acknowledged` listing sources, runs and states.

There is no reason field: the product's acknowledgement is a confirmation checkbox. A reason can be added later as a
nullable column.

**Authorization boundary:**
- Acknowledgements are written **only** by `publish_handover(actor, handover, summary, p_acknowledgements)`:
  - it is service-role only and takes the verified actor (H1);
  - it re-checks membership and the creator rule before recording anything, so a reviewer who is not the creator, the
    incoming member and non-members are refused;
  - it refuses any (source, fingerprint) that is not a current gap (BTCF0: "coverage changed since it was reviewed");
  - it records the acknowledgements, then publishes through the unchanged 3-argument function, **in one transaction**:
    a refused publication leaves no acknowledgement.
- The trust model is that of every Baton mutation: the server builds the actor from `auth.getUser()`, and the database
  re-validates its role. A caller that holds the service-role key and lies about the actor is outside this guarantee,
  as for every other mutation.

**Enforcement:**
- Triggers `BEFORE INSERT ON handover_publications`, and `BEFORE UPDATE OF state ON handovers` when entering
  `approved` from anything but `approved`/`acknowledged`, refuse (BTPF0 `extraction_incomplete`) while any
  partial/failed source lacks an acknowledgement for its **current** fingerprint.
- This gates the 3-argument `publish_handover`, any future service-role path, and direct table writes by any role that
  can write those tables, inside the publishing transaction and under its lock.
- A database owner or superuser can always disable triggers or alter objects. That is outside this guarantee.

**Stale acknowledgements:** a new run, a retry (new attempt or job) or any change of progress or reason produces a
new fingerprint, so an earlier acknowledgement no longer matches and publishing is refused until the new state is
acknowledged. The earlier record is kept. Republishing after a revision with the **same** run and state reuses the
existing acknowledgement, because it covers exactly that state.

**Application:**
- `api_get_extraction_report` adds per-source `gapState`, `coverageFingerprint` and `gapAcknowledged`, from the same
  helpers.
- The report blocks on exactly the database's unacknowledged gaps.
- `publishHandover` sends `[{sourceId, fingerprint}]` only when the reviewer ticked the existing confirmation. It still
  refuses early without it, and calls the unchanged 3-argument function when there is nothing to acknowledge, so it
  stays compatible with a database without migration 2.
- No UI change: the Task 03 publish dialog checkbox drives it.
- Policy alignment: with the database gate present, a failed source blocks even when every source of the latest run
  failed. Task 03's action-only rule exempted that case. It can only arise when an earlier run succeeded.

## 4. Tests added or changed

| file | covers |
|---|---|
| `supabase/tests/sql/99_gap_answer_point_attributes.sql` | derived (account, owner), refused (custom owner, contact, custom account), reviewer-supplied, unchanged categories and linked questions, inapplicable/too-long detail refused, `api_get_point` readable, diagnostic, grants |
| `supabase/tests/sql/99_publish_extraction_ack.sql` | the 9 required gate scenarios, refusal leaves no acknowledgement, stale and made-up fingerprints, append-only record, report = gate, grants |
| `supabase/tests/upgrade/verify.sql`, `verify_selftest.sql`, `run.sh` | scoped overload check and its self-test |
| `lib/pipeline/__tests__/gap-point-detail.test.ts` | checklist ↔ SQL mapping in step; required fields = schema |
| `lib/actions/__tests__/extraction-actions.test.ts` | masked `pointDetail`, needs-details mapping, acknowledgement payload, conflict, unchanged 3-argument call |
| `lib/contracts/__tests__/extraction.test.ts` | report blocks on database gaps, acknowledgement list, failed-only run |
| `tests/integration/r3-e2e-multisource.test.ts` step 6 | real Postgres + real actions: refused without acknowledgement, the 3-argument path refused, acknowledged publish records exactly one row |

**Existing tests changed** (intentional behaviour changes, not to hide failures):
- `99_gap_answer_point.sql` case 5 and `it15_role_matrix.sql` accept *custom* owner/contact questions. They now
  supply the detail through the new overload; the refusal itself is covered in the new file.
- `30_rls.sql` and `it09_privileges.sql` allow the two new pure, table-free helpers that the SECURITY INVOKER report calls.

## 5. Remaining risks and decisions

- **Hosted data:** run `gap_answer_points_missing_attributes()` on hosted dev before or after applying migration 1, and
  approve the repair procedure above. Migration 2 makes any in-review handover whose latest run has a partial/failed
  source need the acknowledgement. That is intended; deploy the app before (or with) the migration.
- **Apply order on hosted:** 400100 then 400200, after 300100. The app is backward compatible with a database
  without them.
- **Contact names** always need a reviewer. That is a deliberate product consequence.
- **Optional reason** on acknowledgements: not added (no product field yet).
