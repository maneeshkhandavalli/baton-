import { Suspense } from "react";

import { HandoverHeader, HandoverHeaderFallback } from "@/components/handover/handover-header";
import { HandoverNav, HandoverNavFallback } from "@/components/handover/handover-nav";

export default function HandoverLayout({ children, params }: LayoutProps<"/handover/[id]">) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border">
        <div className="mx-auto w-full max-w-[90rem] px-4 sm:px-6 lg:px-10 xl:px-12">
          <Suspense fallback={<HandoverHeaderFallback />}>
            <HandoverHeader params={params} />
          </Suspense>
          <Suspense fallback={<HandoverNavFallback />}>
            <HandoverNav />
          </Suspense>
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
