# Proposal: postal addresses as a §12.1 mask kind

Status: **proposal; nothing implemented.** Author: Agent 3 (ingestion, storage, privacy), Round 3.
Measured with a throw-away detector in a scratch file outside the repository (deleted, never committed).
All inputs are synthetic.

## Decision needed (product owner + lead)

| Question | Recommendation |
|---|---|
| Should postal addresses be masked before anything is stored or sent to the AI provider? | **Yes**, as a new mask kind `address` with numbered tokens `[ADDRESS_1]`, `[ADDRESS_2]`, … (same value → same token within a source, like phones) |
| How aggressive? | **Structured addresses only**: a postcode, a house/unit number with a street word, or an explicit "postcode/zip/PIN" keyword. No landmark or free-text guessing |
| Accept that business addresses (venues, offices) are masked too? | **Yes**: the detector cannot tell a home from a venue, and §12.1 prefers over-masking. A handover can still say "the venue" and keep the name of the place |
| Contract impact | `MASK_KINDS` + §12.1 text + `[ADDRESS_n]` token (lead, contracts); `masking_counts` is jsonb, so no migration is needed |

**Blocked until approved:** the detector in `lib/privacy/mask.ts`, its tests, and the contract text.
Estimated effort after approval: about 1–1.5 days, including tests and the end-to-end privacy checks.

## 1. Today

`MASK_KINDS` has phone, email, UPI, bank account, IFSC, card, government ID, password, API key and
secret, but no address. A chat line such as "courier it to Flat 4B, Sunrise Apartments, Bengaluru 560038"
reaches `source_messages`, evidence quotes and the AI provider unmasked. Phone and email masking already
cover the most direct contact channels, so the gap is the physical location of a person.

## 2. Candidate detector (measured)

Two layers. Each hit then grows over the surrounding comma-separated run on the same line (up to four
groups back and five forward), so "Flat 4B, Sunrise Apartments, 12th Cross, Indiranagar, Bengaluru
560038" becomes one `[ADDRESS_1]`. This over-masks a little by design.

1. **Anchors (high precision)**
   - UK postcode, case-sensitive, using the official letter classes (`SW1A 2AA`, `NW1 6XE`, `EH1 2AB`).
   - US state + ZIP (`CA 95014`, `DC 20500`, `CO 80301-1234`).
   - Indian PIN only in context: after `PIN`/`pincode`/`postal code`, or after a comma/dash and an
     optional city word (`…, Bengaluru 560038`, `Kochi - 682020`). A **bare 6-digit number is never an
     address**: OTPs, amounts and scores look the same.
   - `postcode`/`zip` keyword + a UK or US code in any case (`postcode ec1a1bb`, `zip 94105`).
2. **Street lines**
   - House number + 0–3 capitalised words + a street word (Street, Road, Avenue, Lane, Marg, Nagar,
     Layout, Enclave, Salai, Peth, Close, Terrace, …).
   - The street word must end the phrase: followed by a comma, end of line, a compass suffix or a
     capitalised place name. "12 Street Food stalls" and "250 Avenue posters" are therefore not addresses.
   - Indian unit prefixes (`Flat 4B`, `H.No 5-6-118`, `Door No. 12`, `Plot No. 77`) and ordinal roads
     (`3rd Main`, `12th Cross`).

### Data

- **Negatives:** every non-blank line of the synthetic fixtures, 952 lines in 41 files
  (`fixtures/demo/**`, `fixtures/parser/**`, `tests/fixtures/**`, the prompt-injection cases). None of
  them contains an address. Plus 20 hand-written hard negatives: room numbers, times, amounts in lakh
  notation, OTPs, phone numbers, invoice and train numbers, "Block 2 of the budget", "Sector analysis",
  "The Lane Committee", "3 Main props", "12 Street Food", a UK-postcode-shaped ticket code, and a
  US-state+ZIP-shaped product code.
- **Positives:** 29 hand-labelled synthetic addresses: 14 Indian, 7 UK, 8 US. Some are deliberately
  hard: lowercase, no postcode, landmark-only, named houses. A positive counts as found only if every
  labelled fragment (house number, street, postcode) is gone after masking.

### Results

| Variant | Recall (all) | India | UK | US | False positives: fixture lines | False positives: hard negatives |
|---|---|---|---|---|---|---|
| v0: v1 plus a bare "Main" street word | 22/29 | 10/14 | 5/7 | 7/8 | 0/952 | 4/20 |
| v1: anchors + street lines | 22/29 (0.76) | 10/14 | 5/7 | 7/8 | 0/952 | 3/20 |
| **v2 (recommended): v1 + keyword codes + ordinal roads + street word must end the phrase** | **25/29 (0.86)** | 11/14 | 6/7 | 8/8 | **0/952** | **2/20** |

- **v2 still misses (by design, not fixable by patterns):**
  - "opposite SBI ATM, Station Road, Nashik": landmark-only, no number.
  - "flat 4b sunrise apartments indiranagar bangalore": all lowercase, no PIN.
  - "house 12 lane 3 ward 9 near the bus stand": unstructured.
  - "The Old Rectory, Church Lane, Little Hadham": a named house with no number.
- **v2 false positives:**
  - "The 2nd Cross-check of receipts": fixable by refusing a hyphen right after `Cross`/`Main`.
  - "Model CA 90210 kit": a product code shaped like a US state + ZIP. Accepted as over-masking.

**Caveats.** 29 positives is a small, hand-made set; the recall figures are indicative, not
statistically strong. The fixture corpus has no addresses, so it can only measure false positives. Before
shipping, the detector needs the ≥20-scenario synthetic evaluation set (Rithika's track) and the existing
masking regression suites.

## 3. Risks

- **Utility loss:** venue and office addresses are often what a handover needs ("the store is at 18
  Park Street"). They will be masked. Mitigation: the place name usually survives ("Higginbothams",
  "Main Seminar Hall"), and reviewers can add a manual point.
- **Masking order:** the detector must run after phone, card and government-ID masking, so a PIN or ZIP
  never splits a phone number and Aadhaar or OTP digits are never taken for a PIN. It must run before the
  generic secret detectors.
- **Recall ceiling:** unstructured Indian addresses (landmarks, lowercase, no PIN) are common in chats.
  Pattern masking will never catch them all. This should be stated in the consent text ("addresses
  written without a postcode or house number may not be masked").
- **Multi-line addresses** (one part per line in a PDF/DOCX block) are only joined within one block
  line. Each line with an anchor is masked, but a line holding only a city or state name is not.

## 4. Recommendation

Adopt **v2** as mask kind `address` (numbered tokens, per-source consistent, counted in
`masking.counts`), with the hyphen fix for ordinal roads, in the position described under Risks. Ship
it with:
- the hard-negative set above as regression tests;
- the 29 positives as recall tests (the 4 misses documented as known limits);
- an end-to-end test proving that no address fragment reaches evidence.

Do not add landmark or free-text address guessing: it would mask ordinary prose ("near the temple",
"opposite the canteen") and break the bounded-over-masking guarantee QA tests.
