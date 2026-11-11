import type { EvidenceStatus } from "@/types/status";

interface StatusMeta {
  label: string;
  description: string;
  /** Tailwind classes built from design tokens in app/globals.css. */
  className: {
    dot: string;
    badge: string;
  };
}

export const statusConfig: Record<EvidenceStatus, StatusMeta> = {
  sourced: {
    label: "Sourced",
    description: "Directly supported by a cited source.",
    className: {
      dot: "bg-status-sourced",
      badge: "bg-status-sourced-soft text-status-sourced-fg border-status-sourced/20",
    },
  },
  inferred: {
    label: "Inferred",
    description: "Derived from sources but not stated outright.",
    className: {
      dot: "bg-status-inferred",
      badge: "bg-status-inferred-soft text-status-inferred-fg border-status-inferred/25",
    },
  },
  conflicting: {
    label: "Conflicting",
    description: "Sources disagree and need a decision.",
    className: {
      dot: "bg-status-conflicting",
      badge: "bg-status-conflicting-soft text-status-conflicting-fg border-status-conflicting/20",
    },
  },
  missing: {
    label: "Missing",
    description: "Needed knowledge that no source covers yet.",
    className: {
      dot: "bg-status-missing",
      badge: "bg-status-missing-soft text-status-missing-fg border-status-missing/20",
    },
  },
};
