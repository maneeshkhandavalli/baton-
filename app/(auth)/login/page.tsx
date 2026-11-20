import type { Metadata } from "next";
import { Suspense } from "react";

import { safeNextPath } from "@/lib/supabase/redirects";
import { siteOriginOrNull } from "@/lib/supabase/site-url";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
      <h1 className="type-section-title">Sign in or create an account</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        New to Baton? Choose &ldquo;Create an account&rdquo; below.
      </p>
      {/* searchParams is runtime data: read it inside Suspense so the shell stays static (README). */}
      <Suspense fallback={<LoginForm next={null} error={null} autoStartGoogle={false} siteOrigin={siteOriginOrNull()} />}>
        <LoginFormWithParams searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function LoginFormWithParams({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const next = safeNextPath(first(params.next));
  return (
    <>
      {/* Round 4 (journey audit 1.1): someone following an invitation is told they come back to it. */}
      {next?.startsWith("/h/") ? (
        <p className="mt-3 text-caption text-muted-foreground">
          You&rsquo;ll come back to your invitation afterwards. Use the email address it was sent to.
        </p>
      ) : null}
      <LoginForm next={next} error={first(params.error)} autoStartGoogle={first(params.continue) === "google"} siteOrigin={siteOriginOrNull()} />
    </>
  );
}
