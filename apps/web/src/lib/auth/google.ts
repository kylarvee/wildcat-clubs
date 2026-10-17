import "server-only";
import { OAuth2Client } from "google-auth-library";
import { emailKind, INSTITUTION } from "@/lib/institution";

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
    // Google only allows one hosted-domain hint; verifyIdToken enforces both domains.
    hd: "*",
  });
}

export type GoogleIdentity = { email: string; name: string; picture: string | null };

/** Google signed the person in, but not with a Weber State account. The message is safe to show. */
export class NotUniversityAccount extends Error {
  constructor() {
    super(`Sign in with your ${INSTITUTION.shortName} Google account (@${INSTITUTION.studentEmailDomain} or @${INSTITUTION.staffEmailDomain}).`);
    this.name = "NotUniversityAccount";
  }
}

/** Workspace domains whose accounts may sign in (the `hd` claim). */
const HOSTED_DOMAINS: string[] = [INSTITUTION.studentEmailDomain, INSTITUTION.staffEmailDomain];

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
  if (!p?.email || !p.email_verified) throw new NotUniversityAccount();
  // The email suffix alone isn't proof: a personal Google account can be registered with a
  // @weber.edu address (say, by someone who has since left). Only accounts managed by the
  // university's Workspace carry its `hd` claim, so require that too.
  if (!p.hd || !HOSTED_DOMAINS.includes(p.hd.toLowerCase())) throw new NotUniversityAccount();
  if (!emailKind(p.email)) throw new NotUniversityAccount();
  return { email: p.email, name: p.name ?? p.email.split("@")[0], picture: p.picture ?? null };
}

/**
 * "mock" = test personas only; "google" = Google only; "both" = both (default outside production).
 * Test sign-in needs no password, so production is Google-only unless the operator also sets
 * ALLOW_TEST_SIGNIN=1 (a demo server) — a copied .env can't turn it on by accident.
 */
export function authMode(): "mock" | "google" | "both" {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_SIGNIN !== "1") return "google";
  const m = process.env.AUTH_MODE;
  if (m === "mock" || m === "google" || m === "both") return m;
  return "both";
}

/** The mobile app's Google sign-in: verifying an ID token needs only a client id, not the web secret. */
export function googleTokenSignInEnabled() {
  return authMode() !== "mock" && Boolean(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_IOS_CLIENT_ID || process.env.GOOGLE_ANDROID_CLIENT_ID);
}

export function personasEnabled() {
  return authMode() !== "google";
}
