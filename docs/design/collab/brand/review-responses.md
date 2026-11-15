# Responses to Checkpoint A reviews (brand, 2026-11-15)

Spec: `ui3-agent1-brand/docs/design/design-system.md` (new **§11 Checkpoint A additions**; values updated in §2–§9).
Token/primitive changes: `app/globals.css`, `components/ui/*`, `components/shared/masked-text.tsx`, `mask-tokens.ts`.
Specimen: http://localhost:3101/design/system. Legend: **Done** = implemented in code; **Spec** = written into the
spec for the owner to build in Phase C; **Brand C** = I build it in Phase C; **Declined** = with reason.

## shell (`collab/shell/review-design-system.md`)
| Item | Response |
|---|---|
| 1. Focus ring 2.0:1 | **Done.** New `focus-ring` / `focus-ring-within` utilities: solid 2px `ring` outline, 2px offset (≥ 7:1 on paper and card, both themes). Replaced every soft `ring-ring/40` halo in `components/ui`, `components/shared`, header and account menu. Inputs: solid 2px cobalt edge (`border-ring` + `ring-1 ring-ring`). Spec §9. |
| 2. faint-foreground < 4.5:1 | **Done.** Light `#706a5e` (5.1:1 card, 4.6:1 paper), dark `#958e80` (5.1:1 card, 4.6:1 popover). |
| Dense non-evidence row, states, 390 stacking | **Spec** §11.2 (56/44px, hover fill + revealed chevron, stacking). |
| 2px cobalt rule mandatory (selected row, active nav) | **Spec** §11.2, marked mandatory. |
| Lifecycle routing slip + state pill table | **Spec** §11.2 (5 stages; pills: Draft neutral, Processing primary + pulse, In review warning, Published success, Acknowledged outline + check). |
| Table band, sortable heads, row link, sticky head, empty/loading rows | **Spec** §11.2. Decision: **no** header band (heads on a `border-strong` rule); specimen already matches. |
| Summary list (app) | **Spec** §11.2. |
| Section with rule + danger annex | **Spec** §11.2. |
| Menu primitive | **Brand C** `components/ui/menu.tsx` (Base UI). AccountMenu will move onto it. |
| Radio group for Appearance | **Brand C** `components/ui/radio-group.tsx`; spec §11.1. |
| Compact PageHeader | **Spec** §11.2 (`type-title`); I'll add a `size="compact"` prop to `PageHeader` in Phase C. |
| EmptyState variants | **Spec** §11.2 (first-run, caught-up, no-results, error); prop added in Phase C. |
| Skeleton row | **Spec** §11.2; I'll add `SkeletonRow` to `skeletons.tsx` in Phase C. |
| Identity trigger (sidebar foot + rail) | **Spec** §11.2 (avatar on `muted`, not `primary-soft`). |
| Rail | **Spec** §11.2 (60px, 40px icon items, label on hover/focus, cobalt rule). |
| Relative time | **Spec** §11.2. |
| Hairlines always kept; popovers always bordered | **Spec** §11.2 ("Hairlines are structural"). |
| System theme mode | **Spec** §11.1: Light/Dark/System, radio group in Account; your layout.tsx diff welcome. |
| `ink` out of the app | **Spec** §11.1. |
| Reversible vs irreversible destructive | **Spec** §11.2 (Undo toast vs AlertDialog + type-to-confirm when others lose data). |
| §12 answers (14px primary, no condensed, mono only for structured values, sans group headings) | **Adopted** in §3. |

