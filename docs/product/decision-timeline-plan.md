# Decision timeline: build plan (2026-11-20)

Status: PLAN, to be audited before building. Owner approved building it (hackathon Round 3, partial delivery of the
Round 1 commitment "GitHub + decision timeline").

## Goal

A read-only **Timeline** tab on every published handover that lists the published points in the order things
happened, using the date of the message each point cites. Every row links back to its evidence. GitHub, Telegram,
Slack and Discord sources appear automatically, because connector imports are ordinary sources whose evidence carries
`sentAt`.

Non-goals tonight: new database tables, migrations, queries, server actions or AI calls; editing points from the
timeline; GitHub-specific UI.

## Why this is low risk

| Concern | Answer |
|---|---|
| Data | `queries.getPublishedHandover(id)` already returns `PublishedHandover` (lib/contracts/dto.ts:458): `sections[].points[].content.evidence[]` with `sentAt`, `authorLabel`, `sourceTitle`, `stance`, `kind`. |
| Access | The query is RLS-filtered by clearance (§8.4, §8.5), so the timeline shows exactly what the Published tab shows to the same viewer. No new access path. |
| Redaction | `PublishedEvidenceItem` with `redacted: true` has no date or text; `content.textRedacted` hides text. The timeline must reuse the published view's handling. |
| AI | None. Pure function plus presentational components. |

## Data rules: `buildTimeline(handover: PublishedHandover): TimelineModel` (pure, unit-tested)

1. One entry per published point (no duplication across dates).
2. **Anchor date** = earliest `sentAt` among the point's NON-redacted evidence (both `source_quote` and `testimony`).
   That is when the thing was first said. Also keep `lastSeenAt` = the latest such `sentAt`.
3. Points with no dated evidence go in a final **Undated** group (e.g. testimony without `sentAt`, all-redacted
   evidence). Never invent a date.
4. Category-specific dates are shown as labels, never used for sorting unless noted:
   - `open_task.dueDate` (ISO date) → "Due {date}" badge;
   - `decision.decidedAt`, `next_action.byWhen`, `owner.since`, `recurring_problem.firstSeenAt` are FREE TEXT, so
     they are shown as text and never parsed.
5. **Change signals** on an entry:
   - `evidenceStatus === "conflicting"` or any `stance === "contradicts"` evidence → "Conflicting" marker that lists
     the dates of the supporting and contradicting evidence;
   - `conflictResolution` → show the resolution note, who resolved it and when;
   - `isPotentiallyOutdated` → the existing `OutdatedBadge`.
6. Ordering: ascending by anchor date. Ties are broken by section order (`HANDOVER_SECTIONS`), then point id, so the
   order is stable.
7. Grouping: by calendar month of the anchor date, labelled like "March 2026".
8. Timezone: format every date with the SAME helper and timezone on server and client (check
   `components/handover/format.ts formatDate`), so there is no hydration mismatch. Use `<time dateTime>`.

## UI (follow docs/design/design-system.md; minimal app style, not the landing style)

```
 Timeline                                  [All] [Decisions] [Tasks] [Risks] [People & access]
 ──────────────────────────────────────────────────────────────────────────────
  MARCH 2026
   ●  3 Mar   Decision   Hackathon venue is Lab 2            Sourced   📎 WhatsApp export · [PERSON_2]
   │                                                                    ▸ Show evidence (2)
   ●  10 Mar  Open task  Pay sponsor deposit · Due 15 Mar    Sourced   📎 Telegram · [PERSON_1]
  APRIL 2026
   ◆  2 Apr   Decision   Venue moved to Auditorium           Conflicting  ↳ contradicts evidence from 3 Mar
  UNDATED
   ○  —       Contact    Lab technician                      Inferred
```

