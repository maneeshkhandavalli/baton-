import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LabBar } from "./design/_shared/lab-bar";

export const metadata: Metadata = { title: "Design lab", robots: { index: false, follow: false } };

/**
 * DESIGN EXPLORATION ONLY (dev-only, isolated). Four landing-page concepts for Baton's visual identity, built on
 * the same content so they can be compared fairly. Nothing here is linked from the app, nothing imports from it
 * except read-only content, and a production build serves 404. Remove the whole `app/(design-lab)` folder to
 * delete the exploration.
 */
export default function DesignLabLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <>
      {children}
      <LabBar />
    </>
  );
}
