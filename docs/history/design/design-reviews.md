# UI3 design reviews

Consolidated by the lead from the agents' review notes (`docs/history/design/collab/<reviewer>/review-<subject>.md`) and
messages. Each entry: reviewer, subject, findings, owner's response, lead decision.

## Checkpoint A: design-system proposal (complete 2026-11-15)
Full texts: `collab/shell/review-design-system.md`, `collab/handover/review-design-system.md`,
`collab/demo/review-design-system.md`; brand's answers: `collab/brand/review-responses.md` (brand commit 8f401c2).

| Reviewer | Verdict | Must-fix items | Brand response |
|---|---|---|---|
| shell | Approve with changes | Focus ring 40% alpha was 2.0-2.3:1; faint-foreground < 4.5:1 used for placeholders | Solid focus-ring utilities (≥ 7:1); faint-foreground ≥ 4.5:1 |
| handover | Approve with changes | A1 quotes in mono; A2 redaction too loud; A4 acknowledgement band; A5 decision-bar spec; A7 published width vs margin column; B1-B9 additions | Quotes sans in app, serif in published, mono only for short exhibits; quiet redact default + strong print variant + accessible token names (tested); signature-block acknowledgement; spec §11 covers A5, A7, B1 (transcript) and the rest |
| demo | Approve with changes | D1 demo label looked like redaction; D2 annotations in 3-pane review; D3 shared sticky offset; D4 transcript strikethrough in cobalt | Addressed (D1, D2, D4 in spec §11; `--sticky-offset` token) |
| lead | Specimen light column turned dark in dark mode | Scoped `.light` class |

Extra from brand's colour-blind check (A11): warning darkened to #9a4710 (light) / #d9803a (dark).

Reviewers: shell, handover, demo. Subject: brand's draft `design-system.md`, tokens and landing preview.
Questions every reviewer answers from their area:
- Does it support a data-heavy dashboard / complex report with evidence references / a realistic interactive demo?
- Are light AND dark themes defined well enough to implement without guessing?
- Are the reusable components practical for my screens? What is missing?
- Anything that would not fit the Dossier direction on my screens?

## Checkpoint B: user review (pending)

## Checkpoint C: cross-agent reviews (pending)
Each UI agent reviews at least one other agent's completed work.