- **Files (proposed):**
  - `app/(workspace)/handover/[id]/timeline/page.tsx`: server page, copy of the published page's structure
    (Suspense, `connection()`, `getHandover`, "Not published yet" EmptyState, `notFound` on error).
  - `components/timeline/build-timeline.ts`: the pure model (rules above).
  - `components/timeline/handover-timeline.tsx`: a presentational client component taking `PublishedHandover`. It
    holds the filter state, reuses `categoryLabel`, `StatusBadge`, `OutdatedBadge`, `MaskedText` and `EvidenceQuote`,
    and renders people through the existing `PeopleProvider` tokens.
  - `components/timeline/__tests__/build-timeline.test.ts`: node:test, same conventions as other `test:ui` tests.
- **Navigation:** add `timeline` to `lib/routes.ts` (`routes.handover.timeline`). Add
  `{ title: "Timeline", href: routes.handover.timeline, reviewOnly: false }` after "Published" in
  `config/handover-navigation.ts`. Update `components/layout/__tests__/handover-nav-roles.test.ts`.
- **Demo (judges without an account):** render `<HandoverTimeline>` in the demo's published step
  (`components/demo/demo-screens.tsx`, around the published view) as a "Timeline" toggle or section, using the demo
  engine's `view.published`. First check that the demo data has `sentAt` values. If not, the demo shows the Undated
  group only, and that is reported, not faked.
- **Filters:** client-side buttons with `aria-pressed`. "All" is the default. Category groups map onto
  `POINT_CATEGORIES`: Decisions = decision; Tasks = open_task, next_action, blocker, dependency; Risks = risk,
  recurring_problem; People & access = owner, contact, account_access.
- **Accessibility:** an `<ol>` per month, a heading per month, `<time>` elements, keyboard-reachable disclosure for
  the evidence, visible focus, no information carried by colour alone, no motion (or respect
  `prefers-reduced-motion`), and a 390px layout with no horizontal scroll.

## Tests and verification

1. Unit tests for `buildTimeline`:
   - ordering and stable ties;
   - earliest-date anchor;
   - Undated group;
   - redacted evidence ignored for dates and never rendered;
   - `textRedacted`;
   - conflicting with both stances;
   - `dueDate` label;
   - month grouping across a year boundary;
   - empty sections.
2. Run `npm run typecheck`, `lint`, `test:ui`, `test:contracts` and the nav-roles test, and report exact counts.
3. Browser check on http://localhost:3110 (running dev server, isolated stack): open the published Telegram QA
   handover ("R4 Telegram QA treasurer", publication v2, 13 points) as the creator and as the incoming member. The
   incoming member must see no more than the Published tab shows. Also check `/demo/workspace` at the published step,
   at 1440px and 390px. Screenshots go in `docs/review/timeline/` (local files only).
4. Docs: one line in `docs/README.md`. The Round 3 commitments table in `docs/submission/SUBMISSION.md` marks the
   timeline as delivered and the GitHub part as "connector built, not verified live".

## Delivery

Build on its own worktree and branch (`work/timeline`, from `work/r4-ai-recovery` HEAD), commit locally, then the
orchestrator reviews and merges. Estimate: about 90 minutes. No push or deploy by the builder.

## Open questions for the audit

- Does any existing helper already sort evidence by date or format month headings?
- Does `getPublishedHandover` include testimony evidence `sentAt`?
- Does the incoming-member path (`/h/[token]`, read-only successor link) also need a timeline? (Proposed: no.)
- Is `PeopleProvider` required around the timeline for person tokens, as in the handover layout?

## Audit amendments (2026-11-20, verdict GO WITH CHANGES; these OVERRIDE the sections above)

