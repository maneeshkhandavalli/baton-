"use client";

/**
 * Round 4 (Worker 02): the persistent Help entry in the workspace header (desktop sidebar and mobile top bar).
 * Reopens the welcome, replays the tour for each role the user actually has, shows the Getting Started checklist,
 * and resets guidance. Hidden until the signed-in user's guidance state has loaded (and in shells without it).
 */

import { useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { CircleHelp, ListChecks, Map as MapIcon, RotateCcw, Sparkles } from "lucide-react";

import type { GuideRole } from "@/lib/onboarding/state";
import { cn } from "@/lib/utils";

import { useGuidance } from "./guidance";

const itemClass =
  "flex w-full cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground outline-none select-none data-[highlighted]:bg-muted data-[disabled]:opacity-50";

const TOUR_LABEL: Record<GuideRole, string> = { creator: "Tour: preparing a handover", incoming: "Tour: reading your handover" };

export function HelpMenu({ className, size = "sm" }: { className?: string; size?: "sm" | "lg" }) {
  const g = useGuidance();
  const router = useRouter();
  if (!g?.data) return null;
  const { data, state, startTour, openWelcome, record } = g;
  const tours = data.roles.roles.filter((r) => (data.tours[r]?.length ?? 0) > 0);
  const single = tours.length === 1;

  return (
    <Menu.Root>
      <Menu.Trigger
        data-tour="help-menu"
        aria-label="Help and guidance"
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-medium outline-none focus-ring hover:bg-muted data-[popup-open]:bg-muted",
          size === "lg" ? "size-11" : "h-8 px-2.5",
          className,
        )}
      >
        <CircleHelp aria-hidden="true" className="size-4" />
        {size === "sm" && <span>Help</span>}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Menu.Popup className="w-64 rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-raised outline-none">
            <p className="px-2.5 pt-1.5 pb-1 type-eyebrow text-muted-foreground">Help</p>
            <Menu.Item className={itemClass} onClick={openWelcome}>
              <Sparkles aria-hidden="true" className="size-4 text-muted-foreground" />
              Welcome to Baton
            </Menu.Item>
            {tours.map((role) => (
              <Menu.Item key={role} className={itemClass} onClick={() => startTour(role)}>
                <MapIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                {single ? (state?.tour?.[role] ? "Replay the tour" : "Take the tour") : TOUR_LABEL[role]}
              </Menu.Item>
            ))}
            <Menu.Item
              className={itemClass}
              onClick={() => {
                if (state?.checklistDismissedAt) record({ type: "checklist_restored" });
                window.dispatchEvent(new Event("baton:show-checklist")); // a list hidden in this tab shows again
                router.push(data.checklistHref);
              }}
            >
              <ListChecks aria-hidden="true" className="size-4 text-muted-foreground" />
              Getting started checklist
            </Menu.Item>
            <div className="my-1 h-px bg-border" />
            <Menu.Item
              className={itemClass}
              onClick={() => {
                record({ type: "reset" });
                openWelcome();
              }}
            >
              <RotateCcw aria-hidden="true" className="size-4 text-muted-foreground" />
              Reset guidance
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
