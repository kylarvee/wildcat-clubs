import "server-only";
import { OAuth2Client } from "google-auth-library";
import { emailKind } from "@/lib/institution";

/**
 * Google sign-in for Weber State accounts (Google Workspace).
 * Web: authorization-code flow (/api/auth/google → /api/auth/google/callback).
 * Mobile: the app gets an ID token from Google and posts it to /api/m/auth/google.
 */

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function client(redirectUri?: string) {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
}

export function googleAuthUrl(origin: string, state: string) {
  return client(`${origin}/api/auth/google/callback`).generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
    // Google only allows one hosted-domain hint; the callback enforces both domains.
    hd: "*",
  });
}

export type GoogleIdentity = { email: string; name: string; picture: string | null };

export async function exchangeCode(origin: string, code: string): Promise<GoogleIdentity> {
  const c = client(`${origin}/api/auth/google/callback`);
  const { tokens } = await c.getToken(code);
  if (!tokens.id_token) throw new Error("Google did not return an ID token.");
  return verifyIdToken(tokens.id_token);
}

/** Verifies a Google ID token (from the web flow or the mobile app) and checks the university domain. */
export async function verifyIdToken(idToken: string): Promise<GoogleIdentity> {
  const audiences = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_IOS_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID].filter(
    (x): x is string => Boolean(x),
  );
  const ticket = await client().verifyIdToken({ idToken, audience: audiences });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw new Error("Google account email is not verified.");
  if (!emailKind(p.email)) throw new Error("Sign in with your Weber State email (@mail.weber.edu or @weber.edu).");
  return { email: p.email, name: p.name ?? p.email.split("@")[0], picture: p.picture ?? null };
}

/** "mock" = test personas only; "google" = Google only; "both" = both (default outside production). */
export function authMode(): "mock" | "google" | "both" {
  const m = process.env.AUTH_MODE;
  if (m === "mock" || m === "google" || m === "both") return m;
  return process.env.NODE_ENV === "production" ? "google" : "both";
}

/** The mobile app's Google sign-in: verifying an ID token needs only a client id, not the web secret. */
export function googleTokenSignInEnabled() {
  return authMode() !== "mock" && Boolean(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_IOS_CLIENT_ID || process.env.GOOGLE_ANDROID_CLIENT_ID);
}

export function personasEnabled() {
  return authMode() !== "google";
}