1. **Tests must run:** `test:ui` (package.json:14) globs fixed directories. Put the `buildTimeline` test in a directory the glob already covers (e.g. `components/shared/__tests__/`), or add the new dir to the glob. Use the `resolve-ui.mjs` runner like neighbouring tests.
2. **Nav test:** `components/layout/__tests__/handover-nav-roles.test.ts` lines 16-17 expect `["Published"]` for incoming/lead; update to `["Published","Timeline"]`.
3. **Determinism:** extend `tests/integration/r3-render-determinism.test.ts` (renders in four time zones; no block element inside `<p>`) to cover the timeline, including midnight-IST edge cases.
4. **Dates:** `components/handover/format.ts` is fixed to Asia/Kolkata (private `zoned()`). ADD exported `monthKey(iso)` and `formatMonthYear(iso)` built on `zoned()`. Never use `slice(0,7)` or `toLocale*`. Sort by `Date.parse`, not string compare. Rows: `formatShortDate`; dueDate: `formatDate`; `<time title>`: `formatDateTime`.
5. **Known gaps:** points with `isKnownGap` are "Open questions" in the published view. Exclude them from the dated timeline, or show them in their own "Open questions" group (preferred: their own group at the end, before Undated).
6. **Anchor = earliest `supports`-stance non-redacted evidence.** Contradicting evidence dates are shown only as markers, never as the anchor. If a point has only contradicting dated evidence, it goes to Undated with the marker.
7. **No "links":** evidence is an in-row disclosure reusing `EvidenceQuote` (lazy render, as the published view does). There is no deep-link route.
8. **Demo placement:** in `ReceiveScreen` (`components/demo/demo-screens.tsx` ~288-320), inside the `rounded-2xl` card, as a sibling AFTER `<PublishedHandoverView … />`. Do not modify `PublishedHandoverView`, `PublishScreen`, `data-tour` anchors or `demo-guide.ts`. Re-run `demo-ui.test.ts`. Expect some Undated rows (document quotes and the v2 link have `sentAt: null`); that is correct.
9. **Design system:** no emoji (lucide icons only). Conflicting uses the berry `status-conflicting*` tokens. Month headings are h3 with `type-eyebrow` styling under the page's h2. Mobile targets `max-sm:h-10`. Filters use the `Tabs` segmented variant (or extract the private `FilterChip` from components/review). Group filters via `HANDOVER_SECTIONS` rather than hand-written maps.
10. **Page:** mirror `published/page.tsx` exactly: sync default export, async child in `<Suspense>`, `await connection()` after params, `metadata`, `PageProps<"/handover/[id]/timeline">`. Run `getHandover` and `getPublishedHandover` in parallel. Do NOT add `PublishedOpenedSignal`. No `PeopleProvider` needed (the layout supplies it; the demo falls back to "Person n").
11. **Redaction:** render `content.title`/`statement` through `MaskedText` (the privacy SQL already replaces redacted text). Filter `evidence.filter(e => !e.redacted)` and show the same "Some evidence was removed at a participant's request." note when `evidenceRedacted`.
No change needed: `proxy.ts` (protects `/handover/*`), the layout, `published-handover-view.tsx`, SQL or queries.

## Build notes (2026-11-20, branch `work/timeline`)

Built as amended. Where the build differs from the earlier sections:

- **Due dates and free-text dates** use the existing key-facts strip (`keyFacts` + `KeyFactsStrip`, as in the published view): "Due 15 Mar 2026" comes from `formatDate`, and `decidedAt`, `byWhen`, `since` are shown as written. `recurring_problem.firstSeenAt` is added to the strip as "First seen" (text, never parsed). No date in a category attribute orders anything.
- **Filters** are the `Tabs` segmented variant with one panel per filter (only the active one is mounted), labelled by `HANDOVER_SECTIONS` with counts, and shown only when the publication spans two or more sections.
- **Conflicts** show "Sources disagree" with the supporting and contradicting dates, and the resolution note when there is one. A point with only contradicting dated evidence is Undated with the marker (amendment 6).
- **Open questions** (known gaps) have their own group after the months and before Undated (amendment 5).
- **Tests:** `components/timeline/__tests__/build-timeline.test.ts` (added to the `test:ui` glob) and a render smoke in `tests/integration/r3-render-determinism.test.ts` (four time zones, midnight IST, every kind of point).
