# Browser verification (Playwright MCP) — 2026-11-19

Tool: Playwright MCP (real browser interactions; separate isolated contexts per person). Preview: http://localhost:3110
(`next dev`, worker off, `BATON_SITE_URL=http://localhost:3110` set for the process; built-in test AI adapter —
the production build refuses it, see "Environment" below). Accounts: two fresh synthetic local accounts
(`r4-creator-1119@example.test`, `r4-incoming-1119@example.test`; password only in the git-ignored
`.env.r4-browser-qa.local`). Task 05 demo handovers untouched (checked read-only after the run).

## Results

| Area | Steps actually performed | Result |
|---|---|---|
| Landing vs loopsii.com (1440) | section map measured on both pages; hero and features compared; header links clicked | Structure and section heights match closely (intro, pinned problem, why, how it works, dark band, roadmap, CTA). **Defects found and fixed** (`95c6016`): compact header wrapped links when signed in (1440) and overflowed (390); header too translucent. Re-verified after rebuild. Anchor links scroll to their section below the header and move focus. No horizontal scroll at 390. Remaining deliberate differences: `landing/REFINEMENT_LOG.md`. |
| Sign-up | `/login` → email → Create an account | lands on `/dashboard` |
| Welcome + creator tour | welcome dialog → guided tour across `/dashboard` and `/handover/new` | completes. **Defect fixed** (`5a734ee`): counter read "1 of 6" then "2 of 5". |
| Onboarding persistence | reload `/dashboard`; read `auth.users.raw_user_meta_data.baton_onboarding` (read-only) | no dialog after reload; server state `{tour.creator.status: completed, welcomeSeenAt}` |
| Help menu | Replay the tour → Skip tour | replays from step 1; skip closes |
| Create handover | wizard: details → consent (3 statements) → sample data (2 files) → scope → Start processing | processing completes (~1 min), 4 points |
| Review | approve 4 points; inferred points need the "I know this to be true" confirmation | works; readiness shows blockers until all decided |
| Gap Interview | create link → answer 7 questions signed out (anon context) → creator accepts 7 (contact answer needs a contact name) | works; answers become 7 inferred points |
| Publish v1 | Publish dialog → Publish | Version 1 published with "first 7 days" plan |
| Invitation | Settings → Send a new link (old link revoked) → incoming opens `/h/<token>` signed out (address masked) → creates account → returns → Accept | lands on `/handover/<id>/published` with incoming welcome |
| Repeat / used invitation | same link as the accepted member; same link signed out | "You've already accepted this invitation" / "This invitation has already been used" |
| Incoming tour | 5 steps | "1 of 5" … "5 of 5", completes |
| Role boundaries (incoming) | nav; direct URLs review, gaps, changes, processing, settings | only Published in the handover nav; Review/Processing/Changes show "… is for reviewers"; Settings read-only ("Only the creator can invite"). **Defect fixed** (`d9acd00`): Gaps showed an empty manager. |
| Living Handover | Start a revision → New version (consent again) → Process the new version → Changes: 2 "possible contradictions" (fee reversal, domain move) → Correct the point ×2 (note required) → approve → Publish v2 | Version 2 published with both corrections; old wording gone. The new "book the auditorium" task was not flagged as new information (noted). |
| Phone width (390) | incoming published page; creator review page | no page-level horizontal scroll (the section chip row scrolls on purpose) |
| Missing provider configuration | creator Settings → Connected channels on a server without provider variables | "Not set up on this server" for all four. **Regression found and fixed** (`connected-channels.tsx`): the earlier canManage audit change had hidden these cards. |
| Re-acknowledge | incoming reads v2 → tick → Acknowledge handover | "Acknowledged" |

## Environment findings

* `.env.local` has `BATON_SITE_URL=http://localhost:3106` (an old preview port): invitation and Gap Interview links
  pointed at 3106. The 3110 process is started with `BATON_SITE_URL=http://localhost:3110` (env file unchanged).
* The fake/test AI adapter only runs with `NODE_ENV=development`, so processing on the production build (`next start`)
  is refused with "No AI provider is configured". For browser verification 3110 runs `next dev`. A judge-facing
  deployment needs a real, approved AI provider configuration.

## Screenshots (this folder)

`landing-1440-01-hero.png`, `landing-1440-evidence.png` (before fix), `landing-390-scrolled-header.png` (before fix),
`landing-1440-compact-header-fixed.png` (after), `app-creator-01-first-dashboard.png`,
`app-creator-03-processing-complete.png`, `app-incoming-01-welcome.png`, `app-living-02-published-v2.png` (full page),
`app-incoming-390-published.png`, `app-creator-390-review.png`, `app-connectors-not-configured.png`; and
`../connectors/connectors-07-slack-minimal-connect-1440.png` (current Slack wording, synthetic gallery).
Reference screenshots of loopsii.com were taken for comparison but are not committed (third-party site).
