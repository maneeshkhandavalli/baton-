# Baton: Contract Reconciliation (Revision 8)

| | |
|---|---|
| **Status** | **Approved** on 2026-11-12, together with Revision 8 of `shared-contracts.md`. D24 and D25 accepted. The mismatch map (§4) lists the work still required in each feature worktree |
| **Baseline** | `master` at `48d6588` |
| **Canonical sources** | `docs/architecture/shared-contracts.md` (R8 sections are marked "R8") and `lib/contracts/**` |
| **Inputs reviewed (read-only)** | `baton-upload-parser` (`feature/upload-parser`), `baton-supabase-auth` (`feature/supabase-auth`), `baton-workspace-ui` (`feature/workspace-ui`), all uncommitted on top of `48d6588` |

This log records what R8 decided, what changed in the contracts, and every place where a feature
branch now differs from the contract. A mismatch means the **implementation** must change unless a
row says otherwise. No contract was changed only because an implementation expected something
different; where an implementation's choice was adopted, the decision says so.

---

## 1. Decisions adopted

| # | Decision | Where |
|---|---|---|
| D28 | **Phone identity.** `+` or `00` prefixes → E.164; `+00` read as `00`; a trunk `0` after `+91` followed by 10 digits is removed; **no default region**: unprefixed numbers stay local (`tel:9999900001`) and never match an E.164 identity. Frozen with golden vectors | §12.11, `identity.ts` |
| D29 | **Saved-name identity.** Separate `name:` namespace, best-effort only. `identity_kind` stored next to every hash. Handover-wide name exclusions are only *detected* in other sources and need a per-source creator decision (`source_identity_confirmations`, `confirmIdentityMatch`). Name erasures are limited to one source; same-name participants elsewhere are reported, not erased | §6.8, §6.8.1, §12.2, §12.8 |
| D30 | **Identity pepper.** `p1` stable, non-rotating. Key = UTF-8 bytes of the pepper string; message = UTF-8 bytes of the normalized identity; lower-case hex. Pepper ≥ 32 characters, no surrounding whitespace. Matching requires kind, hash and version to agree. Canary = HMAC of `baton:identity-pepper-canary:p1`, which is also the pepper's registry fingerprint | §12.11, `identity.ts` |
| D31 | **`[EXCLUDED_PARTICIPANT]`** is a reserved parser output token, not a mask token. UI renders a muted "excluded participant" chip that never says "masked". Warning codes ratified as a closed list, including `excluded_mentions_redacted`, `pdf_cmap_truncated`, `pdf_font_limit` | §11.4, §12.1 |
| D32 | **Conversation exclusions** carry their `ParseContext` (timezone, effective date order, parser version). A mismatch fails with `exclusion_context_mismatch` (`precondition_failed`); the user confirms again on a fresh preview | §6.8, §10.3, §11.4 |
| D33 | **Preview exclusions.** `PreviewSourceInput = ParseSourceInput`: preview gets the same rules as the final parse and never exposes excluded participants through labels, previews or retained counts | §10.3, §11.4 |
| D34 | **Parser failures.** Invalid input and configuration are returned as `ParserInputFailure` inside `ParserResult`; only programming defects throw | §11.4 |
| D35 | **Server-only mutations.** Reads through the user client under RLS. Every mutation: server-only code → actor from `auth.getUser()` → service-role-only `SECURITY DEFINER` function that re-validates actor, membership, clearance, role and lifecycle. No browser role can execute a mutation. Erasure and purge need a verified, operation-bound manifest receipt | §8.3, §12.8 |
| D24 | **Accepted 2026-11-12.** Final scope: the revision 3–7 erasure (messages and evidence deleted, derived points tombstoned, every snapshot redacted by `evidenceId`, summaries cleared, acknowledgements invalidated, partly affected points held for privacy review, counts-only audit) **plus** the R8 extension: conversation previews cleared, the participant's local id removed from `participant_local_ids`, conversation and source counts and time ranges recomputed from the remaining messages, `name` erasures limited to one source with same-name participants elsewhere reported, and identity kind and scope source bound into the function, manifest entry and receipt | §12.8, §14 |
| D25 | **Accepted 2026-11-12.** Final scope: account deletion is blocked until every created handover is transferred (to an active `outgoing`/`reviewer` member who is not the creator, accepted by that member) or explicitly marked for permanent deletion in `purgeHandoverIds`; the request carries the typed word `DELETE`, checked on the server (`deleteAccountInput.confirm: "DELETE"`, `ACCOUNT_DELETION_CONFIRMATION`). Accounts are anonymised, never cascade-deleted | §11.3, §12.9, §14 |
| D12 ext. | `rate_limit_counters` adopted with the implemented scopes and values | §6.22, §12.4 |
| Errors | `DbErrorCode` widened to every category the DB raises (incl. `precondition_failed`, `forbidden`, `token_invalid`, `validation_failed`, `unauthenticated`, `rate_limited`), passed through unchanged. Custom SQLSTATEs `BT**0` ratified | §3.2, `api.ts` |
| Ownership | `lib/routes.ts` moves to **main** (the matrix said UI; the UI agent already treated it as read-only). `routes.demo` and `routes.account` added | §13.1, `lib/routes.ts` |

