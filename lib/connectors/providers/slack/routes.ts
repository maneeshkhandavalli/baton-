/**
 * Slack route handlers (Round 4, Worker 03). app/api/connectors/slack/* are thin wrappers around these.
 *
 *   GET  /api/connectors/slack/install?handover=<id>  → slack.com/oauth/v2/authorize (bot scopes, signed state)
 *   GET  /api/connectors/slack/callback               → state check → oauth.v2.access server-side → sealed token
 *   POST /api/connectors/slack/webhook                → signing secret + replay window first, then:
 *        url_verification → challenge;  event_callback → ingestEvent (de-dup by event_id);
 *        form-encoded slash command `/handover` → ephemeral answer with a signed intent or a status.
 * Slack expects an answer within 3 s: the only provider calls on this path are users.info lookups for channels that
 * are actually capturing (cached per request).
 */

import { httpStatusFor, ingestEvent } from "../../ingest";
import { sealCredentials } from "../../secrets";
import { verifySlackSignature } from "../../verify";
import {
  afterInstallPath,
  beginInstall,
  callbackErrorCode,
  checkCallback,
  handoverCommandReply,
  isConfigured,
  json,
  logCode,
  logOutcome,
  notFound,
  parseJson,
  readRawBody,
  redirectExternal,
  redirectTo,
  text,
  type BotRouteDeps,
} from "../bots/shared";
import { SLACK_AUTHORIZE_URL, SLACK_BOT_SCOPES, exchangeSlackCode } from "./api";
import { parseSlackEnvelope, resolveAuthors } from "./server";

export const SLACK_COMMAND = "/handover";

export async function handleSlackInstall(request: Request, deps: BotRouteDeps): Promise<Response> {
  const start = await beginInstall("slack", request, deps);
  if (!start.ok) return start.response;
  const q = new URLSearchParams({ client_id: deps.env.SLACK_CLIENT_ID ?? "", scope: SLACK_BOT_SCOPES.join(","), redirect_uri: start.redirectUri, state: start.state });
  return redirectExternal(`${SLACK_AUTHORIZE_URL}?${q}`);
}

export async function handleSlackCallback(request: Request, deps: BotRouteDeps): Promise<Response> {
  const check = await checkCallback("slack", request, deps);
  if (!check.ok) return check.response;
  if (!deps.secretKey) {
    logCode(deps, "slack", "oauth_callback", "secret_key_missing");
    return redirectTo(deps.env, afterInstallPath("slack", check.handoverId, "unavailable"));
  }
  try {
    const x = await exchangeSlackCode(deps, check.code, check.redirectUri);
    const sealed = sealCredentials(deps.secretKey, "slack", x.teamId, x.token);
    await deps.store.upsertInstallation({ kind: "user", profileId: check.profileId }, { provider: "slack", externalAccountId: x.teamId, accountLabel: x.teamName.slice(0, 120), scopes: x.scopes, credentials: sealed });
    return redirectTo(deps.env, afterInstallPath("slack", check.handoverId, "connected"));
  } catch (e) {
    const code = callbackErrorCode(e);
    logCode(deps, "slack", "oauth_callback", code);
    return redirectTo(deps.env, afterInstallPath("slack", check.handoverId, code));
  }
}

export async function handleSlackWebhook(request: Request, deps: BotRouteDeps): Promise<Response> {
  if (!isConfigured("slack", deps.env)) return notFound();
  const raw = await readRawBody(request);
  if (raw === null) return text("Payload too large", 413);
  const ok = verifySlackSignature(deps.env.SLACK_SIGNING_SECRET ?? "", raw, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"), deps.now());
  if (!ok) {
    logCode(deps, "slack", "request", "bad_signature");
    return text("invalid signature", 401);
  }
  if ((request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) return slashCommand(new URLSearchParams(raw), deps);

  const parsed = parseSlackEnvelope(parseJson(raw));
  if (parsed.kind === "invalid") return json({ ok: true });
  if (parsed.kind === "challenge") return json({ challenge: parsed.challenge });

  const event = parsed.event;
  if (parsed.pending.length > 0 && event.externalAccountId && event.externalChannelId) {
    // Resolve display names only when a link of this channel is capturing; otherwise ingest drops the event anyway.
    const capturing = await deps.store.capturingLinks("slack", event.externalAccountId, event.externalChannelId).catch(() => []);
    if (capturing.length > 0) {
      const installation = await deps.store.findInstallation("slack", event.externalAccountId).catch(() => null);
      const token = installation && installation.status === "active" ? await deps.credentials(installation).catch(() => null) : null;
      try {
        event.messages = await resolveAuthors(deps, token, parsed.pending);
      } catch {
        logCode(deps, "slack", event.eventType, "provider_rate_limited");
        return json({ ok: false }, 503); // Slack retries; the ledger has not seen this delivery yet
      }
    }
  }
  const outcome = await ingestEvent(deps.store, event);
  logOutcome(deps, "slack", event.eventType, outcome);
  return json({ ok: outcome.status !== "failed" }, httpStatusFor(outcome));
}

async function slashCommand(form: URLSearchParams, deps: BotRouteDeps): Promise<Response> {
  if (form.get("command") !== SLACK_COMMAND) return json({ response_type: "ephemeral", text: "Baton doesn't know that command." });
  const team = form.get("team_id");
  const channel = form.get("channel_id");
  if (!team || !channel || !/^[CG]/.test(channel)) {
    return json({ response_type: "ephemeral", text: "Use /handover in a channel to connect it to a Baton handover." });
  }
  const installation = await deps.store.findInstallation("slack", team).catch(() => null);
  const channelName = form.get("channel_name");
  const reply = await handoverCommandReply(deps.store, deps.env, deps.now(), {
    provider: "slack",
    account: team,
    accountLabel: installation && installation.status !== "revoked" ? installation.accountLabel : (form.get("team_domain") ?? "Slack workspace"),
    channel,
    channelLabel: channelName && channelName !== "privategroup" ? `#${channelName}` : "this channel",
  });
  return json({ response_type: "ephemeral", text: reply });
}
