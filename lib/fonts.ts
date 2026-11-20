import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Host_Grotesk } from "next/font/google";

/**
 * The identity's three faces (the landing page and the app share them): all SIL OFL, variable weight, latin subset,
 * self-hosted by next/font. The marketing layout imports these same instances, so each face is declared once.
 */

/** Display: page and section titles (`type-page-title`, `font-display`). */
export const fontDisplay = Host_Grotesk({
  subsets: ["latin"],
  variable: "--font-host-grotesk",
  display: "swap",
});

/** General interface typography. */
export const fontSans = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-atkinson-next",
  display: "swap",
});

/** Source quotations, references, data and technical labels. */
export const fontMono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  variable: "--font-atkinson-mono",
  display: "swap",
});

/** Class list that exposes all font CSS variables; apply to <html>. */
export const fontVariables = [fontDisplay.variable, fontSans.variable, fontMono.variable].join(" ");
