# Round 3 browser scripts (B1–B5) — for the lead's single dev server

Author: Agent 5 (QA/security). Target: `http://localhost:3000`, the lead's `next dev` on `integration/round3`
with local Supabase, `AI_PROVIDER=fake`, `BATON_ALLOW_FAKE_AI=1`, dev drain loop on (`BATON_DEV_WORKER`
unset). Synthetic data only. Labels are the baseline labels (in quotes); Agent 1's redesign may rename them —
follow the intent, and record the new label in the result.

**Rules for whoever drives the browser**
- Open a NEW tab; never reuse the user's tabs. Never trigger `alert/confirm/prompt` dialogs; if a step would,
  stop and note it.
- No credentials in this document. Every step marked **[LEAD]** needs a sign-in (magic link), a second
  account or a server restart: the lead does it, QA continues after.
- Record for each script: PASS/FAIL, the URL, a screenshot of the end state, console errors
  (`read_console_messages`), and for FAIL the exact step number.
- Do not run Docker test suites while a browser session is running.

## 0. Setup and accounts

| Name | Who | Notes |
|---|---|---|
| **A** (creator) | `qa-creator@example.test` | **[LEAD]** signed in via magic link (local Supabase mail UI, usually `http://localhost:54324`) |
| **B** (incoming) | `qa-incoming@example.test` | **[LEAD]** second account, separate browser profile or incognito window |
| **C** (outsider) | `qa-outsider@example.test` | **[LEAD]** optional third account for unauthorised-access checks |

Files (all synthetic, from the repo root of any clone):

| File | Use |
|---|---|
| `fixtures/parser/whatsapp/android-24h-dmy.txt` | a normal WhatsApp export |
| `tests/fixtures/round3-conflict/chat.txt` | conflict pair, part 1 (WhatsApp, DD/MM) |
| `tests/fixtures/round3-conflict/handbook.md` | conflict pair, part 2 (document) |
| `fixtures/parser/documents/handover-notes.md` | a normal document |
| oversized file | create OUTSIDE the repo: `python -c "open(r'%TEMP%\\qa-oversize.txt','w').write('01/01/2026, 10:00 - A: x\\n'*1100000)"` (≈ 27 MB) |
| wrong type | any `.png`/`.exe` renamed to `notes.pdf` (content not a PDF) |

Console check used by every layout script (paste in DevTools or run via the page-scripting tool):

```js
(() => { const w = document.documentElement.clientWidth; const off = [...document.querySelectorAll('body *')]
  .filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > w + 1 || r.left < -1); })
  .slice(0, 10).map(e => `${e.tagName.toLowerCase()}.${[...e.classList].slice(0,3).join('.')} right=${Math.round(e.getBoundingClientRect().right)}`);
  return { viewport: w, scrollWidth: document.documentElement.scrollWidth, horizontalScroll: document.documentElement.scrollWidth > w, offenders: off }; })()
```

Expected everywhere: `horizontalScroll: false`, `offenders: []`.

---

## Headless harness (no extension needed): `tests/browser/run.mjs`

For the signed-out routes and the layout/keyboard parts of BS-07, the lead can run the headless harness
instead of a live browser. It uses the installed Chrome with a throwaway profile, no cookies and no sign-in,
and it refuses or blocks every non-localhost URL. It is not part of `npm test`.

```
node tests/browser/run.mjs <outDir> http://localhost:3000 home:/ login:/login demo:/demo [--widths=1440,1024,390] [--no-keyboard]
```

For each route at 1440×900, 1024×768 and 390×844 (mobile, dpr 2) it records into `<outDir>/report.json`
(plus one PNG per route and width):
- the final URL;
- horizontal overflow;
- the `<h1>` count;
- elements wider than the viewport;
- console errors and uncaught exceptions;
- blocked non-localhost requests;
- a keyboard check: the first 15 Tab stops must each show a visible focus indicator.

It exits with 1 if any check fails. QA self-tested it against a throwaway local page; it has not been run
against the dev server.

## BS-01 Draft resume after refresh at every wizard step (B4, A2) — priority

Account A. Start at `http://localhost:3000/handover/new`.

