# UI3 integration status

Lead-maintained. Agents report in their collab folder (`docs/design/collab/<name>/status.md` in the lead worktree);
the lead consolidates here.

## Phase
**A, Preparation** (started 2026-11-15). Only `brand` implements (landing + design-system proposal). `shell`,
`handover` and `demo` audit, research and plan; no UI implementation until Checkpoint B approval.

| Agent | Phase A task | Status | Depends on | Next |
|---|---|---|---|---|
| brand | Research doc; landing in Dossier direction; design-system proposal (tokens light/dark, type, components, motion) | Starting | — | Checkpoint A draft to the others, then Checkpoint B to the user |
| shell | Route audit; dashboard/app-shell research; implementation plan | Starting | Design system (approval) | Review brand's proposal (Checkpoint A) |
| handover | Full handover-workflow audit; document/editorial UI research; implementation plan | Starting | Design system (approval) | Review brand's proposal (Checkpoint A) |
| demo | Demo audit; coherent CodeCell scenario; data + interaction + architecture plan | Starting | Design system (visuals only) | Review brand's proposal (Checkpoint A) |

## Checkpoints
- [ ] Checkpoint A: `brand` circulates the draft design system; `shell`, `handover`, `demo` send feedback; `brand` responds.
- [ ] Checkpoint B: user reviews the landing preview, screenshots, design system, tokens, motion spec, research.
- [ ] Phase C start: parallel implementation on the approved system.
- [ ] Checkpoint C: every UI agent reviews at least one other agent's completed work.
- [ ] Phase D: integration one branch at a time on `ui3/integration`; whole-product review; user approval before any merge to `master`.

## Git
`master` (production) = `c781620`, untouched. All UI3 branches are local only (not pushed): no Vercel builds, no deploys.
