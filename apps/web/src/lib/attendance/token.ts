import { createHmac, randomInt } from "node:crypto";

/**
 * Check-in codes and rotating QR tokens.
 *
 * Every occurrence has a short `checkinCode` (in the URL and typed by hand) and
 * a private `checkinSecret`. The QR on the leader's screen encodes
 * `/c/<code>?t=<token>`, where the token is an HMAC of the current time window.
 * It changes every `checkin.qrRotateSeconds`, so a photo of the screen sent to a
 * friend stops working. Scans with a valid token count as QR check-ins; the
 * code alone counts as a self check-in, which the event can switch off.
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
  return [w, w - 1, w - 2].some((x) => checkinToken(secret, x) === token);
}

export function checkinPath(code: string, token?: string) {
  return token ? `/c/${code}?t=${encodeURIComponent(token)}` : `/c/${code}`;
}
