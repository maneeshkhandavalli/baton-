import type { Metadata } from "next";
import { LinkIcon, MailCheck, UserCheck } from "lucide-react";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/supabase/auth";

import { acceptInvitation, requestInviteLink } from "./actions";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Handover invitation" };

/**
 * Invitation landing (§12.3). The token only redeems the invitation; afterwards the member reads the
 * publication by membership, never by token (§11.7).
 */
export default function InvitationPage({ params, searchParams }: PageProps<"/h/[token]">) {
  return (
    <PageContainer width="default">
      <Suspense fallback={<LoadingState label="Opening the invitation…" className="min-h-96" />}>
        <InvitationContent params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

const ERRORS: Record<string, { title: string; description: string }> = {
  token_invalid: {
    title: "This link isn't valid",
    description:
      "It may have expired, been revoked or been used already. Ask the person who invited you for a new one. If you signed in with a different email address, sign out and use the invited address.",
  },
  conflict: { title: "You're already a member", description: "Open your dashboard to find this handover." },
  rate_limited: { title: "Too many attempts", description: "Please wait a few minutes and try again." },
  internal: { title: "Something went wrong", description: "Please try again in a moment." },
};

async function InvitationContent({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const error = typeof query.error === "string" ? ERRORS[query.error] ?? ERRORS.internal : null;
  if (error) return <EmptyState icon={<LinkIcon />} title={error.title} description={error.description} />;

  if (query.sent === "1") {
    return (
      <EmptyState
        icon={<MailCheck />}
        title="Check your email"
        description="If this invitation is valid, we've sent a sign-in link to the invited address. Open it on this device to continue."
      />
    );
  }

  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const user = await getSessionUser();
  if (!user) {
    return (
      <EmptyState
        icon={<MailCheck />}
        title="You've been invited to a handover"
        description="We'll email a sign-in link to the address this invitation was sent to."
        action={
          <form action={requestInviteLink.bind(null, token)}>
            <Button type="submit">Email me a sign-in link</Button>
          </form>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<UserCheck />}
      title="Accept the invitation"
      description="You're signed in. Accept to join the handover with the role you were invited for."
      action={
        <form action={acceptInvitation.bind(null, token)}>
          <Button type="submit">Accept invitation</Button>
        </form>
      }
    />
  );
}
