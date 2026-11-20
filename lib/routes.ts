/**
 * Single source of truth for application paths.
 * Use these helpers instead of hand-built strings so routes can change safely.
 */
export const routes = {
  home: "/",
  /** Public, read-only demo with synthetic data. */
  demo: "/demo",
  /** R3 Task 06: the interactive, per-visitor demo workspace (runs in the browser; lib/demo/engine). */
  demoWorkspace: (step?: string) => (step ? `/demo/workspace?step=${encodeURIComponent(step)}` : "/demo/workspace"),
  login: "/login",
  /** POST-only route handler (app/auth/signout): ends the session. */
  signOut: "/auth/signout",
  dashboard: "/dashboard",
  /** Account settings: creatorship offers and account deletion (§12.9). */
  account: "/account",
  handover: {
    new: "/handover/new",
    processing: (id: string) => `/handover/${encodeURIComponent(id)}/processing`,
    review: (id: string) => `/handover/${encodeURIComponent(id)}/review`,
    gaps: (id: string) => `/handover/${encodeURIComponent(id)}/gaps`,
    /** R3 Task 05E: change reviews found in source updates. */
    changes: (id: string) => `/handover/${encodeURIComponent(id)}/changes`,
    settings: (id: string) => `/handover/${encodeURIComponent(id)}/settings`,
    /** The current publication, read by membership (getPublishedHandover). Reconciliation Q3 proposal. */
    published: (id: string) => `/handover/${encodeURIComponent(id)}/published`,
    /** Decision timeline: the same publication in the order things were said (docs/product/decision-timeline-plan.md). */
    timeline: (id: string) => `/handover/${encodeURIComponent(id)}/timeline`,
  },
  token: {
    /** Contributor link for answering knowledge gaps. */
    gaps: (token: string) => `/g/${encodeURIComponent(token)}`,
    /** Read-only handover link for successors. */
    handover: (token: string) => `/h/${encodeURIComponent(token)}`,
  },
} as const;