| # | Action | Expected |
|---|---|---|
| 1 | Fill "Handover title" = `QA resume draft`, "Team or club" = `QA Robotics`, "Their role" = `Treasurer`, choose "Yes, I'm leaving". Do NOT continue. Refresh (F5). | Nothing was saved yet (no draft id in the URL): the form is empty again. No error. (Note if the redesign autosaves before step 1 — then it must reopen with the values.) |
| 2 | Fill the same values, click "Create draft and continue". | URL becomes `/handover/new?draft=<uuid>&step=1` (or equivalent). "Privacy & consent" step shows. Copy the draft id. |
| 3 | Refresh. | Same draft, step "Privacy & consent". Title/team kept (go back one step to check, then forward). No duplicate draft on `/dashboard` (exactly one `QA resume draft`). |
| 4 | Double-click "Create draft and continue" quickly on a NEW draft `QA double click` (go to `/handover/new`). | Exactly ONE `QA double click` draft on the dashboard (C2 idempotent create). |
| 5 | Back on `QA resume draft`: tick every consent statement, click "Continue". On "Sources" refresh BEFORE uploading. | Lands on consent again with ticks cleared (baseline: consent is only remembered once a source has consent recorded). Record actual behaviour; if the redesign keeps you on Sources, consent must still be shown as given. |
| 6 | Tick consent, Continue, upload `android-24h-dmy.txt` to "WhatsApp chat exports". Wait for "Ready". Refresh. | Reopens on "Sources" with the file listed and previewed again ("Reading a preview…" → "Ready"). No second copy of the file. |
| 7 | Continue to "Scope & access". Tick one participant to leave out, do not save. Refresh. | Reopens on Scope (or Sources). **Check carefully:** is the ticked participant still ticked? Baseline: unsaved exclusions are lost (finding QA-R3-03). FAIL if the UI shows the person as excluded but they are not, or silently drops it without telling the user. |
| 8 | Edit the title on the details step (if the redesign offers editing after creation, C1) to `QA resume draft v2`; wait for the saved indicator; refresh. | New title shown after refresh; dashboard card shows it too. |
| 9 | Open the same draft in a second tab, change the title to `tab two`; in the first tab change it to `tab one` without reloading. | First tab gets a clear "changed elsewhere, reloaded" message (C1 `conflict`), not a silent overwrite. |
| 10 | Manually edit the URL: `?draft=<id>&step=3` on a draft with no ready source; then `step=-1`, `step=99`, `step=abc`. | Never shows a step ahead of what the draft holds (it caps at consent/sources), never errors. |
| 11 | Dashboard → the draft card → "Continue editing". | Opens the wizard at the right step for that draft. "Discard draft" removes it after the in-page confirmation (no browser dialog). |

## BS-02 Upload failure, retry, duplicate, oversized, wrong type (B4, D2) — priority

Account A, a fresh draft past consent, on "Sources".

| # | Action | Expected |
|---|---|---|
| 1 | Add the oversized file (≈ 27 MB) to "WhatsApp chat exports". | Immediate per-file error "Files can be up to 25 MB." (or equivalent). Nothing uploaded (no row on refresh). |
| 2 | Add the fake `notes.pdf` to "Documents". | Fails at preview with a friendly, content-free message; option to remove. No stack trace, no file content echoed. |
| 3 | Add `android-24h-dmy.txt`; when "Ready", add the SAME file again. | Second add is refused with a friendly duplicate message ("already uploaded", C3 `duplicate_source`), the first stays Ready. |
| 4 | Add `handover-notes.md`; while it shows "Uploading to private storage…" go offline (DevTools → Network → Offline) for ~5 s, then online. | The file shows an error with a retry action; retry succeeds WITHOUT choosing the file again; exactly one row after refresh. |
| 5 | Add a file and refresh DURING "Uploading…". | After reload that source shows "This upload didn't finish. Remove it and add the file again." with a working Remove. |
| 6 | Add 10 files total, try an 11th. | The drop zones are disabled / an "at most 10" message. |
| 7 | Remove one Ready source; refresh. | It stays removed; the step still allows Continue if others are Ready. |

## BS-03 Review with a real synthetic conflict (B2) — priority

Account A. New draft `QA conflict`, consent, upload BOTH `tests/fixtures/round3-conflict/chat.txt` (chats) and
`tests/fixtures/round3-conflict/handbook.md` (documents). Keep both at access "Everyone". Start processing.
Expected outcome is in `tests/fixtures/round3-conflict/README.md`.

| # | Action | Expected |
|---|---|---|
| 1 | Processing page: watch it; refresh twice mid-run. | Stages progress ("Reading sources" → "Extracting knowledge" → "Checking quotes exist" → "Checking quotes support claims" → "Finding conflicts and gaps" → "Preparing your review"); refresh never resets or duplicates the run. Ends "Processing complete". |
| 2 | Open review (`/handover/<id>/review`). | The FIRST point is the owner point about the bank signing mandate, marked conflicting, visibly different from gaps and from ordinary points. |
| 3 | Open it. | Two quotes, one per source, one labelled "Supports the claim", the other "Contradicts the claim"; each shows its source (chat author "Asha Rao" / handbook). Quotes are readable, not truncated mid-word without an affordance. |
| 4 | Try plain "Approve". | Not possible for a conflicting point; the action offered is "Resolve & approve" (needs a note). |
| 5 | "Resolve & approve" with note `Handbook is newer; deadline 31 January`. | Toast "Conflict resolved"; point approved; history shows the resolution note. Refresh keeps it. |
| 6 | Filter "Filter by evidence status" = conflicting. | Empty after the resolution. |
| 7 | Other points: approve one, reject one with a reason, edit one ("Save revision"), exclude one quote ("Exclude evidence") and restore it. | Each action gives a toast and survives refresh; reject is clearly distinct from approve (wording + colour + icon). |

## BS-04 Incoming member's authenticated view (B1) — priority after BS-03

