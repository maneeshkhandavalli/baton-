// The worker never runs against the original Supabase project (target-guard.ts), independent of the launcher.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { devDrainAllowed } from "../dev-drain-guard";
import { FORBIDDEN_SUPABASE_REFS, workerTargetAllowed } from "../target-guard";

const ORIGINAL = `https://${FORBIDDEN_SUPABASE_REFS[0]}.supabase.co`;
const BATON_DEV = "https://xnwppnzvrpthukxjfojj.supabase.co";

describe("worker target guard", () => {
  it("refuses the original project in any spelling or case, and unset/unparsable URLs", () => {
    for (const url of [
      ORIGINAL,
      `${ORIGINAL}/`,
      ORIGINAL.toUpperCase(),
      `https://${FORBIDDEN_SUPABASE_REFS[1]}.supabase.co`,
      `https://db.${FORBIDDEN_SUPABASE_REFS[0]}.supabase.co`,
      `https://proxy.example.com/?ref=${FORBIDDEN_SUPABASE_REFS[0]}`,
      undefined,
      "",
      "not a url",
    ]) {
      assert.equal(workerTargetAllowed(url), false, String(url));
    }
  });

  it("allows baton-dev and a local Supabase stack", () => {
    assert.equal(workerTargetAllowed(BATON_DEV), true);
    assert.equal(workerTargetAllowed("http://127.0.0.1:54321"), true);
  });

  it("plain `npm run dev` with .env.local (original project) never starts the dev worker loop", () => {
    assert.equal(devDrainAllowed({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: ORIGINAL }), false);
    assert.equal(devDrainAllowed({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: BATON_DEV }), true);
  });

  it("drainJobs refuses before any database call (static wiring check)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export function drainJobs"));
    assert.ok(body.indexOf("workerTargetAllowed(process.env.NEXT_PUBLIC_SUPABASE_URL)") < body.indexOf("createDrainer("), "guard must run first");
  });
});
