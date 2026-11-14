# Round 3 conflict fixture (B2) — synthetic only

Two sources that disagree about the club's bank signing mandate. Every name, branch and date is invented.

| File | Upload as | What it says |
|---|---|---|
| `chat.txt` | WhatsApp export (TXT), dates DD/MM | Asha Rao is responsible for the bank signing mandate … and the final submission **to the bank by 31 March** |
| `handbook.md` | Document (Markdown) | The same responsibility … **but she is no longer the signatory and the form is due by 31 January** |

## Expected outcome (fake adapter: `AI_PROVIDER=fake`, `BATON_ALLOW_FAKE_AI=1`, `NODE_ENV=development`)

Upload both into ONE draft, both at access level **everyone**, consent, start processing, wait for review.

1. Review shows ONE **owner** point about the bank signing mandate. Its statement is the sentence of whichever
   source was extracted first (extract jobs of a run run one at a time, in job-id order, so either is possible).
2. That point's evidence status is **conflicting** (it sorts first in review: conflicting → inferred → missing →
   sourced) with two quotes, one per source:
   - the quote from the source the statement came from: verdict **supports**;
   - the quote from the other source: verdict **contradicts** (one says "by 31 March", the other "no longer the
     signatory … due by 31 January").
3. Other points (e.g. "Ravi handles the sponsor reimbursements …") are ordinary, not conflicting.
4. The point cannot be approved as-is; **Resolve conflict** (with a note) is offered to review roles
   (creator, outgoing, reviewer) only.

If the two sources are uploaded at DIFFERENT access levels the point is not merged (dedup never crosses
access levels) and no conflict appears — that is correct behaviour, not a bug.

## Why the fake adapter produces it

- The fake extractor quotes one sentence per keyword hit; "is responsible for" makes an `owner` candidate with
  `attributes.responsibility` = the first 200 characters of the sentence.
- Both sentences share an identical 220-character opening, so the serial dedup (`lib/pipeline/dedup.ts`,
  owner subject key) attaches the handbook's quote to the chat's point.
- The fake verifier (`lib/ai/providers/fake.ts`, `defaultVerify`) returns `contradicts` when word overlap ≥ 30 %
  and exactly one side contains a negation ("no longer"); the chat quote has none, so it `supports`.
- The database (`recompute_point_status`) makes any point with an active, verified `contradicts` link
  `conflicting`.

Proof without Docker or a browser: `tests/integration/r3-conflict-fixture.test.ts` (runs in `npm test`).