Adopted from implementations after review (not invented here): the Supabase agent's
`rate_limit_counters` design and values, `BATON_SITE_URL` validation, `safeNextPath`, display-name
derivation and per-handover disambiguation, receipt binding and one-shot verifier registration,
the erasure conversation recount, and the `BT**0` SQLSTATEs; the parser agent's 32-character pepper
minimum, normalization rules (except the trunk-zero rule, which the ratified decision widens), the
excluded-mention token and its warning codes.

## 2. Contract changes (files)

| File | Change |
|---|---|
| `lib/contracts/enums.ts` | `EXCLUSION_SCOPES`, `EXCLUSION_REQUESTED_VIA`, `IDENTITY_KINDS`, `EXCLUSION_RULE_MODES`, `IDENTITY_MATCH_DECISIONS`, `ACCESS_TOKEN_STATUSES` |
| `lib/contracts/identity.ts` (new) | `IDENTITY_HASH_ALGORITHM`, `CURRENT_IDENTITY_PEPPER_VERSION`, `IDENTITY_NAMESPACE_PREFIXES`, `MIN_IDENTITY_PEPPER_LENGTH`, `IDENTITY_HASH_PATTERN`, `IDENTITY_PEPPER_CANARY_MESSAGE`, `IdentityRef`, `sameIdentity`, `identityKindOfNormalized`, `IDENTITY_GOLDEN_TEST_PEPPER`, `IDENTITY_GOLDEN_TEST_CANARY`, `IdentityGoldenVector`, `IDENTITY_GOLDEN_VECTORS` (20 vectors). No `node:crypto`: client-safe |
| `lib/contracts/parser.ts` | `ParseContext`; `ExclusionRule` is now a union (`ParticipantExclusionRule` with kind, version and mode; `ConversationExclusionRule` with context; `DateRangeExclusionRule`); `PreviewSourceInput = ParseSourceInput`; `EXCLUDED_PARTICIPANT_TOKEN`; `ParsedParticipant.identityKind` and `identityPepperVersion`; `IdentityMatch`; `ParsedSource.parseContext` and `identityMatches`; `SourcePreview` adds `parserVersion`, `parseContext`, `identityMatches`; `PARSER_WARNING_CODES`, `ParserWarning`; `PARSER_INPUT_ERROR_CODES`, `PARSER_INPUT_ERROR_APP_CODES`, `ParserInputFailure`, `ParserFailure`, `isParserInputFailure`; `PARSER_LIMITS.maxPreviewChars` |
| `lib/contracts/api.ts` | `DB_ERROR_CODES` widened; `DbErrorShape.retryable`; `DB_SQLSTATE_ERROR_CODES` |
| `lib/contracts/schemas.ts` | `parseContextSchema`, `addExclusionInput`, `confirmIdentityMatchInput`, `createManualPointInput`, `createGapQuestionInput`, `createGapLinkInput`, `revokeAccessTokenInput`, and their `…Input` / `…Values` types. D25: `ACCOUNT_DELETION_CONFIRMATION`; `deleteAccountInput.confirm` is now `"DELETE"` (was `true`) and `purgeHandoverIds` must not repeat an id |
| `lib/contracts/dto.ts` | `HandoverSummary.pendingCreatorTransfer`; `MemberSummary.isCreator`, `isViewer`; new `CreatorTransferOffer`, `AccessTokenSummary`, `CreatedLink`, `PublicationSummary`, `SourceParticipantSummary`, `ExclusionSummary`, `SourceMessageContext`; `ErasureReport.sameNameParticipantsElsewhere` |
| `lib/contracts/queries.ts` | `listParticipants`, `listExclusions`, `getSourceMessageContext`, `listAccessTokens` (+ `AccessTokenFilter`), `listMyCreatorTransferOffers`; `MessageContextWindow`, `MESSAGE_CONTEXT_MAX`, `MESSAGE_CONTEXT_DEFAULT`; `getPublishedHandover` documented as membership-only |
| `lib/routes.ts` | `routes.demo`, `routes.account` |
| Tests | `identity.test.ts` (new), `parser-contract.test.ts` (new), `schemas.test.ts` (new cases) |
| Docs | `shared-contracts.md` R8 (§3, §3.2, §6.0, §6.4, §6.6–§6.8.1, §6.10, §6.21, §6.22, §8.3, §10.3, §11.2–§11.7, §12.1–§12.5, §12.8, §12.9, §12.11, §13.1, §14 D12/D24/D25/D28–D35, §15 assumption 14); this log |

