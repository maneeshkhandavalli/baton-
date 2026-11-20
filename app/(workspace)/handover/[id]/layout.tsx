import { Suspense } from "react";

import { HandoverHeader, HandoverHeaderFallback } from "@/components/handover/handover-header";
import { HandoverNavFallback } from "@/components/handover/handover-nav";
import { FRAME_CLASS } from "@/components/layout/page-container";
import { HandoverNavForViewer } from "@/components/handover/handover-nav-for-viewer";
import { PeopleProvider } from "@/components/shared/person-token";

export default function HandoverLayout({ children, params }: LayoutProps<"/handover/[id]">) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border">
        <div className={FRAME_CLASS}>
          <Suspense fallback={<HandoverHeaderFallback />}>
            <HandoverHeader params={params} />
          </Suspense>
          <Suspense fallback={<HandoverNavFallback />}>
            <HandoverNavForViewer params={params} />
          </Suspense>
        </div>
      </div>
      <div className="flex-1">
        <PeopleProvider>{children}</PeopleProvider>
      </div>
    </div>
  );
}
