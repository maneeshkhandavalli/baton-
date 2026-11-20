import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { PASSWORD_PAGE_COPY, nowSeconds, passwordPageMode, type PasswordMode } from "@/components/account/password-mode";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { FormSkeleton } from "@/components/shared/skeletons";
import { isDemoAccountEmail } from "@/lib/demo-accounts";
import { getAccountOverview, readSessionAmr } from "@/lib/supabase/account-auth";

import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Password" };

/**
 * Set or change the password of the signed-in account (proxy.ts keeps /account signed-in only). Reached from the
 * Account page, or from a "set a new password" email link: /auth/callback signs the visitor in first.
 */
export default function SetPasswordPage() {
  return (
    <PageContainer width="narrow" className="space-y-8">
      <Suspense fallback={<FormSkeleton label="Loading…" fields={2} />}>
        <SetPasswordForViewer />
      </Suspense>
    </PageContainer>
  );
}

/**
 * Round 4 audit A2: "Set a password" for an account without one (e.g. Google only), "Change your password" (with the
 * current password) for one that has it, and "Set a new password" (no current password) right after a "set a new
 * password" email link. The mode comes from the same rule and the same session claims as setPassword
 * (passwordPageMode / needsCurrentPassword, readSessionAmr). Shared demo accounts (lib/demo-accounts.ts) see the
 * form turned off; setOwnPassword refuses them too.
 */
async function SetPasswordForViewer() {
  await connection(); // the session is read per request
  const [overview, amr] = await Promise.all([getAccountOverview(), readSessionAmr()]);
  const mode: PasswordMode = passwordPageMode(overview?.hasPassword ?? null, amr, nowSeconds());
  const copy = PASSWORD_PAGE_COPY[mode];
  return (
    <>
      <PageHeader back={{ href: "/account", label: "Account" }} title={copy.title} description={copy.description} />
      <SetPasswordForm mode={mode} demoAccount={isDemoAccountEmail(overview?.email)} />
    </>
  );
}
