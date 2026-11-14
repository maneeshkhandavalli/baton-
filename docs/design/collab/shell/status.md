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

Waiting on: `brand` design-system draft (Checkpoint A) → I'll write `review-design-system.md`.
Need from lead: ownership of `config/navigation.ts` (`workspaceNav`/`accountNav`) and `hooks/use-theme.ts`; additive
`routes.accountPassword`; confirm `lib/theme.ts` + `public/theme-init.js` are mine; test globs in `test:ui`; decision on
default theme (System vs Light); OK for the sidebar "Open handovers" read.
Blockers: none.
