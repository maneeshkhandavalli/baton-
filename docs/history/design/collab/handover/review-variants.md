# How my document surfaces fit the new directions (from `handover`)

Reviewed on 2026-11-15: brand's `:3101/design/variant-a` ("Immersive system") and `:3101/design/variant-b`
("Editorial transfer"), and shell's `:3102/design/dashboard-preview`. Captured at 1440 and 390, with the `dark` class
set (`.claude/ui3/shots/handover/variants/`). The surfaces I judged: the handover **report**, **evidence slips**, the
**source viewer**, the review **decision bar**, the **conflict ledger** and the **recipient view** (published plus
acknowledgement). The cast follows the user: Priya Raman hands over to Neha Kulkarni.

I'm not choosing between the two. For each, this file records what carries over to dense, document-heavy screens and
what breaks. My plan stays direction-agnostic (plan.md §0).

---

## Shared observations (both landing variants)

1. **Neither variant switches with the theme.** With `<html class="dark">` set, both pages render identically: a light
   page with some dark sections. That's fine for a landing page, but my review, report and source viewer are long work
   sessions and need a designed dark mode. Whichever direction wins, please show its dark app surfaces (card, sunken
   well, evidence tags, decision pills) before Checkpoint B.
2. **The review mock-ups sit on a dark section in both.** That can't tell us how the review reads on the app's default
   surface. Please show at least one app-surface specimen of the list, pane and slip in each direction.
3. **Both now put quotes in sans, with mono only for the metadata line** (my earlier A1). Good. Keep that in whichever
   direction wins.
4. **Both name the two checks honestly.** B says "Quote found word for word (no AI involved)" and "A second model
   confirmed it backs the point", which is exactly our `quoteCheck` / `supportVerdict`. I'll use that wording in the
   slip's verification line whichever direction is picked.

## Variant A, "Immersive system"

Grotesk display, sans UI, mono metadata, teal primary with an orange accent, outlined evidence tags with shape marks,
rounded sheets on a grid backdrop.

| Surface | What works | What breaks or needs a decision |
|---|---|---|
| Report | The 3-column preview (Decisions · Owners and tasks · Risks and open questions) is an excellent **dense point card**: tag, title, one fact line, then `↳ Core Team 26-27 · line 15` as an evidence reference. I'd adopt the `↳ source · line` reference line as the collapsed form of a slip in lists and in the report. | The cards sit inside a larger rounded card (card on card). In the app, the report is the page itself, so no outer card. 900-weight grotesk headings are too loud for 30–60 point titles in a reading document. The report needs a calmer heading weight than the landing. |
| Evidence slip | The quote in sans with a mono header line ("Contradicts · Kabir Shah · 18 Sep 2026") and a coloured left rule reads well, even at 2 lines. | The header line puts the *stance* first. For a slip outside a ledger, lead with the author and time, and keep the stance as the rule colour plus a word. |
| Source viewer | Nothing shown yet. The chat-bubble strip ("Ananya: projector in lab 3 died…") suggests a transcript look. | Bubbles (left and right aligned) imply a phone UI and waste width in a 26rem pane. For the source viewer I need a **flat transcript** (time and author column, sans text, the quoted message marked), not bubbles. |
| Decision bar | The pane actions ("Record what's true now" as primary, "Ask in Gap Interview" as outline) show the right adaptive-primary idea. | Approve, Edit and Reject aren't shown in A. Please show the full bar, including the reviewer decision pill, which A doesn't define. |
| Conflict ledger | Two side-by-side quote panels, Contradicts and Supports, each with stance, author and date in mono. That is my ledger. | The order is Contradicts | Supports here and Supports | Contradicts in B. Pick one and keep it (I propose **Supports left, Contradicts right**, matching `ConflictSides` today). The panels need "View in source" and must not clamp. |
| Recipient view | The first-week checklist plus a hairline plus "Read and acknowledged · Neha Kulkarni" is the right signature-block idea, and it is quiet and confident. | The checklist uses text boxes ("☐"). The real one is a checkbox list. Fine as a sketch. |
| Gates | The open-circle warning icon plus a sentence per gate ("A conflict is unresolved") matches my task-list gates. | — |
| Risk for dense screens | Five or more hues in one review pane: teal primary, orange accent, plus four evidence colours, plus system tones. The **orange accent must never appear inside the review or report**, where it would read as warning or inferred. The grid backdrop must never sit behind dense screens. |

## Variant B, "Editorial transfer"

Condensed display, sans UI, uppercase mono metadata, a terracotta accent, ink and colour blocks, **solid-filled**
uppercase evidence tags, ink decision pills.

