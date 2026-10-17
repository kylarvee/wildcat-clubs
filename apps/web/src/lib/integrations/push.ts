import "server-only";
import { db } from "@/lib/db";
import { integrationLive } from "@/lib/config";

/**
 * Push notifications to the mobile app through Expo's push service.
 * With the integration off they're recorded in the outbox as MOCKED.
 */
export async function sendPush(userId: string, input: { title: string; body?: string; href?: string }) {
  const tokens = await db.pushToken.findMany({ where: { userId }, select: { token: true } });
  if (tokens.length === 0) return;
  const live = await integrationLive("push");
  for (const { token } of tokens) {
    if (!live) {
      await db.outboxMessage.create({ data: { channel: "PUSH", to: token, subject: input.title, body: input.body ?? "", href: input.href, status: "MOCKED" } });
      continue;
    }
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ to: token, title: input.title, body: input.body, data: { href: input.href } }),
      });
      const ticket = readExpoTicket(res.ok, await res.text());
      await db.outboxMessage.create({
        data: { channel: "PUSH", to: token, subject: input.title, body: input.body ?? "", href: input.href, status: ticket.sent ? "SENT" : "FAILED", error: ticket.error },
      });
      // The app was uninstalled or its token replaced: stop sending to it (delivery bookkeeping, like the outbox).
      if (ticket.deviceGone) await db.pushToken.deleteMany({ where: { token } });
    } catch (e) {
      await db.outboxMessage.create({ data: { channel: "PUSH", to: token, subject: input.title, body: input.body ?? "", href: input.href, status: "FAILED", error: String(e) } });
    }
  }
}

type ExpoTicket = { status?: string; message?: string; details?: { error?: string } };

/**
 * Expo answers HTTP 200 even when it refuses a message; the ticket in the body
 * ({ data: { status: "error", message, details: { error } } }) says so.
 */
export function readExpoTicket(httpOk: boolean, text: string): { sent: boolean; error: string | null; deviceGone: boolean } {
  let ticket: ExpoTicket | undefined;
  try {
    const data = (JSON.parse(text) as { data?: ExpoTicket | ExpoTicket[] }).data;
    ticket = Array.isArray(data) ? data[0] : data;
  } catch {
    ticket = undefined;
  }
  const sent = httpOk && ticket?.status === "ok";
  return {
    sent,
    error: sent ? null : (ticket?.message ?? (text.slice(0, 2000) || "Expo didn't say why.")),
    deviceGone: ticket?.details?.error === "DeviceNotRegistered",
  };
}
