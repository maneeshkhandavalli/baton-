# Round 4 review guide

One preview, one clone: `C:\Users\manee\Documents\programing\baton-r4-main`, branch `work/r4-integration`.
Preview: **http://localhost:3110** (production build, `next start`, job worker off). Restart it from that clone with
`BATON_DEV_WORKER=0 npx next start -p 3110` after `npm run build`.

The signed-in parts need the local Supabase stack (127.0.0.1:54321). When it is down, every workspace route redirects
to `/login` and sign-in fails; the landing, `/demo` and `/login` still work.

## Where each experience lives

| Experience | In the preview | Needs a signed-in account | Screenshots |
|---|---|---|---|
| Landing (Loopsii reconstruction) | `/` (anchors: How it works, Evidence, Privacy, For the nerds) | no | `landing/final-{390,768,1024,1440}-*.png`, passes in `landing/pass*`, log `landing/REFINEMENT_LOG.md` |
| Demo (no account) | `/demo` → "Enter the demo" → `/demo/workspace?step=sources…receive` | no | — |
| Sign in / create account | `/login` ("Sign in or create an account") | — | — |
| Welcome + guided tour (creator) | first visit to `/dashboard` as a new creator; replay from **Help** in the sidebar | yes | `app/creator-*.{jpg,png}` |
| Getting Started checklist | `/dashboard` (`#getting-started`) | yes | `app/checklist-*`, `app/incoming-07-checklist-desktop.jpg` |
| Creator journey | `/dashboard` → New handover → sources → consent → processing → review → gaps → Settings → Members (invite) → publish | yes | — (live run blocked, see report) |
| Incoming member | invitation link `/h/<token>` → accept → `/handover/<id>/published`; welcome + incoming tour; only the Published tab | yes (invited account) | `app/incoming-*` |
| Contextual help | "?" buttons at wizard, processing, review, point detail and settings headings | yes | `app/help-*` |
| Connected channels (real) | `/handover/<id>/settings#connectors` (creator) — shows "Not set up on this server" until provider env vars are set | yes | `connectors/01-not-configured-1440.jpg` |
| Connected channels (all states, synthetic) | dev-only `/preview/connectors?scenario=…` (not served by the production preview; run `npx next dev` in the clone) | no | `connectors/02…06-*.jpg` |
| Onboarding previews (synthetic) | dev-only `/preview/dashboard?guide=new&checklist=show` and other `/preview/*` | no | `app/*` were taken there |

## Connector setup

`docs/round4/setup/CHECKLIST.md` (owner checklist, exact values) and the per-provider guides in `docs/round4/setup/`.