## handover (`collab/handover/review-design-system.md`)
| Item | Response |
|---|---|
| A1 Quotes not in mono (blocks) | **Done.** `type-quote` is now Instrument Sans 14px/1.6 (app); new `type-quote-reading` (Newsreader 16px, published); mono only in `type-exhibit` (short exhibits: landing, demo transcript). ₹: renders in Instrument Sans and Newsreader; emoji fall back to the system stack (spec §3). |
| A2 Quiet redaction default (blocks) | **Done.** `redact` = quiet (`mask-quiet` bar, mono token + number kept; 5.3:1 light, 6.7:1 dark, never the brightest thing in dark). `redact-strong` = ink box. `MaskedText variant="quiet" | "strong"` (default quiet). Spec: strong for landing, cover, demo transcript and always in print. |
| Request #4 accessible names | **Done** (`maskTokenLabel`, tested): "masked phone number 1"; visible token `aria-hidden`. Toggletip explanation: **Brand C**. |
| A3 quote-match has no span | **Adopted.** Only in the source viewer for the quoted message (`isQuoted`) and on the landing; slips carry the verification line. |
| A4 Acknowledgement = signature block (blocks) | **Adopted.** "acknowledge band" removed from `inverse`; inverse is marketing only. |
| A5 Decision bar (blocks) | **Spec** §11.3: adaptive primary, ≤ 2 secondary + overflow Menu, "3 of 14", 2-row mobile. |
| A6 Track sizes | **Adopted**: yours; principle stated (list is the widest track). |
| A7 Published width vs margin (blocks) | **Spec** §11.3: TOC 14rem · text ≤ 62ch · margin 14rem at ≥ 1280; TOC disclosure + inline notes 1024–1279; single column below. |
| A8 Meta-line wrap | **Spec** §11.3. |
| A9 Categories in rows | **Adopted**: sentence-case sans in rows; mono for table heads and short labels (§3). |
| A10 Subtler decision motion | **Spec** §11.3 (pill cross-fade + 4px slide; stamps only for verdict changes and headline moments). |
| A11 Colour-blind check | **Done.** Simulated (Machado 2009). Inferred vs warning was ΔE 4.1 under deuteranopia: **warning darkened** to `#9a4710` / `#d9803a` → 12.4 / 10.6. Sourced vs success ≥ 19.7, conflicting vs danger ≥ 38.7. Figures in spec §2.2. Shape still travels with colour. |
| B1 Transcript pattern | **Spec** §11.3 (time/author column, sans text, quiet redaction, quoted message marked + backlink, day dividers). |
| B2 Revision diff marks | **Spec** §11.3 (cobalt underline for inserted, muted strike for removed; never green/red). |
| B3 Gap register | **Spec** §11.3. |
| B4 Privacy-review rows | **Spec** §11.3 + §6.8 marker. You described keep/redact/remove + replacement text: build that; the row anatomy in §11.3 is the frame. |
| B5 Inline composer | **Spec** §11.3. |
| B6 No-collapse slip | **Spec** §11.3 (`collapse={false}`). |
| B7 Key facts with leaders | **Spec** §11.3: leaders in the document, compact strip in rows (as you proposed). |
| B8 Greyscale print | **Spec** §11.3; marks + edge styles + words survive greyscale; slip left rule prints (Phase C print stylesheet, re-check then). |
| B9 Stepper attention count | **Spec** §11.3. |

## demo (`collab/demo/review-design-system.md`)
| Item | Response |
|---|---|
| D1 Demo label looks like redaction | **Adopted** (§6.12): outline label, 1px foreground border, mono, `FlaskConical` icon, optional hatching. Solid ink = masked, only. |
| D2 Annotation in the 3-pane review | **Adopted** (§6.12): numbered marker on the target + note in a step-brief band; leaders only where there is margin. |
| D3 Shared sticky offset | **Done.** `--header-height` (4rem) and `--sticky-offset` tokens in `:root`; `scroll-padding-top` uses it. Spec §11.4. |
| D4 Cobalt strikethrough | **Adopted**: ink strike (`decoration-foreground/45`); the landing uses ink too. |
| S1 Motion per demo event | **Spec** §11.4 (approve = pill cross-fade, verdict change = stamp, edit → "Re-checking…", persona switch announced). |
| S2 Reduced-motion simulated run | **Spec** §11.4. |
| S3 Non-linear stepper | **Spec** §11.4. |
| S4 Persona not clickable unless it is; avatar not on primary-soft | **Spec** §11.4. |
| S5 End card "recorded in this browser only" | **Spec** §11.4. |
| S6 Grain scope | **Spec** §11.4 (intro and end card only). |
| Toast position on mobile | **Spec** §11.4: top-center below the sticky bars. |
| Coherence with the landing | **Done.** The landing content now mirrors `lib/demo/scenario` (Kabir → Neha, Priya reviewer; DevForge 30–31 Jan 2027, 11–2 vote; ₹100 fee conflict with the scenario quotes; Thursday inferred; Discord admin gap; GitHub owners without any credential token; masking example = Arjun's Orbitstack line with `[EMAIL_1]`/`[PHONE_1]`). File: `components/marketing/landing-content.ts`, with a TODO for the lead to point it at `@/lib/demo/scenario` at integration. No `[UPI_1]` or `[PASSWORD]` anywhere in my branch's landing or specimen. |

## Declined / deferred
- None declined. Items marked **Brand C** (Menu, RadioGroup, Toggletip, PageHeader compact, EmptyState variants,
  SkeletonRow) are Phase C work after the user approves the system at Checkpoint B.
