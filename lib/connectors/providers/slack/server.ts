/**
 * slack adapter — STUB created by Main for the Round 4 contract. Owned by Worker 03 (bots): replace this file.
 */

import { ProviderError, type ProviderServerAdapter } from "../adapter";

export const slackAdapter: ProviderServerAdapter = {
  provider: "slack",
  async listChannels() {
    throw new ProviderError("not_configured");
  },
  async describeChannel() {
    throw new ProviderError("not_configured");
  },
};
