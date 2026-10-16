import "server-only";
import { gmail } from "@googleapis/gmail";
import { db } from "@/lib/db";
import { integrationLive } from "@/lib/config";
import { PLATFORM } from "@/lib/institution";
import { googleJwt, PLATFORM_SENDER } from "@/lib/integrations/google";

/**
 * Email out. With the integration off (the default) messages are recorded in
 * the outbox as MOCKED — sysadmins read them at /system/outbox — so every flow
 * can be tested without sending real mail.
 */
export async function sendEmail(input: { to: string; subject: string; body: string; href?: string }) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const link = input.href ? `${input.href.startsWith("http") ? input.href : appUrl + input.href}` : null;
  const text = link ? `${input.body}\n\n${link}` : input.body;

  if (!(await integrationLive("email"))) {
    await db.outboxMessage.create({ data: { channel: "EMAIL", to: input.to, subject: input.subject, body: text, href: link, status: "MOCKED" } });
    return;
  }
  try {
    const auth = googleJwt(PLATFORM_SENDER, ["https://www.googleapis.com/auth/gmail.send"]);
    const raw = Buffer.from(
      [`From: ${PLATFORM.name} <${PLATFORM_SENDER}>`, `To: ${input.to}`, `Subject: ${input.subject}`, "Content-Type: text/plain; charset=UTF-8", "", text].join("\r\n"),
    ).toString("base64url");
    await gmail({ version: "v1", auth }).users.messages.send({ userId: "me", requestBody: { raw } });
    await db.outboxMessage.create({ data: { channel: "EMAIL", to: input.to, subject: input.subject, body: text, href: link, status: "SENT" } });
  } catch (e) {
    await db.outboxMessage.create({
      data: { channel: "EMAIL", to: input.to, subject: input.subject, body: text, href: link, status: "FAILED", error: String(e) },
    });
  }
}
