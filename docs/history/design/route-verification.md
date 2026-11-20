# Route-by-route verification (Round 3 UI)

Owner: Agent 1 (UI/UX) writes the checks; the lead runs them on the single dev server and fills in
**Screenshot** and **Result**. One section per `app/**/page.tsx` (13 routes), plus the not-found and
error boundaries. Design reference: `docs/design/design-system.md`.

**How to run.** Use device emulation at **1440×900**, **1024×768** and **390×844**, light mode.
Use synthetic data only (CodeCell demo, local Supabase). For every route at every width, also check
the **global checks** below.

## Global checks (every route, every width)
| # | Check | Expected |
|---|---|---|
| G1 | Horizontal overflow (`document.documentElement.scrollWidth > innerWidth`) | `false`. Only tab strips, jump-link rows and code blocks scroll sideways. |
| G2 | Number of `h1` | Exactly 1. Headings go down in order (h1 → h2 → h3, no skipped levels). |
| G3 | Keyboard: Tab from the top | "Skip to content" appears first (workspace). Every control shows a visible focus ring, and nothing is unreachable. |
| G4 | Tap targets at 390 | Buttons, inputs, selects, chips and nav items are at least 40px tall. |
| G5 | Initial scroll position | The page opens at the top (header visible), with no auto-scroll on load. |
| G6 | `prefers-reduced-motion: reduce` (emulated) | Nothing slides or fades. Spinners still turn and skeleton pulses stop. |
| G7 | Contrast spot check (muted text, badges, Alerts) | Text is at least 4.5:1. Input borders are at least 3:1 against white. |
| G8 | Console | No hydration warnings, React key warnings or 404s for assets. |

Shell checks for every workspace route:
- **1440 and 1024:** the 240px paper sidebar shows Dashboard and New handover at the top, and Account and Sign out pinned to the bottom. The active item is a white pill with an indigo icon.
- **390:** a 56px translucent top bar shows the logo and a 40px menu button. The menu opens a left drawer with the same nav. Esc closes it, the drawer closes after a link is followed, and focus returns to the menu button.

---

## 1. `/` — Homepage (`app/(marketing)/page.tsx`)
- **Redesigned:**
  - The hero uses the `type-display` role, with `xl` CTAs ("Start a handover" primary, "Try the demo" outline).
  - An evidence-status explainer uses `StatusBadge`. Conflicting is now berry, not red.
  - Three numbered steps, a privacy band on the `bg-inverse` dark band, and a closing CTA.
  - Sticky translucent `SiteHeader`.
- **Components:** `SiteHeader`, `SiteFooter`, `FadeIn`, `ProductPreview`, `StatusBadge`, `buttonVariants`.
- **States:** static page. Error boundary: `app/(marketing)/error.tsx`.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | Hero grid has two columns (copy beside the preview). Four status explainers in one row. | The h1 wraps to 2–3 lines and both CTAs are visible above the fold. | | |
| 1024 | Hero still has two columns. The status grid has 4 columns. | No overflow, and the preview isn't clipped. | | |
| 390 | Single column with the preview under the copy. "Open workspace" is hidden from the header; Demo and Sign in stay. | The h1 is about 44px and both CTAs stack, each about 48px tall. | | |

## 2. `/demo` — Public demo (`app/(marketing)/demo/page.tsx`)
- **Redesigned:**
  - Header with eyebrow, h1, intro and "Start your own handover" (lg).
  - Shared `Tabs` (underline) for "Review workspace" and "Incoming handover". Arrow keys switch tabs.
  - The review is shown read-only, with a neutral `Alert` explaining demo mode.
  - The incoming view uses `PublishedHandoverView` in preview mode.
