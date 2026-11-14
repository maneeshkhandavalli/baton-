import type { Metadata } from "next";
import { Suspense } from "react";

import { safeNextPath } from "@/lib/supabase/redirects";
import { siteOriginOrNull } from "@/lib/supabase/site-url";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-raised sm:p-8">
      <h1 className="type-section-title">Sign in to Baton</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Continue with Google, or use your email and password.
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
  return <LoginForm next={safeNextPath(first(params.next))} error={first(params.error)} autoStartGoogle={first(params.continue) === "google"} siteOrigin={siteOriginOrNull()} />;
}
