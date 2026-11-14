# demo status

Phase A, 2026-11-15.

- [x] `audit.md`: current /demo wiring, two contradictory CodeCell datasets, timeline errors, missing journey steps,
      reuse hazards (ProcessingView calls continueProcessing; wizard step exports bundle server actions).
- [x] `scenario.md`: one CodeCell story (Kabir Shah → Neha Kulkarni), cast, timeline, 3 sources, 21 points
      (17 sourced / 1 inferred / 1 conflicting / 2 missing), corrections, v1, Neha's view, Gap Interview, v2.
- [x] Scenario DATA on `ui3/agent4-demo` (commit `8079f5a`): `lib/demo/scenario/*` and `lib/demo/__tests__/scenario.test.ts`
      (14 passing, real parser and masker). `tsc --noEmit` and `npm run lint` are clean. No UI.
- [x] `plan.md`: client-only sandbox, engine and selectors over `lib/mocks/derive`, isolation guarantees, labels,
      interactions per step, tests, requests, risks.
- [x] Reuse contract with `handover`: agreed (pure views with action interfaces, ProcessingStatusView, wizard step
      modules, storage and link props, data-tour anchors). Open: who exposes startRevision (asked).
- [ ] Checkpoint A: waiting for `brand`'s design-system draft (told `brand` I'm ready).

Requests to `main`: add `lib/demo/__tests__/*.test.ts` to `test:ui`; list `components/gap-interview/**` under `handover`;
masker false positive ("guest wifi codes last time" → `[PASSWORD]`); confirm the Kabir → Neha cast; approve the Phase B
alignment of `lib/prototype` samples (their tests are outside my paths).
Blockers: none.
