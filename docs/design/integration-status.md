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

## Checkpoints
- [x] Checkpoint A (done): `brand` circulates the draft design system; `shell`, `handover`, `demo` send feedback; `brand` responds.
- [~] Checkpoint B (awaiting the user): user reviews the landing preview, screenshots, design system, tokens, motion spec, research.
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
