# Design system draft (Checkpoint A), brand, 2026-11-15

**Spec:** `C:/Users/manee/Documents/programing/baton/.claude/worktrees/ui3-agent1-brand/docs/design/design-system.md`
(branch `ui3/agent1-brand`, commit "docs(design-system): UI3 Dossier spec, Checkpoint A draft").
**Live specimen (light + dark side by side, real components):** http://localhost:3101/design/system (dev only).
**Screenshot:** `C:/Users/manee/Documents/programing/baton/.claude/ui3/shots/brand/system/specimen-checkpoint-a.jpg`.
**Tokens:** `app/globals.css` · **fonts:** `lib/fonts.ts` · **new atoms:** `components/shared/evidence-mark.tsx`, `evidence-stamp.tsx`.

## In one screen
- **Material:** parchment paper `#f2ede3`, warm-white sheets `#fbf9f4`, deep ink `#1a1915`, one restrained cobalt `#2b48a0`.
  Dark = "the archive at night": graphite `#12110e`, sheets `#201e19`, popovers `#2a2721`, parchment ink `#ede7da`, cobalt `#93a7f2`.
- **Type:** Newsreader (serif, optical sizing) to READ · Instrument Sans to OPERATE · IBM Plex Mono to RECORD (quotes, metadata, eyebrows).
- **Evidence** hues moved apart from system hues: sourced verdigris vs success leaf green; conflicting madder vs danger brick;
  inferred ochre vs warning burnt orange; missing slate. Every status also has a SHAPE (EvidenceMark: disc, half, split, dashed ring)
  and an edge style (tag: dashed for inferred/missing; stamp: solid/dashed/double/dotted).
- **Three evidence forms:** `StatusBadge` (dense tag) · `EvidenceStamp` (headline verdict) · `EvidenceMark` (glyph). Reviewer
  decisions are system tones with a name ("Approved · Priya"), never evidence colours.
- **New tokens (names of existing tokens unchanged):** `sunken`, `track`, `faint-foreground`, `mask`/`mask-foreground`, `highlight`,
  `shadow-sheet`, `--duration-fast|base|slow|story`, `ease-exit`. New roles: `type-display-xl`, `type-lede`, `type-reading`, `type-meta`.
- **Material utilities:** `paper-grain`, `ruled`, `leader`, `redact`, `quote-match`, `crop-marks`, `stamp` (each with a stated meaning).
- Radius 10px → 6px (crisper). No blur, no gradients, opaque sticky bars.
- All text pairs checked: body 15:1, muted ≥ 6.2:1, every tone fg/soft ≥ 5.4:1 light, ≥ 8:1 dark; control borders ≥ 3.5:1.

## Already folded in from early input
- shell B-1: `RouteError` now takes `retry` (Next 16) with `reset` fallback, `error: unknown`. Owners of each `error.tsx` can pass `retry`.
- shell B-2: wider dark surface steps; `track` token for meters (0% visible); progress + readiness ring use it.
- shell B-4: AccountMenu stays one component in `components/layout/account-menu.tsx`; shell may import it in the app shell.
- shell B-5: spec forbids translucent/blur bars and radial glows.
- handover's 7 needs: each has a section in spec §6 (slip anatomy §6.4, stamps vs decisions §6.4, redaction §6.5 incl. accepted
  request #4, document primitives §6.3, dense row/decision bar/conflict ledger/privacy hold §6.4–6.10, sheet/stepper/gates/stages/
  toggletip/copy field §6.2, 6.6, 6.9, dark tints §2.3).

## Please review from your area (write `collab/<you>/review-design-system.md`, message me)
- **shell:** data-heavy dashboard and app shell; dark-mode completeness; Instrument Sans at 13px; mono eyebrows in tables.
- **handover:** complex report with evidence references; slip/conflict ledger anatomy; redaction loudness in long quotes; print.
- **demo:** interactive demo; motion vocabulary (§7) and what you need to animate state changes; anything missing.
- Open questions are in spec §12.
