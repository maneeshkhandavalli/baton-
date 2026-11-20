# Research: document, editorial, knowledge and review interfaces (handover)

Owner: `handover`. Phase A. These are patterns to learn from, not things to copy. Third-party screenshots are not
committed. Each entry gives the product, the pattern, why it works, and how it maps onto Dossier ("B") and Baton's
real data (`PointDetail`, `EvidenceItem`, `SourceMessageContext`, `PublishedHandover`). I avoid colour, font and
component choices here, because those belong to `brand`. I name the job a treatment has to do instead.

The thread running through all of it is that Baton's output is a **document with provenance**. The best references
are not dashboards. They come from places where a claim and its source sit next to each other and a person signs
off: legal review, fact-checking, newsroom document annotation, academic citation, and government forms that
people finish over several sessions.

---

## 1. Evidence references: claim → quote → source

| Reference | Pattern | Why it works | Fit for Baton / Dossier |
|---|---|---|---|
| **NotebookLM** (Google), source-grounded answers. [support.google.com/notebooklm/answer/14276569](https://support.google.com/notebooklm/answer/14276569) | Inline numbered citations. Hovering shows the quoted text; clicking scrolls a source viewer to the passage and highlights it. | The citation is small in the prose, the quote is one hover away, and the full context is one click away. You never lose your place. | This is the closest match to Baton's job. Our `EvidenceQuote` already holds the quote. **The source viewer is missing**: `getSourceMessageContext(pointEvidenceId, {before, after})` exists in the read facade and no screen calls it (audit R-4). Plan: numbered evidence markers on a point. Clicking one opens the quoted message inside its surrounding messages, with the quoted message marked. |
| **Perplexity**, answers with numbered sources. [perplexity.ai](https://www.perplexity.ai) | Sources are a strip of small cards (title and domain) above the answer, with numbered superscripts in the text. | Readers see at a glance how many sources there are and how varied they are before they read. | The published point could show its **source spread**, for example "2 chats · 1 document · newest 12 Mar". Cheap to compute from `PublishedEvidenceItem[]`. |
| **Wikipedia**, Page Previews and the `[citation needed]` convention. [mediawiki.org/wiki/Page_Previews](https://www.mediawiki.org/wiki/Page_Previews) | Hovering a reference shows the citation without leaving the page. A missing citation is shown inline as an explicit, conventional marker. | The marker for "no source" is a visible, normal part of the text, not an error state. Readers learn to trust what is marked. | Baton's "missing" status works the same way: a gap is an honest label, not a failure. The published "Open questions" section is already right in spirit. A gap should read as a deliberate annotation, never as a broken card. |
| **Distill.pub**, footnote and citation hover cards. [distill.pub/guide](https://distill.pub/guide/) | Citations and footnotes open as hover cards. The bibliography stays at the end. | Editorial reading flow is kept, and the depth is still there. | Published handover: quotes stay collapsed behind "the quote behind this", as today. In Dossier they become **evidence slips**: archival cards with source, author, time and verification as monospace metadata. |
| **Elicit** (research assistant). [elicit.com](https://elicit.com) | Every extracted claim in a results table links to the supporting sentence in the paper. Claims and quotes sit in adjacent columns. | A table of claims with a quote column scans well for review work, where you check many claims quickly. | A **dense review mode** (the table view in plan §3.4): one row per point, with the lead quote truncated next to it. |

## 2. Side-by-side source previews

| Reference | Pattern | Why it works | Fit |
|---|---|---|---|
| **GitHub pull request review**. [docs.github.com/…/reviewing-proposed-changes-in-a-pull-request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request) | File tree, diff and comments side by side. A per-file "Viewed" checkbox, and a final review of Approve, Comment or Request changes. Resolved conversations collapse. | Progress is tracked per item ("Viewed"). The final decision is one deliberate act with a summary. Resolved threads stay in the record but stop shouting. | The review workspace already has three panes. Borrow: (a) **per-point progress** that survives filters, (b) **publish as a single review act with a summary**, as the publish dialog does today, (c) resolved conflicts collapse to one line with "resolved by X", expandable. |
| **Relativity** (legal e-discovery review). [relativity.com](https://www.relativity.com) | The document viewer is the centre pane, with a "coding" panel of decisions on the side, keyboard navigation to the next document, and redaction tools. | It is built for hours of fast, careful decision-making. The decision panel is always in the same place, and the next item loads without hunting. | Point review is a decision queue. The **decision bar** (Approve, Edit, Reject, Resolve) should always be in the same place, sticky in the detail pane, not repeated on every card. J/K and A/E/R already exist and are worth keeping. |
| **Hypothesis** (web annotation). [web.hypothes.is](https://web.hypothes.is) | Highlights in the text, and an annotation sidebar anchored to those highlights. Selecting one scrolls to the other. | A two-way link between the text and its notes. | Two-way linking between the point and its evidence in the review detail pane: selecting an evidence marker highlights the quote, and the source viewer scrolls to the quoted message. |
| **Readwise Reader**. [readwise.io/read](https://readwise.io/read) | A reading pane with a notebook sidebar of highlights. Keyboard-first. | A calm reading surface with a working surface next to it. | The published handover can offer **"Show sources in the margin"** on wide screens: evidence slips pinned beside each point instead of below it. |

## 3. Margin annotations and editorial layout

| Reference | Pattern | Why it works | Fit |
|---|---|---|---|
| **Gwern.net**, sidenotes and link popups. [gwern.net/sidenote](https://gwern.net/sidenote), [gwern.net/design](https://gwern.net/design) | Sidenotes in the margin on wide screens, falling back to footnotes or popovers on narrow ones. Popups for annotated links. | Reading flow and depth at the same time. The author's survey also records which approaches failed, for example block content in Tufte CSS sidenotes. | Margin evidence for the published report on screens of 1280 and wider; inline disclosure below that. Our evidence is block content (quote plus metadata), so we need a margin column in the grid, not inline floats. |
| **Tufte CSS**. [edwardtufte.github.io/tufte-css](https://edwardtufte.github.io/tufte-css/) | Margin notes, a wide text column, small caps for lead-ins. | The classic editorial reference. | Gives the type hierarchy of the published document: section eyebrow, point heading, statement, metadata. Brand decides the actual faces. |
| **DocumentCloud** (MuckRock), annotated public documents. [documentcloud.readthedocs.io/en/latest/annotations.html](https://documentcloud.readthedocs.io/en/latest/annotations.html) | Notes pinned to a region of a page, with private and public visibility. Newsrooms publish annotated source documents. | The **document is the primary object**, and notes are visibly secondary marks on it. Visibility, private or public, is part of each note. | Maps onto Baton's access levels. A per-evidence `AccessBadge` is a visibility mark on a document slip. Masked values and `[EXCLUDED_PARTICIPANT]` should read like **newsroom redactions**: deliberate, uniform, never "broken text". |
| **GOV.UK Design System**, typography and "summary list". [design-system.service.gov.uk/components/summary-list](https://design-system.service.gov.uk/components/summary-list/) | Key/value rows with a "Change" link per row. | It is the plainest way to show structured facts that you can correct. | Point attributes (owner, due date, decided by) as a summary list in the detail pane, with Edit beside them. The published document gets the same key facts, without Change. |

## 4. Review flows: verdicts, stamps, sign-off

| Reference | Pattern | Why it works | Fit |
|---|---|---|---|
| **PolitiFact Truth-O-Meter** and **Snopes ratings**. [politifact.com/article/2018/feb/12/principles-truth-o-meter-politifacts-methodology-i](https://www.politifact.com/article/2018/feb/12/principles-truth-o-meter-politifacts-methodology-i/), [snopes.com/fact-check-ratings](https://www.snopes.com/fact-check-ratings/) | A small fixed set of verdicts, each with a public definition, shown as a recognisable stamp next to the claim. | The definitions are published, so the stamp means something specific. Readers learn the vocabulary. | Baton's four evidence states (sourced, inferred, conflicting, missing) are exactly this. Dossier's **stamps for evidence states** should come with their definition one hover or tap away (`statusConfig.description` already holds it), and a short legend at the top of the published document. **Review state** (approved or rejected) must look different from evidence state: one is a reviewer's signature, the other a property of the evidence. |
| **X Community Notes**. [communitynotes.x.com/guide](https://communitynotes.x.com/guide/en/about/introduction) | A note is attached to a post only after raters with different perspectives agree. Shown as "Readers added context". | It shows *how* the context earned its place. | Inferred points: "Inferred · confirmed by Arjun on 12 Mar" already does this. Make the confirmation a visible signature, not grey small print. |
| **Google Docs, suggesting mode and version history**. [support.google.com/docs/answer/6033474](https://support.google.com/docs/answer/6033474) | Suggestions appear as tracked changes with accept and reject. Version history shows named versions and the differences between them. | Edits are reversible and attributable. | `PointDetail.revisions` already holds every revision. The detail pane can show **"Revision 2 of 2 · what changed"** as an inline difference between title and statement (old text struck through, new text marked), instead of the current list of struck-through titles. |
| **Linear**, triage and keyboard flow. [linear.app/docs/triage](https://linear.app/docs/triage) | A triage inbox, one item in focus, single-key decisions, and focus moves to the next item automatically. | Fast, calm, and you always know what is next. | `advanceFrom()` already moves to the next pending point. Add a visible "**3 of 14 to review**" counter in the decision bar, and a finishing state ("Everything reviewed, 2 blockers left") that points to the readiness gates. |
| **DocuSign**, signing ceremony. [docusign.com/products/electronic-signature](https://www.docusign.com/products/electronic-signature) | A guided path through required fields, a final "Finish", a certificate of completion. | The act feels formal and complete, and both sides get a record. | Acknowledgement: a deliberate, signed act at the end of the document, with a **receipt** (version, date, statement version `ACK_STATEMENT_VERSION`). In Dossier this is a signature block, not a dark marketing band. |

## 5. Multi-session forms and one-question interviews

| Reference | Pattern | Why it works | Fit |
|---|---|---|---|
| **GOV.UK "Complete multiple tasks"** (task list). [design-system.service.gov.uk/patterns/complete-multiple-tasks](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/) | One page lists each task with its status (Completed, In progress, Cannot start yet), for transactions people finish over several sessions. | It suits long jobs that people pause: you always see what is done and what is blocked. | Baton's wizard is exactly this kind of job (uploads, consent, opt-outs over days). Today's Stepper shows position, not status. Plan: a **task-list stepper** where each step shows done, needs attention or locked, with the reason. The same pattern fits **publish readiness**: each blocker is a task with a status and a "Go there" link. |
| **GOV.UK "Check answers"**. [design-system.service.gov.uk/patterns/check-answers](https://design-system.service.gov.uk/patterns/check-answers/) | Before you submit, a summary list of every answer with "Change" links. | It cuts errors and builds confidence before an irreversible step. | (a) Wizard: a **"Before processing" summary** listing sources, access levels, dates kept, people left out and masking counts, with Change links, before "Start processing" (which is irreversible). (b) Gap Interview: the review step already exists. Keep it and make it a proper check-answers list. |
| **GOV.UK "Question pages"**. [design-system.service.gov.uk/patterns/question-pages](https://design-system.service.gov.uk/patterns/question-pages/) | One thing per page, the question as the heading, and a Back link. | It suits people who did not ask to be here, like the Gap Interview's outgoing member, who has no account. | The current Gap Interview already does one question per screen. Keep it, and make the question the h1-level reading object. Show progress as text ("Question 2 of 5") as well as a bar. |
| **Typeform**. [typeform.com](https://www.typeform.com) | One question at a time, keyboard-first (Enter to continue), with smooth progress. | Low effort per step, so people get through it. | Borrow keyboard flow for the Gap Interview: Ctrl/Cmd+Enter for next, a visible Skip. Don't borrow the decorative full-bleed motion (D2, D6). |

## 6. Redaction and masked text

| Reference | Pattern | Fit |
|---|---|---|
| Newsroom and FOIA redaction conventions (DocumentCloud above; the US DOJ FOIA guidance on redaction labels, [justice.gov/oip](https://www.justice.gov/oip)) | A uniform redaction bar, often with an exemption code next to it, for example "(b)(6)". The code says *why* the text is hidden. | Baton's mask tokens are already typed (`[PHONE_1]`, `[EMAIL_2]`, `[PASSWORD]`). Dossier "redaction for masked text" should render a **typed redaction**: a bar plus a short monospace type label. The screen-reader text should read "masked phone number 1", not "left bracket PHONE underscore 1". The same number must render the same way everywhere, so readers can follow "the same phone" across quotes. `[EXCLUDED_PARTICIPANT]` is different: it marks a person removed at their request, and must never look like a mask (that rule is in `masked-text.tsx` today). |

## 7. What not to borrow

- Dashboard metrics as the hero: big KPI numbers for points or gaps (`Stat` with `text-4xl` serif numbers on the Gaps page). Dossier is a document. Counts belong in the margin or in metadata.
- Chat-style AI answers. Baton presents reviewed points, never a conversation (D7: "Ask the Handover" is a later, labelled preview).
- Gamified progress (rings, confetti). The readiness ring is informational and `score` never gates publishing (`ReadinessReport.score`). It should not look like a goal.
- Glassmorphism. The sticky wizard footer uses `backdrop-blur-md` today. D2 rules this out, so a solid surface replaces it.

## 8. Patterns I am proposing (summary for plan.md)

1. **Evidence slip** (the archival card for one quote): verbatim quote, then monospace metadata (author · time · source · location), a verification line (quote found word for word · supports the point), and an access mark. Variants: supports, contradicts, excluded, testimony (Gap Interview answer), redacted.
2. **Source viewer**: a side sheet or third pane showing `SourceMessageContext` (3 before and 3 after, expandable to 10), the quoted message marked, masked tokens as typed redactions, and "Earlier" and "Later" loaders when `hasMoreBefore` or `hasMoreAfter` is true. An `available: false` state ("The original message was removed").
3. **Evidence stamp** (evidence state), clearly separate from the **reviewer signature** (approved or rejected by whom and when).
4. **Conflict ledger**: two columns, Supports and Contradicts, each in time order and newest first. Sticky labels, no clamped quotes inside the resolve dialog, and a resolution note that becomes a signed annotation.
5. **Task-list stepper** for the wizard and for publish readiness.
6. **Check-answers summary** before Start processing and before Send (Gap Interview).
7. **Margin evidence** in the published report on wide screens.
8. **Signature block** for acknowledgement, with a receipt.

Sources checked during this research (Nov 2026): NotebookLM help (citations scroll the source viewer), GOV.UK
Design System (task list, check answers), gwern.net (sidenote survey, design graveyard), DocumentCloud docs (notes and
visibility). The other entries are well-established public products described at the level of their public behaviour.
