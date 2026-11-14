import { Schibsted_Grotesk } from "next/font/google";

/** Harbour candidate title face (brand §0), loaded for this preview only until globals switch. */
export const dpTitleFont = Schibsted_Grotesk({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-dp-title", display: "swap" });