## 3. Supabase architecture recorded (from `feature/supabase-auth`)

| Topic | Recorded as |
|---|---|
| `rate_limit_counters`: 8 scopes, values from `consume_rate_limit` (60/10 min, 300/h, 10/10 min, 30/h, 5/h, 3/h, 10/10 min, 10/h), SHA-256 subjects, consume-before-operation, 1-day prune | §6.22, §12.4, D12 |
| `BATON_SITE_URL`: bare https origin (http only for localhost), fail closed, exact callback allow-list | §12.3, §12.5 |
| Redirect validation: `safeNextPath` | §12.3 |
| Display names: from email local part, character filter, 60 chars, reserved labels, `#abcd` disambiguation | §12.3, `MemberSummary` |
| Receipt binding (event, kind, handover, identity hash, pepper version) and one-shot verifier registered by `lib/recovery` only | §12.8 point 2 |
| Server-only mutation model and grants | §8.3, D35 |
| Hash-based token RPCs (`peek_member_invite`, `redeem_member_invite`, `get_gap_interview`, `submit_gap_answers_with_token`, `list_access_tokens`) | §6.4 |

## 4. Mismatch map

Legend: **P** = parser branch, **S** = Supabase branch, **U** = UI branch, **M** = main (not yet
built). "Fix in" names the module that must change.

### 4.1 Parser (`feature/upload-parser`)

| # | Canonical (R8) | Implementation now | Fix in |
|---|---|---|---|
| P1 | Trunk `0` after `+91` + 10 digits is removed (`+91 022 1234 5678` → `tel:+912212345678`) | Removed only before a mobile number (`[6-9]\d{9}`); gives `tel:+9102212345678`. 19 of 20 golden vectors already match | `lib/privacy/phone.ts` `canonicalPhoneNumber` |
| P2 | No default region, permanently (D28) | `PENDING_PHONE_POLICY` plus a candidate `INDIA_MOBILE_DEFAULT_POLICY` | `lib/privacy/phone.ts`: drop the candidate policy from identity code. Using national-form matching for **mention redaction** (`excluded-mentions.ts`) is acceptable, because over-redaction is the safe failure; it must never affect identities |
| P3 | `ParsedParticipant.identityKind`, `identityPepperVersion` | Absent | `lib/parsers/build-source.ts` |
| P4 | Participant rules match on kind + hash + version, with `mode` | Match on hash only; old `ExclusionRule` shape | `lib/privacy/exclusions.ts`, `build-source.ts` |
| P5 | `detect` mode → `identityMatches`, nothing dropped | Not implemented | `exclusions.ts`, `build-source.ts` |
| P6 | Conversation rules carry `context`; mismatch → `exclusion_context_mismatch`; `ParsedSource.parseContext` reports the effective date order | No context; positional `c_N` applied blindly; effective date order not reported | `exclusions.ts`, `parse-source.ts`, `whatsapp/parse-chat.ts` |
| P7 | Preview applies the supplied rules (D33) | `previewSource` forces `exclusions: []`, so excluded participants appear in previews (**privacy defect**) | `lib/parsers/parse-source.ts` |
| P8 | Input and configuration problems are returned as `ParserInputFailure` | `ParserInputError` is **thrown** (pepper, timezone, date order, rules, bytes) | `lib/parsers/errors.ts`, `parse-source.ts`, `identity.ts`, `exclusions.ts`, `timezone.ts` |
| P9 | `ParserWarning.code: ParserWarningCode` | `code: string` | `lib/parsers/warnings.ts` |
| P10 | Golden vectors and canary come from `lib/contracts/identity.ts` | Local constants (`IDENTITY_PEPPER_VERSION`, `MIN_IDENTITY_PEPPER_LENGTH`); own vectors | `lib/privacy/identity.ts` and its tests: import from contracts and assert `IDENTITY_GOLDEN_VECTORS` |
| P11 | `SourcePreview` includes `parserVersion` | Not in the preview mapping | `parse-source.ts` |

