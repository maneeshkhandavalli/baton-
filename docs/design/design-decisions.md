# UI3 design decisions

Every decision that other agents must follow. Proposing a change to an approved decision: discuss it with the affected
agents and the lead first (collab notes + messages), then the lead records the outcome here.

| # | Date | Decision | Rationale | Status |
|---|---|---|---|---|
| D1 | 2026-11-15 | Direction **B, Dossier** is the foundation: warm cream/parchment neutrals, deep ink, editorial serif headings, restrained cobalt accent, monospace metadata, layered document cards. | User selection after reviewing A/B/C/D (`app/(design-lab)/design/*`). | Approved by user |
| D2 | 2026-11-15 | The concept is a starting point, not a spec. It must become modern, premium and distinctive, archival without looking old-fashioned; rich through composition, type, texture, depth and interaction; never generic SaaS, gradients, glassmorphism or decorative motion. | User brief. | Approved by user |
| D3 | 2026-11-15 | Agent 1 proposes the design system (tokens light+dark, type, spacing, surfaces, components, motion, responsive). Agents 2-4 review it at Checkpoint A. It is not final until the user approves it at Checkpoint B. No other agent picks colours, fonts or component treatments before then. | User brief, phases A-C. | Approved by user |
| D4 | 2026-11-15 | Dark mode is designed, not inverted. | User brief. | Approved by user |
| D5 | 2026-11-15 | Semantic token names stay stable; new tokens are added. Evidence-status colours stay distinct from system colours (conflicting ≠ destructive). | Every screen depends on the names; earlier audit found the overlap confusing. | Lead |
| D6 | 2026-11-15 | Motion explains the product (state changes, evidence, transformation) and always has a reduced-motion equivalent. Prefer CSS scroll-driven animation; `framer-motion` and `lenis` are available; new animation libraries need lead approval. | User brief; performance. | Lead |
| D7 | 2026-11-15 | Future features (Discord/Telegram bots, Ask the Handover, Living Handover) appear only later, only as clearly labelled previews. | User brief. | Approved by user |
| D8 | 2026-11-15 | Ownership additions: `components/gap-interview/**` → handover; `config/status.ts` → brand; `config/navigation.ts` → shell, which splits `handoverNav` into `config/handover-navigation.ts` (→ handover) first thing in Phase C. | One owner per file; nav is shell's, the evidence vocabulary is the design system's. | Lead |
| D9 | 2026-11-15 | Approved: read-only `source-context.ts` server wrapper over the existing `getSourceMessageContext` query, so reviewers can see the messages around a quote. No backend, schema or contract change. | Existing query, unused by any screen; read-only; verified session. | Lead |
| D10 | 2026-11-15 | Default theme for visitors with no saved choice: **System** (follows the OS), with Light/Dark/System choice, no flash, persisted. | Respects OS preference; both themes are designed (D4). | Lead, provisional: user confirms at Checkpoint B |
| D11 | 2026-11-15 | Workspace sidebar may show "Open handovers" via ONE extra existing `listMyHandovers` read per workspace navigation, streamed (Suspense), user-scoped (RLS). No new query or backend change. | Navigation into active work; cost acceptable. | Lead |
| D12 | 2026-11-15 | shell owns theme logic (`hooks/use-theme.ts`, `lib/theme.ts`, `public/theme-init.js`, brand keeps `THEME_COLOR` values) and additive `lib/routes.ts` entries (e.g. `routes.accountPassword`). Agents may add their own test folders to `test:*` globs in their branch; lead reconciles. | One owner per file. | Lead |
