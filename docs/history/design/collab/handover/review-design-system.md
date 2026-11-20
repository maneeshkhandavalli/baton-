# Checkpoint A review: brand's design-system draft (from `handover`)

Reviewed: `ui3-agent1-brand/docs/design/design-system.md` (Checkpoint A draft), the summary in
`collab/brand/design-system-draft.md`, and the live specimen `http://localhost:3101/design/system`, captured at 1440
and 390 in light and dark (`.claude/ui3/shots/handover/spec/`). I judged it against my screens: wizard, processing,
review workspace, conflict ledger, source viewer, privacy review, Gaps and the Gap Interview, the published report,
acknowledgement and print (`plan.md`, `audit.md`).

**Verdict: approve the direction, with changes.** The system can carry a complex, evidence-heavy report. The
three-face split (read / operate / record), shape-coded evidence marks, reviewer decisions kept apart from evidence,
the `sunken` quote well, opaque bars, `track`, and evidence hues moved away from system hues all directly fix
problems in my audit (X-15, R-17, D5). Seven of my needs are covered. The items below are what I need changed or
added before Phase C. They are in priority order, and each says whether it **blocks** me.

---

## A. Changes requested

### A1. Quotes set in mono hurt long-quote reading, mobile and the published report (blocks the slip and the report)
`type-quote` = IBM Plex Mono 13px for every source quote. In the specimen at 390, a slip fits about 32 characters
per line, so my 25-line worst case becomes about 60 lines on a phone. In the 23rem review pane it's about 45
characters. Mono is also the least readable face for the person Baton exists for: the incoming member reading the
published handover on day one. WhatsApp quotes are Hinglish, full of ₹ amounts and emoji, so glyph coverage and
fallbacks matter too.
**Ask:** keep mono for the *record layer* (metadata, IDs, tokens, timestamps, line numbers), and set quote text in a
reading face:
- Review and source viewer: the quote in sans (`text-sm`/15px) inside the `sunken` well with the verdict rule. The
  well, rule and mono metadata already say "this is a record".
- Published report: the quote in the serif (`type-reading` at a smaller size, or italic serif like the testimony
  variant).
- If you want to keep mono quotes for the landing or exhibits, make it a variant, not the default `type-quote`.
- Please confirm IBM Plex Mono covers `₹` (U+20B9) and define the emoji fallback stack for every face.

### A2. Redaction ink boxes are too loud in app screens (answers your §12 Q2) (blocks the review pane)
A solid ink box is the darkest object in a slip. In dark mode the inverted parchment box is the *brightest* thing on
screen. A 25-line quote with 6 or more tokens turns into a barcode, and the eye goes to what is hidden instead of
what was said. Masked values are routine in Baton (every phone number), not an exception.
**Ask:** two strengths of one `redact` vocabulary:
- `redact` (app default): a quiet bar (`mask` at low contrast, or `sunken`-plus-border) with the mono type label,
  number kept ("PHONE 1"), the same height as text. It must stay distinct from `[EXCLUDED_PARTICIPANT]`.
