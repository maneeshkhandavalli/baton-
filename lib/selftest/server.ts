import "server-only";

/**
 * Server entry points for /test: the owner gate (verified session + BATON_OWNER_EMAILS) and the real report.
 *
 * The request origin is read from the forwarded host headers ONLY to DISPLAY whether BATON_SITE_URL matches the
 * host this page was served from. It is never used to build a redirect, link or fetch target (audit M1: pages are
 * fetched from BATON_SITE_URL), so lib/db/__tests__/boundaries.test.ts allows this one file.
 */

import { headers } from "next/headers";

import { getVerifiedActor } from "../db/actor";
import { SOURCE_BUCKET } from "../db/storage";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/admin";
import { isOwner } from "./gate";
import { runSelfTest } from "./run";
import type { SelfTestDb } from "./db-checks";
import type { SelfTestReport } from "./types";

/** The signed-in owner's email, or null for everyone else (signed out, unconfirmed, not on the list, list empty). */
export async function getVerifiedOwner(): Promise<{ email: string } | null> {
  const actor = await getVerifiedActor();
  if (!actor || !isOwner({ email: actor.email, emailConfirmed: actor.emailConfirmed })) return null;
  return { email: actor.email as string };
}

async function requestOriginForDisplay(): Promise<string | null> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!host || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return null;
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0].trim() === "http" ? "http" : "https";
  return `${proto}://${host}`;
}

export async function buildSelfTestReport(): Promise<SelfTestReport> {
  return runSelfTest({
    env: process.env,
    now: new Date(),
    requestOrigin: await requestOriginForDisplay(),
    db: () => createSupabaseAdminClient() as unknown as SelfTestDb, // throws when the service key is missing → FAIL rows
    fetch: (url, init) => fetch(url, init),
    bucket: SOURCE_BUCKET,
    serviceKeyPresent: isSupabaseAdminConfigured(),
  });
}
