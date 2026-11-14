"use server";

/** Set or change the signed-in user's password (Supabase updateUser). Used after Google sign-in or a reset link. */

import { setOwnPassword, type PasswordResult } from "@/lib/supabase/password-auth";

export async function setPassword(password: string, confirm: string): Promise<PasswordResult> {
  return setOwnPassword(password, confirm);
}
