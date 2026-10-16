import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Check-in codes and rotating QR tokens.
 *
 * Every occurrence has a short `checkinCode` (in the URL and typed by hand) and
 * a private `checkinSecret`. The QR on the leader's screen encodes
 * `/c/<code>?t=<token>`, where the token is an HMAC of the current time window.
 * It changes every `checkin.qrRotateSeconds`, so a photo of the screen sent to a
 * friend stops working. Scans with a valid token count as QR check-ins; the
 * code alone counts as a self check-in, which the event can switch off.
 *
 * A rotating token only lives ~1–1.5 minutes, which is too short for someone
 * who scans, then has to log in (or pauses before tapping "Check in"). So when
 * the check-in page sees a live token it swaps it for a *pass*: a signed,
 * timestamped proof of that scan that stays good for CHECKIN_PASS_MAX_AGE_MS.
 * Passes are only ever minted from a live token, never from another pass.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function generateCheckinCode(length = 6) {
  let s = "";
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function generateCheckinSecret() {
  let s = "";
  for (let i = 0; i < 32; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function tokenWindow(now: number, rotateSeconds: number) {
  return Math.floor(now / (rotateSeconds * 1000));
}

export function checkinToken(secret: string, window: number) {
  return createHmac("sha256", secret).update(String(window)).digest("base64url").slice(0, 12);
}

/** Accepts the current window and the two before it (time to scan, slow networks). */
export function verifyCheckinToken(secret: string, token: string, now: number, rotateSeconds: number) {
  const w = tokenWindow(now, rotateSeconds);
  return [w, w - 1, w - 2].some((x) => safeEqual(checkinToken(secret, x), token));
}

export function checkinPath(code: string, token?: string) {
  return token ? `/c/${code}?t=${encodeURIComponent(token)}` : `/c/${code}`;
}

// ─── Scan passes ────────────────────────────────────────────────────────────

/** How long a scan stays good for while someone logs in or taps "Check in". */
export const CHECKIN_PASS_MAX_AGE_MS = 10 * 60_000;

function passSignature(secret: string, issued: string) {
  return createHmac("sha256", secret).update(`pass:${issued}`).digest("base64url").slice(0, 16);
}

/** A pass proving a live QR token was presented at `now`. Format: p<issued base36>.<sig>. */
export function checkinPass(secret: string, now: number) {
  const issued = Math.floor(now / 1000).toString(36);
  return `p${issued}.${passSignature(secret, issued)}`;
}

export function isCheckinPass(token: string) {
  return /^p[0-9a-z]+\.[A-Za-z0-9_-]{16}$/.test(token);
}

export function verifyCheckinPass(secret: string, pass: string, now: number, maxAgeMs = CHECKIN_PASS_MAX_AGE_MS) {
  if (!isCheckinPass(pass)) return false;
  const [head, sig] = pass.slice(1).split(".");
  const issuedMs = parseInt(head, 36) * 1000;
  if (!Number.isFinite(issuedMs)) return false;
  // A little slack for clock drift between app servers; never accept the far future.
  if (issuedMs > now + 60_000 || now - issuedMs > maxAgeMs) return false;
  return safeEqual(passSignature(secret, head), sig);
}

/** True when `token` is a live rotating QR token or an unexpired pass — i.e. proof of a scan. */
export function verifyScanProof(secret: string, token: string, now: number, rotateSeconds: number) {
  return isCheckinPass(token) ? verifyCheckinPass(secret, token, now) : verifyCheckinToken(secret, token, now, rotateSeconds);
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
