# UI3 agent ownership and boundaries

Round: **UI3** (the user's "Round 3" UI overhaul). Branch prefix `ui3/` (the older `archive/r3/*` and
`integration/round3` branches belong to an earlier internal round and are not touched).
Baseline: production `master` at `c781620`. Integration branch: `ui3/integration` (lead).

| Agent | Name (for messages) | Branch | Worktree (absolute) | Dev port |
|---|---|---|---|---|
| Lead / orchestrator | `main` | `ui3/integration` | `<repo>/.claude/worktrees/ui3-lead` | 3100 (integration review) |
| 1 Landing, brand, design system | `brand` | `ui3/agent1-brand` | `.../.claude/worktrees/ui3-agent1-brand` | 3101 |
| 2 Dashboard, app shell, account, theme | `shell` | `ui3/agent2-shell` | `.../.claude/worktrees/ui3-agent2-shell` | 3102 |
| 3 Handover creation, review, report, Gap Interview | `handover` | `ui3/agent3-handover` | `.../.claude/worktrees/ui3-agent3-handover` | 3103 |
| 4 Demo experience | `demo` | `ui3/agent4-demo` | `.../.claude/worktrees/ui3-agent4-demo` | 3104 |

Start a dev server for a worktree with `node <repo>/.claude/ui3/dev.mjs <worktree> <port>`
(baton-dev only, processing worker off, no env values printed). `npm ci` in the worktree first.

## File ownership (one owner per path; everyone may READ everything)

**Agent 1 `brand`**
- `app/globals.css` (all tokens, light and dark), `app/layout.tsx` (fonts, root metadata, theme bootstrapping markup)
- `components/ui/**` (shared primitives: button, input, select, dialog, badge, alert, table, tabs, card, field, …)
- `components/shared/**` except `theme-toggle.tsx` (brand atoms: logo, status badge, fade-in, page header, skeletons, empty state, …)
- `components/marketing/**` except `demo-tabs.tsx`; `app/(marketing)/layout.tsx`, `app/(marketing)/page.tsx`
- Public header/footer: `components/layout/site-header.tsx`, `site-footer.tsx`, `header-account.tsx`, `account-menu.tsx`
- `docs/design/design-system.md`, `docs/history/design/research/**`, `public/**` brand assets, `app/icon*`, `app/opengraph-image*`
- `config/status.ts` (evidence-label tones, labels and descriptions: part of the design system)
- `lib/fonts.ts` (font definitions used by `app/layout.tsx`)
- In `lib/theme.ts` and the generated `public/theme-init.js`: ONLY the `THEME_COLOR` values (they must equal `--background`,
  a test pins them). The theme logic in those files stays `shell`'s.

**Agent 2 `shell`**
- `components/layout/**` except the four public header/footer files above (app shell, workspace nav, page container, …)
- `app/(workspace)/layout.tsx`, `app/(workspace)/dashboard/**`, `app/(workspace)/account/**`
- `components/dashboard/**`, `components/account/**`, `components/auth/**`, `app/(auth)/**`
- `components/shared/theme-toggle.tsx` and theme behaviour (provider wiring), `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`
- Theme logic: `hooks/use-theme.ts`, `lib/theme.ts`, `public/theme-init.js` (except brand's `THEME_COLOR` values)
- `lib/routes.ts`: additive entries only (no renames or removals without lead approval); others request new routes from shell
- `config/navigation.ts`. First Phase C task: move `handoverNav` into a new `config/handover-navigation.ts` owned by `handover`
  (coordinated with `handover`; no behaviour change)
- `app/(preview)/preview/dashboard/**`

**Agent 3 `handover`**
- `app/(workspace)/handover/**`, `app/(token)/**`
- `components/wizard/**`, `components/review/**`, `components/handover/**`, `components/gaps/**`, `components/processing/**`,
  `components/published/**`, `components/settings/**`, `components/sources/**` (if present), `components/gap-interview/**`
- `config/handover-navigation.ts` (after `shell` creates it in Phase C)
- Approved new file: `app/(workspace)/handover/[id]/review/source-context.ts`, a read-only `"use server"` wrapper that
  only calls the existing `getQueries().getSourceMessageContext` (input validated with the existing contract schema,
  verified session via the facade, no writes, tests added)
- `app/(preview)/preview/**` except `dashboard/**`; `components/preview/**`

**Agent 4 `demo`**
- `app/(marketing)/demo/**`, `components/marketing/demo-tabs.tsx`, `components/demo/**` (new)
- `lib/demo/**` (new home for demo-only fixture data and demo behaviour), `lib/prototype/**`
- Reads `lib/mocks/**` freely; changes to `lib/mocks/**` (also used by previews and tests) only after agreement with `handover` and the lead.

**Lead `main`**
- `docs/history/design/agent-ownership.md`, `integration-status.md`, `design-decisions.md`, `design-reviews.md`
- `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, test infrastructure, CI files
- Integration merges on `ui3/integration`

**Nobody (off limits without explicit user approval)**: `lib/db/**`, `lib/actions/**`, `lib/supabase/**`, `lib/ai/**`,
`lib/pipeline/**`, `lib/privacy/**`, `lib/contracts/**`, `supabase/**`, migrations, `proxy.ts`, environment files, auth flows,
storage, Vercel configuration. UI agents call existing actions and queries exactly as they are.

## Rules
1. Work and run git ONLY inside your own worktree. Commit to your own branch locally; never push, never merge, never
   touch `master`, never force anything.
2. Need a change in a file you do not own? Write a request in your collab folder and message the owner (and `main`).
   The owner makes the change. If it is urgent and blocking, the lead decides.
3. New dependencies need lead approval first (`package.json` is lead-owned). Exception granted: an agent may add ITS OWN
   test folder to the matching `test:*` glob in its branch (single-line change); the lead reconciles these at integration. Prefer CSS scroll-driven animation,
   `framer-motion` and `lenis`, which are already installed.
4. Keep semantic token NAMES stable (`--background`, `--foreground`, `--card`, `--primary`, `--status-*`, …). Add new
   tokens rather than renaming; every screen depends on them.
5. No secrets in logs, docs or messages. Synthetic data only. No external side effects.
