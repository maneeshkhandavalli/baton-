# Demo scenario: CodeCell, technical lead handover from Kabir Shah to Neha Kulkarni

Agent `demo`, Phase A, 2026-11-15. **The data is the source of truth.** It lives in `lib/demo/scenario/*` on
`ui3/agent4-demo` (commit `8079f5a`). `lib/demo/__tests__/scenario.test.ts` runs the sources through the real parser
and masker and checks every claim marked ✓ below (14 tests, all passing).
Everything is invented. Contact details use the synthetic `99999 0000N` and `@example.org` patterns. Nothing is
credential-like: the test asserts that nothing is masked as a password, key, secret, card, bank account, IFSC code,
UPI ID or government ID.

## 1. The story in one paragraph

CodeCell is the coding club of an unnamed engineering college in Pune. Kabir Shah, technical lead for 2025–26, leaves on
**30 November 2026** for an internship. Neha Kulkarni takes over on **1 December**. On 11 November Kabir gives Baton the
club's two WhatsApp groups and his infrastructure notes. Baton masks contact details, leaves out a member who asked not to
be included and some trip-planning chatter, and drafts 21 points. Each point carries the exact quotes it rests on. Priya,
the club president, approves the clear-cut points that evening. On 12 November Kabir corrects the rest: he fixes an
outdated fee rule that the chats contradict, confirms an inference, rejects a trivial point, removes a member's personal
number from the evidence, hands the domain renewal to Neha, and accepts two unknowns as known gaps. He publishes version 1
on 13 November. Neha reads it and acknowledges it on 14 November. A Gap Interview link to Ananya fills one of the two gaps
the same evening, and version 2 goes out on the morning of 15 November ("today" in the demo).

## 2. Cast (`lib/demo/scenario/cast.ts`)

| Person | Club role | In the handover | Clearance | Email (synthetic) |
|---|---|---|---|---|
| **Kabir Shah** | Technical lead 2025–26, final year | Creator, **outgoing** | reviewer_only | kabir.shah@example.org |
| **Neha Kulkarni** | Technical lead from 1 Dec, third year | **Incoming** | everyone | neha.kulkarni@example.org |
| **Priya Raman** | Club president | **Reviewer** | reviewer_only | priya.raman@example.org |
| **Arjun Mehta** | Events and sponsorship lead (DevForge) | Lead | leads_only | arjun.mehta@example.org |
| Ananya Iyer | Web and design lead, maintains the website | Not a member. Answers a **Gap Interview** question | n/a | ananya.iyer@example.org |
| Rohan Pillai | Treasurer, venue forms | Chat participant only | n/a | rohan.pillai@example.org |
| Ishaan Rao | Second-year design volunteer | Chat participant only | n/a | ishaan.rao@example.org |
| (unnamed) | Core team member who asked to be left out | Excluded before the parse. Appears in the raw export only as `+91 99999 00007` | n/a | n/a |

Mentioned but not chat participants: **Dr. Menon** (CSE, faculty coordinator), **Mr. Desai** (Dean's office, venue
approvals, `99999 00008`), **Farah Khan** (partnerships manager at **Orbitstack**, a fictional company and DevForge's title
sponsor, `farah.khan@example.org`, office `99999 00010`). Club identifiers: website `codecell.example.org`, GitHub org
`codecell-org`, hackathon **DevForge 2027 on Saturday 30 and Sunday 31 January 2027**.

Why Kabir → Neha rather than the current `/demo`'s Priya → Neha: it matches the UI3 brief and the prototype sample data's
intent, and Priya works better as the reviewer (the president). The current `lib/mocks` fixture stays as it is for
`handover`'s previews and tests. See plan.md §7 for how the two are kept apart.

## 3. Timeline (IST; `DEMO_TIMELINE` in `journey.ts`, ordering checked ✓)

