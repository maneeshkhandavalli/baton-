import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Clock3, LinkIcon, MailCheck, UserCheck, UserRound } from "lucide-react";
import { Suspense } from "react";

import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { formatDate } from "@/components/handover/format";
import { memberRoleLabel } from "@/components/handover/labels";
import { invitationCopy, invitationViewFromDetails, invitationViewFromQuery, type InvitationView } from "@/components/invitations/invitation-view";
import { PageContainer } from "@/components/layout/page-container";
import { PendingSubmitButton } from "@/components/shared/pending-submit-button";
import { ListSkeleton } from "@/components/shared/skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import { getInvitation } from "@/lib/actions/invitations";
import { isWellFormedToken } from "@/lib/db/tokens";
import { routes } from "@/lib/routes";
import { EMAIL_LOGIN_ENABLED } from "@/lib/supabase/login-options";
import { siteOriginOrNull } from "@/lib/supabase/site-url";
import { cn } from "@/lib/utils";

import { acceptInvitationFromForm, requestInviteLink, startGoogleInviteSignIn } from "./actions";

export const metadata: Metadata = { title: "Handover invitation" };

/**
 * Invitation landing (§12.3; R3 Task 06 frozen contract §4). `getInvitation` is read-only and never redeems, so
 * rendering (and prefetching) this page is harmless; accepting is a separate, explicit form submit (A4). The token
 * only redeems the invitation; afterwards the member reads the handover by membership, never by token (§11.7).
 */
