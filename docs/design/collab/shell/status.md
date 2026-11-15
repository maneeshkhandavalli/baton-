# shell status

Phase A: audit, research and plan **done** (2026-11-15). No code edits.

- `audit.md`: every route in `app/`, shell/dashboard/account/auth/theme/error findings with IDs, responsive + light/dark
  checks, cross-cutting flags (§10).
- `research.md`: dashboard/app-UI references (Linear, Readwise Reader, Mercury, Basecamp, GOV.UK, Ironclad/Juro,
  Things, Are.na, Primer, web.dev) and how each maps to Dossier.
- `plan.md`: shell/nav (desktop, rail, mobile), dashboard hierarchy + classification table, account, auth, theme
  (light/dark/system, no flash), errors/404, a11y, tests, files, requests to brand (§9) and lead (§10), risks.

Messages: flags sent to `handover` (H-1…H-7, **agreed** in reply, folded into plan) and `brand` (B-1…B-5, ready for
Checkpoint A).

Checkpoint A: **done**. `review-design-system.md` (approve with changes: focus ring 2.0–2.3:1 and faint-foreground
<4.5:1 must change, plus missing app-side specs) sent to `brand`, cc `main`.
Phase A complete; stopped. Next (Phase C, after Checkpoint B): handoverNav move commit first, then plan §12.
Lead ruling D8: `config/navigation.ts` is mine; first Phase C task = move `handoverNav` to `config/handover-navigation.ts`
(handover-owned), no behaviour change.
Lead rulings D10-D12 (recorded): default theme = System (provisional until Checkpoint B); sidebar "Open handovers"
approved (one streamed listMyHandovers, no new query); theme logic (`hooks/use-theme.ts`, `lib/theme.ts`,
`public/theme-init.js`) is mine, THEME_COLOR values stay brand's; `lib/routes.ts` mine for additive entries
(`routes.accountPassword` approved); `test:ui` glob addition approved in my branch only.
Phase C (opened by lead): dev-only dashboard redesign preview at http://localhost:3102/design/dashboard-preview
(commits 4e7fee6, 2943553), pure model `components/dashboard/model.ts` + tests; handoverNav move 8d97c44 (sent to
handover).
Direction (lead, user): refine master's dashboard in place, keep it simple. Done on ui3/agent2-shell:
5f672b5 (Dashboard current on /handover/[id]/*, tested), d176e6b (Up next panel from classify, status wording,
points-decided progress, draft step N of M, first-run steps, skeleton, wider layout; /preview/dashboard renders the
same components via the shared loader). v2 experiment parked in 0311c13 (not extended). Research:
research-dashboard-v2.md. Screenshots: .claude/ui3/shots/shell/v3/.
Lead verified v3 and approved the render-determinism.test.ts change. ON HOLD until the user reviews.
Blockers: none.