### 4.2 Supabase (`feature/supabase-auth`)

| # | Canonical (R8) | Implementation now | Fix in |
|---|---|---|---|
| S1 | `DbError.code` is the precise `DbErrorCode`; no coarsening | `coarse()` folds codes into the old 4-value union (kept `appCode` as a workaround) | `lib/db/errors.ts` |
| S2 | `source_participants.identity_kind` | Absent | migration `schema`, `persist_parsed_source` |
| S3 | `source_exclusions.participant_identity_kind`, `parse_timezone`, `parse_date_order`, `parser_version`; kind in the partial unique index; conversation CHECK requires the context | Absent | migrations `schema`, `sources_members_tokens` (`add_exclusion`) |
| S4 | `evidence_quotes.author_identity_kind` | Absent | migrations `schema`, `review_gaps_pipeline` (`add_source_quote_evidence`) |
| S5 | `source_identity_confirmations` + `confirm_identity_match` | Absent | new migration |
| S6 | Rule feed emits kind, version, `mode`, `context`, `ruleId`; handover-wide **name** rules are `detect` unless confirmed | `parse_exclusion_rules` emits the old shape and applies every handover-wide rule (**name rules would apply silently**) | `parse_exclusion_rules` |
| S7 | `erase_participant(…, p_identity_kind, …, p_scope_source_id, …)`; name scope = one source; `ErasureReport.sameNameParticipantsElsewhere`; `participant_erasures.identity_kind`, `scope_source_id`; receipt binds kind and scope source | Hash-only, handover-wide for every identity | `privacy` migration, `lib/db/mutations.ts` `eraseParticipant`, `lib/db/recovery-gate.ts` |
| S8 | Erasure conversation and source recount | **Conforms** (preview cleared, local id removed, counts and ranges recomputed) | none |
| S9 | Read API: `listParticipants`, `listExclusions`, `getSourceMessageContext`, `listAccessTokens` (with `status`, `maxAccessLevel`), `listMyCreatorTransferOffers`; `MemberSummary.isCreator`/`isViewer`; `HandoverSummary.pendingCreatorTransfer` | Missing (only `list_access_tokens` exists, outside `BatonQueries`, without `max_access_level` or status) | `read_api` migration, `lib/db/queries.ts`, `lib/db/mappers.ts` |
| S10 | `createGapQuestionInput` forbids `category` with `pointId`; server derives it | `create_gap_question` accepts both | `review_gaps_pipeline` |
| S11 | Gap Interview links have 20 uses (not an input) | `createGapInterviewLink` takes `maxUses` | `lib/db/mutations.ts` (keep the SQL default) |
| S12 | `addExclusion` derives the handover from the source | Takes `handoverId` and `sourceId` | `lib/db/mutations.ts` (signature only) |
| S13 | Invitation redirect: lead/incoming → published view (until Q3: dashboard) | Dashboard | **Conforms** for now |

### 4.3 UI (`feature/workspace-ui`)

