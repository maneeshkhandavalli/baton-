# Proposal R9-Q1: opaque participant references in `SourcePreview` (for owner approval)

Status: **PROPOSED, not adopted.** The canonical contract (`lib/contracts/**`,
`docs/architecture/shared-contracts.md`) is unchanged until the owner approves this (§13.3).

## Problem
`previewSource` returns `SourcePreview.participants[]` with `identityHash` (64-hex HMAC of the normalized
phone number or saved name, pepper `p1`) and `identityPepperVersion`. The browser needs them only to
echo them back in `addExclusionInput` (participant variant), see
`components/wizard/new-handover-wizard.tsx:275-277`.

- The hash is **stable across sources and handovers**: the same phone number yields the same value
  everywhere, so any copy of it (browser memory, extensions, logs, screenshots, support tickets) is a
  cross-handover correlation handle for that person.
- §12.8 treats identity hashes as sensitive; the database already refuses them to client roles
  (column grants), so the preview action is the only path by which they reach a browser.
- A phone-number space is small. If the pepper were ever exposed, a leaked hash is reversible by
  enumeration.

Today only creators and outgoing members can preview (`source_preview_target`, R2), which limits but does
not remove the exposure.

## Proposed change
1. **Separate browser DTO; parser unchanged.** `SourcePreview` stays the parser's server-internal type
   (`lib/parsers` returns it through `PreviewSourceFn`). Add a browser-facing `SourcePreviewDto` to
   `lib/contracts/parser.ts`, identical except for its participants:
   ```ts
   export interface PreviewParticipant {
     localId: string;            // "p_1"… assigned before exclusions (D33), stable for one parseContext
     displayLabel: string;       // masked, as today
     identityKind: IdentityKind; // "phone" | "name" (needed for the scope choice and labels)
     messageCount: number;
   }
   export type SourcePreviewDto = Omit<SourcePreview, "participants"> & { participants: PreviewParticipant[] };
   ```
   The `previewSource` action returns `SourcePreviewDto`, mapping the parser result in
   `lib/actions/core/sources.ts`. `identityHash` and `identityPepperVersion` never reach the browser.
2. **Exclusion input (browser).** Replace the participant variant of `addExclusionInput` with:
   ```ts
   { kind: "participant"; sourceId: uuid; scope: ExclusionScope;
     participantLocalId: /^p_[1-9][0-9]*$/; parseContext: ParseContext; reason?: string }
   ```
   This mirrors the conversation variant, which is already bound to its `parseContext` (D32). A
   server-internal type (for example `ParticipantExclusionValues`) keeps the hash triple for `lib/db`.
3. **Server recomputation.** For a participant rule, `addExclusion` re-runs the same actor-checked preview
   server-side (`loadRawSourceForPreview` + `getParseExclusions` + verified pepper + parser
   `previewSource`). Outcomes:
   - `parseContext` differs from the fresh preview: `precondition_failed` (`reason: "preview_stale"`),
     as for stale conversation rules (D32);
   - `participantLocalId` is absent from the fresh preview, for example because another rule excluded the
     participant meanwhile: `precondition_failed` (`reason: "participant_not_in_preview"`). There is
     **never** a fallback to another participant or to a client-supplied value;
   - otherwise the server takes **that** participant's `identityKind`, `identityHash` and pepper version and
     calls the unchanged `add_exclusion` SQL function through `lib/db` `addExclusion`.
   The browser can no longer submit an arbitrary hash.
4. **No database change.** `source_exclusions`, `add_exclusion`, `parse_exclusion_rules` and the stored rules
   stay as they are; existing exclusions remain valid.

## Compatibility impact
| Area | Impact |
|---|---|
| `lib/contracts/parser.ts` | Additive: `PreviewParticipant`, `SourcePreviewDto`. `SourcePreview` and `PreviewSourceFn` unchanged. |
| `lib/contracts/schemas.ts` | Breaking: the `addExclusionInput` participant variant changes shape (contract revision R9); a server-internal values type keeps the hash triple. |
| `lib/actions/core/sources.ts` | `previewSource` returns the DTO; `addExclusion` gains the server-side preview and the two refusals above. |
| `lib/db/mutations.ts` (`addExclusion`) | Signature moves to the server-internal values type; the RPC arguments are unchanged. |
| `components/wizard/new-handover-wizard.tsx` (`:124`, `:275-284`, `:368`) | Uses `SourcePreviewDto`; sends `participantLocalId` + `parseContext` instead of the hash triple. |
| `lib/mocks/actions.ts` (`:426-489`), `lib/mocks/preview-rules.ts` (`:48`), `lib/mocks/**` types, `/demo` | Follow the DTO and the new input; demo behaviour unchanged. |
| `lib/parsers/**`, `lib/privacy/**` | No change. |
| Database, migrations, stored data | No change. |
| Tests to update | `lib/contracts/__tests__/schemas.test.ts` and `parser-contract.test.ts`, `lib/actions/__tests__/actions.test.ts`, `lib/mocks/__tests__/exclusions.test.ts`, `tests/integration` IT-02/IT-11/IT-14 and the E2E. |
| New security tests | The preview response contains no 64-hex value; a forged, stale or absent `participantLocalId` or `parseContext` is refused; exclusion hashes are always server-derived. |
| Cost | One extra in-memory preview parse (≤ 25 MB) per participant exclusion; it falls under the Q5 per-user upload and processing limits. |

## Owner decision requested
Approve R9-Q1 as written. Alternatively, keep the current shape as an accepted limitation, with previews
restricted to source managers. Until a decision is made, the current contract shape stays in place.