export default function InvitationPage({ params, searchParams }: PageProps<"/h/[token]">) {
  return (
    <PageContainer width="default" align="center" className="max-w-6xl">
      <h1 className="sr-only">Handover invitation</h1>
      <Suspense fallback={<ListSkeleton label="Opening the invitation…" rows={1} />}>
        <InvitationContent params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/** One focused card: what this is, what happens next, one primary action. */
function InvitationPanel({
  icon,
  tone = "neutral",
  title,
  description,
  steps,
  details,
  children,
}: {
  icon: React.ReactNode;
  tone?: "neutral" | "error";
  title: string;
  description: string;
  steps?: string[];
  details?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="invitation-title" className="mx-auto w-full max-w-lg rounded-2xl border border-border bg-card p-6 sm:p-8">
      <div
        aria-hidden="true"
        className={cn(
          "flex size-11 items-center justify-center rounded-xl border shadow-xs [&_svg]:size-5",
          tone === "error" ? "border-destructive/20 bg-destructive-soft text-destructive-fg" : "border-border bg-muted text-foreground",
        )}
      >
        {icon}
      </div>
      <h2 id="invitation-title" className="mt-5 type-title text-balance">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
      {details}
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

/** The pending invitation's facts (contract D3: title, inviter, role, expiry and the masked address only). */
function SummaryList({ view }: { view: InvitationView }) {
  const s = view.summary;
  if (!s) return null;
  return (
    <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm">
      <dt className="text-muted-foreground">Handover</dt>
      <dd className="font-medium [overflow-wrap:anywhere]">{s.handoverTitle}</dd>
      <dt className="text-muted-foreground">Invited by</dt>
      <dd className="[overflow-wrap:anywhere]">{s.inviterName}</dd>
      <dt className="text-muted-foreground">Your role</dt>
      <dd>{memberRoleLabel[s.role]}</dd>
      <dt className="text-muted-foreground">Sent to</dt>
      <dd className="font-mono text-xs leading-5 [overflow-wrap:anywhere]">{s.recipientEmailMasked}</dd>
      <dt className="text-muted-foreground">Expires</dt>
      <dd className="inline-flex items-center gap-1.5">
        <Clock3 aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <time dateTime={s.expiresAt}>{formatDate(s.expiresAt)}</time>
      </dd>
    </dl>
  );
}

const SCREEN_ICON: Record<InvitationView["screen"], React.ReactNode> = {
  sign_in_required: <MailCheck />,
  ready_to_accept: <UserCheck />,
  wrong_account: <UserRound />,
  email_unconfirmed: <MailCheck />,
  already_member: <UserCheck />,
  already_accepted: <UserCheck />,
  invalid_link: <LinkIcon />,
  expired: <Clock3 />,
  revoked: <LinkIcon />,
  used: <LinkIcon />,
  unavailable: <LinkIcon />,
  too_many_attempts: <Clock3 />,
  error: <LinkIcon />,
};

async function InvitationContent({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const here = routes.token.handover(token);
  const loginHref = `${routes.login}?next=${encodeURIComponent(here)}`;

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
  // A failed accept comes back as ?error=&reason=; otherwise read the invitation (read-only, never redeems).
  const view =
    invitationViewFromQuery(query) ??
    (isWellFormedToken(token) ? invitationViewFromDetails(await getInvitation({ token })) : invitationViewFromQuery({ error: "token_invalid", reason: "invalid" })!);
  const copy = invitationCopy(view, (r) => memberRoleLabel[r]);
  const panel = { icon: SCREEN_ICON[view.screen], tone: copy.tone, title: copy.title, description: copy.description, steps: copy.steps, details: <SummaryList view={view} /> };

  switch (view.screen) {
    case "sign_in_required":
      return (
        <InvitationPanel {...panel}>
          <div className="w-full max-w-sm space-y-3">
            <GoogleSignInButton start={startGoogleInviteSignIn.bind(null, token)} autoStart={query.continue === "google"} siteOrigin={siteOriginOrNull()} />
            <Link href={loginHref} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
              Sign in or create an account with email
            </Link>
            {EMAIL_LOGIN_ENABLED ? (
              <form action={requestInviteLink.bind(null, token)}>
                <Button type="submit" size="lg" variant="ghost" className="w-full">
                  Email me a sign-in link instead
                </Button>
              </form>
            ) : null}
          </div>
        </InvitationPanel>
      );
    case "ready_to_accept":
      return (
        <InvitationPanel {...panel}>
          {/* A4: the only way to accept is this explicit submit; rendering or prefetching never redeems. */}
          <form action={acceptInvitationFromForm.bind(null, token)}>
            <PendingSubmitButton size="lg" pendingLabel="Accepting…">
              Accept invitation
            </PendingSubmitButton>
          </form>
        </InvitationPanel>
      );
    case "wrong_account":
      return (
        <InvitationPanel {...panel}>
          {/* POST-only route: a link or prefetch can never sign someone out. */}
          <form action={routes.signOut} method="post">
            <Button type="submit">Sign out</Button>
          </form>
          <Link href={routes.dashboard} className={buttonVariants({ variant: "ghost" })}>
            Go to your dashboard
          </Link>
        </InvitationPanel>
      );
    case "email_unconfirmed":
      return (
        <InvitationPanel {...panel}>
          <Link href={loginHref} className={buttonVariants()}>
            Sign in again
          </Link>
        </InvitationPanel>
      );
    case "already_member":
    case "already_accepted":
      return (
        <InvitationPanel {...panel}>
          <Link href={view.memberHref ?? routes.dashboard} className={buttonVariants()}>
            {view.memberHref ? "Open the handover" : "Open your dashboard"}
          </Link>
        </InvitationPanel>
      );
    case "used":
      return (
        <InvitationPanel {...panel}>
          <form action={routes.signOut} method="post">
            <Button type="submit" variant="outline">
              Sign in with another account
            </Button>
          </form>
          <Link href={routes.home} className={buttonVariants({ variant: "ghost" })}>
            Go to Baton
          </Link>
        </InvitationPanel>
      );
    case "too_many_attempts":
    case "error":
      return (
        <InvitationPanel {...panel}>
          <Link href={here} className={buttonVariants({ variant: "outline" })}>
            Try again
          </Link>
        </InvitationPanel>
      );
    default:
      // invalid_link, expired, revoked, unavailable: nothing about the handover is shown.
      return (
        <InvitationPanel {...panel}>
          <Link href={routes.home} className={buttonVariants({ variant: "ghost" })}>
            Go to Baton
          </Link>
        </InvitationPanel>
      );
  }
}
