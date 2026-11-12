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
1. **Browser DTO.** Add `PreviewParticipant` to `lib/contracts/parser.ts` and make the browser-facing
   `SourcePreview.participants` use it:
   ```ts
   export interface PreviewParticipant {
     localId: string;            // "p_1"… positional within this preview's parseContext; not identifying
     displayLabel: string;       // masked, as today
     identityKind: IdentityKind; // "phone" | "name" (needed for the scope choice and labels)
     messageCount: number;
   }
   ```
   `identityHash` and `identityPepperVersion` are removed from what the browser receives. The parser's
   internal `ParsedParticipant` (server-only) keeps them; only the browser DTO changes.
2. **Exclusion input.** Replace the participant variant of `addExclusionInput` with:
   ```ts
   { kind: "participant"; sourceId: uuid; scope: ExclusionScope;
     participantLocalId: /^p_[1-9][0-9]*$/; parseContext: ParseContext; reason?: string }
   ```
   This mirrors the conversation variant, which is already bound to its `parseContext` (D32).
3. **Server recomputation.** `addExclusion` (participant) runs the same actor-checked preview server-side
   (`loadRawSourceForPreview` + `getParseExclusions` + verified pepper + parser `previewSource`). It
   requires `parseContext` to match (otherwise `precondition_failed`, as for stale conversation rules),
   finds `participantLocalId`, and passes **its** `identityKind`, `identityHash` and pepper version to the
   unchanged `add_exclusion` SQL function. The browser can no longer submit an arbitrary hash.
4. **No database change.** `source_exclusions`, `add_exclusion`, `parse_exclusion_rules` and the stored rules
   stay as they are; existing exclusions remain valid.

## Compatibility impact
| Area | Impact |
|---|---|
| `lib/contracts/parser.ts`, `schemas.ts` | Breaking: `SourcePreview.participants[*]` loses two fields; `addExclusionInput` participant variant changes shape. Contract revision R9, contract tests updated. |
| `lib/actions/core/sources.ts` | `previewSource` maps parser output to the browser DTO; `addExclusion` gains a server-side preview for participant rules. |
| `components/wizard/new-handover-wizard.tsx` | Sends `participantLocalId` + `parseContext` instead of the hash triple. |
| `lib/mocks/**`, `/demo` | Mock types follow the DTO; demo behaviour unchanged. |
| `lib/parsers/**`, `lib/privacy/**` | No change (internal types unchanged). |
| Database, migrations, stored data | No change. |
| Cost | One extra in-memory preview parse per participant exclusion (≤ 25 MB, raw still present pre-parse). |
| Security tests | Add: preview response contains no 64-hex value; a forged or stale `participantLocalId`/`parseContext` is refused; exclusion hashes are always server-derived. |

## Owner decision requested
Approve R9-Q1 as written. Alternatively, keep the current shape as an accepted limitation, with previews
restricted to source managers. Until a decision is made, the current contract shape stays in place.
