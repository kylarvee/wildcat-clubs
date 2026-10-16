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
      await db.outboxMessage.create({
        data: { channel: "PUSH", to: token, subject: input.title, body: input.body ?? "", href: input.href, status: res.ok ? "SENT" : "FAILED", error: res.ok ? null : await res.text() },
      });
    } catch (e) {
      await db.outboxMessage.create({ data: { channel: "PUSH", to: token, subject: input.title, body: input.body ?? "", href: input.href, status: "FAILED", error: String(e) } });
    }
  }
}
