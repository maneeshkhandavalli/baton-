"use client";

import { BookOpen, ListChecks } from "lucide-react";
import type { ReactNode } from "react";

import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";

const TABS = [
  { id: "review", label: "Review workspace", icon: ListChecks, hint: "What the outgoing member and reviewers see" },
  { id: "incoming", label: "Incoming handover", icon: BookOpen, hint: "What the new technical lead receives" },
] as const;

/** The demo's two views of the same handover. Arrow keys move between tabs (Base UI Tabs). */
export function DemoTabs({ review, incoming }: { review: ReactNode; incoming: ReactNode }) {
  return (
    <Tabs defaultValue="review" className="gap-8">
      <div className="space-y-2">
        <TabsList aria-label="Demo views">
          {TABS.map((t) => (
            <TabsTab key={t.id} value={t.id}>
              <t.icon aria-hidden="true" />
              {t.label}
            </TabsTab>
          ))}
        </TabsList>
      </div>
      <TabsPanel value="review" className="space-y-4">
        <p className="text-caption text-muted-foreground">{TABS[0].hint}.</p>
        {review}
      </TabsPanel>
      <TabsPanel value="incoming" className="space-y-4">
        <p className="text-caption text-muted-foreground">{TABS[1].hint}.</p>
        {incoming}
      </TabsPanel>
    </Tabs>
  );
}
