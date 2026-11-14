# demo status

**Update (user direction, 2026-11-15):** cast is **Priya Raman → Neha Kulkarni**; Kabir Shah (president, reviewer) and
teammates appear in the chats. Commit `955d011` on `ui3/agent4-demo` swaps the scenario and the aligned lib/prototype
sample points; scenario.md and plan.md updated. Full npm test: 2116 tests, 2115 pass, 0 fail, 1 todo; tsc and lint clean.
Next: when brand's /design/variant-a and /design/variant-b (:3101) and shell's /design/dashboard-preview (:3102) are up,
review them and send demo-specific visual requirements (step rail, preview labels, mobile). Not up yet (404/500 at
last check). No visual implementation; no own design system.

Phase A **done**, 2026-11-15. Stopped, waiting for the lead.

- [x] `audit.md`: current /demo wiring, two contradictory CodeCell datasets, timeline errors, missing journey steps,
      reuse hazards (ProcessingView calls continueProcessing; wizard step exports bundle server actions).
- [x] `scenario.md`: one CodeCell story (now Priya Raman → Neha Kulkarni, Kabir reviews; user direction): cast, timeline,
      3 sources, 21 points (17 sourced / 1 inferred / 1 conflicting / 2 missing), corrections, v1, Neha, Gap Interview, v2.
- [x] `plan.md`: client-only sandbox, engine and selectors over `lib/mocks/derive`, isolation guarantees (import-graph
      test, no network, runtime POST check), labels, interactions per step, tests, requests, risks, open decisions.
- [x] Reuse contract with `handover`: **agreed**, including `ReviewActions.startRevision?`. Delivery in their Phase C.
- [x] Checkpoint A: `review-design-system.md` sent to `brand` (cc `main`). Approve with changes; must-fix D1–D4
      (demo label looks like a redaction chip; annotation placement; sticky offset; cobalt strikethrough) and landing coherence.
- [x] Branch `ui3/agent4-demo` (local, not pushed): `8079f5a` scenario data + 14 tests; `dec6439` lib/prototype samples
      aligned with the scenario + lib/demo tests in `test:ui` (lead-approved). Full `npm test`: 2116 tests, 2115 pass,
      0 fail, 1 todo (Docker-gated suites skip). `tsc --noEmit` and `npm run lint` are clean. No UI yet.

`brand` adopted D1–D4 and S1–S6 (collab/brand/review-responses.md, commit 8f401c2): outline demo label with FlaskConical, numbered marker + step-brief band, `--header-height`/`--sticky-offset` tokens (raise on the demo wrapper), ink strikethrough, `MaskedText variant="strong"`; landing copy now mirrors lib/demo/scenario (verified: no [PASSWORD]/[UPI_1]). Lead rulings on plan §10 recorded (step 4 = published view in reviewer preview; one sandbox, no separate tour, "skip to the finished handover", /demo stays). Open for Phase C:
`handover`'s view split (their Phase C) before steps 3–6.
Blockers: none.
