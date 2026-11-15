# UI3 integration status

Lead-maintained. Agents report in their collab folder (`docs/design/collab/<name>/status.md` in the lead worktree);
the lead consolidates here.

## Phase
**A, Preparation** (started 2026-11-15). Only `brand` implements (landing + design-system proposal). `shell`,
`handover` and `demo` audit, research and plan; no UI implementation until Checkpoint B approval.

| Agent | Phase A task | Status | Depends on | Next |
|---|---|---|---|---|
| brand | Research doc; landing in Dossier direction; design-system proposal (tokens light/dark, type, components, motion) | Checkpoint B package ready (branch @ 6fdd253); lead re-verified: lint, tsc, npm test 2,103/2,102 pass/0 fail/1 todo; screenshots light+dark, 390/1440, reduced motion | — | Checkpoint A draft to the others, then Checkpoint B to the user |
| shell | Route audit; dashboard/app-shell research; implementation plan | Done; review sent (approve with changes: focus ring and faint-foreground contrast) | Design system (approval) | Review brand's proposal (Checkpoint A) |
| handover | Full handover-workflow audit; document/editorial UI research; implementation plan | Done; review sent (approve with changes A1, A2, A4, A5, A7 blocking; B1-B9 additions). Reuse contract agreed with demo; H-1..H-7 agreed with shell | Design system (approval) | Review brand's proposal (Checkpoint A) |
| demo | Demo audit; coherent CodeCell scenario; data + interaction + architecture plan | Done: 8079f5a scenario + dec6439 sample alignment (npm test 2,115/2,116 pass, 1 Docker todo); review sent (D1-D4) | Design system (visuals only) | Review brand's proposal (Checkpoint A) |

## Current: integrated and QA'd (D19)
- `ui3/integration` @ dd777dd + docs: lint, typecheck, npm test 2,152 (2,151 pass, 0 fail, 1 Docker todo), production build, smoke 18/18.
- Functional QA: `docs/design/qa/ui3-functional-qa.md` (8 fixes merged; 2 open items need a decision).
- Not pushed: waiting for the user to confirm Vercel Preview Deployments are off.

## Previous: landing identity (D18)
- brand → `ui3/agent1-identity` @ 207c495: AI-SLOP-AUDIT.md, three directions at `/design/directions`, chosen "Graphite & Highlighter" (Host Grotesk / Atkinson Hyperlegible Next / Atkinson Hyperlegible Mono) scoped to marketing routes. npm test 2,103/2,102/0 fail. Lead verified `/` and `/demo`: 1440/390, light/dark, no overflow, 0 console errors; the interactive evidence preview works.
- shell acknowledged the token set (dashboard adopts only after user approval).
- [~] Checkpoint B4 (awaiting the user): direction and landing preview.

## Previous: refine the earlier minimal landing and dashboard (D17)
- brand → `ui3/agent1-landing` (new, from master): polish master's landing; carry over cast, a11y and reduced-motion fixes.
- shell → `ui3/agent2-shell`: polish master's real `/dashboard` and `/preview/dashboard`; dashboard v2 stopped.
- Delivered: landing `ui3/agent1-landing` @ 9151eb0 (npm test 2,103/2,102/0 fail); dashboard `ui3/agent2-shell` @ d176e6b (npm test 2,115/2,114/0 fail). Lead verified both: no overflow, 0 console errors, 1440/390, light/dark.
- Lead approved shell's edit to `components/shared/__tests__/render-determinism.test.ts` (same intent, now checks DashboardView).
- Integration note: brand's token value changes (focus ring, success, warning, placeholder) apply app-wide; re-check dashboard and review screens after merging both.
- handover, demo: holding.
- [~] Checkpoint B3 (awaiting the user): revised landing + dashboard previews before any integration.

## Recovery milestone (D15/D16), superseded by D17, 2026-11-15
| Agent | Delivered | Branch head | Next |
|---|---|---|---|
| brand | `/design/variant-a` (immersive system) and `/design/variant-b` (editorial transfer) on :3101; "Harbour" app palette in design-system.md §0; Dribbble notes in research | `ui3/agent1-brand` @ d7754bf | Waits for the user's pick |
| shell | `/design/dashboard-preview` on :3102: new IA, pure `classify()` model + 10 tests, light + dark, 390/1024/1440 | `ui3/agent2-shell` @ 2943553 | On hold: real /dashboard and Light/Dark/System control wait for user approval |
| handover | Variant review (`collab/handover/review-variants.md`); brand accepted the carry-over rules | no code | Phase C after approval |
| demo | Cast swap 955d011; visual requirements in `collab/demo/visual-requirements.md` | `ui3/agent4-demo` @ 955d011 | Phase C after approval |

## Checkpoints
- [x] Checkpoint A (done): `brand` circulates the draft design system; `shell`, `handover`, `demo` send feedback; `brand` responds.
- [x] Checkpoint B: Dossier package rejected by the user (D15).
- [~] Checkpoint B2 (awaiting the user): landing variant A or B, Harbour palette, dashboard preview.
- ~~Checkpoint B (old)~~: user reviews the landing preview, screenshots, design system, tokens, motion spec, research.
- [ ] Phase C start: parallel implementation on the approved system.
- [ ] Checkpoint C: every UI agent reviews at least one other agent's completed work.
- [ ] Phase D: integration one branch at a time on `ui3/integration`; whole-product review; user approval before any merge to `master`.

## Issues outside UI3 scope (need a user decision)
- `lib/privacy` masker false positive (found by demo): "send the guest wifi codes last time" is masked as
  "codes [PASSWORD] time". Real chats will hit this. `lib/privacy` is off limits for UI agents.
- Found by handover (pre-existing): after a participant erasure, publish is blocked by `privacy_review_required` and no UI
  calls the resolve action (P0 in handover's Phase C plan; uses the existing action, no backend change expected).
- Dev-only `/preview/processing?state=running` calls the real `continueProcessing` action (handover fixes in Phase C).

## Git
`master` (production) = `c781620`, untouched. All UI3 branches are local only (not pushed): no Vercel builds, no deploys.