| Surface | What works | What breaks or needs a decision |
|---|---|---|
| Report | Very strong hierarchy. The "how it works" sequence (01 Raw chat → 05 Reviewed) maps directly onto my processing stages and onto the demo. "Decision · Sourced" mono eyebrows over sans titles give a clean point heading. | Condensed display type and big terracotta and teal tiles are poster devices. A 40-point report can't be built from them, so B needs an explicit **quiet document mode** (no tiles, no outline type) for the report and the review. |
| Evidence slip | The uppercase mono reference line "SOURCE · PRIYA RAMAN · 21 AUG 2026, 22:05 · LINE 15" is crisp, and the two verification chips are explicit and honest. | Uppercase names and dates read slowly and wrap badly in a 26rem pane. Please use sentence case in mono for slips ("Priya Raman · 21 Aug 2026, 22:05 · line 15") and keep uppercase for short labels only. |
| Evidence tags | Decisions are **ink pills** ("Approved by Kabir", "Sent to Gap Interview"), unmistakably different from evidence tags. This is the best D5 separation I've seen so far. | **Solid saturated tags** (filled SOURCED blue, CONFLICTING magenta, INFERRED olive) turn a 24-row list into a confetti column. I need a **soft or outline dense variant**, keeping solid tags for headline moments (the stamp). The MISSING dashed outline is good. |
| Source viewer | The "Raw chat" cards (author · date over a flat message) are close to the transcript I need. Good. | They are separate cards per message. In the viewer they should be rows in one surface (hairlines), with the quoted message marked, not a stack of cards. |
| Decision bar | Approve (solid), Edit and Reject (outline) in one row under the verification chips. Clear. | The review is shown as a **horizontal carousel of panels**: clipped at both edges at 1440, and at 390 the tags ("Conflic…") and quote text are cut off on the right (`vb-light-390-08.jpg`). The app review must never scroll sideways. The pane needs the counter and the overflow menu (my A5). |
| Conflict ledger | The stacked Contradicts and Supports quotes with left rules, then "Record what's true now" and "Ask in Gap Interview". | The order differs from A (see above). |
| Recipient view | "SIGN-OFF · Read and acknowledged · Neha Kulkarni" as a tile is a clear receipt. | As a coloured tile it reads as decoration. In the report it should be the signature block at the end of the document. |
| Risk for dense screens | The terracotta accent sits close to danger (brick) and warning (orange). In the review, reject and warning gates appear next to accent marks, so the **accent must stay out of the app's evidence and decision areas**. The condensed display face must not reach app page titles. |

## Shell's dashboard preview (feedback for shell)

Clean and dense, and the dark mode is real. The attention list and table are the right model. Points where it
connects to my screens:

1. **Deep links I will support** (plan §3.5): "Resolve" → `/handover/[id]/review?filter=conflicts&point=<first conflict id>`.
   "Continue review" → `/review?point=<first pending>`. "See what failed" → `/processing`. "Review offer" →
   `/settings#danger` (the creatorship offer row). "Waiting for your acknowledgement" → `/published#acknowledge`. I'll
   confirm the exact query names in Phase C, and they will be optional, so the links work without them.
2. **Wizard step text** "Step 4 of 4: Scope and start" will change. My plan adds a fifth step, "Check and start". Please
   derive it from `WIZARD_STEPS` (agreed) and don't hard-code 4.
3. **Gate wording**: "9 to review · 1 conflict · 1 required gap open" should use the same vocabulary as my readiness
   gates (`blockerLabel` in `components/handover/labels.ts`), so the dashboard and the review never disagree. I'll
   export a short form (`blockerShort`) if you want one.
4. The dashboard preview's language (Inter rows, icon tags, teal primary) sits closer to Variant A than to B. If B
   wins, the dashboard tags need the same quiet dense variant I'm asking for above.

## Non-negotiables for my screens, whichever direction wins

- A designed **dark mode** for the app's card, sunken well, tags and pills.
- A **quiet dense evidence tag** for lists, with solid or stamp forms only for headline moments.
- Evidence state, reviewer decision and system tone must look distinct (D5). B's ink pills are the model.
- Quotes in a readable sans or serif. Mono, in sentence case, only for the metadata line.
- No horizontal-scroll review, no card on card, no grid or grain texture behind dense screens. Landing-only devices
  (3D ring, poster tiles, outline type) stay on the landing.
- The landing accent (orange in A, terracotta in B) stays out of evidence and decision areas.
- One conflict-ledger order everywhere (I propose Supports | Contradicts).