| # | Action | Expected |
|---|---|---|
| 1 | Account A, `QA conflict` → "Handover settings" → invite `qa-incoming@example.test` as "Incoming member". | "Invite created"; an invite link `/h/<token>` is shown once with "Copy". |
| 2 | **[LEAD]** In B's browser open the invite link; sign in as B via the magic link sent to B's address. | B lands on the handover (not on someone else's), as incoming. |
| 3 | Account A: approve/resolve every point, answer required gaps (or approve as known gap), "Publish". | "Published handover"; readiness blockers clear first ("Before you can publish" lists what remains otherwise). |
| 4 | Account B: `/dashboard`. | Shows `QA conflict`; opening it goes to `/handover/<id>/published`. |
| 5 | B reads the published handover. | Sections with the approved points (everyone-level only); NO evidence quotes beyond what publication shows, no source files, no review history, no member clearances, no identity hashes. |
| 6 | B: "Acknowledge". | "Acknowledged" persists after refresh; A sees B acknowledged in settings. |
| 7 | B visits `/handover/<id>/review`, `/processing`, `/gaps` (unless assigned), `/settings`, `/handover/new?draft=<id>`. | "Review is for reviewers" / "Processing is for reviewers" / not-found style pages; never data. |

## BS-05 Failed job recovery (B4) — needs **[LEAD]** server restarts

| # | Action | Expected |
|---|---|---|
| 1 | **[LEAD]** restart the dev server with `BATON_DEV_WORKER=0` (no drain loop). | — |
| 2 | Account A: new draft `QA failure`, upload `android-24h-dmy.txt`, Start processing. | Processing page shows the run queued/working; refresh keeps that state. |
| 3 | **[LEAD]** restart WITHOUT `BATON_ALLOW_FAKE_AI` (keep `AI_PROVIDER=fake`) and with the drain loop on. | The next drain fails the AI stage with `provider_not_configured` (run-fatal, not retried). |
| 4 | Refresh the processing page. | "Processing failed" with a plain-language reason (no stack trace, no ids, no file content); handover back to draft (first run) with a "Try again" action. |
| 5 | **[LEAD]** restart with the normal env. Click "Try again". | A new run starts and completes; review opens. No duplicate points from the failed run. |
| 6 | (Outgoing ≠ creator variant, optional) as an outgoing member start a run; try to cancel. | Baseline: only the creator can cancel (observation QA-R3-04). Record what the UI offers. |

## BS-06 Unauthorised URL access (B5)

Account C (outsider), or A for ids of a handover A is not in. Use real ids copied from A's session.

| URL | Expected |
|---|---|
| `/handover/<A's id>/review`, `/processing`, `/gaps`, `/settings`, `/published` | Not found (same page as a random uuid). Never a "forbidden" page that confirms the handover exists. |
| `/handover/<random uuid>/review` | Same not-found page as above. |
| `/handover/new?draft=<A's draft id>` | Not found. |
| `/handover/new?draft=../../etc` | Not found (no crash). |
| `/g/not-a-real-token`, `/h/not-a-real-token` | Same content-free "link not valid" page for both garbage and revoked links. |
| `/dashboard`, `/account` signed out | Redirect to `/login`. |
| `GET /api/pipeline/drain` (address bar) | 405 or 404, no body detail. |
| DevTools console: `fetch('/api/pipeline/drain',{method:'POST'}).then(r=>r.status)` | `401`. |

## BS-07 Responsive layouts 390 / 1024 / 1440 (B3, A9) — priority

Resize the window (or the page tool's resize) to **390×844**, **1024×768**, **1440×900**. For EACH route below at
EACH size: run the console check (`horizontalScroll: false`), screenshot, and check the listed items.

| Route (signed in as A unless noted) | Must hold at every width |
|---|---|
| `/` (signed out) and `/login` | Hero/heading readable, primary button visible without horizontal scroll, form fields full width at 390 |
| `/dashboard` | Draft cards stack at 390; "Continue editing"/"Discard draft" reachable; no clipped titles |
| `/handover/new` steps 0–3 | Step indicator usable at 390 (no overflow); drop zones stack; per-file status chips wrap; Back/Continue always visible |
| `/handover/<id>/processing` | Stage list readable; "Try again"/"Start processing" visible |
| `/handover/<id>/review` | Point list and detail usable at 390 (list → detail navigation or stacked); quotes wrap; action buttons not hidden behind overflow; filters reachable |
| `/handover/<id>/gaps` | Questions and answer boxes full width at 390 |
| `/handover/<id>/settings` | Member table scrolls inside its card or stacks, never the whole page; invite link copy works |
| `/handover/<id>/published` (as B) | Sections readable; "Acknowledge" visible |
| `/g/<token>` (Gap Interview link, signed out) | Questions + answers usable at 390 |
| `/account` | Offers/deletion sections stack |

Also at 390: keyboard Tab order reaches every primary action; focus ring visible; no text under 12 px for body copy.

## BS-08 Publish flow end to end (B1 support)

Covered by BS-03 → BS-04. Additionally: with one point still pending, "Publish" is disabled/explains why;
after publishing, A's "Start a revision" (creator only) works and B keeps reading the previous publication
until the next publish.

## Reporting template

```
BS-xx step n — PASS|FAIL — <URL> — <what happened> — screenshot: <file> — console: <errors or none>
```
