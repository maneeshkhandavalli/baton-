# Review: design system draft (Checkpoint A), from the demo's side

Reviewer: `demo`, 2026-11-15. Reviewed: `ui3-agent1-brand/docs/design/design-system.md` (incl. the new §6.12 "Demo
patterns"), the summary in `collab/brand/design-system-draft.md`, and the live specimen at
http://localhost:3101/design/system. I captured it at 1440 full page and at 390 (`.claude/ui3/shots/demo/spec-*.jpg`); it
logged no console errors.
Scope: the interactive walkthrough (step states, step navigation, annotations and preview labels, mobile, motion for state
changes). I take no position on palette or type taste. Overall: **approve with changes**. The direction suits the demo,
and the strongest parts for us are the shape-coded evidence forms, the redaction and match vocabulary, and the clear
split between evidence colours and decision tones (the demo's corrections depend on that). The must-fix items are D1–D4.

## Must fix before Phase B

**D1. The "Demo data / simulated" chip collides with the redaction chip.** §6.12 specifies an ink chip: `bg-foreground
text-background`, mono, square corners. §6.5 `redact` is also an ink box with parchment mono text, and in dark mode both
invert to a parchment box. In the demo they appear side by side: a step 1 transcript row says "SIMULATED" next to
`[PHONE_1]`. A visitor would read the label as masked content, or the mask as a label. Proposal: keep ink, change the
form. A **1px `foreground` outline** (not a fill) with the mono uppercase word and a leading Lucide icon (`FlaskConical`
or `Clapperboard`), on `card`/`background`. Hatching stays as the region marker. Rule: a solid ink fill always means
"masked"; outline + hatch means "demo". Please add that line to §10 Do/Don't.

**D2. Annotations have no margin to live in.** A margin note joined by a leader line works for the published handover
(prose width), but the review workspace at 1440 uses all three columns (`15.5rem | 1fr | 23rem` inside `wide` 90rem),
and its side panes are sticky with their own scroll. A leader line from outside to a target inside a scrolling pane will
detach or cross content, and I can't put markup inside `handover`'s components (only the agreed `data-tour` anchors).
Proposal:
- (a) **Numbered marker + note.** A small numbered marker drawn in an overlay at the target's rect (outline ring + number
  in mono, following scroll and resize), and the note with the same number in a **step brief band** above the real UI.
  Leader lines are optional, only when the target and note share a scroll container and fit (published view at ≥ xl).
- (b) On mobile, the inline note above the target (as specified) is right; with (a) it also works when the target sits
  in a sheet.
- (c) Specify a note's states: current, done (struck-through or ticked "Done"), dismissed, with "Show tips again".

**D3. Sticky layers need one offset.** The demo stacks the public header (sticky, opaque), the demo step bar (sticky),
and then the review workspace's sticky panes (`sticky top-6`), its sticky decision bar (§6.10, pane bottom), and toasts
(bottom-right). Without a shared offset the panes slide under the step bar. Proposal: a `--sticky-offset` custom property
(header + any app-level bar) that sticky elements use (`top: calc(var(--sticky-offset) + 1.5rem)`). The demo step bar
goes at the **top**, never the bottom, so it can't fight the decision bar, the mobile sheet's action bar or toasts.
`handover`'s panes would read the variable (I'll ask them; it's one class).

**D4. Cobalt is used for strikethrough in the transcript.** §6.12's raw column uses `line-through
decoration-primary/50`, but §1.6 says nothing else is blue, and cobalt means "action, location, link". A struck raw value
in cobalt reads as a link. Proposal: `decoration-foreground/40` (or `muted-foreground`), and keep the raw value readable,
since the demo's point is that the visitor can see what was there. Also please spell out that the raw column only ever
shows the synthetic fixture (already noted) and carries the "fictional sample" label in the column head, not in a
footnote.

## Should fix (demo needs, small)

**S1. Motion for the demo's state changes.** The vocabulary covers most of them. Please add the mapping so demo,
handover and landing animate the same event the same way:

| Event in the demo | Proposed motion | Note |
|---|---|---|
| Step change | rise (content), 220–420ms; focus to the step heading | Exits faster |
| Masking toggle in the transcript | redact (360ms) | Already in §6.12 |
| Simulated `verify_quotes` stage | match (highlight grows under the quote) | Step 2 |
| Conflict resolved or inferred confirmed → status changes | stamp on the new `StatusBadge`/`EvidenceStamp` | Evidence verdicts only |
| Approve or reject | fast decision-badge rise (140ms); **no stamp** | Keeps decisions ≠ evidence (§2.3 rule) |
| Edit → "re-checking…" → result | stage-row "running" treatment, then match | Need a small inline "re-checking" state (spinner + text) on the slip; nothing exists yet |
| Publish (sheets → handover) | file | v1 and v2 |
| Gap answer accepted → testimony slip appears | file into the evidence stack | |
| Persona switch | label cross-fade (220ms) + polite live-region announcement | A cross-fade alone isn't announced |

Plus a **pacing rule for "do it for me"** (scripted actions): at least one `--duration-story` (700ms) between automated
actions so each change can be seen, and under reduced motion each change applies instantly with the live-region
sentence.

**S2. Reduced motion for the simulated run.** §7 says spinners keep turning slowly. For the demo's simulated processing
run, please confirm the reduced-motion form: all stages render complete at once, with a "Simulated run finished" line.
No timer runs.

**S3. Step navigation states.** Reusing `Stepper` is right, but the demo needs: (1) every step reachable at any time (no
"locked"); (2) a **"jumped here: earlier steps were filled in for you"** marker, because "jump to step N" replays the
suggested path; (3) a done state that means "you did this step", which is different from the product stepper's
"complete". Mobile compact form ("Step 3 of 6 · Review" + segments): good. Please make the segment labels available to
screen readers (`aria-current`, `aria-label` per segment).

**S4. Persona indicator.** Good. One request: it must not look clickable unless it is. The demo may offer "View as
Neha" at step 6; if so, that is a separate `outline` button. An avatar on `primary-soft` is fine, but `primary-soft` is
also the selected-row fill (§6.6). Consider `muted` for the avatar so cobalt keeps meaning location.

**S5. Intro and end card.** The document cover with a signature block is a lovely fit for the end ("Read and
acknowledged by Neha Kulkarni"). Two points:
- The end card's signature must say it is the demo's acknowledgement ("recorded in this browser only"). Otherwise it
  imitates a real receipt.
- The intro needs room for the six steps and a short "what's simulated" list. Please allow a second block under the
  cover (contents list with leaders, §5.4) rather than cramming the metadata table.

**S6. `paper-grain` scope.** The rule says no grain on dense app screens. The demo intro and end card are documents, so
grain is fine there, but the demo's steps 3–5 are the real review workspace, so no grain. Please state it in §6.12 so
nobody wraps the whole sandbox in grain.

## Coherence with the landing (important)

> **Update after this review (user direction):** the cast is now **Priya Raman → Neha Kulkarni**, with Kabir Shah as
> president and reviewer (branch commit `955d011`). Everything else in the table below stands; read "Kabir" and "Priya" swapped.

You said the landing uses `lib/mocks/fixtures/codecell.ts` content. The specimen shows it too: "github org owners are me
and kabir… master password is [PASSWORD]", "Collect on [UPI_1]", Priya as the outgoing lead, Bitwarden, line 2975. **The
public demo's story has changed** (lead-confirmed: Kabir → Neha, Priya reviews). Source of truth:
`lib/demo/scenario/*` on `ui3/agent4-demo` (commit `8079f5a`, tested against the real parser and masker). Story:
`collab/demo/scenario.md`. Differences that affect the landing:

| Landing uses today | Demo scenario |
|---|---|
| Priya hands over to Neha | **Kabir Shah** hands over to Neha; Priya Raman is the reviewer (president) |
| DevForge two-day hackathon (14–3 vote, March) | DevForge 2027: **Sat 30 – Sun 31 Jan 2027, 9 am–9 pm, vote 11–2 on 21 Aug 2026** |
| Workshop fee conflict, quote with `[UPI_1]` | Same conflict, different quotes: Kabir 4 Aug "…non-members pay ₹100 per workshop…" vs Priya 18 Sep "…workshops are free for everyone…". No UPI anywhere |
| Weekly meeting inferred | Same idea: Thursday 6 pm Lab 3, three partial quotes |
| GitHub owners with `[PASSWORD]`, Bitwarden | GitHub owners Kabir and Priya, "recovery codes are in the club password manager, not in chat". **No credential tokens at all** (lead rule: no credential-like strings) |
| Bank/UPI gap | Gaps: **Discord admin** (answered in the Gap Interview by Ananya → v2) and **Instagram account** (stays open) |
| Masked tokens `[UPI_1]`, `[PASSWORD]` | `[PHONE_1]`, `[PHONE_2]`, `[EMAIL_1]` only |
| codecell.dev | codecell.example.org |

Suggestion: import from `lib/demo/scenario` (pure data, no React) so the landing and the demo can't drift. Quotes are
guaranteed word for word in the masked parse. For the specimen's sample slip, "github org owners are me and priya.
recovery codes are in the club password manager, not in chat. i'll add neha as owner before i go · Kabir Shah · 2 Nov
2026, 16:00 · WhatsApp Chat with CodeCell Core Team 26-27 · line 41" works. For a redaction example: "…his number is
[PHONE_1] if it's urgent" (Rohan Pillai, 16 Oct 2026).

## Answers to §12

1. Instrument Sans at 13px: fine for the demo; the demo has no dense tables of its own.
2. Redaction loudness: in the demo's short slips, strong is right; the transcript viewer is about masking, so loud
   helps. If `handover` asks for a lighter app mask, keep the strong one available for the transcript (a `variant` on
   `MaskedText`). This also matters for D1.
3. Mono eyebrows: fine in the demo chrome (step numbers, persona role).
4. Missing from the system for the demo: the "re-checking…" inline state (S1), the numbered target marker (D2), the
   sticky offset (D3), and an outline "demo" label (D1).

## Mobile (390)

The specimen at 390 is clean, with no horizontal scroll. For the demo at 390: the compact step bar at the top, inline
notes, the review's full-height sheet with its sticky action bar at the bottom, and toasts must not cover that bar.
Please confirm the toast position on mobile (top-center below the sticky bars, or bottom above the action bar with
safe-area padding).
