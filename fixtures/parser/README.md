# Parser fixtures (synthetic only)

Everything here is invented test data. No real WhatsApp exports, names or phone numbers.
Phone numbers use the obviously synthetic `99999 0000N` pattern; emails use `example.org/.com`.

- `whatsapp/*.txt`: Android (12h/24h, dmy/mdy) and iOS (bracketed, LRM-marked system
  lines, `<attached:>`, `image omitted`) exports, ambiguous and conflicting dates, malformed
  lines, a non-WhatsApp file and a PII-heavy chat.
- `whatsapp/adversarial-senders-{android,ios}.txt`: sender names containing system-event words
  and quotes ("Sam (left wing)", "Priya Changed Number", `Ravi "RK" Kumar`, "Ravi left"), messages
  whose text looks like an event, and direction-marked iOS lines (security regression C1).
- `documents/*`: Markdown (front matter, ATX/setext headings, fenced code) and plain text.
- `builders.ts`: deterministic builders for binary fixtures (ZIP, DOCX, PDF), generated in tests
  so no opaque binaries are committed. They can also produce encrypted, corrupt, zip-bomb,
  image-only and undecodable-font variants, and ZIP entries with a data descriptor (flag bit 3, as
  streaming Android exports use) or an arbitrary compression-method field.
- `load.ts`: fixture loading, a test-only identity pepper, canonical rule builders (`participantRule`, `conversationRule`) and failure narrowing (`fileError`, `inputFailure`).

Run the parser and privacy tests (Node 24, no test framework needed):

```bash
node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/parsers/__tests__/*.test.ts" "lib/privacy/__tests__/*.test.ts"
```
