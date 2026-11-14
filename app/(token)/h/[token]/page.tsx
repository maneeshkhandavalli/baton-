import type { Metadata } from "next";
import Link from "next/link";
import { LinkIcon, MailCheck, UserCheck } from "lucide-react";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { ListSkeleton } from "@/components/shared/skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { getSessionUser } from "@/lib/supabase/auth";
import { cn } from "@/lib/utils";

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
      <h1 className="sr-only">Handover invitation</h1>
      <Suspense fallback={<ListSkeleton label="Opening the invitation…" rows={1} />}>
        <InvitationContent params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

type ErrorKind = "token_invalid" | "conflict" | "rate_limited" | "internal";

const ERRORS: Record<ErrorKind, { title: string; description: string }> = {
  token_invalid: {
    title: "This link isn't valid",
    description:
      "It may have expired, been revoked or been used already. Ask the person who invited you for a new one. If you signed in with a different email address, sign out and use the invited address.",
  },
  conflict: { title: "You're already a member", description: "Open your dashboard to find this handover." },
  rate_limited: { title: "Too many attempts", description: "Please wait a few minutes and try again." },
  internal: { title: "Something went wrong", description: "Please try again in a moment." },
};

const isErrorKind = (v: string): v is ErrorKind => Object.hasOwn(ERRORS, v);

/** One focused card: what this is, what happens next, one primary action. */
function InvitationPanel({
  icon,
  tone = "neutral",
  title,
  description,
  steps,
  children,
}: {
  icon: React.ReactNode;
  tone?: "neutral" | "error";
  title: string;
  description: string;
  steps?: string[];
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="invitation-title"
      className="mx-auto w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8"
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex size-11 items-center justify-center rounded-xl border shadow-xs [&_svg]:size-5",
          tone === "error" ? "border-destructive/20 bg-destructive-soft text-destructive-fg" : "border-primary/15 bg-primary-soft text-primary-fg",
        )}
      >
        {icon}
      </div>
      <h2 id="invitation-title" className="mt-5 type-title text-balance">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
      {steps && (
        <ol className="mt-5 space-y-2.5 border-t border-border pt-5" aria-label="What happens next">
          {steps.map((step, i) => (
            <li key={step} className="flex items-start gap-3 text-sm">
              <span
                aria-hidden="true"
                className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-2xs text-muted-foreground tabular-nums"
              >
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      )}
      {children && <div className="mt-6 flex flex-wrap items-center gap-2">{children}</div>}
    </section>
  );
}

async function InvitationContent({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (typeof query.error === "string") {
    const kind: ErrorKind = isErrorKind(query.error) ? query.error : "internal";
    const error = ERRORS[kind];
    return (
      <InvitationPanel tone={kind === "conflict" ? "neutral" : "error"} icon={kind === "conflict" ? <UserCheck /> : <LinkIcon />} title={error.title} description={error.description}>
        {kind === "conflict" && (
          <Link href={routes.dashboard} className={buttonVariants()}>
            Open your dashboard
          </Link>
        )}
        {kind === "token_invalid" && (
          <>
            {/* POST-only route: a link or prefetch can never sign someone out. */}
            <form action={routes.signOut} method="post">
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
            <Link href={routes.home} className={buttonVariants({ variant: "ghost" })}>
              Go to Baton
            </Link>
          </>
        )}
        {(kind === "rate_limited" || kind === "internal") && (
          <Link href={routes.token.handover(token)} className={buttonVariants({ variant: "outline" })}>
            Back to the invitation
          </Link>
        )}
      </InvitationPanel>
    );
  }

  if (query.sent === "1") {
    return (
      <InvitationPanel
        icon={<MailCheck />}
        title="Check your email"
        description="If this invitation is valid, we've sent a sign-in link to the invited address. Open it on this device to continue."
        steps={["Open the email from Baton (check spam if it isn't there).", "Follow the sign-in link on this device.", "Accept the invitation to open the handover."]}
      />
    );
  }

  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const user = await getSessionUser();
  if (!user) {
    return (
      <InvitationPanel
        icon={<MailCheck />}
        title="You've been invited to a handover"
        description="Someone is passing on what their team knows, with quotes from the original chats and documents you can check. We'll email a sign-in link to the address this invitation was sent to."
        steps={["We email a sign-in link to the invited address. No password needed.", "Open the link on this device.", "Accept, and the handover opens."]}
      >
        <form action={requestInviteLink.bind(null, token)}>
          <Button type="submit" size="lg">
            Email me a sign-in link
          </Button>
        </form>
      </InvitationPanel>
    );
  }

  return (
    <InvitationPanel
      icon={<UserCheck />}
      title="Accept the invitation"
      description="You're signed in. Accept to join the handover with the role you were invited for."
    >
      <form action={acceptInvitation.bind(null, token)}>
        <Button type="submit" size="lg">
          Accept invitation
        </Button>
      </form>
    </InvitationPanel>
  );
}