| # | Canonical (R8) | Implementation now | Fix in |
|---|---|---|---|
| U1 | Canonical `AddExclusionInput`, `CreateGapQuestionInput`, `CreateGapLinkInput`, `PublicationSummary`, `CreatedLink` | Provisional `Mock…` types; `{ sourceId, rule }` exclusion shape; `{ url, expiresAt }` link results | `lib/mocks/action-types.ts`, `lib/mocks/actions.ts`, callers |
| U2 | `BatonQueries` has 5 new methods; `MemberSummary.isViewer`/`isCreator`; `HandoverSummary.pendingCreatorTransfer` | Not implemented; `mockViewerMemberId` works around the missing flag | `lib/mocks/queries.ts`, settings page |
| U3 | `SourcePreview` with `parserVersion`, `parseContext`, `identityMatches`; participants with identity kind and version; new `ExclusionRule` union | Old shapes in `MockSource` and preview fixtures | `lib/mocks/types.ts`, `lib/mocks/fixtures/preview.ts`, wizard |
| U4 | `[EXCLUDED_PARTICIPANT]` renders as a distinct "excluded participant" chip | Rendered by `MaskedText` as a mask chip titled "Masked by Baton…" | `components/review/evidence-quote.tsx` (and any shared masked-text renderer) |
| U5 | `routes.demo`, `routes.account` | Hard-coded `"/account"` in `config/navigation.ts`, `siteConfig.demoPath` | `config/navigation.ts`, `config/site.ts`, `app/(marketing)/**` |
| U6 | Published content is read by membership; a token never grants reads (§12.3) | `/h/[token]` reads the publication through the token (`mockRedeemHandoverLink`); `mockReaderLinkFor` builds reader links from invite tokens | `app/(token)/h/[token]/page.tsx`, `lib/mocks/queries.ts`; blocked on Q3 |
| U7 | UI imports only `lib/contracts`, `lib/data`, `lib/actions` (§11.1) | Pages and components import `lib/mocks/**` directly | Expected during parallel work; switches when main ships `lib/data` and `lib/actions` (M1) |
| U8 | `/account` lists creatorship offers (`listMyCreatorTransferOffers`) | Shows deletion blockers; the "Creatorship offers" section is a placeholder noting the missing query | `app/(workspace)/account/page.tsx` |
| U9 | Identity-match confirmation step in the wizard (§10.3 step 2) | Absent | `components/wizard/**` |
| U10 | `deleteAccount({ confirm: "DELETE", purgeHandoverIds })`: the typed word is sent and checked on the server (D25) | The page asks the user to type `DELETE` but sends `confirm: true`, so the mock action and the canonical schema now reject it | `components/account/account-deletion.tsx`, `lib/mocks/actions.ts` |

### 4.4 Main (not yet implemented)

| # | Needed |
|---|---|
| M1 | `lib/data` facade and `lib/actions` for every §11.3 action, including `confirmIdentityMatch`, `revokeAccessToken`, building `CreatedLink` / `PublicationSummary`, and `deleteAccount` validating the typed `DELETE` before any manifest write, purge or `delete_account_data` call (D25) |
| M2 | Exclusion-rule builder (`mode` per §11.4) and the parse-job checks for `identityMatches` and `exclusion_context_mismatch` (§10.3) |
| M3 | Pepper start-up check using `IDENTITY_PEPPER_CANARY_MESSAGE` (§12.11) |
| M4 | `.env.example`: `BATON_SITE_URL` |
| M5 | `lib/recovery` (manifest client and receipt verifier); D27 remains open |

## 5. Open questions (proposals, not decisions)

| # | Question | Proposal |
|---|---|---|
| Q1 | Identity hashes reach browsers: `SourcePreview.participants[].identityHash` is returned by the `previewSource` action, and review roles can `SELECT source_participants.identity_hash` under RLS. §12.8 calls the hash sensitive | The `previewSource` action strips hashes. `addExclusion` for participants takes `{ sourceId, participantLocalId, parseContext }` and the server recomputes kind and hash from a fresh preview. Revoke the `identity_hash` column from `authenticated` (column grant or view). Needs a decision because it changes `AddExclusionInput` again |
| Q2 | R8 adds `identityKind` and `scopeSourceId` to the manifest entry and receipt while D27 is open | Accept now, so the D27 store design includes them from the first entry (`schemaVersion` 1) |
| Q3 | Where do lead and incoming members read a publication? No workspace route exists | Add `/handover/[id]/published` (UI page, `routes.handover.published`) reading `getPublishedHandover`; `/h/[token]` redeems and redirects there |
| Q4 | D17 keeps audit rows 90 days after a purge, but once `handover_id` is nulled nothing records when (Supabase note) | Add `audit_logs.handover_purged_at timestamptz NULL`, set by `purge_handover` when it nulls `handover_id`; the sweep deletes rows older than 90 days by it |
| Q5 | D12 names uploads and AI calls; neither is rate-limited | Choose scopes and limits (e.g. per actor for `createSourceUpload` and per handover for `startProcessing`). Values are not proposed here because none were specified |
| Q6 | Display names derived from the email local part show other members part of a person's address (for example `asha.k`) | Let users set a display name on `/account`, subject to the same character and reserved-name rules; keep the derived name only as the default |
| Q7 | ~~D24 and D25 await sign-off~~ | **Resolved 2026-11-12:** both accepted (§1) |
