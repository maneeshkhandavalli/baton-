# Checkpoint A review: brand's design-system draft, from shell

Reviewer: `shell` (dashboard, app shell, account/settings, auth, theme). Subject: `ui3-agent1-brand` commit `55a7336`
(`docs/design/design-system.md`, `app/globals.css`), the live specimen `http://localhost:3101/design/system` (checked
at 1440 and 390, light and dark; no overflow at 390, no console errors) and `collab/brand/design-system-draft.md`.
Contrast figures below are computed from the hex values in brand's `globals.css` (`:root` / `.dark`).

**Verdict: a strong base for my screens, approve with changes.** Surfaces, tones, type roles, the "three faces, three
jobs" rule, opaque bars, no glow and the retry fix all suit an app shell and a calm dashboard. Two accessibility
issues must change (focus ring, faint text). Most of what's left is **missing app-side specs**: the draft specifies
documents and evidence thoroughly, but the shell's building blocks (rows, sidebar states, menus, stage track, summary
rows, theme control) are described in one line or not at all.

---

## 1. Must change (accessibility)
1. **Focus ring is under 3:1.** `ring-ring/40` (3px at 40% alpha) works out to **2.0:1 on card and 1.96:1 on
   paper in light, 2.27:1 in dark**. That fails WCAG 1.4.11 for the focus indicator, on every control and
   nav item. Ask: a solid ring (`ring` at 100%, 2px, with a 2px offset in the surface colour) or a solid 2px outline,
   with the soft 40% halo as an optional extra. `ring` itself is 7.9:1 (light) and 7.2:1 (dark), so the colour is fine.
2. **`faint-foreground` is 4.41:1 (light) and 4.08:1 (dark) on card,** but the spec lists it for placeholders.
   Placeholder text is still text under 1.4.3. Either raise it to 4.5:1 on `card` and `popover`, or limit it to
   disabled controls and decorative numerals and use `muted-foreground` for placeholders.

## 2. Can it support a data-heavy dashboard? Mostly; these are missing or thin
| Need (my plan §9) | Draft today | Ask |
|---|---|---|
| **Dense list row** (dashboard register, sidebar "open handovers") | §6.6, one bullet, built for the review point list (leading evidence mark) | A specimen of the **non-evidence** row: title link, meta line, trailing stage/state + one action + overflow menu; comfortable 56px and compact 44px; hover, focus-within, selected and disabled; how it stacks at 390. Hover (`muted/50`) is only 1.10:1 on card, so hover can't be the only affordance. Say "title underlines on hover" or similar. |
| **Selected/current row and nav item** | `bg-primary-soft` + 2px cobalt rule; active nav `bg-card` + cobalt icon + 2px rule | The fills are 1.12–1.17:1 (selected row) and **1.07:1** (active nav in dark), so mark the **2px cobalt rule as mandatory**, not decoration. That rule alone carries the state for sighted users (alongside `aria-current`). |
| **Lifecycle stage indicator** (Draft · Processing · Review · Published · Acknowledged) | Stage rows (processing) and Stepper cover other jobs | A compact, inline **routing-slip** for 5 lifecycle stages that fits in a row (≈ 160px) and collapses to a text label at 390, with the current stage named in text. Also a **handover state pill** table: tone + label for each of the 5 states (today "Acknowledged" is a solid ink pill, unlike the others). |
| **Table density** for the dashboard at ≥ xl | Table: mono heads, hairlines, numeric right. Specimen heads have **no sunken band** although §6.6 says they do | Settle the band; add sortable-header button style (`aria-sort`), row-link pattern (whole row clickable vs title link), sticky head, empty/loading rows. |
| **Summary list (app)** for account details and sign-in methods | Document variant only (`type-eyebrow` terms, `type-reading` serif values) | An **app** variant: sans values (`text-sm`), optional trailing action ("Change"), status tag slot, stacks at 390. |
| **Section with rule** and **danger annex** | "Sections are space and hairlines" (principle) | One pattern for page sections (heading, description, action, hairline) and a distinct but calm destructive section (account deletion, handover danger zone). |
| **Menu** (identity menu, row overflow, Appearance) | Not specified; `account-menu.tsx` hand-rolls `@base-ui/react/menu` | A `components/ui/menu.tsx` primitive: link items, radio items (Appearance), destructive item, separators, keyboard behaviour. |
| **Radio group / segmented** for Appearance (Light · Dark · System) | Tabs `segmented` (a tab control) | A real radio group with segmented styling, since tabs carry the wrong semantics for a setting. |
| **Compact page header** | `PageHeader` with `type-page-title` (32→44px) | An app variant: title + one action + optional summary line, smaller top margin. The current header pushes the first dashboard item below the fold at 390. |
| **Empty-state variants** | One `EmptyState` + error tone | First-run (one primary + one secondary), **caught-up** (quiet, inline, no icon box), **no results** (clear filters), error with Retry. |
| **Skeleton row** | Skeleton exists | A row-shaped skeleton matching the list row. |
| **Identity block** | AccountMenu reuse agreed (thanks) | Expose the trigger as a variant that fits a 240px sidebar foot and a 56px rail (initial only). |
| **Sidebar rail** (collapsed, 56–64px, icons + tooltips) | Not covered | Rail width, icon-only item, tooltip/toggletip for labels, and the collapse toggle. Handover's review needs it at 1024–1279 (their R-1). |
| **Relative time** | — | A `type-meta` `<time>` pattern: absolute in the DOM, relative text, full date on focus/hover (toggletip, not a hover-only tooltip). |

