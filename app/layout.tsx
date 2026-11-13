import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/sonner";
import { siteConfig } from "@/config/site";
import { fontVariables } from "@/lib/fonts";
import { THEME_COLOR, themeInitScript } from "@/lib/theme";
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
    // suppressHydrationWarning: themeInitScript may add the `dark` class before React hydrates.
    <html lang="en" className={cn(fontVariables, "h-full")} suppressHydrationWarning>
      <head>
        {/* Runs before first paint so a saved dark choice never flashes light (lib/theme.ts). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-background font-sans text-foreground">
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
