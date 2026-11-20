import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { GuidanceBootstrap } from "@/components/onboarding/guidance-bootstrap";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      guidance={
        <Suspense fallback={null}>
          <GuidanceBootstrap />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
