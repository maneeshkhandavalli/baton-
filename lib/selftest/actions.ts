"use server";

/**
 * Server Action for the /test page's opt-in live AI check. Gated by the same owner allow-list as the page:
 * anyone else gets a generic refusal (no hint that the page exists). Keeps a short-lived httpOnly cookie with
 * the last run time so the 60 s cooldown also holds across server instances for the owner.
 */

import { cookies } from "next/headers";

import { runLiveAiCheck, LIVE_AI_COOLDOWN_MS, type LiveAiResult } from "./live-ai";
import { getVerifiedOwner } from "./server";

const COOKIE = "baton_selftest_ai_at";

export async function runLiveAiCheckAction(): Promise<LiveAiResult> {
  const owner = await getVerifiedOwner();
  if (!owner) return { ok: false, message: "Not available.", ranAt: new Date().toISOString() };
  const jar = await cookies();
  const last = Number(jar.get(COOKIE)?.value ?? 0);
  const now = Date.now();
  const result = await runLiveAiCheck(Number.isFinite(last) ? last : 0, now);
  if (!result.message.startsWith("Cooldown")) {
    jar.set(COOKIE, String(now), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/test", maxAge: Math.ceil((LIVE_AI_COOLDOWN_MS * 2) / 1000) });
  }
  return result;
}
