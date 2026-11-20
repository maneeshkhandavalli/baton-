# Demo visual requirements for the new direction (for `brand` and `shell`)

Agent `demo`, 2026-11-15. Seen: `brand`'s http://localhost:3101/design/variant-a and `/design/variant-b`, and `shell`'s
http://localhost:3102/design/dashboard-preview, at 1440 and 390 and at several scroll positions. Screenshots are in
`.claude/ui3/shots/demo/var-*.jpg` and `vs-*.jpg` (git-ignored). No console errors and no horizontal scroll at 390.
These are **requirements**, not design choices: `brand` and `shell` decide the look. The demo builds no design system
of its own; it composes yours. The scenario is unchanged (Priya Raman → Neha Kulkarni, Kabir reviews; commit `955d011`).

## 1. What the demo has to show, whichever variant wins

1. **Step rail for 6 steps**: Sources · AI draft · Review · Decisions and tasks · Publish · Neha's view and Gap Interview.
   - States: done, current, upcoming, and "jumped here (earlier steps filled in for you)". Every step can be reached at
     any time, so there is no locked state.
   - Desktop: horizontal, sticky directly under the public header (using `--sticky-offset`), labels visible.
   - 390: a compact "Step 3 of 6 · Review" bar at the **top** with previous/next buttons of at least 44px. Never at the
     bottom: the review's sticky action bar and toasts live there.
   - Please reuse the landing's "How it works" numbering language (A: numbered cards 01–06; B: the big numeral, mono
     label and six progress segments). The landing then reads as the trailer and the demo as the film. B's six segments
     under "06 Published" are almost exactly the compact rail the demo needs.
2. **Persona indicator**: "You are Neha Kulkarni · incoming lead". It switches between Priya, Neha and Ananya and is
   announced to screen readers. B's giant name lockup (PRIYA / NEHA) could be the persona switch moment on the step 6
   intro, but keep a small persistent indicator too.
3. **Preview / simulated labels**: an outline label with an icon (agreed D1). In each variant it must not reuse a fill
   that already means something:
   - A: no orange (it marks eyebrows and the accent rule) and no teal fill (it marks primary actions).
   - B: no solid colour blocks, because orange already means "deadline" and teal means "owner" in the hero grid.
   - In neither variant should it look like an evidence badge (SOURCED, INFERRED and the others).
4. **Annotations**: a numbered marker on the `data-tour` target, with the note in a step brief band above the real UI
   (agreed D2). The band needs the variant's quiet surface, not the dark band (A's dark section reads as a landing
   moment).
5. **Raw ↔ masked transcript (step 1)**: B's "01 Raw chat" message cards (name · date in mono, text below) are already
   the right shape for the "As received" column. The "As stored" column needs the strong redaction chip.
6. **Evidence labels**: B shows SOURCED in a blue fill. If blue (or teal in A) is also the primary/link colour, evidence
   and action colours mix. Please keep evidence hues apart from the accent in whichever variant wins (rule from the
   Checkpoint A draft).

## 2. Mobile (390)

- Demo step content never scrolls sideways. A's "How it works" cards scroll horizontally at 1440; that's fine on the
  landing, but the demo's steps are vertical.
- The intro and end card are single column; actions stack full width; tap targets are at least 44px.
- Sticky stack, top to bottom: public header, then the demo step bar. The review's own panes offset below both; toasts
  appear top-centre below the bars (agreed in spec §11.4).

## 3. Motion

- The demo is an app surface: no 3D (A's ring of cards), no scroll-jacking, no pinned scroll sequences inside steps.
  Those belong to the landing.
- Transitions follow the state-change vocabulary (rise for a step change, stamp only for evidence verdicts, file for
  publish and the testimony slip, redact for masking). Under reduced motion, final states apply instantly.

## 4. Coherence notes (content)

- Both variants now follow the scenario (checked: Priya → Neha, Priya's 4 Aug fee and 21 Aug vote, Kabir's 18 Sep
  quote, "Deploy: ask Priya.", the Discord gap).
- One mismatch: B's "06 Published" card lists **Farah Khan, Orbitstack** in what Neha receives. In the demo, Farah comes
  from the leads-only chat and is **hidden from Neha**. Use **Mr. Desai, Dean's office** (sourced, visible to everyone)
  there instead.
- B's hero shows "Arjun owns sponsor relations", which is also leads-only in the demo. That's fine as a landing teaser,
  but don't present it as part of Neha's published handover.

## 5. For `shell`

- The demo renders inside the **marketing layout** (public header), not the app shell. Steps 3–6, however, embed
  `handover`'s views, which are designed for the app shell's widths (review = `wide` 90rem, three panes). The page
  container widths and tokens must work outside `AppShell`, and the sticky panes must read `--sticky-offset`.
- The dashboard preview's CodeCell row ("16 points awaiting a decision, 4 inferred, 2 required gaps", email on
  `example.edu`) comes from the `lib/mocks` fixture, not from the demo scenario (21 points, 7 pending at the start of
  the review, optional gaps, `example.org`). The preview is dev-only, so that's fine. If a dashboard frame ever appears in
  the public demo or in its screenshots, it must come from demo data.
- The demo doesn't need the workspace sidebar. If the end card links to "what Neha's dashboard would look like", it would
  be a labelled preview built from demo data, which I would first discuss with you.