- **Components:** `DemoTabs` (`components/ui/tabs`), `ReviewWorkspace`, `PublishedHandoverView`, `WorkspaceSkeleton`.
- **States:**
  - Loading: `WorkspaceSkeleton` (`loading.tsx` and the Suspense fallback).
  - Unavailable data: a muted line saying so.
  - Error: the marketing `error.tsx`.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | **G5 (DEMO-SCROLL):** the hero and tabs are visible on load. The review has 3 panes (sections, points, evidence). | No auto-scroll. Pressing J then scrolls the selected card into view. | | |
| 1024 | The review has 2 panes; the "Evidence" button opens the right sheet. | The sheet is full height, Esc closes it, and focus returns. | | |
| 390 | Readiness collapses into a `<details>`. Filter chips wrap. The incoming tab shows mobile jump links. | No overflow, and point action buttons wrap. | | |

## 3. `/login` — Sign in (`app/(auth)/login/page.tsx`, presentation only)
- **Redesigned:** a raised sheet with a serif title, a 36/40px email field and a large submit button. The "sent" and error states are now `Alert`s (success and danger). The server action is unchanged.
- **Components:** `Input`, `Label`, `Button`, `Alert`.
- **States:**
  - Idle.
  - Sending: the button reads "Sending…" with `aria-busy`.
  - Sent: success Alert.
  - Error: danger Alert, linked to the input with `aria-describedby`.
  - `?error=auth_callback_failed`: danger Alert.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | Card is centred, about 384px wide, with the logo above. | One h1 ("Sign in to Baton"). | | |
| 1024 | Same layout. | — | | |
| 390 | The card fills the width with 16px gutters and the input is 40px tall. | Typing doesn't zoom (16px text). | | |

## 4. `/dashboard` — Your handovers (`app/(workspace)/dashboard/page.tsx`)
- **Redesigned:**
  - `PageHeader` with a primary "New handover" button.
  - **Drafts to finish:** a hairline list of `DraftRow`s showing last saved, sources saved, the next step with a 4-segment bar (md and up), Continue, and a discard icon (creator only, with confirm).
  - **Preparing and reviewing:** `HandoverCard` grid. Offers made to you and reviews sort first. Each card has a state badge, your role, a readiness bar and a CTA.
  - **Handed over to you:** card grid.
- **Components:** `PageHeader`, `SectionHeading`, `DraftRow`, `HandoverCard`, `HandoverStateBadge`, `DiscardDraftButton` (`ConfirmDialog`), `DashboardSkeleton`, `EmptyState`.
- **States:**
  - Loading: `DashboardSkeleton` (`loading.tsx` and Suspense).
  - Empty: "No handovers yet" with New handover and Explore the demo.
  - Error: `EmptyState tone="error"`, plus the workspace `error.tsx`.
  - Success: after discarding, a toast and the list refreshes.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | 3-column card grid. Draft rows show the next-step bar. | A long title wraps inside its card. Each card is a single link. | | |
| 1024 | 2-column grid. Sidebar visible. | — | | |
| 390 | Single column. Draft rows stack, with Continue and the 40px discard icon aligned right. | No overflow with a 120-character title. | | |

## 5. `/account` — Account (`app/(workspace)/account/page.tsx`)
- **Redesigned:** `PageHeader` at narrow width, a creatorship offers sheet, and account deletion as the danger section. Token sweep applied (danger text colour, type roles).
- **Components:** `PageHeader`, `CreatorOffers`, `AccountDeletion`, `ConfirmDialog`/`Dialog`, `ListSkeleton`.
- **States:**
  - Loading: `FormSkeleton` (`loading.tsx`) and `ListSkeleton` (Suspense).
  - Partial load error: an inline muted line for each failed block.
  - Deletion is blocked until the blockers are resolved; the destructive button is disabled.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | Column is 48rem and centred. | The danger action is a solid red button, inside a dialog with typed confirmation. | | |
| 1024 | Same. | — | | |
| 390 | Single column with 40px buttons. | — | | |

