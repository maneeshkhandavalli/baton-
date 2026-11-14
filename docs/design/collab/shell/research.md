# Shell research: dashboard and application UI (Phase A)

Author: `shell`. Purpose: patterns, not looks. Each entry names the product, a public URL, the pattern worth taking, and
how it would translate into Dossier (cream/parchment, ink, editorial serif, restrained cobalt, monospace metadata,
archival document cards) without copying. Third-party screenshots are not stored in the repo (public repository).
Visual choices stay with `brand`; this note describes structure and behaviour.

## What Baton's dashboard actually has to do
A user has few handovers (a club lead: one per role per term; a coordinator: a few dozen), each moving through
`draft → processing → in_review → approved → acknowledged`, from one of two sides: **preparing** (outgoing/reviewer)
or **receiving** (incoming/lead). The question on arrival is almost always "what needs me now, and where did I leave
off?", rarely "show me everything". So the reference set is triage tools and document registers, not analytics.

---

## 1. Attention first: triage inboxes

**Linear: Inbox / My Issues and the 2026 refresh**
<https://linear.app/changelog/2024-03-20-new-linear-ui> · <https://linear.app/changelog/2026-03-12-ui-refresh> ·
<https://linear.app/now/behind-the-latest-design-refresh>
- Pattern: dense single-line rows grouped under quiet headers; hierarchy from type weight and a few status glyphs
  rather than boxes. The 2026 write-up is explicit about keeping density while calming the chrome (softer borders,
  subtler separation in dark). Personal views ("My issues") are grouped by what's next, each keeps its own filter.
- For Baton: the handover list as **rows, not cards**, grouped by what the viewer must do. Dossier version: rows read
  like entries in a case register, title in the serif, team/role/dates in monospace metadata, state as a small
  stamped label; cobalt only on the one row action that matters.

**Readwise Reader: Library "Triage" (Inbox → Later → Archive)**
<https://docs.readwise.io/reader/guides/workflows/library-configuration>
- Pattern: every item has exactly one location; the default view is the part you have to deal with; finished items
  move out of the way but stay one click away.
- For Baton: "Needs you" at the top, "In progress" below, "Done" (approved/acknowledged) collapsed or on a tab. A
  finished handover should look archived (filed), not compete with live work.

**Mercury (banking): exception-first home**
<https://www.925studios.co/blog/mercury-design-breakdown> (third-party breakdown)
- Pattern: state first, controls second; show what needs attention, keep what is on track quiet; one accent per area.
- For Baton: a short "needs you" summary line or strip ("2 conflicts to resolve in CodeCell · 1 offer waiting") built
  from `ReadinessReport.blockers`, then the list. Restraint fits Dossier's single cobalt accent.

## 2. Where every item stands: progress without fake precision

**Basecamp: Lineup, Hill Charts, Home**
<https://basecamp.com/features/lineup> · <https://basecamp.com/features/hill-charts> ·
<https://updates.37signals.com/post/preview-the-all-new-home-screen>
- Pattern: Lineup shows every project's position on one timeline; Hill Charts separate "figuring it out" from
  "getting it done" instead of a single %; Home is about *your* assignments, not the whole account.
- For Baton: replace the readiness % bar (informational, never gates publishing) with the **stage the handover is
  in** plus the concrete blockers ("3 to review · 1 conflict · 1 required gap"). A five-stop stage track
  (Draft · Processing · Review · Published · Acknowledged) reads like a document's routing slip, which suits Dossier
  better than a progress bar.

**GOV.UK Design System: Task list, Summary list**
<https://design-system.service.gov.uk/components/task-list> · <https://design-system.service.gov.uk/components/summary-list/>
- Pattern: task list = named steps with a status each ("Completed / In progress / Cannot start yet"); summary list =
  key/value rows with a per-row "Change" action; both are plain, highly accessible and tested at scale.
- For Baton: draft rows say the next named step rather than a 4-segment bar; Account details become a summary list
  (Email · Sign-in methods · Created · Last sign-in, each with its action). Dossier: this is literally a record card,
  label in small caps/mono, value in text, action at the right edge.

