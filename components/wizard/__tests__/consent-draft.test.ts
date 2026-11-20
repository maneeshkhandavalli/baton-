import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { consentDraftKey, parseConsentDraft, serializeConsentDraft } from "../consent-state";

// Round 4 audit A3 / F6: the consent ticks survive a reload as draft UI state only.
describe("consent ticks as draft state", () => {
  it("round-trips partial ticks per draft", () => {
    const raw = serializeConsentDraft({ informed: true, provider: false, optout: true });
    assert.deepEqual(parseConsentDraft(raw), { informed: true, provider: false, optout: true });
    assert.equal(consentDraftKey("h1"), "baton:wizard-consent:h1");
    assert.notEqual(consentDraftKey("h1"), consentDraftKey("h2"));
  });

  it("stores nothing when nothing is ticked, and ignores junk", () => {
    assert.equal(serializeConsentDraft({ informed: false, provider: false, optout: false }), null);
    assert.equal(parseConsentDraft(null), null);
    assert.equal(parseConsentDraft("not json"), null);
    assert.equal(parseConsentDraft('{"informed":"yes","provider":1}'), null);
    assert.deepEqual(parseConsentDraft('{"informed":true,"extra":true}'), { informed: true, provider: false, optout: false });
  });

  it("the wizard keeps ticks in sessionStorage only and records consent nowhere else", () => {
    const wizard = readFileSync(join(process.cwd(), "components/wizard/new-handover-wizard.tsx"), "utf8");
    assert.match(wizard, /window\.sessionStorage\.setItem\(consentDraftKey\(/);
    assert.match(wizard, /parseConsentDraft\(window\.sessionStorage\.getItem\(consentDraftKey\(/);
    assert.doesNotMatch(wizard, /localStorage[^\n]*consent/i);
    // the restore never applies when consent is already recorded for the draft's sources
    assert.match(wizard, /if \(initialConsented \|\| !initial\?\.handoverId\) return;/);
  });
});
