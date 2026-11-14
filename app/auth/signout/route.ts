/**
 * Sign out (POST only, so a link or prefetch can never sign someone out). An optional form field `next` (a safe
 * same-origin path, e.g. "/" from the public header) chooses where to land; otherwise the sign-in page.
 */

import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/supabase/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  let next: string | null = null;
  try {
    const value = (await request.formData()).get("next");
    next = typeof value === "string" ? safeNextPath(value) : null;
  } catch {
    // no form body (or not a form): the default below
  }
  return NextResponse.redirect(new URL(next ?? "/login", request.url), { status: 303 });
}
