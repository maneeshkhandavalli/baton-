import { connection } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { AccountMenu } from "./account-menu";

/**
 * The public header's account slot (server component, rendered inside Suspense so the page shell stays static).
 * The session is validated with the Supabase Auth server (getUser, never a decoded cookie). Signed-out visitors
 * get nothing at all, so no account information can leak into a shared or cached response.
 */
export async function HeaderAccount() {
  await connection(); // session reads check token expiry against the current time; request-time only
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user) return null;
  return <AccountMenu name={accountName(user.user_metadata, user.email ?? null)} email={user.email ?? null} />;
}

/** A display name from the auth profile (Google gives full_name/name), else the email's local part. */
function accountName(meta: Record<string, unknown> | undefined, email: string | null): string {
  for (const key of ["display_name", "full_name", "name"]) {
    const v = meta?.[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim().slice(0, 60);
  }
  return email?.split("@")[0]?.slice(0, 60) || "Your account";
}
