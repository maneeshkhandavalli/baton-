# Baton — remaining work (prioritised)

Derived from `PRODUCT_COMPLETION_AUDIT.md` (HEAD `8e482d5`). Effort in focused developer-days.
"Blocked" items need a user decision or an external dependency before work can start.

## P0 — blocks a usable product or a launch
| # | Item | Blocked on | Effort | Notes |
|---|---|---|---|---|
| P0-1 | Apply the 18 Round 3 migrations to the hosted **dev** project (runbook in `migrations.md` §5) and deploy-order the app/worker | **User approval** | 0.5 | Unblocks every hosted verification below. Backup/PITR marker first. |
| P0-2 | Real AI provider (D11): choose provider, adapter, privacy/pricing review, live eval suite (≥20 synthetic scenarios incl. multilingual/paraphrased injection, D11-LIVE-1) | **D11 decision**, Rithika's research | 4–6 | Launch blocker only; local/dev keeps the fake adapter. |

## P1 — essential journeys
| # | Item | Blocked on | Effort | Depends on |
|---|---|---|---|---|
| P1-1 | ✅ DONE `9f528b5` — **"Add a point" in the review workspace (`createManualPoint`)**: dialog with category, title, statement, category attributes, optional testimony and access override; contacts with `directContact` need leads-only or reviewer-only access | — (unblocked) | 1 | — |
| P1-2 | Signed-in browser walkthrough of the redesigned journey at 1440/1024/390; fill `docs/design/route-verification.md` screenshots | Browser access + P0-1 | 1 | P0-1 |
| P1-3 | Incoming-member journey with a second synthetic account: invite → `/h/[token]` → published view → acknowledgement; invalid/expired link states | Second account; SMTP for email (the copy-link path works without it) | 0.5 | P0-1, P1-2 |
| P1-4 | Real-conflict and failed-job recovery walkthroughs in the browser (BS-02, BS-06) | Browser access | 0.5 | P0-1 |
| P1-5 | Email deliverability for magic links and invitations (Resend SMTP, domain) | Rithika / user | 0.5 | — |

## P2 — reliability and UX
| # | Item | Blocked on | Effort |
|---|---|---|---|
| P2-1 | Retention sweep (cron route + `claim_raw_for_retention`, dry-run week) | Retention decision (6 choices) | 2 |
| P2-2 | Exclusions inside PDF/DOCX/MD (option A) | Product decision | 4–6 |
| P2-3 | Dashboard batched card query (C4: per-card `listSources` / `getReadiness`) | — | 1 |
| P2-4 | Rate limiting behind the production proxy (X-Forwarded-For trust, QA-L7) | Deployment target | 0.5 |
| P2-5 | Dev drain loop live check after E4 changes | P0-1 or local stack | 0.25 |
| P2-6 | Screen-reader pass (VoiceOver/NVDA) on wizard and review | — | 0.5 |
| P2-7 | Outgoing member cancel rights (QA-R3-04) | Product decision | 0.25 |

## P3 — optional
| # | Item | Effort |
|---|---|---|
| P3-1 | Address masking (`docs/proposals/address-masking.md`), after a decision | 1–1.5 |
| P3-2 | Fence heartbeat/complete by claim generation too | 0.5 |
| P3-3 | Dark-mode switch (tokens exist) | 0.5 |
| P3-4 | Account deletion / erasure once D27 is decided | 2 |

## Suggested order
1. ~~P1-1~~ done (`9f528b5`); verify it in the browser with P1-2.
2. On approval: P0-1 → P1-2 → P1-3/P1-4 (one browser session, synthetic data only).
3. P2-3 and P2-6 (unblocked) while decisions are pending.
4. After decisions: P2-1, P2-2, P2-7, P3-1.
5. D11 track (P0-2) in parallel with Rithika's provider research; it is the launch gate.
