import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/sonner";
import { siteConfig } from "@/config/site";
import { fontVariables } from "@/lib/fonts";
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
  themeColor: "#f7f4ee", // = --background (app/globals.css)
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn(fontVariables, "h-full")}>
      <body className="min-h-full bg-background font-sans text-foreground">
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
