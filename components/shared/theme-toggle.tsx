"use client";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/**
 * Light/dark switch (a toggle button: the label stays "Dark theme", `aria-pressed` says whether it is on).
 * The icon is chosen by CSS from the `dark` class, so it is right on first paint, before hydration.
 */
export function ThemeToggle({ className, size = "icon" }: { className?: string; size?: "icon-sm" | "icon" | "icon-lg" }) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      aria-label="Dark theme"
      aria-pressed={isDark}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn("text-muted-foreground hover:text-foreground", className)}
    >
      <Moon aria-hidden="true" className="dark:hidden" />
      <Sun aria-hidden="true" className="hidden dark:block" />
    </Button>
  );
}