| When | What |
|---|---|
| 1 Jul 2026 | Kabir creates the "CodeCell Core Team 26-27" group |
| 15 Jul | Kabir: Dr. Menon stays faculty coordinator |
| 4 Aug | Kabir sets a ₹100 workshop fee for non-members |
| 21 Aug | Core team votes 11–2: DevForge '27 runs on two days, daytime only |
| 3 Sep (leads) | Orbitstack signs as title sponsor; Arjun is the only contact |
| 18 Sep | Priya: the leads call made workshops **free for everyone** (this contradicts 4 Aug) |
| 25 Sep – 22 Oct | Meetings drift to Thursdays at 6 pm in Lab 3 (never stated as a rule) |
| 12 Oct | Kabir moves the repositories to `codecell-org` |
| 12 Oct (leads) | Orbitstack holds its second instalment until it gets a GST invoice |
| 16–21 Oct | Mr. Desai, the reimbursement rule, the judging portal deploy steps, the auditorium deadline |
| 24–27 Oct | Trip planning in the core chat (**excluded** by Kabir) |
| 29 Oct | Kabir: the domain renews on 12 Dec and is still on his personal card |
| 3 Nov | Kabir last edits `infra-notes.md` |
| 6 Nov | Ananya: "join our discord, the link is in the instagram bio" (no admin named → two gaps) |
| **8 Nov 10:12** | Last message in any source (Neha: "thanks kabir!") = Baton's **evidence as of** ✓ |
| 10 Nov 21:30 | Kabir exports both chats |
| 11 Nov 10:05–10:29 | Handover created, 3 sources uploaded, consent, 2 exclusions, processing run (10:20–10:29), raw files deleted |
| 11 Nov 20:00 | Priya approves 14 clear-cut points |
| 12 Nov from 11:00 | **Visitor as Kabir**: corrections (step 3) |
| 13 Nov 18:30 | **Version 1 published** |
| 14 Nov 09:10 / 09:25 | Neha opens v1 and acknowledges it |
| 14 Nov 10:00 | Kabir sends Ananya a Gap Interview link for both gap questions |
| 14 Nov 21:40 | Ananya answers the Discord question and skips the Instagram one |
| 15 Nov 09:15–09:30 | Kabir accepts the answer, starts a revision, updates the point, **publishes version 2** |
| 15 Nov 10:40 | Neha acknowledges v2 |
| 30 Nov | Kabir's last day. 1 Dec: Neha takes over |

Fixed in the scenario: uploads happen after the last message, and no published version quotes a message written after it
was published (both broken in the current fixture, see audit §3).

## 4. Sources (`sources.ts`; parsed with the real parser ✓)