## 6. `/handover/new` — New handover wizard (`app/(workspace)/handover/new/page.tsx`)
- **Redesigned:**
  - **Header:** `PageHeader` with a back link.
  - **Stepper:** numbered with labels at sm and up, "Step n of 4" plus a bar below that. Completed steps are clickable.
  - **SaveIndicator:** unsaved, saving, "Draft saved · just now", couldn't save with Retry, or updated elsewhere.
  - **Details:** stay editable while a draft. Title, team, role and description autosave with a debounce, one save in flight at a time, and `expectedUpdatedAt`. The creator role is locked after creation.
  - **Consent:** checklist plus the group notice.
  - **Sources:** two drop zones and per-file rows with these phases: checking → uploading → verifying → consent → preview ("step n of 5"). Final states are Ready, Needs your answer (date order), Upload failed + Retry, Already added (duplicate_source), Too large, Empty file, and Not supported (including the confirm-time wrong type: "This file isn't a valid …"). A `.txt` toggle switches between Chat export and Plain text.
  - **Scope:** a sheet per source (dates, conversations, people, access level).
  - **Action bar:** sticky, and states why Continue is disabled.
- **Components:** `Stepper`, `SaveIndicator`, `Field`/`FieldGroup`, `ChoiceCard`, `NativeSelect`, `Alert`, `ConfirmDialog`, `SourcesStep`, `ScopeStep`, `MaskingTable`, `FormSkeleton`.
- **States:**
  - Loading: `FormSkeleton`.
  - Draft not found: 404.
  - Not a draft: redirects to processing.
  - Save error or conflict: shown in the indicator.
  - Upload problems: shown on each file row, plus a polite live-region announcement.
  - Success: "Processing started" toast, then the processing page.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | Full stepper with labels. Edit the title on an existing draft and wait about 1 second. | The indicator moves dirty → Saving… → "Draft saved · just now". Opening the same draft in a second tab and editing there shows "Updated elsewhere" and reloads the values. | | |
| 1024 | Drop zones side by side. File rows show actions on the right. | A 60-character file name truncates and has a title tooltip. | | |
| 390 | Stepper collapses to "Step n of 4" plus a bar. The sticky action bar sits at the bottom and doesn't cover focused fields (scroll-padding). | Back and Continue are 40px. After Continue, focus is on the new step heading. | | |

## 7. `/handover/[id]/processing` — Processing (`.../processing/page.tsx`)
- **Redesigned:**
  - **Run sheet:** a live eyebrow ("Live · updates every few seconds") and a section title for the state.
  - **Progress:** an overall bar and a stage list. A `partial` stage has its own icon, a warning border and the label "Partly done: some sources were skipped or failed".
  - **Failure:** a danger `Alert` with plain-language reasons. `db_schema_outdated` reads "Baton's database needs an update…"; `no_jobs` and other tokens are shown only as a reference.
  - **Retry:** a large "Try again" button.
  - **Aside:** one summary sheet with stats, sources (consent state) and masking counts.
- **Components:** `ProcessingView`, `Alert`, `ConsentChecklist`, `AccessBadge`, `ProcessingSkeleton`.
- **States:**
  - Loading: `ProcessingSkeleton`.
  - Not a reviewer: `EmptyState` "Processing is for reviewers".
  - Draft: "Ready to process" with consent.
  - Active: polls every 3 seconds.
  - Succeeded: Open the review and See knowledge gaps.
  - Failed, cancelled and partial: as described above.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | Run sheet beside a 22rem aside. | A partial stage is visibly amber and readable in the accessibility tree ("…: Partly done…"). | | |
| 1024 | The aside drops below the run sheet. | — | | |
| 390 | Single column. Stage counts stay on the right. | No overflow on long source titles. | | |

