# handover status

**User direction (2026-11-15): Dossier is NOT approved.** brand is building landing variants A and B, and shell a redesigned dashboard preview. My current job: screenshot them, send brand and shell feedback on how my document surfaces fit each direction, and add a direction-agnostic "mapping to the new direction" section to plan.md. The user's cast: Priya Raman hands over to Neha Kulkarni. My Phase A P0s still stand.

**Phase A complete** (2026-11-15). No code was edited. Waiting for brand's response to my Checkpoint A review, then for Checkpoint B.

| Item | State |
|---|---|
| `audit.md`: full workflow audit, finding IDs, the actions and queries each screen uses | Done |
| `research.md`: document, editorial and review patterns mapped to Dossier | Done |
| `plan.md`: P0s first, then report IA, evidence slip and source viewer, review and conflict UX, privacy review, wizard (5 steps), Gaps and Gap Interview, publish and ack, states, accessibility, tests, files, brand requests, risks | Done |
| `requests.md`: ownership and approvals (1–3 ruled by lead), MaskedText and stamps (brand) | Done |
| `review-design-system.md`: Checkpoint A, approve with changes (A1–A11, B1–B9) | Sent to brand (cc main) |
| Screenshots `.claude/ui3/shots/handover/` (+ `spec/` for brand's specimen) | Done |

## Phase C order (once the design system is approved)
1. P0: privacy-review flow (resolve_privacy_review) plus working gates. P0: the pure ProcessingStatusView, so the preview never calls continueProcessing.
2. Demo seams (view/connected split, action interfaces, `data-tour` anchors, `startRevision?` in ReviewActions).
3. Rebase on shell's `handoverNav` move, then role- and state-aware tabs and `[id]/error.tsx`.
4. Source viewer (approved read-only server function) and evidence slip.
5. Review layout, decision bar, conflict ledger. Then wizard step 5. Then published dossier, ack signature block, print. Then Gaps and Gap Interview. Then Settings.

## Coordination log
- `demo`: reuse contract agreed (plan §9), and `startRevision?` added to ReviewActions with a "Start a revision" affordance in the review.
- `shell`: H-1 to H-7 agreed. `PageBand`, `WIZARD_STEPS` from `components/wizard/steps.ts`, `SignInOptions`, a collapsible sidebar rail on review and processing. Shell moves `handoverNav` in its first Phase C commit and sends me the hash.
- `main`: rulings D8/D9 applied (gap-interview is mine; `config/handover-navigation.ts` becomes mine after shell's move; `config/status.ts` goes to brand; source-context function approved for Phase C).
- `brand` answered every item in `collab/brand/review-responses.md` (8f401c2). A1, A2, A4, A5 and A7 are resolved (sans quotes, quiet redaction by default, signature block, decision-bar spec, document layout), A11 warning was darkened, and B1–B9 are specified. I accepted, with one non-blocking note: the inserted-text diff mark must not look like a link.
- `brand`: Checkpoint A review sent. Blocking items for my visuals: A1 (mono quotes), A2 (redaction loudness), A4 (ack signature block), A5 (decision bar), A7 (document layout width).
