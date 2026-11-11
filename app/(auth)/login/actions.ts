"use server";

/**
 * Magic-link sign-in (§12.3). The response never reveals whether an account exists for the address.
 * The redirect destination comes only from the configured site URL (M1), never from request headers.
 */

import { z } from "zod";

import { safeNextPath } from "@/lib/supabase/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authCallbackUrl } from "@/lib/supabase/site-url";

export type MagicLinkState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; code: "validation_failed" | "rate_limited" | "internal"; message: string };

const input = z.object({
  email: z.email().max(254),
  next: z.string().max(2048).optional(),
});

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const parsed = input.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    next: formData.get("next") ? String(formData.get("next")) : undefined,
  });
  if (!parsed.success) {
    return { status: "error", code: "validation_failed", message: "Enter a valid email address." };
  }

  let emailRedirectTo: string;
  try {
    emailRedirectTo = authCallbackUrl(safeNextPath(parsed.data.next));
  } catch {
    console.error("[auth] BATON_SITE_URL is missing or unsafe; refusing to send a magic link");
    return { status: "error", code: "internal", message: "Something went wrong on our side." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo, shouldCreateUser: true },
  });

  if (error) {
    if (error.status === 429) {
      return { status: "error", code: "rate_limited", message: "Too many attempts. Please wait a moment." };
    }
    // Do not reveal provider details or whether the address is known.
    console.error("[auth] signInWithOtp failed", { status: error.status, code: error.code });
    return { status: "error", code: "internal", message: "We couldn't send the link. Please try again." };
  }
  return { status: "sent" };
}