- `redact-strong` (ink box): print, landing, and the published cover's privacy note, where it *should* make a point.
- Keep the token number visible in both, so readers can follow "the same phone" across quotes.
- Accessible name and toggletip as you accepted (my request #4). Thank you.

### A3. `quote-match` has no span to mark (blocks only if kept as specified)
The data has no matched-span offsets. `quoteCheck` is `exact | normalized | not_found | pending` for the *whole*
quote, and the stored quote *is* the matched text. In the specimen, `quote-match` underlines and tints the whole
quote, which reads as a link or a text selection.
**Ask:** use the "matched" mark in exactly one place: the **source viewer**, to mark the quoted message
(`isQuoted`) inside its surrounding messages. That is where "this exact passage" means something. On slips, the
verification line ("✓ quote matched word for word") carries it. If you want a motion moment, the `match` motion
belongs on the source viewer's quoted message, not on every slip.

### A4. The acknowledgement should be the signature block, not the `inverse` band (blocks the ack)
§2.1 keeps `inverse` for "Bands: privacy band, acknowledge band", while §6.3 specifies a signature block plus
receipt. My plan (PB-4) needs the signature block on paper at the end of the dossier, filled in by the
acknowledgement, with a receipt. The dark band today reads as a marketing CTA inside a document (audit, dark mode).
**Ask:** drop "acknowledge band" from `inverse`'s uses. Signature block only.

### A5. The decision bar needs more than Approve, Edit and Reject (blocks the review)
§6.10 lists three actions. My decision bar needs: the adaptive primary label ("Confirm & approve", "Resolve &
approve", "Approve as gap"); Resolve (conflicts); Ask in Gap Interview (gaps); Undo/reopen (decided points); a
position counter ("Point 3 of 14 to review"); and a keyboard-hint toggle. At 23–26rem that doesn't fit in one row.
**Ask:** a decision-bar spec with a primary slot, at most two secondary buttons, an overflow menu ("More"), and a
counter slot, plus a mobile layout (two rows inside the sheet's sticky footer). Approve stays `success`, Reject
`destructive-outline`.

### A6. Review grid track sizes: please leave them to me (doesn't block)
§4 fixes the review at `15.5rem | 1fr | 23rem`, which is today's layout. My audit R-1 measured the point list as the
narrowest column (about 440px at 1440). With shell's collapsible rail I plan roughly `13rem | 1fr | 26rem`, with the
sections rail becoming a drawer at 1024–1439. **Ask:** state the principle (the list is the widest track; the pane
is wide enough for a 45–60 character slip) and let the screen owner set the tracks.

### A7. Published width against the margin column (blocks the report layout)
§4 gives the published document the `prose` width (42rem) and also a 12-column margin layout (content in cols 1–8,
notes in 10–12). Those can't both hold. **Ask:** a `document` layout: TOC rail · text column (≤ 62ch
`type-reading`) · margin column at ≥ 1280, in a container that fits all three (about 72–80rem). Below `xl`, the
TOC turns into jump links and the margin notes go inline (as you wrote). Print gets text only, with slips inline.

### A8. Narrow-pane metadata (doesn't block, but please specify)
`type-meta` (mono 12px) for "Priya Raman · 20 May 2026, 15:50 · Core Team (WhatsApp) · l.2975" is about 470px. It
wraps in the review pane, and on mobile it already splits into 2–3 lines in the specimen. My audit R-11 found
separator dots stranded at line starts. **Ask:** a meta-line pattern where items wrap as whole units (separators
belong to the item before them), there is a short date format for panes ("20 May, 15:50"), and source titles
truncate with the full title reachable.

### A9. Category eyebrows inside dense rows (answers your §12 Q3) (doesn't block)
Mono uppercase eyebrows work well for section labels, table heads and the document cover. Inside a dense review row
or the point sheet ("ACCOUNT & ACCESS" next to the Sourced tag and a decision pill), uppercase mono adds a third
shouting element. **Ask:** in rows, the category in `text-caption` sans (sentence case). Keep mono eyebrows for
labels and heads. Q1: 13px Instrument Sans is fine for my densest view, and I don't need the 90% width cut.

### A10. Stamp motion in a review queue (doesn't block)
`stamp` (scale 1.25 → 1, 300ms) on every approval gets tiring across 50 decisions. **Ask:** in the review, a subtler
"filed" change on the decision pill (≤ 150ms, opacity and small translate), and keep the stamp landing for headline
moments: the published cover, the demo, the landing. Reduced motion gives the final state, as specified.

### A11. Similar hues (please verify, doesn't block)
In the specimen, sourced (verdigris) and the "Approved · Priya" pill (success green) sit side by side in the point
header, and inferred (ochre) sits close to warning (burnt orange). Readiness gates use `warning` in the same pane as
inferred tags. Shape and word separate them, but please run a deuteranopia and protanopia simulation on the point
sheet and the gate list, and record the result in §2.3.

## B. Additions I need (not in the draft)

| # | Need | Why (my screen) |
|---|---|---|
| B1 | **Transcript pattern** for the source viewer: a message list (author, time, body through `MaskedText`, kind for system messages), the quoted message marked, "Show earlier" and "Show later" loaders, an "original no longer stored" state, and a document variant (page / heading / line). | Plan §2.2 (audit X-3): the most important new surface. |
| B2 | **Revision diff marks** (inserted and deleted words) on tokens that collide with neither evidence nor system tones (D5). Not green or red: those mean approve and reject here. | Plan §3.5 (R-13). |
| B3 | **Gap register** entry (the published "Open questions" and the Gaps page): how a known gap reads as a deliberate annotation, matching your "Missing → Gap" rule. | PB, G-1. |
| B4 | **Privacy-review surface list**: one row per surface (point, revision, note, evidence, gap Q/A), each with a decision control (keep / redact / remove) and a replacement text field. Only rows and controls, using existing primitives, but please confirm the pattern. | Plan §3.4 (P0). |
| B5 | **Inline composer** inside a pane (resolve note, ask-gap wording, edit): the pane equivalent of a dialog with a pinned footer. | Plan §3.3, §3.5. |
| B6 | **Slip without collapse**: the slip's 6-line collapse must be switchable off (conflict ledger while resolving, source viewer, print). | R-3. |
| B7 | **Key facts with `leader`**: confirm the key-facts strip (assignee, due, status) turns into a summary list with leaders in the document and stays a compact strip in rows. | Report IA §1.1. |
| B8 | **Print**: confirm stamps, marks and decision pills keep shape and border in greyscale print, and that the slip's left rule prints. | PB-5. |
| B9 | **Status stepper** with five steps and a "needs attention" count on mobile ("Step 3 of 5 · 1 file needs attention"). | Plan §4. |

## C. Accepted as is (thank you)
Shape-coded `EvidenceMark` and dashed edges for not-yet-backed states. Decisions as named system pills. `sunken`
wells, so no card on card. `track` for meters. `faint-foreground` (not for body). The copy-once field, toggletip,
sheets (28rem / full-height mobile), gate rows and stage rows as specified. The privacy-hold marker as an outline tag
with a lock (never error-coloured). Opaque surfaces, no blur. The `RouteError` `retry`. Dark surface steps. Print
rules in §6.3. The radius change.

## D. What this means for my plan
No change to my information architecture or flows. A1, A2, A4, A5 and A7 decide how the slip, redaction,
acknowledgement, decision bar and report frame look, so I won't build those visuals until you respond. I can start
the token-independent P0 work (privacy review flow, the pure processing view for previews) and the demo seams
straight away in Phase C.
