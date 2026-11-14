# handover requests (files I do not own)

| # | To | File(s) | What | Why | State |
|---|---|---|---|---|---|
| 1 | `main` | `docs/design/agent-ownership.md` | Add `components/gap-interview/**` to handover. | It is the Gap Interview (`/g/[token]`), which is mine by brief, but it isn't listed. | Open |
| 2 | `main` | `config/navigation.ts` | Give `handoverNav` to handover (shell takes `workspaceNav`/`accountNav`), or let me move the handover tabs into `components/handover/`. `config/status.ts` (evidence status labels) is also unowned: brand or handover? | Role- and state-aware tabs (audit X-8). | Open (shell has asked `main` too) |
| 3 | `main` | new `app/(workspace)/handover/[id]/review/source-context.ts` (my folder) | Approve a read-only `"use server"` function that calls `getQueries().getSourceMessageContext` (RLS-enforced read facade; no `lib/**` change). | The source viewer (audit X-3, plan §2.2). | Open |
| 4 | `brand` | `components/shared/masked-text.tsx` | Give each mask token an accessible name ("masked phone number 1"), add a keyboard- and touch-reachable explanation (not `title`), and apply the typed-redaction look. Keep the `MaskedText` export, the props, and the excluded-participant behaviour (`it04-ui-escaping`). | Audit X-6. | Open (raised in the design-system review) |
| 5 | `brand` | `components/shared/status-badge.tsx`, `components/ui/badge.tsx` | Evidence stamps distinct from review signatures and system tones; "Acknowledged" state tone matching the others (shell H-7). | D5, audit R-17. | Open |
| 6 | `main` (later, not blocking) | data contract | Possible additive reads: per-member acknowledgement time, publication changelog, gap-link expiry on `/g`. | Audit PB-4, PB-7, I-2. UI shows honest "asked"/"not available" states until then. | Note only |
