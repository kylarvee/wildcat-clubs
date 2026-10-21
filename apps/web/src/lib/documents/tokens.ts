import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * VERIFICATION LINKS for the documents the platform issues: a person's
 * involvement record (subject: the user) and a club's officers of record
 * (subject: the club). A token names the kind of document, whose it is and
 * when it was issued, signed with an HMAC-SHA256 under a server secret:
 *
 *   <kind>.<subject id>.<issued at, base-36 ms>.<signature, base64url>
 *
 * Nothing is stored (no table): /verify/[token] checks the signature and
 * shows the subject's record as it stands now, with the issue date. Anyone
 * holding the link can open it, so tokens carry ids only, never names or
 * numbers. A link can't be withdrawn one at a time; changing DOCUMENT_SECRET
 * retires every link issued before.
 */

/** Short codes keep the QR small. Retiring a code retires its links. */
export const DOCUMENT_KINDS = { involvement: "ir", officers: "or" } as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;

export type DocumentClaim = { kind: DocumentKind; subjectId: string; issuedAt: Date };

/** 144 bits of the HMAC: 24 base64url characters, no padding. */
const SIG_BYTES = 18;
/** Clocks drift a little between servers; anything issued further in the future is forged. */
const FUTURE_SLACK_MS = 5 * 60_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function signature(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest().subarray(0, SIG_BYTES).toString("base64url");
}

export function signDocumentToken(claim: DocumentClaim, secret: string): string {
  if (!ID.test(claim.subjectId)) throw new Error("A document's subject must be a plain id.");
  const payload = `${DOCUMENT_KINDS[claim.kind]}.${claim.subjectId}.${Math.floor(claim.issuedAt.getTime()).toString(36)}`;
  return `${payload}.${signature(secret, payload)}`;
}

/**
 * The claim a token carries, or null when it isn't one we issued: a changed
 * or cut-off token, an unknown kind, another secret, a date in the future.
 */
export function readDocumentToken(token: string, secret: string, now: Date = new Date()): DocumentClaim | null {
  if (typeof token !== "string" || token.length > 160) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [code, subjectId, issued, sig] = parts;
  const kind = (Object.keys(DOCUMENT_KINDS) as DocumentKind[]).find((k) => DOCUMENT_KINDS[k] === code);
  if (!kind || !ID.test(subjectId) || !/^[0-9a-z]{1,11}$/.test(issued)) return null;
  const expected = Buffer.from(signature(secret, `${code}.${subjectId}.${issued}`));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const issuedAt = parseInt(issued, 36);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now.getTime() + FUTURE_SLACK_MS) return null;
  return { kind, subjectId, issuedAt: new Date(issuedAt) };
}

/** Outside production, links still work with no setup (they only verify on this machine's dev server). */
const DEVELOPMENT_SECRET = "wildcat-clubs-development-documents";

/** DOCUMENT_SECRET, or the development secret outside production. Production refuses to sign without one. */
export function documentSecret(): string {
  const secret = process.env.DOCUMENT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("DOCUMENT_SECRET isn't set, so documents can't carry verification links. Set it in the server's environment (see .env.example).");
  return DEVELOPMENT_SECRET;
}

/** A fresh verification token for a document issued now. */
export function issueDocumentToken(kind: DocumentKind, subjectId: string, issuedAt: Date = new Date()): string {
  return signDocumentToken({ kind, subjectId, issuedAt }, documentSecret());
}

/** What a /verify link says, or null when it isn't one of ours. */
export function verifyDocumentToken(token: string, now: Date = new Date()): DocumentClaim | null {
  return readDocumentToken(token, documentSecret(), now);
}

/** The public verify page for a token, on this deployment's address (APP_URL, like QR codes and emails). */
export function verifyUrl(token: string): string {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")}/verify/${token}`;
}
