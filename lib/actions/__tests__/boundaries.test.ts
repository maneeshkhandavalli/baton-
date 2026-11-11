// Source-level rules for lib/actions and lib/data that a unit test cannot see by importing them
// (Server Function modules pull in next/* and Supabase). Static checks over the source text.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

const ACTION_FILES = ["handovers", "sources", "review", "gaps", "members", "privacy", "account"] as const;

/** §11.3 canonical placement. */
const EXPECTED: Record<(typeof ACTION_FILES)[number], string[]> = {
  handovers: [
    "createHandover", "startProcessing", "cancelProcessing", "publishHandover", "startRevision", "deleteHandover",
    "offerCreatorTransfer", "respondToCreatorTransfer",
  ],
  sources: ["createSourceUpload", "confirmSourceUploaded", "previewSource", "recordSourceConsent", "addExclusion", "confirmIdentityMatch", "removeSource"],
  review: ["reviewPoint", "createManualPoint"],
  gaps: ["createGapQuestion", "createGapInterviewLink", "revokeAccessToken", "submitGapAnswers", "reviewGapAnswer"],
  members: ["inviteMember", "updateMemberClearance", "removeMember", "acknowledgePublication"],
  privacy: ["eraseParticipant"],
  account: ["getAccountDeletionBlockers", "deleteAccount"],
};

const exportedNames = (text: string) => [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]);
const asyncFunctionExports = (text: string) => [...text.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);

describe("lib/actions Server Function modules", () => {
  for (const file of ACTION_FILES) {
    const text = read(`lib/actions/${file}.ts`);

    it(`${file}.ts starts with "use server" and exports exactly its §11.3 async functions`, () => {
      assert.match(text, /^"use server";\n/);
      assert.deepEqual(asyncFunctionExports(text).sort(), [...EXPECTED[file]].sort());
      assert.deepEqual(exportedNames(text).sort(), [...EXPECTED[file]].sort(), "nothing but async functions is exported");
      assert.doesNotMatch(text, /^export\s+(?:\{|\*|default)/m, "no re-exports or default export");
    });

    it(`${file}.ts uses only the server deps and the core module`, () => {
      assert.match(text, /from "\.\/deps"/);
      assert.match(text, new RegExp(`from "\\./core/${file}"`));
      assert.doesNotMatch(text, /lib\/mocks|\.\.\/mocks/);
    });
  }

  it("covers every action the UI mocks export, plus createManualPoint (§11.3; not in the mocks)", () => {
    const mock = new Set(asyncFunctionExports(read("lib/mocks/actions.ts")));
    const real = new Set(Object.values(EXPECTED).flat());
    assert.deepEqual([...mock].filter((n) => !real.has(n)), [], "every mock export exists under the same name");
    assert.deepEqual([...real].filter((n) => !mock.has(n)), ["createManualPoint"]);
  });

  it("deps.ts is server-only, exports only actionDeps, and offers no override", () => {
    const deps = read("lib/actions/deps.ts");
    assert.match(deps, /^import "server-only";/);
    assert.deepEqual(exportedNames(deps), ["actionDeps"]);
    assert.doesNotMatch(deps, /^"use server"/m);
    assert.doesNotMatch(deps, /\b(set|override|reset|replace|inject)\w*\s*\(/i);
    assert.match(deps, /Object\.freeze\(/);
    assert.match(deps, /getActor: requireVerifiedActor/);
  });

  it("core modules are plain modules: no directive, no secrets, no verifier registration, no fabricated actor", () => {
    for (const name of readdirSync(`${ROOT}lib/actions/core`)) {
      const text = read(`lib/actions/core/${name}`);
      assert.doesNotMatch(text, /^"use (server|client)"/m, name);
      assert.doesNotMatch(text, /process\.env/, name);
      assert.doesNotMatch(text, /registerManifestReceiptVerifier|ManifestReceipt/, name);
      assert.doesNotMatch(text, /as\s+(?:unknown\s+as\s+)?VerifiedActor\b/, name);
      assert.doesNotMatch(text, /console\./, `${name}: actions never log`);
    }
  });

  it("D27: erasure and account deletion never reach erase_participant, purge_handover or delete_account_data", () => {
    const privacy = read("lib/actions/core/privacy.ts");
    const account = read("lib/actions/core/account.ts");
    for (const text of [privacy, account]) {
      assert.doesNotMatch(text, /eraseParticipant\(deps\.|getErasureTarget|purgeHandover|deleteAccountData|checkAccountDeletion/);
    }
  });
});

describe("lib/data", () => {
  it("is server-only and returns the real lib/db queries", () => {
    const text = read("lib/data/index.ts");
    assert.match(text, /^import "server-only";/);
    assert.match(text, /import \{ dbQueries \} from "\.\.\/db";/);
    assert.match(text, /export function getQueries\(\): BatonQueries \{\s*return dbQueries;\s*\}/);
    assert.doesNotMatch(text, /from\s+["'][^"']*mocks/);
  });
});
