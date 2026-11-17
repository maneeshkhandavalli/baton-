# Privacy and data protection (Round 3 Task 02)

Status: implemented on branch `round3/task02-privacy` and verified locally. **Nothing here has been applied to the hosted
database, deployed, or switched on.** Audit findings addressed: PRIV-1, PRIV-2, PRIV-3, PRIV-4 (and the provider half of JOB-2).

Every section separates **what the code now enforces** from **what still needs hosted configuration or an owner decision**.

---

## 1. Data lifecycle

| Stage | What exists | Where | Protection |
|---|---|---|---|
| Upload | Raw file (unmasked) | Supabase Storage `source-uploads/raw/{handover}/{source}` | Signed single-use upload URL issued server-side after role, lifecycle and limit checks |
| Preview | Participant labels and masked previews, shown to the uploader to choose exclusions | Server memory, response only | Same exclusion rules as the final parse (excluded people never appear) |
| Parse | Exclusions applied, excluded names redacted (chats **and documents**), masking, **pseudonymisation** | Worker memory | Nothing persisted before all of this ran |
| Persist | `[PERSON_n]` labels and bodies, masked tokens, `[EXCLUDED_PARTICIPANT]` | `source_participants`, `source_messages`, `source_conversations` | Source marked `identity_scheme = person_v1`; refused unless every label is a known placeholder |
| Identity map | `[PERSON_n]` → masked display label, encrypted | `handover_people` (AES-256-GCM, server key) | No direct access for any role; fenced pipeline functions; clearance-checked resolver |
| Raw delete | After the parse commit; otherwise the retention sweep | Storage + `raw_retention_items` | §5 |
| AI | Pseudonymised message text, pseudonymised team/role names, pseudonymised claims (verify) | Provider | Output guard refuses reintroduced names; production requires an approved data-governance profile (§7) |
| Points / publication | Text derived from pseudonymised evidence | `handover_points`, `publication_points` | Rendered with names only for members with clearance (§3) |

## 2. Pseudonymisation architecture (PRIV-1)

**Code:** `lib/privacy/pseudonymize.ts`, `lib/privacy/pseudonymize-source.ts`, `lib/privacy/identity-vault.ts`,
`lib/pipeline/identity.ts`, `lib/pipeline/stages/parse.ts`, migration `20261117200100_identity_vault.sql`.

1. **Who is a known person.** Every chat sender (source metadata), identified by the existing peppered identity hash. Excluded
   people are dropped by the parser first and are never registered.
