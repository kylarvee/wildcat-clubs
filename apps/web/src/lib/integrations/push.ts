import "server-only";
import { db } from "@/lib/db";
import { integrationLive } from "@/lib/config";
import type { DeliveryResult } from "@/lib/integrations/email";

/**
 * Push notifications to the mobile app through Expo's push service, one
 * outbox row per phone (addressed to its token). With the integration off
 * they're recorded in the outbox as MOCKED. Big sends are recorded as QUEUED
 * (queuePushes) and delivered by the "Send queued messages" job
 * (lib/jobs/notifications) with pushSender().
 */
export type PushInput = { title: string; body?: string; href?: string; /** The notification kind behind it. */ kind?: string | null };

/** A push as the outbox records it. */
export type ComposedPush = { to: string; subject: string; body: string; href: string | null };

const compose = (token: string, input: PushInput): ComposedPush => ({ to: token, subject: input.title, body: input.body ?? "", href: input.href ?? null });

/** Pushes to each of the person's phones now and records how each went. */
export async function sendPush(userId: string, input: PushInput) {
  const tokens = await db.pushToken.findMany({ where: { userId }, select: { token: true } });
  if (tokens.length === 0) return;
  const send = await pushSender();
  for (const { token } of tokens) {
    const m = compose(token, input);
    const r = await send(m);
    await db.outboxMessage.create({ data: { channel: "PUSH", ...m, kind: input.kind ?? null, status: r.status, error: r.error, sentAt: new Date() } });
  }
}

/** Records pushes to these people's phones as QUEUED for the "Send queued messages" job. Returns how many wait. */
export async function queuePushes(sends: { userIds: string[]; input: PushInput }[]): Promise<number> {
  const ids = [...new Set(sends.flatMap((s) => s.userIds))];
  if (!ids.length) return 0;
  const phones = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 1000) {
    for (const t of await db.pushToken.findMany({ where: { userId: { in: ids.slice(i, i + 1000) } }, select: { userId: true, token: true } })) phones.set(t.userId, [...(phones.get(t.userId) ?? []), t.token]);
  }
  const rows = sends.flatMap((s) => s.userIds.flatMap((id) => (phones.get(id) ?? []).map((token) => ({ channel: "PUSH" as const, ...compose(token, s.input), kind: s.input.kind ?? null, status: "QUEUED" as const }))));
  for (let i = 0; i < rows.length; i += 1000) await db.outboxMessage.createMany({ data: rows.slice(i, i + 1000) });
  return rows.length;
}

/**
 * A sender for one run: delivers composed pushes (MOCKED while push is off)
 * and says how each went. Never throws. A phone Expo says is gone loses its
 * token, so nothing more is sent to it (delivery bookkeeping, like the outbox).
 */
export async function pushSender(): Promise<(m: ComposedPush) => Promise<DeliveryResult>> {
  const live = await integrationLive("push");
  return async (m) => {
    if (!live) return { status: "MOCKED", error: null };
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ to: m.to, title: m.subject, body: m.body || undefined, data: { href: m.href ?? undefined } }),
      });
      const ticket = readExpoTicket(res.ok, await res.text());
      if (ticket.deviceGone) await db.pushToken.deleteMany({ where: { token: m.to } });
      return { status: ticket.sent ? "SENT" : "FAILED", error: ticket.error };
    } catch (e) {
      return { status: "FAILED", error: String(e) };
    }
  };
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
