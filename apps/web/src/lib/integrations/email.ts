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
 * Subjects carry people's and clubs' names, so they are flattened to one line
 * before they reach a header: a line break there would let a name add its own
 * headers (Bcc:) or replace the body.
 */
export async function sendEmail(input: { to: string; subject: string; body: string; href?: string }) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const link = input.href ? `${input.href.startsWith("http") ? input.href : appUrl + input.href}` : null;
  const text = link ? `${input.body}\n\n${link}` : input.body;
  const subject = oneLine(input.subject);
  const to = input.to.trim();
  const record = (status: "MOCKED" | "SENT" | "FAILED", error?: string) =>
    db.outboxMessage.create({ data: { channel: "EMAIL", to, subject, body: text, href: link, status, error } });

  if (!SAFE_ADDRESS.test(to)) {
    await record("FAILED", "Not a single plain email address, so nothing was sent.");
    return;
  }
  if (!(await integrationLive("email"))) {
    await record("MOCKED");
    return;
  }
  try {
    const auth = googleJwt(PLATFORM_SENDER, ["https://www.googleapis.com/auth/gmail.send"]);
    const raw = Buffer.from(
      [
        `From: ${PLATFORM.name} <${PLATFORM_SENDER}>`,
        `To: ${to}`,
        `Subject: ${encodeHeader(subject)}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "",
        text,
      ].join("\r\n"),
    ).toString("base64url");
    await gmail({ version: "v1", auth }).users.messages.send({ userId: "me", requestBody: { raw } });
    await record("SENT");
  } catch (e) {
    await record("FAILED", String(e));
  }
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
