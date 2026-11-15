import type { NavItem } from "@/config/navigation";

const under = (pathname: string, prefix: string) => {
  const p = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return pathname === p || pathname.startsWith(`${p}/`);
};

/** Whether a navigation item is the current location. Pure; covered by components/layout/__tests__/nav-match.test.ts. */
export function isNavActive(pathname: string | null, item: Pick<NavItem, "href" | "alsoActiveOn" | "notActiveOn">): boolean {
  if (pathname === null) return false;
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (item.notActiveOn?.some((p) => under(path, p))) return false;
  return under(path, item.href) || (item.alsoActiveOn ?? []).some((p) => under(path, p));
}
