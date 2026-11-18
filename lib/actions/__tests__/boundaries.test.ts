// Source-level rules for lib/actions and lib/data that a unit test cannot see by importing them
// (Server Function modules pull in next/* and Supabase). Static checks over the source text.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");

const ACTION_FILES = ["handovers", "sources", "review", "gaps", "members", "privacy", "account", "invitations"] as const;

/** §11.3 canonical placement. */
const EXPECTED: Record<(typeof ACTION_FILES)[number], string[]> = {
  handovers: [
    "createHandover", "startProcessing", "continueProcessing", "cancelProcessing", "publishHandover", "startRevision", "deleteHandover",
    "offerCreatorTransfer", "respondToCreatorTransfer", "updateHandoverDetails",
  ],
  sources: ["createSourceUpload", "createSourceVersionUpload", "confirmSourceUploaded", "previewSource", "recordSourceConsent", "addExclusion", "confirmIdentityMatch", "removeSource"],
  review: ["reviewPoint", "createManualPoint"],
  gaps: ["createGapQuestion", "createGapInterviewLink", "revokeAccessToken", "submitGapAnswers", "reviewGapAnswer"],
  members: ["inviteMember", "updateMemberClearance", "removeMember", "acknowledgePublication"],
  privacy: ["eraseParticipant"],
  account: ["getAccountDeletionBlockers", "deleteAccount"],
  // R3 Task 06 (docs/round3/task06-contract.md §6.2)
  invitations: ["getInvitation", "acceptInvitation", "reissueInvitation", "requestInvitationSignInLink"],
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

  it("covers every action the UI mocks export, plus createManualPoint (§11.3), continueProcessing (Round 2 hosted drain nudge) and createSourceVersionUpload (R3 Task 05B); none is in the mocks", () => {
    const mock = new Set(asyncFunctionExports(read("lib/mocks/actions.ts")));
    const real = new Set(Object.values(EXPECTED).flat());
    assert.deepEqual([...mock].filter((n) => !real.has(n)), [], "every mock export exists under the same name");
    const missing = [...real].filter((n) => !mock.has(n));
    assert.deepEqual(missing.sort(), [
      "acceptInvitation", "continueProcessing", "createManualPoint", "createSourceVersionUpload", "getInvitation",
      "reissueInvitation", "requestInvitationSignInLink", // R3 Task 06: invitations have no mock (the demo simulates invites)
    ]);
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

  it("D27: erasure stays closed; account deletion reaches the purge only through delete_own_account", () => {
    const privacy = read("lib/actions/core/privacy.ts");
    const account = read("lib/actions/core/account.ts");
    assert.doesNotMatch(privacy, /eraseParticipant\(deps\.|getErasureTarget|purgeHandover|deleteAccountData|checkAccountDeletion/);
    // Decision 2026-11-14 (migration 20261114100100): one transaction, for the verified actor's own account.
    assert.doesNotMatch(account, /purgeHandover|deleteAccountData|eraseParticipant/);
    assert.match(account, /mutations\.deleteOwnAccount\(db, actor, request\)/);
    assert.match(account, /mutations\.checkAccountDeletion\(db, actor, request\)/);
    assert.match(account, /softDeleteUser\(actor\.profileId\)/, "only the verified actor's own auth user is deleted");
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
