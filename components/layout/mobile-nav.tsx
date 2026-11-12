"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { BatonLogo } from "@/components/shared/baton-logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

import { WorkspaceNavigation } from "./workspace-navigation";

/** Menu button + left drawer with the workspace navigation. Closes when a link is followed. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}>
        <Menu aria-hidden="true" />
      </DialogTrigger>
      <DialogContent side="left" className="bg-sidebar text-sidebar-foreground">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="flex h-14 shrink-0 items-center px-5">
          <BatonLogo size="sm" />
        </div>
        <div
          className="flex flex-1 flex-col"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <WorkspaceNavigation className="flex-1 px-3 pt-2 pb-6" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
