// R3 Task 05E (05D hardening): consent is accepted only for the statement version this server shows for its ACTUAL
// AI configuration. Stale or forged versions, and a version written for another provider, are refused before any
// database call; the recorded provider is always the server's.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONSENT_STATEMENT_OUTDATED_REASON, consentDisclosure, type ConsentDisclosureKind } from "../../contracts/consent";
import * as sources from "../core/sources";
import { FAKE_RUN_CONFIG, S, fakeDeps } from "./helpers";

// a configured Gemini run (synthetic; no key is involved in consent)
const GEMINI_RUN_CONFIG = { ...FAKE_RUN_CONFIG, provider: "gemini" };

function world(kind: ConsentDisclosureKind) {
  const runConfig = kind === "local_test" ? FAKE_RUN_CONFIG : GEMINI_RUN_CONFIG;
  return fakeDeps({
    aiRunConfig: () => ({ ok: true, data: runConfig }),
    consentDisclosure: () => consentDisclosure(kind),
    rpc: { api_get_source: { data: { id: S } } },
  });
}
const consent = (version: string, extra: Record<string, unknown> = {}) =>
  ({ sourceId: S, consentStatementVersion: version, consentConfirmed: true, timezone: "Asia/Kolkata", ...extra }) as never;

describe("recordSourceConsent: the statement version is checked on the server", () => {
  for (const kind of ["local_test", "gemini_free", "gemini_paid"] as const) {
    const expected = consentDisclosure(kind).statementVersion;

    it(`${kind}: the matching version is recorded, with the server's provider`, async () => {
      const f = world(kind);
      await sources.recordSourceConsent(f.deps, consent(expected));
      const write = f.calls.find((c) => c.fn === "record_source_consent");
      assert.ok(write, "consent was recorded");
      assert.equal(write.args?.p_statement_version, expected, "the version actually accepted is the one stored");
      assert.equal(write.args?.p_ai_provider, kind === "local_test" ? "fake" : "gemini");
    });

    it(`${kind}: a stale version (another wording, e.g. the pre-05D Gemini text) is refused before any write`, async () => {
      const f = world(kind);
      const stale = kind === "gemini_free" ? "gemini-free-2026-11-01-v0" : consentDisclosure("gemini_free").statementVersion;
      const r = await sources.recordSourceConsent(f.deps, consent(stale));
      assert.ok(!r.ok);
      assert.equal(r.error.code, "conflict");
      assert.equal(r.error.details?.reason, CONSENT_STATEMENT_OUTDATED_REASON);
      assert.match(r.error.message, /changed.*confirm it again/);
      assert.equal(f.calls.filter((c) => c.fn === "record_source_consent").length, 0, "nothing written");
    });

    it(`${kind}: a forged version (and a forged provider) is refused; nothing secret is echoed`, async () => {
      const f = world(kind);
      const r = await sources.recordSourceConsent(f.deps, consent("i-accept-anything", { aiProvider: "fake" }));
      assert.ok(!r.ok && r.error.details?.reason === CONSENT_STATEMENT_OUTDATED_REASON);
      assert.equal(f.calls.filter((c) => c.fn === "record_source_consent").length, 0);
      assert.doesNotMatch(JSON.stringify(r), /i-accept-anything|AIza|api[_-]?key/i, "the refusal echoes no input and no configuration");
    });
  }

  it("the local-test wording cannot be used while a real provider is configured (and vice versa)", async () => {
    const real = world("gemini_free");
    const r1 = await sources.recordSourceConsent(real.deps, consent(consentDisclosure("local_test").statementVersion));
    assert.ok(!r1.ok && r1.error.details?.reason === CONSENT_STATEMENT_OUTDATED_REASON, "a fake-adapter consent never covers Gemini");
    const local = world("local_test");
    const r2 = await sources.recordSourceConsent(local.deps, consent(consentDisclosure("gemini_free").statementVersion));
    assert.ok(!r2.ok && r2.error.details?.reason === CONSENT_STATEMENT_OUTDATED_REASON);
  });

  it("a wording that does not describe the configured provider fails closed (never records a mismatched consent)", async () => {
    const f = fakeDeps({
      aiRunConfig: () => ({ ok: true, data: GEMINI_RUN_CONFIG }),
      consentDisclosure: () => consentDisclosure("local_test"),
      rpc: { api_get_source: { data: { id: S } } },
    });
    const r = await sources.recordSourceConsent(f.deps, consent(consentDisclosure("local_test").statementVersion));
    assert.ok(!r.ok && r.error.details?.reason === "provider_not_configured");
    assert.equal(f.calls.filter((c) => c.fn === "record_source_consent").length, 0);
  });
});
