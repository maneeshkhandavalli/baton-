import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";

/** Editorial page titles and prominent headings. */
export const fontSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

/** General interface typography. */
export const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/** Source quotations, technical information and evidence. */
export const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

/** Class list that exposes all font CSS variables; apply to <html>. */
export const fontVariables = [fontSerif.variable, fontSans.variable, fontMono.variable].join(" ");
