import type { Metadata } from "next";

import { SharedLinkShell } from "@/components/layout/shared-link-shell";

// Token links are private; keep them out of search indexes.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return <SharedLinkShell>{children}</SharedLinkShell>;
}