## 3. Document registers: lists of formal documents with lifecycle

**Ironclad: unified Dashboard + Repository (April 2025)**
<https://support.ironcladapp.com/hc/en-us/articles/30794550432151-Ironclad-s-New-Dashboard-and-Workflow-Page-Overview-April-2025-Release>
**Juro: contract dashboard and table views**
<https://juro.com/learn/contract-dashboard> · <https://intercom.help/juro/en/articles/5653144-using-table-views-to-manage-contracts>
- Pattern: one place for "in flight" and "signed" documents; saved views; table view with sortable columns
  (stage, owner, counterparty, dates); Juro also offers a stage board.
- For Baton: when the list grows, the same rows switch to a **table density** (Title · Team · Your role · Stage ·
  Needs · Updated) with sort, plus a filter by side (Preparing / Receiving) and team. No Kanban: five states and few
  items do not justify a board. Dossier: a ruled ledger, hairline rules, mono column headers, tabular numerals.

## 4. Calm, editorial application chrome

**Things 3 (Cultured Code)**
<https://apps.apple.com/app/id904280696> · <https://blakecrosley.com/blog/design-study-things>
- Pattern: a sidebar that is mostly whitespace and type; "Today" shows only what matters now; the trade-off (less
  info at a glance) is real and noted by reviewers.
- For Baton: a quiet sidebar is right, but it must earn its space (audit S2): **recent/open handovers** listed by
  title so the user can jump between them and see where they are inside one.

**Are.na**
<https://www.are.na/editorial/interface> · <https://ixd.prattsi.org/2026/02/design-critique-are-na-ios-app-2/>
- Pattern: ascetic interface, content at a human pace, metadata in small type, very little chrome.
- For Baton: the archival/collection feel for the "Handed over to you" shelf: received handovers as filed documents
  you return to, with provenance (who handed it over, when, version) in mono metadata.

**GitHub Primer: PageHeader, UnderlineNav, Blankslate (empty states)**
<https://primer.style/components/page-header> · <https://primer.style/components/underline-nav> ·
<https://primer.style/product/components/blankslate/guidelines> · <https://primer.style/ui-patterns/navigation>
- Pattern: strict landmark rules (one nav landmark per nav, PageHeader title heading level set explicitly);
  UnderlineNav when the tab changes the URL; empty states explain *why* it is empty and offer one action.
- For Baton: rules for the shell, the handover tabs and every empty state; one primary action per empty state
  (audit S4).

## 5. Theme behaviour

**web.dev: `color-scheme` and `prefers-color-scheme`; MDN**
<https://web.dev/color-scheme/> · <https://web.dev/prefers-color-scheme> · <https://web.dev/learn/design/theming> ·
<https://developer.mozilla.org/docs/Web/CSS/@media/prefers-color-scheme>
- Pattern: declare `color-scheme: light dark` and media-query `theme-color` so the browser canvas, scrollbars and
  form controls are right before any script; follow the OS by default; an explicit choice overrides and is
  remembered; listen for OS changes while in System mode.
- For Baton: three-way **Light / Dark / System** (System default for new visitors is a product decision for the user;
  see plan). Keep the existing blocking script and tests, extend them for `system`.

---

## Synthesis for Dossier
1. **Register, not grid.** Handovers are entries in a ledger: rows with mono metadata, serif titles, a stamped stage
   label; cards are reserved for the one object you are acting on (a draft you resume, an offer you answer).
2. **Needs you first, filed last.** Group by what the viewer must do; approved/acknowledged items are filed and quiet.
3. **Stage + blockers instead of %.** Routing-slip stage track and plain blocker counts from data we already fetch.
4. **A sidebar that orients.** Primary destinations, recent handovers, and identity at the foot; inside a handover the
   sidebar shows which one you are in.
5. **Record cards for settings.** Summary-list rows with per-row actions; the destructive section is visually
   separated like a sealed annex, not a fourth equal card.
6. **Designed dark.** Enough surface steps that rows, sheets and sidebar stay distinct (brand's call on values).
