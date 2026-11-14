# handover requests (files I do not own)

| # | To | File(s) | What | Why | State |
|---|---|---|---|---|---|
| 1 | `main` | `docs/design/agent-ownership.md` | Add `components/gap-interview/**` to handover. | It is the Gap Interview (`/g/[token]`). | **Granted** (lead, D8/D9) |
| 2 | `main` | `config/navigation.ts` | Handover tabs ownership. | Role- and state-aware tabs (audit X-8). | **Ruled**: shell keeps `config/navigation.ts`; at the start of Phase C shell moves `handoverNav` into `config/handover-navigation.ts`, which becomes mine (move coordinated with shell). `config/status.ts` goes to brand. |
| 3 | `main` | new `app/(workspace)/handover/[id]/review/source-context.ts` | Read-only `"use server"` wrapper over `getQueries().getSourceMessageContext`. | Source viewer (audit X-3, plan §2.2). | **Approved for Phase C** (validate with `uuidSchema`, clamp to `MESSAGE_CONTEXT_MAX`, verified session, no writes, tests) |
| 4 | `brand` | `components/shared/masked-text.tsx` | Give each mask token an accessible name ("masked phone number 1"), add a keyboard- and touch-reachable explanation (not `title`), and apply the typed-redaction look. Keep the `MaskedText` export, the props, and the excluded-participant behaviour (`it04-ui-escaping`). | Audit X-6. | Open (raised at Checkpoint A) |
| 5 | `brand` | `components/shared/status-badge.tsx`, `components/ui/badge.tsx`, `config/status.ts` | Evidence stamps distinct from review signatures and system tones; "Acknowledged" state tone matching the others (shell H-7). | D5, audit R-17. | Open |
| 6 | `main` (later, not blocking) | data contract | Possible additive reads: per-member acknowledgement time, publication changelog, gap-link expiry on `/g`. | Audit PB-4, PB-7, I-2. UI shows honest "asked"/"not available" states until then. | Note only |
