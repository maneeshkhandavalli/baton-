# Proposal: participant exclusions in PDF, DOCX and Markdown companions

Status: **proposal; nothing implemented.** Author: Agent 3 (ingestion, storage, privacy), Round 3.

## Decision needed (product owner + lead)

| Question | Recommendation |
|---|---|
| Should a person excluded from a chat also be redacted in the handover's documents? | **Yes**, with the existing reserved token `[EXCLUDED_PARTICIPANT]` |
| Phone-number exclusions | **Apply automatically** in documents: phone identities are already handover-wide (D29/§12.11) and a normalised number is an exact, low-risk match |
| Name exclusions | **Detect, then ask**: show matches in the document preview and redact only after the creator confirms "same person" for that document (the existing per-source `confirmIdentityMatch` flow, D29) |
| Matching method | **Hash matching** against the existing identity hashes (no names stored anywhere); full normalised names only |
| Nicknames, first names only, misspellings | **Out of scope**: say so in the UI; the reviewer can still reject or redact points |
| Contract impact | `IdentityMatch` needs a document form (no participant: block seq + count); §6.8.1 / §11.4 text (lead) |

**Blocked until approved:** the document mention scanner in `lib/parsers`, the contract change, and the
wizard UI. Estimated effort after approval: about 4–6 days in total (§5).

## 1. Today

- Exclusions are stored per handover as identity hashes: `HMAC(pepper, normalised sender)` with an
  identity kind (`phone` or `name`) and the pepper version. **The excluded person's name is never stored.**
  The parser emits nothing about an excluded participant, not even their label.
- The rule feed is already handover-wide: `parse_exclusion_rules(source)` gives each source every
  participant rule of its handover.
  - Phone rules arrive as `apply`.
  - Name rules from another source arrive as `detect`, until the creator decides `same_person` (→ `apply`)
    or `different_person` (→ dropped). This is `_exclusion_rule_mode`.
- In a chat, an excluded person is removed with their messages, system lines that name them,
  `@mentions`, and their name or number written by others (`excluded-mentions.ts`). That last part works
  because the raw sender string is in the same file.
- **Documents ignore participant rules** (`buildDocumentSource`): they have no senders, and the parser
  has no raw name to search for. So "Ravi Kumar handles the treasury" in a companion PDF survives into
  evidence even though Ravi was excluded from the chat. Only the identity hash travels.

## 2. Options

| | A. Hash matching (recommended) | B. Store a redaction name list | C. Manual redaction terms only |
|---|---|---|---|
| How | Scan each document block for candidate identities: capitalised 1–4-word name n-grams (possessive `'s` stripped, whitespace and line breaks folded), and phone numbers in any format. Normalise each candidate exactly like a sender (`normalizeSenderIdentity`), HMAC it with the pepper, compare with the rule hashes of the same kind and pepper version | At exclusion time, store the excluded person's display name (and variants) so documents can be searched by text | The creator types words to redact for a document ("Ravi", "RK") |
| Stores names? | **No**: only the existing hashes | **Yes**: the very name the exclusion is meant to forget; needs encryption, retention and erasure coverage | Yes, the typed terms (until the parse) |
| Catches | Exact full name as the sender wrote it (any case, Unicode-normalised); any formatting of an excluded phone number | Full name and stored variants | Whatever the creator types |
| Misses | First name only, nickname, initials, "Mr. Kumar", misspellings, a different transliteration | Unlisted variants | Whatever the creator forgets |
| False redaction | A different person with the **same full name** (names are ambiguous across sources, hence D29); phones: essentially none | Same as A, plus variant collisions ("Ravi" → every Ravi) | Over-broad terms |
| Fits D29/§12.8 | Yes: same hashes, same detect → confirm flow | Conflicts with "never store the name" | Partly (user-entered names are new stored data) |
| Cost per block | ≈ 4 × words HMACs (SHA-256), well within limits for 25 MB / 200,000 blocks | Text search | Text search |

The hash approach reuses everything that exists: the rule feed, the modes, the per-source confirmation
table (`source_identity_confirmations`) and the reserved token. It adds no stored personal data.

## 3. False-redaction risk and how to keep it low

- **Phones (apply):** a phone rule matches only a number whose normalised digits HMAC to the same hash.
  The parser already masks every phone number as `[PHONE_n]`, so redaction only changes which token
  replaces it. Risk: none in practice.
- **Names (detect → confirm):**
  - A full-name hit is never redacted until the creator confirms that this document means the same
    person. That is exactly how name rules from other chats already work.
  - Single-word n-grams are only hashed when the excluded sender itself was a single word ("Mom",
    "Ravi"). Even then they stay in detect mode, and the confirmation UI shows how many occurrences.
  - Common words never become candidates: n-grams must start with a capital letter, and must not be a
    heading or a sentence-initial stopword. The N4 over-redaction safeguards from chats ("excluding 'Mom'
    keeps ordinary words") apply unchanged.
- **Ambiguity left over:** two different people with the same full name in one handover. The creator's
  per-document decision handles it (`different_person` drops the rule for that document).

## 4. UX for confirming matches

In the wizard's document preview (the same place chat identity matches are confirmed today):

> **People you left out appear in this document.** "A person excluded from *Club chat*" appears **3
> times** (page 2, page 4). [Same person – remove from this document] [A different person – keep]

- The label never shows the excluded name. The UI shows the source it was excluded from and short
  snippets with the match replaced by `[EXCLUDED_PARTICIPANT]`.
- Processing waits for these decisions, exactly as for chat identity matches. The parse fails with
  `identity_confirmation_required` until they are made.
- A note under the panel: "Nicknames, first names and initials are not detected. Check the document,
  or reject affected points in review."

## 5. Effort (after approval)

| Area | Work | Estimate |
|---|---|---|
| Contract (lead) | `IdentityMatch` document form (`participantLocalId: null`, `blockSeq`, `occurrences`); §6.8.1/§11.4 text; `[EXCLUDED_PARTICIPANT]` allowed in document bodies | 0.5 day |
| Parser (Agent 3) | Mention scanner in `buildDocumentSource`: candidate n-grams + phones, HMAC compare, redaction in kept blocks and headings, `identityMatches` for `detect`, `excluded_mentions_redacted` summary warning; preview = parse (D33) | 1.5–2 days |
| SQL (Agent 2/3) | None for the rule feed (already handover-wide). Add a check that `confirm_identity_match` accepts document sources (it is source-generic today) | 0.5 day |
| UI (Agent 1) | Document identity-match panel in the wizard | 1–1.5 days |
| Tests (all, QA) | Parser unit + privacy end-to-end ("excluded person never reaches evidence from a PDF/DOCX/MD"), SQL, UI | 1 day |

## 6. Recommendation

Adopt **option A**:
- phone exclusions are applied automatically in documents;
- name exclusions use detect → per-document confirmation;
- full normalised names only, no stored names;
- the limitation is stated clearly in the UI.

Reject option B, because it stores the very name an exclusion is meant to forget. Keep option C (manual
terms) as a possible later addition only if reviewers report misses in practice.