| Source | Kind | Access | What the parse finds |
|---|---|---|---|
| `WhatsApp Chat with CodeCell Core Team 26-27.txt` | WhatsApp export | everyone | 46 lines; 7 participants, all saved contacts (name identities); 2 phone numbers masked (`[PHONE_1]` Mr. Desai, `[PHONE_2]` Ishaan); the opted-out member's message and 4 trip-planning messages excluded; 1 media placeholder |
| `WhatsApp Chat with CodeCell Leads.txt` | WhatsApp export | **leads only** | 10 lines; 4 participants; `[EMAIL_1]` and `[PHONE_1]` (Farah, Orbitstack's office) |
| `infra-notes.md` | Markdown | everyone | 10 blocks under Code / Website / Judging portal / Access; nothing to mask |

The exports are short on purpose, so a visitor can read them in full. The demo says so; it does not claim thousands of
messages. A masking example as the visitor sees it (raw → stored):

```
16/10/2026, 11:20 - Rohan Pillai: … his number is 99999 00008 if it's urgent
→ desai sir approved the workshop venue but he wants the form in person, not on email. his number is [PHONE_1] if it's urgent
```

Real-masker finding while building this: "send the guest wifi codes last time" was masked as `codes [PASSWORD] time`.
The masker reads "codes" followed by a word as a credential. I rephrased the line ("set up guest wifi for the last event").
Reported to `main` (`lib/privacy` is off limits), as it will also happen with real chats.

## 5. What Baton's draft contains (`points.ts`; labels checked ✓)

The draft is **pre-generated**: no AI runs in the demo, and the demo says so at step 2. 21 points: **17 sourced, 1 inferred,
1 conflicting, 2 missing**. "✔ Priya" = approved on 11 Nov; "→ visitor" = the visitor decides in step 3.

| # | Section | Point | Label | Evidence (masked, word for word) | At step 3 |
|---|---|---|---|---|---|
| 1 | Decision | DevForge 2027 runs on two days, daytime only (30–31 Jan, 9–9, vote 11–2) | sourced | Kabir 21 Aug "vote closed 11–2. DevForge '27 is Sat 30 – Sun 31 Jan…"; Priya 21 Aug (the reason); Arjun 5 Nov "registrations page now says 30–31 jan, daytime only" | ✔ Priya |
| 2 | Decision | Workshop fee: "Non-members pay ₹100 per workshop; members attend free." | **conflicting** | Kabir 4 Aug (supports) vs Priya 18 Sep "from this sem workshops are free for everyone… no more ₹100 at the door" (contradicts) | → visitor |
| 3 | Decision | Club code lives in `codecell-org` (since Oct) | sourced | Kabir 12 Oct; infra-notes "Code" | ✔ Priya |
| 4 | Decision | The core team meets every Thursday at 6 pm in Lab 3 | **inferred** | Three partial quotes (25 Sep, 8 Oct, 22 Oct). Rationale: every meeting message since late September names Thursday, but nobody states a rule | → visitor |
| 5 | Decision | Club T-shirts were ordered from the campus print shop | sourced | Ananya 22 Aug "print shop delivered the tees, size M ran small" | → visitor (reject) |
| 6 | Ownership | Arjun owns sponsor relations (Orbitstack); it stays with him | sourced, **leads only** | Leads chat, 3 quotes | ✔ Priya |
| 7 | Ownership | Ananya maintains the website | sourced | infra-notes "Website" | ✔ Priya |
| 8 | Ownership | Who runs the Discord server? | **missing** | none (gap question 1) | → visitor (known gap) |
| 9 | Ownership | Treasurer approves reimbursements under ₹2,000; above needs Dr. Menon | sourced | Rohan 19 Oct (supports); Ishaan 19 Oct "…please reimburse me on [PHONE_2]" (partial) | → visitor (exclude Ishaan's quote) |
| 10 | Open work | Renew the club domain by 12 Dec; still on Kabir's personal card. *Assignee: Kabir* | sourced | Kabir 29 Oct; infra-notes "Website" | → visitor (edit: assign to Neha) |
| 11 | Open work | Finish the DevForge judging rubric (Arjun, 15 Dec) | sourced | Arjun 5 Nov | ✔ Priya |
| 12 | Open work (blocker) | Orbitstack's second instalment waits for a GST invoice | sourced, **leads only** | Arjun and Rohan, 12 Oct | ✔ Priya |
| 13 | Open work (next action) | Book the auditorium for January orientation before the winter break | sourced | Rohan 21 Oct | ✔ Priya |
| 14 | Risk | Only Kabir knows how to deploy the judging portal | sourced | Kabir 20 Oct "…i'll write it down someday 😅"; infra-notes "Deploy: ask Kabir." | ✔ Priya |
| 15 | Dependency | Guest Wi-Fi needs college IT a week ahead | sourced | Rohan 14 Oct | ✔ Priya |
| 16 | Recurring problem | The Lab 3 projector dies at about 90 minutes; there is a spare at the front desk | sourced, **possibly outdated** (the only one ✓; latest support 26 Sep, more than 30 days before 8 Nov) | Ananya 14 Jul, Rohan 14 Jul, Kabir 26 Sep | ✔ Priya |
| 17 | Contact | Mr. Desai, Dean's office (forms in person) | sourced | Rohan 16 Oct "…his number is [PHONE_1] if it's urgent" | ✔ Priya |
| 18 | Contact | Farah Khan, Orbitstack partnerships | sourced, **leads only** | Arjun 15 Oct "…[EMAIL_1], office line [PHONE_1]" | ✔ Priya |
| 19 | Contact | Dr. Menon, faculty coordinator | sourced | Kabir 15 Jul; Rohan 19 Oct | ✔ Priya |
| 20 | Accounts & access | GitHub org owners: Kabir and Priya; recovery codes in the club password manager; Kabir adds Neha | sourced | Kabir 2 Nov; infra-notes "Access" | ✔ Priya |
| 21 | Accounts & access | Who controls the Instagram account? | **missing** | none (gap question 2) | → visitor (known gap) |

Gap questions (both **optional**, so they don't block publishing; the product does let optional gaps be published as
known gaps):
1. "Who administers the CodeCell Discord server, and who else has admin rights?"
2. "Who has the login for the club's Instagram account, and who can post?"

What the step 2 readiness panel shows (derived by the real `computeReadiness` once the engine exists): 14 of 21 decided
(67%). Blockers: 7 points need a decision, 1 inferred point needs confirming, 1 conflict needs resolving.

## 6. The journey (canonical path = `DEMO_CANONICAL_ACTIONS`)

**Step 1, Sources and conversations (as Kabir, 11 Nov 10:12).** The three files, as the wizard shows them: participants,
date range, masking counts, the scope step with the two exclusions (the member who asked to be left out, matched by number
and never named; 24–27 Oct trip planning), and consent. The visitor can open each export, raw on one side and masked on
the other, labelled as an illustration (the product never shows raw text after upload).

**Step 2, AI draft (11 Nov 10:20–10:29).** A simulated processing run walks the real stages (parse → extract → verify
quotes → verify support → analyse → prepare review), labelled "simulated, no AI runs in the demo". It ends on the draft:
21 points with labels and quotes.

**Step 3, Human review and corrections (as Kabir, 12 Nov from 11:00).** Priya's 14 approvals are already there. The
suggested corrections:
1. **Workshop fee (conflict).** Edit to "Workshops are free for everyone…" (reason: the fee was dropped in September).
   The scripted re-check now marks Priya's 18 Sep quote as supporting and Kabir's 4 Aug quote as contradicting. Then
   resolve: "The leads call on 18 September replaced the 4 August fee. Workshops are free." Then approve.
2. **Thursday meeting (inferred).** Approve with "I confirm this inference".
3. **T-shirts.** Reject: "True, but a one-off order. Neha doesn't need it."
4. **Reimbursements.** Exclude Ishaan's quote ("A member's personal number and payment. It adds nothing to the rule."),
   then approve.
5. **Domain renewal.** Edit: assignee **Neha Kulkarni**, progress "Kabir moves billing to the club card before 30
   November" (reason: Kabir leaves on 30 November). The scripted re-check: still supported. Approve.
6. **Discord and Instagram (missing).** Approve each as a known gap.

The readiness panel reaches 100%, and Publish becomes available.

**Step 4, Evidence-backed decisions and tasks.** A focused read of the result: the 4 approved decisions and the open work
(domain → Neha by 12 Dec, rubric → Arjun by 15 Dec, auditorium before the winter break, the GST blocker), each with its
quotes. Leads-only points are marked as such. This step changes nothing.

**Step 5, Publish (13 Nov 18:30).** The real publish dialog, with Kabir's summary: "Neha, this is everything I know about
the technical lead role. The urgent items are the domain renewal on 12 December and the auditorium form before the winter
break. The judging portal deploy is the biggest risk, so we'll do the next one together before 30 November." The result is
version 1: 20 approved points (T-shirts rejected), 2 of them known gaps.

**Step 6, Neha's view and the Gap Interview.**
- 6a (as Neha, 14 Nov 09:10). The real published view at Neha's clearance (everyone). She sees 17 points; the 3 leads-only
  points (6, 12, 18) are hidden, and the demo says so. She sees the first-7-days list (domain renewal, Mr. Desai, the
  auditorium form…), two **Open questions** (Discord, Instagram) and the acknowledgement form, which works in the demo.
- 6b (as Ananya, 14 Nov 21:40). Kabir sent her a Gap Interview link (shown as a demo link, not shareable). The visitor
  answers in the real Gap Interview screen: "I set the server up in 2025 and I'm its only admin. Kabir has moderator
  rights. I'll make Neha an admin on 1 December." She skips the Instagram question.
- 6c (as Kabir, 15 Nov 09:15). Accept the answer in the gaps manager; it becomes testimony evidence on point 8. Start a
  revision, edit the point to "Ananya runs the Discord server" (scripted re-check: supported), approve, and publish **v2**
  ("Version 2 adds who runs the Discord server, from Ananya's Gap Interview answer.").
- Back as Neha: v2 shows the new owner backed by Ananya's answer, with Instagram still an open question (not everything
  gets answered, and the demo shows that). She is asked to acknowledge v2.

## 7. Consistency rules the data follows (enforced by the test unless marked)

- Every quote appears word for word in the masked parse of its source, with the right author, time (IST → UTC) and line or
  block. ✓
- Every planted phone number and email address is masked in every source. Nothing is masked as a credential. ✓
- The opted-out member and the 24–27 Oct range are absent from the parse. ✓
- Evidence as of equals the last message; the export, upload, review and publications follow it in order. ✓
- Pre-approved points are sourced with only supporting evidence; the 7 pending points are exactly the ones the visitor
  decides; every one is decided before v1. ✓
- Exactly one approved point is "possibly outdated" (the projector). ✓
- Attributes and the canonical edits pass the canonical category schemas and the input length limits. ✓
- User-entered text (corrections, notes, summaries, the gap answer) contains nothing the masker would change. ✓
- Names are consistent everywhere. Kabir is never an assignee after step 3, except as the person moving the domain
  billing before he leaves. (Not automated; reviewed by hand.)
