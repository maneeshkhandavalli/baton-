import { NS, seedId } from "../ids";
import type { MockProfile } from "../types";

export const PROFILES = {
  priya: { id: seedId(NS.profile, 1), displayName: "Priya Raman", email: "priya.raman@example.edu" },
  arjun: { id: seedId(NS.profile, 2), displayName: "Arjun Mehta", email: "arjun.mehta@example.edu" },
  neha: { id: seedId(NS.profile, 3), displayName: "Neha Kulkarni", email: "neha.kulkarni@example.edu" },
  kabir: { id: seedId(NS.profile, 4), displayName: "Kabir Shah", email: "kabir.shah@example.edu" },
  sana: { id: seedId(NS.profile, 5), displayName: "Sana Iqbal", email: "sana.iqbal@example.edu" },
  vikram: { id: seedId(NS.profile, 6), displayName: "Vikram Nair", email: "vikram.nair@example.edu" },
  meghna: { id: seedId(NS.profile, 7), displayName: "Meghna Das", email: "meghna.das@example.edu" },
  rohit: { id: seedId(NS.profile, 8), displayName: "Rohit Verma", email: "rohit.verma@example.edu" },
} satisfies Record<string, MockProfile>;

/** The signed-in workspace user in mock mode. */
export const MOCK_VIEWER_ID = PROFILES.priya.id;