2. **Stable numbers across sources.** The parse job registers the senders of its own source **and** of every other unparsed chat
   source in the same run (read with that source's own exclusion rules; never written), through the fenced
   `pipeline_reserve_handover_people`, which serialises per handover. So a name is replaced in whichever source is parsed first, and
   the same person has the same `[PERSON_n]` in every source of the handover. People from earlier runs come from the vault.
3. **Replacement.** Author labels become `[PERSON_n]`. In bodies, document headings and conversation previews:
   - whole names, case-insensitive, with flexible spacing, NBSP, `.`, `_` or `-` between words;
   - each name word of ≥ 3 letters, case-insensitive, whole word only (never inside `Ravindra`);
   - `@mentions` including WhatsApp's `@⁨~Name⁩`;
   - any script (Unicode letters and combining marks, NFC/NFD), e.g. Devanagari, Tamil, Arabic;
   - **common words** that are also names (`will`, `mark`, `asha`, `kiran`, `pooja`, `mom`, `admin`, `lead`, Hindi/Hinglish words, …)
     are replaced only inside the whole name or as an `@mention`, so ordinary text survives;
   - a word shared by several people (`Ravi` for *Ravi Kumar* and *Ravi Shankar*) becomes `[PERSON]` (unnumbered), never a guess.
     A whole name always wins over a shared word.
4. **Persistence.** `pipeline_persist_pseudonymized_source` refuses any label that is not a known placeholder and marks the
   source `person_v1` in the same transaction.
5. **AI requests.** Only pseudonymised text is stored, so extraction sends `[PERSON_n]`. The team name and role title are
   pseudonymised before sending. `verify_support` pseudonymises every string it sends (claim, attributes, quote, context, author
   labels), so a real name a reviewer typed into a point never reaches the verifier. The quote hash recorded is still the stored
   text, so verdict fencing is unchanged.
6. **Output guard.** A candidate whose model text (title, statement, rationale, attributes, quotes) contains a known participant's
   name, or an excluded person's name (found by hash), is **dropped**, never rewritten (logged as `identityDropped`, a count). A
   verifier rationale that names a known participant is not stored; the verdict is.
7. **Legacy gate.** A source parsed before this change (`identity_scheme` NULL, plain-text names) is refused by extraction with
   `source_not_pseudonymized`, unless the owner sets `BATON_ALLOW_LEGACY_IDENTITY_SOURCES=1` (§6).

The prompt text is unchanged: the repository requires the live prompt-injection suite before any prompt-version bump, which this
task must not run. The model already receives `[PERSON_n]` as the author label it is told to copy. Recommended follow-up: name the
`[PERSON_n]` token explicitly in the prompts (`extract@2`, `support@2`) together with the D11 live suite.

### Identity vault

- Table `handover_people`: `(handover_id, ordinal)` primary key, `person_key` (32 bytes), `sealed_label`, `key_version`.
  RLS on, no policies, **all privileges revoked from anon, authenticated and service_role**. It is reached only through
  SECURITY DEFINER functions.
- `person_key = HMAC-SHA256(HKDF(IDENTITY_MAP_KEY, "person:k1"), handover id ‖ identity kind ‖ identity hash)`. It is keyed and
  scoped to one handover: the same person gets unrelated keys in different handovers, and nobody without the server key can
  compute one. This avoids an unkeyed or global identifier. The pre-existing `identity_hash` (global pepper) is unchanged and is
  still used only for exclusion matching.
- `sealed_label = AES-256-GCM(HKDF(IDENTITY_MAP_KEY, "enc:k1"), label)` with a random 96-bit nonce. Its AAD binds handover,
  person key and key version, so a ciphertext copied elsewhere fails to decrypt. The database never sees the key or the plaintext.
- Phone-number senders have no stored label (`NULL`); they are "Person n" to everyone.
- Missing or invalid key: parse jobs fail **closed and retryable** (`identity_map_key_unverified`); the resolver returns no names.

## 3. Identity resolution

- `resolveHandoverPeople` (Server Function, `lib/actions/core/identity.ts`) takes the **verified** actor from the session, never a
  client-supplied id. It calls `resolve_handover_people(actor, handover)`, which returns sealed labels only when:
  - the actor is a member of the live handover (otherwise `not_found`, indistinguishable from a missing handover);
  - the person is a participant of a parsed, live, `person_v1` source whose access level is **within the member's clearance**.
- Decryption happens on the server. Labels are never logged, cached across requests, or stored in the browser; the page keeps them in
  memory only.
- Display: `MaskedText` (the single renderer for stored text) renders `[PERSON_n]` as the name for viewers with clearance, and as
  "Person n" otherwise. `[PERSON]` reads "a participant". Plain-text places (`aria-label`, titles) use "Person n". The
  `PeopleProvider` wraps the handover pages (review, published, settings, gaps, processing). Token routes (`/g/…`, `/h/…`) never
  resolve names.
- **Existing (legacy) content** stays plain text and is shown exactly as before, under the existing RLS and clearance rules. No vault
  row is needed for it.

## 4. Document exclusions (PRIV-3)

**Code:** `lib/privacy/excluded-discovery.ts`, `lib/parsers/build-source.ts`.

Exclusion rules store only a peppered hash, and documents have no senders, so names in PDFs, DOCX, Markdown and text used to
survive. Now every run of 1–4 words in the document (spaces, or a single `-`, `'`, `.` between words) is normalised exactly like a
sender and hashed. A match with an `apply` participant rule reveals the surface form, which feeds the **same** mention redactor as
chats. That covers the whole name in any case or spacing, `@mentions` for single-word names, possessives, and headings as well as
bodies. It runs before masking, persistence and the AI, in the preview too.

The same discovery now also covers **chats**: an excluded person who never wrote in that chat (excluded handover-wide) is found in
other people's messages. The extract-stage output guard runs the same discovery on model text, so excluded people cannot reappear
in generated output.

Behaviour shared across source types: detect-mode rules never redact. A single-word name in free text is left alone (only
`@Name`), as in chats.

## 5. Raw-file retention (PRIV-2)

**Code:** migration `20261117200200_raw_retention.sql`, `lib/retention/sweep.ts`, `app/api/cron/retention/route.ts`,
`supabase/ops/schedule-raw-retention.sql`.

**Policy (configurable; the defaults are the proposal's candidates, pending owner approval):**

| Setting | Default | Range | Applies to |
|---|---|---|---|
| `BATON_RAW_RETENTION_DAYS` | **7** | 1–365 | uploaded-but-never-processed sources (abandoned drafts) and failed parses |
| `BATON_PENDING_UPLOAD_GRACE_HOURS` | 24 | 2–168 | unfinished uploads (`pending_upload`), and failed post-parse deletes |
| (immediately) | | | uploads of discarded drafts, removed sources whose delete failed |
| `BATON_RETENTION_MAX_PER_RUN` | 100 | 1–1000 | claims and deletes per run |
| `BATON_RETENTION_MODE` | **off** | off / dry_run / live | any invalid value is **off** |

**Mechanism:**

1. **Inventory (dry run):** `raw_retention_inventory` lists eligible sources with their reason, `protected` flag and whether the
   object exists. It changes nothing.
2. **Claim:** `claim_raw_for_retention` locks the handover (FOR SHARE) and then the source (FOR UPDATE), and re-checks eligibility and
   protection. It applies the row change:
   - `pending_upload` → `removed`;
   - uploaded or failed past the ceiling → `failed`, `error_code = raw_expired`;
   - parsed, removed or discarded → unchanged.

   It then moves the path into `raw_retention_items` and clears `raw_storage_path`, so no run can start on that source any more.
   **Protected:** a source that is `parsing` or belongs to an active (`queued`/`running`) run, including a failed source awaiting a
   retry in that run. A path that is not exactly `raw/{its handover}/{its id}` is refused.
3. **Delete:** the server removes the object through **Supabase Storage with the service role**, never by touching
   `storage.objects`. Deletes are idempotent.
4. **Record:** `complete_raw_retention_item` sets `deleted` (`sources.raw_deleted_at` plus a `source.raw_deleted` audit row) or
   `failed` with an error class (`storage_error`, `path_refused`). Retries back off exponentially from 5 minutes, capped at 24 hours,
   and stay visible. A late failure cannot undo a deletion.
5. **Report:** `raw_retention_report()` returns counts only: eligible and protected now, by reason, raw uploads held, oldest raw
   upload, items pending/failed/failing repeatedly (3 or more attempts)/deleted, and the last five runs. Every run writes a
   `raw_retention_runs` row (kept 90 days).

It never deletes normalised messages, points, evidence or publications, and never calls the purge (D27 stays closed).

**Draft deletion (traced end to end).** `deleteHandover` → `delete_handover` (soft delete) → `deleteHandoverRawObjects` →
`list_deleted_handover_raw_paths` → Storage remove → `mark_source_raw_deleted`. Failures keep their path and are now picked up by
the sweep (`handover_deleted`, immediately eligible).

**Scheduling** reuses the Task 01 infrastructure: pg_cron, pg_net, Vault, the private `baton_ops` schema, signed dispatches, and
dispatch outcome monitoring in `baton_ops.retention_dispatches`. `schedule-raw-retention.sql` adds an hourly job
`baton-raw-retention` (minute 41) and its housekeeping. A dispatch signature is **bound to its purpose**:
`v1.<ts>.<id>.retention`. A retention header is refused by the drain endpoint and a drain header by the retention endpoint (tested
in the ops suite and in the smoke test).

### Dry-run results (local, synthetic data: `tests/integration/db/sql/it22_raw_retention.sql`)

The inventory on the synthetic fixture reported:

- **eligible, the 5 expected:**
  - an upload 7 days + 1 hour old (`raw_ceiling`);
  - a failed parse 8 days old (`raw_ceiling`);
  - an unfinished upload 25 hours old (`pending_upload_expired`);
  - a parsed source whose delete failed 25 hours ago (`parsed_raw_pending`);
  - a discarded draft's upload (`handover_deleted`);
- **not eligible:** the upload at 6 days 23 hours (the boundary) and the 1-hour-old unfinished upload;
- **protected:** 1, a 9-day-old upload in an active run.

It changed nothing (verified row by row). After the claims and one failed-then-retried delete, `raw_retention_report()` returned:

```json
{ "items": { "pending": 4, "failed": 0, "deleted": 1, "failingRepeatedly": 0 },
  "policy": { "rawCeilingDays": 7, "pendingGraceHours": 24 },
  "eligibleNow": 1, "protectedNow": 1, "eligibleByReason": { "raw_ceiling": 1 }, "rawUploadsHeld": 4 }
```

The remaining eligible source is the deliberately foreign-path source, which the claim refuses (`path_refused`). No hosted
inventory was run.

## 6. Existing data and migrations

**Backward compatibility:**

- Both migrations are additive: two new tables for retention plus one for the vault, one nullable column, and new functions. No
  existing function is replaced.
- Old code keeps working against the new schema. New code needs the migrations: the parse job calls the new functions, and fails
  with `db_schema_outdated` if they are missing.
- **Apply the migrations before deploying**, as for Task 01.
- Existing handovers contain plain-text names in participant labels, message bodies, points and publications. They are **not
  rewritten**:
  - **Published handovers stay as published.** Names remain visible under the existing clearance rules, as today.
  - **Drafts with legacy parsed sources:** extraction refuses those sources (`source_not_pseudonymized`). The safe remediation is to
    re-upload the file: the new source is parsed with placeholders, and the old one can be removed.
  - The owner can instead set `BATON_ALLOW_LEGACY_IDENTITY_SOURCES=1` and accept that those names go to the AI provider.
  - New sources added to an old handover are pseudonymised; old content still shows names, new content shows names only to members
    with clearance.
- Run `select public.identity_backfill_report();` (service role, read-only) for a dry-run assessment. It returns counts and ids
  only, never a label, with a per-handover recommended action. Locally (it21) it reported 1 legacy draft handover, 1 legacy source,
  3 named participants and 9 legacy messages, with no label in the output.
- A rewrite-in-place backfill was deliberately **not** built: it would change stored evidence text, so quote offsets, body hashes
  and the evidence of published versions would no longer match. Should it ever be wanted, it is limited to legacy sources that have
  no evidence yet and needs separate approval.

**Migrations:** `20261117200100_identity_vault.sql` and `20261117200200_raw_retention.sql`, versioned and tested on local
Postgres (Tier P it21, it22 and the full suites). **Not applied to the hosted database.**

## 7. AI provider data governance (PRIV-1, JOB-2)

**Mechanism.** `lib/ai/config.ts` is the only reader of AI configuration, and selects the provider from `AI_PROVIDER` (`gemini` or
the dev/test `fake`).

**New gate.** Any build that is not exactly `NODE_ENV=development` or `test` uses a real provider **only** when
`AI_DATA_GOVERNANCE` names an approved profile. That covers every Vercel deployment, `next start`, and a script started without
`NODE_ENV`. Otherwise the configuration is `provider_not_configured`; operators see `data_governance_unapproved` in the server log
and users see the existing message. Production therefore cannot fall back silently to the free tier.

The only profile is `gemini-paid-dpa`: the key belongs to a Google Cloud project with an **active billing account**, so Gemini
"Paid Services" terms apply.

**What the current terms say** (verified 2026-11-17 from the Gemini API Additional Terms, effective 2026-03-23, and the billing
docs; ai.google.dev now redirects to aistudio.google.com/docs):

- **Unpaid services** (free tier):
  - Google uses prompts and responses "to provide, improve, and develop Google products";
  - human reviewers may read them;
  - the terms say "Do not submit sensitive, confidential, or personal information to the Unpaid Services." This **rules the free
    tier out** for organisational chats.
- **Paid services:**
  - Google doesn't use prompts or responses to improve its products;
  - processing falls under the **Data Processing Addendum** (Google as processor);
  - but prompts and responses are **still logged "for a limited period of time"** for abuse monitoring and legal disclosure, and may
    be stored or cached in any country where Google operates.
  - The terms state **no retention length** and offer **no zero-data-retention option**.
  - Grounding with Search or Maps keeps data 30 days; Baton does not use grounding.
- **Unclear in the terms:** whether "unpaid quota" used through a billed project counts as paid. Confirm with Google, or treat only
  billed usage as compliant.
- **Age:** the APIs require users to be 18 or older, and may not be used in applications "directed towards or … likely to be
  accessed by individuals under the age of 18". This matters for student clubs.
- **Region:** apps offered to users in the EEA, Switzerland or the UK may use only Paid Services.

**Quotas:** the project notes record about 20 requests per model per day on the free tier. Per-run budgets allow up to 200 extract
and 2,000 verify calls, so the free tier cannot sustain real handovers either (JOB-2).

## 8. Session security (PRIV-4)

- **httpOnly session cookies:** `lib/supabase/cookie-options.ts`, passed to both server Supabase clients (`server.ts`,
  `proxy.ts`). `@supabase/ssr` merges it into every auth cookie it writes or clears, including the PKCE verifier. Options:
  `httpOnly: true`, `SameSite=Lax`, `Secure` in production. A browser test confirms page JavaScript sees no cookies.
- **Why it doesn't break sign-in:**
  - Google OAuth starts in a Server Function, and `/auth/callback` exchanges the code on the server;
  - password, magic-link and sign-out are server-side;
  - `proxy.ts` refreshes the session on the server.

  The browser had exactly one Supabase client, used only for the signed upload.
- **Upload signing** was already server-side: `createSourceUpload` signs with the user's storage client after the SQL checks. The
  browser client is now **session-less** (`persistSession: false`, no cookies or refresh), and the upload is authorised by the
  single-use token.
- **Content Security Policy** (`lib/security/headers.ts` via `next.config.ts`). The audit of what the app loads found:
  - no third-party scripts;
  - fonts self-hosted by next/font;
  - no remote images;
  - the theme script is a same-origin file;
  - the only external network target is the Supabase project (uploads).

  So the policy is:
  - same-origin for everything, `connect-src` adds the Supabase origin;
  - `frame-ancestors`, `frame-src` and `object-src` are `'none'`; `base-uri` and `form-action` are `'self'`;
  - `upgrade-insecure-requests`, plus `nosniff`, `X-Frame-Options: DENY` and a restrictive Permissions-Policy.

  `script-src` needs `'unsafe-inline'` because Next.js App Router emits inline RSC payload scripts. A nonce would make every page
  dynamic, which conflicts with Cache Components / PPR. The CSP therefore blocks loading from and exfiltrating to other hosts,
  framing and plugins, but **not** an injected inline script: the httpOnly cookies are what keep the session out of reach of one.
- **Verified in a real browser** on the production build:
  - `/` and `/login` render and hydrate, with no CSP violation and nothing loaded off-origin;
  - a `fetch` to another host and a foreign `<script>` are blocked (`connect-src`, `script-src-elem`);
  - the pre-existing React #441 console error on `/` also appears on the Task 01 build without CSP.

## 9. Outstanding owner approvals and hosted configuration

1. **Provider decision (separate approval).** Move to the Gemini API on a billed Cloud project (`AI_DATA_GOVERNANCE=gemini-paid-dpa`)
   or another provider with no-training and, ideally, zero-retention terms. Before approving:
   - accept the abuse-monitoring log of unstated length;
   - resolve the 18+ requirement for student-club users;
   - confirm the unpaid-quota-on-billed-project question with Google;
   - update the consent text (`components/wizard/consent.tsx`, which still describes the free tier) and the landing copy.

   No billing, keys or provider settings were changed.
2. **`IDENTITY_MAP_KEY`:** generate 32 random bytes and set the key server-only in Vercel. Escrow it like the pepper: losing it
   makes names unresolvable, though content stays pseudonymous.
3. **Apply migrations** `20261117200100` and `20261117200200` before deploying (with Task 01's `20261117100100`).
4. **Legacy drafts:** run `identity_backfill_report()` and decide: re-upload, which is recommended, or the temporary
   `BATON_ALLOW_LEGACY_IDENTITY_SOURCES=1`.
5. **Retention:**
   - approve the policy (7 days / 24 hours / immediately on discard);
   - after the Task 01 scheduler is live, create the Vault secret `baton_retention_url` and run
     `supabase/ops/schedule-raw-retention.sql`;
   - set `BATON_RETENTION_MODE=dry_run` for a week, review `raw_retention_report()`, then `live`.
6. **CSP:** confirm on a preview deployment that sign-in (Google, password, magic link) and uploads work; Supabase's host comes from
   `NEXT_PUBLIC_SUPABASE_URL` at build time.

## 10. Operational limitations

- **Name detection covers only known participants** (chat senders). It does not catch:
  - names of people who never wrote in any chat of the handover;
  - nicknames, misspellings, transliterations into another script, names glued to other words ("Ravibhai");
  - common words used as names, or names of more than four words (exclusion discovery).

  It is not a general named-entity recogniser. Documents are pseudonymised only for people known from the handover's chats. A
  document parsed in an earlier run is not re-pseudonymised when a chat added later reveals new people.
- **Ambiguous name words** become `[PERSON]`, which no viewer can resolve.
- **Over-redaction:** a document mention of a longer name that starts with an excluded name ("Ravi Kumar Singh") becomes
  `[EXCLUDED_PARTICIPANT] Singh`. This is the safe failure; chats protect it only when that person is a sender.
- Phone-number senders have no stored name.
- A person registered before being excluded handover-wide keeps an encrypted, unresolvable vault row until the purge (D27).
- **Remaining personal data:**
  - free text typed by people (gap answers, point edits) is stored as typed;
  - `verify_support` pseudonymises known names before sending, but other personal details there rely on masking;
  - addresses, dates of birth and health information are still not masked (PRIV-5).
- **Gemini paid tier:** abuse-monitoring logging continues for an unstated period.
- **CSP:** `'unsafe-inline'` scripts (see §8).
- **pg_net:** the queue is still readable by roles that can run SQL (Task 01B finding); only short-lived, purpose-bound signatures
  are ever queued there.
