# demo status

Phase A **done**, 2026-11-15. Stopped, waiting for the lead.

- [x] `audit.md`: current /demo wiring, two contradictory CodeCell datasets, timeline errors, missing journey steps,
      reuse hazards (ProcessingView calls continueProcessing; wizard step exports bundle server actions).
- [x] `scenario.md`: one CodeCell story (Kabir Shah → Neha Kulkarni, Priya reviews; lead-confirmed): cast, timeline,
      3 sources, 21 points (17 sourced / 1 inferred / 1 conflicting / 2 missing), corrections, v1, Neha, Gap Interview, v2.
- [x] `plan.md`: client-only sandbox, engine and selectors over `lib/mocks/derive`, isolation guarantees (import-graph
      test, no network, runtime POST check), labels, interactions per step, tests, requests, risks, open decisions.
- [x] Reuse contract with `handover`: **agreed**, including `ReviewActions.startRevision?`. Delivery in their Phase C.
- [x] Checkpoint A: `review-design-system.md` sent to `brand` (cc `main`). Approve with changes; must-fix D1–D4
      (demo label looks like a redaction chip; annotation placement; sticky offset; cobalt strikethrough) and landing coherence.
- [x] Branch `ui3/agent4-demo` (local, not pushed): `8079f5a` scenario data + 14 tests; `dec6439` lib/prototype samples
      aligned with the scenario + lib/demo tests in `test:ui` (lead-approved). Full `npm test`: 2116 tests, 2115 pass,
      0 fail, 1 todo (Docker-gated suites skip). `tsc --noEmit` and `npm run lint` are clean. No UI yet.

Open for Phase B: the lead's answer on plan §10 (step 4 form, read-only tour entry); `brand`'s response to D1–D4;
`handover`'s view split (their Phase C) before steps 3–6.
Blockers: none.