## 8. `/handover/[id]/review` — Review workspace (`.../review/page.tsx`)
- **Redesigned:**
  - **Rail:** each point card has a coloured rail for its evidence status.
  - **Conflicts:** a berry block, "Sources disagree · decide what is true now", with Supports and Contradicts columns.
  - **Gaps:** a dashed slate block, "Knowledge gap", with "Ask in Gap Interview".
  - **Key facts strip:** owner, due date and status, flagging Unassigned, No date and overdue.
  - **Actions:** Approve is a solid green button with a specific verb ("Resolve & approve", "Approve as gap"). Reject is a red outline. Edit is quiet. Decided cards show a pill and "Undo · reopen". Rejected cards are struck through.
  - **Evidence:** quotes are readable sans text. The PI-11 guard shows the notice "Possible instructions to an automated checker".
  - **Readiness panel:** blockers are clickable filters and there's a Publish button. A read-only banner (neutral `Alert`) shows when needed.
  - **Shortcuts:** J/K/A/E/R/?.
- **Components:** `ReviewWorkspace`, `PointCard`, `KeyFactsStrip`, `EvidenceQuote`, `PointDetailPanel`, `ReadinessPanel`, `ReviewDialogs`, `Dialog` (right sheet), `Kbd`, `WorkspaceSkeleton`.
- **States:**
  - Loading: `WorkspaceSkeleton`.
  - Not a reviewer: locked `EmptyState` with "Read the handover".
  - No points: `EmptyState` (processing, draft or none found).
  - Filters match nothing: inline `EmptyState` with "Clear filters".
  - Read-only: banner.
  - Success: toasts. Focus moves to the next pending point.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | 3 panes, with the evidence pane sticky. Approve a point with A. | The next pending point is selected, scrolled to and focused. On load the page doesn't scroll. | | |
| 1024 | 2 panes; "Evidence" opens the sheet. | The sheet's close button is 40px on touch widths. | | |
| 390 | Readiness sits in `<details>`. Card footer buttons wrap, all 40px. | Long quotes and URLs wrap. The key facts strip wraps. | | |

## 9. `/handover/[id]/gaps` — Gap Interview manager (`.../gaps/page.tsx`)
- **Redesigned:** a serif section heading and question sheets. Priority is a tag (Required = warning, Optional = neutral) and status is a pill (open = primary, answered = warning). All selects use `NativeSelect`. Answers show as left-ruled quotes (accepted = green rule).
- **Components:** `GapsManager`, `Badge`, `NativeSelect`, `Field`, `Dialog`, `ListSkeleton`.
- **States:**
  - Loading: `ListSkeleton`.
  - Empty: no questions.
  - Read-only once published (`canManage = false`).
  - Success: toasts after creating a link or accepting an answer.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | Question list at 72rem; ask form selects are 36px. | Priority and status are readable without relying on colour. | | |
| 1024 | Same. | — | | |
| 390 | Selects 40px; question sheets stack. | No overflow on long questions. | | |

## 10. `/handover/[id]/settings` — Handover settings (`.../settings/page.tsx`)
- **Redesigned:** groups separated by hairlines rather than a card each: Handover, Members, Access links, Sources, Privacy. Ownership and deletion move into a framed **Danger zone** (red border, red heading). All selects use `NativeSelect`.
- **Components:** `HandoverSettings`, `SectionHeading`, `HandoverStateBadge`, `AccessBadge`, `NativeSelect`, `ConfirmDialog`, `AccessLinks`, `ParticipantsPanel`, `FormSkeleton`.
- **States:**
  - Loading: `FormSkeleton`.
  - Role-limited: review-only blocks are hidden for other roles.
  - Offer to you: a primary-soft banner.
  - Success: toasts.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | Narrow column (48rem). The danger zone is clearly separated. | Exactly one h1 (the handover header); groups are h2. | | |
| 1024 | Same. | — | | |
| 390 | The invite form stacks; selects are 40px. The `dl` stacks to a single column. | No overflow on invite URLs (they wrap). | | |

