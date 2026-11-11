/**
 * Single source of truth for application paths.
 * Use these helpers instead of hand-built strings so routes can change safely.
 */
export const routes = {
  home: "/",
  login: "/login",
  dashboard: "/dashboard",
  handover: {
    new: "/handover/new",
    processing: (id: string) => `/handover/${encodeURIComponent(id)}/processing`,
    review: (id: string) => `/handover/${encodeURIComponent(id)}/review`,
    gaps: (id: string) => `/handover/${encodeURIComponent(id)}/gaps`,
    settings: (id: string) => `/handover/${encodeURIComponent(id)}/settings`,
  },
  token: {
    /** Contributor link for answering knowledge gaps. */
    gaps: (token: string) => `/g/${encodeURIComponent(token)}`,
    /** Read-only handover link for successors. */
    handover: (token: string) => `/h/${encodeURIComponent(token)}`,
  },
} as const;
