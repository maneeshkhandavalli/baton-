"use client";

import { BookOpen, ListChecks } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const TABS = [
  { id: "review", label: "Review workspace", icon: ListChecks, hint: "What the outgoing member and reviewers see" },
  { id: "incoming", label: "Incoming handover", icon: BookOpen, hint: "What the new technical lead receives" },
] as const;

export function DemoTabs({ review, incoming }: { review: ReactNode; incoming: ReactNode }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("review");
  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Demo views" className="grid gap-2 sm:inline-grid sm:grid-cols-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
              tab === t.id ? "border-primary/40 bg-card shadow-soft" : "border-border bg-transparent hover:bg-card/60",
            )}
          >
            <t.icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tab === t.id ? "text-primary" : "text-muted-foreground")} />
            <span>
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="text-xs text-muted-foreground">{t.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="panel-review" aria-labelledby="tab-review" hidden={tab !== "review"}>
        {review}
      </div>
      <div role="tabpanel" id="panel-incoming" aria-labelledby="tab-incoming" hidden={tab !== "incoming"}>
        {incoming}
      </div>
    </div>
  );
}