## 11. `/handover/[id]/published` — Published handover (`.../published/page.tsx`)
- **Redesigned:** an editorial document. The title is an h2 under the page h1, followed by:
  1. Meta line and summary in `type-body-lg`.
  2. An **at a glance** strip: top sections plus open questions, linked.
  3. **Your first 7 days** checklist (ticks saved on this device only).
  4. Each section as **one hairline-divided sheet**, with a key facts strip per point. Open work shows a "N items · M unassigned" summary.
  5. **Open questions** in a dashed slate list.
  6. **Acknowledge** on the dark inverse band.
  - Desktop has a sticky "On this page" nav; mobile has jump links.
- **Components:** `PublishedHandoverView`, `KeyFactsStrip`, `EvidenceQuote`, `StatusBadge`, `OutdatedBadge`, `DocumentSkeleton`.
- **States:**
  - Loading: `DocumentSkeleton`.
  - Not published yet: `EmptyState`.
  - Not visible: 404.
  - Acknowledged: a confirmation band.
  - Non-incoming role or preview: an explanatory band.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | 13rem TOC beside the document. | Clicking a TOC link scrolls to the section with the heading fully visible. | | |
| 1024 | TOC visible (lg). | — | | |
| 390 | Jump links scroll sideways; the at-a-glance grid has 2 columns. "Show sources" is 40px. | No overflow with long assignee names (the key fact truncates and has a title). | | |

## 12. `/g/[token]` — Gap Interview (contributor, no account) (`app/(token)/g/[token]/page.tsx`)
- **Redesigned:** prose-width `PageHeader`. The intro asks for your name. One question per screen with a progress bar ("Question n of N"). The answer box is focused on arrival and described by the question. Then a review-and-send step and a thank-you state. Priority shows as a warning or neutral tag. Masking notice.
- **Components:** `SharedLinkShell`, `PageHeader`, `GapInterview`, `Badge`, `Textarea`, `EmptyState`, `DocumentSkeleton`/`ListSkeleton`.
- **States:**
  - Loading: skeleton.
  - Invalid or expired link: `EmptyState tone="error"`.
  - Nothing left: success state.
  - Submitted: "Thank you".
  - Drafts: kept in this browser until submitted.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | Column 42rem. The header says "Private link shared with you". | Exactly one h1. | | |
| 1024 | Same. | — | | |
| 390 | Buttons 40px; the textarea is full width. | Focus lands in the answer box on each question. | | |

## 13. `/h/[token]` — Handover invitation (`app/(token)/h/[token]/page.tsx`)
- **Redesigned:** an sr-only h1, "Handover invitation", and states shown as `EmptyState`s:
  - "You've been invited" with Email me a sign-in link.
  - "Check your email".
  - "Accept the invitation".
  - Errors (`tone="error"`): invalid, already a member, rate limited, internal.
- **Components:** `SharedLinkShell`, `EmptyState`, `Button`, `ListSkeleton`.
- **States:** loading skeleton, plus the states above. The server actions are unchanged.

| Width | Checks | Expected | Screenshot | Result |
|---|---|---|---|---|
| 1440 | Centred state with a dashed frame. | One h1 (sr-only); the state title is an h2. | | |
| 1024 | Same. | — | | |
| 390 | Single column; the action button is 40px. | — | | |

## Boundaries
| Boundary | Trigger | Expected | Screenshot | Result |
|---|---|---|---|---|
| `app/not-found.tsx` | `/does-not-exist` | Logo, "404" eyebrow, serif h1 "This page isn't here", buttons for the dashboard and home. | | |
| `app/(workspace)/error.tsx` | Throw in a workspace page (dev) | "Something went wrong on this page" with Try again (re-renders) and Back to dashboard. Shows a reference digest. | | |
| `app/(token)/error.tsx`, `app/(marketing)/error.tsx` | Same, in those groups | Same pattern, with home links. | | |
| `app/(auth)/error.tsx` | Throw in /login (dev) | Same pattern; home link. | | |
| `app/global-error.tsx` | Throw in the root layout (dev) | Own `<html>/<body>`, tokens loaded, serif "Something went wrong", Try again + Baton home, digest only (no raw message). | | |
