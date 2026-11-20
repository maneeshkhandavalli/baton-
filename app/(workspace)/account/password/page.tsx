import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { FormSkeleton } from "@/components/shared/skeletons";
import { getVerifiedActor } from "@/lib/db/actor";
import { isDemoAccountEmail } from "@/lib/demo-accounts";

import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set a password" };

/**
 * Set or change the password of the signed-in account (proxy.ts keeps /account signed-in only). Reached from the
 * Account page, or from a "set a new password" email link: /auth/callback signs the visitor in first.
 */
export default function SetPasswordPage() {
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader
        back={{ href: "/account", label: "Account" }}
        title="Set a password"
        description="Add a password to sign in with your email address as well as with Google. It's the same account either way."
      />
      <Suspense fallback={<FormSkeleton label="Loading…" fields={2} />}>
        <SetPasswordForViewer />
      </Suspense>
    </PageContainer>
  );
}

/** Shared demo accounts (lib/demo-accounts.ts) see the form turned off; setOwnPassword refuses them too. */
async function SetPasswordForViewer() {
  await connection(); // the session is read per request
  const actor = await getVerifiedActor();
  return <SetPasswordForm demoAccount={isDemoAccountEmail(actor?.email)} />;
}
