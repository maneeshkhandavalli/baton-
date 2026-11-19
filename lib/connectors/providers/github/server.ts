/**
 * github adapter — STUB created by Main for the Round 4 contract. Owned by Worker 02 (GitHub): replace this file.
 */

import { ProviderError, type ProviderServerAdapter } from "../adapter";

export const githubAdapter: ProviderServerAdapter = {
  provider: "github",
  async listChannels() {
    throw new ProviderError("not_configured");
  },
  async describeChannel() {
    throw new ProviderError("not_configured");
  },
};
