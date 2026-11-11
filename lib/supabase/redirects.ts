/** Redirect helpers for auth flows (pure; safe in proxy, route handlers and tests). */

export function loginPath(nextPath?: string, error?: string): string {
  const params = new URLSearchParams();
  const safe = nextPath ? safeNextPath(nextPath) : null;
  if (safe) params.set("next", safe);
  if (error) params.set("error", error);
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}

/** Only same-origin relative paths ("/x"), never "//host", "/\host" or absolute URLs (open-redirect guard). */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value;
}
