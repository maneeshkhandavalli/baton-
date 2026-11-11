import "server-only";

/**
 * The client IP for rate limiting ONLY (never for security decisions or redirects). Which header carries
 * the real client address depends on the hosting platform — UNVERIFIED until deployed: behind Vercel the
 * platform sets x-forwarded-for / x-real-ip; behind another proxy the first x-forwarded-for entry may be
 * client-controlled. If none is present, only the per-token limits apply.
 */

import { headers } from "next/headers";

export async function requestClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip")?.trim() || null;
}
