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
 *
 * Big sends don't go out here: lib/domain/notify records them as QUEUED
 * (queueEmails), and the "Send queued messages" job (lib/jobs/notifications)
 * delivers them in batches with emailSender(), updating the same rows.
 *
 * Subjects carry people's and clubs' names, so they are flattened to one line
 * before they reach a header: a line break there would let a name add its own
 * headers (Bcc:) or replace the body.
 */
export type EmailInput = { to: string; subject: string; body: string; href?: string; /** The notification kind behind it, when there is one. */ kind?: string | null };

/** An email as the outbox records it: one-line subject, the link under the body. */
export type ComposedEmail = { to: string; subject: string; body: string; href: string | null };

export type DeliveryResult = { status: "SENT" | "MOCKED" | "FAILED"; error: string | null };

const NOT_ONE_ADDRESS = "Not a single plain email address, so nothing was sent.";

export function composeEmail(input: EmailInput): ComposedEmail {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const link = input.href ? `${input.href.startsWith("http") ? input.href : appUrl + input.href}` : null;
  return { to: input.to.trim(), subject: oneLine(input.subject), body: link ? `${input.body}\n\n${link}` : input.body, href: link };
}

/** Sends one email now and records it (SENT, MOCKED or FAILED). */
export async function sendEmail(input: EmailInput) {
  const m = composeEmail(input);
  const r = await (await emailSender())(m);
  await db.outboxMessage.create({ data: { channel: "EMAIL", ...m, kind: input.kind ?? null, status: r.status, error: r.error, sentAt: new Date() } });
}

/** Records emails as QUEUED for the "Send queued messages" job. An address that can't be sent to is FAILED right away. Returns how many wait. */
export async function queueEmails(inputs: EmailInput[]): Promise<number> {
  const now = new Date();
  const rows = inputs.map((input) => {
    const m = composeEmail(input);
    const ok = SAFE_ADDRESS.test(m.to);
    return { channel: "EMAIL" as const, ...m, kind: input.kind ?? null, status: ok ? ("QUEUED" as const) : ("FAILED" as const), error: ok ? null : NOT_ONE_ADDRESS, sentAt: ok ? null : now };
  });
  for (let i = 0; i < rows.length; i += 1000) await db.outboxMessage.createMany({ data: rows.slice(i, i + 1000) });
  return rows.filter((r) => r.status === "QUEUED").length;
}

/**
 * A sender for one run: delivers composed emails (MOCKED while the integration
 * is off) and says how each went. Never throws; the Gmail sign-in is made once
 * and shared by every message the sender handles.
 */
export async function emailSender(): Promise<(m: ComposedEmail) => Promise<DeliveryResult>> {
  const live = await integrationLive("email");
  let client: ReturnType<typeof gmail> | null = null;
  return async (m) => {
    if (!SAFE_ADDRESS.test(m.to)) return { status: "FAILED", error: NOT_ONE_ADDRESS };
    if (!live) return { status: "MOCKED", error: null };
    try {
      client ??= gmail({ version: "v1", auth: googleJwt(PLATFORM_SENDER, ["https://www.googleapis.com/auth/gmail.send"]) });
      const raw = Buffer.from(
        [
          `From: ${PLATFORM.name} <${PLATFORM_SENDER}>`,
          `To: ${m.to}`,
          `Subject: ${encodeHeader(oneLine(m.subject))}`,
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=UTF-8",
          "",
          m.body,
        ].join("\r\n"),
      ).toString("base64url");
      await client.users.messages.send({ userId: "me", requestBody: { raw } });
      return { status: "SENT", error: null };
    } catch (e) {
      return { status: "FAILED", error: String(e) };
    }
  };
}

/** One address, no spaces, control characters or header punctuation (so nothing can ride along in To:). */
const SAFE_ADDRESS = /^[^\s\u0000-\u001f\u007f<>()",;:\\[\]@]+@[^\s\u0000-\u001f\u007f<>()",;:\\[\]@]+$/;

/** Control characters (CR/LF included) become a single space. */
export function oneLine(s: string) {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

/**
 * RFC 2047 encoded-words, so curly quotes, dashes and emoji arrive intact. Each
 * word holds at most 45 bytes (60 base64 characters, under the 75 the RFC
 * allows), split on whole characters; the words are folded onto new lines.
 */
export function encodeHeader(s: string) {
  const words: string[] = [];
  let chunk = "";
  for (const ch of s) {
    if (chunk && Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join("\r\n ");
}