## 3. Light and dark: enough to implement without guessing?
- Yes for surfaces, text, tones and evidence. B-2 is addressed: card→border is 1.41:1 in both themes, `track` makes a
  0% meter visible (1.39:1 light, 1.50:1 dark), and fills on `track` read (primary 5.7:1 / 4.8:1, success 3.9:1 /
  4.8:1). Thank you.
- Card on background is still 1.11:1 (light) and 1.13:1 (dark), and sidebar on background is 1.06:1 in both, so
  sheets and the sidebar are defined by hairlines (sidebar-border on sidebar 1.20:1 / 1.26:1). That's fine for
  Dossier *if* hairlines are never removed. Please write "sheets and the sidebar always keep their hairline" into
  §5.4.
- Popover on card is 1.04:1 in light. Menus and popovers rely on `shadow-raised`. Confirm popovers always get a border
  as well, since a light shadow on parchment is faint.
- **Theme mode**: the spec doesn't mention a System mode. Please add: three modes (light / dark / system), System
  follows `prefers-color-scheme` live, and the control is a radio group. `app/layout.tsx` gets `colorScheme: "light
  dark"` and `themeColor` media pairs (I'll send the diff, B-3).
- `THEME_COLOR` values edited in `lib/theme.ts` + regenerated `public/theme-init.js`: fine as a values-only edit, and
  thanks for keeping the test green. Logic changes there stay with me.

## 4. Answers to §12
1. **Instrument Sans at 13px in dense tables**: legible in the specimen at 13px (captions, hints). Keep the primary
   cell/row text at **14px** (`text-sm font-medium`) and use 13px only for secondary text. I don't want `font-stretch:
   90%`: it adds a third width to learn, and the dashboard isn't that dense.
2. **Redaction loudness**: not on my screens; defer to handover.
3. **Mono eyebrows**: fine for **table heads and short labels** (STAGE, UPDATED). On the dashboard **not** for content:
   team names are content and should stay sans. In uppercase mono, "NSS VOLUNTEER CELL" is wide and truncates at 390.
   The 12px mono `type-meta` should carry **structured values** (dates, counts, versions, line numbers), not people's
   or team names. Group headings ("Needs you", "Drafts") should be sans `type-heading` with a mono count.
   Today `type-eyebrow` sits above every dashboard card title and in `PageHeader`, so switching it to mono globally
   changes my screens; I'll move team names off the eyebrow when I rebuild the rows.
4. **What the system can't express yet** (my screens): the items in §2, plus how `ink` buttons and cobalt `default`
   buttons coexist in the app (spec says `ink` is "not for app primary actions". Good, please keep it out of the app
   entirely), and a **destructive-but-reversible** treatment (discard draft is a soft delete) vs irreversible (delete
   account).

## 5. Fit with Dossier on my screens
Good fit: paper sidebar (not a dark rail), opaque bars, hairline-first sections, the one-accent rule, `type-meta`
for records. Watch-outs: `paper-grain` and `stamp` must stay off the dashboard and settings (the spec already says
so). The editorial serif page titles at 44px are right for a document but heavy for an app header, hence the
compact header request.
