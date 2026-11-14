import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/sonner";
import { siteConfig } from "@/config/site";
import { fontVariables } from "@/lib/fonts";
import { THEME_COLOR, THEME_INIT_SRC } from "@/lib/theme";
import { cn } from "@/lib/utils";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
};

export const viewport: Viewport = {
  // Light by default; a saved dark choice updates this tag on the client (lib/theme.ts).
  themeColor: THEME_COLOR.light,
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the theme script may add the `dark` class before React hydrates.
    <html lang="en" className={cn(fontVariables, "h-full")} suppressHydrationWarning>
      <head>
        {/* Must block: it runs before first paint so a saved dark choice never flashes light. A static file,
            not inline HTML (IT-04); it is excluded from the proxy so it never waits on a session refresh. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- blocking is the point (no theme flash) */}
        <script src={THEME_INIT_SRC} />
      </head>
      <body className="min-h-full bg-background font-sans text-foreground">
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
