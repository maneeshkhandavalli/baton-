/**
 * Minimal Telegram Bot API client over `ctx.fetch`. One shared Baton bot (TELEGRAM_BOT_TOKEN, app-level). The Bot
 * API requires the token in the request path (`/bot<token>/<method>`); that URL is built only here, is never
 * logged and never appears in an error (providerFetch maps network failures to a code).
 */

import { ProviderError, type AdapterContext } from "../adapter";
import { isObject, providerFetch, statusError } from "../bots/shared";

const TELEGRAM_API = "https://api.telegram.org";

export async function telegramCall(ctx: Pick<AdapterContext, "env" | "fetch">, method: string, params: Record<string, unknown>): Promise<unknown> {
  const token = ctx.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new ProviderError("not_configured");
  const res = await providerFetch(ctx, `${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (isObject(body) && body.ok === true) return body.result;
  const code = isObject(body) && typeof body.error_code === "number" ? body.error_code : res.status;
  const description = isObject(body) && typeof body.description === "string" ? body.description.toLowerCase() : "";
  const retry = isObject(body) && isObject(body.parameters) && typeof body.parameters.retry_after === "number" ? body.parameters.retry_after : null;
  if (code === 400 && description.includes("chat not found")) throw new ProviderError("not_found");
  if (code === 400 && (description.includes("not enough rights") || description.includes("have no rights"))) throw new ProviderError("forbidden");
  throw statusError(code, retry);
}

export interface TelegramMe {
  id: number;
  username: string | null;
  canReadAllGroupMessages: boolean;
}

export async function getMe(ctx: Pick<AdapterContext, "env" | "fetch">): Promise<TelegramMe> {
  const r = await telegramCall(ctx, "getMe", {});
  if (!isObject(r) || typeof r.id !== "number") throw new ProviderError("invalid_response");
  return { id: r.id, username: typeof r.username === "string" ? r.username : null, canReadAllGroupMessages: r.can_read_all_group_messages === true };
}
