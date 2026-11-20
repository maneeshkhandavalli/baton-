# Dashboard v2 research (shell)

For the second pass of `/design/dashboard-preview`. The user's notes on v1: it reads as a conventional admin
dashboard, the content is too narrow, the sidebar is cluttered, and "Needs your attention" should be the clear focal
point. They want more variety than cards and tables, and a Baton identity that links to the landing page.

Method: I opened the public product and docs pages in headless Chrome at 1440 and looked at the product UI they show,
and read the products' docs on the behaviour they describe. Screenshots are kept for reference only in
`.claude/ui3/shots/shell/refs/`, which is git-ignored and never committed (the repository is public). Dashboards behind
a sign-in were not opened.

---

## Linear: Inbox, Triage, sidebar
Sources: <https://linear.app/> (hero product shot), <https://linear.app/docs/inbox>, <https://linear.app/docs/triage>,
<https://linear.app/changelog/2026-03-12-ui-refresh>. Refs: `refs/linear_home_0.jpg`, `refs/linear_triage_0.jpg`.

- **Pattern.**
  - **Sidebar:** a short personal group at the top (Inbox, My issues, Reviews), then labelled groups ("Workspace",
    "Favorites") in muted 12px labels, with icons in one stroke weight and no boxes.
  - **Triage:** a dedicated queue where each row has a title, a source line underneath and a mono ID with a time on the
    right.
  - **Leaving the queue:** an item leaves through explicit actions (Accept `1`, Decline `2`, Duplicate `3`, Snooze `H`).
  - **Inbox:** keyboard-first: `J`/`K` to move, `G` then `I` to open it, a Priority tab separating "needs your
    attention" from other updates, and opening an item shows its detail with the actions beside it.
  - **Issue view:** the main column is the record; a quiet properties column on the right lists key/value rows
    (status, priority, assignee, cycle) with status icons.
- **Why it works.** One queue answers "what do I owe?". Rows are dense but calm, because hierarchy comes from weight
  and grey levels, not containers. A selected item puts its detail beside the list, so you never lose your place.
  Keyboard hints make the speed discoverable.
- **Baton adaptation.**
  - "Needs your attention" becomes a **split list + detail**. The queue on the left is navigable with `J`/`K`/arrow
    keys; the detail on the right shows the selected handover's stage, key/value rows (your role, people, updated) and
    the one action.
  - The sidebar becomes a short personal group (Overview, Needs you) plus a "Stages" group with stage glyphs.
  - The `/` key focuses search, with a visible key hint.
- **Don't copy.** The near-black theme, the purple accent, the issue-ID culture (Baton has no IDs worth showing), and
  snooze/archive features we don't have. No invented actions: the queue empties by doing the work.

## Vercel: overview, project rows, activity, sidebar navigation
Sources: <https://vercel.com/blog/dashboard-redesign> (product shots of the overview),
<https://vercel.com/changelog/dashboard-navigation-redesign-rollout>, <https://vercel.com/changelog/improved-team-overview-page>.
Refs: `refs/vercel_redesign_0.jpg`, `refs/vercel_redesign_900.jpg`.

- **Pattern.**
  - **Overview:** project rows on the left; each states its production status (dot), domain, branch and age in small
    metadata.
  - **Recent Activity:** a separate right-hand column of one-line events ("evilrabbit deleted project …", "2h").
  - **Navigation:** the 2026 redesign moved navigation into a resizable, hideable sidebar with the same items at team
    and project level, reordered so the most common workflows come first, and a floating bottom bar on mobile.
  - **Surfaces:** quiet hairline surfaces with very little colour; status is a dot and a word.
- **Why it works.** The main column holds the things you act on and the side column holds what happened, so the two
  never compete. A row carries exactly the facts needed to decide whether to open it.
- **Baton adaptation.**
  - The wide right rail holds **Resume** and a **day-grouped activity timeline** (Today / Yesterday / Earlier).
  - Library rows carry stage, "where it is", people and age.
  - Status is a **stage glyph plus a word**, never colour alone.
- **Don't copy.** The monochrome black/white brand, deployment vocabulary, and screenshot thumbnails (handovers have no
  visual preview).

## Raycast: command list + detail
Source: <https://www.raycast.com/>. Ref: `refs/raycast_900.jpg`.

- **Pattern.** A filter field on top, a grouped list on the left ("Today"), and a detail pane on the right that changes
  with the selection. A type filter sits in the search row.
- **Why it works.** Filtering and choosing happen in one compact place, and the detail pane makes the list skimmable.
- **Baton adaptation.**
  - The Library toolbar puts search, the side switch and status chips in one row.
  - Library groups are labelled by stage ("In review · 2") like Raycast's day groups.
  - The same list/detail idea drives the attention queue.
- **Don't copy.** The launcher/overlay model and the dark glassy chrome.

## Attio: records with properties
Source: <https://attio.com/>. Ref: `refs/attio_900.jpg`.

- **Pattern.** Records are rows in a light, gridded workspace; a record opens to key/value attribute rows. The marketing
  site uses a fine background grid to signal "structured data".
- **Baton adaptation.**
  - Key/value rows in the attention detail and the Resume block.
  - The landing page's fine grid (brand variant A) appears **only in the page header band** as a quiet link to the
    landing, never behind dense rows.
- **Don't copy.** The blue accent, AI-chat surfaces, and the CRM spreadsheet density.

## Baton landing, brand variant A (internal reference)
Ref: `.claude/ui3/shots/brand/variant-a/_va-1440.jpg`.

- **Takeaways.**
  - Linen background with a fine grid in the hero.
  - Bold Schibsted headings.
  - Petrol pill buttons.
  - Hairline cards.
  - Mono `↳ Core Team 26-27 · line 15` source references.
  - The "tide" stage scale.
- **Dashboard adaptation.**
  - Schibsted for the typographic summary and section titles.
  - The `↳` motif marks *where an item leads* (`↳ In review · CodeCell`) without inventing source data the queries
    don't return on the dashboard.
  - Petrol is the only interactive colour.
  - The grid lives in the header band only.
  - Clay stays out of the app.

---

## Decisions for v2 (composition, not colour)
1. **Fluid width.** The main column has no 72rem cap. It grows to 1760px with a fixed-width right rail (360px at xl,
   400px at 2xl).
2. **Typographic summary in place of a page title.** A large Schibsted sentence ("7 things need you") with the number in
   petrol, a plain-language breakdown, and a **stage strip** (counts per stage that act as filters).
3. **Attention as split list + detail** (Linear/Raycast): the focal block, keyboard-navigable, with the detail panel
   animating between items. On mobile the detail expands inline.
4. **Library as a grouped list** with stage group headers (Raycast/Vercel), not a flat table. Toolbar filters animate
   rows in and out.
5. **Right rail:** Resume (key/value), then the activity timeline grouped by day (Vercel).
6. **Sidebar:** two labelled groups (Workspace, Stages) plus open handovers, identity at the foot, and nothing boxed
   except the primary button.
7. **Motion:** hover reveals, detail cross-fade, filter add/remove, all off under reduced motion (framer-motion's
   `useReducedMotion` plus the CSS rule).
