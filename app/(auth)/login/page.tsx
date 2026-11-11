import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <section className="rounded-xl border border-border bg-card p-8 shadow-soft">
      <h1 className="font-serif text-3xl leading-tight">Sign in to Baton</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Authentication is not connected yet. The sign-in flow will be added in a later phase.
      </p>
    </section>
  );
}
