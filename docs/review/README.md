# Round 4 review guide

One preview, one clone: `C:\Users\manee\Documents\programing\baton-r4-main`, branch `work/r4-integration`.
Preview: **http://localhost:3110** (production build, `next start`, job worker off). Restart it from that clone with
`npm run build` then `BATON_DEV_WORKER=0 npx next start -p 3110`.

The signed-in parts use the local Supabase stack `baton-dev` (127.0.0.1:54321). When it is down, every workspace
route redirects to `/login` and sign-in fails; the landing, `/demo` and `/login` still work. The connector
migrations are NOT applied to `baton-dev`, so the Connected channels panel can only show "Not set up on this server"
there (live connector testing needs the isolated database, `docs/operations/ISOLATED_DB_PROPOSAL.md`).

## Where each experience lives

| Experience | In the preview | Account | Screenshots |
|---|---|---|---|
| Landing (Loopsii-structured) | `/` — header anchors How it works, Evidence, Privacy, For the nerds, Demo; scroll for problem → receipt → steps → evidence → Living Handover → privacy → roadmap → For the nerds → close | no | `landing/final-{390,768,1024,1440}-*.png`, earlier passes `landing/pass*`, decisions `landing/REFINEMENT_LOG.md` |
| Demo (no account) | `/demo` → "Enter the demo" → `/demo/workspace?step=sources…receive` | no | — |
| Sign in / create account | `/login` (email + password locally; email confirmation is off in the local stack) | — | — |
| Welcome + creator tour | first visit to `/dashboard` as a new account; replay from **Help** in the sidebar | creator | `app/creator-*` |
| Getting Started checklist | `/dashboard` (`#getting-started`); reflects real state (handover created, sources added, reviewed, invited, published) | creator | `app/checklist-*` |
| Creator journey | `/dashboard` → **New handover** → sources → consent → processing → review (`/handover/<id>/review`) → gaps → Settings → Members (invite) → publish | creator | — |
| Living Handover (update after publishing) | a published handover → add or replace a source in Settings → Sources → processing → **Changes** (`/handover/<id>/changes`) shows what changed since the publication → review → publish the new version. Task 05 demo handovers "Living Handover demo: …" are in this state (owner signs in to the demo accounts) | creator | — |
| Incoming member | invitation link `/h/<token>` → accept → `/handover/<id>/published`; welcome + incoming tour; only the Published tab; acknowledge | invited account | `app/incoming-*` |
| Contextual help | "?" buttons at wizard, processing, review, point detail and settings headings; **Help** menu in the sidebar | yes | `app/help-*` |
| Connected channels (real) | `/handover/<id>/settings#connectors` (creator) — "Not set up on this server" until provider variables are set | creator | `connectors/01-not-configured-1440.jpg` |
| Connected channels (all states, synthetic) | dev-only `/preview/connectors?scenario=not-configured\|connect\|pick-channel\|consent\|capturing\|attention\|github` (not served by the production preview; run `npx next dev` in the clone) | no | `connectors/02…06-*.jpg` |
| Onboarding previews (synthetic) | dev-only `/preview/dashboard?guide=new&checklist=show` and other `/preview/*` | no | `app/*` were taken there |

## Verification status (keep honest)

| Area | Implemented | Automated tests | Browser verified | Live provider |
|---|---|---|---|---|
| Landing | yes | — | screenshots at 390/768/1024/1440 from build `c2817d9` (landing code unchanged since); live comparison with loopsii.com in this session not possible: Chrome extension disconnected | — |
| Onboarding (welcome, tours, checklist, help, persistence) | yes | ui + actions suites | synthetic previews only; signed-in run pending | — |
| Creator / incoming journeys, invitations (Task 06) | yes | actions, integration, SQL suites | pending signed-in run on 3110 | — |
| Living Handover | yes (Task 05) | pipeline, SQL suites | pending on 3110 | — |
| Connectors (GitHub, Discord, Telegram, Slack) | yes | connectors suite (synthetic) | fixture gallery only | **none yet** — needs isolated DB, tunnel and credentials |

## Screenshot currency

* `landing/final-*` match the current landing code (no landing change after `c2817d9`).
* `app/*` were taken on synthetic `/preview/*` routes; the onboarding components are unchanged since, except the
  build fix that removed `usePathname` from the guidance provider (no visual change).
* `connectors/01…06` predate `0e3836d` (Slack wording); `connectors/07-slack-minimal-connect-1440.png` shows the
  current Slack card. Browser-run evidence for the app journeys: `browser/VERIFICATION.md` and `browser/*.png`.

## Connector setup

`docs/connectors/CHECKLIST.md` (owner checklist, exact values), per-provider guides in `docs/connectors/`,
`SLACK_SCOPE_AUDIT.md` (minimal default implemented) and `ISOLATED_DB_PROPOSAL.md`.
