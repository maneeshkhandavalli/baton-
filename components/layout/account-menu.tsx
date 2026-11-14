"use client";

/**
 * The signed-in visitor's account menu in the public header: their name opens a menu with Account and Sign out.
 * Rendered only when the server found a verified session (HeaderAccount), so signed-out visitors never get it.
 *
 * Sign out posts to the existing POST-only route and comes back to the landing page, which re-renders signed
 * out. If the page is later restored from the back/forward cache, or the tab regains focus after signing out
 * elsewhere, the Supabase session cookie is gone and the menu hides at once while the router refreshes.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const SESSION_COOKIE = /(?:^|;\s*)sb-[a-z0-9]+-auth-token(?:\.\d+)?=/;

const itemClass =
  "flex w-full cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground outline-none select-none data-[highlighted]:bg-muted";

export function AccountMenu({ name, email }: { name: string; email: string | null }) {
  const router = useRouter();
  const signOutForm = useRef<HTMLFormElement>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    const recheck = () => {
      if (!SESSION_COOKIE.test(document.cookie)) {
        setSignedOut(true);
        router.refresh();
      }
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) recheck();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") recheck();
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  if (signedOut) return null;
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label={`Account menu for ${name}`}
          className="inline-flex h-9 max-w-[11rem] items-center gap-2 rounded-md px-1.5 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 data-[popup-open]:bg-muted sm:px-2"
        >
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-fg">
            {initial}
          </span>
          <span className="hidden min-w-0 truncate sm:inline">{name}</span>
          <ChevronDown aria-hidden="true" className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
            <Menu.Popup className="w-60 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-raised outline-none">
              <div className="px-2.5 pt-1.5 pb-2">
                <p className="truncate text-sm font-semibold">{name}</p>
                {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
              </div>
              <div className="my-1 h-px bg-border" />
              <Menu.LinkItem render={<Link href={routes.account} />} className={itemClass}>
                <UserRound aria-hidden="true" className="size-4 text-muted-foreground" />
                Account
              </Menu.LinkItem>
              <Menu.Item className={cn(itemClass)} onClick={() => signOutForm.current?.requestSubmit()}>
                <LogOut aria-hidden="true" className="size-4 text-muted-foreground" />
                Sign out
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {/* POST-only route: a link or prefetch can never sign someone out. Returns to the landing page. */}
      <form ref={signOutForm} action={routes.signOut} method="post" hidden>
        <input type="hidden" name="next" value={routes.home} />
      </form>
    </>
  );
}
